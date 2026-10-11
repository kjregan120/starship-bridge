import { useEffect, useRef, useState } from "react";
import Scene from "./Scene.jsx";
import Chart from "./Chart.jsx";
import Comms from "./Comms.jsx";
import Science from "./Science.jsx";
import Crew from "./Crew.jsx";
import ViewscreenFX from "./ViewscreenFX.jsx";
import GameOver from "./GameOver.jsx";
import { useUI } from "./store.js";
import { stopListening } from "./commsAudio.js";
import { sim, ship, navList, nearestBody, nearbyObjects, startBodyName, byId } from "./engine.js";
import { POWER_SYSTEMS } from "../universe/ship.js";
import { AlertBoard } from "../universe/alerts.js";
import { DEPARTMENTS } from "../universe/crew.js";
import { updateAlarms, setMuted, silenceAlarm } from "./alarms.js";
import { updateVoice, setVoiceEnabled, voiceAvailable } from "./computerVoice.js";
import { signalProfile, decodeMessage } from "../universe/signals.js";
import { tuneFilterTo } from "./audio.js";
import { startDecode, abortDecode } from "./decodeEngine.js";
import { startSimLoop } from "./loop.js";
import "./flight.css";

const THROTTLE = { full: 1, standard: 0.75, half: 0.5, third: 0.33, quarter: 0.25 };

// Each station is both a screen (see SCREEN_FOR_STATION below and setStation
// in store.js) and a grouping of orders shown by "help" — but nothing here
// is gated by station; every order works no matter which is selected.
const STATIONS = [
  { id: "conn", label: "CONN" },
  { id: "science", label: "SCIENCE" },
  { id: "crew", label: "CREW" },
  { id: "tactical", label: "TACTICAL" },
  { id: "comms", label: "COMMS" }
];
const STATION_HELP = {
  conn: "CONN — ahead full|half|quarter · reverse full|half|quarter · port|starboard <degrees> · all stop · come about for <name> · warp <1-3> to <name> · warp <1-3> · warp <1-3> route · drop out",
  science: "SCIENCE — ship status. scan · status for a report · withdraw to pull away from whatever is cooking the ship · reactor <0-120> to set the reactor's output limit (over 100 runs hot) · power <shields|engines|sensors|comms|life> <0-150> to change a system's share · power reset · silence alarm · voice on|off · mute / unmute.",
  crew: "CREW — the forty aboard. all hands to shelter (radiation shelter, stations unmanned) · resume stations · evacuate <fore|aft|port|starboard> · send injured to sickbay · crew report. Click a section on the deck plan to evacuate it.",
  tactical: "TACTICAL — 3D chart. Drag to rotate, scroll to zoom, right-drag to pan. Shows any plotted course.",
  comms: "COMMS — auto-monitors the nearest contact's signal bands. Press LISTEN to hear a sonification of it. sweep for every contact in range · hail <name> to open a channel · tune <radio|microwave|elements|gravimetric|subspace> to filter toward one band, tune off to clear · decode to attempt to pull a message off the open channel (LISTEN first), decode stop to abort."
};

const SWEEP_RANGE = 1500;
const POWER_ALIAS = {
  shields: "shields", shield: "shields", engines: "engines", engine: "engines", impulse: "engines", warp: "engines",
  sensors: "sensors", sensor: "sensors", comms: "comms", comm: "comms", life: "life", lifesupport: "life"
};

