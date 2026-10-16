// terrain.js — the ground under a landing site, as one height function.
//
// Pure and seeded: heightAt(x, z) is the same number in node and in the
// browser, so the renderer's mesh, the captain's footing, the team's
// pathing and the tests all agree on where the ground is. Units are metres;
// x/z are site coordinates with the landing point at the origin.
//
// Every surface kind gets its own character on top of a shared base of
// value-noise fBm: craters on airless rock, dunes in the desert, sharp
// ridges on ice, vents on volcanic moons, hills and a shoreline on living
// worlds. Variety within a kind comes from the site's seed.

export const SITE_RADIUS = 450;     // walkable radius around the landing point (m)
export const TERRAIN_SIZE = 1400;   // the mesh extends past the walkable edge into the haze

// ---- seeded noise ------------------------------------------------------------
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Integer lattice hash → [0, 1).
function lattice(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);
// Smooth value noise in [-1, 1].
export function noise2(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = fade(x - ix), fz = fade(z - iz);
  const a = lattice(ix, iz, seed), b = lattice(ix + 1, iz, seed);
  const c = lattice(ix, iz + 1, seed), d = lattice(ix + 1, iz + 1, seed);
  return ((a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz) * 2 - 1;
}
export function fbm(x, z, seed, octaves = 5) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * f, z * f, seed + i * 101);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}
const ridged = (x, z, seed, oct) => 1 - Math.abs(fbm(x, z, seed, oct));

// ---- craters -----------------------------------------------------------------
// One candidate crater per grid cell: a bowl with a raised rim.
function craters(x, z, seed, cell, density, depth) {
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  let h = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const gx = cx + i, gz = cz + j;
    if (lattice(gx, gz, seed) > density) continue;
    const px = (gx + lattice(gx, gz, seed + 7)) * cell, pz = (gz + lattice(gx, gz, seed + 13)) * cell;
    const r = cell * (0.15 + 0.3 * lattice(gx, gz, seed + 29));
    const d = Math.hypot(x - px, z - pz) / r;
    if (d < 1) h += (d * d - 1) * depth * r * 0.25;
    h += 0.35 * depth * r * 0.25 * Math.exp(-(((d - 1) * 4) ** 2));
  }
  return h;
}

// ---- terrain by kind -----------------------------------------------------------
// `surfaceKind`: surface.js surfaceKind(body) — "class-M", "moon-cratered", …
// Returns { heightAt(x, z), water: sea level or null, vents: [[x, z], …] }.
export function makeTerrain(surfaceKind, seed) {
  const s = seed >>> 0;
  const r = rng(s ^ 0x9e3779b9);
  // The landing point is kept fairly level: everything is eased toward a
  // gentle pad inside PAD metres of the origin.
  const PAD = 18;
  let base, water = null;
  const vents = [];

  switch (surfaceKind) {
    case "moon-cratered":
    case "rocky":
      base = (x, z) => 14 * fbm(x / 260, z / 260, s, 5) + craters(x, z, s + 1, 160, 0.45, 1.2) + craters(x, z, s + 2, 45, 0.35, 0.8);
      break;
    case "moon-icy":
    case "ice":
      base = (x, z) => 18 * ridged(x / 300, z / 300, s, 5) - 9 + 3 * fbm(x / 40, z / 40, s + 3, 3) +
        (surfaceKind === "moon-icy" ? craters(x, z, s + 1, 180, 0.35, 0.9) : 0);
      break;
    case "desert": {
      const ang = r() * Math.PI;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      base = (x, z) => {
        const u = x * ca + z * sa;
        const warp = 18 * fbm(x / 150, z / 150, s + 4, 3);
        const dune = Math.abs(Math.sin((u + warp) / 38)) ** 1.5;
        return 10 * fbm(x / 400, z / 400, s, 4) + 5 * dune * (0.6 + 0.4 * fbm(x / 120, z / 120, s + 5, 2));
      };
      break;
    }
    case "moon-volcanic":
    case "moon-lava": {
      for (let i = 0; i < 4; i++) {
        const a = r() * Math.PI * 2, d = 90 + r() * 280;
        vents.push([Math.cos(a) * d, Math.sin(a) * d]);
      }
      base = (x, z) => {
        let h = 10 * fbm(x / 220, z / 220, s, 5);
        for (const [vx, vz] of vents) {
          const d = Math.hypot(x - vx, z - vz);
          h += 22 * Math.exp(-((d / 55) ** 2)) - 14 * Math.exp(-((d / 14) ** 2));  // cone, with a crater on top
        }
        return h;
      };
      break;
    }
    case "toxic":
      base = (x, z) => 12 * fbm(x / 240, z / 240, s, 5) + 4 * fbm(x / 50, z / 50, s + 6, 3);
      water = -4;   // caustic pools in the hollows
      break;
    case "ocean": {
      // A coast: land on one side of the site, the sea on the other.
      const ang = r() * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      base = (x, z) => 4 - (x * ca + z * sa) / 40 + 10 * fbm(x / 200, z / 200, s, 5) + 2 * fbm(x / 30, z / 30, s + 7, 2);
      water = 0;
      break;
    }
    case "class-M":
    default:
      base = (x, z) => 26 * fbm(x / 380, z / 380, s, 5) + 6 * ridged(x / 150, z / 150, s + 8, 3);
      water = -10;  // lakes, where the hills fall away far enough
      break;
  }

  const h0 = base(0, 0);
  // On a coast, make sure the pad itself is dry land.
  const padLevel = water != null ? Math.max(h0, water + 2) : h0;
  const heightAt = (x, z) => {
    const h = base(x, z);
    const d = Math.hypot(x, z);
    const k = d < PAD ? 1 : d < PAD * 3 ? 1 - (d - PAD) / (PAD * 2) : 0;
    return h + (padLevel - h) * fade(k);
  };
  return { heightAt, water, vents };
}

// Slope (rise over run) at a point, from the height function.
export function slopeAt(heightAt, x, z, e = 1.5) {
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}
