// signals.js — derives what an object "emits" across a few stylized bands
// (Radio, Microwave, Elements, Gravimetric, Subspace) plus a "character"
// used to synthesize an audible sonification, entirely from data the object
// already has (type, kind, mass, size, starClass) — nothing new is stored
// on the object itself.
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
// radio/microwave/elements/gravimetric/subspace bands read on the comms
// display. Gravimetric tracks compactness (black holes and pulsars are
// extreme for their mass, so they read far louder than a star of similar
// baseAmp); subspace is mostly a near-zero natural-noise floor since no
// object type here is an artificial emitter yet — it's a hook for ships/
// stations to register on later, not currently a meaningful signal.
const TYPE_BANDS = {
  star:      { baseAmp: 0.8, radio: 0.5, microwave: 0.6, elements: 0.7, gravimetric: 0.25, subspace: 0.02 },
  planet:    { baseAmp: 0.3, radio: 0.15, microwave: 0.2, elements: 0.5, gravimetric: 0.05, subspace: 0.02 },
  moon:      { baseAmp: 0.12, radio: 0.05, microwave: 0.08, elements: 0.3, gravimetric: 0.02, subspace: 0.01 },
  blackhole: { baseAmp: 1.0, radio: 0.9, microwave: 0.3, elements: 0.1, gravimetric: 1.0, subspace: 0.03 },
  pulsar:    { baseAmp: 0.9, radio: 1.0, microwave: 0.4, elements: 0.2, gravimetric: 0.6, subspace: 0.03 },
  nebula:    { baseAmp: 0.4, radio: 0.2, microwave: 0.5, elements: 0.8, gravimetric: 0.05, subspace: 0.08 },
  // The one artificial emitter type: near-silent everywhere except a strong
  // Subspace reading — that's the whole point, see generate.js.
  beacon:    { baseAmp: 0.35, radio: 0.03, microwave: 0.03, elements: 0.02, gravimetric: 0.0, subspace: 0.85 }
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
  return { blackhole: "rumble", pulsar: "pulse", nebula: "noise", beacon: "beacon" }[obj.type] || "hum";
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
    { name: "Elements", amplitude: clamp01(base.elements * jitter("el", 0.5)) },
    // Gravimetric scales with mass like radio/microwave (it's the one band
    // that's physically mass-driven), so a heavy star still reads louder
    // than a light one of the same type.
    { name: "Gravimetric", amplitude: clamp01(base.gravimetric * massFactor * jitter("grav", 0.3)) },
    // Subspace deliberately ignores massFactor — it's not a mass effect,
    // just a low ambient-noise floor until artificial emitters exist.
    { name: "Subspace", amplitude: clamp01(base.subspace * jitter("subspace", 0.6)) }
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

// A short computer-voice reading of a profile, driven by simple thresholds
// against the same TYPE_BANDS this profile came from. Not exhaustive — just
// enough that a distinctive reading (a beacon's too-regular subspace spike,
// a black hole's gravimetric extreme) gets called out in plain language
// instead of only showing up as a number on the bars.
export function interpretSignal(obj, profile) {
  const band = (name) => profile.bands.find((b) => b.name === name)?.amplitude ?? 0;
  if (obj.type === "beacon")
    return "Rhythmic, evenly-spaced subspace pulse — inconsistent with a natural source. Signal is artificial.";
  if (band("Subspace") > 0.5)
    return "Elevated subspace reading for a body of this type — possible artificial source nearby.";
  if (obj.type === "blackhole")
    return "Gravimetric signature consistent with a compact stellar remnant. Extreme caution advised.";
  if (obj.type === "pulsar")
    return "Regular radio pulses at a fixed interval — consistent with a rotating neutron star.";
  if (band("Gravimetric") > 0.5)
    return "Gravimetric reading stronger than expected for a body of this mass.";
  if (obj.type === "nebula")
    return "Diffuse signature spread across multiple bands — ionized gas and dust are scattering the reading.";
  if (band("Elements") > 0.75)
    return "Strong elemental spectral lines — heavy-element-rich composition.";
  if (band("Radio") > 0.75)
    return "Strong radio emission for a body of this type.";
  return "Signal profile nominal for a body of this type.";
}
