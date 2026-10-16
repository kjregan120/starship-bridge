// career.js — the crew record that persists from mission to mission.
//
// A career is one JSON document (saved by flight/careerStore.js):
//
//   version            CAREER_VERSION (schema.js)
//   seed, nextSerial   for generating new people
//   day, hour          the ship calendar (util.js day numbers) and clock (0–24)
//   missions           how many have been flown
//   posts              { [slot]: profileId | null } — who fills each of the forty posts
//   profiles           { [id]: profile } — everyone who has ever served, alive or not
//   memorial           [id] — the dead, in order
//   activeMission      the mission in progress, checkpointed while it runs:
//                      { number, startDay, startHour, crew: { [id]: { health, dose, dead, diedAt, cause, worst, dept, xp } } }
//   crewsLost          times the whole crew has been lost
//
// The lifecycle: startMission() finalizes any mission left unfinished (the
// page was closed mid-flight — what happened still happened), moves the
// calendar on, runs the ship's routine for the days in between (watches,
// training, drills — practice into skills), lets survivors recover, and
// fills empty posts with transfers. checkpoint() records the roster's
// state and the clock as the mission runs. finalizeMission() writes it into
// everyone's profile: deaths, injuries, radiation dose, what they
// practised, missions served.

import COMPLEMENT from "./data/complement.js";
import { FIRST, LAST } from "./data/names.js";
import { makeRng, START_DAY, dateOf } from "./util.js";
import {
  generateProfile, record, fullName, awardById, CORE_SKILL, skillById,
  routinePerDay, watchPerHour, learnRate, isMentor, MENTOR_BONUS, recordPractice,
} from "./profile.js";
import { CAREER_VERSION } from "./schema.js";

export function newCareer(seed = Date.now() >>> 0, day = START_DAY) {
  const c = {
    version: CAREER_VERSION, seed, nextSerial: 1, day, hour: 8, missions: 0,
    posts: Object.fromEntries(COMPLEMENT.map((p) => [p.slot, null])),
    profiles: {}, memorial: [], activeMission: null, crewsLost: 0,
  };
  fillVacancies(c, true);
  return c;
}

const rngFor = (c) => makeRng((c.seed ^ Math.imul(c.nextSerial, 2654435761)) >>> 0);
const namesAboard = (c) => {
  const first = new Set(), last = new Set();
  for (const id of Object.values(c.posts)) {
    if (!id) continue;
    first.add(c.profiles[id].identity.first);
    last.add(c.profiles[id].identity.last);
  }
  return { first, last };
};

// Everyone currently filling a post, in complement order.
export function crewProfiles(c) {
  return COMPLEMENT.map((p) => c.posts[p.slot]).filter(Boolean).map((id) => c.profiles[id]);
}

// Fill empty posts with new people. On a fresh career they're the original
// crew; afterwards they're transfers, and their file says so.
export function fillVacancies(c, initial = false) {
  const names = namesAboard(c);
  const added = [];
  for (const post of COMPLEMENT) {
    if (c.posts[post.slot]) continue;
    const r = rngFor(c);
    const id = `P${String(c.nextSerial++).padStart(4, "0")}`;
    const p = generateProfile(r, id, post, c.day, names, FIRST, LAST);
    if (!initial) {
      // A transfer arrives today: their Meridian posting starts now.
      const last = p.serviceRecord[p.serviceRecord.length - 1];
      if (last?.ship === "USS Meridian") {
        p.serviceRecord.pop();
        p.timeline = p.timeline.filter((e) => !(e.type === "posting" && e.data?.ship === "USS Meridian"));
        if (p.serviceRecord.length) p.serviceRecord[p.serviceRecord.length - 1].toDay = null;
      }
      record(p, c.day, "posting", "Transferred to USS Meridian", { ship: "USS Meridian", role: post.role });
    }
    c.profiles[id] = p;
    c.posts[post.slot] = id;
    added.push(p);
  }
  return added;
}

// Begin a mission. Returns the profiles aboard and who's new.
export function startMission(c, rng = Math.random) {
  if (c.activeMission) finalizeMission(c);
  if (c.missions > 0) {
    // Time between missions: transit, shore leave, refit — the routine
    // goes on, and the crew learn from it.
    const gap = 3 + Math.floor(rng() * 8);
    const from = c.day;
    c.day += gap;
    runRoutine(c, gap, `Routine duties ${dateOf(from)} – ${dateOf(c.day)}`);
    // Survivors recover — about a tenth of full health a day.
    for (const p of crewProfiles(c)) {
      const h = p.medical.health ?? 1;
      if (h < 1) record(p, c.day, "health", h < 0.65 ? "Returned to duty after recovery" : "Recovered", { health: Math.min(1, h + gap * 0.1) });
    }
  }
  const transfers = fillVacancies(c);
  c.missions += 1;
  // Trouble keeps no hours: after the first, a mission can start on any watch.
  if (c.missions > 1) c.hour = Math.floor(rng() * 24) + 0.25;
  c.activeMission = { number: c.missions, startDay: c.day, startHour: c.hour, crew: {} };
  return { crew: crewProfiles(c), transfers };
}

