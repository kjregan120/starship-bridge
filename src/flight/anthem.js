// anthem.js — songs a body broadcasts instead of its natural signal. A body
// with `song` set in universe.json plays that song when you LISTEN to it
// (commsAudio.js). Everything is synthesized here, note by note, into the
// same receiver chain as playSignal() (audio.js) — so the scope, spectrogram
// and wave field dance to it and `tune <band>` filters it like any signal.
//
// One mixing desk and one kit of instruments serve every song; a song is a
// tempo (the length of one step) and an arrangement — a function that, given
// the kit, plays whatever falls on each step.
//
//   "isla"   Isla's theme — an original K-pop-style dance track. 124 BPM in
//            A minor over i–VI–III–VII (Am F C G): intro → verse →
//            pre-chorus (riser, snare roll) → chorus (the hook) →
//            post-chorus drop, then back to the verse.
//   "waltz"  The lava moon's theme — an original spooky storybook waltz.
//            3/4 at 168 in D minor: a music box alone, then oom-pah-pah
//            under a celesta tune, a theremin over a ghostly choir, and the
//            whole band before it starts again.
//
// Notes are scheduled ahead on the audio clock (Web Audio times are exact;
// timers are not, and a background tab throttles them to once a second, so
// the lookahead covers that).
import { receiver } from "./audio.js";

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Bar-by-bar arrangement: a one-off intro, then a body that loops.
function sections(intro, body) {
  const total = body.reduce((a, s) => a + s.bars, 0);
  return (bar) => {
    if (bar < intro) return { name: "intro", bar, bars: intro };
    let b = (bar - intro) % total;
    for (const s of body) {
      if (b < s.bars) return { name: s.name, bar: b, bars: s.bars };
      b -= s.bars;
    }
    return null;
  };
}

// ---- "isla" --------------------------------------------------------------------
const ISLA_STEP = 60 / 124 / 4;            // a sixteenth at 124 BPM
// Am, F, C, G — triads voiced close around middle C, bass roots below.
const ISLA_PROG = [
  { triad: [57, 60, 64], root: 33 },
  { triad: [53, 57, 60], root: 29 },
  { triad: [55, 60, 64], root: 36 },
  { triad: [55, 59, 62], root: 31 },
];
// The chorus hook, one bar per chord: [step, midi, length in sixteenths].
const HOOK = [
  [[0, 76, 2], [2, 76, 2], [4, 74, 2], [6, 72, 2], [8, 74, 4], [12, 76, 4]],
  [[0, 81, 3], [3, 79, 3], [6, 76, 2], [8, 72, 2], [10, 74, 2], [12, 76, 4]],
  [[0, 79, 2], [2, 76, 2], [4, 79, 2], [6, 81, 2], [8, 79, 4], [12, 76, 2], [14, 74, 2]],
  [[0, 74, 2], [2, 76, 2], [4, 74, 2], [6, 71, 2], [8, 74, 6]],
];
// Second time round, the last bar comes home to A.
const HOOK_END = [[0, 72, 2], [2, 71, 2], [4, 69, 10]];
const islaSection = sections(4, [
  { name: "verse", bars: 8 }, { name: "pre", bars: 4 }, { name: "chorus", bars: 8 }, { name: "post", bars: 4 },
]);

