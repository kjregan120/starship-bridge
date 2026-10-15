// util.js — seeded randomness and the ship calendar, shared by the
// personnel modules.

// mulberry32, wrapped with the handful of draws profile generation needs.
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    float: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => {
      const b = arr.slice();
      for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
      return b;
    },
    // A fresh seed derived from this stream — for sub-generators.
    seed: () => Math.floor(next() * 4294967296),
  };
  return r;
}

// ---- the ship calendar ------------------------------------------------------
// Dates are stored as day numbers (integers) from an epoch, so arithmetic is
// trivial and the format never depends on a locale. Displayed as ISO dates.
const EPOCH = Date.UTC(2300, 0, 1);
const MS_DAY = 86400000;
export const YEAR = 365.25;
// The day the first career starts.
export const START_DAY = dayOf(2387, 3, 14);

export function dayOf(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / MS_DAY); }
export function dateOf(day) { return new Date(EPOCH + day * MS_DAY).toISOString().slice(0, 10); }
export function yearOf(day) { return new Date(EPOCH + day * MS_DAY).getUTCFullYear(); }
export function yearsBetween(from, to) { return Math.floor((to - from) / YEAR); }

// ---- the ship's clock and watches -------------------------------------------
// The career keeps a day number and an hour (0–24). During a mission the
// clock runs at CLOCK_RATE ship seconds per real second — a ship hour is a
// real minute, so an eight-hour watch changes over every eight minutes of
// play. Between missions it jumps a few days.
export const CLOCK_RATE = 60;
export const SHIFTS = ["alpha", "beta", "gamma"];
export const SHIFT_HOURS = { alpha: [8, 16], beta: [16, 24], gamma: [0, 8] };
export const SHIFT_LABEL = { alpha: "Alpha", beta: "Beta", gamma: "Gamma" };
export const shiftAt = (hour) => (hour >= 8 && hour < 16 ? "alpha" : hour >= 16 ? "beta" : "gamma");
// Hours since the watch began.
export const intoShift = (hour) => hour - SHIFT_HOURS[shiftAt(hour)][0];
export function fmtClock(hour) {
  const m = Math.floor(hour * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}`;
}
