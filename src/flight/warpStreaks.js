// warpStreaks.js — the view at warp: stars stretched into streaks rushing out
// of a vanishing point dead ahead, the way the show did it, plus the flash
// as the ship jumps to warp and drops back out.
//
// The streaks fill a tube around the ship's line of travel (nothing on the
// axis itself, so the vanishing point stays clear). Each one is a quad whose
// two ends are projected in the vertex shader and then widened in screen
// space, so it reads as a solid, tapered line at any distance — WebGL lines
// are stuck at one pixel. Positions come from one uniform, how far the ship
// has "travelled" through the field, so the only per-frame CPU work is a
// handful of uniforms.
//
// Drawn in the ship's frame: Scene.jsx rotates the mesh's group so local +z
// is the direction the ship is pointed.
import * as THREE from "three";

const COUNT = 900;
const DEPTH = 320;   // tube length ahead of the ship; streaks wrap within it
const NEAR = 0.5;    // they vanish here, just before the camera
const ENGAGE_TIME = 0.7;  // s for dots to stretch into streaks
const DROP_TIME = 0.45;   // s for them to shrink back on drop-out
const SNAP_AT = 0.85;     // how stretched before the jump (and the flash)

const streakVertex = /* glsl */ `
attribute vec4 aStreak;  // angle, radius, start (fraction of DEPTH), unused
attribute vec2 aCorner;  // along (0 = head, 1 = tail), side (-1 | +1)
attribute vec3 aColor;
uniform float uTravel;   // distance the field has moved past the ship
uniform float uLen;      // streak length, world units
uniform float uWidth;    // half-width at the head, device px
uniform float uAmt;      // 0..1 how far into warp
uniform vec2 uViewport;  // device px
varying float vAlong;
varying float vSide;
varying float vBright;
varying vec3 vColor;

void main() {
  float z = ${NEAR.toFixed(2)} + mod(aStreak.z * ${DEPTH.toFixed(1)} - uTravel, ${DEPTH.toFixed(1)});
  vec2 xy = vec2(cos(aStreak.x), sin(aStreak.x)) * aStreak.y;
  mat4 mvp = projectionMatrix * modelViewMatrix;
  vec4 h = mvp * vec4(xy, z, 1.0);
  vec4 t = mvp * vec4(xy, z + uLen, 1.0);
  vec2 half_ = uViewport * 0.5;
  vec2 hs = h.xy / h.w * half_;
  vec2 ts = t.xy / t.w * half_;
  vec2 d = ts - hs;
  float L = length(d);
  vec2 dir = L > 1e-3 ? d / L : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  // Nearer streaks are fatter; every streak tapers toward its tail.
  float w = uWidth * clamp(40.0 / z, 0.5, 3.0) * mix(1.0, 0.3, aCorner.x);
  bool head = aCorner.x < 0.5;
  vec4 c = head ? h : t;
  vec2 px = (head ? hs - dir * w : ts + dir * w * 0.5) + perp * aCorner.y * w;
  gl_Position = vec4(px / half_ * c.w, c.z, c.w);

  vAlong = aCorner.x;
  vSide = aCorner.y;
  // Fade in from the far end of the tube so wrapping streaks never pop.
  vBright = (1.0 - smoothstep(0.5, 1.0, (z - ${NEAR.toFixed(2)}) / ${DEPTH.toFixed(1)})) * uAmt;
  vColor = aColor;
}
`;

const streakFragment = /* glsl */ `
varying float vAlong;
varying float vSide;
varying float vBright;
varying vec3 vColor;
void main() {
  float core = 1.0 - vSide * vSide;
  core *= core;
  float tail = pow(1.0 - vAlong, 1.6);
  vec3 col = mix(vec3(1.0), vColor, smoothstep(0.0, 0.45, vAlong));
  gl_FragColor = vec4(col * core * tail * vBright * 1.4, 1.0);
}
`;

