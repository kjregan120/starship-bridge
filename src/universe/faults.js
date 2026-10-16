// faults.js — wear and tear: things break on their own.
//
// Every component wears with use — the reactor with the power it makes, the
// warp coils with time at warp, the emitters with what the shields soak up —
// and a department short of people at their posts keeps up with less of its
// routine maintenance, so its systems wear faster. The more worn a
// component, the likelier it is to fault: a named failure that knocks its
// health down. Some faults spread (a leak, a fire, a cascade) and keep
// eating health until the crew have put enough work into them to contain
// them; the rest just need repairing. Either way it's the maintaining
// department's crew who deal with it, through the ordinary repairs in
// ship.js — `repair <x>` puts them on it first. A component brought back
// to full health has been overhauled, and its wear starts again.
//
// Pure logic; ship.js owns an instance and steps it.

// What can go wrong, per component. `spread`: health lost per second until
// contained (0 for a fault that doesn't spread). `work`: crew work-seconds
// to contain it (ship.js counts the repair effort put on that component).
export const FAULTS = {
  reactor: [
    { name: "coolant pump seized", hit: [0.12, 0.22], spread: 0.004, work: 40 },
    { name: "plasma injector misfiring", hit: [0.15, 0.3], spread: 0, work: 0 },
    { name: "containment field fluctuating", hit: [0.1, 0.18], spread: 0.005, work: 50 },
  ],
  radiators: [
    { name: "coolant line ruptured", hit: [0.15, 0.25], spread: 0.004, work: 35 },
    { name: "radiator panel jammed", hit: [0.2, 0.35], spread: 0, work: 0 },
  ],
  impulse: [
    { name: "thrust nozzle actuator failed", hit: [0.15, 0.3], spread: 0, work: 0 },
    { name: "fuel feed leaking", hit: [0.1, 0.2], spread: 0.003, work: 30 },
  ],
  warp: [
    { name: "coil segment out of alignment", hit: [0.15, 0.3], spread: 0, work: 0 },
    { name: "field regulator cascading", hit: [0.1, 0.2], spread: 0.005, work: 45 },
  ],
  emitters: [
    { name: "emitter array burned out", hit: [0.15, 0.3], spread: 0, work: 0 },
    { name: "shield grid shorting", hit: [0.1, 0.2], spread: 0.004, work: 35 },
  ],
  life: [
    { name: "carbon dioxide scrubber clogged", hit: [0.15, 0.3], spread: 0, work: 0 },
    { name: "air recycler fire", hit: [0.1, 0.2], spread: 0.006, work: 30 },
  ],
  comms: [
    { name: "transceiver failed", hit: [0.2, 0.4], spread: 0, work: 0 },
    { name: "array power coupling arcing", hit: [0.1, 0.2], spread: 0.004, work: 25 },
  ],
  weapons: [
    { name: "phaser coupling burned out", hit: [0.15, 0.3], spread: 0, work: 0 },
    { name: "targeting array misaligned", hit: [0.2, 0.35], spread: 0, work: 0 },
    { name: "phaser capacitor bank arcing", hit: [0.1, 0.2], spread: 0.004, work: 30 },
  ],
  sensors: [
    { name: "sensor pallet misaligned", hit: [0.2, 0.4], spread: 0, work: 0 },
    { name: "processor core overheating", hit: [0.1, 0.2], spread: 0.004, work: 25 },
  ],
};

const WEAR_RATE = 1 / 1200;     // wear per second at normal use and a full watch (~20 min to fully worn)
const FAULT_RATE = 1 / 1600;    // faults per second per component, × (0.2 + wear) × use
const GRACE = 90;               // seconds into a mission before anything breaks
const GAP = 75;                 // seconds at least between faults, ship-wide
const SPREAD_FLOOR = 0.1;       // a spreading fault won't take a component below this

export class Wear {
  // `components`: the ship's component keys. `random`: () => [0, 1).
  constructor(components, random = Math.random) {
    this.random = random;
    // Ships don't leave port new: some wear already on everything.
    this.wear = Object.fromEntries(components.map((c) => [c, 0.3 * random()]));
    this.active = {};             // spreading, not yet contained: { [component]: { name, spread, work, done, at } }
    this.cause = {};              // what broke, until it's repaired: { [component]: name }
    this._next = GRACE;
  }

  // `use`: { [component]: how hard it's working, ~1 normal }. `upkeep(c)`:
  // 0..1, how well its department keeps up with maintenance. Returns the
  // faults that just happened: [{ c, fault, hit }].
  step(dt, t, health, use, upkeep) {
    const out = [];
    for (const c in this.wear) {
      this.wear[c] = Math.min(1.5, this.wear[c] + WEAR_RATE * (use[c] ?? 1) * (1.5 - 0.5 * upkeep(c)) * dt);
    }
    if (t < this._next) return out;
    for (const c in this.wear) {
      if (this.active[c] || health[c] < 0.5) continue;   // already broken
      const p = FAULT_RATE * (0.2 + this.wear[c]) * (use[c] ?? 1) * dt;
      if (this.random() >= p) continue;
      const list = FAULTS[c];
      const fault = list[Math.floor(this.random() * list.length)];
      const hit = fault.hit[0] + this.random() * (fault.hit[1] - fault.hit[0]);
      health[c] = Math.max(0, health[c] - hit);
      this.cause[c] = fault.name;
      if (fault.spread) this.active[c] = { name: fault.name, spread: fault.spread, work: fault.work, done: 0, at: t };
      out.push({ c, fault, hit });
      this._next = t + GAP;
      break;
    }
    return out;
  }

  // A spreading fault keeps eating its component until contained.
  spread(dt, health) {
    for (const [c, f] of Object.entries(this.active)) {
      if (health[c] > SPREAD_FLOOR) health[c] = Math.max(SPREAD_FLOOR, health[c] - f.spread * dt);
    }
  }

  // Crew work put on component `c` (work units × seconds). Returns true when
  // that contains its fault.
  work(c, amount) {
    const f = this.active[c];
    if (!f || amount <= 0) return false;
    f.done += amount;
    if (f.done < f.work) return false;
    delete this.active[c];
    return true;
  }

  // Back to full health: overhauled, wear starts again.
  overhauled(c) {
    if (c in this.wear) this.wear[c] = 0;
    delete this.cause[c];
  }

  snapshot() {
    return {
      wear: { ...this.wear },
      cause: { ...this.cause },
      active: Object.fromEntries(Object.entries(this.active).map(([c, f]) => [c, { name: f.name, spread: f.spread, progress: f.done / f.work }])),
    };
  }
}
