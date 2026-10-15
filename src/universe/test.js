// test.js — proves the design claims with the real generated universe.
//   node src/universe/test.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { positionAt, gravityOnShip, magnitude } from "./physics.js";
import { ShipSystems, sectionFacing } from "./ship.js";
import { AlertBoard, assessThreats } from "./alerts.js";
import { newCareer, crewProfiles, startMission, checkpoint, reassign, crossTrain, finalizeMission } from "./personnel/career.js";
import { ageOn, skillLevel, qualifiedDepts, CORE_SKILL } from "./personnel/profile.js";
import { migrateCareer } from "./personnel/schema.js";
import { parseMagnify, clampZoom, MAX_ZOOM } from "../flight/lens.js";
import { cmeStep, cmeEta, cmeEnergy, cmeEffects, frontReach } from "./cme.js";
import { Cube, mulberry32, HOLD, DETECT, WEAPON_RANGE, TRACTOR_RANGE, LOSE } from "./cube.js";
import { Collective, collectiveSystems, HOME_SPACE, ROAM_COOLDOWN } from "./collective.js";

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
    const s = new ShipSystems({ seed: 1 });
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

  // Close to the edge by design — with crew skill now in play, a weak
  // Tactical team can't hold even boosted shields here.
  const boosted = run({ mode: "impulse", throttle: 0, flux: { heat: 10, rad: 10 } }, 600, (s) => s.setPower("shields", 1.5));
  const plain = run({ mode: "impulse", throttle: 0, flux: { heat: 10, rad: 10 } }, 600);
  check(`boosting shields holds them up near a hot star`, boosted.shields > 0.8 && plain.shields < 0.2,
    `boosted ${boosted.shields.toFixed(2)}, standard ${plain.shields.toFixed(2)}`);

  check(`hits pick the side facing the source`,
    sectionFacing([0, 0, 1], [0, 0, 1]) === "fore" && sectionFacing([0, 0, -1], [0, 0, 1]) === "aft" &&
    sectionFacing([1, 0, 0], [0, 0, 1]) === "port" && sectionFacing([-1, 0, 0], [0, 0, 1]) === "starboard");

  const s = new ShipSystems({ seed: 1 });
  const r1 = s.hit({ energy: 0.6, from: [0, 0, 1] });
  const r2 = s.hit({ energy: 0.8, from: [0, 0, 1] });
  check(`shields absorb hits until they're gone, then the hull takes it`,
    r1.through === 0 && r2.through > 0 && s.hull.fore < 1 && s.hull.aft === 1,
    `fore ${s.hull.fore.toFixed(2)}`);
}

