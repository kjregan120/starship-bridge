// engine.js — the flight engine for the browser. One shared FlightSim over the
// real generated universe, plus the selectors the 3D scene and the UI read.
import universe from "../universe/universe.json";
import { FlightSim } from "../universe/sim.js";
import { positionAt, magnitude } from "../universe/physics.js";
import { ShipSystems, fluxAt } from "../universe/ship.js";
import { Collective } from "../universe/collective.js";
import { Cube } from "../universe/cube.js";
import { Tactical } from "../universe/tactical.js";
import { newCareer, startMission } from "../universe/personnel/career.js";
import { dateOf, fmtClock, SHIFT_LABEL } from "../universe/personnel/util.js";
import { loadCareer, saveCareer } from "./careerStore.js";

export const byId = Object.fromEntries(universe.objects.map((o) => [o.id, o]));
export const stars = universe.objects.filter((o) => o.type === "star");

// Everything that makes up the galaxy-scale point cloud (things you navigate
// *between*): stars and the exotic bodies, but not planets/moons.
export const galaxyPoints = universe.objects.filter((o) =>
  ["star", "blackhole", "pulsar", "nebula", "beacon"].includes(o.type) && o.id !== "sgr-a-star"
);

// Home port: star with the most planets; start holding at its outer planet.
const homeStar = stars
  .map((s) => ({ s, n: universe.objects.filter((o) => o.parent === s.id && o.type === "planet").length }))
  .sort((a, b) => b.n - a.n)[0].s;
const homePlanet = universe.objects
  .filter((o) => o.parent === homeStar.id && o.type === "planet")
  .sort((a, b) => b.orbit.radius - a.orbit.radius)[0];

export const sim = new FlightSim(universe, {
  startPos: positionAt(homePlanet || homeStar, byId, 0),
  maxWarp: 3
});
export const startBodyName = (homePlanet || homeStar).name;

// The crew record, carried from mission to mission (personnel/career.js,
// saved by careerStore.js). Loading it finalizes any mission the page was
// closed during, then starts this one: calendar on, survivors recovered,
// empty posts filled by transfers.
export const career = loadCareer() ?? newCareer();
const mission = startMission(career);
saveCareer(career);

// The ship's own condition (ship.js), stepped alongside the sim in loop.js.
// Its warnings go to the same log as the helm's.
export const ship = new ShipSystems({
  onEvent: (kind, msg) => sim.log(kind, msg),
  faults: true,                 // wear and tear: systems break on their own
  profiles: mission.crew,
  day: career.day,
  hour: career.hour,
});
sim.log("info", `Mission ${career.missions} — ${dateOf(career.day)}, ${fmtClock(career.hour)} hours. ${mission.crew.length} crew aboard; ${SHIFT_LABEL[ship.roster.shift]} watch has the ship.`);
if (career.missions > 1 && mission.transfers.length) {
  const names = mission.transfers.slice(0, 4).map((p) => `${p.post.rank} ${p.identity.first} ${p.identity.last}`).join(", ");
  sim.log("info", `${mission.transfers.length} transferred aboard to fill vacant posts: ${names}${mission.transfers.length > 4 ? ", and others" : ""}.`);
}

// Everything that heats or irradiates the ship: stars, pulsars, black holes.
const fluxSources = universe.objects.filter((o) => ["star", "pulsar", "blackhole"].includes(o.type));
export function shipFlux() {
  return fluxAt(sim.pos, fluxSources, (o) => positionAt(o, byId, sim.t));
}
export { universe };

// The Collective (collective.js): the systems it holds and any cube that's
// out — stepped in loop.js, drawn in Scene.jsx.
export const collective = new Collective({
  stars, home: homeStar, posOf: (o) => positionAt(o, byId, sim.t),
});
// The Tactical department fighting it (tactical.js), stepped alongside.
export const tactical = new Tactical();

// Dev builds only: a handle for poking at the live sim from the console,
// e.g. __bridge.summonCube() to bring a cube in 12u ahead.
if (import.meta.env?.DEV && typeof window !== "undefined") {
  window.__bridge = {
    sim, ship, collective, tactical,
    summonCube(range = 12) {
      const f = sim.facing, p = sim.pos;
      collective.cube = new Cube({ id: `cube-dev-${Date.now()}`, pos: [p[0] + f[0] * range, p[1] + f[1] * range + 1, p[2] + f[2] * range], seed: 5 });
      return collective.cube;
    },
  };
}

// The ship's rendered facing direction — the single source of truth for
// "which way am I pointed," shared by the viewscreen (Scene.jsx)
// and the tactical chart (Chart.jsx) so they never disagree. Updated once per
// frame in loop.js. `bank` is the roll (radians, + = rolling to port) the
// scene leans into while the nose is yawing — see loop.js.
export const view = { facing: [0, 0, 1], bank: 0 };

