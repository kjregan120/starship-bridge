// planetShader.js — procedural surfaces for planets and moons.
//
// Every body is a MeshStandardMaterial with its diffuse colour, roughness and
// bump replaced by noise (onBeforeCompile), so the star's point light still
// does the lighting: terminator, night side and ocean glint come for free.
// Terrain is shading only — height drives a bump-perturbed normal so light
// catches ridges and crater rims; the sphere itself stays a sphere.
//
// One surface "kind" per body (universe.json `kind`; moons are all airless
// and cratered). Each compiles as its own program via a define. Variety
// within a kind comes from the body's id seed (pattern offset, palette
// jitter, which worlds get storms or rings).
//
// Extras per kind, built by makePlanetParts():
//   clouds      — class-M / ocean: a drifting cloud shell with cyclones
//   atmosphere  — additive limb glow, lit side only (same ray trick as the
//                 star corona in starShader.js)
//   rings       — some gas giants, with the planet's shadow cast across them
//   eruptions   — lava moons: volcanoes throwing glowing lava into the sky
//                 (eruptions.js), which also flare the calderas
//   glow        — any body with `glow` set: a faint self-light in its own colour
//   aurora      — any body with `aurora` set in universe.json: glowing
//                 curtains around both poles ("rainbow" is the only style)
import * as THREE from "three";
import { SIMPLEX, seedFor } from "./starShader.js";
import { MAX_STRIKES, FLICKER_GLSL, hasLightning, activeStrikes, lightningClock } from "./lightning.js";
import { makeEruptions } from "./eruptions.js";

const KIND_DEFINE = {
  "gas giant": "KIND_GAS",
  "class-M": "KIND_TERRA",
  ocean: "KIND_OCEAN",
  desert: "KIND_DESERT",
  ice: "KIND_ICE",
  toxic: "KIND_TOXIC",
  rocky: "KIND_ROCKY",
  "moon-cratered": "KIND_MOON",
  "moon-icy": "KIND_ICE",          // + ICY_MOON: craters punched through the ice
  "moon-volcanic": "KIND_VOLCANIC",
  "moon-lava": "KIND_LAVA",         // dark crust, glowing seams, erupting volcanoes
};

const ATMOSPHERE = {
  "gas giant": { color: null, extent: 1.12, strength: 0.9 },   // null → body colour
  "class-M": { color: "#6fa8ff", extent: 1.1, strength: 1.2 },
  ocean: { color: "#6fa8ff", extent: 1.1, strength: 1.3 },
  toxic: { color: "#d8e070", extent: 1.14, strength: 1.1 },
  desert: { color: "#e8b884", extent: 1.06, strength: 0.6 },
};

// GLSL helpers available to every planet program (after three's <common>).
// Vertex-safe: the displacement pass in the vertex shader uses these too.
const NOISE_HELPERS = /* glsl */ `
${SIMPLEX}
vec3 plRotY(vec3 p, float a){ float c=cos(a), s=sin(a); return vec3(p.x*c - p.z*s, p.y, p.x*s + p.z*c); }
// Rodrigues rotation of p about unit axis k.
vec3 plRotAxis(vec3 p, vec3 k, float a){ float c=cos(a), s=sin(a); return p*c + cross(k,p)*s + k*dot(k,p)*(1.0-c); }
vec3 plHash3(vec3 p){
  p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6)));
  return fract(sin(p)*43758.5453);
}
float plRidged(vec3 p){ return pow(1.0 - abs(fbm3(p)), 3.0); }
// Crater field: one candidate crater per 3D cell; bowl below zero, a raised
// rim just outside the bowl's edge. Returns height roughly in [-0.6, 0.3].
float plCraters(vec3 p, float freq, float salt){
  vec3 q = p*freq;
  vec3 i = floor(q);
  float h = 0.0;
  for (int x=-1; x<=1; x++) for (int y=-1; y<=1; y++) for (int z=-1; z<=1; z++){
    vec3 c = i + vec3(x,y,z);
    vec3 r = plHash3(c + salt);
    if (r.x > 0.55) continue;                 // most cells are empty
    vec3 ctr = c + plHash3(c + salt + 17.0);
    float rad = 0.2 + 0.35*r.y;
    float d = length(q - ctr) / rad;
    if (d < 1.0) h += (d*d - 1.0) * 0.6;
    h += 0.3 * exp(-pow((d - 1.0) * 5.0, 2.0));
  }
  return h;
}
// Bounded-shear flow: sample f at two time phases offset by half a period
// and crossfade, so differential rotation never winds the pattern into
// ever-finer streaks (each phase resets while it's faded out).
#define PL_FLOW(OUT, P, SPEED, PERIOD, EXPR) { \
  float ph0 = fract(uTime / PERIOD), ph1 = fract(uTime / PERIOD + 0.5); \
  vec3 q0 = plRotY(P, SPEED * ph0 * PERIOD); vec3 q1 = plRotY(P, SPEED * ph1 * PERIOD); \
  float a0, a1; { vec3 q = q0; a0 = EXPR; } { vec3 q = q1; a1 = EXPR; } \
  OUT = mix(a1, a0, 1.0 - abs(2.0*ph0 - 1.0)); }
`;

