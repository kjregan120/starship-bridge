// alarms.js — the ship's alarm and damage sounds, synthesized like the rest
// of the game's audio (no sample files).
//
// Its own AudioContext rather than audio.js's: alarms must not pass through
// the comms receiver's tuning filter or show up on its scopes. Browsers only
// let audio start after a user gesture, so the context is resumed on the
// first key press or click (typing an order counts).
//
// update() is called a few times a second with the ship's state and the
// alert level; it starts, stops and adjusts everything from there:
//   - red alert klaxon (a few whoops on entering red, then a reminder)
//   - yellow alert chime
//   - Geiger counter, click rate following the actual dose rate
//   - impact thud on hits, a falling zap when the shields collapse
//   - hull groans while the hull is failing, a hiss while air is venting
//   - reactor hum that winds down on a scram, an emergency-power drone
//     until it restarts, and a spin-up when it does

let ac = null, master = null, noise = null;
let muted = false;
let silenced = false;           // `silence alarm` — klaxon off until the level changes

function ctx() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
    const b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise = b;
  }
  return ac;
}
// Resume on the first gesture (and keep trying — a context can be
// suspended again by the browser).
if (typeof window !== "undefined") {
  const wake = () => { if (ac && ac.state === "suspended") ac.resume(); };
  window.addEventListener("keydown", wake);
  window.addEventListener("pointerdown", wake);
}
const ready = () => ac && ac.state === "running" && !muted;

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ac.currentTime, 0.05);
}
export function silenceAlarm() { silenced = true; }
export const isMuted = () => muted;

// ---- one-shots ------------------------------------------------------------
function env(g, t, peak, attack, release) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
}
function done(...nodes) { return () => nodes.forEach((n) => n.disconnect()); }

// The classic rising whoop: a bright sawtooth sweeping up, through a
// resonant filter that sweeps with it.
function whoop(t, level = 0.22) {
  const o = ac.createOscillator(); o.type = "sawtooth";
  const o2 = ac.createOscillator(); o2.type = "square";
  const f = ac.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 6;
  const g = ac.createGain();
  o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(880, t + 0.6);
  o2.frequency.setValueAtTime(322, t); o2.frequency.exponentialRampToValueAtTime(884, t + 0.6);
  f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.6);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.05);
  g.gain.setValueAtTime(level, t + 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.68);
  o.connect(f); o2.connect(f); f.connect(g); g.connect(master);
  o.start(t); o2.start(t); o.stop(t + 0.7); o2.stop(t + 0.7);
  o.onended = done(o, o2, f, g);
}
function klaxon(n = 3) {
  const t = ac.currentTime + 0.02;
  for (let i = 0; i < n; i++) whoop(t + i * 0.85);
}

function chime(freqs, gap = 0.22, level = 0.12) {
  const t0 = ac.currentTime + 0.02;
  freqs.forEach((fr, i) => {
    const t = t0 + i * gap;
    const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = fr;
    const o2 = ac.createOscillator(); o2.type = "sine"; o2.frequency.value = fr * 2.01;
    const g = ac.createGain(), g2 = ac.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(master);
    env(g, t, level, 0.01, 0.6);
    o.start(t); o2.start(t); o.stop(t + 0.7); o2.stop(t + 0.7);
    o.onended = done(o, o2, g, g2);
  });
}

function thud(level = 0.6) {
  const t = ac.currentTime + 0.01;
  const o = ac.createOscillator(); o.type = "sine";
  o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
  const g = ac.createGain(); env(g, t, level, 0.005, 0.6);
  const n = ac.createBufferSource(); n.buffer = noise;
  const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 400;
  const ng = ac.createGain(); env(ng, t, level * 0.5, 0.003, 0.35);
  o.connect(g); g.connect(master); n.connect(lp); lp.connect(ng); ng.connect(master);
  o.start(t); o.stop(t + 0.7); n.start(t, Math.random()); n.stop(t + 0.5);
  o.onended = done(o, g, n, lp, ng);
}

// Shields collapsing: a falling, buzzing zap.
function zapDown() {
  const t = ac.currentTime + 0.01;
  const o = ac.createOscillator(); o.type = "sawtooth";
  o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(60, t + 1.2);
  const lfo = ac.createOscillator(); lfo.frequency.value = 38;
  const lg = ac.createGain(); lg.gain.value = 0.5;
  const g = ac.createGain(); env(g, t, 0.16, 0.01, 1.3);
  const am = ac.createGain(); am.gain.value = 0.5;
  lfo.connect(lg); lg.connect(am.gain);
  o.connect(am); am.connect(g); g.connect(master);
  o.start(t); lfo.start(t); o.stop(t + 1.4); lfo.stop(t + 1.4);
  o.onended = done(o, lfo, lg, g, am);
  thud(0.4);
}

