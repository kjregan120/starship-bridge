// warpAudio.js — the sound of the warp drive, synthesized like hail.js:
//   - charge: power drawn into the coils — a rising whine over a building
//     hum, with conduit crackle, for as long as the charge takes
//   - jump: the coils let go — a bright chord leaping an octave, ringing out
//   - drop: falling back to impulse — a shorter sweep down
// Honours `mute` (alarms.js). loop.js calls these on the sim's transitions.
import { isMuted } from "./alarms.js";

let ac = null;
let noise = null;
const ctx = () => {
  ac ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === "suspended") ac.resume();
  if (!noise) {
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return ac;
};
const noiseSource = (a) => { const s = a.createBufferSource(); s.buffer = noise; s.loop = true; return s; };

// Plays the charge-up, `secs` long. Returns stop(): fades it out fast (an
// abort, or the jump taking over).
export function warpCharge(secs) {
  if (typeof window === "undefined" || isMuted()) return () => {};
  const a = ctx(), t = a.currentTime, end = t + secs;
  const out = a.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.16, t + 0.25);
  out.gain.linearRampToValueAtTime(0.24, end);
  out.connect(a.destination);

  // The whine: two detuned saws sweeping up an octave and a half, opened
  // up by a filter that climbs with them.
  const lp = a.createBiquadFilter();
  lp.type = "lowpass"; lp.Q.value = 6;
  lp.frequency.setValueAtTime(300, t);
  lp.frequency.exponentialRampToValueAtTime(3200, end);
  lp.connect(out);
  const srcs = [];
  for (const det of [-7, 7]) {
    const o = a.createOscillator();
    o.type = "sawtooth"; o.detune.value = det;
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(330, end);
    const g = a.createGain(); g.gain.value = 0.18;
    o.connect(g).connect(lp);
    srcs.push(o);
  }
  // The hum underneath, rising with a quickening throb.
  const hum = a.createOscillator();
  hum.type = "sine";
  hum.frequency.setValueAtTime(45, t);
  hum.frequency.exponentialRampToValueAtTime(70, end);
  const throb = a.createGain(); throb.gain.value = 0.5;
  const lfo = a.createOscillator(), depth = a.createGain();
  lfo.frequency.setValueAtTime(4, t);
  lfo.frequency.exponentialRampToValueAtTime(14, end);
  depth.gain.value = 0.35;
  lfo.connect(depth).connect(throb.gain);
  hum.connect(throb).connect(out);
  srcs.push(hum, lfo);
  // Crackle in the conduits: noise through a narrow band that climbs.
  const crackle = noiseSource(a);
  const bp = a.createBiquadFilter();
  bp.type = "bandpass"; bp.Q.value = 3;
  bp.frequency.setValueAtTime(800, t);
  bp.frequency.exponentialRampToValueAtTime(4000, end);
  const cg = a.createGain();
  cg.gain.setValueAtTime(0.02, t);
  cg.gain.linearRampToValueAtTime(0.12, end);
  crackle.connect(bp).connect(cg).connect(out);
  srcs.push(crackle);

  for (const s of srcs) { s.start(t); s.stop(end + 2); }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const n = a.currentTime;
    out.gain.cancelScheduledValues(n);
    out.gain.setValueAtTime(out.gain.value, n);
    out.gain.linearRampToValueAtTime(0, n + 0.12);
    for (const s of srcs) s.stop(n + 0.15);
  };
}

// A noise sweep from `from` Hz to `to` Hz.
function sweep({ from, to, secs, gain }) {
  if (typeof window === "undefined" || isMuted()) return;
  const a = ctx(), t = a.currentTime;
  const out = a.createGain();
  out.gain.setValueAtTime(gain, t);
  out.gain.exponentialRampToValueAtTime(0.001, t + secs);
  out.connect(a.destination);

  const rush = noiseSource(a);
  const lp = a.createBiquadFilter();
  lp.type = "lowpass"; lp.Q.value = 2;
  lp.frequency.setValueAtTime(from, t);
  lp.frequency.exponentialRampToValueAtTime(to, t + secs);
  rush.connect(lp).connect(out);
  rush.start(t); rush.stop(t + secs + 0.05);
}

// The jump: tonal, not a blast. The charge's whine resolves into a bright
// chord that leaps up an octave as the ship goes (the "zoom"), a glassy
// zip streaking up past it, and a soft low swell underneath — all ringing
// out through a dark echo, so it trails away like the stars do.
export function warpJump() {
  if (typeof window === "undefined" || isMuted()) return;
  const a = ctx(), t = a.currentTime;
  const out = a.createGain();
  out.gain.value = 0.3;
  out.connect(a.destination);

  // Echo: a feedback delay through a lowpass, so each repeat is darker.
  const echo = a.createDelay(1);
  echo.delayTime.value = 0.16;
  const fb = a.createGain(); fb.gain.value = 0.38;
  const dark = a.createBiquadFilter(); dark.type = "lowpass"; dark.frequency.value = 1800;
  const wet = a.createGain(); wet.gain.value = 0.5;
  echo.connect(dark).connect(fb).connect(echo);
  dark.connect(wet).connect(out);
  const send = (node) => { node.connect(out); node.connect(echo); };

  const srcs = [];
  const tone = (type, f0, f1, glide, peak, rise, decay, detune = 0) => {
    const o = a.createOscillator();
    o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + glide);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + rise);
    g.gain.exponentialRampToValueAtTime(0.0001, t + rise + decay);
    o.connect(g);
    send(g);
    srcs.push([o, t + rise + decay + 0.05]);
  };

  // The chord, picking up where the charge's whine left off (330 Hz) and
  // leaping an octave in a quarter second.
  for (const [f, peak] of [[165, 0.2], [247.5, 0.14], [330, 0.18], [495, 0.08]]) {
    tone("triangle", f, f * 2, 0.25, peak, 0.04, 2.2, -4);
    tone("sine", f, f * 2, 0.25, peak * 0.7, 0.04, 2.2, 5);
  }
  // The zip: a quick glassy glide up and away.
  tone("sine", 600, 2400, 0.3, 0.12, 0.02, 0.45);
  // The swell under it: felt more than heard.
  tone("sine", 55, 82, 0.4, 0.5, 0.12, 1.4);

  for (const [o, end] of srcs) { o.start(t); o.stop(end); }
}
export const warpDrop = () => sweep({ from: 300, to: 3000, secs: 0.7, gain: 0.18 });