// Fragment-only (screen-space derivatives).
const HELPERS = /* glsl */ `
${NOISE_HELPERS}
// Copy of three's perturbNormalArb (bumpmap_pars_fragment), renamed so it
// can't collide if a bump map is ever enabled.
vec3 plPerturbNormal(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir){
  vec3 vSigmaX = normalize(dFdx(surf_pos));
  vec3 vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

// The surface itself: sets plCol (linear diffuse), plH (bump height),
// plRough. `p` is the unit object-space position.
const SURFACE = /* glsl */ `
vec3 plCol = uBase; float plH = 0.0; float plRough = 0.9;
vec3 plEmit = vec3(0.0);   // self-lit: city lights, lava, lightning
// 1 on the night side, 0 in daylight — emissive features mostly show there.
float plNight = smoothstep(0.05, -0.2, dot(normalize(vNormal), normalize((viewMatrix * vec4(uSun - uCenter, 0.0)).xyz)));
// 1 when the surface is big on screen, 0 when a pixel spans a large patch of
// it — fine detail and bump fade out instead of aliasing into static.
float plDetail = 1.0 - smoothstep(0.015, 0.06, length(fwidth(normalize(vObjPos))));
{ // scoped so these locals can't collide with names three declares later in main()
vec3 p = normalize(vObjPos);
vec3 sp = p + uSeed;

#if defined(KIND_GAS)
  float speed = 0.06 * sin(p.y * 7.0 + uSeed.x);
  float bandFreq = 12.0 + mod(uSeed.y, 10.0);
  float band;
  PL_FLOW(band, p, speed, 60.0,
    sin(q.y * bandFreq + 2.2*fbm3(q*vec3(2.0,7.0,2.0) + uSeed) + 0.8*fbm3(q*3.0 + uSeed.zxy)));
  float turb;
  PL_FLOW(turb, p, speed, 60.0, fbm(q*vec3(5.0,12.0,5.0) + uSeed));
  vec3 zone = mix(uBase, vec3(1.0, 0.97, 0.9), 0.35);
  vec3 belt = uBase * vec3(0.62, 0.48, 0.38);
  plCol = mix(belt, zone, smoothstep(-0.7, 0.7, band + 0.6*turb));
  plCol = mix(plCol, zone * 1.15, smoothstep(0.25, 0.6, turb) * 0.5);
  plCol *= mix(1.0, 0.65, smoothstep(0.7, 1.0, abs(p.y)));      // darker poles
  // Great storm on ~60% of giants: an oval vortex spinning in its own frame,
  // drifting with its latitude's wind.
  if (fract(uSeed.z * 0.173) < 0.6) {
    float sLat = -0.2 - 0.25 * fract(uSeed.x * 0.37);
    float sLon = uSeed.x + 0.06 * sin(sLat * 7.0 + uSeed.x) * uTime;
    vec3 c = normalize(vec3(cos(sLon) * sqrt(1.0 - sLat*sLat), sLat, sin(sLon) * sqrt(1.0 - sLat*sLat)));
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), c));
    vec3 north = cross(c, east);
    vec3 d = p - c;
    vec2 uv = vec2(dot(d, east) / 0.26, dot(d, north) / 0.15);
    float r = length(uv);
    if (r < 1.6) {
      float a = 3.0 * exp(-r*r*1.8) + uTime * 0.25;
      vec2 w = mat2(cos(a), -sin(a), sin(a), cos(a)) * uv;
      float sn = fbm3(vec3(w * 2.5, uSeed.z));
      vec3 spotCol = mix(uBase * vec3(1.25, 0.55, 0.35), vec3(1.0, 0.85, 0.7), 0.35 + 0.4*sn);
      float swirl = sin(r * 9.0 - atan(w.y, w.x) * 2.0 + sn * 3.0) * 0.5 + 0.5;
      spotCol *= 0.85 + 0.3 * swirl;
      plCol = mix(plCol, zone * 1.1, smoothstep(1.4, 1.05, r) * 0.6);   // pale collar
      plCol = mix(plCol, spotCol, smoothstep(1.0, 0.7, r));
    }
  }
  plH = 0.02 * band;
  plRough = 0.95;