// A spoken summary of the ship's condition — the Science screen in a few lines.
function statusReport() {
  const s = ship;
  const p = (x) => `${Math.round(x * 100)}%`;
  const r = s.reactor;
  sim.log("info", `Status — reactor ${r.scrammed ? "SCRAMMED" : `${r.output.toFixed(0)}/${r.capacity.toFixed(0)} units`}, fuel ${p(s.fuel)}, heat ${p(s.heat)}.`);
  sim.log("info", `  Shields ${p(s.shields)}, hull ${p(s.hullIntegrity())}${s.breached().length ? ` (breach: ${s.breached().join(", ")})` : ""}.`);
  const c = s.roster.counts();
  sim.log("info", `  Crew ${s.roster.total - c.dead}/${s.roster.total} alive (${c.critical} critical), worst dose ${s.dose.toFixed(2)} Sv. Breathable air ${p(s.atmo.breathable)}, pressure ${s.atmo.pressure.toFixed(2)} atm.`);
  const hurt = Object.entries(s.health).filter(([, v]) => v < 0.7).map(([k, v]) => `${k} ${p(v)}`);
  sim.log("info", hurt.length ? `  Damaged: ${hurt.join(", ")}.` : "  All components nominal.");
  if (s.warpInhibit) sim.log("info", `  Warp off-line — ${s.warpInhibit}.`);
}

// Head straight away from whatever is putting the most heat and radiation
// into the ship, at full impulse — the order the computer recommends when
// it says "withdraw".
const WITHDRAW_DISTANCE = 80;
function withdraw() {
  const src = ship.flux.source;
  if (!src || ship.flux.heat + ship.flux.rad < 1) { sim.log("info", "Nothing close enough to withdraw from."); return; }
  if (sim.mode === "warp") { sim.log("info", "Already at warp."); return; }
  const away = [sim.pos[0] - src.pos[0], sim.pos[1] - src.pos[1], sim.pos[2] - src.pos[2]];
  const d = Math.hypot(...away) || 1;
  const dir = d > 1e-3 ? away.map((x) => x / d) : sim.facing.map((x) => -x);
  const p = src.pos.map((x, i) => x + dir[i] * (d + WITHDRAW_DISTANCE));
  sim.steerToPoint(p);
  sim.throttle = 1;
  sim.log("order", `Withdrawing from ${src.name}, full impulse.`);
}

function crewReport() {
  const r = ship.roster;
  const c = r.counts();
  sim.log("info", `Crew — ${r.total - c.dead} of ${r.total} alive: ${c.healthy} fit, ${c.injured} injured, ${c.critical} critical, ${c.dead} lost.${r.sheltered ? " All hands in shelter." : ""}`);
  const short = Object.entries(DEPARTMENTS).filter(([d, dep]) => dep.system && r.staffing(d) < 0.7)
    .map(([d, dep]) => `${dep.label} ${Math.round(r.staffing(d) * 100)}%`);
  if (short.length) sim.log("info", `  Short-handed: ${short.join(", ")}.`);
}

