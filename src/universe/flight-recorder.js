// flight-recorder.js — drives a full command-driven voyage and prints the log.
//   node src/universe/flight-recorder.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FlightSim } from "./sim.js";
import { positionAt, magnitude } from "./physics.js";
import { warpSpeed } from "./flight.js";

const here = dirname(fileURLToPath(import.meta.url));
const universe = JSON.parse(readFileSync(join(here, "universe.json"), "utf8"));
const byId = Object.fromEntries(universe.objects.map((o) => [o.id, o]));
const stars = universe.objects.filter((o) => o.type === "star");

// Start at a star far from the core (largest orbit radius) so we can clear its
// well and jump; pick its outermost planet for a real impulse leg.
const startStar = stars
  .filter((s) => universe.objects.some((o) => o.parent === s.id && o.type === "planet"))
  .sort((a, b) => (b.orbit?.radius || 0) - (a.orbit?.radius || 0))[0];
const startPlanet = universe.objects
  .filter((o) => o.parent === startStar.id && o.type === "planet")
  .sort((a, b) => b.orbit.radius - a.orbit.radius)[0];
const startPos = positionAt(startStar, byId, 0);
let destStar = null, far = 0;
for (const s of stars) {
  const d = magnitude([
    positionAt(s, byId, 0)[0] - startPos[0],
    positionAt(s, byId, 0)[1] - startPos[1],
    positionAt(s, byId, 0)[2] - startPos[2]
  ]);
  if (d > far && s.id !== startStar.id) { far = d; destStar = s; }
}

const sim = new FlightSim(universe, { startPos: [...startPos], maxWarp: 3 });

let pass = 0, fail = 0;
const check = (name, cond) => {
  console.log(`   ${cond ? "PASS" : "FAIL"}  ${name}`);
  cond ? pass++ : fail++;
};
const dt = 0.5;
const runUntil = (cond, maxSteps = 20000) => {
  for (let i = 0; i < maxSteps; i++) { sim.step(dt); if (cond()) return true; }
  return false;
};
const printNewEvents = (() => {
  let seen = 0;
  return () => {
    for (; seen < sim.events.length; seen++) {
      const e = sim.events[seen];
      const tag = { order: "ORDER ", deny: "DENIED", arrive: "ARRIVE" }[e.kind] || "  •   ";
      console.log(`   [T+${e.t.toFixed(0).padStart(4)}s] ${tag}  ${e.msg}`);
    }
  };
})();

console.log(`\n=== Voyage: ${startStar.name} -> ${destStar.name} (${far.toFixed(0)} units) ===\n`);

// Phase 1: try to warp while sitting right on top of the star -> must be denied.
console.log("PHASE 1  — attempt warp from inside the star's well");
const engaged = sim.engageWarp(destStar.id, 3);
printNewEvents();
check("warp refused while in the gravity well", engaged === false && sim.mode === "impulse");

// Phase 2: impulse in-system to a planet.
console.log("\nPHASE 2  — impulse to " + startPlanet.name);
sim.comeAbout(startPlanet.id);
sim.ahead(1);
printNewEvents();
runUntil(() => sim.events.some((e) => e.kind === "arrive" && e.msg.includes(startPlanet.name)));
printNewEvents();
check("reached the planet under impulse", magnitude([
  sim.pos[0] - sim.posOf(startPlanet.id)[0],
  sim.pos[1] - sim.posOf(startPlanet.id)[1],
  sim.pos[2] - sim.posOf(startPlanet.id)[2]
]) < 10);

// Phase 3: clear the well on impulse, then warp out.
console.log("\nPHASE 3  — clear the well, then warp " + destStar.name);
const outward = (() => {
  const sp = sim.posOf(startStar.id);
  const d = [sim.pos[0] - sp[0], sim.pos[1] - sp[1], sim.pos[2] - sp[2]];
  const m = magnitude(d) || 1;
  return [sp[0] + (d[0] / m) * 200, sp[1] + (d[1] / m) * 200, sp[2] + (d[2] / m) * 200];
})();
sim.steerToPoint(outward);
sim.ahead(1);
printNewEvents();
let engaged2 = false;
const tWarpStart = { v: 0 };
runUntil(() => {
  // silently wait until we've cleared the well, then engage once
  if (!engaged2 && sim.canEngageWarp()) {
    engaged2 = sim.engageWarp(destStar.id, 3);
    if (engaged2) tWarpStart.v = sim.t;
  }
  return sim.events.some((e) => e.kind === "arrive" && e.msg.includes(destStar.name));
});
printNewEvents();

const arriveEvent = sim.events.find((e) => e.kind === "arrive" && e.msg.includes(destStar.name));
check("eventually cleared the well and warp engaged", engaged2 === true);
check("arrived at the destination star", !!arriveEvent);

// Warp leg time should match speed = warpSpeed(3).
const warpLegDist = far; // approx; standoff makes it slightly less
const expected = (warpLegDist) / warpSpeed(3);
const actual = arriveEvent.t - tWarpStart.v;
console.log(`\n   warp leg: ~${warpLegDist.toFixed(0)} units at warp 3 ` +
  `(${warpSpeed(3).toFixed(1)} u/s) -> expected ~${expected.toFixed(0)}s, actual ${actual.toFixed(0)}s`);
check("warp travel time matches the calibrated speed (within 20%)",
  Math.abs(actual - expected) / expected < 0.2);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