#elif defined(KIND_TERRA) || defined(KIND_OCEAN)
  #if defined(KIND_OCEAN)
    float sea = 0.33;
    vec3 deep = uBase * 0.35, shallow = uBase * 0.9 + vec3(0.0, 0.08, 0.06);
  #else
    float sea = 0.04;
    vec3 deep = vec3(0.01, 0.04, 0.14), shallow = vec3(0.03, 0.16, 0.28);
  #endif
  float e = fbm(sp * 1.6) + 0.35 * plRidged(sp * 3.0) - 0.15;
  float lat = abs(p.y);
  float capEdge = 0.83 + 0.06 * fbm3(sp * 4.0);
  if (e < sea) {
    float depth = sea - e;
    plCol = mix(shallow, deep, smoothstep(0.0, 0.22, depth));
    plRough = 0.22;
  } else {
    float t = e - sea;
    float moist = fbm3(sp.zxy * 2.5);
    float temp = 1.0 - lat * 1.15 - t * 1.4 + 0.15 * fbm3(sp * 5.0);
    vec3 sand = vec3(0.55, 0.47, 0.32), green = vec3(0.07, 0.2, 0.05);
    vec3 dry = vec3(0.32, 0.26, 0.14), rock = vec3(0.2, 0.17, 0.15);
    plCol = mix(dry, green, smoothstep(-0.3, 0.1, moist));
    plCol = mix(plCol, sand, smoothstep(0.03, 0.0, t));
    plCol = mix(plCol, rock, smoothstep(0.18, 0.4, t));
    plCol = mix(plCol, vec3(0.9), smoothstep(0.15, 0.0, temp));
    // Ridges ramp in from the coast so height has no step at sea level.
    plH = t + 0.15 * plRidged(sp * 4.0) * smoothstep(0.0, 0.06, t);
    plRough = 0.88;
    #ifdef HAS_CITIES
      // Cities cluster on temperate lowland near the coast. Up close they're
      // sparkling clusters; from afar they average into a soft glow rather
      // than aliasing.
      // A low-frequency "populated region" mask clumps them into metro areas
      // with a faint sprawl glow, instead of an even dusting.
      float settle = smoothstep(0.25, 0.0, t) * smoothstep(0.05, 0.35, temp);
      float region = smoothstep(0.05, 0.35, fbm3(sp.yzx * 3.0));
      float cn = 0.6 * snoise(sp * 22.0) + 0.4 * snoise(sp * 55.0);
      float metro = settle * region;
      float lights = mix(metro * 0.2, smoothstep(0.3, 0.75, cn) * metro * 1.6 + metro * 0.12, plDetail);
      plEmit += vec3(1.0, 0.72, 0.38) * lights * plNight * 1.2;
    #endif
  }
  if (lat > capEdge) { plCol = vec3(0.92, 0.95, 1.0); plRough = 0.5; plEmit = vec3(0.0); }

#elif defined(KIND_DESERT)
  float mtn = plRidged(sp * 2.6);
  vec3 dd = normalize(vec3(1.0, 0.3, 0.6));
  float dune = sin(dot(p, dd) * 70.0 + fbm3(sp * 4.0) * 8.0) * 0.5 + 0.5;
  plCol = mix(uBase * 1.05, uBase * vec3(0.62, 0.48, 0.4), mtn);
  plCol *= 0.92 + 0.12 * dune * (1.0 - mtn);
  plCol *= 0.85 + 0.25 * fbm3(sp * 8.0);
  plH = 0.7 * mtn + 0.05 * dune * (1.0 - mtn) + 0.25 * plCraters(p, 5.0, uSeed.x);
  plCol = mix(plCol, vec3(0.9, 0.88, 0.85), smoothstep(0.9, 0.95, abs(p.y) + 0.04 * fbm3(sp * 6.0)) * 0.8);
  // Slow dust storms sweeping across, softening the terrain under them.
  float dust = smoothstep(0.25, 0.65, fbm3(plRotY(p, uTime * 0.02) * 2.0 + uSeed.zxy));
  plCol = mix(plCol, mix(uBase, vec3(1.0, 0.85, 0.65), 0.35), dust * 0.6);
  plH *= 1.0 - 0.7 * dust;
  plRough = 0.95;

#elif defined(KIND_ICE)
  vec3 ice = mix(vec3(0.82, 0.9, 1.0), uBase, 0.45);
  float crack = pow(1.0 - abs(snoise(sp * 2.5)), 22.0) + 0.7 * pow(1.0 - abs(snoise(sp.yzx * 6.0)), 30.0);
  float chaos = smoothstep(0.35, 0.6, fbm3(sp * 3.0));            // jumbled terrain patches
  plCol = ice * (0.9 + 0.15 * fbm(sp * 6.0));
  plCol = mix(plCol, vec3(0.45, 0.28, 0.18), clamp(crack, 0.0, 1.0) * 0.75);
  plCol = mix(plCol, ice * vec3(0.8, 0.78, 0.8), chaos * 0.5);
  // Bump from a softer, wider groove: the razor-thin colour line would give
  // screen-space derivatives that dot along every crack.
  float groove = pow(1.0 - abs(snoise(sp * 2.5)), 6.0);
  plH = -0.15 * groove + 0.1 * chaos * fbm3(sp * 8.0);
  plRough = 0.3 + 0.4 * chaos;
  #ifdef ICY_MOON
    // Impacts punch through to fresh, brighter ice.
    float icr = plCraters(p, 5.0, uSeed.x);
    plH += 0.35 * icr;
    plCol *= 1.0 + 0.2 * smoothstep(0.0, -0.4, icr);
  #endif

#elif defined(KIND_TOXIC)
  float speed = 0.04 * cos(p.y * 4.0);
  float cloud;
  PL_FLOW(cloud, p, speed, 80.0,
    fbm(q * 2.0 + 1.6 * vec3(fbm3(q * 1.5 + uSeed), fbm3(q * 1.5 + uSeed.zxy), 0.0) + uSeed));
  float bands = sin(p.y * 6.0 + cloud * 4.0);
  plCol = mix(uBase * vec3(0.5, 0.55, 0.3), mix(uBase, vec3(1.0, 1.0, 0.7), 0.45), smoothstep(-0.8, 0.8, cloud * 1.6 + 0.3 * bands));
  plH = 0.03 * cloud;
  plRough = 1.0;
  // Lightning: strikes come from lightning.js (shared with the comms audio,
  // so each flash has its crack) — a decaying, stuttering blue-white blob
  // that lights the cloud deck from inside. Dim by day, vivid at night.
  #ifdef HAS_LIGHTNING
  for (int i = 0; i < ${MAX_STRIKES}; i++) {
    if (uStrike[i].w <= 0.0) continue;
    float ld = 3.5 * length(p - uStrike[i].xyz);
    float tt = uStrikeT[i].x, ph = uStrikeT[i].y;
    float flick = ${FLICKER_GLSL};
    float glow = exp(-ld * ld * 45.0) + 0.6 * exp(-ld * ld * 300.0);   // diffuse halo + bright core
    float lit = 0.4 + 0.6 * smoothstep(-0.4, 0.6, fbm3(sp * 14.0 + uTime)); // lights the cloud texture unevenly
    plEmit += vec3(0.7, 0.8, 1.0) * glow * lit * flick * uStrike[i].w * mix(0.3, 2.2, plNight);
  }
  #endif