console.log("\n8. Alerts: parked next to a hot star");
{
  const hot = { mode: "impulse", throttle: 0, flux: { heat: 27, rad: 27, source: { id: "x", name: "Altair 70", pos: [0, 0, 0] } } };
  const s = new ShipSystems({ seed: 1 });
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
  const s2 = new ShipSystems({ seed: 1 });
  for (let t = 0; t < 600 && !s2.reactor.scrammed; t += 0.1) s2.step(0.1, hot);
  s2.step(0.1, { ...hot, throttle: 1 });
  check(`on emergency power the engines still get thrust to withdraw`,
    s2.reactor.scrammed && s2.impulseFactor > 0.25, `impulse ${(s2.impulseFactor * 100).toFixed(0)}%`);

  const s3 = new ShipSystems({ seed: 1 });
  for (let t = 0; t < 4; t += 0.1) s3.step(0.1, hot);
  const shields = assessThreats(s3).find((x) => x.id === "shields");
  check(`falling shields get a countdown`, shields && shields.eta > 0 && shields.eta < 120, `eta ${shields?.eta?.toFixed(0)}s`);

  const s4 = new ShipSystems({ seed: 1 });
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

console.log("\n10. Personnel files and the career");
{
  const c = newCareer(42);
  const crew = crewProfiles(c);
  const today = c.day;
  check(`a new career fills all forty posts`, crew.length === 40 && crew.every((p) => p.status.state === "active"));
  check(`profiles are internally consistent (no future events, adults, educated, posted aboard)`,
    crew.every((p) => p.timeline.every((e) => e.day <= today) && ageOn(p, today) >= 18 && p.education.length > 0 &&
      p.serviceRecord.some((s) => s.ship === "USS Meridian" && s.toDay == null)));
  check(`children are younger than their parent by 18+ years`,
    crew.every((p) => p.family.children.every((k) => (k.birthDay - p.identity.birthDay) / 365.25 >= 18)));
  check(`seniority shows in skill: the Chief Engineer outranks the newest technician`,
    skillLevel(crew.find((p) => p.post.slot === "engineering-0"), "reactor-ops") > skillLevel(crew.find((p) => p.post.slot === "engineering-9"), "reactor-ops"));

  // A career survives being saved and loaded as JSON.
  const round = migrateCareer(JSON.parse(JSON.stringify(c)));
  check(`the career round-trips through JSON`, JSON.stringify(round) === JSON.stringify(c));

  // Fly a mission where two die and one is badly hurt.
  const m1 = startMission(c);
  const s = new ShipSystems({ profiles: m1.crew, day: c.day });
  const [a, b, hurt] = s.roster.crew;
  a.health = 0; a.diedAt = 30; a.cause = "radiation";
  b.health = 0; b.diedAt = 31; b.cause = "breach";
  hurt.health = 0.2; hurt.cause = "heat"; hurt.dose = 0.4;
  checkpoint(c, s.roster);
  const deadIds = [a.id, b.id];
  const m2 = startMission(c); // finalizes mission 1 first
  check(`the dead are recorded, memorialized and their posts refilled`,
    deadIds.every((id) => c.profiles[id].status.state === "deceased" && c.memorial.includes(id)) &&
    m2.transfers.length === 2 && crewProfiles(c).length === 40,
    `${m2.transfers.length} transfers`);
  const hp = c.profiles[hurt.id];
  check(`survivors' files record the mission, the injury, the dose and a ribbon`,
    hp.stats.missions === 1 && hp.medical.injuries.some((x) => /Critically injured/.test(x.text)) &&
    hp.awards.some((x) => x.id === "line-of-duty") && hp.timeline.some((e) => e.type === "dose" && e.data.sv === 0.4));
  check(`transfers say they transferred in`, m2.transfers.every((p) => p.timeline.some((e) => /Transferred to USS Meridian/.test(e.text))));
  check(`the injured come back partly recovered`, hp.medical.health > 0.2 && hp.medical.health <= 1, `${hp.medical.health}`);

  // Reassignment needs the skill, and changes who staffs what.
  const s2 = new ShipSystems({ profiles: m2.crew, day: c.day });
  const crossTrained = m2.crew.find((p) => p.post.shift === "alpha" && qualifiedDepts(p).some((d) => d === "engineering" && p.post.dept !== "engineering"));
  if (crossTrained) {
    const before = s2.roster.staffing("engineering");
    reassign(c, crossTrained.id, "engineering");
    s2.roster.reassign(crossTrained.id, "engineering");
    check(`a cross-trained crew member can cover Engineering`, s2.roster.staffing("engineering") > before &&
      crossTrained.post.assignedDept === "engineering" && crossTrained.timeline.at(-1).type === "reassigned");
  } else {
    check(`a cross-trained crew member can cover Engineering`, false, "no one cross-trained in this seed");
  }
}

console.log("\n11. Watches, learning by doing, and repairs");
{
  const quiet = { mode: "impulse", throttle: 0, flux: { heat: 0, rad: 0 } };
  const run = (ship, secs, env = quiet) => { for (let t = 0; t < secs; t += 0.1) ship.step(0.1, env); };

  // Watches: a third of the crew at their posts, changing over on the clock.
  const w = new ShipSystems({ seed: 8, hour: 15.5 });
  const onAt = (ship) => ship.roster.crew.filter((m) => m.location === "station");
  check(`at 1530 only alpha watch is at their posts, the rest in quarters`,
    onAt(w).every((m) => m.shift === "alpha") && w.roster.crew.filter((m) => m.location === "quarters").length > 20, `${onAt(w).length} on watch`);
  const snap = JSON.parse(JSON.stringify(w.snapshot()));
  check(`the snapshot for the UI carries watches and the clock`, snap.roster.shift === "alpha" && snap.roster.clock.hour === 15.5 &&
    snap.roster.crew.every((m) => typeof m.onWatch === "boolean" && m.skill >= 0 && !m.profile) && snap.repairs != null);
  check(`a full watch staffs every department`, ["engineering", "tactical", "operations", "helm"].every((d) => w.roster.staffing(d) > 0.7));
  let said = [];
  w.onEvent = (k, msg) => said.push(msg);
  run(w, 40); // 40 ship minutes
  check(`at 1600 beta watch takes over`, onAt(w).every((m) => m.shift === "beta") && said.some((x) => /Beta watch has the ship/.test(x)), `${onAt(w).length} on watch`);

  // All hands: everyone at their post, and they tire.
  const ah = new ShipSystems({ seed: 8, hour: 9 });
  const before = onAt(ah).length;
  ah.roster.callAllHands();
  check(`call all hands brings the off watch to their stations`, onAt(ah).length > 2 * before, `${before} → ${onAt(ah).length}`);
  run(ah, 18 * 60); // 18 ship hours, to 0300
  const tired = ah.roster.stationFatigue();
  check(`...and the alert board says to stand down`, assessThreats(ah).some((t) => t.action === "stand down"), `fatigue ${tired.toFixed(2)}`);
  ah.roster.standDown();
  const fresh = new ShipSystems({ seed: 8, hour: 3 });
  check(`a crew kept at stations pays for it: the watch left on duty is worn out`,
    ah.roster.staffing("engineering") < 0.85 * fresh.roster.staffing("engineering"),
    `engineering ${ah.roster.staffing("engineering").toFixed(2)} vs ${fresh.roster.staffing("engineering").toFixed(2)} rested`);
  check(`stand down sends the off watch to quarters to rest`, onAt(ah).every((m) => ah.roster.onWatch(m)) && ah.roster.crew.some((m) => m.location === "quarters"));
  const r0 = ah.roster.crew.find((m) => m.location === "quarters").fatigue;
  run(ah, 4 * 60);
  check(`...where they recover`, ah.roster.crew.filter((m) => m.location === "quarters").every((m) => m.fatigue < r0));

  // Shelter takes everyone, and an evacuated section stays clear through a watch change.
  const sh = new ShipSystems({ seed: 8, hour: 7.8 });
  sh.roster.shelterSection("port");
  run(sh, 30);
  check(`an evacuated section stays clear across a watch change`, !sh.roster.crew.some((m) => m.health > 0 && m.location !== "shelter" && sh.roster.whereIs(m) === "port"));
  sh.roster.shelterAll();
  check(`all hands to shelter takes the off watch too`, sh.roster.crew.every((m) => m.location === "shelter" || m.location === "sickbay"));
  sh.roster.resumeStations();
  check(`resume stations sends people back to posts and quarters`, onAt(sh).length > 5 && sh.roster.crew.some((m) => m.location === "quarters"));

  // Learning by doing: watches teach, and teach more under strain.
  const calm = new ShipSystems({ seed: 9, hour: 9 }), hot = new ShipSystems({ seed: 9, hour: 9 });
  hot.heat = 0.8;
  check(`a reactor running hot is a department under strain`, hot.strain("engineering") === 3 && calm.strain("engineering") === 1);
  hot.strain = (d) => (d === "engineering" ? 3 : 1); // hold it there for the comparison
  run(calm, 6 * 60); run(hot, 6 * 60);
  const engXp = (ship) => ship.roster.crew.filter((m) => m.homeDept === "engineering" && m.location === "station")
    .reduce((a, m) => a + (m.xp["reactor-ops"] ?? 0), 0);
  check(`hours on watch are practice in their duties`, engXp(calm) > 0, `${engXp(calm).toFixed(1)} xp`);
  check(`...and fighting a problem teaches faster`, engXp(hot) > 2 * engXp(calm), `${engXp(hot).toFixed(1)} vs ${engXp(calm).toFixed(1)}`);

  // Repairs: the watch fixes things, all hands faster, the focus first.
  const dmg = (allHands) => {
    const ship = new ShipSystems({ seed: 10, hour: 9 });
    if (allHands) ship.roster.callAllHands();
    ship.health.reactor = 0.4; ship.health.radiators = 0.4;
    run(ship, 120);
    return ship;
  };
  const watch = dmg(false), all = dmg(true);
  check(`the watch repairs damaged components`, watch.health.reactor > 0.5, `reactor 0.40 → ${watch.health.reactor.toFixed(2)}`);
  check(`all hands repairs faster`, all.health.reactor - 0.4 > 1.8 * (watch.health.reactor - 0.4), `${all.health.reactor.toFixed(2)} vs ${watch.health.reactor.toFixed(2)}`);
  check(`repair work is practice for whoever did it`, all.roster.crew.some((m) => (m.xp["damage-control"] ?? 0) > 0));
  const foc = new ShipSystems({ seed: 10, hour: 9 });
  foc.health.reactor = 0.4; foc.health.radiators = 0.4;
  foc.setRepairFocus("radiators");
  run(foc, 120);
  check(`repair <x> puts the crews on it first`, foc.health.radiators - 0.4 > 1.5 * (foc.health.reactor - 0.4), `radiators ${foc.health.radiators.toFixed(2)}, reactor ${foc.health.reactor.toFixed(2)}`);
  const br = new ShipSystems({ seed: 10, hour: 9 });
  br.hull.fore = 0.2;
  br.roster.callAllHands(br.breached()); // nobody goes to a post that's open to space
  const keptOut = br.roster.crew.filter((m) => m.homeDept === "science" && m.location === "shelter").length;
  said = [];
  br.onEvent = (k, msg) => said.push(msg);
  run(br, 200);
  check(`damage control seals a breach`, br.hull.fore >= 0.3 && said.some((x) => /Breach sealed — fore/.test(x)), `fore ${br.hull.fore.toFixed(2)}`);
  check(`once it's sealed, the crew kept out of that section go back to work`,
    keptOut === 5 && !br.roster.crew.some((m) => m.health > 0 && m.homeDept === "science" && m.location === "shelter") &&
    br.roster.staffing("science") > 0.7, `${keptOut} kept out; science ${br.roster.staffing("science").toFixed(2)} after`);
  const evaShip = new ShipSystems({ seed: 10, hour: 9 });
  evaShip.hull.aft = 0.6;
  run(evaShip, 5, { ...quiet, flux: { heat: 0, rad: 20 } });
  check(`hull work outside waits for the radiation to drop`, evaShip.repairs.aft.rate === 0 && /radiation|EVA/.test(evaShip.repairs.aft.blocked ?? ""), evaShip.repairs.aft.blocked);

  // The career: routine between missions, practice on file, cross-training.
  const c = newCareer(77);
  startMission(c);
  const p0 = crewProfiles(c)[5];
  const xp0 = Object.values(p0.skills).reduce((a, x) => a + x.xp, 0);
  const sh2 = new ShipSystems({ profiles: crewProfiles(c), day: c.day, hour: c.hour });
  const m0 = sh2.roster.find(p0.id);
  m0.xp["damage-control"] = 40.6;
  checkpoint(c, sh2.roster);
  finalizeMission(c);
  check(`a mission's practice goes on file`, p0.timeline.some((e) => e.type === "practice" && /^Mission 1/.test(e.text) && e.data.xp["damage-control"] === 40));
  const target = Object.keys(CORE_SKILL).find((d) => d !== p0.post.dept && d !== "command" && skillLevel(p0, CORE_SKILL[d]) < 2);
  crossTrain(c, p0.id, target);
  const tXp = p0.skills[CORE_SKILL[target]]?.xp ?? 0;
  const hour0 = c.hour;
  startMission(c, () => 0.99); // ten days between missions
  const xp1 = Object.values(p0.skills).reduce((a, x) => a + x.xp, 0);
  check(`the days between missions are practice too`, xp1 > xp0 && p0.timeline.some((e) => e.type === "practice" && /^Routine duties/.test(e.text)), `+${xp1 - xp0} xp`);
  check(`cross-training goes to the chosen department's skill`, (p0.skills[CORE_SKILL[target]]?.xp ?? 0) > tXp && p0.post.crossTrain === CORE_SKILL[target], `${target}`);
  check(`a mission can start on any watch`, c.hour !== hour0 && c.hour >= 0 && c.hour < 24, `${c.hour}`);

  // Saves from before watches existed load, and get them.
  const old = JSON.parse(JSON.stringify(newCareer(5)));
  old.version = 1; delete old.hour;
  for (const p of Object.values(old.profiles)) { p.schemaVersion = 1; delete p.post.shift; delete p.post.crossTrain; }
  migrateCareer(old);
  check(`a pre-watch save migrates: everyone gets their post's watch`, old.hour === 8 &&
    Object.values(old.profiles).every((p) => ["alpha", "beta", "gamma"].includes(p.post.shift) && p.schemaVersion === 2));
}

console.log("\n12. Hand-placed bodies");
{
  const rose = objects.find((o) => o.name === "Isla");
  const parent = rose && byId[rose.parent];
  check(`Altair 70 has its pink moon, Isla`, rose?.type === "moon" && rose.color === "#ff4fa8" && parent?.name === "Altair 70 V");
  const siblings = objects.filter((o) => o.parent === rose?.parent && o.id !== rose.id);
  check(`...in a clear orbit, outside its planet`, rose.orbit.radius > parent.size * 2 &&
    siblings.every((o) => Math.abs(o.orbit.radius - rose.orbit.radius) > 1), `r ${rose.orbit.radius}, planet size ${parent.size.toFixed(2)}`);
}

{
  const lava = objects.find((o) => o.name === "Graham");
  const planet = lava && byId[lava.parent];
  check(`Solace Major 37 has its lava moon, Graham, with volcanoes and a song`, lava?.kind === "lava" && lava.volcanoes === 2 &&
    lava.song === "waltz" && planet?.name === "Solace Major 37 I");
  check(`...in a clear orbit, outside its planet`, lava.orbit.radius > planet.size * 2 &&
    objects.filter((o) => o.parent === lava.parent && o.id !== lava.id).every((o) => Math.abs(o.orbit.radius - lava.orbit.radius) > 1));
}

console.log("\n13. Wear and tear");
{
  const quiet = { mode: "impulse", throttle: 0.3, flux: { heat: 0, rad: 0 } };
  const run = (ship, secs, env = quiet) => { for (let t = 0; t < secs; t += 0.1) ship.step(0.1, env); };
  const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  const off = new ShipSystems({ seed: 11, hour: 9 });
  run(off, 600);
  check(`without faults on, nothing breaks by itself`, off.wear === null && Object.values(off.health).every((v) => v === 1));

  // Half an hour of ordinary flying: things break, and the crews fix them.
  const said = [];
  const on = new ShipSystems({ seed: 11, hour: 9, faults: true, random: rng(3), onEvent: (k, m) => said.push(m) });
  run(on, 1800);
  const faults = said.filter((m) => /^Fault — /.test(m));
  check(`with faults on, systems fault now and then`, faults.length >= 3 && faults.length <= 20, `${faults.length} in 30 min: ${faults.slice(0, 3).join(" | ")}`);
  check(`...and the watch crews repair them`, said.some((m) => /Repairs complete|contained/.test(m)) &&
    Object.values(on.health).filter((v) => v < 0.5).length <= 1, Object.entries(on.health).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", "));

  // A spreading fault: contained by the crew, then repaired, then the wear starts again.
  const leak = (setup) => {
    const ship = new ShipSystems({ seed: 12, hour: 9, faults: true, random: () => 0.99 });
    setup?.(ship);
    ship.health.reactor = 0.8;
    ship.wear.cause.reactor = "coolant pump seized";
    ship.wear.active.reactor = { name: "coolant pump seized", spread: 0.004, work: 40, done: 0, at: 0 };
    return ship;
  };
  const fixed = leak();
  check(`a spreading fault goes on the alert list, with the order to fix it`,
    assessThreats(fixed).some((t) => t.id === "fault-reactor" && t.action === "repair reactor"));
  fixed.roster.callAllHands();
  const log = [];
  let wearAtRepair = null;
  fixed.onEvent = (k, m) => { log.push(m); if (/Repairs complete — reactor/.test(m)) wearAtRepair = fixed.wear.wear.reactor; };
  run(fixed, 900);
  check(`...the crew contain it, repair it, and its wear starts over`, log.some((m) => /coolant pump seized — contained/.test(m)) &&
    !fixed.wear.active.reactor && fixed.health.reactor >= 0.999 && wearAtRepair === 0 && !fixed.wear.cause.reactor,
    `reactor ${fixed.health.reactor.toFixed(3)}, wear at repair ${wearAtRepair}`);
  const alone = leak((ship) => ship.roster.shelterAll());
  run(alone, 120);
  const t2 = assessThreats(alone).find((t) => t.id === "fault-reactor");
  check(`with nobody at their posts it keeps spreading, and goes red`, alone.health.reactor < 0.4 && alone.wear.active.reactor &&
    t2?.level === "red", `reactor ${alone.health.reactor.toFixed(2)}, ${t2?.level} — ${t2?.detail}`);

  // Short-handed departments keep up with less maintenance.
  const full = new ShipSystems({ seed: 13, hour: 9, faults: true, random: () => 0.99 });
  const thin = new ShipSystems({ seed: 13, hour: 9, faults: true, random: () => 0.99 });
  thin.roster.shelterAll();
  const w0 = full.wear.wear.comms;
  run(full, 300); run(thin, 300);
  check(`an unmanned department's systems wear faster`, thin.wear.wear.comms - w0 > 1.3 * (full.wear.wear.comms - w0),
    `${(thin.wear.wear.comms - w0).toFixed(3)} vs ${(full.wear.wear.comms - w0).toFixed(3)}`);
}

