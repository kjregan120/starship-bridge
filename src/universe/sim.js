// sim.js — the command-driven flight engine.
//
// The ship is a thing that OBEYS ORDERS. You don't fly it frame-by-frame; you
// tell it what to do ("ahead full", "come about for that planet", "warp 3,
// engage") and it executes autonomously each step(). This is the engine the
// Computer's flight tools will drive, and it's what the renderer will read to
// draw the ship moving. Pure logic — no rendering — so it's testable in node.

import { positionAt, gravityOnShip, magnitude } from "./physics.js";
import { warpSpeed, canWarp, DEFAULT_FLIGHT } from "./flight.js";
import { planRoute } from "./route.js";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const unit = (a) => { const m = magnitude(a) || 1; return [a[0] / m, a[1] / m, a[2] / m]; };

export class FlightSim {
  constructor(universe, opts = {}) {
    this.objects = universe.objects;
    this.byId = Object.fromEntries(this.objects.map((o) => [o.id, o]));
    this.cfg = { ...DEFAULT_FLIGHT, ...(opts.cfg || {}) };
    this.maxWarp = opts.maxWarp ?? 3;      // the cap you chose
    this.warpStandoff = opts.warpStandoff ?? 60;  // arrive this far from target
    // Impulse hold/arrival distance at a body scales with its own size —
    // a flat distance (used to be 8, always) put the ship absurdly far from
    // small moons: 99% of moons in a generated universe have their entire
    // orbit around their parent planet smaller than that, so a fixed offset
    // that size swings the ship through a loop comparable to (or wider than)
    // the moon's own orbit instead of hugging it. See _holdRadius().
    this.holdK = opts.holdK ?? 4;
    this.minHoldRadius = opts.minHoldRadius ?? 1.5;
    this.pointRadius = opts.pointRadius ?? 3;

    this.t = 0;
    this.pos = opts.startPos ?? [0, 0, 0];
    this.vel = [0, 0, 0];
    this.mode = "impulse";     // "impulse" | "warp"
    this.throttle = 0;         // 0..1 of impulse max
    this.thrustSign = 1;       // 1 = ahead (nose-first), -1 = reverse thrusters
    this.heading = null;       // {type:'body',id} | {type:'point',p} — used by both impulse and warp
    this.waypoints = [];       // bends plotted around hazards, flown before `heading`
    this.warpFactor = 2;
    this.facing = [0, 0, 1];   // ship's nose, kept even when stopped — see _impulseStep
    this.events = [];
  }