#elif defined(KIND_VOLCANIC)
  // Io: sulfur plains in yellow, white and orange; dark calderas ringed by
  // red plume fallout, with lava glowing (and flickering) in their floors.
  float tone = fbm(sp * 3.0);
  plCol = mix(uBase * vec3(1.0, 0.85, 0.45), vec3(0.95, 0.92, 0.75), smoothstep(0.0, 0.5, tone));
  plCol = mix(plCol, uBase * vec3(0.9, 0.5, 0.25), smoothstep(0.1, 0.4, fbm3(sp.zxy * 2.0)) * 0.6);
  plH = 0.1 * fbm3(sp * 4.0);
  float lava = 0.0;
  vec3 vq = p * 5.0, vi = floor(vq);
  for (int x=-1; x<=1; x++) for (int y=-1; y<=1; y++) for (int z=-1; z<=1; z++){
    vec3 c = vi + vec3(x,y,z);
    vec3 r = plHash3(c + uSeed.x);
    if (r.x > 0.35) continue;
    vec3 ctr = c + 0.2 + 0.6 * plHash3(c + uSeed.y);
    float d = length(vq - ctr) / (0.12 + 0.12 * r.y);
    plCol = mix(plCol, uBase * vec3(0.85, 0.3, 0.12), exp(-pow((d - 2.2) * 1.2, 2.0)) * 0.6);
    plCol = mix(plCol, vec3(0.05, 0.04, 0.03), smoothstep(1.0, 0.7, d));
    plH -= 0.4 * smoothstep(1.2, 0.8, d);
    lava += smoothstep(0.9, 0.4, d) * (0.6 + 0.4 * sin(uTime * (1.5 + 2.0 * r.z) + r.y * 30.0));
  }
  plEmit += vec3(1.0, 0.35, 0.08) * lava * mix(0.6, 1.6, plNight);
  plRough = 0.9;

