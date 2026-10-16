// SurfaceApp.jsx — the away mission screen: the surface view, and over it
// the team, the objectives, suit air, the comm badge and the command line.
//
// The bridge (FlightApp.jsx) stays mounted underneath — its timers keep the
// store, the alerts and the career save running — and swaps this in while
// `mode` is "surface".
import { useEffect, useRef, useState } from "react";
import SurfaceScene, { surfaceView } from "./SurfaceScene.jsx";
import { useUI } from "./store.js";
import { away, surfaceCommand, bridgeChatter } from "./awayEngine.js";
import { ship } from "./engine.js";
import { sunAt } from "../universe/surface.js";
import { fmtSecs, EXTRACT_RADIUS } from "../universe/away.js";
import { DEPARTMENTS } from "../universe/crew.js";
import { MISSION_TYPES } from "../universe/missions.js";
import "./surface.css";

const pct = (x) => `${Math.round(x * 100)}%`;
const lv = (x) => (x > 0.65 ? "ok" : x > 0.3 ? "warn" : "crit");

// The local hour from the sun's position: noon when it's highest.
function localTime(site, t) {
  const s = sunAt(site, t);
  // From the sun's direction — x is east-west, y up.
  const ha = Math.atan2(s.dir[0], s.dir[1]);           // 0 at noon
  const hour = (12 + (ha / Math.PI) * 12 + 24) % 24;
  return { hour, day: s.elevation > 0, elevation: s.elevation };
}
const fmtHour = (h) => `${String(Math.floor(h)).padStart(2, "0")}${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;

// Arrow to the nearest unfinished objective, relative to the camera.
function Compass() {
  const arrow = useRef(), text = useRef();
  useEffect(() => {
    let raf;
    const tick = () => {
      if (away && arrow.current) {
        const c = away.captain.pos;
        const p = away.nearestPoi(c);
        if (p) {
          const dx = p.pos[0] - c[0], dz = p.pos[1] - c[1];
          const d = Math.hypot(dx, dz);
          // Camera looks along (-sin yaw, -cos yaw); screen-up is that way.
          const ang = Math.atan2(dx, dz) - Math.atan2(-Math.sin(surfaceView.yaw), -Math.cos(surfaceView.yaw));
          arrow.current.style.transform = `rotate(${-ang}rad)`;
          arrow.current.style.opacity = 1;
          text.current.textContent = `${p.label} · ${Math.round(d)} m`;
        } else {
          arrow.current.style.opacity = 0.25;
          const home = Math.hypot(...c);
          text.current.textContent = away.complete() ? `Objectives complete · ${Math.round(home)} m from the landing point` : "Nothing more to find";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="sf-compass">
      <div ref={arrow} className="sf-arrow">▲</div>
      <div ref={text} className="sf-compass-text" />
    </div>
  );
}

export default function SurfaceApp({ runOrder }) {
  const snap = useUI((s) => s.away);
  const alert = useUI((s) => s.alert);
  const transport = useUI((s) => s.transport);
  const [input, setInput] = useState("");
  const [, setTick] = useState(0);
  const inputRef = useRef(null);
  const logEnd = useRef(null);

  // The away log lives on the mission object; refresh with the store.
  useEffect(() => { const iv = setInterval(() => setTick((n) => n + 1), 250); return () => clearInterval(iv); }, []);
  // Enter to give an order, Escape to go back to walking.
  useEffect(() => {
    const key = (e) => {
      if (e.code === "Enter" && document.activeElement !== inputRef.current) { e.preventDefault(); inputRef.current?.focus(); }
      else if (e.code === "Escape") inputRef.current?.blur();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const events = away?.events.slice(-7) ?? [];
  useEffect(() => { logEnd.current?.scrollIntoView({ block: "end" }); }, [events.length]);

  if (!away || !snap) return <div className="surface"><SurfaceScene /></div>;

  const site = away.site, body = away.body, env = away.env, m = away.mission;
  const time = localTime(site, ship.time);
  const chatter = bridgeChatter();
  const party = away.beamParty();
  const far = party.left.length;
  const suitFrac = snap.suit != null ? snap.suit / snap.suitMax : null;

  function submit(e) {
    e.preventDefault();
    surfaceCommand(input, runOrder);
    setInput("");
    inputRef.current?.blur();
  }

  return (
    <div className={`surface alert-${alert.level}`}>
      <SurfaceScene />
      {transport && <div className={`beam-fx surface-beam ${transport.dir}`} />}

      <header className="sf-top">
        <span className="sf-place">{body.name} · {site.name}</span>
        <span className="sf-feature">{site.feature} · {env.label}</span>
        <span className="sf-clock" title="Local time">{fmtHour(time.hour)} {time.day ? "☀" : "☾"}</span>
        {snap.storm && <span className="sf-badge storm">⚡ STORM — NO TRANSPORT</span>}
        {alert.level !== "green" && <span className={`sf-badge alert ${alert.level}`}>{alert.level === "red" ? "RED ALERT" : "YELLOW ALERT"}</span>}
        <span className="sf-air">
          {suitFrac == null ? "AIR BREATHABLE" : (
            <>SUIT AIR <span className={`sf-meter ${lv(suitFrac)}`}><span style={{ width: pct(suitFrac) }} /></span> {fmtSecs(snap.suit)}</>
          )}
        </span>
      </header>

      <aside className="sf-team">
        <div className="sf-title">AWAY TEAM</div>
        <div className={`sf-member captain ${snap.captain.hurting ? "hurting" : ""}`}>
          <span className="sf-dept" style={{ background: "#c9a227" }} />
          <span className="sf-name">Captain</span>
          <span className={`sf-meter ${lv(snap.captain.health)}`}><span style={{ width: pct(snap.captain.health) }} /></span>
          <span className="sf-doing">{snap.captain.working ? "working" : snap.captain.moving ? "moving" : ""}</span>
        </div>
        {snap.team.map((a) => (
          <div key={a.id} className={`sf-member ${a.status} ${a.hurting ? "hurting" : ""}`}>
            <span className="sf-dept" style={{ background: a.dept === "science" || a.dept === "medical" ? "#3a78b8" : a.dept === "command" || a.dept === "helm" ? "#c9a227" : "#b8332a" }} />
            <span className="sf-name" title={`${a.rank} ${a.name} — ${DEPARTMENTS[a.dept].label}`}>{a.last}</span>
            <span className={`sf-meter ${lv(a.health)}`}><span style={{ width: pct(a.health) }} /></span>
            <span className="sf-doing">
              {a.status === "dead" ? "dead" : a.status === "critical" ? "down" : a.task ? (snap.pois.find((p) => p.id === a.task)?.label ?? "working") : a.order === "hold" ? "holding" : a.order === "fan" ? "searching" : "following"}
            </span>
          </div>
        ))}
        {far > 0 && <div className="sf-note">{far} beyond {EXTRACT_RADIUS} m — regroup to beam up</div>}
      </aside>

      <aside className="sf-mission">
        <div className="sf-title">{m ? `${MISSION_TYPES[m.type].label.toUpperCase()} — ${m.title}` : "OPEN SURVEY"}</div>
        {m && <div className="sf-brief">{m.briefing}</div>}
        {snap.objectives.map((o, i) => (
          <div key={i} className={`sf-obj ${o.done ? "done" : ""}`}>
            <span>{o.done ? "✓" : "○"} {o.label}</span><span>{o.have}/{o.need}</span>
          </div>
        ))}
        {snap.complete && <div className="sf-ready">Ready to beam up — "beam up"</div>}
        <Compass />
      </aside>

      <section className="sf-console">
        {chatter.length > 0 && (
          <div className="sf-comm">
            {chatter.slice(-2).map((e, i) => <div key={i} className={`fline k-${e.kind}`}>◈ Bridge: {e.msg}</div>)}
          </div>
        )}
        <div className="sf-log">
          {events.map((e, i) => <div key={i} className={`fline k-${e.kind}`}>{e.msg}</div>)}
          <div ref={logEnd} />
        </div>
        <form className="fcmd sf-cmd" onSubmit={submit}>
          <span className="prompt">AWAY ▸</span>
          <input
            ref={inputRef}
            value={input}
            disabled={!!transport || snap.captainDead}
            onChange={(e) => setInput(e.target.value)}
            placeholder='Enter for orders — "fan out", "<name> scan", "beam up", "bridge, status", "help"'
          />
        </form>
        <div className="sf-keys">WASD walk · Shift run · drag to look · scroll to zoom · E work what's in reach · Enter for orders · Esc to walk</div>
      </section>

      {snap.captainDead && (
        <div className="gameover">
          <div className="gameover-card">
            <div className="gameover-title">CAPTAIN LOST</div>
            <div className="gameover-sub">{body.name} · {site.name} · {away.captain.cause === "heat" ? "volcanic heat" : away.captain.cause === "toxic" ? "a toxic atmosphere" : "suit air ran out"}</div>
            <button className="gameover-restart" onClick={() => window.location.reload()}>NEW MISSION</button>
          </div>
        </div>
      )}
    </div>
  );
}