console.log("\n14. The magnify order");
{
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const cases = [
    ["", {}], ["off", { reset: true }], ["reset", { reset: true }],
    ["in", { step: 2 }], ["out", { step: 0.5 }],
    ["4", { zoom: 4 }], ["x4", { zoom: 4 }], ["4x", { zoom: 4 }], ["2.5", { zoom: 2.5 }], ["400%", { zoom: 4 }],
    ["ahead", { ahead: true }],
    ["Erebus", { target: "Erebus" }], ["on Erebus", { target: "Erebus" }], ["at Altair 70", { target: "Altair 70" }],
    ["6 on Erebus", { zoom: 6, target: "Erebus" }], ["x6 Erebus", { zoom: 6, target: "Erebus" }],
    ["4 xeno", { zoom: 4, target: "xeno" }], ["4x xeno", { zoom: 4, target: "xeno" }],
    ["on", { error: "on" }],
  ];
  for (const [rest, want] of cases)
    check(`magnify "${rest}" → ${JSON.stringify(want)}`, same(parseMagnify(rest), want), JSON.stringify(parseMagnify(rest)));
  check(`zoom is clamped to 1–${MAX_ZOOM}`, clampZoom(0.2) === 1 && clampZoom(50) === MAX_ZOOM && clampZoom(3) === 3);
}

