// profile.js — a crew member's personnel file.
//
// A profile is a plain JSON document, stored and grown over a career:
//
//   schemaVersion          bump + add a migration (schema.js) when the shape changes
//   id                     permanent, never reused
//   identity               { first, last, pronouns, birthDay, birthplace }
//   post                   { slot, dept, rank, role, duty, assignedDept, shift, crossTrain }
//                          shift: "alpha"|"beta"|"gamma" — the watch they stand
//                          crossTrain: a skill they're deliberately learning, or null
//   joinedFleetDay, joinedShipDay
//   education              [{ institution, field, degree, day }]
//   skills                 { [skillId]: { xp } } — level derived (skills.js LEVEL_XP)
//   duties                 [dutyId] — primary first
//   schedule               [{ activity, cadence, hours }] — "duty:<id>" for watches
//   serviceRecord          [{ ship, role, fromDay, toDay }]
//   awards                 [{ id, day, citation }]
//   family                 { maritalStatus, spouse, children, residence, nextOfKin }
//   medical                { bloodType, heightCm, massKg, fitness, constitution, allergies,
//                            conditions, injuries, lifetimeDoseSv, lastPhysicalDay, health }
//   status                 { state: "active"|"deceased"|"transferred", day, cause }
//   stats                  { missions }
//   timeline               [{ day, type, text, data }] — append-only history
//   ext                    {} — free space for future modules
//
// The timeline is the record of everything that happened; record() appends
// an event AND applies it to the sections above (applyEvent). A profile's
// generated starting point (skills, family, medical baseline) is set
// directly; everything after that — a skill practised, an award, an
// injury, a death — should go through record(), so the file and its
// history never disagree.

import SKILLS, { LEVEL_XP, LEVEL_NAMES } from "./data/skills.js";
import DUTIES from "./data/duties.js";
import ACTIVITIES from "./data/activities.js";
import AWARDS from "./data/awards.js";
import { SERVICE_YEARS, ENTRY_AGE } from "./data/complement.js";
import { PLACES, SCHOOLS, FIELDS, SHIPS, OCCUPATIONS, INCIDENTS, ALLERGIES, CONDITIONS, BLOOD_TYPES } from "./data/names.js";
import { YEAR, dateOf, yearOf, yearsBetween } from "./util.js";

export const SCHEMA_VERSION = 3;
export const skillById = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
export const dutyById = Object.fromEntries(DUTIES.map((d) => [d.id, d]));
export const activityById = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));
export const awardById = Object.fromEntries(AWARDS.map((a) => [a.id, a]));
// Each department's core skill — the one its staffing is judged on.
export const CORE_SKILL = {
  command: "leadership", helm: "piloting", science: "sensor-analysis", comms: "signals", engineering: "reactor-ops",
  tactical: "shield-ops", security: "security-ops", medical: "medicine", operations: "life-support",
};

