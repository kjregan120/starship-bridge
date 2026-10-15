// eruptions.js — volcanoes on a lava moon throwing molten rock into the sky.
//
// Each vent sits at a fixed spot on the surface (from the body's seed) and
// erupts every few seconds: a burst of glowing blobs flung up and out, which
// arc under the moon's gravity and fall back, cooling from yellow-white to
// dull red as they go. A burst also flares the vent's caldera and lava
// rivers — `heat` is read by the surface shader (planetShader.js KIND_LAVA).
//
// Everything is in the body's object space, and the points are parented to
// the spinning surface mesh (Scene.jsx), so the lava stays over its volcano.
import * as THREE from "three";

const MAX = 700;                 // live blobs, all vents together
const GRAVITY = 1.3;             // × radius, per second²
const SPEED = [0.9, 1.45];       // launch speed, × radius per second
const INTERVAL = [2.5, 6];       // seconds between bursts per vent
const BURST = [35, 70];          // blobs per burst

const frac = (x) => x - Math.floor(x);

const vertex = /* glsl */ `
attribute float aLife;           // 0 just thrown .. 1 gone; <0 unused
attribute float aSize;
uniform float uViewH;
varying float vLife;
void main(){
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aSize * projectionMatrix[1][1] * uViewH * 0.5 / max(0.001, -mv.z);
  gl_PointSize = aLife < 0.0 ? 0.0 : clamp(px * (1.0 - 0.5 * aLife), 1.5, 48.0);
}
`;
const fragment = /* glsl */ `
varying float vLife;
void main(){
  if (vLife < 0.0) discard;
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float core = smoothstep(1.0, 0.0, r);
  // Cooling: yellow-white, orange, then a dull red ember before it fades.
  vec3 hot = vec3(1.0, 0.9, 0.55), warm = vec3(1.0, 0.42, 0.05), cool = vec3(0.6, 0.06, 0.0);
  vec3 col = vLife < 0.35 ? mix(hot, warm, vLife / 0.35) : mix(warm, cool, (vLife - 0.35) / 0.65);
  float fade = 1.0 - smoothstep(0.75, 1.0, vLife);
  gl_FragColor = vec4(col * core * fade * 1.6, 1.0);
}
`;

// `r`: body radius. `seed`: the body's seedFor() vector. `count`: vents.
export function makeEruptions(r, seed, count = 2) {
  // Vents spread around the moon, away from the poles, placed by the seed.
  const vents = [];
  for (let i = 0; i < count; i++) {
    const lon = seed.x * 1.7 + (i * 2 * Math.PI) / count + 0.6 * frac(seed.y * (i + 1) * 0.37);
    const lat = (frac(seed.z * (i + 2) * 0.29) - 0.5) * 1.1;
    vents.push(new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).normalize());
  }
  const heat = vents.map(() => 0);
  const nextBurst = vents.map((_, i) => 0.8 + i * 1.7);

  const pos = new Float32Array(MAX * 3), life = new Float32Array(MAX).fill(-1), size = new Float32Array(MAX);
  const vel = new Float32Array(MAX * 3), ttl = new Float32Array(MAX), age = new Float32Array(MAX);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aLife", new THREE.BufferAttribute(life, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uViewH: { value: 800 } },
    vertexShader: vertex, fragmentShader: fragment,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;

  let cursor = 0, last = null;
  const rand = (a, b) => a + Math.random() * (b - a);
  const tmpT = new THREE.Vector3(), tmpB = new THREE.Vector3();

  function burst(v) {
    const n = Math.floor(rand(...BURST));
    tmpT.set(0, 1, 0).cross(v);
    if (tmpT.lengthSq() < 1e-4) tmpT.set(1, 0, 0).cross(v);
    tmpT.normalize(); tmpB.copy(v).cross(tmpT);
    for (let k = 0; k < n; k++) {
      const i = cursor; cursor = (cursor + 1) % MAX;
      const sp = rand(...SPEED) * r * (0.6 + 0.4 * Math.random());
      // A fountain: mostly up, spraying out in every direction around the vent.
      const a = Math.random() * Math.PI * 2, spread = Math.random() * 0.55;
      const dx = Math.cos(a) * spread, dy = Math.sin(a) * spread;
      for (let c = 0; c < 3; c++) {
        const dir = v.getComponent(c) + tmpT.getComponent(c) * dx + tmpB.getComponent(c) * dy;
        pos[i * 3 + c] = v.getComponent(c) * r * 1.03;
        vel[i * 3 + c] = dir * sp;
      }
      ttl[i] = rand(1.6, 3.0); age[i] = 0;
      life[i] = 0;
      size[i] = r * rand(0.025, 0.06);
    }
  }

  return {
    vents, heat, points,
    // `t`: the scene clock (s). Steps the blobs and fires bursts when due.
    update(t) {
      const dt = last == null ? 0 : Math.min(0.1, Math.max(0, t - last));
      last = t;
      material.uniforms.uViewH.value = (typeof window !== "undefined" ? window.innerHeight * (window.devicePixelRatio || 1) : 800);
      vents.forEach((v, i) => {
        heat[i] = Math.max(0, heat[i] - dt * 0.7);
        if (t >= nextBurst[i]) {
          burst(v);
          heat[i] = 1;
          nextBurst[i] = t + rand(...INTERVAL);
        }
      });
      if (!dt) return;
      for (let i = 0; i < MAX; i++) {
        if (life[i] < 0) continue;
        age[i] += dt;
        if (age[i] >= ttl[i]) { life[i] = -1; continue; }
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const d = Math.hypot(x, y, z);
        // Fell back to the surface: it's lava again.
        if (age[i] > 0.2 && d < r * 1.0) { life[i] = -1; continue; }
        const g = (GRAVITY * r * dt) / d;
        vel[i * 3] -= x * g; vel[i * 3 + 1] -= y * g; vel[i * 3 + 2] -= z * g;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        life[i] = age[i] / ttl[i];
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aLife.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
    },
    dispose() { geo.dispose(); material.dispose(); },
  };
}
