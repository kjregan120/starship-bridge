// generate.js — builds a bounded, deterministic universe and writes it to
// universe.json. Run:  node src/universe/generate.js [seed]
//
// Bounded (not infinite) is the whole trick that makes this finishable: a few
// hundred systems in a fixed volume can just be generated once and saved. Same
// seed always yields the same universe, so it's reproducible and tiny to store.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TAU = Math.PI * 2;
const seed = Number(process.argv[2] ?? 74210);

// --- deterministic RNG (mulberry32) -----------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seed);
const rand = (lo, hi) => lo + rng() * (hi - lo);
const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const chance = (p) => rng() < p;

// --- tuning knobs -----------------------------------------------------------
const GALAXY_RADIUS = 1000;    // bounded volume
const DISK_THICKNESS = 60;     // flattening in Y
const N_ARMS = 4;
const ARM_TWIST = 0.0055;      // radians per unit radius → spiral tightness
const STAR_COUNT = 160;
const STRAY_BLACKHOLES = 4;
const PULSARS = 5;
const NEBULAE = 6;
const BEACONS = 7;

// Orbit periods (game-seconds). Galaxy-scale is astronomically slow so the
// starmap looks fixed; system-scale is fast enough to watch planets move.
const CORE_PERIOD = [3_000_000, 9_000_000];
const PLANET_PERIOD = [80, 700];
const MOON_PERIOD = [12, 60];

const STAR_TYPES = [
  { cls: "M-type red dwarf", color: "#ff6a48", mass: 0.4, weight: 0.5 },
  { cls: "K-type orange", color: "#ffa24a", mass: 0.7, weight: 0.15 },
  { cls: "G-type main sequence", color: "#ffe6a8", mass: 1.0, weight: 0.15 },
  { cls: "F-type yellow-white", color: "#fff4d6", mass: 1.3, weight: 0.08 },
  { cls: "A-type white", color: "#bcd0ff", mass: 1.8, weight: 0.07 },
  { cls: "B-type blue", color: "#9db8ff", mass: 4.0, weight: 0.05 }
];
function pickStarType() {
  let r = rng(), acc = 0;
  for (const t of STAR_TYPES) { acc += t.weight; if (r <= acc) return t; }
  return STAR_TYPES[0];
}

const PLANET_KINDS = [
  { kind: "rocky", color: "#9c7a5a", habitable: false },
  { kind: "ocean", color: "#3b6fa0", habitable: true },
  { kind: "class-M", color: "#3b7d5a", habitable: true },
  { kind: "desert", color: "#c08a4a", habitable: false },
  { kind: "ice", color: "#bcd8e6", habitable: false },
  { kind: "gas giant", color: "#c9a36b", habitable: false },
  { kind: "toxic", color: "#8fae54", habitable: false }
];

const objects = [];
let n = 0;
const uid = (p) => `${p}-${(n++).toString(36)}`;

// --- galactic core: a supermassive black hole at the origin, the root -------
const core = {
  id: "sgr-a-star",
  name: "Galactic Core",
  type: "blackhole",
  parent: null,
  fixed: [0, 0, 0],
  orbit: null,
  mass: 60000,
  size: 14,
  scan: "Supermassive singularity. Do not approach. Accretion disk emits lethal radiation across the spectrum."
};
objects.push(core);

// Place a body on a spiral-arm position and return {x,y,z,r,angle}.
function spiralSite() {
  // bias toward the centre a little for a denser core
  const r = GALAXY_RADIUS * Math.pow(rand(0.08, 1), 0.85);
  const arm = randInt(0, N_ARMS - 1);
  const angle =
    r * ARM_TWIST + (arm / N_ARMS) * TAU + rand(-0.25, 0.25);
  const y = rand(-DISK_THICKNESS, DISK_THICKNESS) * (1 - r / GALAXY_RADIUS * 0.6);
  return { r, angle, y };
}

// A body orbiting the core: radius = galactic r, phase set so that at t=0 it
// sits exactly on its spiral site (positions look designed, then drift slowly).
function coreOrbit(site) {
  return {
    radius: site.r,
    period: rand(...CORE_PERIOD),
    phase: site.angle,
    inclination: Math.atan2(site.y, site.r) // tiny tilt to give thickness
  };
}

