// flareLoops.js — coronal loops / prominences arcing off a star's surface,
// some of which erupt.
//
// One instanced tube per star, a handful of slots. Each slot is a loop
// anchored at two footpoints on the surface; its shape (span, height, lean,
// how peaked or flat-topped the arch is, thickness, how much it writhes) is
// rolled fresh every time the slot respawns, so no two loops look alike.
// The tube is bent entirely in the vertex shader from those per-instance
// numbers, so respawning a loop is just rewriting a few attribute values.
//
// Life cycle (also in the shader, from birth time + duration): the arch
// rises out of the surface, holds while plasma streams along it, then
// drains — it thins, sags and fades back down. Slots sit dormant for a
// random gap between loops; how busy a star is comes from its seed.
//
// Bursts: some loops go unstable instead of draining. They swell and writhe
// harder for a few seconds, then snap at the apex — the torn ends whip
// outward and fade while the legs drop back. The snap is a flare: tick()
// feeds the surface shader two bright ribbons along the footpoints and the
// corona a brightening in that direction (starShader.js, uFlareA/B/W),
// and hands onBurst a cloud to throw off from the torn apex (ejecta.js).
import * as THREE from "three";
import { SIMPLEX, seedFor, FLARE_SLOTS } from "./starShader.js";

const SLOTS = FLARE_SLOTS;   // about half are on the far side at any moment
const SEG_U = 56;   // segments along the loop
const SEG_V = 8;    // segments around the tube
const SWELL = 5;    // seconds of instability before a burst

