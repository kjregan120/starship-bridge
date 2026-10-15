// cube.js — a Collective cube: an enemy ship built of blocks.
//
// A 6×6×6 lattice of which only the shell (152 blocks) and an 8-block core
// are modelled. Each block has health and a role: plating soaks damage,
// emitters fire the cutting beam, a tractor node holds you, a regeneration
// node regrows the blocks around it, and the core — reachable only once a
// face is breached — is what keeps the thing alive. Each face's interior
// carries its own emitters, tractor and regen node, so damage is per face,
// like the ship's own hull sections: whatever faces you is what fights.
//
// Behaviour (phase 1 of docs/cube-design.md): sit at a guard post until
// something comes in range, hail, close to a holding distance, turn its
// best face toward you, cut at you with every emitter that bears, and hold
// you with the tractor beam once close enough. Overdriving the reactor
// at full impulse tears the ship free for a while. You can't fight it yet; you can run.
//
// Pure logic, like ship.js: positions are absolute world coordinates, `dt`
// real seconds, and everything the outside needs to act on comes back from
// step() as events. The flight loop turns `fire` into ship.hit() and
// `hail` into a transmission.

export const N = 6;                  // lattice cells per edge
export const EDGE = 1.5;             // u — the cube's edge length
export const CELL = EDGE / N;
export const FACES = ["px", "nx", "py", "ny", "pz", "nz"];
const NORMAL = {
  px: [1, 0, 0], nx: [-1, 0, 0], py: [0, 1, 0], ny: [0, -1, 0], pz: [0, 0, 1], nz: [0, 0, -1],
};
const SIDES = ["px", "pz", "nx", "nz"];   // the faces it can turn toward you (it yaws, never rolls)

export const SPEED = 1.7;            // u/s — a little under full impulse
export const DETECT = 60;            // u — a guard wakes when you come this close to it
export const HOLD = 5;               // u — closes to here and keeps station
export const WEAPON_RANGE = 14;      // u
export const TRACTOR_RANGE = 8;      // u
export const LOSE = 120;             // u — further than this and it's lost you
const TURN = 0.25;                   // rad/s yaw rate
const ANGLE = 0.6;                   // rad — holds its best face a little off square, so two faces bear (and show)
const HOVER = 1.2;                   // u — keeps station this far above you
const SHOT = 0.1;                    // shield units per cutting-beam shot
const SHOT_EVERY = 13;               // s, per emitter, ± a few
const BEARS = 0.25;                  // a face bears on you when its normal is this close to you
const BREAK_FREE_AFTER = 6;          // s of it to tear free
const TRACTOR_RECHARGE = 25;         // s before it can lock on again
const REGEN = 0.01;                  // hp/s a regen node restores to each damaged neighbour
const REGEN_REACH = 2;               // cells

export const HAIL = "We are the Collective. Your vessel has been scanned. Cut your engines and lower your shields. You will be joined to us. Resistance is futile.";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The lattice: every shell cell, the faces it belongs to (corners and edges
// belong to several), and the core. Roles are dealt from a seeded shuffle of
// each face's interior cells.
function buildBlocks(rand) {
  const blocks = [];
  const last = N - 1;
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) for (let z = 0; z < N; z++) {
    const faces = [];
    if (x === last) faces.push("px"); if (x === 0) faces.push("nx");
    if (y === last) faces.push("py"); if (y === 0) faces.push("ny");
    if (z === last) faces.push("pz"); if (z === 0) faces.push("nz");
    const core = [x, y, z].every((c) => c === 2 || c === 3);
    if (!faces.length && !core) continue;
    blocks.push({ cell: [x, y, z], faces, role: core ? "core" : "plate", hp: 1 });
  }
  for (const f of FACES) {
    const inner = blocks.filter((b) => b.faces.length === 1 && b.faces[0] === f);
    for (let i = inner.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [inner[i], inner[j]] = [inner[j], inner[i]];
    }
    inner.slice(0, 4).forEach((b) => (b.role = "emitter"));
    inner[4].role = "tractor";
    inner[5].role = "regen";
  }
  return blocks;
}

