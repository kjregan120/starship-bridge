// test.js — proves the design claims with the real generated universe.
//   node src/universe/test.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { positionAt, gravityOnShip, magnitude } from "./physics.js";
import { ShipSystems, sectionFacing } from "./ship.js";
import { AlertBoard, assessThreats } from "./alerts.js";

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

console.log("\n7. Ship systems: power, heat, hits");
{
  const run = (env, secs, setup) => {
    const s = new ShipSystems();
    setup?.(s);
    for (let t = 0; t < secs; t += 0.1) s.step(0.1, env);
    return s;
  };
  const idle = run({ mode: "impulse", throttle: 0, flux: { heat: 0, rad: 0 } }, 300);
  check(`idle in deep space stays nominal`, idle.heat < 0.5 && idle.shields > 0.99 && idle.crew > 0.99,
    `heat ${idle.heat.toFixed(2)}, shields ${idle.shields.toFixed(2)}`);

  const short = run({ mode: "warp", warpFactor: 3, flux: { heat: 0, rad: 0 } }, 60, (s) => s.setReactor(0.6));
  check(`a power shortfall starves the lowest priority first`,
    short.power.sat.life === 1 && short.power.sat.comms < short.power.sat.shields,
    `life ${short.power.sat.life.toFixed(2)}, shields ${short.power.sat.shields.toFixed(2)}, comms ${short.power.sat.comms.toFixed(2)}`);

  const hot = run({ mode: "impulse", throttle: 0, flux: { heat: 30, rad: 0 } }, 300);
  check(`overheating scrams the reactor and takes warp off-line`,
    hot.reactor.scrammed && hot.warpInhibit === "reactor scrammed", `heat ${hot.heat.toFixed(2)}`);

  const boosted = run({ mode: "impulse", throttle: 0, flux: { heat: 11, rad: 11 } }, 600, (s) => s.setPower("shields", 1.5));
  const plain = run({ mode: "impulse", throttle: 0, flux: { heat: 11, rad: 11 } }, 600);
  check(`boosting shields holds them up near a hot star`, boosted.shields > 0.8 && plain.shields < 0.2,
    `boosted ${boosted.shields.toFixed(2)}, standard ${plain.shields.toFixed(2)}`);

  check(`hits pick the side facing the source`,
    sectionFacing([0, 0, 1], [0, 0, 1]) === "fore" && sectionFacing([0, 0, -1], [0, 0, 1]) === "aft" &&
    sectionFacing([1, 0, 0], [0, 0, 1]) === "port" && sectionFacing([-1, 0, 0], [0, 0, 1]) === "starboard");

  const s = new ShipSystems();
  const r1 = s.hit({ energy: 0.6, from: [0, 0, 1] });
  const r2 = s.hit({ energy: 0.8, from: [0, 0, 1] });
  check(`shields absorb hits until they're gone, then the hull takes it`,
    r1.through === 0 && r2.through > 0 && s.hull.fore < 1 && s.hull.aft === 1,
    `fore ${s.hull.fore.toFixed(2)}`);
}

