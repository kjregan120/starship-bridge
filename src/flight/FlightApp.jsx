import { useEffect, useRef, useState } from "react";
import Scene from "./Scene.jsx";
import Chart from "./Chart.jsx";
import Comms from "./Comms.jsx";
import { useUI } from "./store.js";
import { stopListening } from "./commsAudio.js";
import { sim, navList, nearestBody, nearbyObjects, startBodyName, byId } from "./engine.js";
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
  { id: "tactical", label: "TACTICAL" },
  { id: "comms", label: "COMMS" }
];
const STATION_HELP = {
  conn: "CONN — ahead full|half|quarter · reverse full|half|quarter · port|starboard <degrees> · all stop · come about for <name> · warp <1-3> to <name> · warp <1-3> · warp <1-3> route · drop out",
  science: "SCIENCE — scan · nav · status. External view for visual inspection of the nearest contact.",
  tactical: "TACTICAL — 3D chart. Drag to rotate, scroll to zoom, right-drag to pan. Shows any plotted course.",
  comms: "COMMS — auto-monitors the nearest contact's signal bands. Press LISTEN to hear a sonification of it. sweep for every contact in range · hail <name> to open a channel · tune <radio|microwave|elements|gravimetric|subspace> to filter toward one band, tune off to clear · decode to attempt to pull a message off the open channel (LISTEN first), decode stop to abort."
};

const SWEEP_RANGE = 1500;

function handleCommand(text) {
  const t = text.trim().toLowerCase();
  if (!t) return;
  let m;

  if ((m = t.match(/^(conn|science|tactical|comms)$/))) { useUI.getState().setStation(m[1]); return; }
  // A few old aliases, now pointed at the station that owns that screen.
  if (/^(viewscreen|forward|front)$/.test(t)) { useUI.getState().setStation("conn"); return; }
  if (/^(external|chase)$/.test(t)) { useUI.getState().setStation("science"); return; }
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
  if (/^(nav|status|report)/.test(t)) { sim.log("info", "See the panels for navigation and status."); return; }

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

const SCREEN_FOR_STATION = { tactical: Chart, comms: Comms }; // conn/science both render Scene (camera sub-mode differs)
const VIEWER_TAG = { conn: "MAIN VIEWER", science: "EXTERNAL VIEW", tactical: "TACTICAL CHART", comms: "COMMS ARRAY" };

export default function FlightApp() {
  const snap = useUI((s) => s.snapshot);
  const nav = useUI((s) => s.nav);
  const systemName = useUI((s) => s.systemName);
  const log = useUI((s) => s.log);
  const station = useUI((s) => s.station);
  const listening = useUI((s) => s.listening);
  const [input, setInput] = useState("");
  const logEnd = useRef(null);
  const lastLogLen = useRef(0);

  // The sim advances on its own loop, independent of whichever screen is
  // mounted — see loop.js for why.
  useEffect(() => startSimLoop(), []);

  // Publish sim state to the UI a few times a second.
  useEffect(() => {
    const iv = setInterval(() => {
      const s = sim.snapshot();
      useUI.getState().setSnapshot({
        mode: s.mode, speed: s.speed, throttle: s.throttle,
        warpReady: sim.canEngageWarp(), t: s.t
      });
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

  function submit(e) {
    e.preventDefault();
    handleCommand(input);
    setInput("");
  }

  const Screen = SCREEN_FOR_STATION[station] ?? Scene;

  return (
    <div className="flcars">
      <aside className="frail">
        <div className="rail-cap" />
        <div className="station-panel">
          <div className="panel-title">STATION</div>
          {STATIONS.map((s) => (
            <button
              key={s.id}
              className={`pill s-${s.id} ${station === s.id ? "active" : ""}`}
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

      <main className="fstage">
        <header className="fstatus">
          <span className="ship">USS Meridian</span>
          <span className="sys">◊ {systemName}</span>
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
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Orders — try "nav", then "warp 3 to <star>". "help" for all.'
            />
          </form>
        </section>
      </main>
    </div>
  );
}
