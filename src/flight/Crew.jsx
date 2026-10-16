// Crew.jsx — the CREW station: the forty people aboard.
//   left:   departments — how many are fit at their posts, and what that
//           does to the system they run (crew.js staffing)
//   centre: the deck plan — everyone drawn where they actually are, by
//           status, the off-watch hollow in their quarters; click a section
//           to evacuate it to the shelter
//   right:  the roster by department, sickbay, and the fallen
// Click anyone (a dot or a name) for their personnel file (PersonnelFile.jsx).
// Orders live in FlightApp.jsx; the buttons here just give them. The crew
// record persists between missions (careerStore.js) and can be exported
// and imported as a JSON file from the header.
import { useRef } from "react";
import { useUI } from "./store.js";
import { career, sim } from "./engine.js";
import { exportCareer, importCareer } from "./careerStore.js";
import { DEPARTMENTS, DEPT_ORDER, causeWords } from "../universe/crew.js";
import { fullName } from "../universe/personnel/profile.js";
import { dateOf, fmtClock, SHIFT_LABEL } from "../universe/personnel/util.js";
import { HULL_PATHS } from "./shipShape.js";
import PersonnelFile from "./PersonnelFile.jsx";

const STATUS_LABEL = { healthy: "FIT", injured: "INJURED", critical: "CRITICAL", dead: "DECEASED" };
const WHERE_LABEL = { fore: "Fore", aft: "Aft", port: "Port", starboard: "Starboard", shelter: "Shelter" };
const WATCH_MARK = { alpha: "α", beta: "β", gamma: "γ" };
// Where someone is, for the roster.
const whereLabel = (m) =>
  m.status === "dead" ? "—" : m.location === "away" ? "Away team" : m.location === "sickbay" ? "Sickbay" : m.location === "quarters" ? "Off watch" : WHERE_LABEL[m.where];
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const lv = (x) => (x > 0.7 ? "ok" : x > 0.4 ? "warn" : "crit");
const openFile = (id) => useUI.getState().setPersonnel(id);

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
  if (m.location === "away") return null;   // not aboard
  if (m.location === "shelter") return "shelter";
  if (m.location === "sickbay") return "sickbay";
  if (m.location === "quarters") return m.quarters;
  return m.section;
}

