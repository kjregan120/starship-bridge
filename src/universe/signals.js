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
// Keys must match generate.js's STAR_TYPES exactly. They previously did not:
// "M-type red dwarf" and "G-type main sequence" were spelled "M-type red" and
// "G-type yellow" here, so the two commonest classes (65% of all stars) missed
// the lookup and fell through to 1.0 — red dwarfs never actually sounded lower
// than a white star. There is no O-type in the generator, so none is listed.
const STAR_CLASS_PITCH = {
  "B-type blue": 1.4, "A-type white": 1.2, "F-type yellow-white": 1.05,
  "G-type main sequence": 1.0, "K-type orange": 0.85, "M-type red dwarf": 0.7
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

// ---------------------------------------------------------------------------
// Electromagnetic spectrum
// ---------------------------------------------------------------------------
// Everything above this line is stylized-but-consistent invention. Everything
// below it is real physics applied to the invented data: Planck's law and
// Wien's displacement law over an effective temperature, and actual measured
// emission-line wavelengths. The reason that's worth doing is that `starClass`
// is already a temperature proxy, so a blackbody continuum encodes star class
// in the *shape* of a curve — an M-type red dwarf peaking out in thermal IR
// vs. a B-type blue peaking in the UV — which the amplitude bars never could.
//
// The other payoff is a negative one: Gravimetric and Subspace are not
// electromagnetic, so they have no position on this axis at all and have to be
// reported separately. A beacon therefore reads as *blank* across the entire
// EM spectrum while pinning the subspace gauge — it is literally off the
// electromagnetic chart, which is exactly the story generate.js is telling.

const H_PLANCK = 6.62607015e-34; // J·s
const C_LIGHT = 2.99792458e8;    // m/s
const K_BOLTZ = 1.380649e-23;    // J/K
const WIEN_B = 2.897771955e-3;   // m·K

// Rough effective temperatures (K). Stars are their class's midpoint; planets
// and moons are their thermal-equilibrium surface temperature, which is what
// makes them show up as a faint IR glow rather than nothing at all. The toxic
// value is Venus's actual 737 K runaway-greenhouse surface.
// Same key set as STAR_CLASS_PITCH — see the note there.
const STAR_CLASS_TEMP = {
  "B-type blue": 18000, "A-type white": 8600, "F-type yellow-white": 6600,
  "G-type main sequence": 5780, "K-type orange": 4400, "M-type red dwarf": 3200
};
const PLANET_KIND_TEMP = {
  "gas giant": 130, ice: 110, "class-M": 288,
  toxic: 737, desert: 320, ocean: 290, rocky: 250
};

// Effective temperature for the thermal continuum, or null for a body whose
// emission isn't thermal in any useful sense. Black holes and pulsars report
// their accretion disk / neutron-star surface (both X-ray-peaked), not the
// object itself. Beacons return null on purpose — see the note above.
export function emissionTemperature(obj) {
  switch (obj.type) {
    case "star": return STAR_CLASS_TEMP[obj.starClass] ?? 5780;
    case "planet": return PLANET_KIND_TEMP[obj.kind] ?? 260;
    case "moon": return 180;
    case "blackhole": return 1.2e6; // accretion disk
    case "pulsar": return 1.0e6;    // neutron star surface
    case "nebula": return 9000;     // ionized H II region
    default: return null;           // beacon: artificial, no thermal continuum
  }
}

// Planck's law: spectral radiance of a blackbody at temperature T, per unit
// wavelength. Absolute units don't matter here (the display normalizes to the
// curve's own peak), only the shape does. expm1 rather than exp(x)-1 keeps the
// long-wavelength tail from cancelling itself to zero and going infinite.
export function planckRadiance(lambdaMeters, T) {
  if (!(T > 0) || !(lambdaMeters > 0)) return 0;
  const x = (H_PLANCK * C_LIGHT) / (lambdaMeters * K_BOLTZ * T);
  const denom = Math.expm1(x);
  if (!isFinite(denom) || denom <= 0) return 0;
  return (2 * H_PLANCK * C_LIGHT * C_LIGHT) / (Math.pow(lambdaMeters, 5) * denom);
}

// Wien's displacement law — wavelength (m) at which the continuum peaks.
export const wienPeak = (T) => (T > 0 ? WIEN_B / T : null);

// The EM spectrum in decades of wavelength (meters), long on the left. These
// boundaries are the conventional ones; the axis is clipped at both ends since
// nothing here emits past them.
export const EM_BANDS = [
  { name: "RADIO", short: "RADIO", from: 1e2, to: 1e-1, tint: "#4f7a8f" },
  { name: "MICROWAVE", short: "MICRO", from: 1e-1, to: 1e-3, tint: "#5f8fb0" },
  { name: "INFRARED", short: "IR", from: 1e-3, to: 7e-7, tint: "#b0603f" },
  { name: "VISIBLE", short: "VIS", from: 7e-7, to: 4e-7, tint: null }, // true-color
  { name: "ULTRAVIOLET", short: "UV", from: 4e-7, to: 1e-8, tint: "#8f6fd0" },
  { name: "X-RAY", short: "X-RAY", from: 1e-8, to: 1e-11, tint: "#7fa0cc" },
  { name: "GAMMA", short: "γ", from: 1e-11, to: 1e-12, tint: "#cfe0ff" }
];

// Real measured emission-line wavelengths (nm, air). Which lines a given body
// shows is seeded off its id against its own Elements amplitude, so a
// heavy-element-rich body shows a dense forest of lines and a barren one shows
// two or three — deterministic, and the same every time you re-scan it.
const ELEMENT_LINES = [
  { el: "Ca II", nm: 393.4 }, { el: "Ca II", nm: 396.8 }, { el: "Hδ", nm: 410.2 },
  { el: "Hγ", nm: 434.0 }, { el: "Fe I", nm: 438.4 }, { el: "He I", nm: 447.1 },
  { el: "Hβ", nm: 486.1 }, { el: "O III", nm: 495.9 }, { el: "O III", nm: 500.7 },
  { el: "Mg I", nm: 518.4 }, { el: "He I", nm: 587.6 }, { el: "Na D", nm: 589.3 },
  { el: "Hα", nm: 656.3 }, { el: "He I", nm: 667.8 }, { el: "S II", nm: 671.6 }
];

// FNV-1a's low bits barely move when two inputs differ only in their final
// character, so sequential salts ("line0", "line1", ... ) come out clustered
// within a few thousandths of each other — p-9 rolls 0.908, 0.904, 0.900, ...
// A per-line threshold against those is not a coin flip per line; it is one
// coin flip shared by all of them, so a body would show either every element
// line or none, never a mix.
//
// This is deliberately a separate function rather than a fix to hash() above.
// Every existing profile value — pitch, pulseHz, the four band jitters — is
// seeded through hash(), so improving it in place would silently re-roll the
// signal of every object in the universe. New code gets the better mixer; the
// established sound stays exactly as it is.
function hashMixed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
const seededLine = (id, salt) => hashMixed(id + ":" + salt);

// [{ el, nm, strength }] — the lines this body actually shows.
export function emissionLines(obj, profile) {
  const elements = profile.bands.find((b) => b.name === "Elements")?.amplitude ?? 0;
  if (elements <= 0.05) return [];
  return ELEMENT_LINES
    .map((line, i) => ({ ...line, roll: seededLine(obj.id, "line" + i) }))
    .filter((line) => line.roll < elements)
    .map((line) => ({
      el: line.el,
      nm: line.nm,
      strength: clamp01(elements * (0.45 + seededLine(obj.id, "lstr" + line.nm) * 0.75))
    }));
}