// ---- the event log -----------------------------------------------------------
// Applies one event to the profile's current state. Changes after
// generation go through here, so the timeline explains every one of them.
export function applyEvent(p, e) {
  const d = e.data ?? {};
  switch (e.type) {
    case "education": p.education.push({ institution: d.institution, field: d.field, degree: d.degree, day: e.day }); break;
    case "joined-fleet": p.joinedFleetDay = e.day; break;
    case "posting":
      for (const s of p.serviceRecord) if (s.toDay == null) s.toDay = e.day;
      p.serviceRecord.push({ ship: d.ship, role: d.role, fromDay: e.day, toDay: null });
      if (d.ship === "USS Meridian") p.joinedShipDay = e.day;
      break;
    case "promotion": p.post.rank = d.rank; break;
    case "award": p.awards.push({ id: d.id, day: e.day, citation: d.citation ?? e.text }); break;
    case "injury": p.medical.injuries.push({ day: e.day, text: d.injury }); break;
    case "dose": p.medical.lifetimeDoseSv = +(p.medical.lifetimeDoseSv + d.sv).toFixed(3); break;
    case "skill-xp": {
      const s = (p.skills[d.skill] ??= { xp: 0 });
      s.xp += d.xp;
      break;
    }
    // A stretch of practice — a mission, or the routine between missions —
    // as one entry: { xp: { [skill]: n } }.
    case "practice":
      for (const [k, n] of Object.entries(d.xp ?? {})) (p.skills[k] ??= { xp: 0 }).xp += n;
      break;
    case "cross-train":
      p.post.crossTrain = d.skill;
      if (d.skill && !p.schedule.some((x) => x.activity === "cross-training")) {
        const a = activityById["cross-training"];
        p.schedule.push({ activity: a.id, cadence: a.cadence, hours: a.hours });
      }
      break;
    case "shift": p.post.shift = d.shift; break;
    case "reassigned": p.post.assignedDept = d.dept === p.post.dept ? null : d.dept; break;
    case "mission": p.stats.missions += 1; break;
    case "health": p.medical.health = d.health; break;
    case "physical": p.medical.lastPhysicalDay = e.day; break;
    case "death": p.status = { state: "deceased", day: e.day, cause: d.cause }; break;
    case "transferred-out": p.status = { state: "transferred", day: e.day, cause: null }; break;
    default: break; // narrative-only events (born, incident, note...)
  }
}
export function record(p, day, type, text, data) {
  const e = { day, type, text, ...(data ? { data } : {}) };
  p.timeline.push(e);
  applyEvent(p, e);
  return e;
}

// ---- derived values -------------------------------------------------------------
export const fullName = (p) => `${p.identity.first} ${p.identity.last}`;
export const ageOn = (p, day) => yearsBetween(p.identity.birthDay, day);
export function levelOf(xp) {
  let lv = 0;
  for (let i = 0; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) lv = i;
  return lv;
}
export const skillLevel = (p, skill) => levelOf(p.skills[skill]?.xp ?? 0);
export const levelName = (lv) => LEVEL_NAMES[lv];
export const currentDept = (p) => p.post.assignedDept ?? p.post.dept;
// Their best skill outside their home department — what cross-training built.
// Leadership doesn't count: officers grow it by mentoring, not cross-training.
export function secondarySkill(p) {
  let best = null;
  for (const [id, s] of Object.entries(p.skills)) {
    const sk = skillById[id];
    if (!sk || !sk.dept || sk.dept === p.post.dept || id === "leadership") continue;
    if (!best || s.xp > p.skills[best].xp) best = id;
  }
  return best;
}
// Departments this person could be reassigned to: qualified (level 2+) in
// that department's core skill.
export function qualifiedDepts(p) {
  return Object.entries(CORE_SKILL).filter(([, sk]) => skillLevel(p, sk) >= 2).map(([d]) => d);
}

// How well they stand up to harm: age, fitness, constitution, conditions.
export function toughness(p, day) {
  const age = ageOn(p, day);
  const ageF = age < 25 ? 0.97 : age <= 45 ? 1 : age <= 55 ? 0.92 : 0.85;
  const m = p.medical;
  // Centred near 1.0 for a typical crew member (fitness ~0.78).
  const t = ageF * m.constitution * (0.9 + 0.4 * (m.fitness - 0.55)) - 0.03 * m.conditions.length;
  return Math.max(0.65, Math.min(1.3, t));
}

export const PRONOUNS = {
  she: { sub: "she", obj: "her", pos: "her", Sub: "She", Pos: "Her" },
  he: { sub: "he", obj: "him", pos: "his", Sub: "He", Pos: "His" },
  they: { sub: "they", obj: "them", pos: "their", Sub: "They", Pos: "Their" },
};
const SPOUSE_WORD = { married: { she: "wife", he: "husband", they: "spouse" }, partnered: { she: "partner", he: "partner", they: "partner" } };
const NUM = ["no", "one", "two", "three", "four", "five"];

