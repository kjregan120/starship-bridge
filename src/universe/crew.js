// crew.js — the forty people aboard, one at a time.
//
// Pure logic, testable in node, owned and stepped by ShipSystems (ship.js).
// Each crew member has a department, a duty station in one of the hull
// sections, their own health, radiation dose and toughness, and a location:
//   station  — at their post in their department's section
//   sickbay  — being treated (starboard section)
//   shelter  — in the shielded core, off duty
// What hurts the crew is worked out per person from where they are: a
// breach kills the people in that section first, engineering takes the
// reactor's heat, the shelter cuts radiation to a quarter.
//
// Staffing feeds back into the ship: each department's share of fit crew at
// their posts sets how well its system runs (staffing()). Nobody at a post
// isn't zero — the ship's automation keeps things ticking at 40%.
//
// You (the captain) aren't on the roster.

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

// Rank ladders per department, most senior first.
const RANKS = {
  command: ["Commander", "Lt. Commander", "Lieutenant"],
  default: ["Lieutenant", "Lieutenant", "Lt. (jg)", "Ensign", "Ensign", "Chief", "Petty Officer", "Petty Officer", "Crewman", "Crewman"],
  medical: ["Doctor", "Doctor", "Nurse", "Medic"],
};
const ROLE = {
  command: ["First Officer", "Second Officer", "Operations Officer"],
  helm: ["Helm Officer", "Navigator", "Relief Pilot"],
  science: ["Science Officer", "Sensor Analyst", "Astrophysicist", "Sensor Technician", "Lab Technician"],
  comms: ["Comms Officer", "Signals Analyst", "Linguist"],
  engineering: ["Chief Engineer", "Reactor Specialist", "Warp Specialist", "Engineer", "Engineer", "Engineer", "Plasma Technician", "Thermal Technician", "Technician", "Technician"],
  tactical: ["Tactical Officer", "Shield Specialist", "Emitter Technician", "Tactical Specialist"],
  security: ["Security Chief", "Security Officer", "Security Officer"],
  medical: ["Chief Medical Officer", "Physician", "Nurse", "Medic"],
  operations: ["Life Support Officer", "Environmental Engineer", "Ops Specialist", "Ops Technician", "Ops Technician"],
};
const FIRST = [
  "Amara", "Theo", "Yuki", "Rafael", "Ingrid", "Kwame", "Priya", "Mateo", "Sasha", "Elif", "Jonah", "Leilani", "Dmitri",
  "Noor", "Kofi", "Mei", "Tomas", "Aaliyah", "Bjorn", "Zara", "Hiro", "Camila", "Idris", "Freya", "Ravi", "Nadia",
  "Oren", "Thandiwe", "Lucas", "Saoirse", "Emeka", "Ana", "Kenji", "Marisol", "Arjun", "Wren", "Tariq", "Ilse",
  "Joaquin", "Asha", "Niko", "Halima", "Felix", "Rosa", "Desmond", "Sun-hee",
];
const LAST = [
  "Okafor", "Reyes", "Tanaka", "Lindqvist", "Mensah", "Patel", "Novak", "Haddad", "Castillo", "Volkov", "Nakamura",
  "Adeyemi", "Fischer", "Moreau", "Kowalski", "Osei", "Ibrahim", "Sato", "Delgado", "O'Brien", "Zhang", "Kaur",
  "Abara", "Petrov", "Silva", "Holm", "Mbeki", "Duarte", "Kim", "Rahman", "Vega", "Achebe", "Larsen", "Quinn",
  "Takahashi", "Nwosu", "Ortiz", "Brennan", "Yilmaz", "Aziz", "Park", "Mwangi", "Sorensen", "Farouk",
];

// Seeded so a test (or a replay) gets the same crew; a new mission passes
// a fresh seed.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateCrew(seed = Date.now()) {
  const r = rng(seed);
  // Shuffle both lists and deal them out, so no two crew share a first or
  // a last name.
  const shuffle = (a) => {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    return b;
  };
  const firsts = shuffle(FIRST), lasts = shuffle(LAST);
  let k = 0;
  const name = () => { const n = `${firsts[k]} ${lasts[k]}`; k++; return n; };
  const crew = [];
  for (const dept of DEPT_ORDER) {
    const d = DEPARTMENTS[dept];
    const ranks = RANKS[dept] ?? RANKS.default;
    for (let i = 0; i < d.size; i++) {
      crew.push({
        id: `${dept}-${i}`,
        name: name(),
        rank: ranks[Math.min(i, ranks.length - 1)],
        role: ROLE[dept][i],
        dept,
        section: d.section,
        toughness: 0.75 + r() * 0.5,
        health: 1,
        dose: 0,
        location: "station",
        diedAt: null,
        cause: null,
      });
    }
  }
  return crew;
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
  constructor(seed) {
    this.crew = generateCrew(seed);
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
  staffing(dept) {
    const members = this.crew.filter((m) => m.dept === dept);
    const fit = members.reduce((s, m) => s + (m.location === "station" ? FITNESS[statusOf(m)] : 0), 0);
    return fit / members.length;
  }
  // The multiplier a department's system runs at.
  factor(dept) { return AUTOMATION + (1 - AUTOMATION) * this.staffing(dept); }

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
      const ceiling = Math.max(0.05, 1 - Math.max(0, m.dose - 0.5) * 0.15);
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
      crew: this.crew.map((m) => ({ ...m, status: statusOf(m), where: this.whereIs(m) })),
      counts: this.counts(),
      total: this.total,
      sheltered: this.sheltered,
      worstEta: this.worstEta,
      staffing: Object.fromEntries(DEPT_ORDER.map((d) => [d, this.staffing(d)])),
    };
  }
}