function addPlanets(star) {
  const count = randInt(0, 6);
  let orbitR = rand(6, 14);
  for (let i = 0; i < count; i++) {
    const kind = pick(PLANET_KINDS);
    const planet = {
      id: uid("p"),
      name: `${star.name} ${toRoman(i + 1)}`,
      type: "planet",
      parent: star.id,
      kind: kind.kind,
      color: kind.color,
      habitable: kind.habitable && chance(0.6),
      mass: kind.kind === "gas giant" ? rand(0.02, 0.05) : rand(0.002, 0.008),
      size: kind.kind === "gas giant" ? rand(1.1, 1.8) : rand(0.5, 1.0),
      orbit: {
        radius: orbitR,
        period: rand(...PLANET_PERIOD) * (1 + i * 0.4),
        phase: rand(0, TAU),
        inclination: rand(-0.12, 0.12)
      },
      scan: describePlanet(kind)
    };
    objects.push(planet);
    // moons
    const moons = kind.kind === "gas giant" ? randInt(0, 3) : randInt(0, 1);
    let mR = planet.size + rand(1.5, 3);
    for (let m = 0; m < moons; m++) {
      const id = uid("m");
      const mk = moonKind(id, kind.kind);
      objects.push({
        id,
        name: `${planet.name}${String.fromCharCode(97 + m)}`,
        type: "moon",
        parent: planet.id,
        kind: mk.kind,
        color: mk.color,
        mass: rand(0.0002, 0.0009),
        size: rand(0.15, 0.35),
        orbit: {
          radius: mR,
          period: rand(...MOON_PERIOD) * (1 + m * 0.5),
          phase: rand(0, TAU),
          inclination: rand(-0.3, 0.3)
        },
        scan: mk.scan
      });
      mR += rand(1, 2.5);
    }
    orbitR += rand(5, 16);
  }
}

// Moon kind is hashed from the moon's id rather than drawn from rng(), so
// adding it didn't shift the random stream — the same seed still produces
// the exact same universe it did before moons had kinds. Volcanic moons
// only orbit gas giants: tidal heating from a massive parent (Io).
const MOON_KINDS = {
  cratered: { color: "#8a8f99", scan: "Airless moon. Cratered surface." },
  icy: { color: "#d6e4ee", scan: "Icy moon. Fractured water-ice crust. Possible subsurface ocean." },
  volcanic: { color: "#d9b84a", scan: "Volcanic moon. Tidal heating from its parent drives constant eruptions. Sulfur plains." }
};
function moonKind(id, parentKind) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  // murmur3 finalizer — bare FNV of short sequential ids ("m-3", "m-4"…)
  // leaves the high bits clumped, which skewed the kind split badly.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  const u = (h >>> 0) / 4294967296;
  const kind = parentKind === "gas giant" && u < 0.2 ? "volcanic" : u < 0.45 ? "icy" : "cratered";
  return { kind, ...MOON_KINDS[kind] };
}

function describePlanet(kind) {
  const map = {
    "class-M": "Class-M world. Breathable atmosphere, liquid water, temperate. Candidate for landing.",
    ocean: "Ocean world. Global sea, scattered archipelagos. Class-M under most classifications.",
    rocky: "Rocky terrestrial. Thin atmosphere. Mineral-rich crust.",
    desert: "Arid world. Extreme temperature swings. Trace surface water.",
    ice: "Frozen world. Subsurface ice, possible liquid ocean beneath the crust.",
    "gas giant": "Gas giant. No solid surface. Powerful magnetosphere and storm bands.",
    toxic: "Toxic atmosphere, high pressure. Not survivable unprotected."
  };
  return map[kind.kind] ?? "Unremarkable body.";
}

function toRoman(num) {
  const t = [["X",10],["IX",9],["V",5],["IV",4],["I",1]];
  let s = "";
  for (const [sym, v] of t) while (num >= v) { s += sym; num -= v; }
  return s;
}

// --- stars ------------------------------------------------------------------
for (let i = 0; i < STAR_COUNT; i++) {
  const st = pickStarType();
  const site = spiralSite();
  const star = {
    id: uid("s"),
    name: starName(),
    type: "star",
    parent: core.id,
    starClass: st.cls,
    color: st.color,
    mass: st.mass,
    size: rand(1.5, 3.5),
    orbit: coreOrbit(site),
    scan: `${st.cls}. Stellar classification confirmed.`
  };
  objects.push(star);
  addPlanets(star);
}

