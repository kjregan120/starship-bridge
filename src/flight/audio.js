// audio.js — turns a signals.js profile into an audible Web Audio synth.
// Not literal playback (real radio/microwave is billions of times above
// hearing range) — a stylized sonification, one synthesis recipe per
// signals.js "character" so a pulsar actually ticks, a gas giant churns, an
// ice world chimes, a moon barely clicks, and so on — genuinely different
// timbres and rhythms, not just the same tone at different pitches.
import { strikesStarting, restrikes, lightningClock } from "./lightning.js";

let ctx = null;
let analyser = null;
let tuneFilter = null;

// The "tune to a band" receiver filter — one shared BiquadFilter sitting
// between every playSignal()'s output and the analyser, so tuning is a real
// change to what's actually playing (and, for free, to everything downstream
// that reads the analyser: SignalScope, Spectrogram, LoudnessHistory,
// WaveField all hear the filtered signal without any of them knowing tuning
// exists). Untuned state is "allpass" — passes every frequency at unity gain,
// i.e. a true bypass — rather than routing around the node, so playSignal()
// never needs to know whether tuning is active.
const BAND_FILTER = {
  Radio: { freq: 200, Q: 0.8 },       // low, dull — the AM-radio end
  Microwave: { freq: 600, Q: 1.0 },   // low-mid, a bit more present
  Elements: { freq: 1400, Q: 0.5 },   // wide and bright — spectral detail
  Gravimetric: { freq: 90, Q: 0.9 },  // deep sub-bass rumble
  Subspace: { freq: 2800, Q: 4 }      // thin, narrow, alien whine
};

// Creates the context + shared analyser/filter if needed (cheap — doesn't
// require a user gesture, only actually resuming/playing does) without
// resuming it.
function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    tuneFilter = ctx.createBiquadFilter();
    tuneFilter.type = "allpass"; // neutral default, see BAND_FILTER comment above
    // Every playSignal() routes through this one shared analyser (not its
    // own), so a scope/spectrum display can read whatever's currently
    // playing without knowing anything about the synth that made it.
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    tuneFilter.connect(analyser);
    analyser.connect(ctx.destination);
  }
  return ctx;
}