#elif defined(KIND_LAVA)
  // Dark basalt crust cracked into plates, molten rock glowing in the seams,
  // and a few volcanoes: cones with glowing calderas and lava running down
  // their flanks, flaring when they erupt (uVentHeat, from the eruptions).
  float plate = fbm(sp * 3.0);
  plCol = uBase * (0.55 + 0.6 * plate);
  plCol *= 1.0 + 0.25 * clamp(plCraters(p, 6.0, uSeed.x), -0.6, 0.3);
  float s1 = pow(1.0 - abs(snoise(sp * 2.2)), 16.0);
  float s2 = pow(1.0 - abs(snoise(sp.yzx * 5.0 + 3.0)), 30.0);
  float flow = 0.6 + 0.4 * fbm3(sp * 7.0 + vec3(0.0, uTime * 0.08, 0.0));
  float seam = clamp(s1 + 0.35 * s2, 0.0, 1.0) * flow;
  plH = 0.25 * plate - 0.3 * seam;
  float heat = seam;
  for (int i = 0; i < VENTS; i++) {
    vec3 v = uVents[i];
    float d = length(p - v) / 0.16;
    vec3 t1 = normalize(cross(v, abs(v.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    float ang = atan(dot(p, cross(v, t1)), dot(p, t1));
    float cone = exp(-d * d * 1.2), caldera = exp(-d * d * 12.0);
    plH += 0.9 * cone - 0.7 * caldera;
    plCol = mix(plCol, uBase * 0.5, cone * 0.6);                    // fresh black flows on the flanks
    // Rivers of lava down the flanks, longer while it's erupting.
    float river = pow(1.0 - abs(snoise(vec3(ang * 2.5, d * 0.8 - uTime * 0.1, float(i) * 7.0))), 14.0);
    heat += river * smoothstep(1.6 + uVentHeat[i], 0.25, d) * (0.7 + 0.6 * uVentHeat[i]);
    heat += caldera * (1.4 + 2.5 * uVentHeat[i]);
  }
  heat = clamp(heat, 0.0, 3.0);
  // Molten colour: deep red where it's cooling, orange, yellow-white at the hottest.
  vec3 molten = mix(vec3(0.5, 0.04, 0.0), vec3(1.0, 0.35, 0.03), smoothstep(0.1, 0.7, heat));
  molten = mix(molten, vec3(1.0, 0.85, 0.45), smoothstep(1.2, 2.6, heat));
  plCol = mix(plCol, vec3(0.12, 0.03, 0.01), smoothstep(0.05, 0.4, heat));   // the crust at the edges is scorched
  plEmit += molten * heat * mix(1.1, 1.8, plNight);
  plRough = 0.95;

#elif defined(KIND_ROCKY) || defined(KIND_MOON)
  float cr = plCraters(p, 4.0, uSeed.x) + 0.5 * plCraters(p, 9.0, uSeed.y);
  if (plDetail > 0.0) cr += 0.25 * plDetail * plCraters(p, 19.0, uSeed.z);
  #if defined(KIND_MOON)
    float maria = smoothstep(0.05, 0.3, fbm3(sp * 1.4));          // dark lava plains
  #else
    float maria = 0.0;
  #endif
  float rid = plRidged(sp * 3.5);
  plH = cr * (1.0 - 0.7 * maria) + 0.35 * rid + 0.15 * fbm(sp * 6.0);
  plCol = uBase * (0.75 + 0.35 * fbm(sp * 4.0));
  plCol *= mix(1.0, 0.55, maria);
  plCol *= 1.0 + 0.25 * clamp(cr, -0.6, 0.3);                    // shadowed floors, bright rims
  plRough = 0.95;
#endif

#ifdef HAS_GLOW
  // A body that glows faintly in its own colour (universe.json "glow") —
  // keeps its colour on the night side instead of fading to grey.
  plEmit += plCol * uGlow * mix(0.6, 1.0, plNight);
#endif

#ifdef HAS_ATMO
  // Atmosphere seen edge-on tints the limb. Applied to diffuse, so the
  // night side still goes dark.
  float plMu = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
  plCol = mix(plCol, uAtmo, pow(1.0 - plMu, 3.0) * 0.55);
#endif
}
diffuseColor.rgb = plCol;
`;

function jitterColor(hex, seed) {
  // Nudge hue/lightness per body so every world of a kind isn't one colour.
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(
    (hsl.h + ((seed.x % 10) / 10 - 0.5) * 0.06 + 1) % 1,
    Math.min(1, hsl.s * (0.85 + (seed.y % 10) / 30)),
    Math.min(0.9, hsl.l * (0.85 + (seed.z % 10) / 30))
  );
  return c;
}

// Light each body from its own star only. Every star in render range has an
// unlimited-range point light (Scene.jsx StarMesh), and systems sit close
// enough together that a neighbour star would otherwise fill in the night
// side. This swaps three's light loop for one light along body->star (the
// star is far enough away to treat as directional), keeping ambient.
const OWN_SUN_LIGHTING = /* glsl */ `
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
IncidentLight directLight;
directLight.direction = normalize( ( viewMatrix * vec4( uSun - uCenter, 0.0 ) ).xyz );
directLight.color = uSunColor;
directLight.visible = true;
RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
vec3 iblIrradiance = vec3( 0.0 );
vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
vec3 radiance = vec3( 0.0 );
vec3 clearcoatRadiance = vec3( 0.0 );
`;
const LIGHT_UNIFORMS = "uniform vec3 uSun; uniform vec3 uCenter; uniform vec3 uSunColor;";

// Real relief on the silhouette for airless bodies: the vertex is pushed out
// along its normal by a height built from the same crater/ridge functions
// the fragment bump uses, so the outline and the shading agree. vObjPos is
// taken before displacement, so fragment noise lookups don't shift.
const DISPLACE = /* glsl */ `
vObjPos = position;
#ifdef HAS_DISPLACE
{
  vec3 dp = normalize(position);
  #if defined(KIND_VOLCANIC)
    float dh = 0.3 * fbm3(dp * 4.0 + uSeed);
  #elif defined(KIND_LAVA)
    float dh = 0.25 * fbm3(dp * 3.0 + uSeed);
    for (int i = 0; i < VENTS; i++) {
      float d = length(dp - uVents[i]) / 0.16;
      dh += 1.6 * exp(-d * d * 1.2) - 1.1 * exp(-d * d * 12.0);
    }
  #else
    float dh = plCraters(dp, 4.0, uSeed.x) + 0.5 * plCraters(dp, 9.0, uSeed.y);
    #if defined(KIND_ICE)
      dh *= 0.5;
    #else
      dh += 0.2 * plRidged(dp * 3.5 + uSeed);
    #endif
  #endif
  transformed += dp * dh * uDisp;
}
#endif
`;

function surfaceMaterial(kind, uniforms, bump, extraDefines) {
  const def = KIND_DEFINE[kind] || "KIND_ROCKY";
  const hasAtmo = !!ATMOSPHERE[kind];
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.0 });
  mat.defines = { ...mat.defines, [def]: "", ...(hasAtmo ? { HAS_ATMO: "" } : {}), ...extraDefines };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
uniform float uTime; uniform vec3 uSeed; uniform float uDisp;
#ifdef KIND_LAVA
uniform vec3 uVents[VENTS];
#endif
varying vec3 vObjPos;
${NOISE_HELPERS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${DISPLACE}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>",
        `#include <common>
uniform float uTime; uniform vec3 uSeed; uniform vec3 uBase; uniform vec3 uAtmo; uniform float uBump; uniform float uGlow;
#ifdef KIND_LAVA
uniform vec3 uVents[VENTS]; uniform float uVentHeat[VENTS];
#endif
#ifdef HAS_LIGHTNING
uniform vec4 uStrike[${MAX_STRIKES}];   // xyz: unit-sphere position, w: intensity (0 = unused)
uniform vec2 uStrikeT[${MAX_STRIKES}];  // x: age / duration, y: flicker phase
#endif
${LIGHT_UNIFORMS}
varying vec3 vObjPos;
${HELPERS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${SURFACE}`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = plRough;")
      // Bump fades toward the limb: at grazing angles the screen-space height
      // derivatives blow up and the edge breaks into blocky speckle.
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
float plLimb = smoothstep(0.0, 0.35, dot(normal, normalize(vViewPosition)));
normal = plPerturbNormal(-vViewPosition, normal, vec2(dFdx(plH), dFdy(plH)) * uBump * plLimb * mix(0.15, 1.0, plDetail), faceDirection);`)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += plEmit;")
      .replace("#include <lights_fragment_begin>", OWN_SUN_LIGHTING);
  };
  // Every kind shares this onBeforeCompile's source; key the program cache
  // on the kind and its feature defines so three doesn't hand one variant's
  // program to another.
  const key = `planet-${def}-${hasAtmo}-${Object.entries(extraDefines).map(([k, v]) => (v === "" ? k : `${k}=${v}`)).sort().join("-")}`;
  mat.customProgramCacheKey = () => key;
  uniforms.uBump = { value: bump };
  return mat;
}