function handleCommand(text) {
  const t = text.trim().toLowerCase();
  if (!t) return;
  let m;

  if ((m = t.match(/^(conn|science|crew|tactical|comms)$/))) { useUI.getState().setStation(m[1]); return; }
  if (/^(roster|personnel|sickbay)$/.test(t)) { useUI.getState().setStation("crew"); return; }
  // A few old aliases, now pointed at the station that owns that screen.
  if (/^(viewscreen|forward|front)$/.test(t)) { useUI.getState().setStation("conn"); return; }
  if (/^(ship|systems|damage)$/.test(t)) { useUI.getState().setStation("science"); return; }
  if (/^(chart|map)$/.test(t)) { useUI.getState().setStation("tactical"); return; }
  if (/^help$/.test(t)) {
    sim.log("info", STATION_HELP[useUI.getState().station] ?? STATION_HELP.conn);
    return;
  }
  if (/^scan/.test(t)) {
    const n = nearestBody(80);
    sim.log("info", n ? `Scan — ${n.o.name}: ${n.o.scan || "No data."}` : "Nothing within sensor range.");
    return;
  }
  if (/^(status|report|damage report)$/.test(t)) { statusReport(); return; }
  if (/^(withdraw|evasive|retreat|get us out(?: of here)?|fall back)$/.test(t)) { withdraw(); return; }
  if (/^(all hands to (?:radiation )?shelter|shelter|take shelter)$/.test(t)) {
    if (ship.roster.sheltered) { sim.log("info", "Crew already in shelter."); return; }
    ship.roster.shelterAll();
    sim.log("order", "All hands to radiation shelter. Stations on automation.");
    return;
  }
  if (/^(resume stations|return to stations|all hands to stations|stations)$/.test(t)) {
    const breached = ship.breached();
    const n = ship.roster.resumeStations(breached);
    sim.log("order", (n ? `${n} crew returning to stations.` : "No one to return to stations.") +
      (breached.length ? ` ${breached.join(", ")} section${breached.length > 1 ? "s" : ""} breached — crew there stay in shelter.` : ""));
    return;
  }
  if ((m = t.match(/^evacuate\s+(?:the\s+)?(fore|aft|port|starboard)(?:\s+section)?$/))) {
    const n = ship.roster.shelterSection(m[1]);
    sim.log("order", n ? `Evacuating the ${m[1]} section — ${n} crew to shelter.` : `No one at their post in the ${m[1]} section.`);
    return;
  }
  if (/^(send (?:the )?injured to sickbay|injured to sickbay|medical)$/.test(t)) {
    const n = ship.roster.sendInjured();
    sim.log("order", n ? `${n} injured crew to sickbay.` : "No injured crew outside sickbay.");
    return;
  }
  if (/^(crew report|crew status|casualties)$/.test(t)) { crewReport(); return; }
  if (/^(silence alarms?|alarm off|cancel alarm)$/.test(t)) { silenceAlarm(); sim.log("order", "Alarm silenced."); return; }
  if ((m = t.match(/^(?:computer\s+)?voice\s+(on|off)$/))) {
    if (!voiceAvailable()) { sim.log("deny", "This browser has no speech synthesis."); return; }
    setVoiceEnabled(m[1] === "on");
    sim.log("order", `Computer voice ${m[1]}.`);
    return;
  }
  if (/^(mute|unmute)$/.test(t)) { setMuted(t === "mute"); sim.log("order", t === "mute" ? "Ship sounds muted." : "Ship sounds on."); return; }
  if (/^nav/.test(t)) { sim.log("info", "See the NAV panel for the nearest stars."); return; }

  if ((m = t.match(/^reactor\s+(\d+(?:\.\d+)?)\s*%?$/))) {
    const v = ship.setReactor(parseFloat(m[1]) / 100);
    sim.log("order", v > 1
      ? `Reactor to ${Math.round(v * 100)}% — overdrive. Watch the heat.`
      : `Reactor output limited to ${Math.round(v * 100)}%.`);
    return;
  }
  if (/^power\s+(reset|auto|default)$/.test(t)) { ship.resetPower(); sim.log("order", "Power distribution reset to standard."); return; }
  if ((m = t.match(/^(?:power|route power to)\s+(\w+)\s+(\d+(?:\.\d+)?)\s*%?$/))) {
    const sys = POWER_ALIAS[m[1]];
    if (!sys) { sim.log("deny", `No power system "${m[1]}". Try ${POWER_SYSTEMS.join(", ")}.`); return; }
    const v = ship.setPower(sys, parseFloat(m[2]) / 100);
    sim.log("order", `Power to ${sys === "life" ? "life support" : sys} at ${Math.round(v * 100)}%.`);
    return;
  }

  if (/^sweep/.test(t)) {
    const contacts = nearbyObjects(SWEEP_RANGE);
    if (!contacts.length) { sim.log("info", `Sweep — no contacts within ${SWEEP_RANGE}u.`); return; }
    // Beacons always surface regardless of distance rank — otherwise a
    // crowded home system (a dozen planets/moons within 100u) buries the one
    // thing more than a couple hundred u out that's actually worth hunting.
    const beacons = contacts.filter(({ o }) => o.type === "beacon");
    const others = contacts.filter(({ o }) => o.type !== "beacon").slice(0, 8);
    const unidentified = beacons.length ? `, ${beacons.length} unidentified` : "";
    sim.log("info", `Sweep — ${contacts.length} contact${contacts.length === 1 ? "" : "s"} within ${SWEEP_RANGE}u${unidentified}:`);
    [...beacons, ...others].forEach(({ o, dx, dz, d }) => {
      const bearing = ((Math.atan2(dz, dx) * 180) / Math.PI + 360) % 360;
      const dom = signalProfile(o).bands.reduce((a, b) => (b.amplitude > a.amplitude ? b : a));
      const flag = o.type === "beacon" ? " ⚠ possible artificial source" : "";
      sim.log("info", `  ${d.toFixed(0)}u @ ${bearing.toFixed(0)}° — ${o.name} (${o.type}) — dominant ${dom.name} ${Math.round(dom.amplitude * 100)}%${flag}`);
    });
    return;
  }
  // Detune ("tune off"/"untune") before the band-name match below, since
  // "off" would otherwise need its own slot in that alternation for no
  // benefit — this is the one case with no band name to capitalize.
  if (/^(?:tune\s+off|untune)$/.test(t)) {
    useUI.getState().setTunedBand(null);
    tuneFilterTo(null);
    sim.log("info", "Receiver detuned.");
    return;
  }
  if ((m = t.match(/^tune\s+(radio|microwave|elements|gravimetric|subspace)$/))) {
    // signals.js's band names are exactly Title-cased ("Radio", "Gravimetric",
    // ...) — matches profile.bands[].name so EMSpectrum's dim/highlight can
    // compare it directly with no lookup table of its own.
    const band = m[1][0].toUpperCase() + m[1].slice(1);
    // Typing the same band again detunes, the way a second press of a toggle
    // does elsewhere in this game (LISTEN is the other example).
    if (useUI.getState().tunedBand === band) {
      useUI.getState().setTunedBand(null);
      tuneFilterTo(null);
      sim.log("info", "Receiver detuned.");
    } else {
      useUI.getState().setTunedBand(band);
      tuneFilterTo(band);
      sim.log("info", `Tuned to ${band} band.`);
    }
    return;
  }

  if (/^(?:decode\s+stop|cancel\s+decode)$/.test(t)) {
    if (!abortDecode()) sim.log("info", "Nothing being decoded.");
    return;
  }
  if (/^decode$/.test(t)) {
    // Decode only ever targets the channel already open — there is no
    // "decode <name>" form, unlike hail/tune, because there is nothing to
    // decode until LISTEN has a channel running to attempt it on.
    const listening = useUI.getState().listening;
    if (!listening) { sim.log("deny", "No channel open. LISTEN to a contact before attempting to decode it."); return; }
    if (useUI.getState().decoding?.id === listening.id) { sim.log("info", `Already decoding ${listening.name}...`); return; }
    const obj = byId[listening.id];
    if (!obj) { sim.log("deny", "Contact lost. Decode aborted."); return; } // defensive; shouldn't happen
    const result = decodeMessage(obj, signalProfile(obj));
    startDecode(obj.id, obj.name, result);
    sim.log("info", `Attempting to decode ${obj.name}...`);
    return;
  }

  if ((m = t.match(/^hail(?:\s+(.+))?$/))) {
    const query = m[1]?.trim().toLowerCase();
    const body = query
      ? nearbyObjects(SWEEP_RANGE).find(({ o }) => o.name.toLowerCase().includes(query))?.o
      : nearestBody(SWEEP_RANGE)?.o;
    if (!body) { sim.log("deny", query ? `No contact matching "${m[1]}" within range.` : "No contact in range to hail."); return; }
    if (!body.hailable) { sim.log("deny", `${body.name} does not respond to hails.`); return; }
    sim.log("info", `Channel open to ${body.name}. Incoming: "${body.hail}"`);
    return;
  }

  if ((m = t.match(/^ahead\s+(full|standard|half|third|quarter)/))) { sim.ahead(THROTTLE[m[1]]); return; }
  if ((m = t.match(/^(?:reverse|back|astern)\s+(full|standard|half|third|quarter)/))) { sim.reverse(THROTTLE[m[1]]); return; }
  if (/^(reverse|back|astern)$/.test(t)) { sim.reverse(THROTTLE.half); return; }
  if ((m = t.match(/^(?:turn\s+)?(port|starboard)\s+(\d+(?:\.\d+)?)\s*(?:deg(?:rees?)?)?$/))) { sim.turn(m[1], parseFloat(m[2])); return; }
  if (/^(all stop|full stop|hold)/.test(t)) { sim.allStop(); return; }
  if (/^drop\s*out|^disengage/.test(t)) { sim.dropOut(); return; }

  if ((m = t.match(/^(?:come about|approach|head|go)\s+(?:for\s+|to\s+|on\s+)?(.+)/))) { sim.comeAbout(m[1]); return; }

  // "warp 2 route" / "warp route" — take the course already plotted by a
  // prior come-about, at warp instead of impulse.
  if ((m = t.match(/^(?:engage\s+)?warp\s*(\d)?\s*(?:the\s+)?(?:route|course)$/))) { sim.warpCourse(m[1] ? +m[1] : 2); return; }
  // "warp 2" / "warp" alone, no destination — hold present heading and cruise.
  if ((m = t.match(/^(?:engage\s+)?warp\s*(\d)?\s*$/))) { sim.engageWarp(null, m[1] ? +m[1] : 2); return; }
  // "warp 2 to Erebus" / "warp Erebus" — straight-line beeline to a named target.
  if ((m = t.match(/^(?:engage\s+)?warp\s*(\d)?\s*(?:to\s+)?(.+)/))) { sim.engageWarp(m[2], m[1] ? +m[1] : 2); return; }

  sim.log("deny", `Unrecognized order: "${text}". Type "help".`);
}