function arrangeIsla({ kick, clap, hat, crash, bass, pad, pluck, lead, bell, riser }) {
  const S16 = ISLA_STEP;
  return function play(step, t) {
    const bar = Math.floor(step / 16), s = step % 16;
    const sec = islaSection(bar);
    const ch = ISLA_PROG[sec.bar % 4];
    const beat = s % 4 === 0;
    const last = sec.bar === sec.bars - 1;
    const tones = [...ch.triad, ch.triad[0] + 12, ch.triad[1] + 12, ch.triad[2] + 12];

    switch (sec.name) {
      case "intro": {
        if (s === 0) pad(t, ch.triad, 16, 0.3 + 0.2 * sec.bar);    // the filter opens bar by bar
        if (s % 2 === 0) pluck(t, tones[(s / 2) % tones.length] + 12, 0.16 + 0.03 * sec.bar);
        if (s % 4 === 2) hat(t, sec.bar >= 2 ? 0.2 : 0.12);
        if (sec.bar >= 2 && s % 8 === 0) bass(t, ch.root + 12, 4);
        if (last && s >= 12) clap(t, 0.25 + 0.1 * (s - 12));
        break;
      }
      case "verse": {
        if (beat) kick(t);
        if (s === 4 || s === 12) clap(t, 0.55);
        if (s % 4 === 2) hat(t, 0.22);
        if (s % 2 === 0) bass(t, ch.root + (s % 4 === 2 ? 12 : 0), 2);
        if (s === 0) pad(t, ch.triad, 16, 0.25);
        // A call in the even bars, an answer in the odd ones.
        const call = [[0, 0], [3, 1], [6, 2], [10, 1]], answer = [[8, 2], [10, 3], [12, 4]];
        for (const [at, i] of sec.bar % 2 ? answer : call) if (s === at) lead(t, tones[i] + 12, 2, 0.24);
        break;
      }
      case "pre": {
        if (s === 0) { pad(t, ch.triad, 16, 0.35 + 0.15 * sec.bar); if (sec.bar === 0) riser(t, 16 * 4 * S16 - S16 * 4); }
        if (sec.bar < 2 ? beat : s % 2 === 0) { if (!(last && s >= 12)) kick(t); }
        if (s % 2 === 0 && !(last && s >= 12)) bass(t, ch.root + 12, 1);
        // Snare roll: eighths, then sixteenths, then silence before the drop.
        if (sec.bar === 2 && s % 2 === 0) clap(t, 0.25 + s * 0.015);
        if (last && s < 12) clap(t, 0.35 + s * 0.03);
        if (s % 4 === 2 && !last) hat(t, 0.2);
        break;
      }
      case "chorus": {
        if (sec.bar === 0 && s === 0) crash(t);
        if (beat) kick(t);
        if (s === 4 || s === 12) clap(t, 0.7);
        hat(t, s % 4 === 2 ? 0.26 : 0.1, s % 8 === 6);
        bass(t, ch.root + (s % 2 ? 12 : 0), 1);
        if (s === 0) pad(t, ch.triad, 16, 1);
        const notes = sec.bar === 7 ? HOOK_END : HOOK[sec.bar % 4];
        for (const [at, m, len] of notes) if (s === at) lead(t, m, len);
        if (s % 4 === 2) bell(t, tones[(s / 2 + sec.bar) % tones.length] + 24);
        break;
      }
      case "post": {
        if (beat) kick(t);
        if (s === 4 || s === 12) clap(t, 0.7);
        if (s % 2 === 0) hat(t, 0.24);
        if ([0, 3, 6, 8, 11, 14].includes(s)) bass(t, ch.root + (s === 3 || s === 11 ? 12 : 0), 2);
        // The drop: a chopped, bouncing hook on chord tones.
        const chop = { 0: 4, 2: 4, 3: 5, 6: 4, 8: 3, 10: 2, 11: 3, 14: 1 };
        if (s in chop) lead(t, tones[chop[s]] + 12, 1, 0.28);
        if (s % 2 === 1) pluck(t, tones[(s + sec.bar) % 3] + 12, 0.07);
        break;
      }
    }
  };
}

