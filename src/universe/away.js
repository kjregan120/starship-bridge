// away.js — the captain and an away team on a planet's surface.
//
// Pure logic, like ship.js and tactical.js: the renderer (flight/SurfaceApp)
// passes in where the captain is trying to walk and draws what this says.
// Positions are [x, z] metres in site coordinates (terrain.js); height is
// always the ground's.
//
// The same principle as the Tactical crew: the team work on their own. With
// no orders they follow the captain and take on whatever task is nearby,
// the best-suited person for each. Orders are optional overrides: follow
// me, hold here, fan out, or "<name> scan".
//
// The surface hurts people: suit air runs down on airless and poisonous
// worlds, vents burn, the going tires them. That harm runs through the
// roster (crew.js awayHarm) so injuries and deaths land in their files the
// same way the ship's do. The captain isn't on the roster; their health is
// kept here, and losing them ends the game.

import { envFor, landable, stormAt, VENT_RADIUS, VENT_HARM } from "./surface.js";
import { SITE_RADIUS } from "./terrain.js";
import { POI_KINDS, TASKS, workOn, stepSurvivors, objectiveStatus, missionComplete, payout, xpForTask } from "./missions.js";
import { statusOf, effectiveness } from "./crew.js";

export const TEAM_MAX = 3;          // the transporter takes the captain and three
export const EXTRACT_RADIUS = 30;   // m — who's close enough to the captain to beam up together
const WALK = 3.2, RUN = 6.5;        // m/s
const REACH = 2.5;                  // m — close enough to work on something
const AUTO_RADIUS = 30;             // following team pick up tasks this close to the captain
const FAN_RADIUS = 250;             // and this far when fanned out
const CAPTAIN_WORK = 0.8;           // the captain is a capable generalist, not a specialist
const SUIT_HARM = 0.012;            // health/s once suit air is gone
const TOXIC_LEAK = 0.002;           // health/s on toxic worlds once a suit is past its limit
// Where the team walk when following: behind and to either side of the
// captain, in the captain's own frame (x right, z forward).
const SLOTS = [[-1.9, -0.6], [1.9, -0.6], [0, -2.4], [-3.4, -2.2], [3.4, -2.2], [0, -4.5]];

// Can the transporter send people down to (or bring them up from) a site?
// → { ok, why }
export function canBeam({ ship, sim, body, site, t, incoming = [] }) {
  if (!landable(body)) return { ok: false, why: `there's no surface on ${body?.name ?? "that"} to beam to` };
  if (sim.mode === "warp") return { ok: false, why: "we're at warp" };
  if (!sim.inOrbit(body.id)) return { ok: false, why: `we need to be in standard orbit of ${body.name}` };
  if (ship.reactor.scrammed) return { ok: false, why: "not enough power with the reactor down" };
  if (ship.tractored) return { ok: false, why: "the tractor beam's field is scattering the signal" };
  if (ship.sensorQuality() < 0.25) return { ok: false, why: "sensors are too degraded to get a lock" };
  if (ship.interference > 0.6) return { ok: false, why: "too much interference to hold a lock" };
  if (site && stormAt(site, t)) return { ok: false, why: "a lightning storm over the site — ionic interference. Wait for it to pass" };
  const cme = incoming.find((x) => x.kind === "cme" && x.eta != null && x.eta < 20);
  if (cme) return { ok: false, why: `a coronal mass ejection hits in ${Math.ceil(cme.eta)} seconds` };
  return { ok: true, why: null };
}

// How much work someone gets done on a task using `skill`: the same
// weighting as the ship's repair parties (crew.js workers).
function workWeight(roster, m, skill) {
  const fit = { healthy: 1, injured: 0.6, critical: 0, dead: 0 }[statusOf(m)];
  return fit * effectiveness(m.fatigue) * (0.5 + 0.15 * roster.levelIn(m, skill));
}
const taskSkill = (roster, m, kind) => {
  const k = POI_KINDS[kind];
  if (!k.alt) return k.skill;
  return roster.levelIn(m, k.alt) > roster.levelIn(m, k.skill) ? k.alt : k.skill;
};