const dist = (a, b) => magnitude([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);

// The star nearest the ship right now — defines the "current system".
export function nearestStar() {
  let best = null, bd = Infinity;
  for (const s of stars) {
    const d = dist(sim.pos, positionAt(s, byId, sim.t));
    if (d < bd) { bd = d; best = s; }
  }
  return { star: best, d: bd };
}

// Every star within `range` of the ship, nearest first — the systems close
// enough that their planets should be drawn as real (tiny-if-far) spheres
// rather than popping in only once one star becomes the single nearest.
export function starsWithin(range) {
  return stars
    .map((s) => ({ s, d: dist(sim.pos, positionAt(s, byId, sim.t)) }))
    .filter(({ d }) => d <= range)
    .sort((a, b) => a.d - b.d)
    .map(({ s }) => s);
}

const blackholes = universe.objects.filter((o) => o.type === "blackhole");

// Every black hole (the galactic core included) within `range` of the ship —
// same "grow in on approach" treatment as starsWithin.
export function blackholesWithin(range) {
  return blackholes
    .map((o) => ({ o, d: dist(sim.pos, positionAt(o, byId, sim.t)) }))
    .filter(({ d }) => d <= range)
    .sort((a, b) => a.d - b.d)
    .map(({ o }) => o);
}

const beacons = universe.objects.filter((o) => o.type === "beacon");

// Every beacon within `range` — same "grow in on approach" treatment as
// starsWithin/blackholesWithin, since a beacon belongs to no star system
// (parent is the galactic core) and would otherwise never render as a mesh.
export function beaconsWithin(range) {
  return beacons
    .map((o) => ({ o, d: dist(sim.pos, positionAt(o, byId, sim.t)) }))
    .filter(({ d }) => d <= range)
    .sort((a, b) => a.d - b.d)
    .map(({ o }) => o);
}

// The star's planets and their moons — the bodies drawn as real spheres.
export function systemBodies(star) {
  if (!star) return [];
  const planets = universe.objects.filter((o) => o.parent === star.id);
  const moons = universe.objects.filter((o) => planets.some((p) => p.id === o.parent));
  return [star, ...planets, ...moons];
}

// Nearest body of any kind (for scans / status).
export function nearestBody(max = 1e9) {
  let best = null, bd = Infinity;
  for (const o of universe.objects) {
    if (o.id === "sgr-a-star") continue;
    const d = dist(sim.pos, positionAt(o, byId, sim.t));
    if (d < bd) { bd = d; best = o; }
  }
  return bd <= max ? { o: best, d: bd } : null;
}

const bearing = (from, to) => {
  const a = (Math.atan2(to[2] - from[2], to[0] - from[0]) * 180) / Math.PI;
  return ((a % 360) + 360) % 360;
};

// Nearby stars for the nav readout.
export function navList(n = 8) {
  return stars
    .map((s) => {
      const p = positionAt(s, byId, sim.t);
      return { id: s.id, name: s.name, cls: s.starClass, d: dist(sim.pos, p), bearing: bearing(sim.pos, p) };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, n);
}

export function worldPos(obj) { return positionAt(obj, byId, sim.t); }

// Objects within `range` units of the ship, with their offset from it. Used by
// the tactical chart. dx = east/west, dz = the top-down vertical axis, dy = the
// out-of-plane height (small, since the galaxy is a thin disk).
export function nearbyObjects(range) {
  const out = [];
  for (const o of universe.objects) {
    if (o.id === "sgr-a-star") continue;
    const p = positionAt(o, byId, sim.t);
    const dx = p[0] - sim.pos[0], dy = p[1] - sim.pos[1], dz = p[2] - sim.pos[2];
    const d = Math.hypot(dx, dy, dz);
    if (d <= range) out.push({ o, dx, dy, dz, d });
  }
  return out.sort((a, b) => a.d - b.d);
}

// The ship's currently plotted course, as world-space points: current
// position, any bends sim.js laid in to clear a hazard, then the final
// target. Same heading/waypoints state drives both impulse and warp travel,
// so this works for either — empty when there's no active heading (a plain
// "warp to X" with no plotted route, cruising with no target) or when the
// heading is just "hold station here" (not a course going anywhere).
// Used by the 3D chart to draw the course line.
export function courseWaypoints() {
  if (!sim.heading || sim.heading.type === "hold") return [];
  const final = sim.heading.type === "body" ? worldPos(sim.byId[sim.heading.id]) : sim.heading.p;
  return [sim.pos, ...sim.waypoints, final];
}
