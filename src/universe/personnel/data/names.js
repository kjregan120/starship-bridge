// names.js — the raw material profiles are generated from: names, places,
// schools, ships, occupations and incidents.

export const FIRST = [
  "Amara", "Theo", "Yuki", "Rafael", "Ingrid", "Kwame", "Priya", "Mateo", "Sasha", "Elif", "Jonah", "Leilani", "Dmitri",
  "Noor", "Kofi", "Mei", "Tomas", "Aaliyah", "Bjorn", "Zara", "Hiro", "Camila", "Idris", "Freya", "Ravi", "Nadia",
  "Oren", "Thandiwe", "Lucas", "Saoirse", "Emeka", "Ana", "Kenji", "Marisol", "Arjun", "Wren", "Tariq", "Ilse",
  "Joaquin", "Asha", "Niko", "Halima", "Felix", "Rosa", "Desmond", "Sun-hee", "Malik", "Astrid", "Bao", "Chiamaka",
  "Dario", "Esme", "Farid", "Greta", "Hamza", "Imani", "Jae", "Kalani", "Lior", "Mira", "Nils", "Olu", "Paz", "Quinn",
  "Rhea", "Sefa", "Tove", "Uri", "Vida", "Wei", "Xochitl", "Yara", "Zev",
];
export const LAST = [
  "Okafor", "Reyes", "Tanaka", "Lindqvist", "Mensah", "Patel", "Novak", "Haddad", "Castillo", "Volkov", "Nakamura",
  "Adeyemi", "Fischer", "Moreau", "Kowalski", "Osei", "Ibrahim", "Sato", "Delgado", "O'Brien", "Zhang", "Kaur",
  "Abara", "Petrov", "Silva", "Holm", "Mbeki", "Duarte", "Kim", "Rahman", "Vega", "Achebe", "Larsen", "Quinn",
  "Takahashi", "Nwosu", "Ortiz", "Brennan", "Yilmaz", "Aziz", "Park", "Mwangi", "Sorensen", "Farouk", "Bauer",
  "Chowdhury", "Eze", "Gallo", "Herrera", "Iwu", "Jovanovic", "Kahale", "Lam", "Mendez", "Nair", "Oyelaran",
  "Pereira", "Rossi", "Sandoval", "Tran", "Ueda", "Vasquez", "Wojcik", "Yamada", "Zuberi",
];

export const PLACES = [
  "Lagos, Earth", "New Kyoto, Earth", "Valparaíso, Earth", "Reykjavík, Earth", "Nairobi, Earth", "Montréal, Earth",
  "Chennai, Earth", "Kraków, Earth", "Auckland, Earth", "Accra, Earth", "Tycho City, Luna", "Shackleton Base, Luna",
  "Ares Station, Mars", "Olympus Terrace, Mars", "Hellas Basin, Mars", "Europa Deep", "Ganymede Colony",
  "Titan Harbor", "Ceres Ring", "Vesta Yards", "Callisto Reach", "Proxima Haven", "Kepler's Rest", "Barnard Landing",
];

export const SCHOOLS = {
  academy: ["Fleet Academy, Luna", "Fleet Academy, Mars Annex"],
  technical: ["Fleet Technical Institute, Ares Station", "Ceres Polytechnic", "Vesta Yards Apprentice School"],
  university: ["University of Nairobi", "Tsinghua Orbital Campus", "Sorbonne Lunar", "Europa Institute of Science", "Kepler University", "Universidad de Valparaíso"],
  medical: ["Kepler Medical College", "Tycho School of Medicine", "Johns Hopkins Orbital"],
};
export const FIELDS = {
  command: ["Fleet Operations", "Strategic Studies", "Systems Management"],
  helm: ["Astronautics", "Flight Dynamics", "Orbital Mechanics"],
  science: ["Astrophysics", "Sensor Physics", "Planetary Science"],
  comms: ["Signal Processing", "Computational Linguistics", "Information Theory"],
  engineering: ["Reactor Engineering", "Warp Field Engineering", "Thermal Engineering", "Power Systems"],
  tactical: ["Defensive Systems", "Field Theory", "Applied Physics"],
  security: ["Security Studies", "Emergency Management", "Criminology"],
  medical: ["Medicine", "Radiation Medicine", "Trauma Surgery", "Nursing"],
  operations: ["Environmental Engineering", "Life Support Systems", "Logistics"],
};

export const SHIPS = [
  "ISV Kestrel", "ISV Halcyon", "ISV Perseverance", "ISV Arcadia", "ISV Corvid", "ISV Lantern", "ISV Tamsin",
  "ISV Equinox", "ISV Odyssey", "ISV Bright Harbor", "Deep Station Vesta", "Outpost Hadley",
  "Relay Station Kuiper-9", "ISV Northwind", "ISV Calliope",
];

export const OCCUPATIONS = [
  "hydroponics engineer", "teacher", "orbital architect", "doctor", "pilot", "musician", "dock supervisor",
  "geologist", "chef", "software engineer", "nurse", "artist", "shipwright", "translator", "farmer",
  "researcher", "fleet logistics officer", "station administrator",
];

// Things that happened in someone's past postings. {ship} is filled in.
//   award: what they got for it (awards.js), if anything
//   injury: what it did to them (medical history), if anything
//   dose: Sv received
export const INCIDENTS = [
  { text: "Helped contain a reactor coolant leak aboard {ship}", award: "technical-excellence", depts: ["engineering"] },
  { text: "Sealed a hull breach under fire aboard {ship}", award: "medal-of-valor", injury: "Decompression injury", depts: ["engineering", "operations", "security"] },
  { text: "Pulled two crewmates from a burning compartment aboard {ship}", award: "life-saving-medal", injury: "Burns to both hands", depts: ["security", "operations", "medical", "engineering"] },
  { text: "Treated forty casualties after the {ship} collision", award: "meritorious-service", depts: ["medical"] },
  { text: "Was caught in a solar particle event aboard {ship}", award: "line-of-duty", injury: "Acute radiation exposure", dose: 0.6 },
  { text: "Flew {ship} out of a collapsing gravity well", award: "meritorious-service", depts: ["helm"] },
  { text: "Decoded a distress call that saved the crew of {ship}", award: "meritorious-service", depts: ["comms"] },
  { text: "Predicted the flare that would have crippled {ship}", award: "technical-excellence", depts: ["science"] },
  { text: "Held shields through a CME strike aboard {ship}", award: "meritorious-service", depts: ["tactical"] },
  { text: "Broke a leg in a cargo accident aboard {ship}", award: "line-of-duty", injury: "Fractured tibia (healed)" },
  { text: "Kept life support running for nine days on emergency power aboard {ship}", award: "distinguished-service", depts: ["operations"] },
  { text: "Took temporary command of {ship} after the captain was injured", award: "distinguished-service", depts: ["command"] },
];

export const ALLERGIES = ["None known", "None known", "None known", "Penicillin", "Shellfish", "Latex", "Pollen", "Sulfa drugs"];
export const CONDITIONS = [
  "Mild asthma (controlled)", "Myopia (corrected)", "Migraines", "Old knee injury", "Hypertension (managed)",
  "Low-gravity bone density loss", "Tinnitus", "Seasonal allergies",
];
export const BLOOD_TYPES = ["O+", "O+", "A+", "A+", "B+", "AB+", "O-", "A-", "B-", "AB-"];
