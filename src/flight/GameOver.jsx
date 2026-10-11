// GameOver.jsx — shown when the last of the crew dies: what killed them,
// the chain of alerts that led there, and the names of the fallen, then a
// fresh start.
//
// Restart reloads the page: the sim, the ship and the universe clock are
// module-level state, and a reload is the one reset guaranteed to clear all
// of it.
import { useUI } from "./store.js";
import { DEPARTMENTS, causeWords } from "../universe/crew.js";

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export default function GameOver() {
  const ship = useUI((s) => s.ship);
  const alert = useUI((s) => s.alert);
  const systemName = useUI((s) => s.systemName);
  if (!ship?.crewLost) return null;

  const fallen = ship.roster.crew.slice().sort((a, b) => a.diedAt - b.diedAt);
  const tally = {};
  for (const m of fallen) tally[m.cause] = (tally[m.cause] ?? 0) + 1;
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
  const log = alert.incidents.filter((i) => !i.death && i.title !== "ALL HANDS LOST").slice(-8);
  const first = fallen[0]?.diedAt ?? 0, last = fallen[fallen.length - 1]?.diedAt ?? 0;

  return (
    <div className="gameover">
      <div className="gameover-card">
        <div className="gameover-title">ALL HANDS LOST</div>
        <div className="gameover-sub">
          USS Meridian · {systemName || "deep space"} · {causeWords(top)} · {fallen.length} crew lost between {mmss(first)} and {mmss(last)}
        </div>
        <div className="gameover-stats">
          <span>Hull {Math.round(ship.hullIntegrity * 100)}%</span>
          <span>Worst dose {ship.dose.toFixed(2)} Sv</span>
          <span>Pressure {ship.atmo.pressure.toFixed(2)} atm</span>
          <span>Heat {Math.round(ship.heat * 100)}%</span>
        </div>
        <div className="gameover-cols">
          <div>
            <div className="gameover-log-title">SEQUENCE OF EVENTS</div>
            <div className="gameover-log">
              {log.map((i, n) => (
                <div key={n} className={`gameover-line ${i.level}`}>
                  <span className="gameover-t">{mmss(i.t)}</span> {i.title}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="gameover-log-title">IN MEMORIAM</div>
            <div className="gameover-log gameover-fallen">
              {fallen.map((m) => (
                <div key={m.id} className="gameover-line">
                  <span className="gameover-t">{mmss(m.diedAt)}</span> {m.rank} {m.name}
                  <span className="gameover-dept"> · {DEPARTMENTS[m.dept].label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <button className="gameover-restart" onClick={() => window.location.reload()}>NEW MISSION</button>
      </div>
    </div>
  );
}