console.log("\n15. Coronal mass ejections hit the ship");
{
  // A cloud launched along +x from the origin; play it forward a tick at a time.
  const cloud = (o = {}) => ({ at: [0, 0, 0], d: [1, 0, 0], t0: 0, speed: 4, cone: 0.45, radius: 2, ...o });
  const play = (c, pos, until = 120, dt = 0.05) => {
    const hits = [];
    let firstEta = null;
    for (let t = 0; t < until; t += dt) {
      const s = cmeStep(c, typeof pos === "function" ? pos(t) : pos, t);
      if (firstEta == null && s.eta != null) firstEta = s.eta;
      if (s.hit) hits.push({ t, ...s });
    }
    return { hits, firstEta };
  };
  const onAxis = play(cloud(), [20, 0, 0]);
  check("a front reaching the ship hits it exactly once", onAxis.hits.length === 1, `${onAxis.hits.length} hits`);
  const h = onAxis.hits[0];
  check("the predicted ETA matches when it lands", h && Math.abs(onAxis.firstEta - h.t) < 0.2,
    `eta ${onAxis.firstEta?.toFixed(1)}s, landed ${h?.t.toFixed(1)}s`);
  check("the blow comes from the star's side", h && h.from[0] < -0.99, h && h.from.map((x) => x.toFixed(2)).join(","));
  check("outside the cone, nothing", play(cloud(), [0, 20, 0]).hits.length === 0);
  check("beyond where it gets before it fades, nothing",
    play(cloud(), [2000, 0, 0]).hits.length === 0 && cmeEta(cloud(), [2000, 0, 0], 0) == null);
  check("entering the cloud behind its front does nothing",
    play(cloud(), (t) => (t < 30 ? [0, 30, 0] : [20, 0, 0])).hits.length === 0);
  check("a faster cloud hits harder", cmeEnergy(cloud({ speed: 7 }), 12, 0) > 2.5 * cmeEnergy(cloud(), 12, 0));
  check("further out it's weaker", cmeEnergy(cloud(), 60, 0) < 0.15 * cmeEnergy(cloud(), 12, 0));
  check("the flanks are weaker than the nose", cmeEnergy(cloud(), 12, 0.9) < cmeEnergy(cloud(), 12, 0));
  check("the front accelerates, then coasts",
    frontReach(1, 4) < 0.5 * 4 && Math.abs(frontReach(61, 4) - frontReach(60, 4) - 0.95 * 4) < 0.01);

  // Through ship.hit(): an ordinary one at 12u is soaked by full shields;
  // a giant one on half shields gets through, damages the hull and doses the crew.
  const ordinary = new ShipSystems({ seed: 7 });
  const r1 = ordinary.hit({ ...cmeEffects(cmeEnergy(cloud({ speed: 3.75 }), 12, 0)), from: [-1, 0, 0], facing: [1, 0, 0] });
  check("an ordinary eruption at 12u: full shields hold", r1.through === 0 && ordinary.shields < 1, `shields ${ordinary.shields.toFixed(2)}`);
  const giant = new ShipSystems({ seed: 7 });
  giant.shields = 0.5;
  const dose = () => giant.roster.alive().reduce((a, m) => a + m.dose, 0);
  const dose0 = dose();
  const r2 = giant.hit({ ...cmeEffects(cmeEnergy(cloud({ speed: 7.5, cone: 0.3 }), 12, 0)), from: [-1, 0, 0], facing: [1, 0, 0] });
  check("a giant one on half shields gets through to the hull", r2.through > 0 && giant.hull.aft < 1, `aft hull ${giant.hull.aft.toFixed(2)}`);
  check("...doses the crew", dose() > dose0);
  check("...and fills comms with static", giant.interference > 0.3, giant.interference.toFixed(2));

  const warned = new ShipSystems({ seed: 7 });
  warned.shields = 0.2;
  warned.incoming = [{ kind: "cme", source: "Testar", eta: 42, energy: 0.6 }];
  const t = assessThreats(warned).find((x) => x.id === "cme");
  check("an inbound CME is a red alert, with an ETA, when shields won't hold",
    t && t.level === "red" && t.eta === 42 && t.action === "power shields 150", t && `${t.level} · ${t.action}`);
}