console.log("\n8. Alerts: parked next to a hot star");
{
  const hot = { mode: "impulse", throttle: 0, flux: { heat: 27, rad: 27, source: { id: "x", name: "Altair 70", pos: [0, 0, 0] } } };
  const s = new ShipSystems();
  const board = new AlertBoard();
  let firstRed = null, scramT = null;
  for (let t = 0; t < 600 && !s.crewLost; t += 0.1) {
    s.step(0.1, hot);
    board.update(s, t);
    if (firstRed == null && board.level === "red") firstRed = t;
    if (scramT == null && s.reactor.scrammed) scramT = t;
  }
  check(`red alert sounds immediately on arrival`, firstRed != null && firstRed < 1, `at ${firstRed?.toFixed(1)}s`);
  check(`the first warning names the source and says to withdraw`,
    board.incidents.some((i) => i.title.includes("Altair 70")));
  check(`staying put kills the crew, and the game knows it`, s.crewLost && board.threats[0].id === "crew-lost");

  // Same star, but the crew does what the computer says when the reactor scrams.
  const s2 = new ShipSystems();
  for (let t = 0; t < 600 && !s2.reactor.scrammed; t += 0.1) s2.step(0.1, hot);
  s2.step(0.1, { ...hot, throttle: 1 });
  check(`on emergency power the engines still get thrust to withdraw`,
    s2.reactor.scrammed && s2.impulseFactor > 0.25, `impulse ${(s2.impulseFactor * 100).toFixed(0)}%`);

  const s3 = new ShipSystems();
  for (let t = 0; t < 4; t += 0.1) s3.step(0.1, hot);
  const shields = assessThreats(s3).find((x) => x.id === "shields");
  check(`falling shields get a countdown`, shields && shields.eta > 0 && shields.eta < 120, `eta ${shields?.eta?.toFixed(0)}s`);

  const s4 = new ShipSystems();
  s4.hull.port = 0;
  for (let t = 0; t < 30; t += 0.1) s4.step(0.1, { mode: "impulse", throttle: 0, flux: { heat: 0, rad: 0 } });
  check(`a hull section gone takes its components with it, and the air with it`,
    s4.health.warp < 1 && s4.health.emitters < 1 && s4.atmo.breathable < s4.atmo.o2,
    `warp ${s4.health.warp.toFixed(3)}, breathable ${s4.atmo.breathable.toFixed(2)}`);
}

console.log("\n9. Crew: forty individuals");
{
  const quiet = { mode: "impulse", throttle: 0, flux: { heat: 0, rad: 0 } };
  const a = new ShipSystems({ seed: 1 }), b = new ShipSystems({ seed: 1 });
  const names = new Set(a.roster.crew.map((m) => m.name));
  check(`40 crew, every name different, same seed same crew`,
    a.roster.total === 40 && names.size === 40 && a.roster.crew[5].name === b.roster.crew[5].name);

  const eng = new ShipSystems({ seed: 2 });
  for (const m of eng.roster.crew) if (m.dept === "engineering") m.health = 0;
  eng.step(0.1, quiet);
  check(`losing Engineering cuts reactor capacity to automation`, Math.abs(eng.reactor.capacity - 40) < 1,
    `capacity ${eng.reactor.capacity.toFixed(0)}`);

  const pulsar = { mode: "impulse", throttle: 0, flux: { heat: 0.5, rad: 14 } };
  const open = new ShipSystems({ seed: 3 }), shel = new ShipSystems({ seed: 3 });
  shel.roster.shelterAll();
  for (let t = 0; t < 600; t += 0.1) { open.step(0.1, pulsar); shel.step(0.1, pulsar); }
  check(`the shelter saves lives under radiation`, shel.roster.counts().dead < open.roster.counts().dead,
    `dead: open ${open.roster.counts().dead}, sheltered ${shel.roster.counts().dead}`);
  check(`...at the cost of unmanned stations`, shel.impulseFactor < open.impulseFactor || shel.reactor.capacity < 100,
    `capacity ${shel.reactor.capacity.toFixed(0)}`);

  const br = new ShipSystems({ seed: 4 });
  br.hull.port = 0.05;
  let first = null;
  for (let t = 0; t < 120 && !first; t += 0.1) {
    br.step(0.1, quiet);
    first = br.roster.crew.find((m) => m.health < 0.3);
  }
  check(`a breach hurts the people in that section first`, first?.section === "port", `${first?.name} (${first?.section})`);
  for (let t = 0; t < 5; t += 0.1) br.step(0.1, quiet);
  check(`...and the critically hurt are carried to sickbay`, br.roster.crew.find((m) => m.id === first.id).location === "sickbay");

  const board = new AlertBoard();
  const rep = new ShipSystems({ seed: 5 });
  for (const m of rep.roster.crew.slice(0, 3)) m.health = 0.0001;
  let said = null;
  for (let t = 0; t < 20 && !said; t += 0.1) {
    rep.step(0.1, { ...quiet, flux: { heat: 0, rad: 20 } });
    board.update(rep, t);
    said = board.takeReport();
  }
  check(`deaths are reported together, with who's left`, said && /Casualty report/.test(said) && /crew remain/.test(said), said ?? "nothing said");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