// Who the first officer would send, for a mission type: the people best at
// what it needs, off-watch first so the watch isn't left short.
const WANTS = {
  science: ["sensor-analysis", "environmental-systems", "security-ops"],
  resource: ["logistics", "eva", "security-ops"],
  rescue: ["medicine", "first-aid", "security-ops"],
};
export function pickTeam(roster, type, n = TEAM_MAX) {
  const pool = roster.crew.filter((m) => m.health > 0 && statusOf(m) === "healthy" && (m.location === "station" || m.location === "quarters"));
  const out = [];
  for (const skill of WANTS[type] ?? WANTS.science) {
    if (out.length >= n) break;
    const best = pool.filter((m) => !out.includes(m))
      .map((m) => ({ m, s: roster.levelIn(m, skill) + (m.location === "quarters" ? 0.5 : 0) - m.fatigue }))
      .sort((a, b) => b.s - a.s)[0];
    if (best) out.push(best.m);
  }
  return out;
}

const DOING = { anomaly: "Scanning", specimen: "Sampling", deposit: "Collecting", survivor: "Stabilising" };
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lastName = (m) => m.name.split(" ").slice(-1)[0];

export class AwayMission {
  // `members`: roster members going down (already sent away). `mission`:
  // missions.js missionFor(), or null for an open survey.
  // `t0`: the ship's mission time at beam-down — the site's weather and
  // daylight run on the same clock as the ship's.
  constructor({ body, site, terrain, mission, roster, members, t0 = 0 }) {
    this.t0 = t0;
    this.body = body;
    this.site = site;
    this.terrain = terrain;
    this.mission = mission;
    this.roster = roster;
    this.env = envFor(body);
    this.time = 0;
    this.suit = this.env.suit;      // seconds of air left, or null
    this.captain = { pos: [0, 0], heading: 0, health: 1, moving: false, work: null, hurting: false };
    this.team = members.map((m, i) => ({
      id: m.id, m, pos: [SLOTS[i][0] * 1.5, SLOTS[i][1] * 1.5], heading: 0, moving: false,
      order: "follow", task: null,
    }));
    this.events = [];
    this.captainDead = false;
    this._warned = {};
    this._completeSaid = false;
    this._edgeSaid = 0;
  }

  log(kind, msg) { this.events.push({ t: this.time, kind, msg }); if (this.events.length > 200) this.events.shift(); }
  heightAt(x, z) { return this.terrain.heightAt(x, z); }
  pois() { return this.mission?.pois ?? []; }
  objectives() { return this.mission ? objectiveStatus(this.mission) : []; }
  complete() { return !!this.mission && missionComplete(this.mission); }
  alive() { return this.team.filter((a) => a.m.health > 0); }

  // ---------------- orders ----------------
  // The away command line. → { ok, msg } — false when it isn't an away order
  // (the caller can try it elsewhere).
  order(text) {
    const t = text.trim().toLowerCase();
    let m;
    if (/^(follow(?: me)?|regroup|on me|form up|fall in)$/.test(t)) {
      for (const a of this.alive()) { a.order = "follow"; this._drop(a); }
      return this._say("order", "Team, on me.");
    }
    if (/^(hold(?: here| position)?|stay(?: here)?|wait(?: here)?)$/.test(t)) {
      for (const a of this.alive()) { a.order = "hold"; this._drop(a); }
      return this._say("order", "Team, hold here.");
    }
    if (/^(fan out|spread out|search(?: the area)?|work the site)$/.test(t)) {
      for (const a of this.alive()) a.order = "fan";
      return this._say("order", "Team, fan out. Work anything you find.");
    }
    if ((m = t.match(/^(?:(.+?)\s+)?(scan|sample|collect|stabili[sz]e|treat)(?:\s+.*)?$/))) {
      const task = m[2] === "treat" ? "stabilise" : m[2].replace("z", "s");
      return this._taskOrder(m[1], TASKS[task], task);
    }
    if (/^(status|report|team status|away status)$/.test(t)) { this._report(); return { ok: true, msg: null }; }
    return { ok: false, msg: null };
  }
  _say(kind, msg) { this.log(kind, msg); return { ok: true, msg }; }
  _drop(a) { if (a.task) { a.task.claimed = null; a.task = null; } }