// Tunes the shared receiver filter to one of signals.js's five band names, or
// clears it back to allpass on any other value (null, "off", a typo — all the
// same "no filtering" state). Takes effect immediately on whatever's already
// playing, not just future playSignal() calls.
export function tuneFilterTo(band) {
  ensureCtx();
  const cfg = BAND_FILTER[band];
  if (!cfg) { tuneFilter.type = "allpass"; return; }
  tuneFilter.type = "bandpass";
  tuneFilter.frequency.value = cfg.freq;
  tuneFilter.Q.value = cfg.Q;
}
function getCtx() {
  ensureCtx();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// The receiver's input, for anything that makes its own sound instead of
// playSignal() — a broadcast song (anthem.js). Goes through the same tune
// filter and analyser.
export function receiver() {
  return { ac: getCtx(), input: tuneFilter };
}

// Returns the shared analyser, so a visualizer can start reading data
// (silence, pre-gesture) before LISTEN is ever pressed.
export function getAnalyser() {
  ensureCtx();
  return analyser;
}

function makeNoiseBuffer(ac) {
  const buffer = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Starts synthesizing `profile` (from signalProfile()). Returns a stop()
// function that fades out and tears down every node it created.
// `lightningId`: a body with lightning (see lightning.js) — each of its
// strikes is layered on top as a sferic crack, timed to the shader's flash.
export function playSignal(profile, lightningId = null) {
  const ac = getCtx();
  const now = ac.currentTime;
  const nodes = [];

  const out = ac.createGain();
  out.gain.value = 0.0001;
  out.connect(tuneFilter); // tuneFilter -> analyser -> destination (see ensureCtx)
  out.gain.linearRampToValueAtTime(Math.max(0.03, profile.amplitude * 0.25), now + 0.5);

  const osc = (type, freq, detune = 0) => {
    const o = ac.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    o.start();
    nodes.push(o);
    return o;
  };
  const gain = (value) => {
    const g = ac.createGain(); g.gain.value = value;
    nodes.push(g);
    return g;
  };
  const tone = (freq, level, type = "sine", detune = 0) => {
    const o = osc(type, freq, detune);
    const g = gain(level);
    o.connect(g); g.connect(out);
    return { osc: o, gain: g };
  };
  const noiseSource = () => {
    const src = ac.createBufferSource();
    src.buffer = makeNoiseBuffer(ac);
    src.loop = true;
    src.start();
    nodes.push(src);
    return src;
  };
  const filteredNoise = (type, freq, q, level) => {
    const n = noiseSource();
    const filt = ac.createBiquadFilter(); filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const g = gain(level);
    n.connect(filt); filt.connect(g); g.connect(out);
    nodes.push(filt);
    return { source: n, filter: filt, gain: g };
  };
  // A slow oscillator riding on an AudioParam (filter cutoff, gain, ...) —
  // for breathing/turbulent/wave-like motion instead of a static drone.
  const lfo = (hz, target, depth, offset = 0) => {
    const l = ac.createOscillator(); l.frequency.value = hz;
    const g = gain(depth);
    l.connect(g); g.connect(target);
    if (offset) target.value = offset;
    l.start();
    nodes.push(l);
  };
  const period = (rate) => Math.max(0.06, 1 / Math.max(0.05, rate));
  let filtTarget = null; // a filter cutoff that flares with each lightning strike, if the recipe has one

  switch (profile.character) {
    case "tone": { // star, cool/mid class — smooth sine with slow tremolo
      tone(profile.pitch, 0.6);
      lfo(0.15, out.gain, 0.15);
      break;
    }
    case "chorus": { // star, hot/massive — three detuned voices, wider/richer
      tone(profile.pitch, 0.35);
      tone(profile.pitch, 0.25, "sine", profile.detune);
      tone(profile.pitch, 0.25, "sine", -profile.detune);
      lfo(0.12, out.gain, 0.12);
      break;
    }
    case "hum": { // class-M planet — the original warm two-oscillator hum
      tone(profile.pitch, 0.5);
      tone(profile.pitch * 1.5, 0.2, "sine", 6);
      break;
    }
    case "drone": { // toxic planet — two close detuned saws, beating/harsh
      const filt = ac.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = profile.pitch * 4;
      nodes.push(filt); filt.connect(out);
      filtTarget = { param: filt.frequency, base: profile.pitch * 4 }; // storm flashes open it up
      const a = osc("sawtooth", profile.pitch / 2), b = osc("sawtooth", profile.pitch / 2, profile.detune);
      const g = gain(0.35);
      a.connect(g); b.connect(g); g.connect(filt);
      break;
    }
    case "wobble": { // gas giant — filtered saw with a slow sweeping cutoff
      const o = osc("sawtooth", profile.pitch / 2);
      const filt = ac.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = profile.pitch * 2; filt.Q.value = 4;
      nodes.push(filt);
      const g = gain(0.4);
      o.connect(filt); filt.connect(g); g.connect(out);
      lfo(profile.wobbleRate, filt.frequency, profile.pitch * 1.5, profile.pitch * 2);
      break;
    }
    case "wash": { // ocean planet — filtered noise swelling like waves
      const { gain: g } = filteredNoise("bandpass", profile.pitch * 1.5, 0.8, 0.0);
      lfo(profile.wobbleRate, g.gain, 0.22, 0.22);
      break;
    }
    case "rumble": { // black hole — low tone plus low-passed noise
      tone(profile.pitch / 6, 0.7);
      filteredNoise("lowpass", 150, 0.7, 0.25);
      break;
    }
    case "pulse": { // pulsar — hard-edged tone gated at its real pulse rate
      const { gain: g } = tone(profile.pitch, 0, "square");
      const hz = profile.pulseHz || 1;
      const p = 1 / hz;
      let t = now;
      for (let i = 0; i < 3000; i++) { // ample headroom for a long listen
        g.gain.setValueAtTime(0.35, t);
        g.gain.setValueAtTime(0.0, t + p * 0.12);
        t += p;
      }
      break;
    }
    case "noise": { // nebula — bandpassed noise that slowly drifts
      const { filter } = filteredNoise("bandpass", profile.pitch * 2, 0.6, 0.4);
      lfo(profile.wobbleRate, filter.frequency, profile.pitch, profile.pitch * 2);
      break;
    }
    case "chime": { // ice planet — sparse bell-like plucks at varied pitch
      const o = osc("sine", profile.pitch);
      const g = gain(0);
      o.connect(g); g.connect(out);
      const harmonics = [1, 1.5, 2, 2.5, 3];
      let t = now + 0.2;
      for (let i = 0; i < 800; i++) {
        const f = profile.pitch * harmonics[Math.floor(Math.random() * harmonics.length)];
        o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.5, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
        t += period(profile.eventRate) * (0.7 + Math.random() * 0.8);
      }
      break;
    }
    case "crackle": { // rocky/desert planet — sparse dry noise bursts
      const n = noiseSource();
      const filt = ac.createBiquadFilter(); filt.type = "highpass"; filt.frequency.value = profile.pitch * 3;
      nodes.push(filt);
      const g = gain(0);
      n.connect(filt); filt.connect(g); g.connect(out);
      let t = now + 0.2;
      for (let i = 0; i < 1500; i++) {
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.5, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        t += period(profile.eventRate) * (0.4 + Math.random() * 1.4);
      }
      break;
    }
    case "beacon": { // artificial beacon — clean upward chirp at a strictly even
                      // interval (no jitter, unlike every natural character
                      // above) — that regularity is the "this isn't natural" tell
      const o = osc("sine", profile.pitch);
      const g = gain(0);
      o.connect(g); g.connect(out);
      const p = period(profile.eventRate);
      let t = now + 0.3;
      for (let i = 0; i < 2000; i++) {
        o.frequency.setValueAtTime(profile.pitch, t);
        o.frequency.linearRampToValueAtTime(profile.pitch * 1.6, t + 0.06);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.45, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        t += p;
      }
      break;
    }
    case "click": { // moon — very sparse, quiet, cold — mostly silence
      const o = osc("sine", profile.pitch * 2);
      const g = gain(0);
      o.connect(g); g.connect(out);
      let t = now + 0.5;
      for (let i = 0; i < 400; i++) {
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.3, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        t += period(profile.eventRate * 0.3) * (0.6 + Math.random() * 1.6);
      }
      break;
    }
  }

  // Lightning sferics. Strikes are scheduled a little ahead on the audio
  // clock (setInterval alone jitters by tens of ms; Web Audio times don't),
  // mapping the shared performance.now() clock onto ac.currentTime. The
  // output latency is taken off so the crack leaves the speakers when the
  // flash reaches the screen, not a buffer later.
  let strikeTimer = null;
  if (lightningId) {
    const noise = makeNoiseBuffer(ac);
    const LOOKAHEAD = 0.3;
    let scheduledTo = lightningClock();
    // One broadband pop (the return stroke) with a short resonant body.
    const crack = (t, level) => {
      const src = ac.createBufferSource(); src.buffer = noise;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 400;
      const g = ac.createGain(); g.gain.value = 0;
      src.connect(hp); hp.connect(g); g.connect(out);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.002);
      g.gain.exponentialRampToValueAtTime(level * 0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      src.start(t, Math.random() * 1.5); src.stop(t + 0.2);
      src.onended = () => { src.disconnect(); hp.disconnect(); g.disconnect(); };
    };
    const schedule = () => {
      const now = lightningClock();
      const horizon = now + LOOKAHEAD;
      const lag = (ac.outputLatency || 0) + (ac.baseLatency || 0) - 1 / 60;
      for (const s of strikesStarting(lightningId, scheduledTo, horizon)) {
        const t0 = ac.currentTime + (s.start - now) - lag;
        if (t0 < ac.currentTime) continue; // missed (tab was asleep) — skip, don't pile up
        crack(t0, 0.9 * s.intensity);
        for (const r of restrikes(s)) crack(t0 + r.at, 0.5 * s.intensity * r.level);
        if (filtTarget) {
          filtTarget.param.setTargetAtTime(filtTarget.base * (1 + 3 * s.intensity), t0, 0.005);
          filtTarget.param.setTargetAtTime(filtTarget.base, t0 + 0.03, s.dur / 3);
        }
      }
      scheduledTo = horizon;
    };
    schedule();
    strikeTimer = setInterval(schedule, 100);
  }

  return function stop() {
    clearInterval(strikeTimer);
    const stopAt = ac.currentTime + 0.3;
    out.gain.cancelScheduledValues(ac.currentTime);
    out.gain.setValueAtTime(out.gain.value, ac.currentTime);
    out.gain.linearRampToValueAtTime(0.0001, stopAt);
    setTimeout(() => {
      nodes.forEach((n) => { try { n.stop?.(); } catch {} try { n.disconnect(); } catch {} });
      out.disconnect();
    }, 400);
  };
}