const cloudFragment = /* glsl */ `
{
vec3 p = normalize(vObjPos);
vec3 q = plRotY(p, uTime * 0.015);
float c = fbm(q * 2.4 + uSeed) + 0.4 * fbm3(q * vec3(3.0, 9.0, 3.0) + uSeed.zxy);
// Cyclones: within each storm's radius the cloud field is sampled in a frame
// that spins rigidly (plus a static spiral twist), then blended back into
// the background — so the spiral turns without winding itself up.
for (int i = 0; i < CYCLONES; i++) {
  float fi = float(i);
  float lat = (fract(uSeed.x * 0.31 + fi * 0.43) < 0.5 ? -1.0 : 1.0) * (0.3 + 0.3 * fract(uSeed.y * 0.17 + fi * 0.29));
  float lon = uSeed.z + fi * 2.4 - uTime * 0.01;
  vec3 ctr = vec3(cos(lon) * sqrt(1.0 - lat*lat), lat, sin(lon) * sqrt(1.0 - lat*lat));
  float r = length(p - ctr);
  float R = 0.22;
  float m = exp(-pow(r / R, 2.0));
  if (m < 0.01) continue;
  float spin = (lat > 0.0 ? 1.0 : -1.0);
  vec3 w = plRotAxis(p, ctr, spin * (5.0 * m + uTime * 0.35));
  float arms = fbm(w * 5.0 + uSeed) + 0.5;
  c = mix(c, arms * 1.1, m);
  c *= smoothstep(0.015, 0.05, r);                                // clear eye
}
float cover = smoothstep(uCoverage, uCoverage + 0.3, c);
diffuseColor = vec4(vec3(1.0), cover * 0.92);
}
`;

function cloudMaterial(uniforms, cyclones) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, transparent: true, depthWrite: false });
  mat.defines = { ...mat.defines, CYCLONES: cyclones };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>",
        `#include <common>\nuniform float uTime; uniform vec3 uSeed; uniform float uCoverage;\n${LIGHT_UNIFORMS}\nvarying vec3 vObjPos;\n${HELPERS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${cloudFragment}`)
      .replace("#include <lights_fragment_begin>", OWN_SUN_LIGHTING);
  };
  mat.customProgramCacheKey = () => `planet-clouds-${cyclones}`;
  return mat;
}

