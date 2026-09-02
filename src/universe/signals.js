// signals.js — derives what an object "emits" across a few stylized bands
// (Radio, Microwave, Elements) plus a "character" used to synthesize an
// audible sonification, entirely from data the object already has (type,
// kind, mass, size, starClass) — nothing new is stored on the object itself.
// Real radio/microwave frequencies are billions of times above human
// hearing, so this was never going to be literal playback; it's a stable,
// deterministic (seeded by id, not random) stand-in, in the same spirit as
// physics.js's on-rails orbits: pure function, no imports, testable in node.
//
// Character is chosen per type+kind so the sonification is actually varied
// (a gas giant, an ice world, and a moon should not just sound like the same
// hum at different volumes) — see audio.js for what each character sounds
// like. Extra per-character knobs (eventRate, wobbleRate, detune) are seeded
// here rather than randomized in audio.js, so a profile is fully
// self-describing and deterministic.

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295; // 0..1
}
const seeded = (id, salt) => hash(id + ":" + salt);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Base emission strength per type, before mass/jitter — how "loud" the
// radio/microwave/elements bands read on the comms display.
const TYPE_BANDS = {
  star:      { baseAmp: 0.8, radio: 0.5, microwave: 0.6, elements: 0.7 },
  planet:    { baseAmp: 0.3, radio: 0.15, microwave: 0.2, elements: 0.5 },
  moon:      { baseAmp: 0.12, radio: 0.05, microwave: 0.08, elements: 0.3 },
  blackhole: { baseAmp: 1.0, radio: 0.9, microwave: 0.3, elements: 0.1 },
  pulsar:    { baseAmp: 0.9, radio: 1.0, microwave: 0.4, elements: 0.2 },
  nebula:    { baseAmp: 0.4, radio: 0.2, microwave: 0.5, elements: 0.8 }
};

// Which synthesis recipe (audio.js) a body gets. Planets are split by their
// own `kind` field (gas giant/ice/class-M/toxic/desert/ocean/rocky) since
// that's most of the universe and was previously one undifferentiated "hum."
const PLANET_CHARACTER = {
  "gas giant": "wobble", ice: "chime", "class-M": "hum",
  toxic: "drone", desert: "crackle", ocean: "wash", rocky: "crackle"
};
function characterFor(obj) {
  if (obj.type === "planet") return PLANET_CHARACTER[obj.kind] || "hum";
  if (obj.type === "moon") return "click";
  if (obj.type === "star") return (obj.mass || 0) >= 1.8 ? "chorus" : "tone";
  return { blackhole: "rumble", pulsar: "pulse", nebula: "noise" }[obj.type] || "hum";
}

// Hotter/bluer stars read as a higher-pitched tone; cooler/redder ones lower.
const STAR_CLASS_PITCH = {
  "O-type blue": 1.6, "B-type blue": 1.4, "A-type white": 1.2,
  "F-type yellow-white": 1.05, "G-type yellow": 1.0,
  "K-type orange": 0.85, "M-type red": 0.7
};

// { character, amplitude, pitch (Hz), pulseHz, eventRate, wobbleRate,
//   detune, bands: [{name, amplitude}] } — amplitude/band values are 0..1.
// Every field beyond `character`/`bands` is used by only some characters;
// audio.js reads whichever apply to the recipe it's playing.
export function signalProfile(obj) {
  const base = TYPE_BANDS[obj.type] || TYPE_BANDS.planet;
  const massFactor = Math.min(2, 0.5 + Math.sqrt(obj.mass || 0.1));
  const jitter = (salt, spread) => 1 + (seeded(obj.id, salt) - 0.5) * spread;

  const bands = [
    { name: "Radio", amplitude: clamp01(base.radio * massFactor * jitter("radio", 0.4)) },
    { name: "Microwave", amplitude: clamp01(base.microwave * massFactor * jitter("mw", 0.4)) },
    { name: "Elements", amplitude: clamp01(base.elements * jitter("el", 0.5)) }
  ];

  const classPitch = STAR_CLASS_PITCH[obj.starClass] ?? 1;
  const pitch = 110 * classPitch * (0.7 + seeded(obj.id, "pitch") * 0.6); // audible base freq, Hz

  return {
    character: characterFor(obj),
    amplitude: clamp01(base.baseAmp * massFactor),
    pitch,
    pulseHz: obj.type === "pulsar" ? 0.5 + seeded(obj.id, "pulse") * 4 : null,
    eventRate: 0.4 + seeded(obj.id, "rate") * 2.2,     // chime/crackle/click: events/sec
    wobbleRate: 0.05 + seeded(obj.id, "wobble") * 0.3, // wobble/wash/noise: LFO Hz
    detune: 4 + seeded(obj.id, "detune") * 20,          // chorus/drone: cents between voices
    bands
  };
}
