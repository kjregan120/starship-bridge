// ship.js — the ship's own condition: reactor, power, shields, hull, life
// support, crew, radiation, heat, fuel, engines, comms and sensors.
//
// Pure logic, like sim.js — no rendering, testable in node. The flight sim
// says where the ship is and what it's doing; this says what that costs it.
// Everything hangs off the reactor: it burns fuel to make power, power is
// shared out to the other systems by priority, and every system that runs
// short does its job worse. Heat is the price of running the reactor hard
// (and of sitting near stars); radiation is the price of letting the shields
// drop. Damage to one system shows up in the others through that budget.
//
// All rates are per real second — the caller passes wall-clock dt, not the
// compressed sim time warp runs on, or a warp jump would burn 40x the fuel.
// Values are 0..1 unless noted. The crew are forty individuals (crew.js),
// stepped from here; when the last of them dies the run is over.
//
// The crew also keep the ship running: whoever is at their post in the
// department that maintains a damaged component repairs it, faster the
// more of them there are and the better they know the work (_repairStep).
// Hull damage is damage control's — security and operations — and past
// patching from inside (half integrity) it needs suited crew outside,
// which the radiation has to allow.
//
// With `faults` on, things also break on their own: wear and tear, and
// named faults that the same crews have to fix (faults.js, _wearStep).

import { Roster, DEPARTMENTS } from "./crew.js";
import { skillById, levelName } from "./personnel/profile.js";
import { SHIFT_LABEL } from "./personnel/util.js";
import { Wear } from "./faults.js";

// ---- power ------------------------------------------------------------------
// Power is in units where the reactor's rated output is 100. Demand at a
// 100% setting; engines depend on what the helm is doing.
const DEMAND = { life: 15, shields: 25, weapons: 20, sensors: 10, comms: 8 };
const IMPULSE_DEMAND = 30;          // at full throttle
const WARP_DEMAND = (f) => 20 + 8 * f;
// Who gets fed first when the reactor can't cover everything.
// Weapons come after the engines: a ship that can still run beats one that
// can still shoot. Their demand is however hard Tactical is firing (env.weaponsLoad).
export const PRIORITY = ["life", "shields", "engines", "weapons", "sensors", "comms"];
export const POWER_SYSTEMS = PRIORITY;
const SETTING_MAX = 1.5;

const REACTOR_MAX = 1.2;            // overdrive ceiling for the `reactor` order
const REACTOR_RAMP = 0.25;          // output change per second
const EMERGENCY_POWER = 20;         // batteries while the reactor is scrammed
const EMERGENCY_THRUST = 10;        // of that, held for the engines — enough to back away
const SCRAM_RESTART = 30;           // seconds before a restart is attempted
const NO_FUEL_POWER = 0.25;         // what the reactor manages on an empty tank
const TRACTOR_DRAG = 0.15;          // impulse left while held in a tractor beam
export const WEAPONS_OFFLINE = 0.15; // weapons health below this and they can't fire

// ---- fuel ---------------------------------------------------------------
const FUEL_BURN = 1 / 2400;         // per second at 100 units of output (40 min)
const FUEL_COLLECT = 0.002;         // per second per unit of stellar heat flux

// ---- heat ---------------------------------------------------------------
const HEAT_REACTOR = 0.012;         // per second at 100 units of output
const HEAT_OVERDRIVE = 0.06;        // extra, per unit of output past rated
const HEAT_STELLAR = 0.003;         // per unit of heat flux, halved by full shields
const RADIATOR = 0.03;              // shed per second, × heat × radiator health
const THROTTLE_AT = 0.75;           // reactor derates above this
const DAMAGE_AT = 0.9;              // components cook above this
const SCRAM_AT = 1.0;

// ---- shields & radiation --------------------------------------------------
const SHIELD_RECHARGE = 0.03;       // per second at 25 units of shield power
const SHIELD_RAD_DRAIN = 0.004;     // per second per unit of radiation flux
const RAD_DOSE = 0.0005;            // Sv per second per unit of flux, unshielded
const SHIELD_BLOCK = 0.9;           // fraction of radiation full shields stop

// ---- life support & crew --------------------------------------------------
const O2_USE = 0.0015, CO2_MAKE = 0.0015, SCRUB = 0.005;
const REPRESSURIZE = 0.002;
const BREACH_AT = 0.3;              // a hull section below this leaks
const EXPOSED_AT = 0.5;             // hull below this lets damage through to what's inside

export const HULL_SECTIONS = ["fore", "aft", "port", "starboard"];
// Which components sit in which part of the hull — a hit on a side can
// knock out what's there. Matches the schematic in Science.jsx.
const SECTION_COMPONENTS = {
  fore: ["sensors", "comms", "weapons"],
  aft: ["reactor", "impulse", "radiators"],
  port: ["warp", "emitters"],
  starboard: ["warp", "life"],
};