// "a wife and two children" — for casualty reports and the memorial.
export function familySummary(p) {
  const f = p.family;
  const bits = [];
  if (f.spouse && (f.maritalStatus === "married" || f.maritalStatus === "partnered")) {
    bits.push(`a ${SPOUSE_WORD[f.maritalStatus][f.spouse.pronouns]}`);
  }
  const k = f.children.length;
  if (k) bits.push(k === 1 ? "a child" : `${NUM[k] ?? k} children`);
  return bits.length ? bits.join(" and ") : null;
}

// A written biography, built from the record — recomputed whenever it's
// shown, so it always reflects what's been added since.
export function biography(p, today) {
  const pr = PRONOUNS[p.identity.pronouns];
  const name = fullName(p);
  const ed = p.education[p.education.length - 1];
  const prior = p.serviceRecord.filter((s) => s.ship !== "USS Meridian");
  const incidents = p.timeline.filter((e) => e.type === "incident");
  const lines = [];
  lines.push(`${name} was born in ${p.identity.birthplace} in ${yearOf(p.identity.birthDay)}.`);
  if (ed) lines.push(`${pr.Sub} studied ${ed.field} at ${ed.institution}, finishing in ${yearOf(ed.day)}.`);
  const yrs = yearsBetween(p.joinedFleetDay, today);
  lines.push(yrs >= 1
    ? `${pr.Sub} ${pr.sub === "they" ? "have" : "has"} served ${yrs} year${yrs === 1 ? "" : "s"} in the fleet${prior.length ? `, aboard ${prior.slice(-2).map((s) => s.ship).join(" and ")} before the Meridian` : ""}.`
    : `The Meridian is ${pr.pos} first posting.`);
  if (incidents.length) lines.push(`${incidents[incidents.length - 1].text}.`);
  const sec = secondarySkill(p);
  if (sec && skillLevel(p, sec) >= 2) lines.push(`Cross-trained in ${skillById[sec].label.toLowerCase()}.`);
  const f = p.family;
  if (f.spouse && (f.maritalStatus === "married" || f.maritalStatus === "partnered")) {
    const kids = f.children.length
      ? `, and they have ${f.children.length === 1 ? "a child" : `${NUM[f.children.length]} children`}, ${f.children.map((c) => `${c.name} (${yearsBetween(c.birthDay, today)})`).join(" and ")}`
      : "";
    lines.push(`${pr.Sub} ${pr.sub === "they" ? "are" : "is"} ${f.maritalStatus === "married" ? "married to" : "partnered with"} ${f.spouse.name}, ${articled(f.spouse.occupation)}${kids}. The family lives in ${f.residence}.`);
  } else if (f.children.length) {
    lines.push(`${pr.Sub} ${pr.sub === "they" ? "have" : "has"} ${f.children.length === 1 ? "a child" : `${NUM[f.children.length]} children`}, who live${f.children.length === 1 ? "s" : ""} in ${f.residence}.`);
  }
  if (p.status.state === "deceased") lines.push(`Died ${dateOf(p.status.day)} aboard the USS Meridian.`);
  return lines.join(" ");
}
const articled = (w) => `${/^[aeiou]/i.test(w) ? "an" : "a"} ${w}`;

// ---- generation ----------------------------------------------------------------
const OFFICER_LADDER = ["Ensign", "Lt. (jg)", "Lieutenant", "Lt. Commander", "Commander"];
const ENLISTED_LADDER = ["Crewman", "Petty Officer", "Chief"];

function emptyProfile(id) {
  return {
    schemaVersion: SCHEMA_VERSION, id,
    identity: null, post: null, joinedFleetDay: null, joinedShipDay: null,
    education: [], skills: {}, duties: [], schedule: [], serviceRecord: [], awards: [],
    family: null, medical: null, status: { state: "active", day: null, cause: null },
    stats: { missions: 0 }, timeline: [], ext: {},
  };
}

