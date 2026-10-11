// complement.js — the USS Meridian's forty posts. A post (slot) is a job
// on the ship; a profile is a person who fills it. When someone dies or
// leaves, their post is filled by a transfer.
//
//   slot    stable key for the post
//   dept    department (crew.js DEPARTMENTS)
//   rank    the rank the post is filled at
//   role    job title
//   duty    primary duty (duties.js)
//   kind    "officer" | "enlisted" | "medical" — shapes education and career

const officer = (rank) => ({ rank, kind: "officer" });
const enlisted = (rank) => ({ rank, kind: "enlisted" });
const medical = (rank) => ({ rank, kind: "medical" });

const posts = {
  command: [
    [officer("Commander"), "First Officer", "command-watch"],
    [officer("Lt. Commander"), "Second Officer", "mission-planning"],
    [officer("Lieutenant"), "Operations Officer", "crew-evaluations"],
  ],
  helm: [
    [officer("Lieutenant"), "Helm Officer", "helm-watch"],
    [officer("Lt. (jg)"), "Navigator", "course-plotting"],
    [officer("Ensign"), "Relief Pilot", "helm-watch"],
  ],
  science: [
    [officer("Lieutenant"), "Science Officer", "sensor-watch"],
    [officer("Lieutenant"), "Astrophysicist", "stellar-survey"],
    [officer("Lt. (jg)"), "Sensor Analyst", "sensor-watch"],
    [officer("Ensign"), "Sensor Technician", "sensor-calibration"],
    [enlisted("Petty Officer"), "Lab Technician", "sensor-calibration"],
  ],
  comms: [
    [officer("Lieutenant"), "Comms Officer", "comms-watch"],
    [officer("Ensign"), "Signals Analyst", "signal-decoding"],
    [enlisted("Petty Officer"), "Comms Technician", "comms-watch"],
  ],
  engineering: [
    [officer("Lt. Commander"), "Chief Engineer", "chief-engineer"],
    [officer("Lieutenant"), "Reactor Specialist", "reactor-watch"],
    [officer("Lt. (jg)"), "Warp Specialist", "warp-coil-maintenance"],
    [officer("Ensign"), "Engineer", "power-distribution"],
    [enlisted("Chief"), "Senior Technician", "reactor-watch"],
    [enlisted("Petty Officer"), "Plasma Technician", "reactor-watch"],
    [enlisted("Petty Officer"), "Thermal Technician", "thermal-regulation"],
    [enlisted("Petty Officer"), "Coil Technician", "warp-coil-maintenance"],
    [enlisted("Crewman"), "Technician", "thermal-regulation"],
    [enlisted("Crewman"), "Technician", "power-distribution"],
  ],
  tactical: [
    [officer("Lieutenant"), "Tactical Officer", "shield-watch"],
    [officer("Ensign"), "Shield Specialist", "shield-watch"],
    [enlisted("Petty Officer"), "Emitter Technician", "emitter-calibration"],
    [enlisted("Crewman"), "Tactical Specialist", "threat-assessment"],
  ],
  security: [
    [officer("Lieutenant"), "Security Chief", "security-patrol"],
    [enlisted("Petty Officer"), "Security Officer", "emergency-response"],
    [enlisted("Crewman"), "Security Officer", "security-patrol"],
  ],
  medical: [
    [medical("Doctor"), "Chief Medical Officer", "chief-medical"],
    [medical("Doctor"), "Physician", "sickbay-duty"],
    [medical("Nurse"), "Nurse", "sickbay-duty"],
    [medical("Medic"), "Medic", "crew-physicals"],
  ],
  operations: [
    [officer("Lieutenant"), "Life Support Officer", "life-support-watch"],
    [officer("Lt. (jg)"), "Environmental Engineer", "atmosphere-processing"],
    [enlisted("Chief"), "Ops Chief", "supply-logistics"],
    [enlisted("Petty Officer"), "Ops Technician", "life-support-watch"],
    [enlisted("Crewman"), "Ops Technician", "atmosphere-processing"],
  ],
};

export default Object.entries(posts).flatMap(([dept, list]) =>
  list.map(([r, role, duty], i) => ({ slot: `${dept}-${i}`, dept, ...r, role, duty, senior: i === 0 }))
);

// Years of service a post is typically filled at, by rank: [min, max].
export const SERVICE_YEARS = {
  "Commander": [15, 22], "Lt. Commander": [10, 16], "Lieutenant": [5, 11], "Lt. (jg)": [3, 6], "Ensign": [0, 3],
  "Chief": [12, 22], "Petty Officer": [5, 12], "Crewman": [1, 5],
  "Doctor": [6, 22], "Nurse": [3, 14], "Medic": [1, 7],
};
// Age at entry to the fleet.
export const ENTRY_AGE = { officer: [21, 25], enlisted: [18, 23], medical: [25, 31] };