// --- stray hazards ----------------------------------------------------------
for (let i = 0; i < STRAY_BLACKHOLES; i++) {
  const site = spiralSite();
  objects.push({
    id: uid("bh"), name: `Anomaly ${randInt(100,999)}`, type: "blackhole",
    parent: core.id, color: "#000000", mass: rand(30, 90), size: rand(2, 4),
    orbit: coreOrbit(site),
    scan: "Stellar-mass black hole. Intense gravity well. Approach with extreme caution — slingshot possible, capture likely."
  });
}
for (let i = 0; i < PULSARS; i++) {
  const site = spiralSite();
  objects.push({
    id: uid("psr"), name: `PSR ${randInt(1000,9999)}`, type: "pulsar",
    parent: core.id, color: "#dfefff", mass: rand(1.2, 1.6), size: 0.6,
    orbit: coreOrbit(site),
    pulseHz: rand(0.5, 30),
    scan: "Rotating neutron star. Regular radio pulses — usable as a navigation beacon. Radiation hazard on close approach."
  });
}
for (let i = 0; i < NEBULAE; i++) {
  const site = spiralSite();
  objects.push({
    id: uid("neb"), name: `${pick(["Veil","Ember","Cinder","Halo","Shroud","Drift"])} Nebula`,
    type: "nebula", parent: core.id, color: pick(["#7a4fbf","#bf4f7a","#4f8fbf","#bf884f"]),
    mass: 0, size: rand(40, 90),
    orbit: coreOrbit(site),
    scan: "Ionized gas and dust. Sensors degrade sharply inside. Good place to hide — or to be ambushed."
  });
}

// --- beacons ------------------------------------------------------------
// The only artificial emitters in the universe: near-silent on every band
// except a strong, perfectly-regular Subspace pulse (see signals.js) — the
// "even spacing, no natural jitter" is the tell that COMMS can pick up on
// and is why they're worth hunting for with `sweep`.
const BEACON_NAMES = [
  "Unregistered Beacon", "Automated Relay", "Derelict Transponder",
  "Silent Sentinel", "Orphaned Buoy", "Echo Marker", "Drift Transponder"
];
const BEACON_HAILS = [
  "...repeating automated distress pattern. No further data.",
  "Transponder active. Origin registry unknown. No response beyond acknowledgment.",
  "Recorded log fragment, heavily degraded: '...if anyone receives this...' Signal ends.",
  "Standard Starfleet beacon protocol acknowledged. No personnel aboard. Automated only."
];
for (let i = 0; i < BEACONS; i++) {
  const site = spiralSite();
  objects.push({
    id: uid("bcn"), name: `${pick(BEACON_NAMES)} ${randInt(10, 99)}`, type: "beacon",
    parent: core.id, color: "#ffcc55", mass: 0.0005, size: 0.3,
    orbit: coreOrbit(site),
    hailable: true,
    hail: pick(BEACON_HAILS),
    scan: "Small automated object. Steady subspace pulse at a fixed interval — pattern is artificial, not natural. Origin and purpose unclear."
  });
}

function starName() {
  const g = ["Vela","Erebus","Tarsus","Cygnus","Lyra","Ophi","Draco","Kepler",
    "Rigel","Altair","Mira","Zeta","Kastra","Nero","Solace","Vantor","Icarus",
    "Halcyon","Perdita","Onyx","Cael","Myrr","Tycho","Wren"];
  return `${pick(g)} ${pick(["Prime","Major","Minor","Gate","Reach","Verge",""])}`.trim()
    + " " + randInt(1, 99);
}

// --- write ------------------------------------------------------------------
const universe = {
  seed,
  bounds: GALAXY_RADIUS,
  generatedObjects: objects.length,
  time: { note: "positions are positionAt(obj, byId, t) with t in game-seconds" },
  objects
};

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "universe.json");
writeFileSync(out, JSON.stringify(universe));

const counts = objects.reduce((a, o) => ((a[o.type] = (a[o.type] || 0) + 1), a), {});
console.log(`seed ${seed} → ${objects.length} objects`);
console.log(counts);
console.log(`written to ${out}`);
