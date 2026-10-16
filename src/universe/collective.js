// collective.js — where cubes come from: a few systems the Collective holds,
// where a cube waits on guard, and the odd roamer that finds you anywhere
// outside home space. At most one cube is about at a time; it lives here
// until it has lost you (cube.js), then a roamer is gone for good and a
// guard goes back on station.
//
// Which systems are Collective space is picked from the universe itself
// (a hash of each star's id), so universe.json doesn't change and every
// career shares the same map.
//
// Pure logic: the flight loop steps it with real seconds.

import { Cube, DETECT } from "./cube.js";

export const COLLECTIVE_SYSTEMS = 3;
const MIN_FROM_HOME = 400;           // u — Collective space is nowhere near home
export const HOME_SPACE = 200;       // u — no roamer comes within this of the home star
const GUARD_WAKE = 150;              // u from a held system's star: its cube is out
const GUARD_OFFSET = 30;             // u — where the guard waits, off the star
export const ROAM_RATE = 1 / 1500;   // per second outside home space, at impulse
const ROAM_GRACE = 300;              // s into a mission before any roamer
export const ROAM_COOLDOWN = 600;    // s after any encounter ends
const ROAM_SPAWN = 50;               // u — how far off a roamer appears
const WRECK_FOR = 90;                // s a disabled cube drifts dark before it's gone

// FNV-1a: a stable number from a string.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// The stars the Collective holds: the lowest-hashing stars far from home.
export function collectiveSystems(stars, home, posOf, n = COLLECTIVE_SYSTEMS) {
  const hp = posOf(home);
  return stars
    .filter((s) => s.id !== home.id && Math.hypot(...posOf(s).map((c, i) => c - hp[i])) > MIN_FROM_HOME)
    .sort((a, b) => hash(a.id) - hash(b.id))
    .slice(0, n);
}

export class Collective {
  // stars: every star; home: the home star; posOf(obj) → world position now.
  constructor({ stars, home, posOf, random = Math.random }) {
    this.home = home;
    this.posOf = posOf;
    this.random = random;
    this.held = collectiveSystems(stars, home, posOf);
    this.heldIds = new Set(this.held.map((s) => s.id));
    this.cube = null;
    this.time = 0;
    this._quietUntil = ROAM_GRACE;
    this._guardOf = null;         // the held star the current cube guards, if any
    this.defeated = new Set();    // held systems whose guard we've disabled this mission
    this._wreckUntil = null;
  }

  // ship: { pos, facing, mode, straining } (cube.js). Returns the cube's events,
  // plus { type: "spawn", roaming } when one turns up.
  step(dt, ship) {
    this.time += dt;
    const ev = [];
    if (!this.cube) this._spawn(dt, ship, ev);
    if (!this.cube) return ev;
    for (const e of this.cube.step(dt, ship)) {
      ev.push(e);
      if (e.type === "disabled") {
        if (this._guardOf) this.defeated.add(this._guardOf.id);
        this._wreckUntil = this.time + WRECK_FOR;
      }
    }
    if (this.cube.mode === "lost" || (this._wreckUntil != null && this.time >= this._wreckUntil)) {
      this._wreckUntil = null;
      this.cube = null;
      this._guardOf = null;
      this._quietUntil = this.time + ROAM_COOLDOWN;
    }
    return ev;
  }

  _spawn(dt, ship, ev) {
    // A held system: its guard is out whenever you're near.
    for (const s of this.held) {
      if (this.defeated.has(s.id)) continue;
      const sp = this.posOf(s);
      if (Math.hypot(...sp.map((c, i) => c - ship.pos[i])) > GUARD_WAKE) continue;
      const a = (hash(s.id) % 360) * Math.PI / 180;
      const post = [sp[0] + Math.cos(a) * GUARD_OFFSET, sp[1], sp[2] + Math.sin(a) * GUARD_OFFSET];
      this.cube = new Cube({ id: `cube-${s.id}`, pos: post, post, seed: hash(s.id), random: this.random, name: `Collective cube — ${s.name}` });
      this._guardOf = s;
      ev.push({ type: "spawn", roaming: false, system: s.name });
      return;
    }
    // A roamer: rare, never in home space, never at warp, not too soon.
    if (ship.mode === "warp" || this.time < this._quietUntil) return;
    const hp = this.posOf(this.home);
    if (Math.hypot(...hp.map((c, i) => c - ship.pos[i])) < HOME_SPACE) return;
    if (this.random() >= ROAM_RATE * dt) return;
    const a = this.random() * Math.PI * 2;
    const pos = [ship.pos[0] + Math.cos(a) * ROAM_SPAWN, ship.pos[1] + (this.random() - 0.5) * 10, ship.pos[2] + Math.sin(a) * ROAM_SPAWN];
    this.cube = new Cube({ id: `cube-roamer-${Math.floor(this.time)}`, pos, seed: Math.floor(this.time), random: this.random });
    ev.push({ type: "spawn", roaming: true });
  }

  // For the alerts and the radar: the cube, how far, and how long until it
  // can fire on you (null once it can, or when it isn't coming).
  contact(shipPos) {
    const c = this.cube;
    if (!c || c.mode === "dormant" || c.disabled) return null;
    const d = Math.hypot(...c.pos.map((x, i) => x - shipPos[i]));
    return { name: c.name, pos: [...c.pos], dist: d, tractor: c.tractor, strain: c.strain };
  }
}

export { DETECT };
