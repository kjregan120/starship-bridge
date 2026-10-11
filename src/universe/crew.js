// crew.js — the forty people aboard, one at a time, during a mission.
//
// Pure logic, testable in node, owned and stepped by ShipSystems (ship.js).
// Who these people are — names, skills, age, medical history, family —
// lives in their personnel files (personnel/profile.js), which persist from
// mission to mission (personnel/career.js). The roster is the mission-time
// view of them: built from the profiles at launch, tracking health, dose
// and location as things happen, and checkpointed back into the career.
//
// Each crew member has a department, a duty station in one of the hull
// sections, and a location:
//   station  — at their post in their department's section
//   sickbay  — being treated (starboard section)
//   shelter  — in the shielded core, off duty
// What hurts the crew is worked out per person from where they are: a
// breach kills the people in that section first, engineering takes the
// reactor's heat, the shelter cuts radiation to 15%.
//
// Staffing feeds back into the ship: each department's fit crew at their
// posts, weighted by skill in the department's core skill, sets how well
// its system runs (staffing()). A veteran is worth more than a new ensign.
// Nobody at a post isn't zero — automation keeps things ticking at 40%.
//
// You (the captain) aren't on the roster.

import { newCareer, crewProfiles } from "./personnel/career.js";
import { fullName, toughness, skillLevel, CORE_SKILL, currentDept, familySummary } from "./personnel/profile.js";

export const DEPARTMENTS = {
  command:     { label: "Command",     section: "fore",      size: 3,  system: null,      effect: "Chain of command" },
  helm:        { label: "Helm",        section: "fore",      size: 3,  system: "impulse", effect: "Impulse response" },
  science:     { label: "Science",     section: "fore",      size: 5,  system: "sensors", effect: "Sensor performance" },
  comms:       { label: "Comms",       section: "fore",      size: 3,  system: "comms",   effect: "Comms performance" },
  engineering: { label: "Engineering", section: "aft",       size: 10, system: "reactor", effect: "Reactor output & restart" },
  tactical:    { label: "Tactical",    section: "port",      size: 4,  system: "shields", effect: "Shield recharge" },
  security:    { label: "Security",    section: "port",      size: 3,  system: null,      effect: "Ship security" },
  medical:     { label: "Medical",     section: "starboard", size: 4,  system: "medical", effect: "Treatment in sickbay" },
  operations:  { label: "Operations",  section: "starboard", size: 5,  system: "life",    effect: "Life support" },
};
export const DEPT_ORDER = Object.keys(DEPARTMENTS);
const SICKBAY = "starboard";
const AUTOMATION = 0.4;             // what a system manages with nobody at its post
const STAFFING_MAX = 1.15;          // a department of veterans runs a little better than spec

// What one person at their post contributes, by skill level 0–5 in the
// department's core skill: an untrained hand 0.7, proficient (3) 1.0,
// a master 1.2.
const skillWeight = (level) => 0.7 + 0.1 * level;

// The mission-time record for one person, from their profile.
function memberFrom(p, day) {
  const dept = currentDept(p);
  const health = p.medical.health ?? 1;
  return {
    id: p.id,
    name: fullName(p),
    rank: p.post.rank,
    role: p.post.role,
    dept,
    homeDept: p.post.dept,
    section: DEPARTMENTS[dept].section,
    toughness: toughness(p, day),
    priorDose: p.medical.lifetimeDoseSv,
    pronouns: p.identity.pronouns,
    family: familySummary(p),
    profile: p,                 // the file itself — skills are read from it live
    health,
    dose: 0,
    location: "station",
    diedAt: null,
    cause: null,
  };
}

export function statusOf(m) {
  if (m.health <= 0) return "dead";
  if (m.health < 0.3) return "critical";
  if (m.health < 0.65) return "injured";
  return "healthy";
}
// How much use someone is at their post.
const FITNESS = { healthy: 1, injured: 0.6, critical: 0, dead: 0 };