// ---- "waltz" -------------------------------------------------------------------
const WALTZ_STEP = 60 / 168 / 2;           // an eighth at 168 to the quarter; six to a bar
const CH = {
  Dm: { notes: [50, 53, 57], root: 38, fifth: 45 },
  Gm: { notes: [50, 55, 58], root: 43, fifth: 38 },
  Bb: { notes: [50, 53, 58], root: 46, fifth: 41 },
  A7: { notes: [49, 52, 55], root: 45, fifth: 40 },
  Eb: { notes: [51, 55, 58], root: 39, fifth: 46 },
};
const A_PROG = ["Dm", "Dm", "Gm", "Dm", "Bb", "A7", "Dm", "A7"];
const B_PROG = ["Gm", "Dm", "Eb", "A7", "Gm", "Dm", "Bb", "A7"];
// The tune, a bar per chord: [step (eighths), midi, length].
const MEL_A = [
  [[0, 69, 2], [2, 74, 2], [4, 77, 2]],
  [[0, 76, 3], [3, 74, 1], [4, 73, 2]],
  [[0, 74, 2], [2, 70, 2], [4, 67, 2]],
  [[0, 69, 4], [4, 74, 2]],
  [[0, 77, 2], [2, 76, 1], [3, 74, 1], [4, 77, 2]],
  [[0, 76, 2], [2, 73, 2], [4, 69, 2]],
  [[0, 74, 2], [2, 77, 2], [4, 81, 2]],
  [[0, 79, 3], [3, 76, 1], [4, 73, 2]],
];
const MEL_A_END = [[0, 74, 6]];
// The middle: long, sliding theremin notes.
const MEL_B = [
  [[0, 79, 6]], [[0, 77, 3], [3, 74, 3]], [[0, 75, 6]], [[0, 73, 4], [4, 76, 2]],
  [[0, 82, 6]], [[0, 81, 3], [3, 77, 3]], [[0, 74, 3], [3, 77, 3]], [[0, 76, 6]],
];
const waltzSection = sections(4, [{ name: "A", bars: 16 }, { name: "B", bars: 8 }, { name: "full", bars: 8 }]);

function arrangeWaltz({ celesta, pizz, stab, choir, theremin, bassoon, timpani, bell, swell }) {
  let lastTheremin = null;
  // Oom-pah-pah: the bass on one (root, or the fifth every other bar), the chord on two and three.
  const oompah = (t, s, bar, ch, level = 1) => {
    if (s === 0) pizz(t, bar % 2 ? ch.fifth : ch.root, 0.55 * level);
    if (s === 2 || s === 4) stab(t, ch.notes, 0.07 * level);
  };
  return function play(step, t) {
    const bar = Math.floor(step / 6), s = step % 6;
    const sec = waltzSection(bar);
    switch (sec.name) {
      case "intro": {
        // A music box winding up over a low drone.
        if (sec.bar === 0 && s === 0) { timpani(t, 38, 0.5); choir(t, CH.Dm.notes, 24, 0.03); }
        const box = [62, 65, 69, 74, 69, 65];
        celesta(t, box[s] + 12, 0.14 + 0.03 * sec.bar);
        if (sec.bar === 3 && s === 0) bell(t, 81);
        break;
      }
      case "A": {
        const i = sec.bar % 8, end = sec.bar === 15;
        const ch = end ? CH.Dm : CH[A_PROG[i]];
        oompah(t, s, sec.bar, ch);
        if (sec.bar === 0 && s === 0) bell(t, 86);
        for (const [at, m, len] of end ? MEL_A_END : MEL_A[i]) {
          if (s !== at) continue;
          celesta(t, m, 0.26);
          if (sec.bar >= 8) bassoon(t, m - 12, len, 0.1);      // second time, the bassoon joins in
        }
        break;
      }
      case "B": {
        const ch = CH[B_PROG[sec.bar]];
        if (s === 0) { pizz(t, ch.root, 0.38); choir(t, ch.notes, 6, 0.04); }
        if (s === 2 || s === 4) stab(t, ch.notes, 0.03);
        if (s === 0 && sec.bar % 4 === 0) timpani(t, ch.root, 0.45);
        for (const [at, m, len] of MEL_B[sec.bar]) {
          if (s !== at) continue;
          theremin(t, m, len, lastTheremin);
          lastTheremin = m;
        }
        // The music box, far off, between the theremin's notes.
        if (s === 3) celesta(t, ch.notes[(sec.bar + 1) % 3] + 24, 0.05);
        if (sec.bar === 7 && s === 0) swell(t, 6);
        break;
      }
      case "full": {
        const end = sec.bar === 7;
        const ch = end ? CH.Dm : CH[A_PROG[sec.bar]];
        oompah(t, s, sec.bar, ch, 1.15);
        if (s === 0) choir(t, ch.notes, 6, 0.035);
        if (s === 0 && sec.bar % 2 === 0) timpani(t, ch.root, 0.5);
        for (const [at, m, len] of end ? MEL_A_END : MEL_A[sec.bar]) {
          if (s !== at) continue;
          celesta(t, m, 0.24);
          theremin(t, m - 12, len, lastTheremin, 0.12);
          bassoon(t, m - 24, len, 0.09);
          lastTheremin = m - 12;
        }
        // A timpani roll back to the top.
        if (end && s >= 2) timpani(t, 38, 0.2 + 0.06 * s);
        break;
      }
    }
  };
}

