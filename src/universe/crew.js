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
// sections, quarters (port or starboard), a watch, and a location:
//   station  — at their post in their department's section
//   quarters — off watch, resting
//   sickbay  — being treated (starboard section)
//   shelter  — in the shielded core, off duty
//   away     — on a planet's surface with the captain (away.js); off the
//              ship's books for staffing, and hurt by the surface, not the ship
// What hurts the crew is worked out per person from where they are: a
// breach kills the people in that section first, engineering takes the
// reactor's heat, the shelter cuts radiation to 15%.
//
// The ship runs three eight-hour watches (alpha 0800, beta 1600, gamma
// 0000) on a clock that runs a ship hour per real minute (util.js). About
// a third of each department is on watch at a time; the rest are in
// quarters. `call all hands` brings everyone to their stations — more
// hands for a crisis and for repairs — at the cost of fatigue: hours at a
// post wear people down, rest brings them back, and a tired crew works
// worse.
//
// Staffing feeds back into the ship: each department's fit crew at their
// posts, weighted by skill in the department's core skill and by how
// rested they are, against what a watch needs, sets how well its system
// runs (staffing()). A veteran is worth more than a new ensign. Nobody at
// a post isn't zero — automation keeps things ticking at 40%.
//
// The crew learn by doing: hours on watch practise their duties' skills —
// faster while their department is fighting a problem (ship.strain()) —
// time off watch runs their training schedule, and repair work (ship.js)
// teaches the skill it uses. Practice is held per mission (m.xp) and
// written into their files when the mission ends (career.js).
//
// You (the captain) aren't on the roster.

import { newCareer, crewProfiles } from "./personnel/career.js";
import {
  fullName, toughness, levelOf, CORE_SKILL, currentDept, familySummary, skillById,
  watchPerHour, routinePerDay, learnRate, isMentor, MENTOR_BONUS,
} from "./personnel/profile.js";
import { CLOCK_RATE, shiftAt, intoShift, SHIFTS } from "./personnel/util.js";

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
// Fatigue, 0 (rested) to 1 (exhausted), per ship hour. An eight-hour watch
// leaves someone a third tired; a second watch on top of it starts to tell.
const TIRE = 1 / 24, REST = 1 / 8, REST_POORLY = 1 / 16;
const TIRED_AT = 0.4;
// How well someone works, by fatigue: fully until TIRED_AT, about half
// when exhausted.
export const effectiveness = (fatigue) => 1 - 0.8 * Math.max(0, fatigue - TIRED_AT);
const OFF_WATCH_HOURS = 16;         // the day's routine happens in these

// What one person at their post contributes, by skill level 0–5 in the
// department's core skill: an untrained hand 0.7, proficient (3) 1.0,
// a master 1.2.
const skillWeight = (level) => 0.7 + 0.1 * level;

