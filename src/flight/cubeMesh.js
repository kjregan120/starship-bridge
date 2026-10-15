// cubeMesh.js — drawing a Collective cube (universe/cube.js): every block one
// instance of a single InstancedMesh, so ~160 blocks are one draw call.
//
// The blocks share a procedural panel texture — dark plates, conduits,
// and green-lit seams in the emissive map — and each instance's glow is its
// own (aGlow, spliced into the standard material): emitters burn bright,
// tractor nodes pulse, plating just shows its seams, and a destroyed block
// goes dark and drops out. Cutting beams are a small pool of additive
// cylinders; the tractor beam is a cone from the cube to the ship.
import * as THREE from "three";
import { CELL, N } from "../universe/cube.js";

const BEAM_SLOTS = 12;

// 128px panel greeble: a base colour map and an emissive map of the seams.
function panelTextures() {
  const size = 128;
  const make = () => { const c = document.createElement("canvas"); c.width = c.height = size; return c; };
  const base = make(), glow = make();
  const b = base.getContext("2d"), g = glow.getContext("2d");
  b.fillStyle = "#2a2d2b"; b.fillRect(0, 0, size, size);
  g.fillStyle = "#000"; g.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Plates of slightly different greys.
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rnd() * 8) * 16, y = Math.floor(rnd() * 8) * 16;
    const w = 16 * (1 + Math.floor(rnd() * 3)), h = 16 * (1 + Math.floor(rnd() * 3));
    const v = 30 + Math.floor(rnd() * 30);
    b.fillStyle = `rgb(${v},${v + 3},${v + 1})`;
    b.fillRect(x + 1, y + 1, w - 2, h - 2);
  }
  // Conduits.
  b.strokeStyle = "#151716"; b.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    b.beginPath();
    const y = 8 + Math.floor(rnd() * 15) * 8;
    b.moveTo(0, y); b.lineTo(size, y); b.stroke();
  }
  // Lit seams — short runs, both ways, so neighbouring blocks don't line up
  // into stripes — and a few indicator dots, green.
  g.strokeStyle = "#2fd86e"; g.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    const x = Math.floor(rnd() * 16) * 8 + 0.5, y = Math.floor(rnd() * 16) * 8 + 0.5, l = 12 + rnd() * 30;
    g.moveTo(x, y);
    if (rnd() < 0.5) g.lineTo(x + l, y); else g.lineTo(x, y + l);
    g.stroke();
  }
  g.fillStyle = "#7dffb0";
  for (let i = 0; i < 10; i++) g.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 2, 2);
  const tb = new THREE.CanvasTexture(base), tg = new THREE.CanvasTexture(glow);
  tb.colorSpace = THREE.SRGBColorSpace; tg.colorSpace = THREE.SRGBColorSpace;
  for (const t of [tb, tg]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map: tb, emissiveMap: tg };
}

const GLOW = { plate: 0.3, emitter: 3.0, tractor: 2.2, regen: 1.4, core: 4.0 };

