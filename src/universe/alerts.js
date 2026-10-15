// alerts.js — reads the ship's condition (ship.js) and decides what's wrong,
// how bad, how long until it gets worse, and what to do about it.
//
// Pure logic, testable in node. Every problem becomes a threat:
//   { id, level: "yellow"|"red", sev (0-100), title, detail, eta (s|null),
//     action (an order the player can type, or null), say (what the
//     computer speaks) }
// sorted worst first. The ship's alert condition is the worst level present.
// The computer voice, the dashboard's priority panel and the red-alert
// visuals all read the same list, so they never disagree about what matters.

import { DEPARTMENTS, DEPT_ORDER, causeWords, spokenRank, effectiveness } from "./crew.js";
import { PRONOUNS } from "./personnel/profile.js";

const pct = (x) => `${Math.round(x * 100)} percent`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
export function fmtEta(s) {
  if (s == null || !isFinite(s)) return null;
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
// "in about forty seconds" — rounded the way a person would say it.
function sayEta(s) {
  if (s == null) return "";
  if (s < 15) return " in seconds";
  if (s < 60) return ` in about ${Math.round(s / 10) * 10} seconds`;
  const m = Math.round(s / 60);
  return ` in about ${m} minute${m === 1 ? "" : "s"}`;
}

const HARM_WORDS = {
  radiation: "radiation exposure", oxygen: "oxygen deprivation", pressure: "decompression",
  heat: "heat", co2: "carbon dioxide poisoning", breach: "hull breach",
};
const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const num = (n) => NUM[n] ?? String(n);

export function assessThreats(ship) {
  const T = [];
  const add = (t) => T.push(t);
  const src = ship.flux.source?.name;
  const withdraw = src ? `Recommend immediate withdrawal from ${src}.` : "Recommend withdrawal.";
  const radHot = ship.flux.rad > 3;

  if (ship.crewLost) {
    add({ id: "crew-lost", level: "red", sev: 100, title: "ALL HANDS LOST", detail: "", eta: 0, action: null, say: "" });
    return T;
  }

  // ---- crew ----
  const r = ship.roster;
  const c = r.counts();
  const alive = r.total - c.dead;
  const hurting = r.alive().filter((m) => m.hurting);
  // The cause hurting the most people right now.
  const tally = {};
  for (const m of hurting) tally[m.cause] = (tally[m.cause] ?? 0) + 1;
  const cause = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
  const breachedHere = ship.breached().filter((sec) => r.crew.some((m) => m.health > 0 && m.location === "station" && m.section === sec));
  const crewAction =
    cause === "radiation" ? (r.sheltered ? "withdraw" : "all hands to shelter") :
    cause === "heat" ? "withdraw" :
    cause === "breach" && breachedHere.length ? `evacuate ${breachedHere[0]}` :
    r.alive().some((m) => m.health < 0.65 && m.location !== "sickbay") ? "send injured to sickbay" : null;
  if (c.critical || hurting.length || c.injured) {
    const eta = r.worstEta;
    const red = c.critical > 0 || (eta != null && eta < 90);
    const bits = [c.critical && `${c.critical} critical`, c.injured && `${c.injured} injured`].filter(Boolean).join(" · ");
    add({
      id: "crew", level: red ? "red" : "yellow", sev: red ? 95 : 60,
      title: `Crew ${alive}/${r.total}${bits ? ` · ${bits}` : ""}`,
      detail: cause ? `Cause: ${causeWords(cause)}` : "Recovering",
      eta, action: crewAction,
      say: (red ? "Medical emergency. " : "") +
        (c.critical ? `${num(c.critical)} crew in critical condition` : `${num(hurting.length || c.injured)} crew injured`) +
        (cause ? `, from ${causeWords(cause)}.` : ".") +
        (eta != null && red ? ` Casualties expected${sayEta(eta)}.` : "") +
        (crewAction === "all hands to shelter" ? " Recommend all hands to radiation shelter." :
          crewAction === "withdraw" ? ` ${withdraw}` :
          crewAction?.startsWith("evacuate") ? ` Recommend evacuating the ${breachedHere[0]} section.` : ""),
    });
  }
  if (r.sheltered) {
    const safe = ship.doseRate * 3600 < 0.5;
    add({
      id: "sheltered", level: "yellow", sev: safe ? 48 : 22, title: "All hands in shelter — stations unmanned",
      detail: "Systems on automation", eta: null, action: safe ? "resume stations" : null,
      say: safe ? "Radiation levels have fallen. Recommend crew return to stations." : "",
    });
  } else {
    for (const d of DEPT_ORDER) {
      const dep = DEPARTMENTS[d];
      if (!dep.system) continue;
      const st = r.staffing(d);
      if (st >= 0.5) continue;
      // Off-watch hands who could come and cover, or people kept in
      // shelter by an evacuation order.
      const off = r.allHands ? 0 : r.offWatch(d).length;
      const held = r.evacuated.size ? r.crew.filter((m) => m.dept === d && m.health > 0 && m.location === "shelter").length : 0;
      const action = off ? "call all hands" : held ? "resume stations" : null;
      add({
        id: `staff-${d}`, level: "yellow", sev: 44, title: `${dep.label} short-handed — ${Math.round(st * 100)}% of a watch`,
        detail: `${dep.effect} reduced${off ? ` · ${off} off watch` : held ? ` · ${held} in shelter` : ""}`, eta: null, action,
        say: `${dep.label} is short-handed. ${dep.effect} reduced.` +
          (off ? " Recommend calling all hands." : held ? " Recommend crew return to stations." : ""),
      });
    }
  }
  if (r.allHands && !r.sheltered) {
    const tired = r.stationFatigue();
    const busy = Object.values(ship.repairs ?? {}).some((x) => x.rate > 0);
    if (tired > 0.55) {
      add({
        id: "fatigue", level: "yellow", sev: 38, title: `Crew tiring — ${Math.round(effectiveness(tired) * 100)}% effective`,
        detail: "All hands at stations", eta: null, action: "stand down",
        say: "The crew are tiring. Recommend standing down to normal watches.",
      });
    } else if (!busy && !T.some((t) => t.level === "red")) {
      add({
        id: "all-hands", level: "yellow", sev: 15, title: "All hands at stations", detail: "Nothing to repair",
        eta: null, action: "stand down", say: "",
      });
    }
  }

  // ---- radiation ----
  // Red where the crew starts taking acute harm (ship.js: 0.002 Sv/s).
  const svh = ship.doseRate * 3600;
  if (svh > 7.2) {
    add({
      id: "radiation", level: "red", sev: 92, title: `Lethal radiation — ${svh.toFixed(1)} Sv/h`,
      detail: src ? `Source: ${src}` : "", eta: null, action: "withdraw",
      say: `Warning. Lethal radiation levels. ${ship.shields < 0.05 ? "Shields have failed. " : ""}${withdraw}`,
    });
  } else if (svh > 0.5) {
    add({
      id: "radiation", level: "yellow", sev: 58, title: `Radiation ${svh.toFixed(1)} Sv/h`,
      detail: src ? `Source: ${src}` : "", eta: null, action: ship.shields < 0.5 ? "power shields 150" : "withdraw",
      say: `Radiation levels rising. ${ship.shields < 0.5 ? "Recommend diverting power to shields." : withdraw}`,
    });
  }

  // ---- incoming coronal mass ejection (cme.js; ship.incoming, set by the loop) ----
  // Red if the front carries more than the shields can take.
  const cme = (ship.incoming ?? []).find((x) => x.kind === "cme" && x.energy >= 0.05);
  if (cme) {
    const through = cme.energy > ship.shields;
    add({
      id: "cme", level: through ? "red" : "yellow", sev: through ? 85 : 50,
      title: `Coronal mass ejection inbound${cme.source ? ` — ${cme.source}` : ""}`,
      detail: `Impact ${Math.round(cme.energy * 100)}% of shield strength`, eta: cme.eta,
      action: ship.settings.shields < 1.5 ? "power shields 150" : null,
      say: `${through ? "Warning. " : ""}Coronal mass ejection${cme.source ? ` from ${cme.source}` : ""} will reach us${sayEta(cme.eta)}.` +
        (through ? " Shields will not hold." : "") +
        (ship.settings.shields < 1.5 ? " Recommend diverting power to shields." : ""),
    });
  }

  // ---- a Collective cube (cube.js; ship.incoming, set by the loop) ----
  // Closing: red, with time to weapons range — run while warp is still an
  // option. Held: the tractor is the threat, and the way out is to strain.
  const cube = (ship.incoming ?? []).find((x) => x.kind === "cube");
  if (cube) {
    if (ship.tractored) {
      const overdriven = ship.reactor.capacity > 100;
      add({
        id: "tractor", level: "red", sev: 90, title: "Held in tractor beam",
        detail: cube.strain > 0 ? `Straining — ${Math.round(cube.strain * 100)}%` : "Warp off-line · impulse at 15%",
        eta: null, action: overdriven ? "ahead full" : "reactor 120",
        say: `We're caught in their tractor beam. ${overdriven ? "Recommend full impulse to break free." : "Recommend overdriving the reactor and full impulse to break free."}`,
      });
    }
    const inRange = cube.eta == null;
    add({
      id: "cube", level: "red", sev: inRange ? 88 : 80,
      title: `${cube.name} — ${Math.round(cube.dist)}u${inRange ? "" : ", closing"}`,
      detail: inRange ? "In weapons range" : "Closing to weapons range",
      eta: cube.eta, action: ship.tractored ? null : ship.warpInhibit ? "ahead full" : "warp 3",
      say: inRange
        ? "The cube is in weapons range."
        : `Collective cube closing on us. It will be in weapons range${sayEta(cube.eta)}. Recommend we go to warp.`,
    });
  }

  // ---- reactor ----
  if (ship.reactor.scrammed) {
    add({
      id: "scram", level: "red", sev: 88, title: "Reactor scram",
      detail: `Emergency power · restart in ${Math.max(0, Math.ceil(ship.reactor.restartIn))}s`,
      eta: null, action: radHot ? "withdraw" : null,
      say: `Reactor scram. Emergency power only.${radHot ? ` ${withdraw}` : ""}`,
    });
  }

  // ---- atmosphere ----
  const breaches = ship.breached();
  if (breaches.length) {
    const eta = ship.eta("pressure");
    // How long damage control needs to seal the worst of them.
    const rep = ship.repairs?.[breaches[0]];
    const seal = rep?.rate > 0 ? (0.3 - ship.hull[breaches[0]]) / rep.rate : null;
    add({
      id: "breach", level: "red", sev: 86, title: `Hull breach — ${breaches.join(", ")}`,
      detail: `Pressure ${ship.atmo.pressure.toFixed(2)} atm${seal != null ? ` · sealing ${breaches[0]} in ${fmtEta(seal)}` : rep?.blocked ? ` · ${rep.blocked}` : ""}`,
      eta, action: breachedHere.length ? `evacuate ${breachedHere[0]}` : !r.allHands && !r.sheltered ? "call all hands" : null,
      say: `Hull breach, ${breaches.join(" and ")} section${breaches.length > 1 ? "s" : ""}. Cabin pressure falling.` +
        (eta != null ? ` Atmosphere lost${sayEta(eta)}.` : ""),
    });
  }
  if (ship.atmo.breathable < 0.6) {
    add({
      id: "air", level: "red", sev: 90, title: `Breathable air ${Math.round(ship.atmo.breathable * 100)}%`,
      detail: ship.atmo.pressure < 0.6 ? "Decompression" : "Life support failing",
      eta: ship.eta("breathable"), action: ship.power.sat.life < 1 ? "power life 150" : null,
      say: "Warning. Oxygen levels critical.",
    });
  }

  // ---- shields ----
  {
    const eta = ship.eta("shields");
    const falling = eta != null;
    if (ship.shields < 0.02 && (radHot || ship.flux.rad > 1)) {
      add({
        id: "shields", level: "red", sev: 84, title: "Shields down", detail: `Emitters ${Math.round(ship.health.emitters * 100)}%`,
        eta: null, action: "power shields 150", say: "Shields have failed.",
      });
    } else if (falling && (ship.shields < 0.5 || eta < 60)) {
      const red = ship.shields < 0.25 || eta < 30;
      add({
        id: "shields", level: red ? "red" : "yellow", sev: red ? 80 : 55,
        title: `Shields ${Math.round(ship.shields * 100)}% and falling`, detail: radHot ? "Absorbing stellar radiation" : "",
        eta, action: ship.settings.shields < 1.5 ? "power shields 150" : "withdraw",
        say: `Shields at ${pct(ship.shields)} and falling.${eta != null ? ` Shield failure${sayEta(eta)}.` : ""} ` +
          (ship.settings.shields < 1.5 ? "Recommend diverting power to shields." : withdraw),
      });
    }
  }

  // ---- heat ----
  {
    const eta = ship.eta("heat");
    const starHeat = ship.flux.heat > 2;
    const fix = starHeat ? "withdraw" : ship.reactor.setting > 0.8 ? "reactor 80" : null;
    const heatPct = Math.round(ship.heat * 100);
    if (ship.heat > 0.9) {
      add({
        id: "heat", level: "red", sev: 82, title: `Heat ${heatPct}% — components overheating`,
        detail: ship.reactor.scrammed ? "Reactor scrammed" : "Scram at 100%", eta: ship.reactor.scrammed ? null : eta, action: fix,
        say: ship.reactor.scrammed
          ? `Thermal load critical. Components overheating. ${starHeat ? withdraw : ""}`
          : `Warning. Core temperature critical. Reactor scram${sayEta(eta) || " imminent"}. ` +
            (starHeat ? withdraw : "Recommend reducing reactor output."),
      });
    } else if (!ship.reactor.scrammed && eta != null && eta < 45) {
      add({
        id: "heat", level: "red", sev: 80, title: `Heat ${heatPct}% and climbing — scram in ${fmtEta(eta)}`,
        detail: starHeat ? `Stellar heating from ${src}` : "", eta, action: fix,
        say: `Warning. Heat rising rapidly. Reactor scram${sayEta(eta)}. ` +
          (starHeat ? withdraw : "Recommend reducing reactor output."),
      });
    } else if (!ship.reactor.scrammed && ship.heat > 0.75) {
      add({
        id: "heat", level: "yellow", sev: 52, title: `Heat ${Math.round(ship.heat * 100)}% — reactor derating`,
        detail: starHeat ? `Stellar heating from ${src}` : "", eta, action: fix,
        say: `Thermal load at ${pct(ship.heat)}. Reactor output derating.`,
      });
    }
  }

  // ---- proximity: a warning before anything has broken ----
  if (ship.flux.rad > 8 || ship.flux.heat > 8) {
    add({
      id: "proximity", level: "red", sev: 78, title: `Dangerous proximity — ${src}`,
      detail: `Flux: heat ${ship.flux.heat.toFixed(1)} · radiation ${ship.flux.rad.toFixed(1)}`, eta: null, action: "withdraw",
      say: `Warning. Dangerous proximity to ${src}. ${withdraw}`,
    });
  } else if (ship.flux.rad > 3 || ship.flux.heat > 3) {
    add({
      id: "proximity", level: "yellow", sev: 45, title: `High stellar flux — ${src}`,
      detail: `Flux: heat ${ship.flux.heat.toFixed(1)} · radiation ${ship.flux.rad.toFixed(1)}`, eta: null, action: "withdraw",
      say: `Caution. Thermal and radiation flux rising near ${src}. Recommend standing off.`,
    });
  }

  // ---- faults: wear and tear breaking things (faults.js) ----
  const faults = ship.wear?.cause ?? {};
  for (const [c, name] of Object.entries(faults)) {
    const v = ship.health[c], rep = ship.repairs?.[c], spreading = ship.wear.active[c];
    const blocked = rep?.blocked;
    const red = spreading && (blocked || v < 0.3);
    const Label = cap(COMPONENT_NAME[c]);
    add({
      id: `fault-${c}`, level: red ? "red" : "yellow", sev: red ? 76 : spreading ? 50 : 32,
      title: `Fault — ${Label}: ${name}`,
      detail: `${Label} ${Math.round(v * 100)}%` +
        (spreading ? ` · spreading · ${Math.round(Math.min(1, spreading.done / spreading.work) * 100)}% contained` : "") +
        (blocked ? ` · ${blocked}` : rep?.crew ? ` · ${rep.crew} on it` : ""),
      eta: null,
      action: blocked && !ship.roster.allHands ? "call all hands" : ship.repairFocus === c ? null : `repair ${c}`,
      say: `${Label} fault. ${cap(name)}.` + (spreading ? " Damage is spreading." : "") +
        (blocked ? ` ${cap(blocked)}.` : ""),
    });
  }

  // ---- slower problems ----
  const broken = Object.entries(ship.health).filter(([k, v]) => v < 0.4 && !faults[k]).sort((a, b) => a[1] - b[1]);
  if (broken.length) {
    const names = broken.map(([k]) => COMPONENT_NAME[k]);
    const worst = broken[0][0];
    const blocked = ship.repairs?.[worst]?.blocked;
    add({
      id: "damage", level: "yellow", sev: 40, title: `Damage — ${names.join(", ")}`,
      detail: broken.map(([k, v]) => `${COMPONENT_NAME[k]} ${Math.round(v * 100)}%`).join(" · ") + (blocked ? ` · repairs stalled: ${blocked}` : ""),
      eta: null, action: ship.repairFocus === worst ? null : `repair ${worst}`,
      say: `Damage report. ${names.join(", ")} ${broken.length > 1 ? "are" : "is"} critically damaged.`,
    });
  }
  if (ship.dose > 1) {
    add({
      id: "dose", level: "yellow", sev: 35, title: `Crew dose ${ship.dose.toFixed(2)} Sv`, detail: "Radiation sickness",
      eta: null, action: null, say: "Crew radiation dose has passed one sievert.",
    });
  }
  if (ship.fuel < 0.15) {
    add({
      id: "fuel", level: "yellow", sev: 30, title: `Fuel ${Math.round(ship.fuel * 100)}%`, detail: "Collect near a star",
      eta: null, action: null, say: "Fuel reserves low.",
    });
  }
  if (!ship.reactor.scrammed && ship.power.want > ship.reactor.capacity + 1) {
    add({
      id: "power", level: "yellow", sev: 25, title: `Power short ${(ship.power.want - ship.reactor.capacity).toFixed(0)} units`,
      detail: "Lower-priority systems shedding load", eta: null, action: null,
      say: "Power demand exceeds reactor output.",
    });
  }

  return T.sort((a, b) => b.sev - a.sev);
}

const COMPONENT_NAME = {
  reactor: "reactor", radiators: "radiators", emitters: "shield emitters", life: "life support",
  impulse: "impulse engines", warp: "warp coils", comms: "comms array", sensors: "sensors",
};

export function alertLevel(threats) {
  if (threats.some((t) => t.level === "red")) return "red";
  if (threats.some((t) => t.level === "yellow")) return "yellow";
  return "green";
}

// Keeps a record of what went wrong and when — the after-action log the
// game-over screen shows. `t` is mission time (s).
export class AlertBoard {
  constructor() {
    this.threats = [];
    this.level = "green";
    this.incidents = [];
    this._active = new Set();
    this._seenEvents = 0;
    this._pending = [];      // roster events waiting to be reported
    this._pendingSince = null;
    this._lastReport = -Infinity;
    this.report = null;      // a casualty report ready to be spoken, until taken
  }

  // Deaths and critical injuries, gathered for a moment so several at once
  // become one report instead of a roll call.
  _gather(ship, t) {
    const ev = ship.roster.events;
    // roster.events is trimmed from the front once long; keep the cursor valid.
    if (this._seenEvents > ev.length) this._seenEvents = ev.length;
    const fresh = ev.slice(this._seenEvents);
    this._seenEvents = ev.length;
    for (const e of fresh) {
      if (e.kind !== "death") continue; // criticals are covered by the crew alert
      const m = ship.roster.crew.find((x) => x.id === e.id);
      this._pending.push({ ...e, m });
      {
        this.incidents.push({ t, level: "red", death: true, title: `${m.rank} ${m.name} (${DEPARTMENTS[m.dept].label}) — ${causeWords(m.cause)}` });
      }
    }
    if (this._pending.length && this._pendingSince == null) this._pendingSince = t;
    // Report after deaths stop for a few seconds, or every 12s while they
    // keep coming — and never more often than that, or the computer would
    // do nothing but read out the dead.
    const quiet = !fresh.some((e) => e.kind === "death");
    const waited = t - this._pendingSince;
    if (this._pending.length && t - this._lastReport >= 12 && ((quiet && waited > 4) || waited > 12)) {
      this.report = casualtyReport(this._pending, ship.roster);
      this._pending = [];
      this._pendingSince = null;
      this._lastReport = t;
    }
  }
  takeReport() { const r = this.report; this.report = null; return r; }
  update(ship, t) {
    this._gather(ship, t);
    this.threats = assessThreats(ship);
    this.level = alertLevel(this.threats);
    const now = new Set(this.threats.map((x) => `${x.id}:${x.level}`));
    for (const th of this.threats) {
      const key = `${th.id}:${th.level}`;
      if (!this._active.has(key)) {
        this.incidents.push({ t, level: th.level, title: th.title });
        if (this.incidents.length > 150) this.incidents.shift();
      }
    }
    this._active = now;
    return this;
  }
}

// "Casualty report. Lieutenant Kofi Okafor, Engineering, has died. ..." —
// names when there are only a few, counts by section when there are many,
// and how many are left.
function casualtyReport(deaths, roster) {
  const parts = ["Casualty report."];
  const who = (m) => `${spokenRank(m.rank)} ${m.name}, ${DEPARTMENTS[m.dept].label}`;
  // One death gets the person: who they leave behind.
  const leaves = (m) => m.family ? ` ${PRONOUNS[m.pronouns].Sub} ${m.pronouns === "they" ? "leave" : "leaves"} behind ${m.family}.` : "";
  if (deaths.length === 1) parts.push(`${who(deaths[0].m)}, has died.${leaves(deaths[0].m)}`);
  else if (deaths.length === 2) parts.push(`${who(deaths[0].m)}, and ${who(deaths[1].m)}, have died.`);
  else if (deaths.length > 2) {
    const bySec = {};
    for (const d of deaths) bySec[d.m.section] = (bySec[d.m.section] ?? 0) + 1;
    const secs = Object.entries(bySec).sort((a, b) => b[1] - a[1]);
    parts.push(secs.length === 1
      ? `${num(deaths.length)} crew lost in the ${secs[0][0]} section.`
      : `${num(deaths.length)} crew lost: ${secs.map(([sec, n]) => `${num(n)} in the ${sec} section`).join(", ")}.`);
  }
  const crit = roster.counts().critical;
  if (crit) parts.push(`${num(crit)} in critical condition.`);
  parts.push(`${num(roster.alive().length)} crew remain.`);
  const cap = (x) => x[0].toUpperCase() + x.slice(1);
  return parts.map(cap).join(" ");
}