// The mission-time record for one person, from their profile.
function memberFrom(p, day, i) {
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
    shift: p.post.shift ?? "alpha",
    quarters: i % 2 ? "starboard" : "port",
    mentor: isMentor(p),
    watchRates: watchPerHour(p, dept),
    routineRates: routinePerDay(p),
    fatigue: 0,
    xp: {},                     // practice this mission, by skill — not yet in the file
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
const LOC_RAD = { fore: 1.0, port: 0.9, starboard: 0.9, aft: 0.8, shelter: 0.15, away: 0 };

const HARM_WORDS = {
  radiation: "radiation exposure", oxygen: "oxygen deprivation", pressure: "decompression",
  heat: "heat", co2: "carbon dioxide poisoning", breach: "hull breach",
  suit: "suit air running out", toxic: "a toxic atmosphere", survivor: "injuries",
};
export const causeWords = (c) => HARM_WORDS[c] ?? "injuries";
// Ranks as the computer says them.
const SPOKEN_RANK = { "Lt.": "Lieutenant", "Lt. (jg)": "Lieutenant junior grade", "Lt. Commander": "Lieutenant Commander" };
export const spokenRank = (rank) => SPOKEN_RANK[rank] ?? rank;

export class Roster {
  // `source`: the profiles aboard (career.js crewProfiles), or a number to
  // generate a fresh crew from — tests and anything without a career.
  // `day`, `hour`: the ship's calendar and clock at launch.
  constructor(source, day, hour = 8) {
    let profiles = source;
    if (!Array.isArray(source)) {
      const c = newCareer(source);
      profiles = crewProfiles(c);
      day = c.day;
    }
    this.day = day;
    this.clock = { day, hour };
    this.crew = profiles.map((p, i) => memberFrom(p, day, i));
    this.sheltered = false;      // `all hands to shelter` in force
    this.allHands = false;       // `call all hands` in force — nobody off watch
    this.evacuated = new Set();  // sections ordered cleared, until `resume stations`
    // { t, kind: "death"|"critical"|"level"|"watch", ... } — read by ship.js and alerts.js
    this.events = [];
    this.worstEta = null;        // seconds until the most at-risk person dies, at current rates
    // What a watch needs, by department and watch: the posts that stand it.
    this.need = {};
    for (const d of DEPT_ORDER) this.need[d] = Object.fromEntries(SHIFTS.map((s) => [s, 0]));
    for (const m of this.crew) this.need[m.homeDept][m.shift]++;
    this._shift = this.shift;
    // Whoever's on watch is partway through it.
    for (const m of this.crew) if (this.onWatch(m)) m.fatigue = intoShift(hour) * TIRE;
    this.settle();
  }

  get shift() { return shiftAt(this.clock.hour); }
  onWatch(m) { return this.allHands || m.shift === this.shift; }
  // Skill level with this mission's practice counted.
  levelIn(m, skill) { return levelOf((m.profile.skills[skill]?.xp ?? 0) + (m.xp[skill] ?? 0)); }

  // Where someone should be under the standing orders: shelter if all
  // hands are sheltering or their section is cleared or open to space,
  // else their post if on watch, their quarters if not.
  postFor(m, breached = new Set()) {
    if (this.sheltered) return "shelter";
    const watch = this.onWatch(m);
    const sec = watch ? m.section : m.quarters;
    if (this.evacuated.has(sec) || breached.has(sec)) return "shelter";
    return watch ? "station" : "quarters";
  }
  // Send everyone not in sickbay where the standing orders say. The
  // critically injured go nowhere but the shelter. Returns how many moved.
  settle(breached = []) {
    const b = new Set(breached);
    let n = 0;
    for (const m of this.crew) {
      if (m.health <= 0 || m.location === "sickbay" || m.location === "away") continue;
      const to = this.postFor(m, b);
      if (statusOf(m) === "critical" && to !== "shelter") continue;
      if (to !== m.location) { m.location = to; n++; }
    }
    return n;
  }

  get total() { return this.crew.length; }
  alive() { return this.crew.filter((m) => m.health > 0); }
  counts() {
    const c = { healthy: 0, injured: 0, critical: 0, dead: 0 };
    for (const m of this.crew) c[statusOf(m)]++;
    return c;
  }
  // Where someone actually is right now (a hull section, or the shelter).
  whereIs(m) {
    return m.location === "station" ? m.section : m.location === "quarters" ? m.quarters : m.location === "sickbay" ? SICKBAY : m.location === "away" ? "away" : "shelter";
  }

  // Fit, skilled, rested crew at their posts against what a watch needs —
  // 1.0 is a full watch of proficient people. Reassigned crew count where
  // they're working now, at their skill there. With all hands called the
  // whole department is there, but it's still judged against one watch.
  staffing(dept) {
    const core = CORE_SKILL[dept];
    let sum = 0;
    for (const m of this.crew) {
      if (m.dept !== dept || m.location !== "station") continue;
      sum += FITNESS[statusOf(m)] * skillWeight(this.levelIn(m, core)) * effectiveness(m.fatigue);
    }
    return Math.min(STAFFING_MAX, sum / Math.max(1, this.need[dept][this.shift]));
  }
  // The multiplier a department's system runs at.
  factor(dept) { return AUTOMATION + (1 - AUTOMATION) * this.staffing(dept); }
  // Skill level (0–5) of someone in a department's core skill.
  skillIn(m, dept) { return this.levelIn(m, CORE_SKILL[dept]); }
  // Fit people of `depts` at their posts, and how much work each is good
  // for at a job using `skill`: [{ m, w }]. For repair parties (ship.js).
  workers(depts, skill) {
    const out = [];
    for (const m of this.crew) {
      if (!depts.includes(m.dept) || m.location !== "station") continue;
      const w = FITNESS[statusOf(m)] * effectiveness(m.fatigue) * (0.5 + 0.15 * this.levelIn(m, skill));
      if (w > 0) out.push({ m, w });
    }
    return out;
  }
  // Share `xp` of practice in `skill` among workers, by how much each did.
  credit(workers, skill, xp, t = 0) {
    const total = workers.reduce((a, x) => a + x.w, 0);
    if (total <= 0 || xp <= 0) return;
    for (const { m, w } of workers) this._practise(m, skill, (xp * w) / total, t);
  }
  _practise(m, skill, xp, t) {
    if (!skillById[skill] || xp <= 0) return;
    const before = this.levelIn(m, skill);
    m.xp[skill] = (m.xp[skill] ?? 0) + xp * learnRate(skill);
    const after = this.levelIn(m, skill);
    if (after > before) this.events.push({ t, kind: "level", id: m.id, skill, level: after });
  }

  // Move someone to work in another department. The career records it in
  // their file (career.js reassign); this moves them now.
  reassign(id, dept) {
    const m = this.crew.find((x) => x.id === id);
    if (!m || m.health <= 0) return null;
    m.dept = dept;
    m.section = DEPARTMENTS[dept].section;
    m.watchRates = watchPerHour(m.profile, dept);
    if (m.location !== "sickbay" && m.location !== "away" && statusOf(m) !== "critical") m.location = this.postFor(m);
    return m;
  }
  find(id) { return this.crew.find((m) => m.id === id); }

  // ---------------- orders ----------------
  shelterAll() {
    this.sheltered = true;
    this.settle();
  }
  // Clear a section to the shelter — whoever's at a post or in quarters
  // there — and keep it clear until `resume stations`.
  shelterSection(section) {
    this.evacuated.add(section);
    let n = 0;
    for (const m of this.crew) {
      if (m.health > 0 && (m.location === "station" || m.location === "quarters") && this.whereIs(m) === section) { m.location = "shelter"; n++; }
    }
    return n;
  }
  // Lift shelter and evacuation orders: everyone back to their post or
  // quarters. `breached`: sections open to space — their crew stay in
  // shelter. Returns how many left the shelter.
  resumeStations(breached = []) {
    this.sheltered = false;
    this.evacuated.clear();
    const inShelter = () => this.crew.filter((m) => m.health > 0 && m.location === "shelter").length;
    const before = inShelter();
    this.settle(breached);
    return before - inShelter();
  }
  // Everyone to their stations, whatever their watch. Returns how many came.
  callAllHands(breached = []) {
    this.allHands = true;
    const before = this.atStations();
    this.settle(breached);
    return this.atStations() - before;
  }
  // Back to the watch rotation: the off-watch go to quarters to rest.
  // Returns how many went.
  standDown(breached = []) {
    this.allHands = false;
    const before = this.atStations();
    this.settle(breached);
    return before - this.atStations();
  }
  atStations() { return this.crew.filter((m) => m.health > 0 && m.location === "station").length; }
  // Off-watch crew of a department who could come to their posts.
  offWatch(dept) { return this.crew.filter((m) => m.dept === dept && m.location === "quarters" && statusOf(m) !== "critical"); }
  // Average fatigue of the people at their posts.
  stationFatigue() {
    const at = this.crew.filter((m) => m.health > 0 && m.location === "station");
    return at.length ? at.reduce((a, m) => a + m.fatigue, 0) / at.length : 0;
  }
  sendInjured() {
    let n = 0;
    for (const m of this.crew) {
      const st = statusOf(m);
      if ((st === "injured" || st === "critical") && m.location !== "sickbay" && m.location !== "away") { m.location = "sickbay"; n++; }
    }
    return n;
  }

  // An away team leaving the ship (away.js): off their posts until recalled.
  // `awayHarm` is what the surface is doing to each of them (health/s by
  // cause) and `awayTire` how hard the going is — set by the away mission.
  sendAway(ids) {
    for (const id of ids) {
      const m = this.find(id);
      if (!m || m.health <= 0) continue;
      m.location = "away"; m.awayHarm = {}; m.awayTire = 1;
    }
  }
  // Back aboard. The hurt go to sickbay; everyone else where orders say.
  recall(ids, breached = []) {
    const b = new Set(breached);
    for (const id of ids) {
      const m = this.find(id);
      if (!m || m.location !== "away") continue;
      delete m.awayHarm; delete m.awayTire;
      m.location = m.health <= 0 ? "station" : statusOf(m) === "healthy" ? this.postFor(m, b) : b.has(SICKBAY) ? "shelter" : "sickbay";
    }
  }
  away() { return this.crew.filter((m) => m.location === "away"); }

  // ---------------- simulation ----------------
  // `ship`: the ShipSystems doing the stepping. `t`: mission time (s).
  step(dt, ship, t) {
    const breached = new Set(ship.breached());
    // ---- the clock, and the watch changing over ----
    const hours = (dt * CLOCK_RATE) / 3600;
    this.clock.hour += hours;
    if (this.clock.hour >= 24) { this.clock.hour -= 24; this.clock.day += 1; }
    if (this.shift !== this._shift) {
      this._shift = this.shift;
      this.settle([...breached]);
      this.events.push({ t, kind: "watch", shift: this.shift });
    }
    // A breach sealed: whoever was kept out of that section can go back.
    if ((this._breached ?? []).some((sec) => !breached.has(sec))) this.settle([...breached]);
    this._breached = [...breached];
    const mentored = new Set(this.crew.filter((m) => m.health > 0 && m.mentor).map((m) => m.homeDept));
    const exposed = (sec) => sec !== "shelter" && ship.hull[sec] < 0.5;
    const sickbayOk = !breached.has(SICKBAY);
    const medical = this.factor("medical");
    let worst = null;

    for (const m of this.crew) {
      if (m.health <= 0) continue;
      const before = statusOf(m);
      const where = this.whereIs(m);

      // What's hurting this person, by cause (health/s before toughness).
      // On the surface that's the surface's business (away.js), not the ship's.
      const h = {};
      if (m.location === "away") {
        Object.assign(h, m.awayHarm);
      } else {
        if (ship.harm.oxygen) h.oxygen = ship.harm.oxygen;
        if (ship.harm.co2) h.co2 = ship.harm.co2;
        if (ship.harm.pressure) h.pressure = ship.harm.pressure;
        const rad = ship.doseRate * LOC_RAD[where] * (exposed(where) ? 2 : 1);
        m.dose += rad * dt;
        if (rad > 0.002) h.radiation = (rad - 0.002) * 0.5;
        if (ship.heat > 0.85) h.heat = (ship.heat - 0.85) * 0.02 * (where === "aft" ? 1.6 : 1);
        if (breached.has(where)) h.breach = 0.01 + (0.3 - ship.hull[where]) * 0.05;
      }

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

      // ---- fatigue and practice ----
      if (m.location === "away") {
        m.fatigue = Math.min(1, m.fatigue + TIRE * hours * (m.awayTire ?? 1));
      } else if (m.location === "station") {
        m.fatigue = Math.min(1, m.fatigue + TIRE * hours);
        const k = hours * (ship.strain?.(m.dept) ?? 1);
        for (const [sk, r] of Object.entries(m.watchRates)) this._practise(m, sk, r * k * this._mentorBonus(m, sk, mentored), t);
      } else {
        m.fatigue = Math.max(0, m.fatigue - (m.location === "quarters" ? REST : REST_POORLY) * hours);
        if (m.location === "quarters") {
          const k = hours / OFF_WATCH_HOURS;
          for (const [sk, r] of Object.entries(m.routineRates)) this._practise(m, sk, r * k * this._mentorBonus(m, sk, mentored), t);
        }
      }

      const now = statusOf(m);
      if (now === "dead") {
        m.diedAt = t;
        this.events.push({ t, kind: "death", id: m.id });
      } else {
        if (now === "critical" && before !== "critical") this.events.push({ t, kind: "critical", id: m.id });
        // The critically injured are carried to sickbay — unless everyone's
        // sheltering, or sickbay itself is open to space.
        if (now === "critical" && (m.location === "station" || m.location === "quarters") && sickbayOk && !this.sheltered) m.location = "sickbay";
        // Back to work (or rest) once treated — unless that's open to space.
        if (now === "healthy" && m.location === "sickbay") m.location = this.postFor(m, breached);
      }
    }
    this.worstEta = worst;
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  _mentorBonus(m, skill, mentored) {
    return skill === CORE_SKILL[m.homeDept] && !m.mentor && mentored.has(m.homeDept) ? MENTOR_BONUS : 1;
  }

  snapshot() {
    return {
      // A plain copy for the UI: no profile (it's in the career) or rate tables.
      crew: this.crew.map((m) => {
        const { profile, watchRates, routineRates, ...rest } = m;
        return {
          ...rest, xp: { ...m.xp }, status: statusOf(m), where: this.whereIs(m), onWatch: this.onWatch(m),
          skill: this.skillIn(m, m.dept), eff: effectiveness(m.fatigue),
        };
      }),
      counts: this.counts(),
      total: this.total,
      sheltered: this.sheltered,
      allHands: this.allHands,
      evacuated: [...this.evacuated],
      clock: { ...this.clock },
      shift: this.shift,
      worstEta: this.worstEta,
      fatigue: this.stationFatigue(),
      staffing: Object.fromEntries(DEPT_ORDER.map((d) => [d, this.staffing(d)])),
      need: Object.fromEntries(DEPT_ORDER.map((d) => [d, this.need[d][this.shift]])),
    };
  }
}