// ---- repairs ----------------------------------------------------------------
// Who maintains each component, and with what skill. Data, like the
// personnel catalogs: a new component needs an entry here.
export const MAINTENANCE = {
  reactor:   { dept: "engineering", skill: "reactor-ops",     label: "Reactor" },
  radiators: { dept: "engineering", skill: "thermal-systems", label: "Radiators" },
  impulse:   { dept: "engineering", skill: "reactor-ops",     label: "Impulse drive" },
  warp:      { dept: "engineering", skill: "warp-theory",     label: "Warp coils" },
  emitters:  { dept: "tactical",    skill: "shield-ops",      label: "Shield emitters" },
  life:      { dept: "operations",  skill: "life-support",    label: "Life support" },
  comms:     { dept: "comms",       skill: "signals",         label: "Comms array" },
  sensors:   { dept: "science",     skill: "sensor-analysis", label: "Sensors" },
  weapons:   { dept: "tactical",    skill: "weapons",         label: "Weapons" },
};
const DAMAGE_CONTROL = ["security", "operations"];
const REPAIR_RATE = 0.0006;         // component health per second per unit of work
const HULL_REPAIR = 0.0006;         // hull per second per unit of work
const REBUILD_AT = 0.15;            // below this a component is rebuilt, at REBUILD_SLOW
const REBUILD_SLOW = 0.3;
const FOCUS_WEIGHT = 4;             // `repair <x>` puts this much more effort on x
const EVA_LEVEL = 2;                // Qualified in EVA to work outside
const EVA_MAX_SVH = 0.5;            // and no more radiation than this (Sv/h) outside
const XP_PER_REPAIR = 60;           // practice in the job's skill per unit of health restored
const XP_DC_PER_REPAIR = 20;        // and in damage control
// Spare parts (brought back by away teams — missions.js) make component
// repairs go faster, and are used up doing it.
const PARTS_BOOST = 1.75;
const PARTS_PER_HEALTH = 2;         // parts used per whole component restored