// A new person for a post. `r`: makeRng stream. `today`: ship day.
// `names`: { first: Set, last: Set } of names already aboard, to avoid repeats.
export function generateProfile(r, id, post, today, names, firstPool, lastPool) {
  const p = emptyProfile(id);
  const kind = post.kind === "medical" && post.rank === "Medic" ? "enlisted" : post.kind;
  const years = r.int(...SERVICE_YEARS[post.rank]);
  const entryAge = r.int(...ENTRY_AGE[post.kind]);
  const joinedFleetDay = today - Math.round(years * YEAR) - r.int(0, 200);
  const birthDay = joinedFleetDay - Math.round(entryAge * YEAR) - r.int(0, 364);

  const pickName = (pool, used) => {
    const free = pool.filter((n) => !used.has(n));
    const n = r.pick(free.length ? free : pool);
    used.add(n);
    return n;
  };
  const pronouns = r.chance(0.08) ? "they" : r.chance(0.5) ? "she" : "he";
  p.identity = { first: pickName(firstPool, names.first), last: pickName(lastPool, names.last), pronouns, birthDay, birthplace: r.pick(PLACES) };
  p.post = { slot: post.slot, dept: post.dept, rank: post.rank, role: post.role, duty: post.duty, assignedDept: null, shift: post.shift, crossTrain: null };
  // Started empty so the history below can record injuries and doses into
  // it; filled in at the end.
  p.medical = { injuries: [], lifetimeDoseSv: 0 };
  record(p, birthDay, "born", `Born in ${p.identity.birthplace}`);

  // ---- education ----
  const field = r.pick(FIELDS[post.dept]);
  if (post.kind === "officer") {
    if (r.chance(0.3)) record(p, joinedFleetDay - Math.round(5 * YEAR), "education", `BSc, ${r.pick(SCHOOLS.university)}`,
      { institution: r.pick(SCHOOLS.university), field: r.pick(FIELDS.science.concat(FIELDS.engineering)), degree: "BSc" });
    const school = r.pick(SCHOOLS.academy);
    record(p, joinedFleetDay - 7, "education", `Graduated ${school}`, { institution: school, field, degree: "Fleet Commission" });
  } else if (post.kind === "medical" && post.rank === "Doctor") {
    const uni = r.pick(SCHOOLS.university), med = r.pick(SCHOOLS.medical);
    record(p, joinedFleetDay - Math.round(6 * YEAR), "education", `BSc, ${uni}`, { institution: uni, field: "Biology", degree: "BSc" });
    record(p, joinedFleetDay - 30, "education", `MD, ${med}`, { institution: med, field, degree: "MD" });
  } else if (post.kind === "medical" && post.rank === "Nurse") {
    const med = r.pick(SCHOOLS.medical);
    record(p, joinedFleetDay - 30, "education", `BSN, ${med}`, { institution: med, field: "Nursing", degree: "BSN" });
  } else {
    const tech = r.pick(SCHOOLS.technical);
    const f = post.rank === "Medic" ? "Field Medicine" : field;
    record(p, joinedFleetDay - 14, "education", `Certified, ${tech}`, { institution: tech, field: f, degree: "Technical Certificate" });
  }
  record(p, joinedFleetDay, "joined-fleet", post.kind === "officer" ? "Commissioned in the fleet" : "Enlisted in the fleet");

  // ---- rank history ----
  const ladder = post.kind === "officer" ? OFFICER_LADDER : kind === "enlisted" && post.kind !== "medical" ? ENLISTED_LADDER : null;
  if (ladder) {
    const top = ladder.indexOf(post.rank);
    p.post.rank = ladder[0];
    for (let i = 1; i <= top; i++) {
      const day = joinedFleetDay + Math.round(((years * YEAR) * i) / (top + 1)) + r.int(-60, 60);
      record(p, Math.min(day, today - 30), "promotion", `Promoted to ${ladder[i]}`, { rank: ladder[i] });
    }
  }

  // ---- service record: prior postings, then the Meridian ----
  const aboardSince = years < 1 ? Math.min(today - 1, joinedFleetDay + 30) : today - r.int(60, Math.min(Math.round(years * YEAR), Math.round(4 * YEAR)));
  const priorCount = years < 1 ? 0 : years < 3 ? r.int(0, 1) : Math.min(4, 1 + Math.floor(years / 5) + r.int(0, 1));
  const ships = r.shuffle(SHIPS).slice(0, priorCount);
  ships.forEach((ship, i) => {
    const from = joinedFleetDay + Math.round(((aboardSince - joinedFleetDay) * i) / priorCount);
    record(p, from, "posting", `Posted to ${ship}`, { ship, role: post.role });
    // Something happened there, sometimes.
    if (r.chance(0.28)) {
      const pool = INCIDENTS.filter((x) => !x.depts || x.depts.includes(post.dept));
      const inc = r.pick(pool);
      const day = from + r.int(30, Math.max(31, Math.round(((aboardSince - joinedFleetDay) / priorCount) - 30)));
      const text = inc.text.replace("{ship}", ship);
      record(p, day, "incident", text, { ship });
      if (inc.injury) record(p, day, "injury", inc.injury, { injury: inc.injury });
      if (inc.dose) record(p, day, "dose", `Received ${inc.dose} Sv`, { sv: inc.dose });
      if (inc.award) record(p, day + r.int(20, 90), "award", awardById[inc.award].label, { id: inc.award, citation: text });
    }
    if (/Station|Outpost|Relay/.test(ship) && !p.awards.some((a) => a.id === "deep-space-ribbon")) {
      record(p, from + 365, "award", awardById["deep-space-ribbon"].label, { id: "deep-space-ribbon", citation: `Tour at ${ship}` });
    }
  });
  record(p, aboardSince, "posting", "Posted to USS Meridian", { ship: "USS Meridian", role: post.role });
  if (years >= 5) record(p, joinedFleetDay + Math.round(5 * YEAR), "award", awardById["fleet-service"].label, { id: "fleet-service", citation: "Five years of service" });
  if (years >= 15) record(p, joinedFleetDay + Math.round(15 * YEAR), "award", awardById["long-service"].label, { id: "long-service", citation: "Fifteen years of service" });
  if (post.senior && years >= 8 && r.chance(0.5)) {
    record(p, today - r.int(100, 900), "award", awardById["meritorious-service"].label, { id: "meritorious-service", citation: `Exemplary service as ${post.role}` });
  }

  // ---- skills: practice accumulated over a career ----
  const core = CORE_SKILL[post.dept];
  const gain = (skill, xp) => { if (xp > 0) p.skills[skill] = { xp: (p.skills[skill]?.xp ?? 0) + Math.round(xp) }; };
  gain(core, 160 + years * r.float(140, 210));
  for (const s of SKILLS) if (s.dept === post.dept && s.id !== core) gain(s.id, (80 + years * r.float(60, 130)));
  const duty = dutyById[post.duty];
  if (duty && duty.skill !== core) gain(duty.skill, 120 + years * 120);
  if (post.senior || post.dept === "command") gain("leadership", 150 + years * r.float(60, 140));
  gain("first-aid", r.int(80, 300) + (post.dept === "medical" ? 900 : 0));
  gain("radiation-safety", r.int(100, 250) + years * 20);
  gain("damage-control", r.int(40, 200) + (["engineering", "operations", "security"].includes(post.dept) ? years * 60 : years * 15));
  if (r.chance(0.4)) gain("eva", r.int(100, 700));
  // Cross-training: some have a second department's core skill.
  if (r.chance(0.4)) {
    const other = r.pick(Object.keys(CORE_SKILL).filter((d) => d !== post.dept && d !== "command" && d !== "medical"));
    gain(CORE_SKILL[other], r.int(300, 950));
  }

  // ---- duties and schedule ----
  p.duties = [post.duty];
  if (post.senior) {
    const extra = DUTIES.filter((d) => d.dept === post.dept && d.id !== post.duty && !d.senior);
    if (extra.length) p.duties.push(r.pick(extra).id);
  }

  // ---- family ----
  const age = yearsBetween(birthDay, today);
  const pMarried = age < 25 ? 0.12 : age < 35 ? 0.42 : 0.6;
  const roll = r.next();
  const maritalStatus =
    roll < pMarried ? "married" :
    roll < pMarried + 0.12 ? "partnered" :
    age > 32 && roll < pMarried + 0.2 ? "divorced" :
    age > 42 && roll < pMarried + 0.23 ? "widowed" : "single";
  let spouse = null;
  if (maritalStatus !== "single") {
    const sp = r.chance(0.5) ? "she" : r.chance(0.9) ? "he" : "they";
    spouse = {
      name: `${r.pick(firstPool)} ${maritalStatus === "married" && r.chance(0.5) ? p.identity.last : r.pick(lastPool)}`,
      pronouns: sp, occupation: r.pick(OCCUPATIONS), status: maritalStatus === "widowed" ? "deceased" : "living",
    };
  }
  const children = [];
  if (maritalStatus !== "single" || r.chance(0.08)) {
    const n = age < 26 ? r.int(0, 1) : r.int(0, 3);
    for (let i = 0; i < n; i++) {
      const childAge = r.int(0, Math.max(0, Math.min(age - 22, 24)));
      children.push({ name: r.pick(firstPool), birthDay: today - Math.round(childAge * YEAR) - r.int(0, 364) });
    }
    children.sort((a, b) => a.birthDay - b.birthDay);
  }
  const residence = r.pick(PLACES);
  p.family = {
    maritalStatus, spouse, children, residence,
    nextOfKin: spouse && spouse.status === "living" ? `${spouse.name} (${maritalStatus === "married" ? "spouse" : "partner"})`
      : children.find((c) => yearsBetween(c.birthDay, today) >= 18)?.name ?? `${r.pick(firstPool)} ${p.identity.last} (parent)`,
  };

  // ---- medical ----
  const heightCm = r.int(152, 198);
  const conditions = r.shuffle(CONDITIONS).slice(0, age > 40 ? r.int(0, 2) : r.int(0, 1));
  p.medical = {
    bloodType: r.pick(BLOOD_TYPES), heightCm,
    massKg: Math.round(((heightCm / 100) ** 2) * r.float(20, 28)),
    fitness: +r.float(0.55, 1).toFixed(2), constitution: +r.float(0.9, 1.1).toFixed(2),
    allergies: [r.pick(ALLERGIES)].filter((a) => a !== "None known"),
    conditions, injuries: p.medical.injuries, lifetimeDoseSv: p.medical.lifetimeDoseSv,
    lastPhysicalDay: today - r.int(10, 120), health: 1,
  };
  // Routine background exposure over a career in space.
  p.medical.lifetimeDoseSv = +(p.medical.lifetimeDoseSv + years * r.float(0.01, 0.03)).toFixed(3);

  p.schedule = buildSchedule(p, post, r);
  p.timeline.sort((a, b) => a.day - b.day);
  return p;
}

