// schema.js — keeping old saves loadable as the personnel format grows.
//
// Every profile and the career itself carry a schemaVersion. When a change
// to the shape is made, bump the version (profile.js SCHEMA_VERSION or
// CAREER_VERSION below) and add a step here that upgrades the previous
// version in place. Loading runs every step from the save's version up.
//
// Adding a new optional section usually needs no migration at all — code
// reading profiles should treat a missing section as empty. `ext` is there
// for exactly that: new modules (learning, shifts, morale...) keep their
// data under p.ext.<module> and initialize it when they find it absent.

import { SCHEMA_VERSION } from "./profile.js";
import COMPLEMENT from "./data/complement.js";

export const CAREER_VERSION = 2;
const postBySlot = Object.fromEntries(COMPLEMENT.map((p) => [p.slot, p]));

// profileMigrations[n] upgrades a version-n profile to n+1.
const profileMigrations = {
  // 1 → 2: watches and cross-training. Everyone stands their post's watch.
  1: (p) => {
    p.post.shift ??= postBySlot[p.post.slot]?.shift ?? "alpha";
    p.post.crossTrain ??= null;
  },
  // 2 → 3: the ship has weapons. Tactical crew have trained on them about as
  // much as on threat assessment; everyone else starts untrained.
  2: (p) => {
    if (p.post.dept === "tactical" && !p.skills.weapons) {
      p.skills.weapons = { xp: Math.round(p.skills["tactical-analysis"]?.xp ?? 0) };
    }
  },
};
const careerMigrations = {
  // 1 → 2: the clock gains an hour of the day.
  1: (c) => { c.hour ??= 8; },
};

export function migrateProfile(p) {
  let v = p.schemaVersion ?? 1;
  while (v < SCHEMA_VERSION) {
    const step = profileMigrations[v];
    if (!step) throw new Error(`No migration for profile schema ${v} → ${v + 1}`);
    step(p);
    v += 1;
  }
  p.schemaVersion = v;
  p.ext ??= {};
  return p;
}

export function migrateCareer(c) {
  let v = c.version ?? 1;
  if (v > CAREER_VERSION) throw new Error(`Save is from a newer version (${v}) than this game understands (${CAREER_VERSION}).`);
  while (v < CAREER_VERSION) {
    const step = careerMigrations[v];
    if (!step) throw new Error(`No migration for career version ${v} → ${v + 1}`);
    step(c);
    v += 1;
  }
  c.version = v;
  for (const p of Object.values(c.profiles)) migrateProfile(p);
  return c;
}
