// helm.js — a text-mode cockpit for the flight engine. Fly the real universe
// from the command line, before the rendered view exists.
//   node src/universe/helm.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import readline from "node:readline";
import { FlightSim } from "./sim.js";
import { positionAt, magnitude } from "./physics.js";

const here = dirname(fileURLToPath(import.meta.url));
const universe = JSON.parse(readFileSync(join(here, "universe.json"), "utf8"));
const byId = Object.fromEntries(universe.objects.map((o) => [o.id, o]));
const stars = universe.objects.filter((o) => o.type === "star");

// Home port: the star with the most planets. Start holding at its outer planet.
const homeStar = stars
  .map((s) => ({ s, n: universe.objects.filter((o) => o.parent === s.id && o.type === "planet").length }))
  .sort((a, b) => b.n - a.n)[0].s;
const homePlanet = universe.objects
  .filter((o) => o.parent === homeStar.id && o.type === "planet")
  .sort((a, b) => b.orbit.radius - a.orbit.radius)[0];

const sim = new FlightSim(universe, {
  startPos: positionAt(homePlanet || homeStar, byId, 0),
  maxWarp: 3
});

const dist = (a, b) => magnitude([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
const bearing = (from, to) => {
  let a = (Math.atan2(to[2] - from[2], to[0] - from[0]) * 180) / Math.PI;
  return ((a % 360) + 360) % 360;
};
const nearestBody = (max = 60) => {
  let best = null, bd = Infinity;
  for (const o of universe.objects) {
    if (o.id === "sgr-a-star") continue;
    const d = dist(sim.pos, positionAt(o, byId, sim.t));
    if (d < bd) { bd = d; best = o; }
  }
  return bd <= max ? { o: best, d: bd } : null;
};

// Advance the sim, printing any new order/arrival events, until an arrival lands
// or maxS game-seconds pass.
function cruise(maxS) {
  const start = sim.events.length;
  const steps = Math.round(maxS / 0.5);
  for (let i = 0; i < steps; i++) {
    sim.step(0.5);
    if (sim.events.length > start &&
        sim.events[sim.events.length - 1].kind === "arrive") break;
  }
  for (let i = start; i < sim.events.length; i++) {
    const e = sim.events[i];
    console.log(`   » ${e.msg}`);
  }
}

function status() {
  const near = nearestBody(1e9);
  const s = sim.snapshot();
  const warp = sim.canEngageWarp()
    ? "READY"
    : "BLOCKED (in a gravity well — impulse to clear)";
  console.log(
    `\n  ── ${universe.objects.find(o=>o.id==="sgr-a-star") ? "USS Meridian" : "ship"} ──` +
    `\n   mode: ${s.mode}${s.mode === "impulse" ? `  throttle ${Math.round(s.throttle*100)}%` : ""}` +
    `   speed ${s.speed.toFixed(2)} u/s` +
    `\n   nearest: ${near.o.name} (${near.o.type}) — ${near.d.toFixed(1)} units, bearing ${bearing(sim.pos, positionAt(near.o, byId, sim.t)).toFixed(0)}°` +
    `\n   warp: ${warp}\n`
  );
}

function nav() {
  const list = stars
    .map((s) => ({ s, d: dist(sim.pos, positionAt(s, byId, sim.t)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 8);
  console.log("\n  NEARBY STARS (name — distance — bearing):");
  for (const { s, d } of list) {
    console.log(`   ${s.name.padEnd(18)} ${d.toFixed(0).padStart(5)}u   ${bearing(sim.pos, positionAt(s, byId, sim.t)).toFixed(0)}°   [${s.starClass}]`);
  }
  console.log("");
}

function scan() {
  const n = nearestBody(60);
  if (!n) { console.log("   Nothing within sensor range. Approach a body first.\n"); return; }
  console.log(`\n   SCAN — ${n.o.name} (${n.d.toFixed(1)} units):\n   ${n.o.scan || "No data."}\n`);
}

const THROTTLE = { full: 1, standard: 0.75, half: 0.5, third: 0.33, quarter: 0.25 };

function handle(line) {
  const t = line.trim().toLowerCase();
  if (!t) { cruise(15); status(); return; }

  let m;
  if (/^(quit|exit)$/.test(t)) { console.log("\n   Helm offline.\n"); rl.close(); return; }
  if (/^help$/.test(t)) { help(); return; }
  if (/^(status|report|where)/.test(t)) { status(); return; }
  if (/^(nav|map|chart|nearby)/.test(t)) { nav(); return; }
  if (/^scan/.test(t)) { scan(); return; }

  if ((m = t.match(/^advance\s+(\d+)/))) { cruise(+m[1]); status(); return; }

  if ((m = t.match(/^ahead\s+(full|standard|half|third|quarter)/))) {
    sim.ahead(THROTTLE[m[1]]); cruise(25); status(); return;
  }
  if (/^(all stop|full stop|hold)/.test(t)) { sim.allStop(); cruise(6); status(); return; }

  if ((m = t.match(/^(?:come about|approach|head|go)\s+(?:for\s+|to\s+|on\s+)?(.+)/))) {
    if (sim.comeAbout(m[1])) { cruise(400); status(); }
    else printLast();
    return;
  }
  if ((m = t.match(/^(?:engage\s+)?warp\s*(\d)?\s*(?:to\s+)?(.+)/))) {
    const factor = m[1] ? +m[1] : 2;
    if (sim.engageWarp(m[2], factor)) { cruise(2000); status(); }
    else printLast();
    return;
  }

  console.log('   Unrecognized order. Type "help".');
}

function printLast() {
  const e = sim.events[sim.events.length - 1];
  if (e) console.log(`   » ${e.msg}`);
}

function help() {
  console.log(`
  HELM ORDERS
   nav                     list nearby stars (name, distance, bearing)
   scan                    scan the nearest body
   status                  ship report
   ahead full|half|quarter set impulse speed
   all stop                halt and hold position
   come about for <name>   fly (impulse) to a body and hold station
   warp <1-3> to <name>    jump to a star (must clear gravity wells first)
   advance <seconds>       let time pass (planets move, you drift)
   <enter>                 advance a short while
   quit
`);
}

console.log(`\n  Bridge online. Holding station at ${(homePlanet||homeStar).name}.`);
console.log(`  Type "nav" to see where you can go, or "help" for orders.`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "\n  CONN ▸ " });
rl.prompt();
rl.on("line", (line) => { handle(line); rl.prompt(); });
rl.on("close", () => process.exit(0));