function DeckPlan({ roster, ship, onSection }) {
  const groups = {};
  for (const m of roster.crew) if (areaOf(m)) (groups[areaOf(m)] ??= []).push(m);
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
          ? <path key={m.id} d={`M${x - r},${y - r} L${x + r},${y + r} M${x + r},${y - r} L${x - r},${y + r}`} className="crew-dot dead" onClick={() => openFile(m.id)}><title>{`${m.rank} ${m.name} — deceased`}</title></path>
          : <circle key={m.id} cx={x} cy={y} r={r} className={`crew-dot ${m.status} ${m.hurting ? "hurting" : ""} ${m.location === "quarters" ? "off" : ""}`} onClick={() => openFile(m.id)}>
              <title>{`${m.rank} ${m.name}, ${m.role} — ${STATUS_LABEL[m.status]} ${Math.round(m.health * 100)}%${m.location === "quarters" ? " · off watch" : ""}`}</title>
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
        const tired = members.some((m) => m.location === "station" && m.eff < 0.9);
        const alive = members.filter((m) => m.status !== "dead").length;
        const st = roster.staffing[d];
        const factor = 0.4 + 0.6 * st;
        return (
          <div key={d} className="crew-dept">
            <div className="crew-dept-head">
              <span className="crew-dept-name">{dep.label.toUpperCase()}</span>
              <span className="crew-dept-count" title={`A ${SHIFT_LABEL[roster.shift]} watch needs ${roster.need[d]}`}>
                {fitAtPost}/{roster.need[d]} at post{tired ? " · tiring" : ""} · {alive}/{dep.size} alive
              </span>
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
  return (
    <div className="crew-roster">
      {DEPT_ORDER.map((d) => {
        const members = roster.crew.filter((m) => m.homeDept === d);
        return (
          <div key={d} className="crew-roster-dept">
            <div className="crew-roster-title">{DEPARTMENTS[d].label.toUpperCase()}</div>
            {members.map((m) => (
              <div key={m.id} className={`crew-row ${m.status}`} onClick={() => openFile(m.id)}
                title={`${m.role} · ${SHIFT_LABEL[m.shift]} watch · ${STATUS_LABEL[m.status]} ${Math.round(m.health * 100)}%${m.hurting ? ` · suffering ${causeWords(m.cause)}` : ""} · ${Math.round((1 - m.fatigue) * 100)}% rested — click for personnel file`}>
                <span className={`crew-row-dot ${m.status}`} />
                <span className="crew-row-name">
                  {m.rank} {m.name}
                  {m.dept !== m.homeDept && <span className="crew-row-reassigned"> → {DEPARTMENTS[m.dept].label}</span>}
                </span>
                <span className={`crew-row-watch ${m.onWatch ? "on" : ""}`} title={`${SHIFT_LABEL[m.shift]} watch`}>{WATCH_MARK[m.shift]}</span>
                <span className="crew-row-skill" title="Skill in the department's core skill">L{m.skill}</span>
                <span className={`crew-row-where ${m.eff < 0.9 && m.location === "station" ? "tired" : ""}`}>{whereLabel(m)}</span>
                <span className="crew-row-bar"><span className={lv(m.health)} style={{ width: `${m.health * 100}%` }} /></span>
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
  const personnelId = useUI((s) => s.personnelId);
  const fileInput = useRef(null);
  // Everyone lost on earlier missions, newest first.
  const aboard = new Set(roster.crew.map((m) => m.id));
  const earlier = career.memorial.filter((id) => !aboard.has(id)).map((id) => career.profiles[id]).reverse();
  async function onImport(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try { await importCareer(f); window.location.reload(); }
    // Say why in the ship's log rather than a dialog.
    catch (err) { sim.log("deny", `Import failed — ${err.message}`); }
    e.target.value = "";
  }

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
        {roster.allHands
          ? <button className="crew-btn on" onClick={() => order("stand down")} title="Back to the watch rotation — the off watch go to quarters to rest">STAND DOWN — {Math.round((1 - roster.fatigue) * 100)}% RESTED</button>
          : <button className="crew-btn" onClick={() => order("call all hands")} disabled={roster.sheltered} title="Everyone to their stations: more hands for a crisis and for repairs, but they tire">CALL ALL HANDS</button>}
        <button className="crew-btn" onClick={() => order("send injured to sickbay")}>SEND INJURED TO SICKBAY</button>
        <span className="crew-hint">
          Mission {career.missions} · {dateOf(roster.clock.day)} {fmtClock(roster.clock.hour)} · {roster.allHands ? "all hands" : `${SHIFT_LABEL[roster.shift]} watch`} · click a section to evacuate it, a person for their file
        </span>
        <button className="crew-btn small" onClick={() => exportCareer(career)} title="Download the crew record as a JSON file">EXPORT RECORDS</button>
        <button className="crew-btn small" onClick={() => fileInput.current?.click()} title="Replace the crew record with one from a file">IMPORT</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onImport} />
      </div>
      <div className="crew-body">
        <div className="sci-col"><Departments roster={roster} /></div>
        <div className="sci-center">
          <DeckPlan roster={roster} ship={ship} onSection={(k) => order(`evacuate ${k}`)} />
          <div className="sci-legend">
            <span className="ok">● FIT</span><span className="ok">○ OFF WATCH</span><span className="warn">● INJURED</span><span className="crit">● CRITICAL</span><span className="dead">✕ LOST</span>
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
          {(fallen.length > 0 || earlier.length > 0) && (
            <div className="sci-panel crew-memorial">
              <div className="sci-panel-title">IN MEMORIAM</div>
              {fallen.map((m) => (
                <div key={m.id} className="crew-fallen" onClick={() => openFile(m.id)}>
                  <span className="crew-fallen-t">{mmss(m.diedAt)}</span>
                  <span className="crew-row-name">{m.rank} {m.name}</span>
                  <span className="crew-fallen-cause">{causeWords(m.cause)}</span>
                </div>
              ))}
              {earlier.length > 0 && <div className="crew-roster-title">EARLIER MISSIONS</div>}
              {earlier.map((p) => (
                <div key={p.id} className="crew-fallen" onClick={() => openFile(p.id)}>
                  <span className="crew-fallen-t">{dateOf(p.status.day).slice(2)}</span>
                  <span className="crew-row-name">{p.post.rank} {fullName(p)}</span>
                  <span className="crew-fallen-cause">{p.status.cause}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {personnelId && <PersonnelFile id={personnelId} member={roster.crew.find((m) => m.id === personnelId)} />}
    </div>
  );
}
