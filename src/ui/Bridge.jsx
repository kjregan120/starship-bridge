import { useEffect, useRef, useState } from "react";
import { useGame } from "../game/state.js";
import { runComputer } from "../game/computer.js";
import Viewscreen from "../scene/Viewscreen.jsx";

const STATIONS = [
  { id: "conn", label: "CONN", cls: "s-conn" },
  { id: "science", label: "SCIENCE", cls: "s-science" },
  { id: "tactical", label: "TACTICAL", cls: "s-tactical" },
  { id: "comms", label: "COMMS", cls: "s-comms" }
];

const SPEAKER = {
  captain: "CAPTAIN",
  computer: "COMPUTER",
  conn: "CONN",
  science: "SCIENCE",
  tactical: "TACTICAL",
  comms: "COMMS"
};

export default function Bridge() {
  const ship = useGame((s) => s.world.ship);
  const systemName = useGame(
    (s) => s.world.systems[s.currentSystem].name
  );
  const station = useGame((s) => s.station);
  const setStation = useGame((s) => s.setStation);
  const log = useGame((s) => s.log);
  const warping = useGame((s) => s.isWarping);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logEnd = useRef(null);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  async function submit(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    await runComputer(text);
    setBusy(false);
  }

  const alertLevel = ship.alert.replace("condition-", "");

  return (
    <div className="lcars">
      {/* left rail: station selection */}
      <aside className="rail">
        <div className="rail-cap" />
        {STATIONS.map((s) => (
          <button
            key={s.id}
            className={`pill ${s.cls} ${station === s.id ? "active" : ""}`}
            onClick={() => setStation(s.id)}
          >
            {s.label}
          </button>
        ))}
        <div className="rail-fill" />
      </aside>

      {/* main column */}
      <main className="stage">
        <header className={`status alert-${alertLevel}`}>
          <span className="ship">{ship.name}</span>
          <span className="reg">{ship.registry}</span>
          <span className="loc">{systemName}</span>
          <span className="cond">{alertLevel.toUpperCase()}</span>
          <span className={`shd ${ship.shields ? "on" : ""}`}>
            SHIELDS {ship.shields ? "UP" : "DOWN"}
          </span>
        </header>

        <section className="viewer">
          <Viewscreen />
          <div className="viewer-tag">MAIN VIEWER</div>
          <div className={`warp-flash ${warping ? "on" : ""}`} />
        </section>

        <section className="console">
          <div className="log">
            {log.map((entry, i) => (
              <div key={i} className={`line from-${entry.from}`}>
                <span className="who">{SPEAKER[entry.from] ?? entry.from}</span>
                <span className="said">{entry.text}</span>
              </div>
            ))}
            <div ref={logEnd} />
          </div>

          <form className="cmd" onSubmit={submit}>
            <span className={`prompt s-${station}`}>{station.toUpperCase()} ▸</span>
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                busy ? "Working…" : 'Speak to the Computer — try "what can I do?"'
              }
              disabled={busy}
            />
          </form>
        </section>
      </main>
    </div>
  );
}
