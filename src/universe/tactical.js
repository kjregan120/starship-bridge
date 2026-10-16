// tactical.js — the Tactical department fighting a Collective cube on its own.
//
// The captain doesn't aim. When a cube comes into weapons range the crew
// report "weapons ready, awaiting orders" and hold for a few seconds — once
// per encounter — and if no order comes, they engage. From then on they
// choose what to shoot at, notice when the cube has adapted to their
// frequency and rotate to another, and ease off the guns when the shields
// need the power. How well they do all of that is down to who is at the
// Tactical stations, how good they are, and how tired (Roster.workers, the
// same reckoning as the repair crews), and to the weapons themselves:
// their health and the power they get (ShipSystems.weaponsFactor).
//
// The captain's levers are optional: `engage` (skip the hold), `hold fire`,
// `target <emitters|tractor|regen|core|auto>`, `stance <defensive|balanced|
// aggressive>` — and all the ordinary ones: power, all hands, the helm.
//
//   idle ──cube in range──▶ hold ──5 s, or `engage`──▶ engaged
//                             │                          │
//                             └──`hold fire`──▶ holding ◀┘ (until `engage`)
//   any ──cube gone, lost or disabled──▶ idle (the window re-arms for the next one)
//
// Pure logic: the flight loop steps it after the cube, with real seconds,
// and logs what it says.

import { BANDS, ADAPTED_AT } from "./cube.js";
import { WEAPONS_OFFLINE } from "./ship.js";

export const HOLD_WINDOW = 5;        // s the crew wait for orders, once per encounter
export const RANGE = 16;             // u — our phasers' reach
const VOLLEY_EVERY = 2.0;            // s between volleys at the full rate
const VOLLEY = 0.4;                  // energy per volley at full firepower
const NOTICE = 6;                    // s to notice an adaptation, ÷ effectiveness
const CREW_NEED = 3;                 // a full gun crew's worth of work (Roster.workers units)
const XP_PER_HIT = 6;                // weapons practice per hit, shared by the gun crew
const XP_ROTATE = 25;                // tactical-analysis practice per adaptation spotted
const SHOT_SHOWN = 0.35;             // s a shot stays on the viewer
const STARVED_AFTER = 2;             // s without power before the crew report it

export const TARGETS = ["auto", "emitters", "tractor", "regen", "core"];
const ROLE = { emitters: "emitter", tractor: "tractor", regen: "regen", core: "core" };
const ROLE_WORDS = { emitter: "their emitters", tractor: "the tractor array", regen: "a regeneration node", core: "the core", null: "the hull" };
export const STANCES = ["balanced", "defensive", "aggressive"];