const SONGS = {
  isla: { step: ISLA_STEP, echo: ISLA_STEP * 3, level: 0.32, arrange: arrangeIsla },
  // Acoustic-ish instruments with no drum kit: brought up to sit level with Isla's.
  waltz: { step: WALTZ_STEP, echo: WALTZ_STEP * 2, level: 0.6, arrange: arrangeWaltz },
};

// `dest`: where to play it — the comms receiver by default. `until`: for an
// OfflineAudioContext, schedule the whole song up to this time at once
// (offline rendering has no running clock for the scheduler to follow).
export function playSong(song, dest = null, until = null) {
  const SONG = SONGS[song];
  if (!SONG) return null;
  const S = SONG.step;
  const { ac, input } = dest ?? receiver();
  const t0 = ac.currentTime;

  // ---- the mixing desk ----
  const out = ac.createGain();                     // fades in, and out on stop
  out.gain.value = 0.0001;
  out.gain.linearRampToValueAtTime(SONG.level, t0 + 0.6);
  out.connect(input);
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.15;
  comp.connect(out);
  const drums = ac.createGain(); drums.gain.value = 0.9; drums.connect(comp);
  // Bass, pads and arps duck under every kick — the pumping dance sound.
  const duck = ac.createGain(); duck.connect(comp);
  const music = ac.createGain(); music.gain.value = 0.8; music.connect(duck);
  const leadBus = ac.createGain(); leadBus.gain.value = 0.55; leadBus.connect(comp);
  // An echo on the lead voices, timed to the song.
  const echo = ac.createDelay(1); echo.delayTime.value = SONG.echo;
  const fb = ac.createGain(); fb.gain.value = 0.32;
  const echoTone = ac.createBiquadFilter(); echoTone.type = "lowpass"; echoTone.frequency.value = 2500;
  const echoOut = ac.createGain(); echoOut.gain.value = 0.35;
  echo.connect(echoTone); echoTone.connect(fb); fb.connect(echo); echoTone.connect(echoOut); echoOut.connect(comp);
  const fixed = [out, comp, drums, duck, music, leadBus, echo, fb, echoTone, echoOut];

  const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  // Every note's nodes, released when the note ends.
  const live = new Set();
  const voice = (src, stopAt, ...rest) => {
    live.add(src);
    src.onended = () => { live.delete(src); try { src.disconnect(); } catch {} rest.forEach((n) => n.disconnect()); };
    src.stop(stopAt);
  };
  const env = (g, t, peak, attack, decay, sustain = 0.0001, release = null) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + attack + decay);
    if (release) g.gain.exponentialRampToValueAtTime(0.0001, release);
  };
  // A held note's envelope: attack, hold until `end`, release.
  const hold = (g, t, end, peak, attack, release) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, Math.max(t + attack, end - 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, Math.max(t + attack, end - 0.02) + release);
  };
  const noiseHit = (t, type, freq, q, peak, decay, dest = drums) => {
    const s = ac.createBufferSource(); s.buffer = noise;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    s.connect(f); f.connect(g); g.connect(dest);
    env(g, t, peak, 0.002, decay);
    s.start(t, Math.random() * 0.5);
    voice(s, t + decay + 0.05, f, g);
  };
  // Several oscillators into one shared input node (`into`); `chain` — that
  // input and whatever follows it — is freed along with the last of them.
  // spec: [type, freq, detune, level].
  const oscs = (t, stopAt, specs, into, chain) => {
    specs.forEach(([type, freq, det = 0, level = 1], i) => {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = det;
      const extra = [];
      if (level !== 1) { const lg = ac.createGain(); lg.gain.value = level; o.connect(lg); lg.connect(into); extra.push(lg); }
      else o.connect(into);
      o.start(t);
      voice(o, stopAt, ...extra, ...(i === specs.length - 1 ? chain : []));
    });
  };

  // ---- instruments: drums ----
  const kick = (t) => {
    const o = ac.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ac.createGain(); env(g, t, 1.0, 0.002, 0.38);
    o.connect(g); g.connect(drums); o.start(t); voice(o, t + 0.42, g);
    duck.gain.setValueAtTime(0.3, t);
    duck.gain.linearRampToValueAtTime(1, t + S * 3);
  };
  const clap = (t, level = 0.7) => {
    for (const d of [0, 0.011, 0.022]) noiseHit(t + d, "bandpass", 1400, 0.9, level * (d ? 0.6 : 1), d === 0.022 ? 0.16 : 0.02);
  };
  const hat = (t, level = 0.25, open = false) => noiseHit(t, "highpass", 7500, 0.7, level, open ? 0.22 : 0.035);
  const crash = (t) => noiseHit(t, "highpass", 3500, 0.5, 0.5, 1.8);
  const timpani = (t, midi, level = 0.5) => {
    const o = ac.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(mtof(midi) * 1.04, t); o.frequency.exponentialRampToValueAtTime(mtof(midi), t + 0.08);
    const g = ac.createGain(); env(g, t, level, 0.004, 1.1);
    o.connect(g); g.connect(drums); o.start(t); voice(o, t + 1.2, g);
    noiseHit(t, "lowpass", 300, 0.7, level * 0.5, 0.12);
  };
  // A cymbal swelling up out of nothing, `len` steps long.
  const swell = (t, len) => {
    const s = ac.createBufferSource(); s.buffer = noise; s.loop = true;
    const f = ac.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 4000;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + len * S);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len * S + 0.08);
    s.connect(f); f.connect(g); g.connect(drums); s.start(t);
    voice(s, t + len * S + 0.1, f, g);
  };
  const riser = (t, len) => {
    const s = ac.createBufferSource(); s.buffer = noise; s.loop = true;
    const f = ac.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 3;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(7000, t + len);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + len);
    s.connect(f); f.connect(g); g.connect(drums); s.start(t);
    voice(s, t + len, f, g);
  };

  // ---- instruments: bass and chords ----
  const bass = (t, midi, len) => {
    const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = mtof(midi);
    const sub = ac.createOscillator(); sub.type = "sine"; sub.frequency.value = mtof(midi);
    const f = ac.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 6;
    f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(260, t + 0.15);
    const g = ac.createGain(); env(g, t, 0.55, 0.005, len * S, 0.2, t + len * S + 0.05);
    o.connect(f); sub.connect(f); f.connect(g); g.connect(music);
    o.start(t); sub.start(t);
    voice(o, t + len * S + 0.08, f, g); voice(sub, t + len * S + 0.08);
  };
  // A plucked string bass: a thump that dies away.
  const pizz = (t, midi, level = 0.4) => {
    const o = ac.createOscillator(); o.type = "triangle"; o.frequency.value = mtof(midi);
    const f = ac.createBiquadFilter(); f.type = "lowpass";
    f.frequency.setValueAtTime(1600, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.2);
    const g = ac.createGain(); env(g, t, level, 0.004, 0.38);
    o.connect(f); f.connect(g); g.connect(music); o.start(t);
    voice(o, t + 0.45, f, g);
  };
  // A chord of detuned saws — one filter and envelope for the lot, which
  // keeps it cheap enough to hold under everything else.
  const pad = (t, triad, len, bright = 1) => {
    const end = t + len * S;
    const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900 + 2600 * bright;
    const g = ac.createGain(); hold(g, t, end, 0.045, 0.04, 0.15);
    f.connect(g); g.connect(music);
    oscs(t, end + 0.2, [...triad, triad[0] + 12].flatMap((m) => [["sawtooth", mtof(m), -11], ["sawtooth", mtof(m), 11]]), f, [f, g]);
  };
  // A short reedy chord on the off-beats — the "pah" of an old accordion.
  const stab = (t, notes, level = 0.05) => {
    const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1800; f.Q.value = 1.5;
    const g = ac.createGain(); env(g, t, level, 0.008, 0.2);
    f.connect(g); g.connect(music);
    oscs(t, t + 0.26, notes.flatMap((m) => [["square", mtof(m + 12), -7], ["square", mtof(m + 12), 7]]), f, [f, g]);
  };
  // A ghostly choir: saws through two vowel formants ("ooh"), slow to swell.
  const choir = (t, notes, len, level = 0.04) => {
    const end = t + len * S;
    const mix = ac.createGain();
    const f1 = ac.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = 450; f1.Q.value = 4;
    const f2 = ac.createBiquadFilter(); f2.type = "bandpass"; f2.frequency.value = 900; f2.Q.value = 6;
    const g = ac.createGain(); hold(g, t, end, level * 4, 0.35, 0.5);
    mix.connect(f1); mix.connect(f2); f1.connect(g); f2.connect(g); g.connect(music);
    oscs(t, end + 0.55, notes.flatMap((m) => [["sawtooth", mtof(m + 12), -9], ["sawtooth", mtof(m + 12), 9]]), mix, [mix, f1, f2, g]);
  };

  // ---- instruments: leads ----
  const pluck = (t, midi, level = 0.16) => {
    const o = ac.createOscillator(); o.type = "square"; o.frequency.value = mtof(midi);
    const f = ac.createBiquadFilter(); f.type = "lowpass";
    f.frequency.setValueAtTime(4000, t); f.frequency.exponentialRampToValueAtTime(600, t + 0.12);
    const g = ac.createGain(); env(g, t, level, 0.003, 0.16);
    o.connect(f); f.connect(g); g.connect(music); g.connect(echo); o.start(t);
    voice(o, t + 0.22, f, g);
  };
  const lead = (t, midi, len, level = 0.33) => {
    const end = t + len * S;
    const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 3800; f.Q.value = 2;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.015);
    g.gain.setValueAtTime(level * 0.8, end - 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.08);
    f.connect(g); g.connect(leadBus); g.connect(echo);
    const vib = ac.createOscillator(); vib.frequency.value = 5.5;
    const vd = ac.createGain();
    vd.gain.setValueAtTime(0, t); vd.gain.linearRampToValueAtTime(len > 3 ? 14 : 0, t + 0.25);
    vib.connect(vd); vib.start(t); voice(vib, end + 0.1, vd);
    for (const [type, det] of [["sawtooth", -6], ["square", 6]]) {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = mtof(midi); o.detune.value = det;
      vd.connect(o.detune);
      o.connect(f); o.start(t);
      // The filter and gain go with the second oscillator.
      voice(o, end + 0.1, ...(type === "square" ? [f, g] : []));
    }
  };
  const bell = (t, midi) => {
    for (const [ratio, lvl, dec] of [[1, 0.12, 0.9], [2.76, 0.04, 0.4], [5.4, 0.02, 0.2]]) {
      const o = ac.createOscillator(); o.frequency.value = mtof(midi) * ratio;
      const g = ac.createGain(); env(g, t, lvl, 0.002, dec);
      o.connect(g); g.connect(leadBus); g.connect(echo); o.start(t);
      voice(o, t + dec + 0.05, g);
    }
  };
  // A celesta / music box: a pure tone with a glassy overtone, ringing out.
  const celesta = (t, midi, level = 0.15) => {
    for (const [ratio, lvl, dec] of [[1, 1, 1.3], [4, 0.25, 0.25], [2, 0.15, 0.6]]) {
      const o = ac.createOscillator(); o.frequency.value = mtof(midi) * ratio;
      const g = ac.createGain(); env(g, t, level * lvl, 0.002, dec);
      o.connect(g); g.connect(leadBus); g.connect(echo); o.start(t);
      voice(o, t + dec + 0.05, g);
    }
  };
  // A theremin: a wavering, singing tone that slides from its last note.
  const theremin = (t, midi, len, from = null, level = 0.2) => {
    const end = t + len * S;
    const g = ac.createGain(); hold(g, t, end, level, 0.09, 0.25);
    g.connect(leadBus); g.connect(echo);
    const vib = ac.createOscillator(); vib.frequency.value = 6.2;
    const vd = ac.createGain();
    vd.gain.setValueAtTime(8, t); vd.gain.linearRampToValueAtTime(30, t + Math.min(0.6, len * S));
    vib.connect(vd); vib.start(t); voice(vib, end + 0.3, vd);
    for (const [type, lvl] of [["sine", 1], ["triangle", 0.35]]) {
      const o = ac.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(mtof(from ?? midi), t);
      o.frequency.exponentialRampToValueAtTime(mtof(midi), t + (from == null ? 0.01 : 0.12));
      vd.connect(o.detune);
      const lg = ac.createGain(); lg.gain.value = lvl;
      o.connect(lg); lg.connect(g); o.start(t);
      voice(o, end + 0.3, lg, ...(type === "triangle" ? [g] : []));
    }
  };
  // A bassoon-ish low reed.
  const bassoon = (t, midi, len, level = 0.1) => {
    const end = t + len * S;
    const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 850; f.Q.value = 4;
    const g = ac.createGain(); hold(g, t, end, level, 0.03, 0.08);
    f.connect(g); g.connect(leadBus);
    oscs(t, end + 0.1, [["square", mtof(midi), 0], ["sawtooth", mtof(midi), 5, 0.6]], f, [f, g]);
  };

  const play = SONG.arrange({
    kick, clap, hat, crash, timpani, swell, riser, bass, pizz, pad, stab, choir, pluck, lead, bell, celesta, theremin, bassoon,
  });

  // ---- the scheduler ----
  const LOOKAHEAD = 1.2;          // seconds — survives a throttled background tab
  let step = 0, next = t0 + 0.15;
  const pump = () => {
    // If the tab slept past the lookahead, jump ahead rather than pile notes up.
    if (until == null && next < ac.currentTime) {
      const skip = Math.ceil((ac.currentTime - next) / S);
      step += skip; next += skip * S;
    }
    const horizon = until ?? ac.currentTime + LOOKAHEAD;
    while (next < horizon) { play(step, next); step++; next += S; }
  };
  pump();
  const timer = until == null ? setInterval(pump, 100) : null;

  return function stop() {
    clearInterval(timer);
    const now = ac.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(0.0001, now + 0.4);
    setTimeout(() => {
      for (const s of live) { try { s.stop(); } catch {} }
      fixed.forEach((n) => { try { n.disconnect(); } catch {} });
    }, 500);
  };
}
