// Crew.jsx — the CREW station: the forty people aboard.
//   left:   departments — how many are fit at their posts, and what that
//           does to the system they run (crew.js staffing)
//   centre: the deck plan — everyone drawn where they actually are, by
//           status; click a section to evacuate it to the shelter
//   right:  the roster by department, sickbay, and the fallen
// Orders live in FlightApp.jsx; the buttons here just give them.
import { useState } from "react";
import { useUI } from "./store.js";
import { DEPARTMENTS, DEPT_ORDER, causeWords } from "../universe/crew.js";
import { HULL_PATHS } from "./shipShape.js";

const STATUS_LABEL = { healthy: "FIT", injured: "INJURED", critical: "CRITICAL", dead: "DECEASED" };
const WHERE_LABEL = { fore: "Fore", aft: "Aft", port: "Port", starboard: "Starboard", shelter: "Shelter" };
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const lv = (x) => (x > 0.7 ? "ok" : x > 0.4 ? "warn" : "crit");

// Where each location's people are drawn on the deck plan: a box to fill
// row by row. The shelter is the core amidships; sickbay sits in the
// starboard section.
const AREAS = {
  fore:      { x: -26, y: -212, w: 52, h: 80 },
  port:      { x: -54, y: -100, w: 44, h: 104 },
  starboard: { x: 12,  y: -100, w: 44, h: 56 },
  sickbay:   { x: 12,  y: -26,  w: 44, h: 46 },
  aft:       { x: -44, y: 124,  w: 88, h: 76 },
  shelter:   { x: -30, y: 40,   w: 60, h: 62 },
};
const DOT = 10;                     // spacing when there's room; tighter when crowded

function areaOf(m) {
  if (m.location === "shelter") return "shelter";
  if (m.location === "sickbay") return "sickbay";
  return m.section;
}

function DeckPlan({ roster, ship, onSection }) {
  const groups = {};
  for (const m of roster.crew) (groups[areaOf(m)] ??= []).push(m);
  const dots = [];
  for (const [area, members] of Object.entries(groups)) {
    const a = AREAS[area];
    // Pack the area's people into a grid shaped like the area, shrinking
    // the spacing if there are more of them than fit at full size.
    const n = members.length;
    const cols = Math.max(1, Math.min(Math.floor(a.w / 5), Math.ceil(Math.sqrt((n * a.w) / a.h))));
    const step = Math.min(DOT, a.w / cols, a.h / Math.ceil(n / cols));
    // The living first, so the dead pile up at the back of each area.
    members.sort((p, q) => (p.status === "dead") - (q.status === "dead"));
    members.forEach((m, i) => {
      dots.push({ m, r: Math.min(3.6, step * 0.38), x: a.x + step / 2 + (i % cols) * step, y: a.y + step / 2 + Math.floor(i / cols) * step });
    });
  }
  const breached = new Set(ship.breached);
  return (
    <svg className="crew-plan" viewBox="-140 -275 280 520" preserveAspectRatio="xMidYMid meet">
      {Object.entries(HULL_PATHS).map(([k, d]) => (
        <path key={k} d={d} className={`crew-plan-hull ${lv(ship.hull[k])} ${breached.has(k) ? "breached" : ""}`}
          onClick={() => onSection(k)}>
          <title>{`${WHERE_LABEL[k]} section — hull ${Math.round(ship.hull[k] * 100)}%. Click to evacuate to shelter.`}</title>
        </path>
      ))}
      <rect x={AREAS.sickbay.x - 3} y={AREAS.sickbay.y - 12} width={AREAS.sickbay.w + 6} height={AREAS.sickbay.h + 14} rx="4" className="crew-plan-room" />
      <text x={AREAS.sickbay.x + AREAS.sickbay.w / 2} y={AREAS.sickbay.y - 3} className="crew-plan-label">SICKBAY</text>
      <rect x={AREAS.shelter.x - 3} y={AREAS.shelter.y - 12} width={AREAS.shelter.w + 6} height={AREAS.shelter.h + 14} rx="4"
        className={`crew-plan-room shelter ${roster.sheltered ? "on" : ""}`} />
      <text x={AREAS.shelter.x + AREAS.shelter.w / 2} y={AREAS.shelter.y - 3} className="crew-plan-label">SHELTER</text>
      {Object.entries({ fore: [0, -232], port: [-34, -108], starboard: [34, -108], aft: [0, 214] }).map(([k, [x, y]]) => (
        <text key={k} x={x} y={y} className="crew-plan-label">{WHERE_LABEL[k].toUpperCase()}</text>
      ))}
      {dots.map(({ m, x, y, r }) => (
        m.status === "dead"
          ? <path key={m.id} d={`M${x - r},${y - r} L${x + r},${y + r} M${x + r},${y - r} L${x - r},${y + r}`} className="crew-dot dead"><title>{`${m.rank} ${m.name} — deceased`}</title></path>
          : <circle key={m.id} cx={x} cy={y} r={r} className={`crew-dot ${m.status} ${m.hurting ? "hurting" : ""}`}>
              <title>{`${m.rank} ${m.name}, ${m.role} — ${STATUS_LABEL[m.status]} ${Math.round(m.health * 100)}%`}</title>
            </circle>
      ))}
    </svg>
  );
}

