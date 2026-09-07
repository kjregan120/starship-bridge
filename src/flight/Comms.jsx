// Comms.jsx — the COMMS station's screen: auto-monitors the nearest
// contact, visualizes its derived signal bands (universe/signals.js), and
// lets you synthesize/listen to a sonification of it via a live oscilloscope
// + spectrum analyzer (SignalScope.jsx). Not literal playback — see
// signals.js/audio.js for why — a stylized stand-in per object type.
// Two panels read further than the sonification does: EMSpectrum.jsx plots
// the object on a real log-wavelength axis with a Planck continuum, and
// WaveField.jsx renders what is currently playing as 3D wavefronts spreading
// from the source.
// Playback itself lives in commsAudio.js, not here, so it survives
// switching to a different station — see the status-bar badge in
// FlightApp.jsx for the always-visible now-playing indicator/stop control.
import { useEffect, useMemo, useState } from "react";
import { nearestBody } from "./engine.js";
import { signalProfile, interpretSignal } from "../universe/signals.js";
import { startListening, stopListening } from "./commsAudio.js";
import { useUI } from "./store.js";
import SignalScope from "./SignalScope.jsx";
import Spectrogram from "./Spectrogram.jsx";
import ContactRadar from "./ContactRadar.jsx";
import LoudnessHistory from "./LoudnessHistory.jsx";
import WaveField from "./WaveField.jsx";
import EMSpectrum from "./EMSpectrum.jsx";

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
  // Keyed on id, not on `obj`: nearestBody() hands back a fresh wrapper every
  // 500ms tick, and a new profile identity each time would make EMSpectrum
  // rebuild its Planck curve and WaveField re-derive its spawn rate on every
  // poll. The profile is a pure function of the object, so this is stable.
  const profile = useMemo(() => (obj ? signalProfile(obj) : null), [obj?.id]);
  const listeningToThis = obj && listening?.id === obj.id;
  const interpretation = obj && profile ? interpretSignal(obj, profile) : null;
  const anomalous = obj?.type === "beacon" || (profile?.bands.find((b) => b.name === "Subspace")?.amplitude ?? 0) > 0.5;
  const dominant = profile?.bands.reduce((a, b) => (b.amplitude > a.amplitude ? b : a)) ?? null;

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
          <div className="comms-main">
            <div className="comms-scope-panel">
              <div className="scope-label">
                <span>OSCILLOSCOPE</span>
                <span>SPECTRUM 0–~2kHz</span>
              </div>
              <SignalScope />
            </div>

            <div className="comms-wave-panel">
              <div className="scope-label">
                <span>SOUND FIELD · WAVEFRONT PROPAGATION</span>
                <span>{listeningToThis ? "RECEIVING" : "IDLE — PRESS LISTEN"}</span>
              </div>
              <WaveField profile={profile} />
            </div>

            <div className="comms-sub-panels">
              <div className="comms-mini-panel">
                <div className="mini-label">SPECTROGRAM</div>
                <Spectrogram />
              </div>
              <div className="comms-mini-panel comms-mini-square">
                <div className="mini-label">CONTACT RADAR</div>
                <ContactRadar />
              </div>
              <div className="comms-mini-panel">
                <div className="mini-label">LOUDNESS HISTORY</div>
                <LoudnessHistory />
              </div>
            </div>
          </div>

          <div className="comms-side">
            {anomalous && <div className="comms-alert">⚠ UNIDENTIFIED SIGNAL — POSSIBLE ARTIFICIAL SOURCE</div>}

            <div className="comms-target">
              <div className="comms-name">{obj.name}</div>
              <div className="comms-type">{[obj.type, obj.starClass, obj.kind].filter(Boolean).join(" — ")}</div>
            </div>

            {dominant && (
              <div className="comms-dominant">
                <span className="comms-dominant-label">DOMINANT</span>
                <span className="comms-dominant-value">{dominant.name.toUpperCase()} {Math.round(dominant.amplitude * 100)}%</span>
              </div>
            )}

            <EMSpectrum obj={obj} profile={profile} />

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