// Metal under stress: a low sawtooth through a narrow band, bending in pitch.
function groan(level = 0.18) {
  const t = ac.currentTime + 0.01;
  const dur = 1.2 + Math.random() * 1.2;
  const base = 45 + Math.random() * 40;
  const o = ac.createOscillator(); o.type = "sawtooth";
  o.frequency.setValueAtTime(base, t);
  o.frequency.linearRampToValueAtTime(base * (0.7 + Math.random() * 0.6), t + dur);
  const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 9;
  bp.frequency.setValueAtTime(base * 4, t); bp.frequency.linearRampToValueAtTime(base * 2.5, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(bp); bp.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
  o.onended = done(o, bp, g);
}

function geigerClick(t) {
  const n = ac.createBufferSource(); n.buffer = noise;
  const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2500;
  const g = ac.createGain(); env(g, t, 0.35, 0.0005, 0.012);
  n.connect(hp); hp.connect(g); g.connect(master);
  n.start(t, Math.random() * 1.9); n.stop(t + 0.02);
  n.onended = done(n, hp, g);
}

// ---- continuous beds -------------------------------------------------------
let hum = null, drone = null, hiss = null;
function startHum() {
  const a = ac.createOscillator(); a.frequency.value = 55;
  const b = ac.createOscillator(); b.frequency.value = 110.4;
  const g = ac.createGain(); g.gain.value = 0;
  a.connect(g); b.connect(g); g.connect(master); a.start(); b.start();
  return { a, b, g };
}
function startDrone() {
  const o = ac.createOscillator(); o.type = "square"; o.frequency.value = 98;
  const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 300;
  const lfo = ac.createOscillator(); lfo.frequency.value = 0.5;
  const lg = ac.createGain(); lg.gain.value = 120;
  lfo.connect(lg); lg.connect(lp.frequency);
  const g = ac.createGain(); g.gain.value = 0;
  o.connect(lp); lp.connect(g); g.connect(master); o.start(); lfo.start();
  return { o, lfo, g };
}
function startHiss() {
  const n = ac.createBufferSource(); n.buffer = noise; n.loop = true;
  const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3500; bp.Q.value = 0.6;
  const g = ac.createGain(); g.gain.value = 0;
  n.connect(bp); bp.connect(g); g.connect(master); n.start();
  return { n, g };
}

// ---- driver ---------------------------------------------------------------
let lastLevel = "green";
let lastRemind = 0;
let seen = null;
let geigerRate = 0;
let geigerTimer = null;
let nextGroan = 0;
let wasScrammed = false;
let lastBell = 0;
let lost = false;

function geigerLoop() {
  geigerTimer = null;
  if (!ready() || geigerRate <= 0) return;
  // Poisson: exponential gaps, scheduled a hair ahead so timing isn't
  // at the mercy of setTimeout jitter.
  const gap = -Math.log(1 - Math.random()) / geigerRate;
  geigerClick(ac.currentTime + 0.02);
  geigerTimer = setTimeout(geigerLoop, Math.max(5, gap * 1000));
}

// `s`: a ShipSystems instance (live), `level`: "green"|"yellow"|"red".
export function updateAlarms(s, level) {
  ctx();
  if (!ready()) return;
  const now = performance.now() / 1000;
  const t = ac.currentTime;

  if (s.crewLost) {
    if (!lost) {
      lost = true;
      geigerRate = 0;
      for (const bed of [hum, drone, hiss]) bed && bed.g.gain.setTargetAtTime(0, t, 1.5);
      chime([196, 147, 98], 0.9, 0.1); // a slow falling knell
    }
    return;
  }

  if (!hum) hum = startHum();
  if (!drone) drone = startDrone();
  if (!hiss) hiss = startHiss();

  // Alert condition changes.
  if (level !== lastLevel) {
    silenced = false;
    if (level === "red") { klaxon(3); lastRemind = now; }
    else if (level === "yellow" && lastLevel === "green") chime([880, 660]);
    else if (level === "green") chime([660, 880], 0.18, 0.08);
    lastLevel = level;
  } else if (level === "red" && !silenced && now - lastRemind > 14) {
    klaxon(1); lastRemind = now;
  }

  // One-shot cues from the ship.
  const c = s.cues;
  if (!seen) seen = { ...c };
  if (c.hit > seen.hit) thud();
  if (c.shieldsDown > seen.shieldsDown) zapDown();
  if (c.breach > seen.breach) { thud(0.8); groan(0.3); }
  // A low bell for each loss — at most one every few seconds, or a bad
  // minute would be a carillon.
  if (c.casualty > seen.casualty && now - lastBell > 4) { chime([147, 110], 0.5, 0.07); lastBell = now; }
  seen = { ...c };

  // Reactor: hum tracks output; a scram winds it down and the emergency
  // drone takes over; a restart spins it back up.
  const scr = s.reactor.scrammed;
  const out = scr ? 0 : s.reactor.output / 100;
  if (scr && !wasScrammed) {
    hum.a.frequency.setTargetAtTime(18, t, 0.9); hum.b.frequency.setTargetAtTime(36, t, 0.9);
    hum.g.gain.setTargetAtTime(0, t + 1, 0.8);
    drone.g.gain.setTargetAtTime(0.035, t + 1.5, 0.5);
  } else if (!scr && wasScrammed) {
    hum.a.frequency.setValueAtTime(20, t); hum.b.frequency.setValueAtTime(40, t);
    hum.a.frequency.exponentialRampToValueAtTime(55, t + 2.5); hum.b.frequency.exponentialRampToValueAtTime(110.4, t + 2.5);
    drone.g.gain.setTargetAtTime(0, t, 0.3);
  }
  wasScrammed = scr;
  if (!scr) hum.g.gain.setTargetAtTime(0.012 + 0.03 * Math.min(1.2, out) * (s.heat > 0.75 ? 1.6 : 1), t, 0.5);

  // Air venting.
  const venting = s.breached().length && s.atmo.pressure > 0.02;
  hiss.g.gain.setTargetAtTime(venting ? 0.05 + 0.1 * s.atmo.pressure : 0, t, 0.4);

  // Hull failing: groans, more often the faster it goes.
  if (s.rate.hull < -0.0003 || s.breached().length) {
    if (now > nextGroan) {
      groan();
      nextGroan = now + Math.max(1.5, 6 + 2000 * Math.max(-0.003, s.rate.hull)) + Math.random() * 3;
    }
  }

  // Geiger: silent below a background level, then climbing with dose rate.
  const svh = s.doseRate * 3600;
  geigerRate = svh < 0.1 ? 0 : Math.min(90, 1.5 + svh * 6);
  if (geigerRate > 0 && !geigerTimer) geigerLoop();
}
