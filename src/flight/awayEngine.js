// awayEngine.js — the away mission in the browser: the one live AwayMission
// (universe/away.js), the orders that start and end it, and the keyboard
// state the surface view feeds it. Like engine.js, module-level state: the
// mission steps on the sim loop (loop.js) whichever screen is mounted.
import { sim, ship, career, byId, nearestBody } from "./engine.js";
import { useUI } from "./store.js";
import { saveCareer } from "./careerStore.js";
import { findByName } from "../universe/personnel/career.js";
import { fullName } from "../universe/personnel/profile.js";
import { landable, landingSites, terrainFor, envFor, stormAt } from "../universe/surface.js";
import { missionFor, MISSION_TYPES } from "../universe/missions.js";
import { AwayMission, canBeam, pickTeam, TEAM_MAX, EXTRACT_RADIUS, fmtSecs } from "../universe/away.js";
import { statusOf, DEPARTMENTS } from "../universe/crew.js";
import { playTransporter } from "./transporterFX.js";

// What the surface view's controls are asking for right now.
export const awayInput = { move: [0, 0], run: false };
// The live mission, or null on the bridge.
export let away = null;
// How long the transporter effect runs (s) — the switch of view waits for it.
export const BEAM_TIME = 2.6;
// Who's picked to go: profile ids, or null for the first officer's choice.
let picked = null;
// Where the bridge's log was when we beamed down — the comm badge relays
// everything after it.
let logMark = 0;

// What the career remembers about away missions: which sites are done,
// and the science brought home.
const record = () => (career.away ??= { done: {}, science: 0, rescued: 0 });
const isDone = (site) => !!record().done[site.id];

// The body the ship is with: in orbit of, holding at, or nearest.
function currentBody() {
  if (sim.heading?.type === "hold") return byId[sim.heading.id];
  return nearestBody(20)?.o ?? null;
}
const siteLine = (s) => `${s.letter} — ${s.feature} (${Math.abs(s.lat)}°${s.lat >= 0 ? "N" : "S"} ${Math.abs(s.lon)}°${s.lon >= 0 ? "E" : "W"})`;
const missionAt = (site) => (isDone(site) ? null : missionFor(site, terrainFor(site)));

function findSite(body, q) {
  const sites = landingSites(body);
  if (!q) return sites.find((s) => !isDone(s)) ?? sites[0];
  const k = q.replace(/^(?:to\s+)?(?:site\s+)?/, "").trim();
  return sites.find((s) => s.letter.toLowerCase() === k || s.feature.includes(k)) ?? null;
}

// ---------------- bridge orders ----------------
export function sitesOrder() {
  const body = currentBody();
  if (!body) { sim.log("deny", "No planet or moon close enough to survey."); return; }
  if (!landable(body)) { sim.log("deny", `${body.name} has no surface to land on.`); return; }
  const env = envFor(body);
  sim.log("info", `${body.name} — ${env.label.toLowerCase()}, ${env.air === "breathable" ? "breathable air" : env.air === "none" ? "no atmosphere" : `${env.air} air`}${env.suit ? `; suits, ${fmtSecs(env.suit)} of air` : "; no suits needed"}. Landing sites:`);
  for (const s of landingSites(body)) {
    const m = missionAt(s);
    sim.log("info", `  ${siteLine(s)}: ${m ? `${MISSION_TYPES[m.type].label} — ${m.briefing}` : "surveyed."}`);
  }
  sim.log("info", sim.inOrbit(body.id) ? `In standard orbit. "beam down to site a" when ready.` : `"standard orbit" to bring us in range of the transporter.`);
}

