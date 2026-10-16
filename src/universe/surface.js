// surface.js — what it's like to stand on a body: whether you can, the air,
// what the place does to people, how it looks, and where to land.
//
// Pure, seeded from the body's id, so the same planet always has the same
// landing sites. The renderer (flight/SurfaceScene.jsx) draws from these
// tables; away.js applies the hazards.

import { hashString, rng, makeTerrain, SITE_RADIUS } from "./terrain.js";

// The surface kind a body is drawn and generated as — the same names
// planetShader.js uses (moons get a "moon-" prefix). null: you can't land.
export function surfaceKind(body) {
  if (!body) return null;
  if (body.type === "moon") return `moon-${body.kind || "cratered"}`;
  if (body.type === "planet" && body.kind !== "gas giant") return body.kind;
  return null;
}
export const landable = (body) => surfaceKind(body) != null;

// Per kind:
//   air      breathable | thin | toxic | none
//   suit     seconds of suit air, or null when nobody needs a suit
//   tire     fatigue multiplier while down (heat, cold, hard going)
//   gravity  relative to standard — sets walking pace a little
//   ground   [low, high, rock] colours for the terrain
//   sky      [zenith, horizon] by day; airless skies are black
//   fog      haze colour and how far you can see (m)
//   water    colour of any open water
export const ENV = {
  "class-M":       { label: "Temperate", air: "breathable", suit: null, tire: 1,   gravity: 1,    ground: ["#3f6b34", "#7a8a52", "#6d6559"], sky: ["#3d78c9", "#a9c8e8"], fog: ["#a9c3dc", 700], water: "#2d5d86" },
  ocean:           { label: "Coastal",   air: "breathable", suit: null, tire: 1,   gravity: 1,    ground: ["#c9b98a", "#4f7a3e", "#6b6a63"], sky: ["#3a7fd0", "#b4d4ef"], fog: ["#b4cde0", 650], water: "#1f5a8c" },
  desert:          { label: "Arid",      air: "thin",       suit: null, tire: 1.8, gravity: 0.9,  ground: ["#c99a5c", "#e0b878", "#8f6a45"], sky: ["#6a8fc0", "#e8c9a0"], fog: ["#e6c7a0", 800], water: null },
  toxic:           { label: "Toxic",     air: "toxic",      suit: 480,  tire: 1.3, gravity: 1.1,  ground: ["#5d6b2e", "#8fae54", "#4d4a3a"], sky: ["#8f9a3e", "#d8e070"], fog: ["#b8bf6a", 380], water: "#9bb030" },
  ice:             { label: "Frozen",    air: "thin",       suit: 720,  tire: 1.4, gravity: 0.95, ground: ["#8fb0c6", "#dfeaf2", "#5f7486"], sky: ["#4f74a3", "#c4d8e8"], fog: ["#c8d8e4", 900], water: null },
  rocky:           { label: "Barren",    air: "none",       suit: 600,  tire: 1.2, gravity: 0.8,  ground: ["#6e5a48", "#9c7a5a", "#4f4237"], sky: ["#000000", "#000000"], fog: null, water: null },
  "moon-cratered": { label: "Airless",   air: "none",       suit: 600,  tire: 1.1, gravity: 0.3,  ground: ["#6d7179", "#9a9ea6", "#55585e"], sky: ["#000000", "#000000"], fog: null, water: null },
  "moon-icy":      { label: "Ice moon",  air: "none",       suit: 600,  tire: 1.3, gravity: 0.25, ground: ["#9fb6c6", "#e2edf4", "#6f8292"], sky: ["#000000", "#000000"], fog: null, water: null },
  "moon-volcanic": { label: "Volcanic",  air: "toxic",      suit: 420,  tire: 1.5, gravity: 0.35, ground: ["#8a7a2e", "#d9b84a", "#3d3226"], sky: ["#2a2418", "#5a4a2a"], fog: ["#5a4a2a", 450], water: null },
  "moon-lava":     { label: "Molten",    air: "toxic",      suit: 360,  tire: 1.6, gravity: 0.35, ground: ["#2a2220", "#4a3a32", "#1a1412"], sky: ["#1a1210", "#4a2618"], fog: ["#4a2618", 420], water: null },
};
export const envFor = (body) => ENV[surfaceKind(body)] ?? null;

// Hazards near volcanic vents: heat harm (health/s) within this many metres.
export const VENT_RADIUS = 40;
export const VENT_HARM = 0.01;