const HISTORY_LEN = 120;            // samples, one a second
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export class ShipSystems {
  constructor(opts = {}) {
    this.onEvent = opts.onEvent ?? (() => {});
    this.random = opts.random ?? Math.random;
    // The crew: from the career's personnel files when there is one
    // (opts.profiles, opts.day), else a fresh crew from opts.seed.
    this.roster = new Roster(opts.profiles ?? opts.seed, opts.day, opts.hour);
    this.time = 0;           // mission time, real seconds
    // Component health — 0 is destroyed. The crew repair it (_repairStep).
    this.health = {
      reactor: 1, radiators: 1, emitters: 1, life: 1,
      impulse: 1, warp: 1, comms: 1, sensors: 1, weapons: 1,
    };
    this.hull = { fore: 1, aft: 1, port: 1, starboard: 1 };
    // Wear and tear, and the faults it brings (faults.js) — off unless asked
    // for, so a test ship only breaks when the test breaks it.
    this.wear = opts.faults ? new Wear(Object.keys(this.health), this.random) : null;

    this.reactor = { setting: 1, output: 60, capacity: 100, scrammed: false, restartIn: 0 };
    this.settings = { life: 1, shields: 1, engines: 1, weapons: 1, sensors: 1, comms: 1 };
    this.power = { demand: {}, alloc: {}, sat: {}, total: 0 };

    this.fuel = 0.85;
    // What away teams have brought back: spare parts for repairs, and
    // science (readings and samples) — see addStores().
    this.stores = { parts: 0, science: 0 };
    this.heat = 0.2;
    this.shields = 1;
    // o2 is the mix, pressure the cabin; what the crew can actually breathe
    // is both together (breathable).
    this.atmo = { o2: 1, co2: 0.05, pressure: 1, breathable: 1 };
    this.crew = 1;
    this.dose = 0;           // Sv, accumulated — never goes down
    this.doseRate = 0;       // Sv/s right now
    this.interference = 0;   // comms
    this.noise = 0;          // sensors
    this.flux = { heat: 0, rad: 0, source: null };
    // Hazards on their way to the ship that something outside it is tracking
    // (coronal mass ejections — cme.js, set by the flight loop): { kind, source, eta, energy }.
    this.incoming = [];
    // Held in a tractor beam (a Collective cube's — cube.js, set by the
    // flight loop): no warp, and the impulse engines barely move the ship.
    this.tractored = false;
    this.harm = {};          // what's hurting the crew right now, by cause (health/s)
    this.crewLost = false;
    // How fast key readings are moving (per second, smoothed) — for the
    // "fails in 0:40" countdowns. See eta().
    this.rate = { shields: 0, crew: 0, hull: 0, heat: 0, breathable: 0, pressure: 0 };
    this._prev = null;
    // Wall-clock stamps of the moments the alarms and viewscreen react to —
    // consumers compare against the last stamp they saw.
    this.cues = { hit: 0, shieldsDown: 0, breach: 0, scram: 0, restart: 0, crewLost: 0, casualty: 0, fault: 0 };

    // What the flight sim should be told: how much of its thrust is really
    // there, the highest warp factor the coils will hold, and why warp is
    // off-line if it is (null when it isn't).
    this.impulseFactor = 1;
    this.warpMax = 3;
    this.warpInhibit = null;

    // Repairs under way: { [component or hull section]: { rate (per s), crew, blocked } },
    // and the one the captain wants first (`repair <x>`), or null.
    this.repairs = {};
    this.repairFocus = null;
    this._damaged = new Set();

    this.history = { shields: [], hull: [], heat: [], fuel: [], crew: [], power: [], o2: [], dose: [] };
    this._sampleIn = 0;
    this._alerts = {};
    this._starveT = 0;
  }

  // ---------------- orders ----------------
  setReactor(frac) {
    this.reactor.setting = Math.max(0, Math.min(REACTOR_MAX, frac));
    return this.reactor.setting;
  }
  setPower(system, frac) {
    if (!(system in this.settings)) return null;
    this.settings[system] = Math.max(0, Math.min(SETTING_MAX, frac));
    return this.settings[system];
  }
  resetPower() { for (const k in this.settings) this.settings[k] = 1; }
  // An away team's haul (missions.js payout): fuel straight into the tanks,
  // parts and science into stores.
  addStores({ fuel = 0, parts = 0, science = 0 } = {}) {
    this.fuel = Math.min(1, this.fuel + fuel);
    this.stores.parts += parts;
    this.stores.science += science;
  }
  // The transporter can't send through shields: they drop to nothing and
  // have to build back up.
  // Lowered on purpose, so not an alarm: the trend doesn't read it as
  // shields falling, and there's no "below 25%" warning for it.
  dropShieldsForTransport() {
    this.shields = 0;
    if (this._prev) this._prev.shields = 0;
    this.rate.shields = Math.max(0, this.rate.shields);
    this._alerts.shields = true;
  }
  // Put repair effort on one component or hull section first; null for
  // the default (everything, worst-damaged weighted most).
  setRepairFocus(target) {
    if (target != null && !(target in MAINTENANCE) && !HULL_SECTIONS.includes(target)) return false;
    this.repairFocus = target;
    return true;
  }

  // ---------------- derived readouts ----------------
  hullIntegrity() {
    return HULL_SECTIONS.reduce((s, k) => s + this.hull[k], 0) / HULL_SECTIONS.length;
  }
  breached() { return HULL_SECTIONS.filter((k) => this.hull[k] < BREACH_AT); }
  // How hard a department is working right now, as a multiplier on what
  // its people learn on watch (crew.js): fighting a problem teaches more
  // than a quiet watch.
  strain(dept) {
    const hurt = (c) => this.health[c] < 0.9;
    switch (dept) {
      case "engineering": return this.reactor.scrammed || this.heat > THROTTLE_AT || ["reactor", "radiators", "impulse", "warp"].some(hurt) ? 3 : 1;
      case "tactical": return (this.shields < 0.5 && this.flux.rad > 0.5) || hurt("emitters") ? 3 : 1;
      case "operations": return this.atmo.breathable < 0.8 || this.breached().length || hurt("life") ? 3 : 1;
      case "medical": {
        const patients = this.roster.crew.filter((m) => m.health > 0 && m.location === "sickbay").length;
        return 1 + Math.min(2, patients * 0.5);
      }
      case "science": return this.noise > 0.3 || hurt("sensors") ? 2 : 1;
      case "comms": return this.interference > 0.3 || hurt("comms") ? 2 : 1;
      case "helm": return this.flux.heat + this.flux.rad > 3 ? 2 : 1;
      case "security": return this.breached().length ? 2 : 1;
      default: return 1;
    }
  }

  // How well comms and sensors are working, all things considered.
  // What the weapons can put out, 0..1.5: their health, the power they're
  // getting, and the `power weapons` setting. Nothing below WEAPONS_OFFLINE.
  weaponsFactor() {
    if (this.health.weapons < WEAPONS_OFFLINE) return 0;
    return this.health.weapons * Math.min(1, this.power.sat.weapons ?? 1) * Math.min(SETTING_MAX, this.settings.weapons);
  }
  commsQuality() { return this.health.comms * (this.power.sat.comms ?? 1) * (1 - this.interference) * this.roster.factor("comms"); }
  sensorQuality() { return this.health.sensors * (this.power.sat.sensors ?? 1) * (1 - this.noise) * this.roster.factor("science"); }

  // ---------------- simulation ----------------
  // env: { mode: "impulse"|"warp", throttle, warpFactor, flux: {heat, rad} }
  step(dt, env) {
    if (dt <= 0) return;
    this.time += dt;
    this.flux = env.flux ?? { heat: 0, rad: 0, source: null };
    this._reactorStep(dt, env);
    this._powerStep(dt, env);
    this._shieldStep(dt);
    this._heatStep(dt);
    this._lifeStep(dt);
    this._engineStep(dt, env);
    this._signalStep(dt);
    this._exposureStep(dt);
    this._wearStep(dt, env);
    this._repairStep(dt);
    this._trendStep(dt);
    this._alertsStep();
    this._sample(dt);
  }

  _reactorStep(dt, env) {
    const r = this.reactor;
    if (r.scrammed) {
      r.restartIn -= dt;
      if (r.restartIn <= 0) {
        if (this.heat < 0.7) {
          r.scrammed = false;
          this.cues.restart = Date.now();
          this.onEvent("info", "Reactor restart — core stable, output coming back up.");
        } else {
          r.restartIn = 10;
        }
      }
    }
    if (!r.scrammed && this.heat >= SCRAM_AT) {
      // Short-handed engineering takes longer to bring the core back.
      r.scrammed = true; r.restartIn = SCRAM_RESTART / (0.5 + 0.5 * this.roster.staffing("engineering")); r.output = 0;
      this.cues.scram = Date.now();
      this.onEvent("deny", "REACTOR SCRAM — thermal limit exceeded. Emergency power only.");
    }

    // What the reactor can deliver right now.
    const thermal = this.heat > THROTTLE_AT ? clamp01(1 - (this.heat - THROTTLE_AT) * 2) : 1;
    const fuelCap = this.fuel > 0 ? 1 : NO_FUEL_POWER;
    r.capacity = r.scrammed
      ? EMERGENCY_POWER
      : 100 * r.setting * this.health.reactor * thermal * fuelCap * this.roster.factor("engineering");
  }

  _powerStep(dt, env) {
    const s = this.settings;
    const engineBase = env.mode === "warp" ? WARP_DEMAND(env.warpFactor ?? 2) : IMPULSE_DEMAND * (env.throttle ?? 0);
    const demand = {
      life: DEMAND.life * s.life,
      shields: DEMAND.shields * s.shields,
      weapons: DEMAND.weapons * s.weapons * (env.weaponsLoad ?? 0),
      engines: engineBase * Math.min(1, s.engines),
      sensors: DEMAND.sensors * s.sensors,
      comms: DEMAND.comms * s.comms,
    };
    const want = PRIORITY.reduce((a, k) => a + demand[k], 0);

    // The reactor follows load, ramping, up to its capacity. Batteries
    // don't ramp — they're there the instant it scrams.
    const r = this.reactor;
    const target = Math.min(want, r.capacity);
    r.output = r.scrammed
      ? target
      : r.output + Math.max(-REACTOR_RAMP * 100 * dt, Math.min(REACTOR_RAMP * 100 * dt, target - r.output));
    r.output = Math.min(r.output, r.capacity);

    // On batteries the engines go first (up to a small reserve) — a crew
    // that can't back away from what scrammed the reactor is a dead crew.
    const order = r.scrammed ? ["engines", ...PRIORITY.filter((k) => k !== "engines")] : PRIORITY;
    let left = r.output;
    const alloc = {}, sat = {};
    for (const k of order) {
      alloc[k] = Math.min(demand[k], left, r.scrammed && k === "engines" ? EMERGENCY_THRUST : Infinity);
      left -= alloc[k];
      sat[k] = demand[k] > 0 ? alloc[k] / demand[k] : 1;
    }
    // Engines are judged against what full power would be, not what the
    // `power engines` setting asked for — halving it should halve thrust.
    sat.engines = engineBase > 0 ? alloc.engines / engineBase : 1;
    this.power = { demand, alloc, sat, total: r.output, want };

    if (!r.scrammed) {
      const fuelUse = (r.output / 100) * FUEL_BURN;
      const collect = this.flux.heat * FUEL_COLLECT;
      this.fuel = clamp01(this.fuel - fuelUse * dt + collect * dt);
    }
  }

  _shieldStep(dt) {
    const recharge = SHIELD_RECHARGE * ((this.power.alloc.shields ?? 0) / DEMAND.shields) * this.health.emitters * this.roster.factor("tactical");
    const drain = SHIELD_RAD_DRAIN * this.flux.rad;
    const before = this.shields;
    this.shields = clamp01(this.shields + (recharge - drain) * dt);
    if (before >= 0.02 && this.shields < 0.02) this.cues.shieldsDown = Date.now();

    const block = SHIELD_BLOCK * this.shields;
    this.doseRate = RAD_DOSE * this.flux.rad * (1 - block);

    // Close enough to a star to strip the shields: the hull takes it next.
    if (this.flux.rad > 6 && this.shields < 0.05) {
      const dmg = 0.0002 * (this.flux.rad - 6) * dt;
      for (const k of HULL_SECTIONS) this.hull[k] = clamp01(this.hull[k] - dmg);
    }
  }

  _heatStep(dt) {
    const out = this.reactor.scrammed ? 0 : this.reactor.output / 100;
    const gain =
      out * HEAT_REACTOR +
      Math.max(0, out - 1) * HEAT_OVERDRIVE +
      this.flux.heat * HEAT_STELLAR * (1 - 0.5 * this.shields);
    const shed = RADIATOR * this.health.radiators * this.heat;
    this.heat = Math.max(0, Math.min(1.2, this.heat + (gain - shed) * dt));

    if (this.heat > DAMAGE_AT) {
      const cook = (this.heat - DAMAGE_AT) * 0.02 * dt;
      this.health.radiators = clamp01(this.health.radiators - cook);
      this.health.reactor = clamp01(this.health.reactor - cook * 0.5);
    }
  }

  _lifeStep(dt) {
    const a = this.atmo;
    const eff = this.health.life * (this.power.sat.life ?? 1) * this.roster.factor("operations");
    a.o2 = clamp01(a.o2 - O2_USE * dt + (a.o2 < 1 ? SCRUB * eff * dt : 0));
    a.co2 = clamp01(a.co2 + CO2_MAKE * dt - SCRUB * eff * Math.min(1, a.co2 * 10) * dt);
    const breaches = this.breached();
    const leak = breaches.reduce((s, k) => s + (BREACH_AT - this.hull[k]) * 0.02, 0);
    a.pressure = clamp01(a.pressure - leak * dt + (breaches.length ? 0 : REPRESSURIZE * eff * dt));
    a.breathable = a.o2 * a.pressure;

    const h = {};
    if (a.breathable < 0.6) h.oxygen = (0.6 - a.breathable) * 0.03;
    if (a.co2 > 0.4) h.co2 = (a.co2 - 0.4) * 0.01;
    if (a.pressure < 0.5) h.pressure = (0.5 - a.pressure) * 0.01; // decompression on top of hypoxia
    if (this.heat > 0.85) h.heat = (this.heat - 0.85) * 0.02;
    if (this.doseRate > 0.002) h.radiation = (this.doseRate - 0.002) * 0.5; // acute exposure
    // Ship-wide conditions; crew.js works out what each person actually
    // gets from where they are (radiation and heat vary by location).
    this.harm = h;
    if (this.crewLost) return;
    const before = this.roster.events.length;
    this.roster.step(dt, this, this.time);
    for (const e of this.roster.events.slice(before)) {
      const m = this.roster.crew.find((x) => x.id === e.id);
      if (e.kind === "death") {
        this.cues.casualty = Date.now();
        this.onEvent("deny", `Casualty — ${m.rank} ${m.name}, ${m.role}.`);
      } else if (e.kind === "level") {
        this.onEvent("info", `${m.rank} ${m.name} has reached ${levelName(e.level)} in ${skillById[e.skill].label}.`);
      } else if (e.kind === "watch") {
        this.onEvent("info", this.roster.allHands
          ? `${SHIFT_LABEL[e.shift]} watch — all hands remain at stations.`
          : `${SHIFT_LABEL[e.shift]} watch has the ship.`);
      }
    }
    this.crew = this.roster.crew.reduce((a, m) => a + m.health, 0) / this.roster.total;
    this.dose = this.roster.alive().reduce((a, m) => Math.max(a, m.dose), 0);
    if (!this.roster.alive().length) {
      this.crewLost = true;
      this.cues.crewLost = Date.now();
      this.onEvent("deny", "All hands lost.");
    }
  }

  _engineStep(dt, env) {
    this.impulseFactor = this.health.impulse * Math.min(1, this.power.sat.engines) * this.roster.factor("helm") *
      (this.tractored ? TRACTOR_DRAG : 1);
    const w = this.health.warp;
    this.warpMax = w > 0.7 ? 3 : w > 0.5 ? 2 : w > 0.35 ? 1 : 0;
    this.warpInhibit =
      this.tractored ? "held by tractor beam" :
      this.reactor.scrammed ? "reactor scrammed" :
      this.warpMax === 0 ? "warp coils damaged" :
      this.fuel < 0.02 ? "fuel exhausted" :
      null;
    // At warp, a field starved of power for more than a moment collapses.
    if (env.mode === "warp" && this.power.sat.engines < 0.5) this._starveT += dt;
    else this._starveT = 0;
    this.warpCollapse = this._starveT > 2 || (env.mode === "warp" && this.warpInhibit);
  }

  // A section with its hull gone no longer protects what's in it: the
  // components there degrade, faster with radiation coming through.
  _exposureStep(dt) {
    for (const k of HULL_SECTIONS) {
      const gap = EXPOSED_AT - this.hull[k];
      if (gap <= 0) continue;
      const wear = gap * 0.01 * (1 + this.flux.rad * 0.1) * dt;
      for (const c of SECTION_COMPONENTS[k]) this.health[c] = clamp01(this.health[c] - wear);
    }
  }

  // Wear and tear. How hard each component is working sets how fast it
  // wears; its department's staffing, how well routine maintenance keeps
  // up. Worn components fault (faults.js), and a spreading fault keeps
  // eating health until the repair crews have contained it (_repairStep).
  _wearStep(dt, env) {
    if (!this.wear || this.crewLost) return;
    const warp = env.mode === "warp";
    const out = this.reactor.scrammed ? 0 : this.reactor.output / 100;
    const use = {
      reactor: 0.3 + out + Math.max(0, out - 1) * 3,
      radiators: 0.3 + this.heat * 1.2,
      impulse: warp ? 0.2 : 0.2 + (env.throttle ?? 0),
      warp: warp ? 0.5 + 0.25 * (env.warpFactor ?? 2) : 0.1,
      emitters: 0.3 + 0.5 * this.settings.shields + Math.min(1, this.flux.rad * 0.1),
      life: 0.8,
      comms: 0.4 + 0.4 * this.settings.comms,
      sensors: 0.4 + 0.4 * this.settings.sensors,
      weapons: 0.2 + 0.8 * (env.weaponsLoad ?? 0),
    };
    const upkeep = (c) => Math.min(1, this.roster.staffing(MAINTENANCE[c].dept));
    for (const { c, fault } of this.wear.step(dt, this.time, this.health, use, upkeep)) {
      const { dept, label } = MAINTENANCE[c];
      const crew = this.roster.workers([dept], MAINTENANCE[c].skill).length;
      this._damaged.add(c);
      this.cues.fault = Date.now();
      this.onEvent("deny", `Fault — ${label.toLowerCase()}: ${fault.name}.` +
        (fault.spread ? " Spreading until contained." : "") +
        (crew ? ` ${DEPARTMENTS[dept].label} responding.` : ` No ${DEPARTMENTS[dept].label.toLowerCase()} crew at their posts.`));
    }
    this.wear.spread(dt, this.health);
  }

  // The crew at work on the damage. Each department splits its effort
  // over the components it maintains, worst first (and the captain's
  // focus most); damage control does the same over the hull. Restoring
  // health is practice in the job's skill, shared among whoever did it.
  _repairStep(dt) {
    if (this.crewLost) return;
    const t = this.time;
    const repairs = {};
    const weight = (key, health) => (1 - health) * (this.repairFocus === key ? FOCUS_WEIGHT : 1);

    // Components, by department.
    const byDept = {};
    for (const [c, m] of Object.entries(MAINTENANCE)) {
      if (this.health[c] < 0.999) (byDept[m.dept] ??= []).push(c);
    }
    for (const [dept, comps] of Object.entries(byDept)) {
      const total = comps.reduce((a, c) => a + weight(c, this.health[c]), 0);
      for (const c of comps) {
        const { skill } = MAINTENANCE[c];
        const crew = this.roster.workers([dept], skill);
        const units = crew.reduce((a, x) => a + x.w, 0) * (weight(c, this.health[c]) / total);
        const parts = this.stores.parts > 0 ? PARTS_BOOST : 1;
        const rate = REPAIR_RATE * units * parts * (this.health[c] < REBUILD_AT ? REBUILD_SLOW : 1);
        const gain = Math.min(1 - this.health[c], rate * dt);
        this.health[c] += gain;
        if (parts > 1) this.stores.parts = Math.max(0, this.stores.parts - gain * PARTS_PER_HEALTH);
        repairs[c] = { rate, crew: crew.length, blocked: crew.length ? null : `no ${DEPARTMENTS[dept].label.toLowerCase()} crew at their posts` };
        // A spreading fault outruns the repairs until the crew contain it.
        const spreading = this.wear?.active[c];
        if (spreading) {
          repairs[c].fault = spreading.name;
          repairs[c].containing = Math.min(1, spreading.done / spreading.work);
          if (this.wear.work(c, units * dt)) this.onEvent("info", `${MAINTENANCE[c].label}: ${spreading.name} — contained.`);
        } else if (this.wear?.cause[c]) {
          repairs[c].fault = this.wear.cause[c];
        }
        this._repaired(c, MAINTENANCE[c].label);
        this.roster.credit(crew, skill, gain * XP_PER_REPAIR, t);
        this.roster.credit(crew, "damage-control", gain * XP_DC_PER_REPAIR, t);
      }
    }

    // The hull: patched from inside up to EXPOSED_AT, past that only by
    // suited crew outside, and only when the radiation outside allows it.
    const hullDamaged = HULL_SECTIONS.filter((k) => this.hull[k] < 0.999);
    if (hullDamaged.length) {
      const crew = this.roster.workers(DAMAGE_CONTROL, "damage-control");
      const eva = crew.filter(({ m }) => this.roster.levelIn(m, "eva") >= EVA_LEVEL);
      const evaSafe = this.doseRate * 3600 < EVA_MAX_SVH;
      const total = hullDamaged.reduce((a, k) => a + weight(k, this.hull[k]), 0);
      for (const k of hullDamaged) {
        const share = weight(k, this.hull[k]) / total;
        const outside = this.hull[k] >= EXPOSED_AT;
        const party = outside ? (evaSafe ? eva : []) : crew;
        const blocked =
          !crew.length ? "no damage control crew at their posts" :
          outside && !eva.length ? "needs EVA-qualified crew" :
          outside && !evaSafe ? "too much radiation for EVA" : null;
        // Patching a section open to space is work in pressure suits.
        const units = party.reduce((a, x) => a + x.w, 0) * share * (this.hull[k] < BREACH_AT ? 0.5 : 1);
        const rate = HULL_REPAIR * units;
        const before = this.hull[k];
        const gain = Math.min(1 - before, rate * dt);
        this.hull[k] += gain;
        repairs[k] = { rate, crew: party.length, blocked };
        if (before < BREACH_AT && this.hull[k] >= BREACH_AT) this.onEvent("info", `Breach sealed — ${k} section.`);
        this._repaired(k, `${k[0].toUpperCase()}${k.slice(1)} hull`);
        this.roster.credit(party, outside ? "eva" : "damage-control", gain * XP_PER_REPAIR, t);
      }
    }
    this.repairs = repairs;
    if (this.repairFocus && !(this.repairFocus in repairs)) this.repairFocus = null;
  }
  // Report a repair finished — for anything that was really damaged.
  _repaired(key, label) {
    const v = key in this.health ? this.health[key] : this.hull[key];
    if (v >= 0.999) this.wear?.overhauled(key);
    if (v < 0.9) this._damaged.add(key);
    else if (v >= 0.999 && this._damaged.delete(key)) this.onEvent("info", `Repairs complete — ${label.toLowerCase()} restored.`);
  }

  _trendNow() {
    return {
      shields: this.shields, crew: this.crew, hull: Math.min(...HULL_SECTIONS.map((k) => this.hull[k])),
      heat: this.heat, breathable: this.atmo.breathable, pressure: this.atmo.pressure,
    };
  }
  _trendStep(dt) {
    const now = this._trendNow();
    if (this._prev) {
      const k = 1 - Math.exp(-dt / 3);
      for (const key in now) this.rate[key] += ((now[key] - this._prev[key]) / dt - this.rate[key]) * k;
    }
    this._prev = now;
  }

  // Seconds until `key` (a this.rate key) hits bottom at its current rate,
  // or null if it isn't heading there. Heat counts up to the scram line.
  eta(key) {
    const r = this.rate[key];
    const v = this._trendNow()[key];
    if (key === "heat") return r > 1e-4 && v < SCRAM_AT ? (SCRAM_AT - v) / r : null;
    return r < -1e-4 && v > 0 ? v / -r : null;
  }

  _signalStep(dt) {
    // Stellar wind keeps a floor of static under everything near a star.
    // Spikes from hits fade back down to it.
    const floor = Math.min(0.5, this.flux.rad * 0.03);
    this.interference = Math.max(floor, this.interference - 0.02 * dt);
    this.noise = Math.max(floor * 0.7, this.noise - 0.02 * dt);
  }

  // A hit from outside — the hook step 4's ejecta will call. `energy` is in
  // shield units (1 = a full shield's worth). `from` is the unit direction
  // from the ship toward the source, `facing` the ship's nose; together they
  // pick which side takes it. Returns what happened, for the log.
  hit({ energy = 0, from = null, facing = [0, 0, 1], radiation = 0, heat = 0, static: stat = 0 }) {
    const side = from ? sectionFacing(from, facing) : HULL_SECTIONS[Math.floor(Math.random() * 4)];
    const absorbed = Math.min(this.shields, energy);
    this.shields -= absorbed;
    const through = energy - absorbed;
    this.health.emitters = clamp01(this.health.emitters - absorbed * 0.05);
    this.heat = Math.min(1.2, this.heat + heat + absorbed * 0.08);

    let hullDmg = 0;
    const damaged = [];
    if (through > 0) {
      hullDmg = through * 0.6;
      this.hull[side] = clamp01(this.hull[side] - hullDmg);
      for (const c of SECTION_COMPONENTS[side]) {
        if (Math.random() < through) {
          this.health[c] = clamp01(this.health[c] - through * (0.2 + 0.3 * Math.random()));
          damaged.push(c);
        }
      }
    }
    for (const m of this.roster.alive()) m.dose += radiation * (1 - SHIELD_BLOCK * this.shields);
    this.interference = clamp01(this.interference + stat);
    this.noise = clamp01(this.noise + stat * 0.8);
    this._lastHit = { side, at: Date.now(), through: through > 0 };
    this.cues.hit = Date.now();
    return { side, absorbed, through, hullDmg, damaged };
  }

  // Threshold warnings to the ship's log, once per crossing (with a little
  // hysteresis so a value hovering on the line doesn't spam).
  _alertsStep() {
    const a = (key, on, off, msg, kind = "deny") => {
      if (!this._alerts[key] && on) { this._alerts[key] = true; this.onEvent(kind, msg); }
      else if (this._alerts[key] && off) this._alerts[key] = false;
    };
    a("shields", this.shields < 0.25, this.shields > 0.4, "Shields below 25%.");
    a("heat", this.heat > THROTTLE_AT, this.heat < 0.65, "Heat above 75% — reactor derating. Ease off or move away from the star.");
    a("fuel", this.fuel < 0.15, this.fuel > 0.25, "Fuel below 15%. Collect near a star.");
    a("dose", this.dose > 1, false, "Crew radiation dose past 1 Sv — expect radiation sickness.");
    a("o2", this.atmo.o2 < 0.6, this.atmo.o2 > 0.7, "Oxygen low.");
    a("pressure", this.atmo.pressure < 0.7, this.atmo.pressure > 0.8, "Cabin pressure dropping.");
    for (const k of HULL_SECTIONS) {
      if (!this._alerts[`breach-${k}`] && this.hull[k] < BREACH_AT) this.cues.breach = Date.now();
      a(`breach-${k}`, this.hull[k] < BREACH_AT, this.hull[k] >= BREACH_AT, `Hull breach — ${k} section.`);
    }
    a("brownout", this.power.want > this.reactor.capacity + 1 && !this.reactor.scrammed, this.power.want <= this.reactor.capacity,
      "Power demand exceeds reactor output — lower-priority systems shedding load.", "info");
  }

  _sample(dt) {
    this._sampleIn -= dt;
    if (this._sampleIn > 0) return;
    this._sampleIn = 1;
    const push = (k, v) => { const h = this.history[k]; h.push(v); if (h.length > HISTORY_LEN) h.shift(); };
    push("shields", this.shields);
    push("hull", this.hullIntegrity());
    push("heat", this.heat);
    push("fuel", this.fuel);
    push("crew", this.roster.alive().length / this.roster.total);
    push("power", this.reactor.output / 100);
    push("o2", this.atmo.breathable);
    push("dose", this.dose);
  }

  // A plain copy for the UI — the store holds this, not the live object.
  snapshot() {
    return {
      health: { ...this.health },
      hull: { ...this.hull },
      hullIntegrity: this.hullIntegrity(),
      breached: this.breached(),
      reactor: { ...this.reactor },
      settings: { ...this.settings },
      power: {
        total: this.power.total, want: this.power.want,
        demand: { ...this.power.demand }, alloc: { ...this.power.alloc }, sat: { ...this.power.sat },
      },
      fuel: this.fuel, heat: this.heat, shields: this.shields, stores: { ...this.stores },
      atmo: { ...this.atmo }, crew: this.crew, roster: this.roster.snapshot(),
      dose: this.dose, doseRate: this.doseRate,
      interference: this.interference, noise: this.noise,
      commsQuality: this.commsQuality(), sensorQuality: this.sensorQuality(),
      flux: { ...this.flux }, incoming: this.incoming.map((x) => ({ ...x })),
      impulseFactor: this.impulseFactor, warpMax: this.warpMax, warpInhibit: this.warpInhibit, tractored: this.tractored,
      lastHit: this._lastHit ? { ...this._lastHit } : null,
      repairs: Object.fromEntries(Object.entries(this.repairs).map(([k, v]) => [k, { ...v }])),
      repairFocus: this.repairFocus,
      faults: this.wear?.snapshot() ?? null,
      harm: { ...this.harm }, crewLost: this.crewLost, cues: { ...this.cues },
      history: Object.fromEntries(Object.entries(this.history).map(([k, v]) => [k, v.slice()])),
    };
  }
}

