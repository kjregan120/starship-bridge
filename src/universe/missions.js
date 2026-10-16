// missions.js — what an away team goes down to do.
//
// A mission is data: a type, a briefing, the things placed at the site
// (points of interest), objectives counted over them, and what it pays.
// Types are recipes over a small shared set of tasks, so a new type is a
// new recipe, not a new system. Built so far: science (survey), resource
// and rescue. First contact, salvage and raids will reuse the same shape.
//
// Pure and seeded from the site: the same site always offers the same
// mission until it's done (career.away.done remembers that).

import { rng } from "./terrain.js";
import { placePoint } from "./surface.js";

// What each kind of point of interest asks of whoever works it.
//   task   what the order is called ("<name> scan")
//   work   seconds for one proficient person
//   skill  what it practises, and how well it's done
export const POI_KINDS = {
  anomaly:  { task: "scan",      work: 8,  skill: "sensor-analysis",       label: "Anomaly" },
  specimen: { task: "sample",    work: 10, skill: "environmental-systems", label: "Specimen" },
  deposit:  { task: "collect",   work: 12, skill: "logistics",             label: "Deposit" },
  survivor: { task: "stabilise", work: 12, skill: "first-aid",             label: "Survivor", alt: "medicine" },
};
export const TASKS = Object.fromEntries(Object.entries(POI_KINDS).map(([k, v]) => [v.task, k]));
const XP_PER_TASK = 40;

export const MISSION_TYPES = {
  science:  { label: "Survey" },
  resource: { label: "Resource" },
  rescue:   { label: "Rescue" },
};

// Volatiles become fuel; metal-rich ground becomes spare parts.
const VOLATILE = new Set(["ice", "moon-icy", "toxic", "ocean"]);

const ANOMALIES = {
  default: ["magnetic anomaly", "subsurface void", "radiation source", "unusual crystal formation", "thermal bloom"],
  "class-M": ["ancient stonework", "magnetic anomaly", "unusual crystal formation", "bioluminescent mat"],
  ocean: ["tidal ruin", "magnetic anomaly", "bioluminescent mat"],
};
const SPECIMENS = {
  default: ["rock core", "regolith sample", "mineral vein"],
  "class-M": ["plant specimen", "soil sample", "insect colony"],
  ocean: ["kelp specimen", "tide-pool sample", "shell bed"],
  toxic: ["extremophile mat", "sulphur crust"],
  ice: ["ice core", "trapped-gas sample"],
  "moon-icy": ["ice core", "brine seep"],
};
const RESCUE_STORIES = [
  { what: "a survey team's shuttle came down hard", who: "survey team" },
  { what: "a mining outpost stopped answering", who: "miners" },
  { what: "an escape pod made planetfall", who: "pod survivors" },
];
const SURVIVOR_NAMES = ["Okafor", "Lindqvist", "Tanaka", "Mbeki", "Reyes", "Haddad", "Novak", "Aziz", "Brennan", "Castillo"];

const pickFrom = (r, list) => list[Math.floor(r() * list.length)];