// A full-screen quad: a burst at the vanishing point (the middle of the
// viewer, since the view looks straight down the line of travel at warp)
// with a long horizontal flare through it.
//
// Before the burst, the charge: power drawn off the other systems. The view
// dims toward the edges, conduits of amber power stream in from all sides
// to the vanishing point, and a core builds there, blue-white, until it
// lets go as the flash. Blended as premultiplied colour over the scene —
// alpha darkens what's behind, colour adds light on top.
const flashVertex = /* glsl */ `
varying vec2 vP;
uniform float uAspect;
void main() {
  vP = position.xy * vec2(uAspect, 1.0);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
const flashFragment = /* glsl */ `
varying vec2 vP;
uniform float uFlash;
uniform float uCharge;
uniform float uTime;
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  float r = length(vP);
  float burst = exp(-r * r * 9.0) + 0.35 * exp(-r * 2.5);
  float flare = exp(-abs(vP.y) * 70.0) * exp(-abs(vP.x) * 1.2);
  vec3 col = (vec3(0.75, 0.85, 1.0) * burst + vec3(0.55, 0.7, 1.0) * flare) * uFlash;

  // Conduits: thin lanes around the vanishing point, about half of them
  // live, each with bright pulses running inward. They reach further in as
  // the charge builds.
  float lanes = 36.0;
  float u = (atan(vP.y, vP.x) / 6.2831853 + 0.5) * lanes;
  float h = hash(floor(u));
  float beam = smoothstep(0.32, 0.0, abs(fract(u) - 0.5)) * step(0.45, h);
  float pulse = smoothstep(0.55, 1.0, fract(r * 2.5 + uTime * (1.4 + h) + h * 7.0));
  float reach = smoothstep(0.0, 0.25, r - mix(1.5, 0.04, uCharge));
  vec3 hot = mix(vec3(0.55, 0.8, 1.2), vec3(1.0, 0.55, 0.2), smoothstep(0.15, 1.1, r));
  col += hot * beam * (0.25 + pulse) * reach * uCharge * 0.9;
  col += vec3(0.6, 0.8, 1.2) * exp(-r * r * 40.0) * uCharge * uCharge * 1.6;

  float dim = uCharge * 0.45 * smoothstep(0.1, 1.0, r);
  gl_FragColor = vec4(col, dim);
}
`;

// Mostly white with the show's blue cast; the odd violet or warm one.
const TINTS = ["#bcd4ff", "#a8c4ff", "#dfe8ff", "#c7b8ff", "#ffe2c4"];
const TINT_WEIGHTS = [0.35, 0.25, 0.25, 0.1, 0.05];

function makeWarpStreaks() {
  const geometry = new THREE.BufferGeometry();
  const streak = new Float32Array(COUNT * 4 * 4);
  const corner = new Float32Array(COUNT * 4 * 2);
  const color = new Float32Array(COUNT * 4 * 3);
  const index = new Uint32Array(COUNT * 6);
  const CORNERS = [[0, -1], [0, 1], [1, -1], [1, 1]];
  const c = new THREE.Color();
  for (let i = 0; i < COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    // Keep the axis clear; more streaks out toward the edges of the view.
    const radius = 1.5 + 30 * Math.sqrt(Math.random());
    const start = Math.random();
    let pick = Math.random(), k = 0;
    while (k < TINTS.length - 1 && (pick -= TINT_WEIGHTS[k]) > 0) k++;
    c.set(TINTS[k]);
    for (let j = 0; j < 4; j++) {
      const v = i * 4 + j;
      streak.set([angle, radius, start, 0], v * 4);
      corner.set(CORNERS[j], v * 2);
      color.set([c.r, c.g, c.b], v * 3);
    }
    const b = i * 4;
    index.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], i * 6);
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COUNT * 4 * 3), 3)); // unused; three wants one
  geometry.setAttribute("aStreak", new THREE.BufferAttribute(streak, 4));
  geometry.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTravel: { value: 0 }, uLen: { value: 0 }, uWidth: { value: 1.5 }, uAmt: { value: 0 },
      uViewport: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: streakVertex,
    fragmentShader: streakFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const flashGeometry = new THREE.PlaneGeometry(2, 2);
  const flashMaterial = new THREE.ShaderMaterial({
    uniforms: { uFlash: { value: 0 }, uAspect: { value: 1 }, uCharge: { value: 0 }, uTime: { value: 0 } },
    vertexShader: flashVertex,
    fragmentShader: flashFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });

  // State lives here, not in the component, so switching stations mid-warp
  // doesn't replay the jump when you come back to CONN.
  let amt = 0, travel = 0, flash = 0, charge = 0, snapped = false, last = 0, clock = 0;

  return {
    geometry,
    material,
    flashGeometry,
    flashMaterial,
    get visible() { return amt > 0.002; },
    get flashing() { return flash > 0.002 || charge > 0.002; },
    // `warping`: sim.mode === "warp"; `charging`: sim.warpChargeProgress
    // (0..1, or null); `factor`: sim.warpFactor; viewport in device px;
    // `pr`: the pixel ratio.
    tick(dt, warping, charging, factor, width, height, pr) {
      const now = performance.now();
      const away = now - last > 500; // the viewer wasn't on screen
      last = now;
      clock += dt;
      if (away) { amt = warping ? 1 : 0; snapped = warping; flash = 0; charge = 0; }

      if (charging != null) {
        // Drawing power: the stars only start to stretch as the charge tops out.
        charge = charging;
        amt = SNAP_AT * Math.max(0, (charge - 0.6) / 0.4);
      } else if (warping) {
        amt = Math.min(1, amt + dt / ENGAGE_TIME);
      } else {
        amt = Math.max(0, amt - dt / DROP_TIME);
      }
      // The jump: a bright flash the moment the sim goes to warp; a softer
      // one going back to impulse. The charge drains fast after either (or
      // an abort).
      if (warping && !snapped) { snapped = true; flash = 1; }
      if (!warping && snapped) { snapped = false; flash = Math.max(flash, 0.6); }
      if (charging == null) charge *= Math.exp(-dt / 0.12);
      flash *= Math.exp(-dt / 0.18);

      // Before the jump the stars barely move; after it they rush.
      const stretch = amt * amt * (3 - 2 * amt);
      const pace = warping ? (snapped ? 1 : 0.15) : stretch;
      // Wrapped on a whole number of tube lengths, so the wrap is invisible.
      travel = (travel + dt * (90 + 70 * factor) * pace) % (DEPTH * 300);

      const u = material.uniforms;
      u.uTravel.value = travel;
      u.uLen.value = stretch * (12 + 10 * factor);
      u.uAmt.value = Math.min(1, amt * 1.5);
      u.uWidth.value = 1.3 * pr;
      u.uViewport.value.set(width, height);
      flashMaterial.uniforms.uFlash.value = flash;
      flashMaterial.uniforms.uCharge.value = charge;
      flashMaterial.uniforms.uTime.value = clock;
      flashMaterial.uniforms.uAspect.value = width / height;
    },
  };
}

export const warpStreaks = makeWarpStreaks();