// Radiation reaching each location, relative to the ship-wide figure.
const LOC_RAD = { fore: 1.0, port: 0.9, starboard: 0.9, aft: 0.8, shelter: 0.15 };

const HARM_WORDS = {
  radiation: "radiation exposure", oxygen: "oxygen deprivation", pressure: "decompression",
  heat: "heat", co2: "carbon dioxide poisoning", breach: "hull breach",
};
export const causeWords = (c) => HARM_WORDS[c] ?? "injuries";
// Ranks as the computer says them.
const SPOKEN_RANK = { "Lt.": "Lieutenant", "Lt. (jg)": "Lieutenant junior grade", "Lt. Commander": "Lieutenant Commander" };
export const spokenRank = (rank) => SPOKEN_RANK[rank] ?? rank;

export class Roster {
  // `source`: the profiles aboard (career.js crewProfiles), or a number to
  // generate a fresh crew from — tests and anything without a career.
  // `day`: the ship calendar day, for ages.
  constructor(source, day) {
    let profiles = source;
    if (!Array.isArray(source)) {
      const c = newCareer(source);
      profiles = crewProfiles(c);
      day = c.day;
    }
    this.day = day;
    this.crew = profiles.map((p) => memberFrom(p, day));
    this.sheltered = false;      // `all hands to shelter` in force
    this.events = [];            // { t, kind: "death"|"critical", id } — drained by alerts.js
    this.worstEta = null;        // seconds until the most at-risk person dies, at current rates
  }

  get total() { return this.crew.length; }
  alive() { return this.crew.filter((m) => m.health > 0); }
  counts() {
    const c = { healthy: 0, injured: 0, critical: 0, dead: 0 };
    for (const m of this.crew) c[statusOf(m)]++;
    return c;
  }
  // Where someone actually is right now (a hull section, or the shelter).
  whereIs(m) { return m.location === "station" ? m.section : m.location === "sickbay" ? SICKBAY : "shelter"; }

  // Fit crew at their posts as a share of the department, 0..1.
  // Fit, skilled crew at their posts against the department's full
  // complement — 1.0 is a full department of proficient people. Reassigned
  // crew count where they're working now, at their skill there.
  staffing(dept) {
    const core = CORE_SKILL[dept];
    let sum = 0;
    for (const m of this.crew) {
      if (m.dept !== dept || m.location !== "station") continue;
      sum += FITNESS[statusOf(m)] * skillWeight(skillLevel(m.profile, core));
    }
    return Math.min(STAFFING_MAX, sum / DEPARTMENTS[dept].size);
  }
  // The multiplier a department's system runs at.
  factor(dept) { return AUTOMATION + (1 - AUTOMATION) * this.staffing(dept); }
  // Skill level (0–5) of someone in a department's core skill.
  skillIn(m, dept) { return skillLevel(m.profile, CORE_SKILL[dept]); }

  // Move someone to work in another department. The career records it in
  // their file (career.js reassign); this moves them now.
  reassign(id, dept) {
    const m = this.crew.find((x) => x.id === id);
    if (!m || m.health <= 0) return null;
    m.dept = dept;
    m.section = DEPARTMENTS[dept].section;
    if (m.location === "station" || m.location === "shelter") m.location = this.sheltered ? "shelter" : "station";
    return m;
  }
  find(id) { return this.crew.find((m) => m.id === id); }

  // ---------------- orders ----------------
  shelterAll() {
    this.sheltered = true;
    for (const m of this.crew) if (m.health > 0 && m.location === "station") m.location = "shelter";
  }
  shelterSection(section) {
    let n = 0;
    for (const m of this.crew) {
      if (m.health > 0 && m.location === "station" && m.section === section) { m.location = "shelter"; n++; }
    }
    return n;
  }
  // `breached`: sections open to space — their crew stay in shelter.
  resumeStations(breached = []) {
    this.sheltered = false;
    let n = 0;
    for (const m of this.crew) {
      if (m.health > 0 && m.location === "shelter" && statusOf(m) !== "critical" && !breached.includes(m.section)) { m.location = "station"; n++; }
    }
    return n;
  }
  sendInjured() {
    let n = 0;
    for (const m of this.crew) {
      const st = statusOf(m);
      if ((st === "injured" || st === "critical") && m.location !== "sickbay") { m.location = "sickbay"; n++; }
    }
    return n;
  }

