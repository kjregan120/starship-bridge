// activities.js — the things crew do on a regular basis. Each crew member's
// schedule (profile.schedule) is a list of these plus their duty watches.
//
//   id, label
//   kind       "duty" | "training" | "drill" | "maintenance" | "personal" | "medical"
//   cadence    "shift" | "daily" | "weekly" | "monthly"
//   hours      length of one session
//   trains     [{ skill, xp }] practice earned per session. "$core" is the
//              person's department skill, "$secondary" their best other skill.
//   for        optional filter: depts that do this ("*" or omitted = everyone)
//   seniorOnly optional
//   effect     what it will do for the ship once activities run in the sim
//              (phase 2) — descriptive for now
//   description
//
// Duty watches aren't listed here: every duty (duties.js) is scheduled as a
// "duty" activity by itself, training its own skill.

export default [
  { id: "simulator-training", label: "Simulator Training", kind: "training", cadence: "weekly", hours: 3,
    trains: [{ skill: "$core", xp: 6 }], effect: "Raises core skill", description: "Scenario training on department systems." },
  { id: "study", label: "Technical Study", kind: "training", cadence: "weekly", hours: 4,
    trains: [{ skill: "$core", xp: 4 }], effect: "Raises core skill", description: "Manuals, journals and certification coursework." },
  { id: "cross-training", label: "Cross-Training", kind: "training", cadence: "weekly", hours: 3,
    trains: [{ skill: "$secondary", xp: 5 }], effect: "Raises a secondary skill — makes reassignment possible", description: "Learning another department's work." },
  { id: "mentoring", label: "Mentoring", kind: "training", cadence: "weekly", hours: 2, seniorOnly: true,
    trains: [{ skill: "leadership", xp: 3 }], effect: "Raises junior crew's core skill", description: "Coaching junior crew in the department." },

  { id: "damage-control-drill", label: "Damage Control Drill", kind: "drill", cadence: "weekly", hours: 1,
    trains: [{ skill: "damage-control", xp: 4 }], effect: "Faster breach response", description: "Sealing breaches and suppressing fires." },
  { id: "radiation-drill", label: "Radiation Shelter Drill", kind: "drill", cadence: "monthly", hours: 1,
    trains: [{ skill: "radiation-safety", xp: 5 }], effect: "Faster shelter orders", description: "Getting every hand to shelter, against the clock." },
  { id: "eva-training", label: "EVA Training", kind: "drill", cadence: "monthly", hours: 3,
    trains: [{ skill: "eva", xp: 6 }], effect: "Enables hull repairs", description: "Suit work outside the hull." },
  { id: "first-aid-refresher", label: "First Aid Refresher", kind: "drill", cadence: "monthly", hours: 2,
    trains: [{ skill: "first-aid", xp: 5 }], effect: "Slows injury before sickbay", description: "Field treatment refresher." },

  { id: "maintenance-rounds", label: "Maintenance Rounds", kind: "maintenance", cadence: "daily", hours: 2, for: ["engineering", "operations", "tactical"],
    trains: [{ skill: "damage-control", xp: 1 }, { skill: "$core", xp: 1 }], effect: "Slow component repair", description: "Inspections and minor repairs in the department's spaces." },

  { id: "physical-training", label: "Physical Training", kind: "personal", cadence: "daily", hours: 1,
    trains: [], effect: "Maintains fitness", description: "Gym and conditioning." },
  { id: "family-call", label: "Call Home", kind: "personal", cadence: "weekly", hours: 1, family: true,
    trains: [], effect: "Morale", description: "Subspace call with family." },
  { id: "medical-checkup", label: "Medical Check-up", kind: "medical", cadence: "monthly", hours: 1,
    trains: [], effect: "Dose and health monitoring", description: "Routine physical and dosimetry." },
];