function Departments({ roster }) {
  return (
    <div className="sci-panel a-amber">
      <div className="sci-panel-title">DEPARTMENTS — STAFFING</div>
      {DEPT_ORDER.map((d) => {
        const dep = DEPARTMENTS[d];
        const members = roster.crew.filter((m) => m.dept === d);
        const fitAtPost = members.filter((m) => m.location === "station" && (m.status === "healthy" || m.status === "injured")).length;
        const alive = members.filter((m) => m.status !== "dead").length;
        const st = roster.staffing[d];
        const factor = 0.4 + 0.6 * st;
        return (
          <div key={d} className="crew-dept">
            <div className="crew-dept-head">
              <span className="crew-dept-name">{dep.label.toUpperCase()}</span>
              <span className="crew-dept-count">{fitAtPost} at post · {alive}/{dep.size} alive</span>
            </div>
            <div className="sci-bar"><span className={lv(st)} style={{ width: `${st * 100}%` }} /></div>
            <div className="sci-meter-sub">{dep.effect}{dep.system ? ` — ${Math.round(factor * 100)}%` : ""}</div>
          </div>
        );
      })}
    </div>
  );
}

function Roster({ roster }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="crew-roster">
      {DEPT_ORDER.map((d) => {
        const members = roster.crew.filter((m) => m.dept === d);
        return (
          <div key={d} className="crew-roster-dept">
            <div className="crew-roster-title">{DEPARTMENTS[d].label.toUpperCase()}</div>
            {members.map((m) => (
              <div key={m.id} className={`crew-row ${m.status}`} onClick={() => setOpen(open === m.id ? null : m.id)}>
                <span className={`crew-row-dot ${m.status}`} />
                <span className="crew-row-name">{m.rank} {m.name}</span>
                <span className="crew-row-where">{m.status === "dead" ? "—" : m.location === "sickbay" ? "Sickbay" : WHERE_LABEL[m.where]}</span>
                <span className="crew-row-bar"><span className={lv(m.health)} style={{ width: `${m.health * 100}%` }} /></span>
                {open === m.id && (
                  <span className="crew-row-detail">
                    {m.role} · {STATUS_LABEL[m.status]} {Math.round(m.health * 100)}% · dose {m.dose.toFixed(2)} Sv
                    {m.status === "dead" && m.cause ? ` · ${causeWords(m.cause)} at ${mmss(m.diedAt)}` : m.hurting ? ` · suffering ${causeWords(m.cause)}` : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function Crew() {
  const ship = useUI((s) => s.ship);
  const runOrder = useUI((s) => s.runOrder);
  if (!ship) return <div className="sci-overlay" />;
  const roster = ship.roster;
  const c = roster.counts;
  const alive = roster.total - c.dead;
  const patients = roster.crew.filter((m) => m.location === "sickbay" && m.status !== "dead");
  const fallen = roster.crew.filter((m) => m.status === "dead").sort((a, b) => a.diedAt - b.diedAt);
  const order = (o) => runOrder?.(o);

  return (
    <div className="sci-overlay crew-screen">
      <div className="sci-head">
        <span>CREW — {alive} OF {roster.total} ALIVE</span>
        <span className="crew-counts">
          <span className="ok">{c.healthy} fit</span>
          <span className="warn">{c.injured} injured</span>
          <span className="crit">{c.critical} critical</span>
          <span className="dead">{c.dead} lost</span>
        </span>
      </div>
      <div className="crew-orders">
        {roster.sheltered
          ? <button className="crew-btn on" onClick={() => order("resume stations")}>RESUME STATIONS</button>
          : <button className="crew-btn" onClick={() => order("all hands to shelter")}>ALL HANDS TO SHELTER</button>}
        <button className="crew-btn" onClick={() => order("send injured to sickbay")}>SEND INJURED TO SICKBAY</button>
        <span className="crew-hint">Click a section on the deck plan to evacuate it</span>
      </div>
      <div className="crew-body">
        <div className="sci-col"><Departments roster={roster} /></div>
        <div className="sci-center">
          <DeckPlan roster={roster} ship={ship} onSection={(k) => order(`evacuate ${k}`)} />
          <div className="sci-legend">
            <span className="ok">● FIT</span><span className="warn">● INJURED</span><span className="crit">● CRITICAL</span><span className="dead">✕ LOST</span>
          </div>
        </div>
        <div className="sci-col">
          <div className="sci-panel a-blue crew-roster-panel">
            <div className="sci-panel-title">ROSTER</div>
            <Roster roster={roster} />
          </div>
          <div className="sci-panel a-blue crew-sickbay">
            <div className="sci-panel-title">SICKBAY — {patients.length} PATIENT{patients.length === 1 ? "" : "S"} · MEDICAL STAFF {Math.round(roster.staffing.medical * 100)}%</div>
            {patients.length ? patients.map((m) => (
              <div key={m.id} className="crew-patient">
                <span className={`crew-row-dot ${m.status}`} />
                <span className="crew-row-name">{m.rank} {m.name}</span>
                <span className={`crew-patient-hp ${lv(m.health)}`}>{Math.round(m.health * 100)}%</span>
              </div>
            )) : <div className="sci-meter-sub">No patients</div>}
          </div>
          {fallen.length > 0 && (
            <div className="sci-panel crew-memorial">
              <div className="sci-panel-title">IN MEMORIAM</div>
              {fallen.map((m) => (
                <div key={m.id} className="crew-fallen">
                  <span className="crew-fallen-t">{mmss(m.diedAt)}</span>
                  <span className="crew-row-name">{m.rank} {m.name}</span>
                  <span className="crew-fallen-cause">{causeWords(m.cause)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