  // ---------------- simulation ----------------
  // `ship`: the ShipSystems doing the stepping. `t`: mission time (s).
  step(dt, ship, t) {
    const breached = new Set(ship.breached());
    const exposed = (sec) => sec !== "shelter" && ship.hull[sec] < 0.5;
    const sickbayOk = !breached.has(SICKBAY);
    const medical = this.factor("medical");
    let worst = null;

    for (const m of this.crew) {
      if (m.health <= 0) continue;
      const before = statusOf(m);
      const where = this.whereIs(m);

      // What's hurting this person, by cause (health/s before toughness).
      const h = {};
      if (ship.harm.oxygen) h.oxygen = ship.harm.oxygen;
      if (ship.harm.co2) h.co2 = ship.harm.co2;
      if (ship.harm.pressure) h.pressure = ship.harm.pressure;
      const rad = ship.doseRate * LOC_RAD[where] * (exposed(where) ? 2 : 1);
      m.dose += rad * dt;
      if (rad > 0.002) h.radiation = (rad - 0.002) * 0.5;
      if (ship.heat > 0.85) h.heat = (ship.heat - 0.85) * 0.02 * (where === "aft" ? 1.6 : 1);
      if (breached.has(where)) h.breach = 0.01 + (0.3 - ship.hull[where]) * 0.05;

      const harm = Object.values(h).reduce((a, b) => a + b, 0) / m.toughness;
      m.hurting = harm > 0;
      // Radiation caps recovery: this mission's dose most, a career's worth
      // of exposure a little.
      const ceiling = Math.max(0.05, 1 - Math.max(0, m.dose - 0.5) * 0.15 - Math.max(0, m.priorDose - 1.5) * 0.05);
      if (harm > 0) {
        m.health = Math.max(0, m.health - harm * dt);
        m.cause = Object.entries(h).sort((a, b) => b[1] - a[1])[0][0];
        const eta = m.health / harm;
        if (worst == null || eta < worst) worst = eta;
      } else {
        const heal = m.location === "sickbay" && sickbayOk ? 0.004 * medical : m.location === "shelter" ? 0.001 : 0.0005;
        if (m.health < ceiling) m.health = Math.min(ceiling, m.health + heal * dt);
      }
      if (m.health > ceiling) m.health = Math.max(ceiling, m.health - 0.001 * dt);

      const now = statusOf(m);
      if (now === "dead") {
        m.diedAt = t;
        this.events.push({ t, kind: "death", id: m.id });
      } else {
        if (now === "critical" && before !== "critical") this.events.push({ t, kind: "critical", id: m.id });
        // The critically injured are carried to sickbay — unless everyone's
        // sheltering, or sickbay itself is open to space.
        if (now === "critical" && m.location === "station" && sickbayOk && !this.sheltered) m.location = "sickbay";
        // Back to work once treated — unless their post is open to space.
        if (now === "healthy" && m.location === "sickbay" && !this.sheltered && !breached.has(m.section)) m.location = "station";
      }
    }
    this.worstEta = worst;
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  snapshot() {
    return {
      crew: this.crew.map((m) => ({ ...m, status: statusOf(m), where: this.whereIs(m), skill: this.skillIn(m, m.dept) })),
      counts: this.counts(),
      total: this.total,
      sheltered: this.sheltered,
      worstEta: this.worstEta,
      staffing: Object.fromEntries(DEPT_ORDER.map((d) => [d, this.staffing(d)])),
    };
  }
}