// `days` of the ship's routine for everyone aboard: their watches and their
// schedule, as practice. Juniors learn their department's core skill faster
// with a mentor aboard. Also books the monthly physical when it's due.
export function runRoutine(c, days, label) {
  const aboard = crewProfiles(c);
  const mentored = new Set(aboard.filter(isMentor).map((p) => p.post.dept));
  for (const p of aboard) {
    const gains = {};
    const add = (rates, k) => { for (const [s, n] of Object.entries(rates)) gains[s] = (gains[s] ?? 0) + n * k; };
    add(routinePerDay(p), days);
    add(watchPerHour(p), days * 8);
    for (const s in gains) {
      gains[s] *= learnRate(s);
      if (s === CORE_SKILL[p.post.dept] && mentored.has(p.post.dept) && !isMentor(p)) gains[s] *= MENTOR_BONUS;
    }
    recordPractice(p, c.day, label, gains);
    if (c.day - p.medical.lastPhysicalDay >= 30) record(p, c.day, "physical", "Routine physical — fit for duty");
  }
}

// Record the roster's current state into the active mission, and the
// clock into the career. `roster`: crew.js Roster.
export function checkpoint(c, roster) {
  if (!c.activeMission) return;
  c.day = roster.clock.day;
  c.hour = roster.clock.hour;
  for (const m of roster.crew) {
    const prev = c.activeMission.crew[m.id];
    c.activeMission.crew[m.id] = {
      health: +m.health.toFixed(3), dose: +m.dose.toFixed(4), dead: m.health <= 0,
      diedAt: m.diedAt, cause: m.cause, dept: m.dept,
      xp: Object.fromEntries(Object.entries(m.xp).map(([k, n]) => [k, +n.toFixed(2)])),
      // The worst they got this mission — for the injury record.
      worst: Math.min(prev?.worst ?? 1, +m.health.toFixed(3)),
    };
  }
}

const CAUSE_TEXT = {
  radiation: "acute radiation exposure", oxygen: "oxygen deprivation", pressure: "decompression",
  heat: "heat injury", co2: "carbon dioxide poisoning", breach: "hull breach",
  suit: "suit failure on an away mission", toxic: "toxic exposure on an away mission",
};

// Write the mission into everyone's file.
export function finalizeMission(c) {
  const m = c.activeMission;
  if (!m) return;
  const day = c.day;
  let lost = 0;
  for (const [id, s] of Object.entries(m.crew)) {
    const p = c.profiles[id];
    if (!p || p.status.state !== "active") continue;
    if (s.dose > 0.001) record(p, day, "dose", `Received ${s.dose.toFixed(2)} Sv on mission ${m.number}`, { sv: +s.dose.toFixed(3) });
    if (s.dead) {
      const cause = CAUSE_TEXT[s.cause] ?? "injuries";
      record(p, day, "death", `Died of ${cause} on mission ${m.number}`, { cause, mission: m.number, at: s.diedAt });
      c.memorial.push(id);
      c.posts[p.post.slot] = null;
      lost++;
      continue;
    }
    record(p, day, "mission", `Served on mission ${m.number}`, { mission: m.number });
    if (s.xp) recordPractice(p, day, `Mission ${m.number}`, s.xp);
    if (s.worst < 0.65) {
      const what = `${s.worst < 0.3 ? "Critically injured" : "Injured"} — ${CAUSE_TEXT[s.cause] ?? "injuries"}, mission ${m.number}`;
      record(p, day, "injury", what, { injury: what });
      if (s.worst < 0.3 && !p.awards.some((a) => a.id === "line-of-duty" && a.day === day)) {
        record(p, day, "award", awardById["line-of-duty"].label, { id: "line-of-duty", citation: what });
      }
    }
    // Only worth a line in the file if they came back less than whole.
    if (s.health < 0.995 || (p.medical.health ?? 1) < 0.995) {
      record(p, day, "health", `Health ${Math.round(s.health * 100)}% at mission end`, { health: s.health });
    }
  }
  if (lost && Object.values(c.posts).every((x) => !x)) c.crewsLost += 1;
  c.activeMission = null;
}

// Move someone to another department for the rest of the mission and
// beyond, until reassigned back.
export function reassign(c, id, dept, day = c.day) {
  const p = c.profiles[id];
  if (!p) return null;
  const label = dept[0].toUpperCase() + dept.slice(1);
  record(p, day, "reassigned", dept === p.post.dept ? `Returned to ${label}` : `Reassigned to ${label}`, { dept });
  return p;
}

// Start someone deliberately learning another department's core skill —
// their cross-training sessions go to it from now on.
export function crossTrain(c, id, dept, day = c.day) {
  const p = c.profiles[id];
  if (!p) return null;
  const skill = CORE_SKILL[dept];
  record(p, day, "cross-train", `Began cross-training in ${skillById[skill].label}`, { skill, dept });
  return p;
}

export function findByName(c, query) {
  const q = query.trim().toLowerCase();
  const aboard = crewProfiles(c);
  return aboard.find((p) => fullName(p).toLowerCase() === q)
    ?? aboard.find((p) => p.identity.last.toLowerCase() === q)
    ?? aboard.find((p) => fullName(p).toLowerCase().includes(q));
}
