// duties.js — core responsibilities: the standing jobs a department exists
// to do. Each crew member holds one primary duty (and may pick up more).
//
//   id, label, dept
//   skill      the skill the duty is performed with
//   supports   the ship system it keeps running (ship.js / crew.js key), or null
//   senior     only given to a department's senior members
//   description

export default [
  { id: "command-watch", label: "Command Watch", dept: "command", skill: "leadership", supports: null, senior: true, description: "Holds the bridge when the captain is off watch." },
  { id: "crew-evaluations", label: "Crew Evaluations", dept: "command", skill: "leadership", supports: null, description: "Performance reviews, postings and discipline." },
  { id: "mission-planning", label: "Mission Planning", dept: "command", skill: "leadership", supports: null, description: "Turns orders into a plan the departments can execute." },

  { id: "helm-watch", label: "Helm Watch", dept: "helm", skill: "piloting", supports: "impulse", description: "At the helm, flying the ship." },
  { id: "course-plotting", label: "Course Plotting", dept: "helm", skill: "navigation", supports: "impulse", description: "Plots routes around wells and hazards." },

  { id: "sensor-watch", label: "Sensor Watch", dept: "science", skill: "sensor-analysis", supports: "sensors", description: "Monitors the sensor suite and flags contacts." },
  { id: "stellar-survey", label: "Stellar Survey", dept: "science", skill: "astrophysics", supports: "sensors", description: "Characterizes nearby stars and their activity." },
  { id: "sensor-calibration", label: "Sensor Calibration", dept: "science", skill: "sensor-analysis", supports: "sensors", description: "Keeps the arrays aligned and noise down." },

  { id: "comms-watch", label: "Comms Watch", dept: "comms", skill: "signals", supports: "comms", description: "Monitors all bands, opens and holds channels." },
  { id: "signal-decoding", label: "Signal Decoding", dept: "comms", skill: "xenolinguistics", supports: "comms", description: "Works on messages pulled off open channels." },

  { id: "chief-engineer", label: "Chief Engineer", dept: "engineering", skill: "reactor-ops", supports: "reactor", senior: true, description: "Answers for every system aft of the bridge." },
  { id: "reactor-watch", label: "Reactor Watch", dept: "engineering", skill: "reactor-ops", supports: "reactor", description: "Stands watch on the core." },
  { id: "warp-coil-maintenance", label: "Warp Coil Maintenance", dept: "engineering", skill: "warp-theory", supports: "warp", description: "Keeps the coils tuned and the field stable." },
  { id: "thermal-regulation", label: "Thermal Regulation", dept: "engineering", skill: "thermal-systems", supports: "radiators", description: "Runs the radiators and coolant loops." },
  { id: "power-distribution", label: "Power Distribution", dept: "engineering", skill: "reactor-ops", supports: "reactor", description: "Balances the power grid between systems." },

  { id: "shield-watch", label: "Shield Watch", dept: "tactical", skill: "shield-ops", supports: "shields", description: "Runs the shields and their recharge." },
  { id: "emitter-calibration", label: "Emitter Calibration", dept: "tactical", skill: "shield-ops", supports: "emitters", description: "Tunes and maintains the shield emitters." },
  { id: "threat-assessment", label: "Threat Assessment", dept: "tactical", skill: "tactical-analysis", supports: null, description: "Evaluates hazards ahead of the ship." },

  { id: "security-patrol", label: "Security Patrol", dept: "security", skill: "security-ops", supports: null, description: "Patrols decks and controls access." },
  { id: "emergency-response", label: "Emergency Response", dept: "security", skill: "damage-control", supports: null, description: "First on scene for breaches, fires and casualties." },

  { id: "chief-medical", label: "Chief Medical Officer", dept: "medical", skill: "medicine", supports: "medical", senior: true, description: "Runs sickbay and certifies the crew fit for duty." },
  { id: "sickbay-duty", label: "Sickbay Duty", dept: "medical", skill: "medicine", supports: "medical", description: "Treats patients in sickbay." },
  { id: "crew-physicals", label: "Crew Physicals", dept: "medical", skill: "medicine", supports: "medical", description: "Routine examinations and dose monitoring." },

  { id: "life-support-watch", label: "Life Support Watch", dept: "operations", skill: "life-support", supports: "life", description: "Runs scrubbers, atmosphere and pressure." },
  { id: "atmosphere-processing", label: "Atmosphere Processing", dept: "operations", skill: "environmental-systems", supports: "life", description: "Oxygen generation and CO₂ removal." },
  { id: "supply-logistics", label: "Supply & Logistics", dept: "operations", skill: "logistics", supports: null, description: "Stores, spares and rations." },
];
