// lightning.js — the one strike schedule both the planet shader and the
// comms audio read, so a flash on the viewscreen and the crack in the
// headphones are the same event.
//
// Previously the shader rolled its own strikes from a GPU hash, which JS
// can't reproduce (float32 sin() differs per GPU), so audio had no way to
// know when one fired. Now strikes are a pure function of (body id, time):
// the shader gets the active ones as uniforms, the audio schedules the
// upcoming ones a little ahead. Both use performance.now() as the clock.
//
// Each strike: a point on the unit sphere (object space), a start time, a
// duration, an intensity, and a flicker phase. The flicker is the stutter
// of return strokes down the same channel — the shader's brightness and the
// audio's restrike clicks are both derived from flickerAt()/restrikes().

export const MAX_STRIKES = 8;          // shader uniform array size
const SLOT = 1 / 3;                    // seconds per scheduling slot
const PER_SLOT = 3;                    // candidate strikes per slot
const CHANCE = 0.45;                   // each candidate's odds of firing
const FLICKER_HZ = 7;                  // return strokes per strike-duration

export const hasLightning = (obj) => obj?.type === "planet" && obj.kind === "toxic";

export const lightningClock = () => performance.now() / 1000;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Small deterministic PRNG (mulberry32) so one slot yields a stream of values.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slotCache = new Map(); // `${id}:${slot}` -> strikes, trimmed as it grows

function slotStrikes(id, slot) {
  const key = id + ":" + slot;
  let s = slotCache.get(key);
  if (s) return s;
  const r = rng(hash(id) ^ Math.imul(slot, 0x9e3779b1));
  s = [];
  for (let i = 0; i < PER_SLOT; i++) {
    const fire = r(), off = r(), z = r() * 2 - 1, lon = r() * Math.PI * 2;
    const intensity = 0.5 + 0.5 * r(), phase = r(), dur = 0.25 + 0.2 * r();
    if (fire >= CHANCE) continue;
    const rho = Math.sqrt(1 - z * z);
    s.push({
      pos: [rho * Math.cos(lon), z, rho * Math.sin(lon)],
      start: slot * SLOT + off * SLOT, dur, intensity, phase,
    });
  }
  if (slotCache.size > 512) slotCache.clear();
  slotCache.set(key, s);
  return s;
}

// Every strike of `id` whose start falls in [t0, t1).
export function strikesStarting(id, t0, t1) {
  const out = [];
  for (let slot = Math.floor(t0 / SLOT); slot * SLOT < t1; slot++) {
    for (const s of slotStrikes(id, slot)) if (s.start >= t0 && s.start < t1) out.push(s);
  }
  return out;
}

// Strikes of `id` still lit at time t (started, not yet faded).
export function activeStrikes(id, t) {
  const out = [];
  const cur = Math.floor(t / SLOT);
  for (let slot = cur - 2; slot <= cur; slot++) {
    for (const s of slotStrikes(id, slot)) {
      if (t >= s.start && t < s.start + s.dur) out.push(s);
    }
  }
  return out.slice(0, MAX_STRIKES);
}

// Times (seconds after strike start) and relative loudness of each return
// stroke after the first — the points where flickerAt() steps back up.
export function restrikes(s) {
  const out = [];
  for (let k = 0; ; k++) {
    const tt = (k + 0.5 - s.phase) / FLICKER_HZ;
    if (tt <= 0) continue;
    if (tt >= 1) break;
    out.push({ at: tt * s.dur, level: 1 - tt });
  }
  return out;
}

// GLSL mirror of the flicker, for the shader (tt = age / dur, 0..1).
export const FLICKER_GLSL = `(1.0 - tt) * (0.5 + 0.5 * step(0.5, fract(tt * ${FLICKER_HZ.toFixed(1)} + ph)))`;
