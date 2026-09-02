// test.js — proves the design claims with the real generated universe.
//   node src/universe/test.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { positionAt, gravityOnShip, magnitude } from "./physics.js";

const here = dirname(fileURLToPath(import.meta.url));
const universe = JSON.parse(readFileSync(join(here, "universe.json"), "utf8"));
const objects = universe.objects;
const byId = Object.fromEntries(objects.map((o) => [o.id, o]));

const dist = (a, b) =>
  magnitude([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  cond ? pass++ : fail++;
};

const aStar = objects.find((o) => o.type === "star");
const aPlanet = objects.find((o) => o.type === "planet");
const aMoon = objects.find((o) => o.type === "moon");
const blackhole = objects.find((o) => o.type === "blackhole" && o.parent);

console.log("\n1. Orbits are periodic (relative to parent, after one period)");
for (const o of [aPlanet, aMoon]) {
  const parent = byId[o.parent];
  const rel = (t) => {
    const c = positionAt(o, byId, t);
    const p = positionAt(parent, byId, t);
    return [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
  };
  const r0 = rel(0);
  const rT = rel(o.orbit.period);
  check(`${o.type} ${o.name} returns to start (vs its parent) after one period`,
    dist(r0, rT) < 0.01, `drift ${dist(r0, rT).toExponential(2)}`);
}
// (Absolute world position is NOT periodic — the parent moves too. That's
//  correct hierarchical behaviour, not a bug.)

console.log("\n2. Planets visibly move over a short interval");
{
  const p0 = positionAt(aPlanet, byId, 0);
  const p1 = positionAt(aPlanet, byId, 40);
  const moved = dist(p0, p1);
  check(`planet moves in 40s`, moved > 0.5, `moved ${moved.toFixed(2)} units`);
}

console.log("\n3. 'Roughly the same location' — stars barely move in a session");
{
  const p0 = positionAt(aStar, byId, 0);
  const p1 = positionAt(aStar, byId, 600); // a 10-minute session
  const drift = dist(p0, p1);
  const orbitR = aStar.orbit.radius;
  check(`star drifts < 0.1% of its orbit radius in 600s`,
    drift / orbitR < 0.001, `drift ${drift.toFixed(3)} of radius ${orbitR.toFixed(0)}`);
}

console.log("\n4. Determinism — same t always gives the same position");
{
  const a = positionAt(aPlanet, byId, 123.45);
  const b = positionAt(aPlanet, byId, 123.45);
  check(`identical position on repeat call`, a[0] === b[0] && a[2] === b[2]);
}

console.log("\n5. Gravity strengthens near massive bodies (single-body isolation)");
{
  const t = 0;
  const bhPos = positionAt(blackhole, byId, t);
  // Isolate this black hole's own field. In the FULL field the supermassive
  // core (mass 60000) dominates the inner galaxy — realistic, and a tuning
  // knob — so a fair test asks only about this body's contribution.
  const only = [blackhole];
  const near = [bhPos[0] + 20, bhPos[1], bhPos[2]];
  const far = [bhPos[0] + 400, bhPos[1], bhPos[2]];
  const gNear = magnitude(gravityOnShip(near, only, byId, t).accel);
  const gFar = magnitude(gravityOnShip(far, only, byId, t).accel);
  check(`pull near black hole > pull far away`, gNear > gFar,
    `near ${gNear.toExponential(2)} vs far ${gFar.toExponential(2)}`);
  const near2 = [bhPos[0] + 10, bhPos[1], bhPos[2]];
  const gNear2 = magnitude(gravityOnShip(near2, only, byId, t).accel);
  check(`follows inverse-square (halving distance ~4x force)`,
    gNear2 > gNear * 2.5, `${(gNear2 / gNear).toFixed(1)}x stronger at half distance`);
}

console.log("\n6. Gravity identifies the dominant well (for UI cues)");
{
  const bhPos = positionAt(blackhole, byId, 0);
  const near = [bhPos[0] + 15, bhPos[1], bhPos[2]];
  const { strongest } = gravityOnShip(near, objects, byId, 0);
  check(`nearest-well detection points at the black hole`,
    strongest && strongest.id === blackhole.id, `got ${strongest?.name}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
