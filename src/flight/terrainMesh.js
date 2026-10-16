// terrainMesh.js — the ground mesh for a landing site, built once from the
// site's height function (universe/terrain.js) and coloured by height,
// slope and noise from the surface kind's palette (universe/surface.js).
// Past the walkable edge the ground falls away a little, so the end of the
// mesh drops below the horizon instead of showing as an edge — airless
// worlds have no haze to hide it.
import * as THREE from "three";
import { TERRAIN_SIZE, SITE_RADIUS, fbm, noise2 } from "../universe/terrain.js";

const SEGMENTS = 280;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Extra drop beyond the walkable area (m) — fake curvature.
export function edgeDrop(x, z) {
  const d = Math.hypot(x, z) - SITE_RADIUS * 1.15;
  return d > 0 ? (d / 60) ** 2 * 5 : 0;
}

export function buildTerrainGeometry(terrain, env, seed) {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const h0 = terrain.heightAt(0, 0);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrain.heightAt(x, z) - edgeDrop(x, z));
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const low = new THREE.Color(env.ground[0]), high = new THREE.Color(env.ground[1]), rock = new THREE.Color(env.ground[2]);
  const sand = new THREE.Color(env.ground[0]).lerp(new THREE.Color("#d8c89a"), 0.5);
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const s = seed >>> 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const slope = 1 - nrm.getY(i);
    const n = fbm(x / 35, z / 35, s + 900, 3);
    const t = Math.max(0, Math.min(1, 0.5 + n * 0.7 + (y - h0) / 50));
    c.copy(low).lerp(high, t);
    c.lerp(rock, smooth(0.06, 0.3, slope));
    // A beach where land meets water.
    if (terrain.water != null) c.lerp(sand, 1 - smooth(terrain.water + 0.3, terrain.water + 2.5, y));
    const jitter = (0.8 + 0.2 * noise2(x / 3, z / 3, s + 77)) * (0.85 + 0.15 * noise2(x / 14, z / 14, s + 78));
    col[i * 3] = c.r * jitter; col[i * 3 + 1] = c.g * jitter; col[i * 3 + 2] = c.b * jitter;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}
