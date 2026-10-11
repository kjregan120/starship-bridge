// awards.js — decorations a crew member can hold. Generated from their
// service history now; earned in play later.
//
//   id, label, rank (precedence, higher = more senior), description, criteria

export default [
  { id: "medal-of-valor", label: "Medal of Valor", rank: 100, description: "Conspicuous courage at the risk of one's own life.", criteria: "Acted to save the ship or crew at great personal risk." },
  { id: "life-saving-medal", label: "Life-Saving Medal", rank: 90, description: "Saving a life in an emergency.", criteria: "Rescued crew during a casualty." },
  { id: "distinguished-service", label: "Distinguished Service Cross", rank: 80, description: "Exceptional service in a position of great responsibility.", criteria: "Sustained excellence in a senior post." },
  { id: "meritorious-service", label: "Commendation for Meritorious Service", rank: 60, description: "Outstanding achievement or service.", criteria: "Noted by a commanding officer for outstanding work." },
  { id: "technical-excellence", label: "Technical Excellence Citation", rank: 50, description: "Outstanding technical achievement.", criteria: "Solved a critical technical problem." },
  { id: "line-of-duty", label: "Line of Duty Ribbon", rank: 40, description: "Injured in the line of duty.", criteria: "Wounded or irradiated while on duty." },
  { id: "deep-space-ribbon", label: "Deep Space Service Ribbon", rank: 30, description: "Service beyond the settled systems.", criteria: "Served a tour in deep space." },
  { id: "long-service", label: "Long Service Medal", rank: 20, description: "Fifteen years of service.", criteria: "15 years in the fleet." },
  { id: "fleet-service", label: "Fleet Service Ribbon", rank: 10, description: "Five years of service.", criteria: "5 years in the fleet." },
];
