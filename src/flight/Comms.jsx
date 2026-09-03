// Comms.jsx — the COMMS station's screen: auto-monitors the nearest
// contact, visualizes its derived signal bands (universe/signals.js), and
// lets you synthesize/listen to a sonification of it via a live oscilloscope
// + spectrum analyzer (SignalScope.jsx). Not literal playback — see
// signals.js/audio.js for why — a stylized stand-in per object type.
// Playback itself lives in commsAudio.js, not here, so it survives
// switching to a different station — see the status-bar badge in
// FlightApp.jsx for the always-visible now-playing indicator/stop control.
import { useEffect, useState } from "react";
import { nearestBody } from "./engine.js";
import { signalProfile, interpretSignal } from "../universe/signals.js";
import { startListening, stopListening } from "./commsAudio.js";
import { useUI } from "./store.js";
import SignalScope from "./SignalScope.jsx";

const RANGE = 400;

export default function Comms() {
  const [nearest, setNearest] = useState(null);
  const listening = useUI((s) => s.listening);

  useEffect(() => {
    const tick = () => setNearest(nearestBody(RANGE));
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, []);

  const obj = nearest?.o ?? null;
  const profile = obj ? signalProfile(obj) : null;
  const listeningToThis = obj && listening?.id === obj.id;
  const interpretation = obj && profile ? interpretSignal(obj, profile) : null;
  const anomalous = obj?.type === "beacon" || (profile?.bands.find((b) => b.name === "Subspace")?.amplitude ?? 0) > 0.5;

  function toggleListen() {
    if (listeningToThis) stopListening();
    else if (obj && profile) startListening(obj, profile);
  }

  return (
    <div className="comms-overlay">
      <div className="comms-head">
        <span>COMMS · signal monitor</span>
        <span className="comms-range">{nearest ? `contact at ${nearest.d.toFixed(0)}u` : "no contact in range"}</span>
      </div>

      {!obj && <div className="comms-empty">Nothing within {RANGE}u of sensor range.</div>}

      {obj && (
        <div className="comms-body">
          <div className="comms-scope-panel">
            <div className="scope-label">
              <span>OSCILLOSCOPE</span>
              <span>SPECTRUM 0–~2kHz</span>
            </div>
            <SignalScope />
          </div>

          <div className="comms-side">
            {anomalous && <div className="comms-alert">⚠ UNIDENTIFIED SIGNAL — POSSIBLE ARTIFICIAL SOURCE</div>}

            <div className="comms-target">
              <div className="comms-name">{obj.name}</div>
              <div className="comms-type">{[obj.type, obj.starClass, obj.kind].filter(Boolean).join(" — ")}</div>
            </div>

            <div className="comms-bands">
              {profile.bands.map((b, i) => (
                <div key={b.name} className="comms-band">
                  <div className="comms-band-track">
                    <div
                      className="comms-band-fill"
                      style={{ height: `${Math.round(b.amplitude * 100)}%`, animationDelay: `${i * 0.3}s`, animationDuration: `${1.4 + b.amplitude}s` }}
                    />
                  </div>
                  <div className="comms-band-label">{b.name}</div>
                  <div className="comms-band-value">{Math.round(b.amplitude * 100)}%</div>
                </div>
              ))}
            </div>

            <button className={`comms-listen ${listeningToThis ? "on" : ""}`} onClick={toggleListen}>
              {listeningToThis ? "◼ STOP" : "▶ LISTEN"}
            </button>
            <div className="comms-interpretation">▸ {interpretation}</div>

            <div className="comms-note">
              Signal character: {profile.character}
              {profile.pulseHz ? ` · ${profile.pulseHz.toFixed(2)} Hz pulse` : ""}
            </div>
            {listening && !listeningToThis && (
              <div className="comms-elsewhere">
                Still listening to {listening.name}.
                <button className="comms-stop-other" onClick={stopListening}>STOP</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
