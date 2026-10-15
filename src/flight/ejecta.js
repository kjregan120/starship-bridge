// ejecta.js — coronal mass ejections: clouds of plasma thrown off by an
// erupting loop (flareLoops.js) that keep travelling long after the flare.
//
// One shared pool for every star, not one per star: a cloud outlives the
// flare and outruns the star's render range, so it can't live in StarMesh.
// Each cloud is an instance of the same particle set, laid out the way a
// real CME looks side-on — a bright curved leading front, a dark cavity
// behind it, a denser red core, and stringy legs trailing back toward the
// star. Every particle's path is a straight line out of a cone, so the
// whole shape is placed in the vertex shader from launch time alone; the
// only per-frame CPU work is two uniforms.
//
// Clouds are launched in absolute world coordinates and drawn relative to
// the ship (floating origin), so they stay put while you fly through them.
//
// Times are on ejectaClock(), not a Canvas clock: a Canvas's clock restarts
// whenever the view is remounted, and a cloud keeps travelling — and can
// still hit the ship (universe/cme.js, checked in loop.js) — while you're
// looking at another station.
import * as THREE from "three";

const T0 = performance.now();
export const ejectaClock = () => (performance.now() - T0) / 1000;

const SLOTS = 8;          // clouds alive at once; the oldest is reused
const PARTICLES = 3000;   // per cloud
export const EJECTA_LIFE = 120;   // seconds a cloud lasts

const vertex = /* glsl */ `
attribute vec2 aCone;    // fraction of the cone's half-angle, azimuth
attribute vec3 aPart;    // speed factor (1 = leading front), kind (0 front, 1 core, 2 legs), seed
attribute vec3 aOrigin;  // launch point, absolute world space
attribute vec3 aDir;     // launch direction, unit
attribute vec4 aLaunch;  // launch time, speed (u/s), cone half-angle, star radius
attribute vec3 aColor;
uniform float uTime;
uniform vec3 uShip;      // ship position: everything is drawn relative to it
uniform float uPxScale;  // viewport height / (2 tan(fov/2))
varying vec3 vColor;
varying float vAlpha;

void main(){
  float age = uTime - aLaunch.x;
  if (age <= 0.0 || age >= ${EJECTA_LIFE.toFixed(1)}) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; return; }

  vec3 d = aDir;
  vec3 e1 = normalize(cross(d, abs(d.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(d, e1);
  float th = aCone.x * aLaunch.z;
  vec3 pdir = cos(th) * d + sin(th) * (cos(aCone.y) * e1 + sin(aCone.y) * e2);

  // Accelerates away from rest at the torn apex over the first couple of
  // seconds, then coasts.
  const float tau = 2.0;
  float s = aLaunch.y * (age - tau * (1.0 - exp(-age / tau)));
  float reach = s * aPart.x;
  // A little churn, growing with the cloud, so it isn't a perfect cone.
  float seed = aPart.z;
  vec3 churn = (e1 * sin(seed * 6.1 + age * 0.35) + e2 * cos(seed * 4.3 + age * 0.3) + d * sin(seed * 2.7 + age * 0.25))
             * reach * 0.045;
  vec3 world = aOrigin + pdir * reach + churn;

  vec4 mv = viewMatrix * vec4(world - uShip, 1.0);
  float R = aLaunch.w;
  float worldSize = 0.14 * R + 0.045 * reach;
  float px = worldSize * uPxScale / max(-mv.z, 1e-3);
  gl_PointSize = clamp(px, 1.5, 48.0);

  float kind = aPart.y;
  float base = kind < 0.5 ? 1.0 : (kind < 1.5 ? 1.3 : 0.45);
  // Thinning out as it spreads, a quick fade-in at launch, a long fade at the end.
  // Dim while still packed tight at the star, or the overlap blows out white.
  float dilute = (0.3 + 0.7 * smoothstep(0.0, 4.0 * R, reach)) / (1.0 + reach / (10.0 * R));
  float life = smoothstep(0.0, 1.5, age) * (1.0 - smoothstep(${(EJECTA_LIFE * 0.6).toFixed(1)}, ${EJECTA_LIFE.toFixed(1)}, age));
  // A sprite clamped up to the minimum size would add light it doesn't have.
  float shrink = min(1.0, px / 1.5);
  // Flying through a cloud: sprites near the camera are huge, flat discs.
  // Fade those, and anything drawn very large, so being inside reads as haze.
  float near = smoothstep(1.0 * R, 8.0 * R, -mv.z) * (1.0 - 0.75 * smoothstep(10.0, 40.0, px));
  vAlpha = base * dilute * life * shrink * shrink * near * (0.7 + 0.3 * sin(seed * 11.0 + age * 1.3));

  vec3 white = mix(aColor, vec3(1.0), 0.55);
  vec3 red = pow(aColor, vec3(2.0)) * vec3(1.0, 0.45, 0.25) * 1.6;
  vColor = kind < 0.5 ? white : (kind < 1.5 ? red : aColor * 0.9);
  gl_Position = projectionMatrix * mv;
}
`;

const fragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float soft = exp(-r2 * 3.5);
  gl_FragColor = vec4(vColor * vAlpha * soft * 0.09, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// The particle layout shared by every cloud.
function cloudParticles() {
  const cone = new Float32Array(PARTICLES * 2);
  const part = new Float32Array(PARTICLES * 3);
  for (let i = 0; i < PARTICLES; i++) {
    const r = Math.random();
    let q, sf, kind;
    if (r < 0.6) {
      // Leading front: spread over the whole cap, the flanks lagging the
      // nose so the front bulges forward like a bubble; half crowd the rim,
      // which seen side-on is the bright loop at the head of a CME.
      q = Math.random() < 0.5 ? 1 - 0.3 * Math.random() ** 2 : Math.sqrt(Math.random());
      sf = (0.9 + 0.1 * Math.random()) * (1 - 0.3 * q * q);
      kind = 0;
    } else if (r < 0.75) {
      // Core: a dense knot well behind the front, near the axis.
      q = 0.35 * Math.sqrt(Math.random());
      sf = 0.42 + 0.16 * Math.random();
      kind = 1;
    } else {
      // Legs: strung along the cone's flanks back toward the star.
      q = 0.75 + 0.25 * Math.random();
      sf = 0.05 + 0.75 * Math.random();
      kind = 2;
    }
    cone[i * 2] = q;
    cone[i * 2 + 1] = Math.random() * Math.PI * 2;
    part[i * 3] = sf;
    part[i * 3 + 1] = kind;
    part[i * 3 + 2] = Math.random() * 100;
  }
  const g = new THREE.InstancedBufferGeometry();
  // three wants a position attribute to know how many vertices to draw.
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
  g.setAttribute("aCone", new THREE.BufferAttribute(cone, 2));
  g.setAttribute("aPart", new THREE.BufferAttribute(part, 3));
  return g;
}

function makeEjecta() {
  const geometry = cloudParticles();
  const origin = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 3), 3);
  const dir = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 3), 3);
  const launch = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 4).fill(-1e9), 4);
  const color = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 3), 3);
  geometry.setAttribute("aOrigin", origin);
  geometry.setAttribute("aDir", dir);
  geometry.setAttribute("aLaunch", launch);
  geometry.setAttribute("aColor", color);
  geometry.instanceCount = SLOTS;

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uShip: { value: new THREE.Vector3() }, uPxScale: { value: 500 } },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const _col = new THREE.Color();
  // Live clouds, in launch order, for anything that wants to know where they are.
  const clouds = [];

  return {
    geometry,
    material,
    clouds,
    // `t`: launch time (ejectaClock); `at`: launch point, absolute world
    // [x,y,z]; `d`: unit direction (Vector3); `radius`: the star's; `cone`:
    // half-angle (rad); `speed`: u/s; `source`: the star's name.
    launch({ t, at, d, radius, cone, speed, color: hex, source }) {
      let slot = 0;
      for (let i = 1; i < SLOTS; i++) if (launch.getX(i) < launch.getX(slot)) slot = i;
      origin.setXYZ(slot, at[0], at[1], at[2]);
      dir.setXYZ(slot, d.x, d.y, d.z);
      launch.setXYZW(slot, t, speed, cone, radius);
      _col.set(hex || "#ffffff");
      color.setXYZ(slot, _col.r, _col.g, _col.b);
      origin.needsUpdate = dir.needsUpdate = launch.needsUpdate = color.needsUpdate = true;
      clouds.push({ at: [...at], d: [d.x, d.y, d.z], t0: t, speed, cone, radius, source });
      if (clouds.length > SLOTS) clouds.shift();
    },
    tick(t, ship, pxScale) {
      material.uniforms.uTime.value = t;
      material.uniforms.uShip.value.set(ship[0], ship[1], ship[2]);
      material.uniforms.uPxScale.value = pxScale;
      this.prune(t);
    },
    prune(t) {
      while (clouds.length && t - clouds[0].t0 > EJECTA_LIFE) clouds.shift();
    },
  };
}

export const ejecta = makeEjecta();
