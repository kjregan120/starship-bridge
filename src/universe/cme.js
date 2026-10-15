// cme.js — when a coronal mass ejection reaches the ship, and how hard.
//
// flight/ejecta.js draws the clouds and keeps a plain record of each
// ({ at, d, t0, speed, cone, radius }); this is the same geometry in
// pure JS, so the loop can tell when the bright leading front sweeps over
// the ship and hand ship.hit() the blow. The front's shape here must match
// the vertex shader there: a cone of straight paths, accelerating off the
// star with time constant TAU, the flanks lagging the nose.
//
// A cloud hits once, when its front passes the ship: you were ahead of it
// inside the cone, and now you're not. Flying into a cloud from behind its
// front, or skirting the cone, does nothing.

export const TAU = 2;              // ejecta.js shader's acceleration time constant
export const CME_LIFE = 120;       // = EJECTA_LIFE; a cloud this old is gone
const FRONT = 0.95;                // the leading front's speed factor at the nose
const FLANK_LAG = 0.3;             // how far the flanks trail the nose (1 - 0.3 q²)
export const MIN_ENERGY = 0.02;    // weaker than this doesn't register

// Distance travelled by the nose of the front at `age` seconds.
export function frontReach(age, speed) {
  if (age <= 0) return 0;
  return FRONT * speed * (age - TAU * (1 - Math.exp(-age / TAU)));
}

// Where the ship sits relative to a cloud: distance from the launch point,
// and q, its angle off the axis as a fraction of the cone (≤ 1 is inside).
export function cmePlace(cloud, pos) {
  const v = [pos[0] - cloud.at[0], pos[1] - cloud.at[1], pos[2] - cloud.at[2]];
  const r = Math.hypot(v[0], v[1], v[2]);
  if (r < 1e-6) return { r: 0, q: 0, inside: true };
  const cos = (v[0] * cloud.d[0] + v[1] * cloud.d[1] + v[2] * cloud.d[2]) / r;
  const q = Math.acos(Math.max(-1, Math.min(1, cos))) / cloud.cone;
  return { r, q, inside: q <= 1 };
}

// How far the front has got along the ship's line, at `age`.
const reachAt = (cloud, age, q) => frontReach(age, cloud.speed) * (1 - FLANK_LAG * q * q);

// The blow, in shield units (1 = a full shield's worth), if the front hit
// the ship at distance r, angle q. Faster clouds carry more; it thins with
// distance and with how wide the cone spreads it, and is weaker at the flanks.
// About a third of a shield from an ordinary eruption at an inner planet's
// distance (12u), most of one from a giant.
export function cmeEnergy(cloud, r, q) {
  const spread = Math.sqrt(0.45 / Math.max(0.1, cloud.cone));
  const dist = (12 / Math.max(r, 4 * (cloud.radius || 1))) ** 1.6;
  return 0.021 * cloud.speed ** 2 * dist * spread * (1 - 0.5 * Math.min(1, q) ** 2);
}

// Seconds until the front reaches the ship where it is now, or null if it
// won't (outside the cone, already past, or the cloud dies first).
export function cmeEta(cloud, pos, t) {
  const { r, q, inside } = cmePlace(cloud, pos);
  const age = t - cloud.t0;
  if (!inside || age >= CME_LIFE || reachAt(cloud, age, q) >= r) return null;
  if (reachAt(cloud, CME_LIFE, q) < r) return null;
  let lo = Math.max(0, age), hi = CME_LIFE;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (reachAt(cloud, mid, q) < r) lo = mid; else hi = mid;
  }
  return hi - age;
}

// One tick for one cloud. Remembers on the cloud whether the ship was ahead
// of its front (cloud.ahead), and reports a hit the tick that changes.
// Returns { hit, energy, from, eta } — `from` the unit direction from the
// ship back toward the launch point, for ship.hit().
export function cmeStep(cloud, pos, t) {
  const age = t - cloud.t0;
  if (age < 0 || age >= CME_LIFE || cloud.spent) return { hit: false, eta: null };
  const { r, q, inside } = cmePlace(cloud, pos);
  const ahead = inside && reachAt(cloud, age, q) < r;
  const was = cloud.ahead;
  cloud.ahead = ahead;
  const energy = cmeEnergy(cloud, r, q);
  if (was && !ahead && inside) {
    cloud.spent = true;
    if (energy < MIN_ENERGY) return { hit: false, eta: null };
    const from = r > 1e-6
      ? [(cloud.at[0] - pos[0]) / r, (cloud.at[1] - pos[1]) / r, (cloud.at[2] - pos[2]) / r]
      : [-cloud.d[0], -cloud.d[1], -cloud.d[2]];
    return { hit: true, energy, from, eta: 0 };
  }
  return { hit: false, energy, eta: ahead && energy >= MIN_ENERGY ? cmeEta(cloud, pos, t) : null };
}

// What a hit of `energy` does besides the blow itself: particle radiation
// (Sv to each crew member, before shielding), heat, and static on comms
// and sensors. For ship.hit().
export function cmeEffects(energy) {
  return { energy, radiation: 0.5 * energy, heat: 0.05 * energy, static: Math.min(0.8, 0.6 * energy) };
}