// Which hull section faces `from` (unit vector toward the source), given the
// ship's nose. Port is to the left of the nose looking down from galactic
// up — sim.js turns starboard with a positive yaw, which swings +Z to -X.
export function sectionFacing(from, facing) {
  const fwd = [facing[0], facing[2]];
  const port = [facing[2], -facing[0]];
  const a = Math.atan2(from[0] * port[0] + from[2] * port[1], from[0] * fwd[0] + from[2] * fwd[1]);
  const deg = (a * 180) / Math.PI;
  if (Math.abs(deg) <= 45) return "fore";
  if (Math.abs(deg) >= 135) return "aft";
  return deg > 0 ? "port" : "starboard";
}

// Stellar heat and radiation reaching the ship, from every source in range.
// 1.0 is roughly sitting at a G star's inner planets (~12u). Black holes and
// pulsars are mostly radiation; stars are both.
const STAR_LUMINOSITY = {
  "B-type blue": 8, "A-type white": 3, "F-type yellow-white": 1.6,
  "G-type main sequence": 1, "K-type orange": 0.55, "M-type red dwarf": 0.25,
};
const FLUX_REF = 12;
const FLUX_RANGE = 250;
const FLUX_MAX = 40;
export function fluxAt(pos, sources, posOf) {
  let heat = 0, rad = 0, source = null, top = 0;
  for (const o of sources) {
    let h, r;
    if (o.type === "star") h = r = STAR_LUMINOSITY[o.starClass] ?? 1;
    else if (o.type === "pulsar") { h = 0.5; r = 12; }
    else if (o.type === "blackhole") { h = o.parent ? 3 : 30; r = o.parent ? 8 : 60; }
    else continue;
    const p = posOf(o);
    const d = Math.hypot(p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]);
    if (d > FLUX_RANGE * (o.parent ? 1 : 4)) continue;
    // A floor on distance so a station-keeping orbit around something tiny
    // (a pulsar holds at ~2u) doesn't divide by almost nothing.
    const k = (FLUX_REF / Math.max(d, (o.size || 1) * 1.5, 4)) ** 2;
    heat += h * k; rad += r * k;
    if ((h + r) * k > top) { top = (h + r) * k; source = { id: o.id, name: o.name, pos: p }; }
  }
  // `source`: whichever body contributes most — what the computer names
  // when it tells you to get away from something.
  return { heat: Math.min(heat, FLUX_MAX), rad: Math.min(rad, FLUX_MAX), source };
}