  _taskOrder(who, kind, task) {
    const open = this.pois().filter((p) => p.kind === kind && !p.done && !p.dead);
    if (!open.length) return this._say("deny", `Nothing left to ${task} here.`);
    let a;
    if (who) {
      a = this.alive().find((x) => x.m.name.toLowerCase().includes(who) || lastName(x.m).toLowerCase() === who);
      if (!a) return this._say("deny", `No one on the team named "${who}".`);
      if (statusOf(a.m) === "critical") return this._say("deny", `${a.m.name} is down.`);
    } else {
      // Whoever's best at it.
      a = this.alive().filter((x) => statusOf(x.m) !== "critical")
        .sort((x, y) => workWeight(this.roster, y.m, taskSkill(this.roster, y.m, kind)) - workWeight(this.roster, x.m, taskSkill(this.roster, x.m, kind)))[0];
      if (!a) return this._say("deny", "No one fit to do it.");
    }
    const from = who ? a.pos : this.captain.pos;
    const p = open.filter((x) => !x.claimed || x.claimed === a.id).sort((x, y) => dist2(x.pos, from) - dist2(y.pos, from))[0] ?? open[0];
    this._drop(a);
    this._claim(a, p);
    a.order = a.order === "hold" ? "follow" : a.order;
    return this._say("order", `${a.m.rank} ${lastName(a.m)}, ${task} the ${p.label.toLowerCase()} — ${Math.round(dist2(a.pos, p.pos))} m.`);
  }
  _claim(a, p) {
    if (p.claimed && p.claimed !== a.id) {
      const other = this.team.find((x) => x.id === p.claimed);
      if (other) other.task = null;
    }
    p.claimed = a.id;
    a.task = p;
  }

  // The captain works whatever's in reach (the E key).
  interact() {
    const p = this.nearestPoi(this.captain.pos, REACH + 1.5);
    if (!p) { this.log("deny", "Nothing within reach."); return null; }
    this.captain.work = p;
    this.log("order", `${DOING[p.kind]} the ${p.label.toLowerCase()}…`);
    return p;
  }
  nearestPoi(pos, within = Infinity) {
    let best = null, bd = within;
    for (const p of this.pois()) {
      if (p.done || p.dead) continue;
      const d = dist2(p.pos, pos);
      if (d <= bd) { bd = d; best = p; }
    }
    return best;
  }

  _report() {
    const team = this.alive().map((a) => `${lastName(a.m)} ${Math.round(a.m.health * 100)}%`).join(", ");
    this.log("info", `Captain ${Math.round(this.captain.health * 100)}%${team ? `; ${team}` : ""}.` +
      (this.suit != null ? ` Suit air ${fmtSecs(this.suit)}.` : ""));
    for (const o of this.objectives()) this.log("info", `  ${o.done ? "✓" : "·"} ${o.label} ${o.have}/${o.need}`);
  }

  // ---------------- beaming out ----------------
  // Who'd come up with the captain right now, and who'd be left.
  beamParty() {
    const near = (pos) => dist2(pos, this.captain.pos) <= EXTRACT_RADIUS;
    const team = this.team.filter((a) => a.m.health > 0);
    return {
      team: team.filter((a) => near(a.pos)),
      left: team.filter((a) => !near(a.pos)),
      survivors: this.pois().filter((p) => p.kind === "survivor" && p.done && !p.dead && !p.extracted && near(p.pos)),
      strays: this.pois().filter((p) => p.kind === "survivor" && p.done && !p.dead && !p.extracted && !near(p.pos)),
    };
  }
  // Bring everyone in range aboard. → the haul (missions.js payout) and who
  // came up, for the caller to put into the ship and the career.
  extract() {
    const party = this.beamParty();
    for (const s of party.survivors) s.extracted = true;
    return { party, haul: this.mission ? payout(this.mission) : null, complete: this.complete() };
  }

  // ---------------- simulation ----------------
  // `input`: { move: [x, z] direction in site coords (zero to stand still), run }
  step(dt, input = {}) {
    if (dt <= 0 || this.captainDead) return;
    this.time += dt;
    this._captainStep(dt, input);
    for (const a of this.team) this._memberStep(dt, a);
    this._survivorStep(dt);
    this._hazardStep(dt);
    if (this.mission && !this._completeSaid && this.complete()) {
      this._completeSaid = true;
      this.log("arrive", this.mission.type === "rescue"
        ? "All survivors aboard."
        : "That's everything. Ready to beam up when you are.");
    }
  }

