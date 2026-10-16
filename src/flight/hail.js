// hail.js — the Collective's hail: a flat, slowed, deep voice (the browser's
// speech synthesis, like computerVoice.js) over a drone of many detuned
// voices humming one chord — the sound of a lot of minds saying one thing.
// Honours `mute` (alarms.js) for the drone and `voice off` for the words.
import { isMuted } from "./alarms.js";
import { voiceEnabled } from "./computerVoice.js";

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
let ac = null;

function pickVoice() {
  const voices = synth.getVoices().filter((v) => /^en/i.test(v.lang));
  const prefer = [/david/i, /guy/i, /mark/i, /daniel/i, /male/i, /google uk english male/i];
  for (const re of prefer) {
    const v = voices.find((x) => re.test(x.name));
    if (v) return v;
  }
  return voices[0] ?? null;
}

// Many slightly detuned saws on a low minor-second cluster, filtered dark,
// with a slow beating tremolo. `secs` long, fading in and out.
function drone(secs) {
  if (isMuted()) return;
  ac ??= new (window.AudioContext || window.webkitAudioContext)();
  const t = ac.currentTime;
  const out = ac.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.09, t + 1.2);
  out.gain.setValueAtTime(0.09, t + secs - 1.5);
  out.gain.linearRampToValueAtTime(0, t + secs);
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 520; lp.Q.value = 4;
  const trem = ac.createGain();
  const lfo = ac.createOscillator(), depth = ac.createGain();
  lfo.frequency.value = 3.1; depth.gain.value = 0.35; trem.gain.value = 0.65;
  lfo.connect(depth).connect(trem.gain);
  lp.connect(trem).connect(out).connect(ac.destination);
  const oscs = [lfo];
  for (const f of [55, 58.3, 82.4, 110, 116.5]) {
    for (let k = 0; k < 3; k++) {
      const o = ac.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = (k - 1) * 9 + (Math.random() - 0.5) * 4;
      const g = ac.createGain(); g.gain.value = 0.06;
      o.connect(g).connect(lp);
      oscs.push(o);
    }
  }
  for (const o of oscs) { o.start(t); o.stop(t + secs + 0.1); }
}

export function playHail(text) {
  if (typeof window === "undefined") return;
  // Rough: about 2.3 words a second at the slowed rate.
  const secs = 2 + text.split(/\s+/).length / 2.3;
  drone(secs);
  if (!synth || !voiceEnabled()) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 0.78; u.pitch = 0.1; u.volume = 1;
  // Ahead of whatever the computer was about to say.
  synth.cancel();
  synth.speak(u);
}