// The mission waiting at a site. `terrain`: surface.js terrainFor(site).
export function missionFor(site, terrain) {
  const r = rng(site.seed ^ 0xa11a);
  const roll = r();
  const type = roll < 0.22 ? "rescue" : roll < 0.6 ? "resource" : "science";
  const placed = [];
  const poi = (kind, label, extra = {}) => {
    const pos = placePoint(terrain, r, { avoid: placed, min: kind === "survivor" ? 60 : 50 });
    placed.push(pos);
    return { id: `${kind}-${placed.length}`, kind, label, pos, progress: 0, done: false, ...extra };
  };
  const base = { id: site.id, siteId: site.id, bodyId: site.bodyId, type, pois: [], rewards: {} };

  if (type === "science") {
    const an = ANOMALIES[site.kind] ?? ANOMALIES.default;
    const sp = SPECIMENS[site.kind] ?? SPECIMENS.default;
    const nA = 2 + Math.floor(r() * 2), nS = 2;
    for (let i = 0; i < nA; i++) base.pois.push(poi("anomaly", pickFrom(r, an)));
    for (let i = 0; i < nS; i++) base.pois.push(poi("specimen", pickFrom(r, sp)));
    base.title = `Survey the ${site.feature}`;
    base.briefing = `Sensors picked up ${nA} readings worth a closer look near the ${site.feature}. Scan them and bring back ${nS} samples.`;
    base.objectives = [
      { kind: "anomaly", label: "Scan anomalies", need: nA },
      { kind: "specimen", label: "Take samples", need: nS },
    ];
  } else if (type === "resource") {
    const fuel = VOLATILE.has(site.kind);
    const n = 3 + Math.floor(r() * 2);
    const label = fuel ? (site.kind === "ocean" ? "heavy-water brine" : site.kind === "toxic" ? "volatile ice" : "deuterium ice") : "metal-rich ore";
    for (let i = 0; i < n; i++) base.pois.push(poi("deposit", label, { yields: fuel ? "fuel" : "parts" }));
    base.title = fuel ? `Harvest ${label}` : "Collect ore for spares";
    base.briefing = fuel
      ? `${n} pockets of ${label} near the ${site.feature}. Each one we bring back tops up the fuel.`
      : `${n} deposits of ${label} near the ${site.feature}. Engineering can turn them into spare parts for repairs.`;
    base.objectives = [{ kind: "deposit", label: `Collect ${label}`, need: n }];
    base.rewards = fuel ? { fuelPer: 0.04 } : { partsPer: 1 };
  } else {
    const story = pickFrom(r, RESCUE_STORIES);
    const n = 1 + Math.floor(r() * 3);
    const names = SURVIVOR_NAMES.slice().sort(() => r() - 0.5);
    const near = placePoint(terrain, r, { min: 120, max: 320 });
    for (let i = 0; i < n; i++) {
      // Close together: they're at the same wreck.
      const a = r() * Math.PI * 2, d = 6 + r() * 14;
      const pos = [near[0] + Math.cos(a) * d, near[1] + Math.sin(a) * d];
      placed.push(pos);
      base.pois.push({
        id: `survivor-${i + 1}`, kind: "survivor", label: names[i], pos, progress: 0, done: false,
        health: 0.45 + r() * 0.25,
        decay: 0.0012 + r() * 0.0008,  // health/s until stabilised — five to eight minutes
        extracted: false, dead: false,
      });
    }
    base.wreck = near;
    base.title = `Rescue the ${story.who}`;
    base.briefing = `Distress beacon: ${story.what} near the ${site.feature}. ${n} life sign${n > 1 ? "s" : ""}, weak. Stabilise them and bring them home.`;
    base.objectives = [
      { kind: "survivor", label: "Stabilise survivors", need: n },
      { kind: "extracted", label: "Bring them aboard", need: n },
    ];
  }
  return base;
}

// How far along each objective is: [{ label, have, need, done }].
export function objectiveStatus(m) {
  return m.objectives.map((o) => {
    const have = o.kind === "extracted"
      ? m.pois.filter((p) => p.kind === "survivor" && p.extracted).length
      : m.pois.filter((p) => p.kind === o.kind && p.done).length;
    // A survivor who died can't be counted on.
    const lost = m.pois.filter((p) => p.kind === "survivor" && p.dead).length;
    const need = o.kind === "survivor" || o.kind === "extracted" ? Math.max(0, o.need - lost) : o.need;
    return { label: o.label, have, need, done: have >= need && need > 0 };
  });
}
export const missionComplete = (m) => objectiveStatus(m).every((o) => o.done);

// Work on a point of interest: `units` of proficient-person-seconds.
// Returns true the moment it's finished.
export function workOn(p, units) {
  if (p.done || p.dead) return false;
  p.progress = Math.min(1, p.progress + units / POI_KINDS[p.kind].work);
  if (p.progress >= 1) { p.done = true; return true; }
  return false;
}
export const xpForTask = () => XP_PER_TASK;

// Survivors not yet stabilised get worse. Returns those who died this step.
export function stepSurvivors(m, dt) {
  const died = [];
  for (const p of m.pois) {
    if (p.kind !== "survivor" || p.done || p.dead) continue;
    p.health -= p.decay * dt;
    if (p.health <= 0) { p.health = 0; p.dead = true; died.push(p); }
  }
  return died;
}

// What the mission pays, from what was actually done.
// → { science, fuel, parts, rescued, complete }
export function payout(m) {
  const done = (k) => m.pois.filter((p) => p.kind === k && p.done).length;
  const deposits = m.pois.filter((p) => p.kind === "deposit" && p.done);
  const complete = missionComplete(m);
  // Each reading and sample is worth something; the full set half as much again.
  const science = Math.round((10 * done("anomaly") + 6 * done("specimen")) * (complete && m.type === "science" ? 1.5 : 1));
  return {
    science,
    fuel: deposits.filter((p) => p.yields === "fuel").length * (m.rewards.fuelPer ?? 0),
    parts: deposits.filter((p) => p.yields === "parts").length * (m.rewards.partsPer ?? 0),
    rescued: m.pois.filter((p) => p.kind === "survivor" && p.extracted).length,
    complete,
  };
}
