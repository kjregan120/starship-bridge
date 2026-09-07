// WaveField.jsx — the sound the ship is currently receiving, rendered as
// wavefronts propagating out from the source across a displaced grid, the way
// a dropped stone rings a pond. This is the panel the old "SOUND FIELD" name
// was promising; the contact plot that used to hold the slot moved to
// ContactRadar.jsx, which is what it actually was.
//
// Everything here is driven by the same shared AnalyserNode as SignalScope /
// Spectrogram / LoudnessHistory (audio.js), so it shows what is genuinely
// playing rather than replaying the profile as an animation:
//
//   ring spawn  <- onset detection (spectral flux), floored at a steady rate
//                  so sustained drones still emit slow swells
//   ring height <- the RMS at the moment that ring was born
//   hue         <- dominant frequency bin, amber (low) through cyan (high)
//   glow        <- live RMS
//
// The side effect is that each signals.js character propagates differently
// without any per-character code here: a pulsar throws one crisp ring per
// tick, a gas giant rolls slow broad swells, an ice world scatters ragged
// chimes, and a beacon fires rings at a suspiciously perfect interval.
import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, useMemo } from "react";
import * as THREE from "three";
import { getAnalyser } from "./audio.js";

const MAX_RINGS = 10;   // shader unroll bound; also caps concurrent wavefronts
const EDGE = 2.1;       // radius at which a ring leaves the grid, world units
const RING_SPEED = 0.95; // units/sec — the "speed of sound" for this display

const vertexShader = /* glsl */ `
  #define MAX_RINGS ${MAX_RINGS}
  uniform float uTime;
  uniform float uRms;
  uniform float uRingR[MAX_RINGS];
  uniform float uRingA[MAX_RINGS];
  varying float vH;
  varying float vR;

  void main() {
    float r = length(position.xy);
    float h = 0.0;

    // Each wavefront is a travelling wave packet: a couple of oscillations
    // inside a gaussian envelope that rides outward with the ring radius.
    for (int i = 0; i < MAX_RINGS; i++) {
      float a = uRingA[i];
      if (a <= 0.0) continue;
      float d = r - uRingR[i];
      h += a * exp(-d * d * 22.0) * cos(d * 12.0);
    }

    // A low ambient swell so a continuous tone still moves the surface
    // between wavefronts instead of sitting dead flat.
    h += uRms * 0.09 * sin(r * 6.5 - uTime * 2.2) / (1.0 + r * 0.8);

    h *= 1.0 / (1.0 + r * 0.5);              // energy spreads as it travels out
    h *= 1.0 - smoothstep(1.45, ${EDGE.toFixed(2)}, r); // fade off the grid's square corners

    vH = h;
    vR = r;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, h, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vH;
  varying float vR;

  void main() {
    float e = clamp(abs(vH) * 6.5, 0.0, 1.0);
    vec3 c = mix(uColor * 0.35, mix(uColor, vec3(1.0), 0.6), e);
    float alpha = (0.10 + e * 0.9) * (1.0 - smoothstep(1.35, ${EDGE.toFixed(2)}, vR));
    gl_FragColor = vec4(c, alpha);
  }
`;