  posOf(id) { return positionAt(this.byId[id], this.byId, this.t); }
  log(kind, msg) { this.events.push({ t: this.t, kind, msg }); }
  // Exact name match wins outright. Otherwise, among every body whose name
  // contains the query (a short/partial name is often ambiguous — dozens of
  // systems can share a root name like "Icarus"), resolve to whichever one
  // is actually nearest the ship, not whichever was generated first — array
  // order has no relation to what the player means by a partial name.
  find(q) {
    if (this.byId[q]) return this.byId[q];
    const s = String(q).trim().toLowerCase();
    if (!s) return null;

    const exact = this.objects.find((o) => o.name && o.name.toLowerCase() === s);
    if (exact) return exact;

    const matches = this.objects.filter((o) => o.name && o.name.toLowerCase().includes(s));
    if (matches.length <= 1) return matches[0];

    let best = matches[0], bestD = Infinity;
    for (const o of matches) {
      const d = magnitude(sub(positionAt(o, this.byId, this.t), this.pos));
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  // Plots a route to `destPos`, avoiding any body (other than the ones in
  // `excludeIds`) that the straight leg would pass too close to. Sets
  // this.waypoints to the intermediate bends (empty if the leg is already
  // clear) and returns the full planRoute() result for callers that want to
  // report on it (e.g. name the body being routed around).
  _planWaypoints(destPos, excludeIds) {
    const bodies = this.objects
      .filter((o) => o.type !== "nebula" && !excludeIds.has(o.id))
      .map((o) => ({ id: o.id, name: o.name, size: o.size, pos: positionAt(o, this.byId, this.t) }));
    const route = planRoute(this.pos, destPos, bodies);
    this.waypoints = route.bent ? route.points.slice(1, -1) : [];
    return route;
  }

  // ---------------- orders ----------------
  allStop() {
    this.mode = "impulse"; this.throttle = 0; this.thrustSign = 1;
    this.heading = null; this.waypoints = [];
    this.log("order", "All stop.");
  }
  ahead(frac) {
    this.mode = "impulse"; this.throttle = Math.max(0, Math.min(1, frac)); this.thrustSign = 1;
    // Leaving station-keeping is the point of "ahead" — an active heading
    // (body/point) is left alone so this can just adjust speed mid-approach.
    if (this.heading?.type === "hold") this.heading = null;
    this.log("order", `Ahead, impulse ${Math.round(this.throttle * 100)}%.`);
  }
  // Reverse thrusters: push backward along the stern while the nose keeps
  // pointing the same way (this.facing is left untouched). Cancels any active
  // heading lock — you can't back away while the autopilot is steering you
  // toward a target.
  reverse(frac) {
    this.mode = "impulse"; this.throttle = Math.max(0, Math.min(1, frac)); this.thrustSign = -1;
    this.heading = null; this.waypoints = [];
    this.log("order", `Reverse thrusters, impulse ${Math.round(this.throttle * 100)}%.`);
  }
  comeAbout(q) {
    const o = this.find(q);
    if (!o) { this.log("deny", `No contact matching "${q}".`); return false; }
    const route = this._planWaypoints(this.posOf(o.id), new Set([o.id]));
    this.heading = { type: "body", id: o.id };
    this.mode = "impulse";
    if (this.throttle === 0) this.throttle = 0.6;
    this.log("order", route.bent
      ? `Helm, come about for ${o.name} — course plotted clear of ${route.hazards[0].body.name}.`
      : `Helm, come about for ${o.name}.`);
    return true;
  }
  steerToPoint(p) {
    const route = this._planWaypoints(p, new Set());
    this.heading = { type: "point", p }; this.mode = "impulse";
    if (this.throttle === 0) this.throttle = 0.6;
    this.log("order", route.bent
      ? `Helm, new heading laid in — course plotted clear of ${route.hazards[0].body.name}.`
      : "Helm, new heading laid in.");
  }
  // Manual helm: yaw the nose left (port) or right (starboard) by `degrees`,
  // around the galaxy's up axis (Y) — the galaxy is a thin disk, so this is
  // the turn you actually want. Momentum turns with the nose (this.vel is
  // rotated too) so a turn sticks instead of being overwritten the instant
  // forward thrust resumes chasing the old velocity direction. Cancels any
  // heading lock, same as reverse — manual helm overrides the autopilot.
  turn(dir, degrees) {
    const deg = Math.max(0, degrees || 0);
    if (deg === 0) return;
    const sign = dir === "port" ? -1 : 1;
    const rad = (Math.PI / 180) * deg * sign;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rotY = ([x, y, z]) => [x * cos - z * sin, y, x * sin + z * cos];
    this.facing = unit(rotY(this.facing));
    this.vel = rotY(this.vel);
    this.heading = null; this.waypoints = [];
    this.log("order", `Helm, ${dir} ${Math.round(deg)} degrees.`);
  }
  // With a destination: straight-line beeline there (any previously plotted
  // route is discarded — warp at a named target ignores hazards by design).
  // Without one: just engage and hold the current heading, cruising forward
  // indefinitely until given another order.
  engageWarp(q, factor) {
    const f = Math.max(1, Math.min(this.maxWarp, Math.round(factor || 2)));
    let o = null;
    if (q) {
      o = this.find(q);
      if (!o) { this.log("deny", `No such destination "${q}".`); return false; }
    }
    const chk = canWarp(this.pos, this.objects, this.byId, positionAt, this.t, this.cfg);
    if (!chk.ok) {
      this.log("deny",
        `Unable to engage warp — too deep in the gravity well of ${chk.blockedBy.name}. ` +
        `Recommend impulse power to clear.`);
      return false;
    }
    this.mode = "warp"; this.warpFactor = f; this.waypoints = [];
    if (o) {
      this.heading = { type: "body", id: o.id };
      this.log("order", `Course laid in for ${o.name}. Warp ${f}, engage.`);
    } else {
      this.heading = null;
      this.log("order", `Warp ${f}, engage — holding present heading.`);
    }
    return true;
  }
  // Flies the route currently plotted by come-about/steer-to-point (heading +
  // any bends already in this.waypoints) at warp instead of impulse — same
  // course, faster. Left entirely alone here; only `mode`/`warpFactor` change,
  // so _warpStep picks up exactly where impulse would have steered.
  warpCourse(factor) {
    if (!this.heading || this.heading.type === "hold") {
      this.log("deny", "No course plotted to take at warp. Come about for a destination first.");
      return false;
    }
    const f = Math.max(1, Math.min(this.maxWarp, Math.round(factor || 2)));
    const chk = canWarp(this.pos, this.objects, this.byId, positionAt, this.t, this.cfg);
    if (!chk.ok) {
      this.log("deny",
        `Unable to engage warp — too deep in the gravity well of ${chk.blockedBy.name}. ` +
        `Recommend impulse power to clear.`);
      return false;
    }
    this.mode = "warp"; this.warpFactor = f;
    this.log("order", this.waypoints.length
      ? `Helm, take the plotted course. Warp ${f}, engage — ${this.waypoints.length} bend${this.waypoints.length > 1 ? "s" : ""} ahead.`
      : `Helm, take the plotted course. Warp ${f}, engage.`);
    return true;
  }
  dropOut() {
    if (this.mode === "warp") {
      this.mode = "impulse"; this.throttle = 0;
      this.heading = null; this.waypoints = [];
      this.log("order", "Dropping out of warp.");
    }
  }

  // Silent check — true if warp could engage from here. Lets the UI light up a
  // "ready" indicator without spamming denial messages.
  canEngageWarp() {
    return canWarp(this.pos, this.objects, this.byId, positionAt, this.t, this.cfg).ok;
  }

  // ---------------- simulation ----------------
  step(dt) {
    this.t += dt;
    if (this.mode === "warp") this._warpStep(dt);
    else this._impulseStep(dt);
  }

  // Warp shares _resolveTarget() with impulse, so "take this course at warp"
  // is literally the same route, just flown faster. Three cases per leg:
  //   - no target at all: hold present heading, cruise forward forever
  //   - a plotted bend: fly straight to it, pop it, carry on with whatever
  //     distance budget is left this tick (so a tight bend doesn't eat a
  //     whole frame at warp speed — see budget loop below)
  //   - the final heading (body or point): beeline with a standoff / exact
  //     stop, then drop to impulse — same as the old single-target warp
  // `budget` is the distance the ship can cover this tick; a single frame at
  // high warp can easily cover more ground than the gap between two bends,
  // so it's drained leg by leg instead of only ever resolving the first one.
  _warpStep(dt) {
    const v = warpSpeed(this.warpFactor, this.cfg);
    let budget = v * dt;

    for (let i = 0; i < 8 && budget > 0; i++) {
      const t = this._resolveTarget();

      if (!t) {
        this.pos = add(this.pos, scale(this.facing, budget));
        this.vel = scale(this.facing, v);
        return;
      }

      const d = sub(t.point, this.pos);
      const dist = magnitude(d);
      const dir = dist > 1e-6 ? unit(d) : this.facing;
      this.facing = dir;

      if (t.isWaypoint) {
        if (budget >= dist) {
          this.pos = t.point;
          budget -= dist;
          this.waypoints.shift();
          continue; // steer for the next leg with whatever budget remains
        }
        this.pos = add(this.pos, scale(dir, budget));
        this.vel = scale(dir, v);
        return;
      }

      // Final leg: body target gets a standoff (never fly nose-first into
      // it); a point target is arrived at exactly.
      const isBody = this.heading.type === "body";
      const target = isBody ? this.byId[this.heading.id] : null;
      const standoff = isBody ? Math.max(this.warpStandoff, (target.size || 0) * 7) : 0;

      if (budget >= dist - standoff) {
        this.pos = isBody ? sub(t.point, scale(dir, standoff)) : t.point;
        this.vel = [0, 0, 0];
        this.mode = "impulse"; this.throttle = 0;
        if (isBody) { this._holdAt(this.heading.id); this.log("arrive", `Arrived at ${target.name}. Dropping to impulse.`); }
        else { this.heading = null; this.log("arrive", "Arrived. All stop."); }
        return;
      }
      this.pos = add(this.pos, scale(dir, budget));
      this.vel = scale(dir, v);
      return;
    }
  }

  // Turns "arrived at body X" into a standing order to hold station there:
  // a fixed offset from X, re-applied every tick so the ship keeps pace with
  // X's own orbital motion instead of freezing at the single point in space
  // it happened to arrive at (which X then sails away from). No thrust is
  // simulated to maintain this — station-keeping thrusters are assumed, same
  // as the rest of the sim assumes engines just do what's ordered.
  _holdAt(id) {
    this.heading = { type: "hold", id, offset: sub(this.pos, this.posOf(id)) };
  }

  // How close impulse pulls up to a body before holding station — scaled to
  // the body's own size (a star warrants real distance, a moon doesn't)
  // instead of one flat number for everything.
  _holdRadius(body) {
    return Math.max(this.minHoldRadius, (body.size || 0) * this.holdK);
  }

  // Resolves what the helm is currently steering for: a plotted bend
  // (this.waypoints[0], passed through at a loose radius and popped — no
  // stop, no order-clear, just the next leg), else the final heading (body
  // or point, held station / stopped on arrival as before), else nothing.
  // "hold" isn't a steering target (see _holdAt / _impulseStep) so it's not
  // resolved here.
  _resolveTarget() {
    if (this.waypoints.length) {
      return { point: this.waypoints[0], radius: 6, name: "waypoint", isWaypoint: true };
    }
    if (this.heading?.type === "body") {
      const body = this.byId[this.heading.id];
      return { point: this.posOf(this.heading.id), radius: this._holdRadius(body), name: body.name, isWaypoint: false };
    }
    if (this.heading?.type === "point") {
      return { point: this.heading.p, radius: this.pointRadius, name: "coordinates", isWaypoint: false };
    }
    return null;
  }

  _impulseStep(dt) {
    if (this.heading?.type === "hold") {
      this.pos = add(this.posOf(this.heading.id), this.heading.offset);
      this.vel = [0, 0, 0];
      return;
    }

    let dir = [0, 0, 0];
    let t = this._resolveTarget();

    if (t && magnitude(sub(t.point, this.pos)) <= t.radius + 0.5) {
      if (t.isWaypoint) {
        this.waypoints.shift();
        t = this._resolveTarget(); // steer for the next leg this same tick, no dead frame
      } else if (this.heading.type === "point") {
        this.vel = [0, 0, 0]; this.throttle = 0; this.heading = null;
        this.log("arrive", "Arrived. All stop.");
        return;
      } else {
        this.vel = [0, 0, 0]; this.throttle = 0;
        const name = t.name;
        this._holdAt(this.heading.id);
        this.log("arrive", `Holding station at ${name}.`);
        return;
      }
    }

    if (t) {
      dir = unit(sub(t.point, this.pos));
      this.facing = dir;
    } else if (this.throttle > 0 && this.thrustSign < 0) {
      // Reverse thrusters: push opposite the nose regardless of current
      // drift, and leave facing alone — the ship backs away without
      // rotating to face the way it's actually moving.
      dir = scale(this.facing, -1);
    } else if (this.throttle > 0) {
      // No target: thrust along the ship's facing, not its instantaneous
      // velocity. At rest that velocity is zero (thrust would do nothing), and
      // once gravity has nudged you off station your velocity points toward
      // whatever is pulling on you — steering by it would just feed the drift
      // instead of letting "ahead full" actually pull you away from a hazard.
      const speed = magnitude(this.vel);
      dir = speed > 0.05 ? unit(this.vel) : this.facing;
      this.facing = dir;
    }

    // station-keeping: no order, no throttle -> hold position (thrusters win)
    if (this.throttle === 0 && !t) {
      this.vel = scale(this.vel, Math.max(0, 1 - 6 * dt));
      this.pos = add(this.pos, scale(this.vel, dt));
      return;
    }

    // steer velocity toward the desired velocity at finite accel; gravity is a
    // perturbation on top — strong wells still bend the path (slingshot-ish).
    const desiredVel = scale(dir, this.throttle * this.cfg.impulseMax);
    const dv = sub(desiredVel, this.vel);
    const steer = this._clampMag(dv, this.cfg.impulseAccel * dt);
    const grav = gravityOnShip(this.pos, this.objects, this.byId, this.t, this.cfg).accel;
    this.vel = add(add(this.vel, steer), scale(grav, dt));
    this.pos = add(this.pos, scale(this.vel, dt));
  }

  _clampMag(v, max) {
    const m = magnitude(v);
    return m <= max || m === 0 ? v : scale(v, max / m);
  }

  snapshot() {
    return {
      t: this.t, pos: this.pos, vel: this.vel, speed: magnitude(this.vel),
      mode: this.mode, throttle: this.throttle
    };
  }
}