export function teamOrder(rest) {
  const roster = ship.roster;
  if (!rest || /^(auto|default|clear)$/.test(rest)) {
    if (rest) { picked = null; sim.log("order", "The first officer will pick the away team."); return; }
    const team = currentTeam();
    sim.log("info", `Away team${picked ? "" : " (the first officer's pick)"}: ${team.map((m) => `${m.rank} ${m.name} (${DEPARTMENTS[m.dept].label})`).join(", ") || "nobody fit to go"}. "away team <name>, <name>" to choose.`);
    return;
  }
  const names = rest.split(/\s*(?:,|\band\b)\s*/).filter(Boolean);
  if (names.length > TEAM_MAX) { sim.log("deny", `The transporter takes the captain and ${TEAM_MAX}.`); return; }
  const ids = [];
  for (const n of names) {
    const p = findByName(career, n);
    const m = p && roster.find(p.id);
    if (!m) { sim.log("deny", `No one aboard named "${n}".`); return; }
    if (m.health <= 0 || statusOf(m) === "critical") { sim.log("deny", `${fullName(p)} isn't fit to go.`); return; }
    if (m.location === "sickbay") { sim.log("deny", `${fullName(p)} is in sickbay.`); return; }
    ids.push(m.id);
  }
  picked = ids;
  sim.log("order", `Away team: ${ids.map((id) => roster.find(id).name).join(", ")}. Report to the transporter room.`);
}

function currentTeam(type = "science") {
  const roster = ship.roster;
  if (picked) return picked.map((id) => roster.find(id)).filter((m) => m && m.health > 0 && statusOf(m) !== "critical" && m.location !== "sickbay");
  return pickTeam(roster, type);
}

export function beamDownOrder(rest) {
  if (away) { sim.log("deny", "There's already a team on the surface."); return; }
  const body = currentBody();
  if (!body) { sim.log("deny", "Nothing in transporter range."); return; }
  const site = findSite(body, rest);
  if (!site) { sim.log("deny", `No landing site "${rest}". Try "sites".`); return; }
  const chk = canBeam({ ship, sim, body, site, t: ship.time, incoming: ship.incoming });
  if (!chk.ok) { sim.log("deny", `Transporter room: can't — ${chk.why}.`); return; }
  const mission = missionAt(site);
  const team = currentTeam(mission?.type);
  ship.dropShieldsForTransport();
  ship.roster.sendAway(team.map((m) => m.id));
  away = new AwayMission({ body, site, terrain: terrainFor(site), mission, roster: ship.roster, members: team, t0: ship.time });
  logMark = sim.events.length;
  sim.log("order", `Energize. Captain${team.length ? ` and ${team.map((m) => m.name).join(", ")}` : ""} to ${body.name}, ${site.name}. Shields down for transport.`);
  if (mission) away.log("info", `${mission.title}. ${mission.briefing}`);
  else away.log("info", `${site.name}, ${site.feature}. Nothing here that needs us — look around as long as you like.`);
  if (away.suit) away.log("info", `Suit air: ${fmtSecs(away.suit)}.`);
  playTransporter();
  useUI.getState().setTransport({ dir: "down", at: performance.now() });
  setTimeout(() => { useUI.getState().setMode("surface"); useUI.getState().setTransport(null); }, BEAM_TIME * 500);
}

// ---------------- surface orders ----------------
// "beam up" — everyone in range of the captain comes too. Nobody alive
// gets left behind unless the captain says so.
export function beamUpOrder(anyway = false) {
  if (!away || useUI.getState().transport) return;
  const chk = canBeam({ ship, sim, body: away.body, site: away.site, t: ship.time, incoming: ship.incoming });
  if (!chk.ok) { away.log("deny", `Meridian: can't get you out — ${chk.why}.`); return; }
  const party = away.beamParty();
  if (party.left.length && !anyway) {
    const far = party.left.map((a) => `${a.m.name} (${Math.round(Math.hypot(a.pos[0] - away.captain.pos[0], a.pos[1] - away.captain.pos[1]))} m)`).join(", ");
    away.log("deny", `Not everyone's within ${EXTRACT_RADIUS} m: ${far}. Regroup first, or "beam up anyway" to leave them.`);
    return;
  }
  if (party.strays.length) away.log("deny", `${party.strays.map((p) => p.label).join(", ")} too far away — they'll be left behind.`);
  playTransporter();
  useUI.getState().setTransport({ dir: "up", at: performance.now() });
  away.beamingUp = true;
  // Who the beam takes — the scene fades exactly these out.
  away.beamSet = new Set([...party.team.map((a) => a.id), ...party.survivors.map((p) => p.id)]);
  setTimeout(finishBeamUp, BEAM_TIME * 1000);
}