const LETTERS = "ABCDE";
const FEATURES = {
  "class-M": ["river valley", "highland meadow", "forest edge", "lake shore"],
  ocean: ["headland", "tidal flats", "sea cliffs", "barrier island"],
  desert: ["dune sea", "salt pan", "mesa field", "dry riverbed"],
  toxic: ["sulphur flats", "fuming lowlands", "caustic marsh", "acid basin"],
  ice: ["glacier tongue", "pressure ridges", "frozen sea", "ice shelf"],
  rocky: ["impact plain", "scarp", "boulder field", "canyon rim"],
  "moon-cratered": ["crater floor", "highland", "rille", "ejecta field"],
  "moon-icy": ["fracture zone", "smooth plains", "ice cliffs", "crater rim"],
  "moon-volcanic": ["caldera rim", "lava plain", "sulphur field", "vent cluster"],
  "moon-lava": ["crust plain", "lava lake shore", "vent field", "cinder cones"],
};

// The places a team can beam to on a body: 3 of them, always the same.
// { id, name, lat, lon, feature, seed, kind }
export function landingSites(body) {
  const kind = surfaceKind(body);
  if (!kind) return [];
  const r = rng(hashString(`${body.id}:sites`));
  const feats = FEATURES[kind] ?? ["plain"];
  return [0, 1, 2].map((i) => {
    const lat = Math.round((r() * 140 - 70) * 10) / 10;
    const lon = Math.round((r() * 360 - 180) * 10) / 10;
    const feature = feats[Math.floor(r() * feats.length)];
    return {
      id: `${body.id}:site-${i}`,
      bodyId: body.id,
      letter: LETTERS[i],
      name: `Site ${LETTERS[i]}`,
      feature,
      lat, lon, kind,
      seed: hashString(`${body.id}:site-${i}`),
    };
  });
}
export const terrainFor = (site) => makeTerrain(site.kind, site.seed);

// Local time of day at a site: a slow day, seeded per body. Returns the sun
// as a unit vector in site coordinates (y up) and how high it is (−1..1).
// Real seconds, like the ship's own systems — a day is 20–40 minutes.
export function sunAt(site, t) {
  const r = rng(site.seed ^ 0x51ed);
  const day = 1200 + r() * 1200;
  const phase0 = r() * Math.PI * 2;
  const lat = (site.lat * Math.PI) / 180;
  const tilt = (r() - 0.5) * 0.6;
  const ha = phase0 + (t / day) * Math.PI * 2;            // hour angle
  // Sun on the celestial equator (+tilt), seen from latitude `lat`.
  const dec = tilt;
  const x = Math.cos(dec) * Math.sin(ha);
  const yEq = Math.cos(dec) * Math.cos(ha);
  const zEq = Math.sin(dec);
  // Tip the equatorial frame by the latitude: local up = cos(lat)·eq + sin(lat)·pole.
  const y = yEq * Math.cos(lat) + zEq * Math.sin(lat);
  const z = -yEq * Math.sin(lat) + zEq * Math.cos(lat);
  const len = Math.hypot(x, y, z) || 1;
  return { dir: [x / len, y / len, z / len], elevation: y / len, dayLength: day };
}

// Is a lightning storm over the site right now? Toxic worlds have them on
// and off (the same worlds that flash with lightning from orbit); it blocks
// the transporter. A storm cycle of a few minutes, seeded per site.
export function stormAt(site, t) {
  if (site.kind !== "toxic") return false;
  const r = rng(site.seed ^ 0x570a);
  const period = 240 + r() * 240;
  const phase = r() * period;
  return ((t + phase) % period) / period < 0.3;
}

// A point inside the walkable area, clear of water and not too steep — for
// placing things. Deterministic for a given rng.
export function placePoint(terrain, r, { min = 40, max = SITE_RADIUS - 40, avoid = [], spacing = 30 } = {}) {
  for (let tries = 0; tries < 60; tries++) {
    const a = r() * Math.PI * 2, d = min + r() * (max - min);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = terrain.heightAt(x, z);
    if (terrain.water != null && h < terrain.water + 0.8) continue;
    if (avoid.some(([ax, az]) => Math.hypot(ax - x, az - z) < spacing)) continue;
    if (terrain.vents.some(([vx, vz]) => Math.hypot(vx - x, vz - z) < VENT_RADIUS * 1.2)) continue;
    return [x, z];
  }
  const a = r() * Math.PI * 2;
  return [Math.cos(a) * min, Math.sin(a) * min];
}