console.log("\n16. A Collective cube");
{
  const cube = (o = {}) => new Cube({ pos: [0, 0, 0], post: [0, 0, 0], seed: 3, random: mulberry32(9), ...o });
  const c = cube();
  const roles = {};
  for (const b of c.blocks) roles[b.role] = (roles[b.role] ?? 0) + 1;
  check("160 blocks: a 152-block shell and an 8-block core", c.blocks.length === 160 && roles.core === 8, JSON.stringify(roles));
  check("every face has 4 emitters, a tractor node and a regen node",
    ["px", "nx", "py", "ny", "pz", "nz"].every((f) => c.live(f, "emitter").length === 4 && c.live(f, "tractor").length === 1 && c.live(f, "regen").length === 1));
  check("the same seed builds the same cube", JSON.stringify(cube().blocks.map((b) => b.role)) === JSON.stringify(c.blocks.map((b) => b.role)));

  // Run a cube against a ship sitting still at `at`, collecting events.
  const run = (cb, at, secs, ship = {}) => {
    const ev = [];
    for (let t = 0; t < secs; t += 0.1) ev.push(...cb.step(0.1, { pos: at, facing: [0, 0, 1], mode: "impulse", ...ship }));
    return ev;
  };
  const guard = cube();
  check("a guard sleeps while you're beyond detection range", run(guard, [DETECT + 10, 0, 0], 20).length === 0 && guard.mode === "dormant");
  const ev = run(guard, [DETECT - 5, 0, 0], 60);
  check("...wakes, and hails once, when you come in range", ev.filter((e) => e.type === "hail").length === 1);
  const d = Math.hypot(...guard.pos.map((x, i) => x - [DETECT - 5, 0, 0][i]));
  check("...closes to holding range (just above you)", Math.abs(d - HOLD) < 0.3, `${d.toFixed(2)}u`);
  const shots = ev.filter((e) => e.type === "fire");
  check("...and cuts at you once in weapons range", shots.length > 3, `${shots.length} shots`);
  check("its beams come from its side of the ship", shots.every((s) => s.from[0] < -0.5));
  check("...and it locks a tractor beam on at close range", ev.some((e) => e.type === "tractor" && e.on) && guard.tractor);

  // Its whole battery through the ship: shields go, then the hull facing it.
  const s = new ShipSystems({ seed: 7 });
  const g2 = cube({ pos: [-HOLD, 0, 0], post: null });
  for (let t = 0; t < 150; t += 0.1) {
    for (const e of g2.step(0.1, { pos: [0, 0, 0], facing: [0, 0, 1], mode: "impulse" }))
      if (e.type === "fire") s.hit({ energy: e.energy, from: e.from, facing: [0, 0, 1] });
    s.step(0.1, { mode: "impulse", throttle: 0, flux: { heat: 0, rad: 0 } });
  }
  check("150 s under its guns: shields down, and only the hull facing it damaged", s.shields < 0.3 && s.hull.starboard < 0.9 && s.hull.port === 1,
    `shields ${s.shields.toFixed(2)}, port hull ${s.hull.port.toFixed(2)}, starboard ${s.hull.starboard.toFixed(2)}`);

  // The tractor: no warp, impulse dragged; overdrive at full impulse breaks free.
  const held = new ShipSystems({ seed: 7 });
  held.tractored = true;
  held.step(0.1, { mode: "impulse", throttle: 1, flux: { heat: 0, rad: 0 } });
  check("held in a tractor beam: warp off-line, impulse dragged", held.warpInhibit === "held by tractor beam" && held.impulseFactor < 0.2,
    `${held.warpInhibit} · impulse ${held.impulseFactor.toFixed(2)}`);
  const t3 = cube({ pos: [-HOLD, 0, 0], post: null });
  run(t3, [0, 0, 0], 3);
  const freeEv = run(t3, [0, 0, 0], 10, { straining: true });
  check("straining against it tears the ship free", freeEv.some((e) => e.type === "tractor" && !e.on && e.why === "broke free"));
  const relock = run(t3, [0, 0, 0], 10);
  check("...and it can't lock on again straight away", !relock.some((e) => e.type === "tractor" && e.on));
  const nodes = cube({ pos: [-HOLD, 0, 0], post: null });
  for (const b of nodes.blocks) if (b.role === "tractor") b.hp = 0;
  check("with its tractor nodes destroyed it can't hold you", !run(nodes, [0, 0, 0], 20).some((e) => e.type === "tractor" && e.on));

  // Damage, regeneration, and the core.
  const dmg = cube();
  for (let i = 0; i < 40; i++) dmg.damage("px", 0.5);
  check("enough damage to a face breaches it", dmg.integrity("px") < 0.4, dmg.integrity("px").toFixed(2));
  check("the core is only hit through a breached face", cube().blocks.filter((b) => b.role === "core").every((b) => b.hp === 1) &&
    dmg.blocks.some((b) => b.role === "core" && b.hp < 1));
  const regen = cube();
  const near = regen.blocks.find((b) => b.role === "plate" && regen.blocks.some((r) => r.role === "regen" && Math.max(...r.cell.map((x, i) => Math.abs(x - b.cell[i]))) <= 1));
  near.hp = 0.5;
  run(regen, [DETECT + 10, 0, 0], 10);
  check("a regen node regrows damaged blocks near it", near.hp > 0.55, near.hp.toFixed(2));
  const far = cube({ pos: [0, 0, 0], post: null });
  const lostEv = run(far, [LOSE + 5, 0, 0], 1);
  check("beyond range it loses you", lostEv.some((e) => e.type === "lost") && far.mode === "lost");

  // Where they come from.
  const posOf = (o) => positionAt(o, byId, 0);
  const stars = objects.filter((o) => o.type === "star");
  const home = stars[0];
  const held3 = collectiveSystems(stars, home, posOf);
  check("three Collective systems, all far from home, always the same three",
    held3.length === 3 && held3.every((s) => dist(posOf(s), posOf(home)) > 400) &&
    JSON.stringify(collectiveSystems(stars, home, posOf).map((s) => s.id)) === JSON.stringify(held3.map((s) => s.id)),
    held3.map((s) => s.name).join(", "));
  const col = new Collective({ stars, home, posOf, random: mulberry32(4) });
  const atHeld = posOf(held3[0]);
  const spawnEv = col.step(0.1, { pos: [atHeld[0] + 100, atHeld[1], atHeld[2]], mode: "impulse" });
  check("coming near a Collective system brings out its guard", spawnEv.some((e) => e.type === "spawn" && !e.roaming) && col.cube?.mode === "dormant");

  // Roamers: never in home space, never at warp, and a cooldown after each.
  const roamAt = (pos, mode, secs) => {
    const r = new Collective({ stars, home, posOf, random: mulberry32(11) });
    let n = 0;
    for (let t = 0; t < secs; t += 1) for (const e of r.step(1, { pos, mode })) if (e.type === "spawn" && e.roaming) n++;
    return { n, r };
  };
  const hp = posOf(home);
  // Somewhere outside home space and far from every Collective system.
  const away = [hp[0] + HOME_SPACE + 50, hp[1], hp[2]];
  check("no roamer in home space, however long", roamAt(hp, "impulse", 20000).n === 0);
  check("no roamer while at warp", roamAt(away, "warp", 20000).n === 0);
  const { n, r } = roamAt(away, "impulse", 20000);
  check("outside home space, the odd roamer turns up", n >= 1, `${n} in ~5.5 h`);
  r.cube && (r.cube.mode = "lost");
  r.step(1, { pos: away, mode: "impulse" });
  let again = false;
  for (let t = 0; t < ROAM_COOLDOWN - 5; t += 1) if (r.step(1, { pos: [1e6, 0, 0], mode: "impulse" }).some((e) => e.type === "spawn")) again = true;
  check("...and none for a while after one breaks off", !again);

  // The alerts.
  const a = new ShipSystems({ seed: 7 });
  a.incoming = [{ kind: "cube", name: "Collective cube", dist: 40, eta: 15, tractor: false, strain: 0 }];
  a.step(0.1, { mode: "impulse", throttle: 0, flux: { heat: 0, rad: 0 } });
  const ct = assessThreats(a).find((x) => x.id === "cube");
  check("a closing cube is a red alert with time to weapons range, and the advice to warp out",
    ct && ct.level === "red" && ct.eta === 15 && ct.action === "warp 3", ct && `${ct.title} · ${ct.action}`);
  a.tractored = true;
  a.step(0.1, { mode: "impulse", throttle: 0, flux: { heat: 0, rad: 0 } });
  const tt = assessThreats(a).find((x) => x.id === "tractor");
  check("held: the tractor alert says how to break free", tt && tt.action === "reactor 120", tt && tt.action);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