// A small seeded generator, so a cube's layout is the same every time.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Cube {
  // `post`: where a guard waits (null for a roamer, which starts hunting).
  constructor({ id = "cube", pos, post = null, seed = 1, random = Math.random, name = "Collective cube" }) {
    this.id = id;
    this.name = name;
    this.random = random;
    this.blocks = buildBlocks(mulberry32(seed));
    this.pos = [...pos];
    this.post = post ? [...post] : null;
    this.yaw = this.random() * Math.PI * 2;
    this.mode = post ? "dormant" : "hunting";   // dormant | hunting | lost
    this.hailed = false;
    this.tractor = false;
    this._tractorReady = 0;      // time it can lock on again
    this._strain = 0;            // seconds the ship has been straining against it
    this.time = 0;
    this.shots = [];             // recent cutting-beam shots, for the renderer: { block, t }
    for (const b of this.blocks) if (b.role === "emitter") b.next = 4 + this.random() * SHOT_EVERY * 1.5;
  }

  get disabled() { return this.blocks.every((b) => b.role !== "core" || b.hp <= 0); }

  // A face's outward normal in world space (it only ever yaws).
  normal(face) {
    const [x, y, z] = NORMAL[face];
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return [x * c + z * s, y, -x * s + z * c];
  }
  // A block's centre, world space.
  blockPos(b) {
    const l = b.cell.map((c) => (c - (N - 1) / 2) * CELL);
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return [this.pos[0] + l[0] * c + l[2] * s, this.pos[1] + l[1], this.pos[2] - l[0] * s + l[2] * c];
  }
  // Faces whose normals point toward `p` (within BEARS), most squarely first.
  facesToward(p) {
    const d = sub(p, this.pos), r = len(d) || 1;
    const u = [d[0] / r, d[1] / r, d[2] / r];
    return FACES.map((f) => ({ f, k: dot(this.normal(f), u) }))
      .filter((x) => x.k > BEARS).sort((a, b) => b.k - a.k).map((x) => x.f);
  }
  live(face, role) {
    return this.blocks.filter((b) => b.hp > 0 && b.role === role && (face == null || b.faces.includes(face)));
  }
  // How much of a face's plating is left (0..1) — below 0.4 it's breached
  // and the core behind it can be reached.
  integrity(face) {
    const bs = this.blocks.filter((b) => b.faces.includes(face));
    return bs.reduce((a, b) => a + b.hp, 0) / bs.length;
  }

  // ship: { pos, facing, mode, straining } — `straining`: the reactor
  // overdriven and the engines at full, pulling against the beam. Returns events:
  //   { type: "contact" } — it has noticed you
  //   { type: "hail", text }
  //   { type: "fire", energy, from, block } — a cutting beam hits the ship
  //   { type: "tractor", on, why? }
  //   { type: "lost" } — the encounter is over
  step(dt, ship) {
    this.time += dt;
    const ev = [];
    if (this.mode === "lost" || this.disabled) return ev;
    const toShip = sub(ship.pos, this.pos);
    const d = len(toShip);

    if (this.mode === "dormant") {
      if (d > DETECT) { this._regen(dt); return ev; }
      this.mode = "hunting";
    }
    if (!this.hailed) {
      this.hailed = true;
      ev.push({ type: "contact" }, { type: "hail", text: HAIL });
    }
    if (d > LOSE) {
      this.mode = "lost";
      if (this.tractor) { this.tractor = false; ev.push({ type: "tractor", on: false, why: "lost" }); }
      ev.push({ type: "lost" });
      return ev;
    }

    // Close to holding range, straight at you — it doesn't care about wells.
    const station = sub([ship.pos[0], ship.pos[1] + HOVER, ship.pos[2]], this.pos);
    const ds = len(station);
    if (ds > HOLD) {
      const step = Math.min(SPEED * dt, ds - HOLD);
      for (let i = 0; i < 3; i++) this.pos[i] += (station[i] / ds) * step;
    }
    this._turn(dt, ship.pos);
    this._regen(dt);

    // Cutting beams: every live emitter on a face that bears, on its own cadence.
    this.shots = this.shots.filter((s) => this.time - s.t < 0.5);
    if (d <= WEAPON_RANGE) {
      const bearing = this.facesToward(ship.pos);
      for (const b of this.blocks) {
        if (b.role !== "emitter" || b.hp <= 0) continue;
        if ((b.next -= dt) > 0) continue;
        b.next = SHOT_EVERY * (0.75 + 0.5 * this.random());
        if (!b.faces.some((f) => bearing.includes(f))) continue;
        const from = sub(this.blockPos(b), ship.pos), r = len(from) || 1;
        ev.push({ type: "fire", energy: SHOT * b.hp, from: [from[0] / r, from[1] / r, from[2] / r], block: b });
        this.shots.push({ block: b, t: this.time });
      }
    }

    // Tractor: a live node on a face that bears, in range, and recharged.
    const canHold = d <= TRACTOR_RANGE && this.time >= this._tractorReady &&
      this.facesToward(ship.pos).some((f) => this.live(f, "tractor").length);
    if (this.tractor && !canHold) {
      this.tractor = false;
      ev.push({ type: "tractor", on: false, why: d > TRACTOR_RANGE ? "range" : "node" });
    } else if (!this.tractor && canHold) {
      this.tractor = true;
      this._strain = 0;
      ev.push({ type: "tractor", on: true });
    }
    // Straining against it: enough reactor, for long enough, tears free.
    if (this.tractor) {
      this._strain = ship.straining ? this._strain + dt : Math.max(0, this._strain - dt);
      if (this._strain >= BREAK_FREE_AFTER) {
        this.tractor = false;
        this._strain = 0;
        this._tractorReady = this.time + TRACTOR_RECHARGE;
        ev.push({ type: "tractor", on: false, why: "broke free" });
      }
    }
    return ev;
  }
  get strain() { return this.tractor ? this._strain / BREAK_FREE_AFTER : 0; }

  // Swing the side with the most live emitters toward the ship.
  _turn(dt, target) {
    const d = sub(target, this.pos);
    const bearing = Math.atan2(d[0], d[2]);   // world yaw of the ship from here
    let best = SIDES[0], most = -1;
    for (const f of SIDES) {
      const n = this.live(f, "emitter").length + this.integrity(f);
      if (n > most) { most = n; best = f; }
    }
    // Yaw that points `best`'s normal at the ship.
    const [nx, , nz] = NORMAL[best];
    const want = bearing - Math.atan2(nx, nz) + ANGLE;
    let diff = ((want - this.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    this.yaw += Math.max(-TURN * dt, Math.min(TURN * dt, diff));
  }

  // Each live regen node restores the damaged (not destroyed) blocks near it.
  _regen(dt) {
    for (const r of this.blocks) {
      if (r.role !== "regen" || r.hp <= 0) continue;
      for (const b of this.blocks) {
        if (b.hp <= 0 || b.hp >= 1) continue;
        if (Math.max(...b.cell.map((c, i) => Math.abs(c - r.cell[i]))) > REGEN_REACH) continue;
        b.hp = Math.min(1, b.hp + REGEN * dt);
      }
    }
  }

  // Damage to a face (phase 2's weapons): plating takes most of it, the rest
  // falls on whatever else is on that face; once breached, some reaches the
  // core. Returns the blocks hit.
  damage(face, energy) {
    const on = this.blocks.filter((b) => b.hp > 0 && b.faces.includes(face));
    const hit = [];
    if (!on.length) return hit;
    const breached = this.integrity(face) < 0.4;
    const core = this.blocks.filter((b) => b.role === "core" && b.hp > 0);
    const n = Math.max(1, Math.round(energy * 6));
    for (let i = 0; i < n; i++) {
      const pool = breached && core.length && this.random() < 0.35 ? core : on;
      const b = pool[Math.floor(this.random() * pool.length)];
      b.hp = Math.max(0, b.hp - energy / n * 2.5);
      hit.push(b);
    }
    return hit;
  }

  snapshot() {
    return {
      id: this.id, name: this.name, pos: [...this.pos], yaw: this.yaw, mode: this.mode,
      tractor: this.tractor, strain: this.strain, disabled: this.disabled,
      hp: this.blocks.map((b) => b.hp),
    };
  }
}