function Surface({ profile }) {
  const matRef = useRef();
  const coreRef = useRef();
  const groupRef = useRef();

  const analyser = useMemo(() => getAnalyser(), []);
  const timeData = useMemo(() => new Uint8Array(analyser.fftSize), [analyser]);
  const freqData = useMemo(() => new Uint8Array(analyser.frequencyBinCount), [analyser]);
  const prevFreq = useMemo(() => new Float32Array(analyser.frequencyBinCount), [analyser]);

  const rings = useRef([]);          // { r, amp } — live wavefronts
  const sinceSpawn = useRef(0);
  const fluxAvg = useRef(0);
  const hue = useRef(0.4);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uRms: { value: 0 },
    uColor: { value: new THREE.Color("#6bffc4") },
    uRingR: { value: new Array(MAX_RINGS).fill(0) },
    uRingA: { value: new Array(MAX_RINGS).fill(0) }
  }), []);

  // The floor rate at which a *sustained* signal emits wavefronts, so a star's
  // unbroken drone still visibly propagates. Transient characters (pulse,
  // beacon, chime, crackle, click) mostly beat this via onset detection.
  const floorInterval = useMemo(() => {
    if (!profile) return 0.9;
    if (profile.pulseHz) return Math.min(1.6, 1 / profile.pulseHz);
    return THREE.MathUtils.clamp(1 / Math.max(0.2, profile.eventRate * 0.6), 0.22, 1.6);
  }, [profile]);

  useFrame((state, dt) => {
    const step = Math.min(dt, 0.05); // don't let a stalled tab fire a burst
    uniforms.uTime.value = state.clock.elapsedTime;

    // --- live audio ---------------------------------------------------------
    analyser.getByteTimeDomainData(timeData);
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = timeData[i] / 128 - 1;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / timeData.length);
    uniforms.uRms.value = rms;

    analyser.getByteFrequencyData(freqData);
    const usable = Math.floor(freqData.length * 0.25); // everything here is well under a few kHz

    // spectral flux: how much energy *rose* since last frame — an onset
    let flux = 0, peak = 0, peakBin = 0;
    for (let i = 0; i < usable; i++) {
      const v = freqData[i] / 255;
      const rise = v - prevFreq[i];
      if (rise > 0) flux += rise;
      prevFreq[i] = v;
      if (v > peak) { peak = v; peakBin = i; }
    }
    const onset = flux > fluxAvg.current * 2.2 + 0.35;
    fluxAvg.current += (flux - fluxAvg.current) * 0.12;

    // dominant frequency -> hue, amber (low) through cyan (high)
    if (peak > 0.06) {
      const target = 0.09 + (peakBin / usable) * 0.44;
      hue.current += (target - hue.current) * 0.06;
    }
    uniforms.uColor.value.setHSL(hue.current, 0.85, 0.6);

    // --- wavefronts ---------------------------------------------------------
    sinceSpawn.current += step;
    const audible = rms > 0.008;
    if (audible && (onset || sinceSpawn.current >= floorInterval) && sinceSpawn.current > 0.12) {
      sinceSpawn.current = 0;
      rings.current.push({ r: 0.06, amp: 0.10 + Math.min(0.9, rms * 3.4) * 0.30 });
      if (rings.current.length > MAX_RINGS) rings.current.shift();
    }

    for (const ring of rings.current) ring.r += step * RING_SPEED;
    rings.current = rings.current.filter((ring) => ring.r < EDGE);

    for (let i = 0; i < MAX_RINGS; i++) {
      const ring = rings.current[i];
      uniforms.uRingR.value[i] = ring ? ring.r : 0;
      // taper each front out as it reaches the edge so nothing pops
      uniforms.uRingA.value[i] = ring ? ring.amp * (1 - ring.r / EDGE) : 0;
    }

    // --- emitting core ------------------------------------------------------
    if (coreRef.current) {
      const s = 0.055 + rms * 0.16;
      coreRef.current.scale.setScalar(s / 0.055);
      coreRef.current.material.color.copy(uniforms.uColor.value);
      coreRef.current.material.opacity = 0.45 + Math.min(0.55, rms * 2.2);
    }
    // a slow sway, so the surface reads as a 3D object rather than a texture
    if (groupRef.current) groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.13) * 0.28;

  });

  return (
    <group ref={groupRef}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[EDGE * 2, EDGE * 2, 72, 72]} />
        <shaderMaterial
          ref={matRef}
          uniforms={uniforms}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          wireframe
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.055, 16, 16]} />
        <meshBasicMaterial color="#6bffc4" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

export default function WaveField({ profile }) {
  return (
    <div className="wavefield-wrap">
      <Canvas
        className="wavefield-canvas"
        camera={{ position: [0, 1.5, 2.7], fov: 42 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <Surface profile={profile} />
      </Canvas>
    </div>
  );
}
