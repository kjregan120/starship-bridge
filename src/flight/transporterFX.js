// transporterFX.js — the transporter's sound: a rising shimmer of detuned
// high tones over filtered noise, swelling and fading over a few seconds.
// Honours `mute` (alarms.js). The visual side is CSS (surface.css) and the
// sparkle columns in SurfaceScene.jsx.
import { isMuted } from "./alarms.js";

let ac = null;

export function playTransporter(secs = 3) {
  if (isMuted() || typeof window === "undefined") return;
  ac ??= new (window.AudioContext || window.webkitAudioContext)();
  const t = ac.currentTime;
  const out = ac.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.08, t + 0.6);
  out.gain.setValueAtTime(0.08, t + secs - 1);
  out.gain.linearRampToValueAtTime(0, t + secs);
  out.connect(ac.destination);

  // Noise, band-passed and swept upward: the "hiss" of the beam.
  const buf = ac.createBuffer(1, ac.sampleRate * secs, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass"; bp.Q.value = 6;
  bp.frequency.setValueAtTime(1800, t);
  bp.frequency.exponentialRampToValueAtTime(5200, t + secs);
  const ng = ac.createGain(); ng.gain.value = 0.6;
  noise.connect(bp).connect(ng).connect(out);
  noise.start(t); noise.stop(t + secs);

  // A cluster of high sines with a fast tremolo: the shimmer.
  const trem = ac.createGain(); trem.gain.value = 0.5;
  const lfo = ac.createOscillator(), depth = ac.createGain();
  lfo.frequency.value = 11; depth.gain.value = 0.45;
  lfo.connect(depth).connect(trem.gain);
  trem.connect(out);
  lfo.start(t); lfo.stop(t + secs);
  for (const f of [1318, 1397, 1760, 2093, 2637]) {
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f * 0.94, t);
    o.frequency.linearRampToValueAtTime(f * 1.02, t + secs);
    const g = ac.createGain(); g.gain.value = 0.12;
    o.connect(g).connect(trem);
    o.start(t); o.stop(t + secs);
  }
}
