// calibrate.js — answers "what warp cap feels right?" with numbers from the
// actual generated galaxy.  node src/universe/calibrate.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { positionAt, gravityOnShip, magnitude } from "./physics.js";
import { warpSpeed, travelTime, stepImpulse, DEFAULT_FLIGHT } from "./flight.js";

const here = dirname(fileURLToPath(import.meta.url));
const universe = JSON.parse(readFileSync(join(here, "universe.json"), "utf8"));
const objects = universe.objects;
const byId = Object.fromEntries(objects.map((o) => [o.id, o]));
const stars = objects.filter((o) => o.type === "star");

const fmt = (s) =>
  s === Infinity ? "—" : s < 90 ? `${s.toFixed(0)}s` : `${(s / 60).toFixed(1)}m`;

// --- measure real star spacing ----------------------------------------------
const pos = stars.map((s) => positionAt(s, byId, 0));
const nn = [];
for (let i = 0; i < pos.length; i++) {
  let best = Infinity;
  for (let j = 0; j < pos.length; j++) {
    if (i === j) continue;
    const d = Math.hypot(
      pos[i][0] - pos[j][0], pos[i][1] - pos[j][1], pos[i][2] - pos[j][2]
    );
    if (d < best) best = d;
  }
  nn.push(best);
}
nn.sort((a, b) => a - b);
const median = nn[Math.floor(nn.length / 2)];
const galaxy = universe.bounds * 2;

console.log(`\nGalaxy: ${stars.length} stars, ${universe.bounds}-unit radius`);
console.log(`Nearest-neighbour star gap: median ${median.toFixed(0)}, ` +
  `min ${nn[0].toFixed(0)}, max ${nn[nn.length - 1].toFixed(0)} units`);
console.log(`Full galaxy crossing: ${galaxy} units\n`);

// --- travel-time table by warp factor ---------------------------------------
console.log("Warp   speed(u/s)   neighbour hop   galaxy crossing");
for (const w of [1, 2, 3, 4, 5]) {
  const v = warpSpeed(w);
  console.log(
    `  ${w}      ${v.toFixed(1).padStart(6)}       ${fmt(travelTime(median, v)).padStart(7)}` +
    `         ${fmt(travelTime(galaxy, v)).padStart(7)}`
  );
}
const imp = DEFAULT_FLIGHT.impulseMax;
console.log(`\nImpulse (${imp} u/s): crosses a typical system (~40 units) in ` +
  `${fmt(travelTime(40, imp))}.`);

// --- slingshot proof: gravity curves an impulse trajectory ------------------
console.log("\nSlingshot test — coast past a black hole, no thrust:");
const bh = objects.find((o) => o.type === "blackhole" && o.parent);
const bhPos = positionAt(bh, byId, 0);
let ship = {
  pos: [bhPos[0] - 60, bhPos[1] + 26, bhPos[2]], // offset, aimed to pass by
  vel: [3, 0, 0]                                  // moving +x past it
};
const vStart = [...ship.vel];
for (let i = 0; i < 600; i++) {
  const g = gravityOnShip(ship.pos, [bh], byId, 0).accel;
  ship = stepImpulse(ship, 0.1, [0, 0, 0], g); // coast (no thrust clamp)
}
const ang = (a, b) => {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (Math.acos(dot / (magnitude(a) * magnitude(b))) * 180) / Math.PI;
};
console.log(`  velocity turned ${ang(vStart, ship.vel).toFixed(1)}° and ` +
  `changed speed ${magnitude(vStart).toFixed(2)} -> ${magnitude(ship.vel).toFixed(2)} u/s`);
console.log(`  (deflection + speed change = a real gravitational slingshot)\n`);