  _move(e, dir, speed, dt) {
    const len = Math.hypot(dir[0], dir[1]);
    if (len < 1e-6) { e.moving = false; return; }
    const step = Math.min(speed * dt, len);
    const nx = e.pos[0] + (dir[0] / len) * step, nz = e.pos[1] + (dir[1] / len) * step;
    // Deep water stops you; the edge of the survey area does too.
    const w = this.terrain.water;
    if (w != null && this.heightAt(nx, nz) < w - 1.2) { e.moving = false; return; }
    if (Math.hypot(nx, nz) > SITE_RADIUS) { e.moving = false; return "edge"; }
    e.pos = [nx, nz];
    e.heading = Math.atan2(dir[0], dir[1]);
    e.moving = true;
  }
  _speed() { return this.env.gravity < 0.5 ? 0.85 : 1; }

  _captainStep(dt, { move = [0, 0], run = false }) {
    const c = this.captain;
    const r = this._move(c, move, (run ? RUN : WALK) * this._speed() * (c.health < 0.3 ? 0.5 : 1), dt);
    if (r === "edge" && this.time - this._edgeSaid > 8) { this._edgeSaid = this.time; this.log("deny", "That's the edge of the survey area."); }
    if (c.moving) c.work = null;
    if (c.work) {
      const p = c.work;
      if (p.done || p.dead || dist2(p.pos, c.pos) > REACH + 2) c.work = null;
      else if (workOn(p, CAPTAIN_WORK * dt)) { this._finished(p, null); c.work = null; }
    }
  }

  _memberStep(dt, a) {
    const m = a.m;
    if (m.health <= 0) { a.moving = false; if (!a.deadSaid) { a.deadSaid = true; this._drop(a); this.log("deny", `${m.rank} ${m.name} is dead.`); } return; }
    if (statusOf(m) === "critical") {
      a.moving = false; this._drop(a);
      if (!a.downSaid) { a.downSaid = true; this.log("deny", `${m.rank} ${lastName(m)} is down — critical. Get them back to the ship.`); }
      return;
    }
    a.downSaid = false;
    // Pick up work on our own when there's nothing ordered.
    if (!a.task && a.order !== "hold") {
      const radius = a.order === "fan" ? FAN_RADIUS : AUTO_RADIUS;
      const p = this._bestOpenTask(a, radius);
      if (p) this._claim(a, p);
    }
    let dest;
    if (a.task) {
      const p = a.task;
      if (p.done || p.dead) { this._drop(a); return; }
      const d = dist2(a.pos, p.pos);
      if (d > REACH) dest = p.pos;
      else {
        a.moving = false;
        const skill = taskSkill(this.roster, m, p.kind);
        (p.workers ??= {})[m.id] = skill;
        if (workOn(p, workWeight(this.roster, m, skill) * dt)) this._finished(p, a);
        return;
      }
    } else if (a.order === "hold") {
      a.moving = false; return;
    } else {
      dest = this._slot(this.team.indexOf(a));
    }
    const dir = [dest[0] - a.pos[0], dest[1] - a.pos[1]];
    const d = Math.hypot(dir[0], dir[1]);
    if (!a.task && d < 0.6) { a.moving = false; return; }
    const tired = effectiveness(m.fatigue) * (statusOf(m) === "injured" ? 0.7 : 1);
    const speed = (d > 10 ? RUN : WALK * 1.1) * this._speed() * Math.max(0.5, tired);
    this._move(a, dir, speed, dt);
  }

  _slot(i) {
    const c = this.captain, s = SLOTS[i % SLOTS.length];
    const h = c.heading, cos = Math.cos(h), sin = Math.sin(h);
    // captain frame: forward = (sin h, cos h), right = (cos h, -sin h)
    return [c.pos[0] + s[0] * cos + s[1] * sin, c.pos[1] - s[0] * sin + s[1] * cos];
  }

  // The nearby unclaimed task this person is best suited to, near the captain.
  _bestOpenTask(a, radius) {
    let best = null, score = -Infinity;
    for (const p of this.pois()) {
      if (p.done || p.dead || (p.claimed && p.claimed !== a.id)) continue;
      if (dist2(p.pos, this.captain.pos) > radius) continue;
      const s = workWeight(this.roster, a.m, taskSkill(this.roster, a.m, p.kind)) * 10 - dist2(p.pos, a.pos) / 20;
      if (s > score) { score = s; best = p; }
    }
    return best;
  }

