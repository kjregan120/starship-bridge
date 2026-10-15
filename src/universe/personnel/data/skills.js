// skills.js — every skill a crew member can hold. Data, not code: adding a
// skill is adding an entry here.
//
//   id          stable key, stored in profiles — never rename one
//   label       display name
//   dept        the department whose core work this is (null = general)
//   learnRate   multiplier on practice time — some skills come slower
//   description what it covers
//
// Proficiency is earned as practice time (xp) and read as a level 0–5 via
// LEVEL_XP: 0 untrained, 1 familiar, 2 qualified, 3 proficient, 4 expert,
// 5 master.

export const LEVEL_XP = [0, 100, 300, 700, 1500, 3000];
export const LEVEL_NAMES = ["Untrained", "Familiar", "Qualified", "Proficient", "Expert", "Master"];

export default [
  { id: "leadership", label: "Leadership", dept: "command", learnRate: 0.7, description: "Commanding watches, making decisions under pressure, keeping a crew together." },
  { id: "piloting", label: "Piloting", dept: "helm", learnRate: 1, description: "Hands-on helm control at impulse and in and out of warp." },
  { id: "navigation", label: "Navigation", dept: "helm", learnRate: 1, description: "Plotting courses around gravity wells and hazards." },
  { id: "sensor-analysis", label: "Sensor Analysis", dept: "science", learnRate: 1, description: "Reading and calibrating the sensor suite, separating signal from noise." },
  { id: "astrophysics", label: "Astrophysics", dept: "science", learnRate: 0.8, description: "Stellar behaviour, flares, radiation environments." },
  { id: "signals", label: "Signals", dept: "comms", learnRate: 1, description: "Running the comms array, tuning bands, holding a channel open." },
  { id: "xenolinguistics", label: "Xenolinguistics", dept: "comms", learnRate: 0.6, description: "Decoding structure in unknown transmissions." },
  { id: "reactor-ops", label: "Reactor Operations", dept: "engineering", learnRate: 0.9, description: "Running the core, managing output and restarts." },
  { id: "warp-theory", label: "Warp Field Theory", dept: "engineering", learnRate: 0.7, description: "Warp coil tuning and field stability." },
  { id: "thermal-systems", label: "Thermal Systems", dept: "engineering", learnRate: 1, description: "Radiators, coolant loops, heat management." },
  { id: "shield-ops", label: "Shield Operations", dept: "tactical", learnRate: 1, description: "Emitter control, shield harmonics, recharge cycles." },
  { id: "tactical-analysis", label: "Tactical Analysis", dept: "tactical", learnRate: 0.9, description: "Threat assessment and defensive planning." },
  { id: "weapons", label: "Weapons", dept: "tactical", learnRate: 0.9, description: "Phaser targeting, fire control, frequency rotation." },
  { id: "security-ops", label: "Security Operations", dept: "security", learnRate: 1, description: "Access control, patrols, emergency response." },
  { id: "medicine", label: "Medicine", dept: "medical", learnRate: 0.6, description: "Diagnosis and treatment, surgery, radiation medicine." },
  { id: "life-support", label: "Life Support", dept: "operations", learnRate: 1, description: "Atmosphere processing, scrubbers, pressure control." },
  { id: "environmental-systems", label: "Environmental Systems", dept: "operations", learnRate: 1, description: "Water, waste, hydroponics, habitat systems." },
  { id: "logistics", label: "Logistics", dept: "operations", learnRate: 1.1, description: "Stores, supply, rationing." },
  { id: "first-aid", label: "First Aid", dept: null, learnRate: 1.3, description: "Field treatment until medical arrives." },
  { id: "damage-control", label: "Damage Control", dept: null, learnRate: 1, description: "Sealing breaches, emergency repairs, fire suppression." },
  { id: "eva", label: "EVA", dept: null, learnRate: 0.9, description: "Work outside the hull in a pressure suit." },
  { id: "radiation-safety", label: "Radiation Safety", dept: null, learnRate: 1.2, description: "Exposure limits, shelter procedure, decontamination." },
];