export function makeCubeMesh(count) {
  const { map, emissiveMap } = panelTextures();
  const geometry = new THREE.BoxGeometry(CELL * 0.97, CELL * 0.97, CELL * 0.97);
  const glow = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  geometry.setAttribute("aGlow", glow);
  // Each block shows its own quarter of the panel texture, so neighbours differ.
  const uvOff = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
  for (let i = 0; i < count; i++) uvOff.setXY(i, Math.floor(Math.random() * 4) / 4, Math.floor(Math.random() * 4) / 4);
  geometry.setAttribute("aUvOff", uvOff);
  const material = new THREE.MeshStandardMaterial({
    map, emissiveMap, emissive: new THREE.Color("#3dff8a"), emissiveIntensity: 1,
    metalness: 0.7, roughness: 0.55,
  });
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aGlow;\nattribute vec2 aUvOff;\nvarying float vGlow;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvMapUv = vMapUv * 0.5 + aUvOff;\nvEmissiveMapUv = vEmissiveMapUv * 0.5 + aUvOff;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = aGlow;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGlow;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow;");
  };
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;

  // Cutting beams.
  const beamGeo = new THREE.CylinderGeometry(0.02, 0.035, 1, 6, 1, true);
  beamGeo.translate(0, 0.5, 0);            // base at the origin, length along +y
  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.2, 1.0, 0.4), transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const beams = Array.from({ length: BEAM_SLOTS }, () => {
    const m = new THREE.Mesh(beamGeo, beamMat.clone());
    m.visible = false; m.frustumCulled = false;
    return m;
  });

  // Tractor: a widening shaft from the node to the hull, along +y.
  const tractorGeo = new THREE.CylinderGeometry(0.1, 0.05, 1, 20, 1, true);
  tractorGeo.translate(0, 0.5, 0);
  // Bands ripple down it toward the ship, and it fades out before the hull
  // instead of ending at a hard rim.
  const tractorMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.4 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime, uOpacity; varying vec2 vUv;
      void main(){
        float along = vUv.y;
        float bands = 0.6 + 0.4 * sin(along * 40.0 - uTime * 9.0);
        float fade = smoothstep(0.0, 0.08, along) * (1.0 - smoothstep(0.55, 1.0, along));
        gl_FragColor = vec4(vec3(0.25, 1.0, 0.5) * uOpacity * bands * fade, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const tractor = new THREE.Mesh(tractorGeo, tractorMat);
  tractor.visible = false; tractor.frustumCulled = false;

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const _yaw = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0);

  // Where something from `from` (ship-relative) lands on the ship: on the
  // hull just below the bridge, off to the side it came from — not at the
  // camera, or a beam coming straight at us would foreshorten to a dot.
  // `i` jitters it so a volley spreads.
  const hullPoint = (from, out, i) => {
    out.copy(from).normalize().multiplyScalar(0.9);
    out.y -= 0.45;
    out.x += Math.sin(i * 12.9) * 0.12; out.z += Math.cos(i * 7.3) * 0.12;
    return out;
  };

  // Point a unit-length-along-+y mesh from a to b.
  const span = (obj, a, b) => {
    _p.subVectors(b, a);
    const L = _p.length();
    obj.position.copy(a);
    obj.quaternion.setFromUnitVectors(_up, _p.divideScalar(L || 1));
    obj.scale.set(1, L, 1);
  };

  return {
    mesh, beams, tractor,
    // cube: the live Cube; ship: the ship's world position; t: seconds.
    update(cube, ship, t) {
      const rel = (p) => [p[0] - ship[0], p[1] - ship[1], p[2] - ship[2]];
      const r = rel(cube.pos);
      _yaw.setFromAxisAngle(_Y, cube.yaw);
      cube.blocks.forEach((b, i) => {
        if (b.hp <= 0) {
          _m.makeScale(0, 0, 0);
        } else {
          _p.set(...b.cell.map((c) => (c - (N - 1) / 2) * CELL)).applyQuaternion(_yaw).add(_s.set(r[0], r[1], r[2]));
          _m.compose(_p, _yaw, _s.set(1, 1, 1));
        }
        mesh.setMatrixAt(i, _m);
        let k = GLOW[b.role] * (0.25 + 0.75 * b.hp);
        if (b.role === "tractor") k *= cube.tractor ? 1.6 + 0.6 * Math.sin(t * 9) : 0.8 + 0.2 * Math.sin(t * 1.5 + i);
        if (b.role === "emitter") k *= 0.8 + 0.2 * Math.sin(t * 2 + i * 1.7);
        glow.setX(i, k);
      });
      mesh.instanceMatrix.needsUpdate = true;
      glow.needsUpdate = true;

      // Beams: each recent shot, from its emitter to just in front of the
      // viewer, fading over half a second.
      const shots = cube.shots;
      beams.forEach((m, i) => {
        const s = shots[i];
        if (!s) { m.visible = false; return; }
        const age = cube.time - s.t;
        const from = rel(cube.blockPos(s.block));
        _a.set(from[0], from[1], from[2]);
        hullPoint(_a, _b, i);
        span(m, _a, _b);
        m.material.opacity = 0.95 * Math.max(0, 1 - age / 0.5);
        m.visible = true;
      });

      // Tractor: from whichever live node faces us, onto the hull.
      const node = cube.tractor && cube.facesToward(ship)
        .map((f) => cube.live(f, "tractor")[0]).find(Boolean);
      tractor.visible = !!node;
      if (node) {
        const p = rel(cube.blockPos(node));
        _a.set(p[0], p[1], p[2]);
        hullPoint(_a, _b, 0);
        span(tractor, _a, _b);
        tractorMat.uniforms.uTime.value = t;
        tractorMat.uniforms.uOpacity.value = 0.35 + 0.1 * Math.sin(t * 6);
      }
    },
  };
}