  _finished(p, a) {
    p.claimed = null;
    const who = a ? `${lastName(a.m)}: ` : "";
    const msg = {
      anomaly: `${who}Scan of the ${p.label} logged.`,
      specimen: `${who}${p.label[0].toUpperCase()}${p.label.slice(1)} taken and sealed.`,
      deposit: `${who}${p.label[0].toUpperCase()}${p.label.slice(1)} collected.`,
      survivor: `${who}${p.label} is stable. They can be moved.`,
    }[p.kind];
    this.log("info", msg);
    // Practice for everyone who worked on it.
    const workers = Object.entries(p.workers ?? {}).map(([id, skill]) => ({ m: this.roster.find(id), skill })).filter((x) => x.m);
    for (const { m, skill } of workers) this.roster.credit([{ m, w: 1 }], skill, xpForTask() / workers.length, this.t0 + this.time);
    if (a) a.task = null;
  }

  _survivorStep(dt) {
    if (!this.mission) return;
    for (const p of stepSurvivors(this.mission, dt)) this.log("deny", `We've lost ${p.label}.`);
    // Stabilised survivors walk out with the captain, slowly.
    let i = 0;
    for (const p of this.pois()) {
      if (p.kind !== "survivor" || !p.done || p.dead || p.extracted) continue;
      const near = dist2(p.pos, this.captain.pos);
      if (near < 60) {
        const dest = this._slot(this.team.length + i++);
        const dir = [dest[0] - p.pos[0], dest[1] - p.pos[1]];
        if (Math.hypot(...dir) > 0.8) this._move(p, dir, WALK * 0.7 * this._speed(), dt);
        else p.moving = false;
      } else p.moving = false;
    }
  }

  _hazardStep(dt) {
    const env = this.env;
    if (this.suit != null) {
      this.suit = Math.max(0, this.suit - dt);
      const frac = this.suit / env.suit;
      const warn = (key, cond, msg) => { if (cond && !this._warned[key]) { this._warned[key] = true; this.log("deny", msg); } };
      warn("half", frac <= 0.5, `Suit air at half — ${fmtSecs(this.suit)} left.`);
      warn("quarter", frac <= 0.25, `Suit air ${fmtSecs(this.suit)}. Start heading back.`);
      warn("minute", this.suit <= 60, "One minute of suit air left!");
      warn("out", this.suit <= 0, "Suit air is gone. We need to beam up now.");
    }
    const harmAt = (pos) => {
      const h = {};
      if (this.suit != null && this.suit <= 0) {
        if (env.air === "toxic") h.toxic = SUIT_HARM + TOXIC_LEAK;
        else h.suit = SUIT_HARM;
      }
      for (const [vx, vz] of this.terrain.vents) {
        const d = Math.hypot(pos[0] - vx, pos[1] - vz);
        if (d < VENT_RADIUS) h.heat = (h.heat ?? 0) + VENT_HARM * (1 - d / VENT_RADIUS) * 2;
      }
      return h;
    };
    for (const a of this.team) {
      if (a.m.health <= 0) continue;
      a.m.awayHarm = harmAt(a.pos);
      a.m.awayTire = env.tire;
    }
    const c = this.captain;
    const h = harmAt(c.pos);
    const total = Object.values(h).reduce((x, y) => x + y, 0);
    c.hurting = total > 0;
    if (total > 0) {
      c.health = Math.max(0, c.health - total * dt);
      c.cause = Object.entries(h).sort((x, y) => y[1] - x[1])[0][0];
      if (c.health < 0.3 && !this._warned.capCrit) { this._warned.capCrit = true; this.log("deny", "Captain, you're badly hurt."); }
      if (c.health <= 0) { this.captainDead = true; this.log("deny", "The captain is dead."); }
    }
  }

  snapshot() {
    const c = this.captain;
    return {
      time: this.time,
      captain: { pos: c.pos, heading: c.heading, health: c.health, moving: c.moving, hurting: c.hurting, working: c.work?.id ?? null },
      team: this.team.map((a) => ({
        id: a.id, name: a.m.name, last: lastName(a.m), rank: a.m.rank, dept: a.m.dept, pos: a.pos, heading: a.heading,
        moving: a.moving, health: a.m.health, status: statusOf(a.m), order: a.order, task: a.task?.id ?? null,
        fatigue: a.m.fatigue, hurting: Object.keys(a.m.awayHarm ?? {}).length > 0,
      })),
      pois: this.pois().map((p) => ({ ...p, workers: undefined })),
      objectives: this.objectives(),
      complete: this.complete(),
      suit: this.suit, suitMax: this.env.suit,
      captainDead: this.captainDead,
      storm: stormAt(this.site, this.t0 + this.time),
    };
  }
}

export const fmtSecs = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