function finishBeamUp() {
  const a = away;
  if (!a) return;
  const { party, haul, complete } = a.extract();
  const up = party.team.map((x) => x.id);
  const dead = a.team.filter((x) => x.m.health <= 0).map((x) => x.id);
  ship.roster.recall([...up, ...dead], ship.breached());
  ship.dropShieldsForTransport();
  const rec = record();
  if (haul) {
    ship.addStores(haul);
    rec.science += haul.science;
    rec.rescued += haul.rescued;
    if (complete && a.mission) rec.done[a.site.id] = { type: a.mission.type, day: career.day };
  }
  saveCareer(career);
  const bits = [];
  if (haul?.science) bits.push(`${haul.science} science`);
  if (haul?.fuel) bits.push(`fuel +${Math.round(haul.fuel * 100)}%`);
  if (haul?.parts) bits.push(`${haul.parts} spare part${haul.parts > 1 ? "s" : ""}`);
  if (haul?.rescued) bits.push(`${haul.rescued} rescued`);
  sim.log("arrive", `Away team aboard${party.left.length ? ` — ${party.left.length} left on the surface` : ""}. ${complete ? "Mission complete." : a.mission ? "Mission incomplete." : ""}${bits.length ? ` Brought back: ${bits.join(", ")}.` : ""}`);
  if (dead.length) sim.log("deny", `We lost ${dead.map((id) => ship.roster.find(id).name).join(", ")} down there.`);
  // Anyone left behind stays on the surface, off the ship's books.
  away = null;
  picked = picked?.filter((id) => ship.roster.find(id)?.location !== "away") ?? null;
  awayInput.move = [0, 0];
  useUI.getState().setMode("bridge");
  useUI.getState().setTransport(null);
  useUI.getState().setAway(null);
}

// The surface command line. Away orders first; "bridge, <order>" relays to
// the ship; anything else is tried as an away order and refused.
export function surfaceCommand(text, runBridgeOrder) {
  if (!away) return;
  const t = text.trim().toLowerCase();
  if (!t) return;
  let m;
  if (/^(beam (?:us |me )?up|energi[sz]e|return to (?:the )?ship)$/.test(t)) { beamUpOrder(false); return; }
  if (/^beam (?:us |me )?up anyway$/.test(t)) { beamUpOrder(true); return; }
  if ((m = t.match(/^(?:bridge|meridian|captain to bridge)[,:]?\s+(.+)$/))) {
    away.log("order", `To the bridge: "${m[1]}".`);
    runBridgeOrder(m[1]);
    return;
  }
  if (/^help$/.test(t)) {
    away.log("info", "WASD to walk, Shift to run, drag to look around, scroll to zoom, E to work what's in reach. Orders: follow me · hold here · fan out · <name> scan|sample|collect|stabilise · status · beam up · bridge, <order> to relay to the ship.");
    return;
  }
  const r = away.order(t);
  if (!r.ok) away.log("deny", `Unrecognized order: "${text}". Type "help".`);
}

// ---------------- stepping (loop.js) ----------------
export function awayTick(dt) {
  if (!away || away.beamingUp) return;
  away.step(dt, awayInput);
}

// The comm badge: what the bridge has said since we beamed down.
export function bridgeChatter() {
  return sim.events.slice(logMark).slice(-6);
}
export const storming = () => away && stormAt(away.site, ship.time);

// Dev builds only: the live mission from the console, e.g. __away().captain.
if (import.meta.env?.DEV && typeof window !== "undefined") {
  window.__away = () => away;
  window.__order = (t) => (useUI.getState().mode === "surface" ? surfaceCommand(t, useUI.getState().runOrder) : useUI.getState().runOrder?.(t));
}