// Which station a threat sends you to: getting away is the helm's job,
// everything else is read on the Science screen.
const stationFor = (t) =>
  t.action === "withdraw" ? "conn" :
  t.id === "crew" || t.id === "sheltered" || t.id.startsWith("staff-") || /shelter|evacuate|sickbay|stations/.test(t.action ?? "") ? "crew" :
  "science";
const board = new AlertBoard();
const missionStart = performance.now();

const SCREEN_FOR_STATION = { science: Science, crew: Crew, tactical: Chart, comms: Comms }; // conn renders Scene
const VIEWER_TAG = { conn: "MAIN VIEWER", science: "SHIP STATUS", crew: "PERSONNEL", tactical: "TACTICAL CHART", comms: "COMMS ARRAY" };

export default function FlightApp() {
  const snap = useUI((s) => s.snapshot);
  const nav = useUI((s) => s.nav);
  const systemName = useUI((s) => s.systemName);
  const log = useUI((s) => s.log);
  const station = useUI((s) => s.station);
  const listening = useUI((s) => s.listening);
  const alert = useUI((s) => s.alert);
  const shipSnap = useUI((s) => s.ship);
  const [input, setInput] = useState("");
  const [shake, setShake] = useState(false);
  const seenCues = useRef(null);
  const logEnd = useRef(null);
  const lastLogLen = useRef(0);

  // The sim advances on its own loop, independent of whichever screen is
  // mounted — see loop.js for why.
  useEffect(() => startSimLoop(), []);
  useEffect(() => { useUI.getState().setRunOrder(handleCommand); }, []);

  // Publish sim state to the UI a few times a second.
  useEffect(() => {
    const iv = setInterval(() => {
      const s = sim.snapshot();
      useUI.getState().setSnapshot({
        mode: s.mode, speed: s.speed, throttle: s.throttle,
        warpReady: sim.canEngageWarp(), t: s.t
      });
      useUI.getState().setShip(ship.snapshot());
      board.update(ship, (performance.now() - missionStart) / 1000);
      useUI.getState().setAlert({ level: board.level, threats: board.threats, incidents: board.incidents.slice() });
      updateVoice(board);
      updateAlarms(ship, board.level);
      useUI.getState().setNearest(nearestBody());
      useUI.getState().setNav(navList());
      // Only publish a new log array (and so only auto-scroll) when an event
      // actually arrived — sim.events.slice(-40) makes a fresh array every
      // tick regardless, and re-publishing it unconditionally re-triggered
      // the scroll-to-bottom effect below 4x/sec, fighting any manual scroll.
      if (sim.events.length !== lastLogLen.current) {
        lastLogLen.current = sim.events.length;
        useUI.getState().setLog(sim.events.slice(-40));
      }
    }, 250);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => { logEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [log]);

  // Jolt the bridge when something hits: a shield impact, the shields
  // collapsing, a breach, the reactor scramming.
  useEffect(() => {
    const c = shipSnap?.cues;
    if (!c) return;
    const prev = seenCues.current;
    seenCues.current = c;
    if (!prev) return;
    if (c.hit > prev.hit || c.shieldsDown > prev.shieldsDown || c.breach > prev.breach || c.scram > prev.scram) {
      setShake(true);
      const id = setTimeout(() => setShake(false), 700);
      return () => clearTimeout(id);
    }
  }, [shipSnap?.cues]);

  function submit(e) {
    e.preventDefault();
    handleCommand(input);
    setInput("");
  }

  const Screen = SCREEN_FOR_STATION[station] ?? Scene;
  const flashStations = new Set(alert.threats.filter((t) => t.level === "red").map(stationFor));
  const lost = !!shipSnap?.crewLost;
  const emergency = !!shipSnap?.reactor.scrammed && !lost;

  return (
    <div className={`flcars alert-${alert.level} ${emergency ? "emergency" : ""} ${shipSnap?.cues.restart && Date.now() - shipSnap.cues.restart < 2500 ? "power-restored" : ""}`}>
      <aside className="frail">
        <div className="rail-cap" />
        <div className="station-panel">
          <div className="panel-title">STATION</div>
          {STATIONS.map((s) => (
            <button
              key={s.id}
              className={`pill s-${s.id} ${station === s.id ? "active" : ""} ${flashStations.has(s.id) && station !== s.id ? "attention" : ""}`}
              onClick={() => useUI.getState().setStation(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="nav-panel">
          <div className="panel-title">NAV — NEAREST STARS</div>
          {nav.map((s) => (
            <div key={s.id} className="nav-row">
              <span className="nav-name">{s.name}</span>
              <span className="nav-d">{s.d.toFixed(0)}u</span>
              <span className="nav-b">{s.bearing.toFixed(0)}°</span>
            </div>
          ))}
        </div>
        <div className="rail-fill" />
      </aside>

      <main className={`fstage ${shake ? "shake" : ""}`}>
        <header className="fstatus">
          <span className="ship">USS Meridian</span>
          <span className="sys">◊ {systemName}</span>
          {alert.level !== "green" && !lost && (
            <span className={`alert-banner ${alert.level}`}>{alert.level === "red" ? "RED ALERT" : "YELLOW ALERT"}</span>
          )}
          <span className="mode">{snap.mode === "warp" ? `WARP` : `IMPULSE ${Math.round(snap.throttle * 100)}%`}</span>
          <span className="spd">{snap.speed.toFixed(1)} u/s</span>
          <span className={`warp ${snap.warpReady ? "ok" : "no"}`}>WARP {snap.warpReady ? "READY" : "BLOCKED"}</span>
          {listening && (
            <span className="listening-badge" onClick={stopListening} title="Click to stop">
              🔊 {listening.name}
            </span>
          )}
        </header>

        <section className="fviewer">
          {/* Only one Canvas (one WebGL context) mounted at a time — the sim
              itself keeps advancing regardless, via loop.js. */}
          <Screen />
          {station === "conn" && <ViewscreenFX />}
          <div className="viewer-tag">{VIEWER_TAG[station]}</div>
        </section>

        <section className="fconsole">
          <div className="flog">
            {log.map((e, i) => (
              <div key={i} className={`fline k-${e.kind}`}>{e.msg}</div>
            ))}
            <div ref={logEnd} />
          </div>
          <form className="fcmd" onSubmit={submit}>
            <span className={`prompt s-${station}`}>{station.toUpperCase()} ▸</span>
            <input
              autoFocus
              disabled={lost}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Orders — try "nav", then "warp 3 to <star>". "help" for all.'
            />
          </form>
        </section>
      </main>
      <GameOver />
    </div>
  );
}