const atmoVertex = /* glsl */ `
varying vec3 vWorldPos;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const atmoFragment = /* glsl */ `
uniform vec3 uColor; uniform vec3 uCenter; uniform vec3 uSun;
uniform float uRadius; uniform float uExtent; uniform float uStrength;
varying vec3 vWorldPos;
void main(){
  vec3 ray = normalize(vWorldPos - cameraPosition);
  vec3 toC = uCenter - cameraPosition;
  float along = dot(toC, ray);
  vec3 closest = cameraPosition + ray * along;
  float d = length(closest - uCenter) / uRadius;
  if (d < 1.0 && along > 0.0) discard;                 // the planet covers this pixel
  float x = clamp((d - 1.0) / (uExtent - 1.0), 0.0, 1.0);
  vec3 dir = normalize(closest - uCenter);
  float lit = smoothstep(-0.35, 0.5, dot(dir, normalize(uSun - uCenter)));
  float glow = exp(-x * 4.0) * (1.0 - x) * lit * uStrength;
  gl_FragColor = vec4(uColor * glow, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const ringVertex = /* glsl */ `
varying vec3 vLocal; varying vec3 vWorldPos; varying vec3 vWorldNormal;
void main(){
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ringFragment = /* glsl */ `
uniform vec3 uColor; uniform vec3 uCenter; uniform vec3 uSun; uniform vec3 uSeed;
uniform float uRadius; uniform float uInner; uniform float uOuter;
varying vec3 vLocal; varying vec3 vWorldPos; varying vec3 vWorldNormal;
${SIMPLEX}
void main(){
  float rr = (length(vLocal.xy) - uInner) / (uOuter - uInner);   // 0 inner edge .. 1 outer
  float bands = 0.5 + 0.35 * snoise(vec3(rr * 30.0, uSeed.x, 0.0)) + 0.2 * snoise(vec3(rr * 110.0, uSeed.y, 0.0));
  float gapAt = 0.55 + 0.2 * fract(uSeed.z * 0.13);
  float gap = smoothstep(0.0, 0.035, abs(rr - gapAt));          // a Cassini-style division
  float alpha = smoothstep(0.0, 0.06, rr) * smoothstep(1.0, 0.85, rr) * clamp(bands, 0.0, 1.0) * gap * 0.85;
  vec3 col = mix(uColor * 0.7, mix(uColor, vec3(1.0, 0.96, 0.88), 0.5), bands);
  // Planet's shadow: does the ray from here toward the sun hit the sphere?
  vec3 toSun = normalize(uSun - vWorldPos);
  vec3 oc = vWorldPos - uCenter;
  float b = dot(oc, toSun), c = dot(oc, oc) - uRadius * uRadius;
  float shadow = (b < 0.0 && b*b - c > 0.0) ? 0.12 : 1.0;
  float lit = 0.35 + 0.65 * abs(dot(vWorldNormal, toSun));
  gl_FragColor = vec4(col * lit * shadow, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---- aurora -------------------------------------------------------------------
// Curtains of light around both magnetic poles. The shell is drawn back-face
// only, with no depth test, and each pixel marches its view ray through the
// space just above the surface (1.03–1.6 radii), stopping where the ray
// hits the body — so the curtains show over the disc as well as standing
// up off the limb. Each curtain is a thin band of latitude that wanders
// with longitude and time, bright at its foot and fading with height,
// streaked along its length; the colour runs through the rainbow along
// the oval and climbs with altitude. Brightest on the night side.
const auroraVertex = atmoVertex;
const auroraFragment = /* glsl */ `
uniform vec3 uCenter; uniform vec3 uSun; uniform vec3 uAxis;
uniform float uRadius; uniform float uTime;
varying vec3 vWorldPos;
${SIMPLEX}
vec3 auHue(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main(){
  const float TOP = 1.6, FOOT = 1.03;
  vec3 ray = normalize(vWorldPos - cameraPosition);
  vec3 oc = cameraPosition - uCenter;
  float b = dot(oc, ray);
  // Where the ray is inside the outer shell...
  float cOut = dot(oc, oc) - pow(uRadius * TOP, 2.0);
  float hOut = b * b - cOut;
  if (hOut <= 0.0) discard;
  float t0 = max(0.0, -b - sqrt(hOut)), t1 = -b + sqrt(hOut);
  // ...up to where it meets the body.
  float cIn = dot(oc, oc) - pow(uRadius * FOOT, 2.0);
  float hIn = b * b - cIn;
  if (hIn > 0.0 && -b - sqrt(hIn) > 0.0) t1 = -b - sqrt(hIn);
  if (t1 <= t0) discard;

  vec3 e1 = normalize(cross(uAxis, abs(uAxis.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0)));
  vec3 e2 = cross(uAxis, e1);
  vec3 sunDir = normalize(uSun - uCenter);
  const int STEPS = 56;
  float dt = (t1 - t0) / float(STEPS);
  vec3 col = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    vec3 x = oc + ray * (t0 + (float(i) + 0.5) * dt);
    float len = length(x);
    float h = len / uRadius;
    vec3 n = x / len;
    float lat = asin(clamp(dot(n, uAxis), -1.0, 1.0));
    float lon = atan(dot(n, e2), dot(n, e1));
    float pole = sign(lat);
    // The oval, wandering with longitude and time (each pole its own way).
    float latC = 1.08 + 0.07 * sin(3.0 * lon + uTime * 0.25 + pole) + 0.05 * snoise(vec3(lon * 1.5, uTime * 0.08, pole * 3.0));
    float band = exp(-pow((abs(lat) - latC) / 0.035, 2.0));
    if (band < 0.01) continue;
    float up = (h - FOOT) / (TOP - FOOT);
    float vert = smoothstep(0.0, 0.06, up) * pow(1.0 - up, 1.6);
    // Rays along the curtain, and folds that drift along the oval.
    float rays = 0.55 + 0.45 * snoise(vec3(lon * 40.0, uTime * 0.6, pole));
    float folds = 0.35 + 0.65 * smoothstep(-0.3, 0.6, snoise(vec3(lon * 5.0 - uTime * 0.15, uTime * 0.1, pole * 7.0)));
    float night = mix(1.0, 0.4, smoothstep(-0.15, 0.45, dot(n, sunDir)));
    vec3 hue = auHue(fract(lon / 6.2832 + up * 0.6 + uTime * 0.02));
    col += hue * band * vert * rays * folds * night * (dt / uRadius) * 11.0;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
export const AURORA_EXTENT = 1.6;

const frac = (x) => x - Math.floor(x);

// Everything needed to draw one body. `tick(t, center, sun)` updates the
// animated/positional uniforms each frame; `dispose()` frees GPU resources.
export function makePlanetParts(obj, star) {
  const kind = obj.type === "moon" ? `moon-${obj.kind || "cratered"}` : obj.kind;
  const isMoon = obj.type === "moon";
  const displace = isMoon || kind === "rocky";
  const extraDefines = {
    ...(kind === "moon-icy" ? { ICY_MOON: "" } : {}),
    ...(obj.habitable && (kind === "class-M" || kind === "ocean") ? { HAS_CITIES: "" } : {}),
    ...(displace ? { HAS_DISPLACE: "" } : {}),
    ...(hasLightning(obj) ? { HAS_LIGHTNING: "" } : {}),
    ...(obj.glow ? { HAS_GLOW: "" } : {}),
  };
  const seed = seedFor(obj.id);
  const base = jitterColor(obj.color || "#888888", seed);
  const r = obj.size || 0.5;
  const atmo = ATMOSPHERE[kind];
  const atmoColor = new THREE.Color(atmo?.color || obj.color || "#ffffff");
  const time = { value: 0 };
  // Shared by surface + clouds; updated in tick(). Same 2.4 intensity the
  // star's own point light uses, so brightness matches the rest of the scene.
  // Tint is half-strength: a red dwarf's full colour turns every world it
  // lights into the same red-on-black and hides the surface.
  const light = {
    uSun: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color(star?.color || "#ffffff").lerp(new THREE.Color("#ffffff"), 0.5).multiplyScalar(2.4) },
  };

  const surfUniforms = {
    uTime: time, uSeed: { value: seed }, uBase: { value: base }, uAtmo: { value: atmoColor }, ...light,
    uDisp: { value: displace ? r * 0.045 : 0 },
    uGlow: { value: obj.glow ?? 0 },
  };
  const lightning = hasLightning(obj);
  if (lightning) {
    surfUniforms.uStrike = { value: Array.from({ length: MAX_STRIKES }, () => new THREE.Vector4()) };
    surfUniforms.uStrikeT = { value: Array.from({ length: MAX_STRIKES }, () => new THREE.Vector2()) };
  }
  // Bump strength per kind — terrain worlds get relief, cloud-tops barely any.
  // Volcanoes: where they are (fixed by the body's seed) and how hot each
  // is right now (eruptions.js flares them).
  let eruptions = null;
  if (kind === "moon-lava") {
    eruptions = makeEruptions(r, seed, obj.volcanoes ?? 2);
    extraDefines.VENTS = eruptions.vents.length;
    surfUniforms.uVents = { value: eruptions.vents };
    surfUniforms.uVentHeat = { value: eruptions.heat };
  }
  // Bump strength per kind — terrain worlds get relief, cloud-tops barely any.
  const bump = { "gas giant": 0.4, toxic: 0.4, ocean: 0.8, "class-M": 1.0, ice: 1.5, desert: 1.5, "moon-icy": 1.5, "moon-volcanic": 1.5, "moon-lava": 1.2 }[kind] ?? 2.5;
  const surface = surfaceMaterial(kind, surfUniforms, bump, extraDefines);

  let clouds = null;
  if (kind === "class-M" || kind === "ocean") {
    clouds = cloudMaterial(
      { uTime: time, uSeed: { value: seed }, uCoverage: { value: kind === "ocean" ? 0.0 : 0.08 }, ...light },
      kind === "ocean" ? 2 : (frac(seed.x * 0.7) < 0.5 ? 1 : 0)
    );
  }

  let atmosphere = null;
  if (atmo) {
    atmosphere = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: atmoColor }, uCenter: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3() },
        uRadius: { value: r }, uExtent: { value: atmo.extent }, uStrength: { value: atmo.strength },
      },
      vertexShader: atmoVertex, fragmentShader: atmoFragment,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  let rings = null;
  if (kind === "gas giant" && frac(seed.y * 0.37) < 0.45) {
    const inner = r * (1.35 + 0.2 * frac(seed.x * 0.11)), outer = r * (2.1 + 0.6 * frac(seed.z * 0.19));
    rings = {
      inner, outer,
      material: new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: base.clone().lerp(new THREE.Color("#e8dcc0"), 0.4) }, uSeed: { value: seed },
          uCenter: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3() },
          uRadius: { value: r }, uInner: { value: inner }, uOuter: { value: outer },
        },
        vertexShader: ringVertex, fragmentShader: ringFragment,
        side: THREE.DoubleSide, transparent: true, depthWrite: false,
      }),
    };
  }

  // Axial tilt, so gas-giant bands and rings aren't all flat to the galaxy.
  const tilt = (frac(seed.z * 0.53) - 0.5) * 0.7;

  let aurora = null;
  if (obj.aurora) {
    aurora = new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3() }, uTime: time,
        // The poles: +Y turned by the tilt about Z, as Scene.jsx tilts the body.
        uAxis: { value: new THREE.Vector3(-Math.sin(tilt), Math.cos(tilt), 0) },
        uRadius: { value: r },
      },
      vertexShader: auroraVertex, fragmentShader: auroraFragment,
      side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
  }

  return {
    surface, clouds, atmosphere, rings, aurora, eruptions, tilt,
    // Displaced bodies need enough vertices for craters to show on the outline.
    segments: displace ? (isMoon ? 96 : 128) : 64,
    atmoExtent: atmo?.extent ?? 1,
    tick(t, center, sun) {
      eruptions?.update(t);
      time.value = t;
      if (lightning) {
        const now = lightningClock();
        const active = activeStrikes(obj.id, now);
        surfUniforms.uStrike.value.forEach((v, i) => {
          const s = active[i];
          if (!s) { v.w = 0; return; }
          v.set(s.pos[0], s.pos[1], s.pos[2], s.intensity);
          surfUniforms.uStrikeT.value[i].set((now - s.start) / s.dur, s.phase);
        });
      }
      light.uCenter.value.copy(center);
      light.uSun.value.copy(sun);
      for (const m of [atmosphere, rings?.material, aurora]) {
        if (!m) continue;
        m.uniforms.uCenter.value.copy(center);
        m.uniforms.uSun.value.copy(sun);
      }
    },
    dispose() {
      surface.dispose(); clouds?.dispose(); atmosphere?.dispose(); rings?.material.dispose(); aurora?.dispose(); eruptions?.dispose();
    },
  };
}