export class Tactical {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.state = "idle";         // idle | hold | holding | engaged
    this.encounter = null;       // the cube this engagement is with
    this.windowUsed = false;     // the hold window has happened for this encounter
    this.holdLeft = 0;
    this.band = 0;               // weapon frequency band in use
    this.stance = "balanced";
    this.target = "auto";        // the captain's choice
    this.aimingAt = null;        // the role actually being aimed at (null: plating)
    this.time = 0;
    this.shots = [];             // { t, block | null, face, miss } — for the renderer
    this.k = 0;                  // the gun crew's effectiveness, 0..1.15
    this._volley = 1;
    this._notice = 0;
    this._offline = false;
    this._starved = 0;
    this._shields = 1;
  }

  // ---- orders ----------------------------------------------------------------
  // Each returns { ok, text } for the log.
  engage(cube) {
    if (!cube || cube.disabled || cube.mode === "lost") return { ok: false, text: "No target in range." };
    this._join(cube);
    this.windowUsed = true;
    if (this.state === "engaged") return { ok: false, text: "Already engaging." };
    this.state = "engaged";
    return { ok: true, text: "Tactical: engaging." };
  }
  holdFire(cube) {
    if (this.state === "holding") return { ok: false, text: "Weapons already holding." };
    if (cube && !cube.disabled && cube.mode !== "lost") { this._join(cube); this.windowUsed = true; }
    else if (this.state === "idle") return { ok: false, text: "Weapons aren't engaged." };
    this.state = "holding";
    return { ok: true, text: "Tactical: holding fire." };
  }
  setTarget(t) {
    if (!TARGETS.includes(t)) return { ok: false, text: `No target "${t}". Try ${TARGETS.join(", ")}.` };
    this.target = t;
    return { ok: true, text: t === "auto" ? "Tactical: choosing our own targets." : `Tactical: concentrating fire on ${ROLE_WORDS[ROLE[t]]}.` };
  }
  setStance(s) {
    if (!STANCES.includes(s)) return { ok: false, text: `No stance "${s}". Try ${STANCES.join(", ")}.` };
    this.stance = s;
    const how = { balanced: "easing off the guns if the shields need the power", defensive: "shields first, firing when we can spare it", aggressive: "full fire, whatever the shields" }[s];
    return { ok: true, text: `Tactical: ${s} — ${how}.` };
  }

  // How hard the weapons are drawing, 0..1, for the ship's power budget
  // (ShipSystems env.weaponsLoad): charged and waiting while holding, by
  // stance while firing.
  get load() {
    if (this.state === "idle") return 0;
    if (this.state !== "engaged" || !this._inRange) return 0.1;
    if (this.stance === "aggressive") return 1;
    if (this.stance === "defensive") return this._shields < 0.6 ? 0.3 : 0.7;
    return this._shields < 0.4 ? 0.5 : 1;
  }

  // The gun crew: Tactical at their stations, weighted by their weapons
  // skill, fitness and fatigue.
  crew(ship) {
    const workers = ship.roster.workers(["tactical"], "weapons");
    const sum = workers.reduce((a, x) => a + x.w, 0);
    return { workers, k: Math.min(1.15, sum / CREW_NEED) };
  }

  // ---- one tick ----------------------------------------------------------------
  // cube: the Collective's cube (or null); ship: ShipSystems; shipPos: world.
  // Returns [{ type: "say", kind, text }].
  step(dt, { cube, ship, shipPos }) {
    this.time += dt;
    this.shots = this.shots.filter((s) => this.time - s.t < SHOT_SHOWN);
    this._shields = ship.shields;
    const out = [];
    const say = (text, kind = "info") => out.push({ type: "say", kind, text });

    // The encounter: a new cube is a new one; gone, lost or disabled ends it.
    if (!cube || cube.mode === "lost" || cube.disabled || cube.mode === "dormant") {
      if (this.state !== "idle" || this.encounter) this._reset();
      return out;
    }
    if (this.encounter !== cube) this._join(cube);

    const d = Math.hypot(...cube.pos.map((x, i) => x - shipPos[i]));
    this._inRange = d <= RANGE;
    const { workers, k } = this.crew(ship);
    this.k = k;
    const keff = 0.1 + 0.9 * Math.min(1, k);

    if (this.state === "idle" && this._inRange) {
      if (!this.windowUsed) {
        this.windowUsed = true;
        this.state = "hold";
        this.holdLeft = HOLD_WINDOW;
        say("Tactical: the cube is in weapons range. Weapons ready — awaiting your orders.", "deny");
      } else {
        this.state = "engaged";
      }
    }
    if (this.state === "hold") {
      this.holdLeft -= dt;
      if (this.holdLeft <= 0) {
        this.state = "engaged";
        say("Tactical: no orders. Engaging.", "deny");
      }
    }
    if (this.state !== "engaged") return out;

    // Weapons down: nothing to fire with. Too damaged says so at once; no
    // power only once it lasts — the reactor takes a moment to ramp up when
    // the guns start drawing.
    const fp = ship.weaponsFactor();
    if (fp <= 0) {
      const damaged = ship.health.weapons < WEAPONS_OFFLINE;
      this._starved += dt;
      if (!this._offline && (damaged || this._starved > STARVED_AFTER)) {
        this._offline = true;
        say(damaged ? "Tactical: weapons are off-line — too badly damaged to fire." : "Tactical: the weapons have no power.", "deny");
      }
      return out;
    }
    this._starved = 0;
    if (this._offline) { this._offline = false; say("Tactical: weapons back on-line."); }
    if (!this._inRange) return out;

    // Noticing that the cube has adapted, and rotating.
    if (cube.resist[this.band] >= ADAPTED_AT) {
      this._notice += dt;
      if (this._notice >= NOTICE / keff) {
        const old = this.band;
        this.band = this._nextBand(cube, keff);
        this._notice = 0;
        ship.roster.credit(ship.roster.workers(["tactical"], "tactical-analysis"), "tactical-analysis", XP_ROTATE, ship.time);
        say(`Tactical: they've adapted to frequency ${old + 1} — rotating to ${this.band + 1}.`);
      }
    } else {
      this._notice = 0;
    }

    // A volley, on the stance's cadence.
    this._volley -= dt * this.load;
    if (this._volley > 0) return out;
    this._volley = VOLLEY_EVERY * (0.85 + 0.3 * this.random());
    const { face, role } = this._choose(cube, ship, shipPos);
    this.aimingAt = role;
    if (!face) return out;
    const hitP = (0.45 + 0.45 * keff) * (0.4 + 0.6 * Math.max(0, ship.sensorQuality()));
    if (this.random() >= hitP) {
      this.shots.push({ t: this.time, block: null, face, miss: true });
      return out;
    }
    const r = cube.damage(face, VOLLEY * fp, { band: this.band, role, aim: 0.3 + 0.6 * keff });
    this.shots.push({ t: this.time, block: r.blocks[0] ?? null, face, miss: false });
    if (r.dealt > 0) ship.roster.credit(workers, "weapons", XP_PER_HIT, ship.time);
    if (r.adapted) say("Tactical: our phasers are losing effect — they're adapting.");
    return out;
  }

  // What to shoot at: the captain's choice when there's one to hit, else
  // the crew's — the tractor array if it has us, the core once a face is
  // open, then the emitters cutting at us, then whatever regrows them.
  _choose(cube, ship, shipPos) {
    const bearing = cube.facesToward(shipPos);
    if (!bearing.length) return { face: null, role: null };
    const liveOn = (role) => bearing
      .map((f) => ({ f, n: cube.live(f, role).length }))
      .filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0]?.f ?? null;
    const open = bearing.find((f) => cube.breached(f)) ?? null;
    const coreLeft = cube.live(null, "core").length > 0;
    const pick = (role) =>
      role === "core" ? (open && coreLeft ? { face: open, role } : null)
        : (liveOn(role) ? { face: liveOn(role), role } : null);

    const want = ROLE[this.target];
    if (want) {
      const p = pick(want);
      if (p) return p;
      // Ordered at the core before a face is open: work a face open first.
      if (want === "core") return { face: this._weakest(cube, bearing), role: null };
    }
    return (ship.tractored && pick("tractor")) || pick("core") || pick("emitter") || pick("regen") ||
      { face: this._weakest(cube, bearing), role: null };
  }
  _weakest(cube, faces) {
    return faces.slice().sort((a, b) => cube.integrity(a) - cube.integrity(b))[0];
  }

  // The next band: a good crew picks the one the cube is least ready for; a
  // green one sometimes just grabs another.
  _nextBand(cube, keff) {
    const others = [...Array(BANDS).keys()].filter((b) => b !== this.band);
    if (this.random() < (1 - keff) * 0.5) return others[Math.floor(this.random() * others.length)];
    return others.sort((a, b) => cube.resist[a] - cube.resist[b])[0];
  }

  _join(cube) {
    if (this.encounter === cube) return;
    this._reset();
    this.encounter = cube;
  }
  _reset() {
    this.state = "idle";
    this.encounter = null;
    this.windowUsed = false;
    this.holdLeft = 0;
    this.aimingAt = null;
    this.shots = [];
    this._notice = 0;
    this._offline = false;
    this._inRange = false;
  }

  // For the alerts and the dashboard.
  status(cube) {
    return {
      state: this.state, holdLeft: Math.max(0, this.holdLeft), band: this.band, stance: this.stance,
      target: this.target, aimingAt: this.aimingAt, crew: this.k, inRange: !!this._inRange,
      effect: cube ? 1 - cube.resist[this.band] : 1, offline: this._offline,
    };
  }
}