// Their regular week: duty watches, training, drills, personal time.
export function buildSchedule(p, post, r) {
  const sched = p.duties.map((d, i) => ({ activity: `duty:${d}`, cadence: "shift", hours: i === 0 ? 8 : 2 }));
  const sec = secondarySkill(p);
  for (const a of ACTIVITIES) {
    if (a.for && !a.for.includes(post.dept)) continue;
    if (a.seniorOnly && !post.senior) continue;
    if (a.id === "cross-training" && !sec) continue;
    if (a.id === "study" && !r.chance(0.6)) continue;
    if (a.family && !(p.family?.spouse || p.family?.children?.length) && !r.chance(0.5)) continue;
    sched.push({ activity: a.id, cadence: a.cadence, hours: a.hours });
  }
  return sched;
}

// Resolve "$core"/"$secondary" in an activity's training list for a person.
export function activityTrains(p, activityId) {
  if (activityId.startsWith("duty:")) {
    const d = dutyById[activityId.slice(5)];
    return d ? [{ skill: d.skill, xp: 2 }] : [];
  }
  const a = activityById[activityId];
  if (!a) return [];
  return a.trains.map((t) => ({
    ...t,
    skill: t.skill === "$core" ? CORE_SKILL[p.post.dept] : t.skill === "$secondary" ? p.post.crossTrain ?? secondarySkill(p) : t.skill,
  })).filter((t) => t.skill);
}