const vertex = /* glsl */ `
attribute vec3 aFootA;
attribute vec3 aFootB;
attribute vec4 aShape;   // height, thickness, lean, arch exponent (all in star radii)
attribute vec4 aLife;    // birth, duration, seed, writhe
attribute vec2 aBurst;   // snap time (s after birth; 0 = drains instead), tail (s)
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vRing;
varying float vU;
varying float vLift;
varying float vEnv;
varying float vSeed;
varying float vThick;
varying float vTear;

vec3 slerpDir(vec3 a, vec3 b, float t){
  float om = acos(clamp(dot(a, b), -1.0, 1.0));
  return (sin((1.0 - t) * om) * a + sin(t * om) * b) / sin(om);
}
// max() because sin(pi) comes out a hair negative, and pow() of that is NaN.
float liftAt(float u){ return pow(max(sin(3.14159265 * u), 1e-4), aShape.w); }
// Centre line of the loop: slide between the footpoints over the surface,
// lift off it by the arch, bow sideways by the lean, and writhe a little.
// After a snap (k > 0) the parts near the apex fling outward.
vec3 spine(float u, float h, vec3 side, float writhe, float k){
  vec3 d = slerpDir(aFootA, aFootB, u);
  float lift = liftAt(u);
  float wob = sin(u * 9.0 + uTime * 0.5 + aLife.z) * 0.07
            + sin(u * 23.0 - uTime * 0.9 + aLife.z * 2.0) * 0.025;
  vec3 c = d * (0.985 + h * lift) + side * h * lift * (aShape.z + writhe * wob);
  float apex = 1.0 - smoothstep(0.0, 0.5, abs(u - 0.5));
  return c + normalize(c) * h * k * (0.5 + 2.0 * k) * apex * apex;
}

void main(){
  float ageS = uTime - aLife.x;
  float age = ageS / aLife.y;
  if (age <= 0.0 || age >= 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }  // dormant: clipped away

  float bursts = step(0.001, aBurst.x);
  float swell = bursts * smoothstep(aBurst.x - ${SWELL.toFixed(1)}, aBurst.x, ageS);
  float k = bursts * clamp((ageS - aBurst.x) / aBurst.y, 0.0, 1.0);   // 0 until the snap, then 0..1
  float snapped = bursts * step(aBurst.x, ageS);

  float rise = smoothstep(0.0, 0.22, age);
  float drain = (1.0 - bursts) * smoothstep(0.62, 1.0, age);
  float h = aShape.x * (0.15 + 0.85 * rise) * (1.0 - 0.35 * drain) * (1.0 + 0.45 * swell) * (1.0 - 0.4 * k);
  float writhe = aLife.w * (1.0 + 2.5 * swell);

  float u = position.x;
  float th = position.y * 6.2831853;
  vec3 side = normalize(cross(aFootA, aFootB));
  vec3 c = spine(u, h, side, writhe, k);
  vec3 T = normalize(spine(min(u + 0.004, 1.0), h, side, writhe, k) - spine(max(u - 0.004, 0.0), h, side, writhe, k));
  vec3 N = normalize(cross(T, normalize(c)));
  vec3 B = cross(N, T);

  float lift = liftAt(u);
  float thick = aShape.y * (0.65 + 0.35 * lift)
              * (1.0 + 0.3 * sin(u * 15.0 + aLife.z + uTime * 0.3))
              * (1.0 - 0.6 * drain) * (1.0 + 0.3 * swell) * (1.0 - 0.5 * k);
  vec3 off = cos(th) * N + sin(th) * B;

  vec4 wp = modelMatrix * vec4(c + off * thick, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * off);
  vRing = vec2(cos(th), sin(th));
  vU = u;
  vLift = lift;
  vSeed = aLife.z;
  // Unstable loops brighten as they swell; the snap flashes, then fades out.
  vEnv = smoothstep(0.0, 0.12, age) * (1.0 - drain) * (1.0 + 0.8 * swell * (1.0 - snapped))
       * mix(1.0, (1.0 + 6.0 * exp(-k * 5.0)) * pow(1.0 - k, 1.5), snapped);
  vTear = snapped * (0.02 + 0.4 * k);
  vThick = thick * length(modelMatrix[0].xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform vec3 uCenter;    // star centre, world space
uniform float uRadius;   // star's world radius
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vRing;
varying float vU;
varying float vLift;
varying float vEnv;
varying float vSeed;
varying float vThick;
varying float vTear;
${SIMPLEX}
void main(){
  // A snapped loop is torn open at the apex, the gap widening as it flies apart.
  if (vTear > 0.0) {
    float ragged = 0.75 + 0.5 * snoise(vec3(vRing * 1.5, vSeed + vU * 4.0));
    if (abs(vU - 0.5) < vTear * ragged) discard;
  }

  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  // Soft round tube: bright down the middle, fading to nothing at the edges.
  float facing = abs(dot(normalize(vNormalW), v));
  float core = facing * facing;

  // Plasma streaming foot to foot, with brighter knots drifting slower.
  float flow = snoise(vec3(vU * 9.0 - uTime * 0.5, vRing * 0.7 + vSeed));
  float knot = pow(max(snoise(vec3(vU * 3.5 + uTime * 0.12, vSeed, vSeed * 0.3)), 0.0), 2.0);
  float flick = 0.85 + 0.15 * sin(uTime * 3.1 + vSeed * 7.0) * sin(uTime * 1.7 + vSeed);
  float b = (0.65 + 0.45 * flow + 1.6 * knot) * core * vEnv * flick;

  // Once the tube is thinner than about a pixel it only sparkles; fade it.
  float pxPerRadius = length(fwidth(vWorld)) / max(vThick, 1e-6);
  b *= 1.0 - smoothstep(0.7, 2.5, pxPerRadius);

  // Seen against the star's disk, additive glow just washes out — dim it.
  vec3 ray = -v;
  float along = dot(uCenter - cameraPosition, ray);
  float d = length(cameraPosition + ray * along - uCenter) / uRadius;
  if (along > dist) b *= mix(0.4, 1.0, smoothstep(0.96, 1.02, d));

  // Hot and pale where the loop meets the surface, deeper and redder at the top.
  // Saturated, so they still read against the near-white corona.
  vec3 hot = mix(uColor, vec3(1.0), 0.3) * 1.5;
  vec3 cool = pow(uColor, vec3(2.0)) * vec3(1.0, 0.42, 0.22) * 1.4;
  vec3 col = mix(hot, cool, smoothstep(0.0, 0.45, vLift)) * b;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// A (u, around) grid; the vertex shader turns it into the bent tube.
function tubeGrid() {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= SEG_U; i++) {
    for (let j = 0; j <= SEG_V; j++) pos.push(i / SEG_U, j / SEG_V, 0);
  }
  const row = SEG_V + 1;
  for (let i = 0; i < SEG_U; i++) {
    for (let j = 0; j < SEG_V; j++) {
      const a = i * row + j, b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const _c = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// `mats` is the star's makeStarMaterials() result: bursts light its surface
// and corona through their flare uniforms.
export function makeFlareLoops(obj, mats) {
  const seed = seedFor(obj.id);
  // How busy this star is: more loops, shorter gaps, more giants and bursts.
  const activity = 0.35 + 0.65 * (seed.x / 100);
  const active = Math.round(4 + activity * (SLOTS - 4));

  const geometry = tubeGrid();
  const footA = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 3), 3);
  const footB = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 3), 3);
  const shape = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 4), 4);
  const life = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 4), 4);
  const burst = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 2), 2);
  geometry.setAttribute("aFootA", footA);
  geometry.setAttribute("aFootB", footB);
  geometry.setAttribute("aShape", shape);
  geometry.setAttribute("aLife", life);
  geometry.setAttribute("aBurst", burst);
  geometry.instanceCount = SLOTS;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(obj.color || "#ffffff") },
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uRadius: { value: obj.size || 1 },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  // Per-slot loop centre (object space) and span, kept for the flare uniforms.
  const centers = Array.from({ length: SLOTS }, () => new THREE.Vector3());
  const spans = new Float32Array(SLOTS);
  const launched = new Uint8Array(SLOTS);   // this slot's burst has thrown its cloud

  function spawn(i, now, initial) {
    const giant = Math.random() < 0.12 * activity;
    // Mostly in the active-latitude bands either side of the equator, like
    // sunspots; now and then anywhere.
    const lat = (Math.random() < 0.15 ? rand(0, 60) : rand(8, 35)) * (Math.random() < 0.5 ? -1 : 1) * Math.PI / 180;
    const lon = rand(0, Math.PI * 2);
    _c.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
    _e1.crossVectors(_up, _c).normalize();
    _e2.crossVectors(_c, _e1);
    const a = rand(0, Math.PI * 2);
    _e1.multiplyScalar(Math.cos(a)).addScaledVector(_e2, Math.sin(a));   // span direction
    const span = giant ? rand(0.55, 0.9) : rand(0.15, 0.5);
    const ca = Math.cos(span / 2), sa = Math.sin(span / 2);
    footA.setXYZ(i, _c.x * ca + _e1.x * sa, _c.y * ca + _e1.y * sa, _c.z * ca + _e1.z * sa);
    footB.setXYZ(i, _c.x * ca - _e1.x * sa, _c.y * ca - _e1.y * sa, _c.z * ca - _e1.z * sa);
    centers[i].copy(_c);
    spans[i] = span;
    launched[i] = 0;

    const height = span * rand(0.35, 1.0) * (giant ? 1.3 : 1);
    const thickness = rand(0.012, 0.035) + (giant ? 0.02 : 0);
    shape.setXYZW(i, height, thickness, rand(-0.4, 0.4), rand(0.6, 1.5));

    // An erupting loop lives until its snap plus a short tail; the rest drain.
    const erupts = Math.random() < (giant ? 0.6 : 0.2) * activity;
    let duration;
    if (erupts) {
      const snap = rand(SWELL + 6, 26) * (giant ? 1.3 : 1);
      const tail = rand(3, 4.5);
      burst.setXY(i, snap, tail);
      duration = snap + tail;
    } else {
      burst.setXY(i, 0, 0);
      duration = rand(12, 34) * (giant ? 1.5 : 1);
    }
    const birth = initial
      ? (Math.random() < 0.75 ? now - rand(0, 0.8) * duration : now + rand(0, 8))
      : now + rand(0.5, 8) / activity;
    life.setXYZW(i, birth, duration, rand(0, 100), rand(0.4, 1.6));
  }

  for (let i = active; i < SLOTS; i++) life.setXYZW(i, 1e9, 1, 0, 0);   // never wakes
  // First rolls wait for the first tick: the star may mount long after the
  // clock started, and loops seeded at t=0 would all be long dead.
  let started = false;

  const flareA = mats.surface.uniforms.uFlareA.value;
  const flareB = mats.surface.uniforms.uFlareB.value;
  const flareW = mats.corona.uniforms.uFlareW.value;
  const self = {
    geometry,
    material,
    // Set by the owner: called once per burst, at the snap, with the world
    // direction of the loop's centre, its angular span, its apex height (star
    // radii) and whether it was a giant.
    onBurst: null,
    // `quat` is the star's world rotation, to point the corona's flares.
    tick(t, center, quat) {
      material.uniforms.uTime.value = t;
      material.uniforms.uCenter.value.copy(center);
      let dirty = !started;
      for (let i = 0; i < active; i++) {
        if (!started) spawn(i, t, true);
        else if (t > life.getX(i) + life.getY(i)) { spawn(i, t, false); dirty = true; }
      }
      started = true;
      if (dirty) { footA.needsUpdate = footB.needsUpdate = shape.needsUpdate = life.needsUpdate = burst.needsUpdate = true; }

      // Flare brightness per slot: a faint pre-glow while the loop swells,
      // a spike at the snap, then a decay over the tail.
      for (let i = 0; i < SLOTS; i++) {
        const snap = burst.getX(i);
        let f = 0;
        if (i < active && snap > 0) {
          const ageS = t - life.getX(i);
          if (ageS > 0 && ageS < life.getY(i)) {
            f = ageS < snap ? 0.25 * smooth(snap - SWELL, snap, ageS) : Math.exp(-(ageS - snap) * 0.9);
          }
        }
        flareA[i].set(footA.getX(i), footA.getY(i), footA.getZ(i), f);
        flareB[i].set(footB.getX(i), footB.getY(i), footB.getZ(i), spans[i]);
        _c.copy(centers[i]).applyQuaternion(quat);
        flareW[i].set(_c.x, _c.y, _c.z, f);
        // Throw the cloud at the snap — unless this loop was already past it
        // when the star came into range (a burst we only caught the end of).
        if (snap > 0 && !launched[i] && t - life.getX(i) >= snap) {
          launched[i] = 1;
          if (self.onBurst && t - life.getX(i) < snap + 0.5) self.onBurst(_c, spans[i], shape.getX(i), spans[i] > 0.5);
        }
      }
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
  return self;
}