// ---- learning by doing -------------------------------------------------------
// Practice turns into skill: xp × the skill's learn rate (skills.js). Two
// sources: standing a watch (their duties, by the hour), and the rest of
// their routine (training, drills, maintenance — the schedule, by the day).
// The routine runs between missions (career.js) and off watch during one
// (crew.js); watch hours only accrue on watch, and count for more when the
// department is under strain.
const PER_DAY = { shift: 1, daily: 1, weekly: 1 / 7, monthly: 1 / 30 };
const WATCH_XP_PER_HOUR = 0.25;          // a duty's 2 xp a session over an 8-hour watch
export const MENTOR_BONUS = 1.25;        // on core skill, for juniors with a mentor aboard
export const learnRate = (skill) => skillById[skill]?.learnRate ?? 1;
export const isMentor = (p) => p.schedule.some((x) => x.activity === "mentoring");

// { [skill]: xp } a day of routine earns, off watch. Duty watches excluded.
export function routinePerDay(p) {
  const out = {};
  for (const x of p.schedule) {
    if (x.activity.startsWith("duty:")) continue;
    for (const t of activityTrains(p, x.activity)) out[t.skill] = (out[t.skill] ?? 0) + t.xp * PER_DAY[x.cadence];
  }
  return out;
}
// { [skill]: xp } an hour on watch earns. Working in another department
// (reassigned), it's that department's core skill they're learning.
export function watchPerHour(p, dept = currentDept(p)) {
  if (dept !== p.post.dept) return { [CORE_SKILL[dept]]: WATCH_XP_PER_HOUR };
  const out = {};
  for (const d of p.duties) {
    const sk = dutyById[d]?.skill;
    if (sk) out[sk] = (out[sk] ?? 0) + WATCH_XP_PER_HOUR;
  }
  return out;
}
// Levels a set of gains would carry someone to: [{ skill, level }].
export function levelUps(p, gains) {
  const out = [];
  for (const [k, n] of Object.entries(gains)) {
    const before = skillLevel(p, k), after = levelOf((p.skills[k]?.xp ?? 0) + n);
    if (after > before) out.push({ skill: k, level: after });
  }
  return out;
}
// Record a stretch of practice: one "practice" entry, then one for each
// level reached. `gains` are raw xp (learn rate already applied); fractions
// are dropped. Returns the levels reached.
export function recordPractice(p, day, label, gains) {
  const xp = {};
  for (const [k, n] of Object.entries(gains)) if (Math.floor(n) >= 1) xp[k] = Math.floor(n);
  if (!Object.keys(xp).length) return [];
  const ups = levelUps(p, xp);
  const top = Object.entries(xp).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, n]) => `+${n} ${skillById[k]?.label.toLowerCase() ?? k}`).join(", ");
  record(p, day, "practice", `${label}: ${top}`, { xp });
  for (const u of ups) record(p, day, "skill-level", `Reached ${LEVEL_NAMES[u.level]} in ${skillById[u.skill]?.label ?? u.skill}`, u);
  return ups;
}
