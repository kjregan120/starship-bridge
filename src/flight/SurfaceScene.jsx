// SurfaceScene.jsx — the away team's world: a landing site's terrain, sky
// and sun, the team, and whatever the mission put there, seen over the
// captain's shoulder.
//
// Like Scene.jsx, it reads the live state (awayEngine.js `away`) every
// frame for smooth motion; the HUD (SurfaceApp.jsx) reads the store. The
// controls write into `awayInput`, which loop.js feeds to the mission.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars, Html } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { away, awayInput, BEAM_TIME } from "./awayEngine.js";
import { ship, byId } from "./engine.js";
import { useUI } from "./store.js";
import { sunAt, stormAt, VENT_RADIUS } from "../universe/surface.js";
import { TERRAIN_SIZE, rng } from "../universe/terrain.js";
import { buildTerrainGeometry, edgeDrop } from "./terrainMesh.js";

// The camera's orbit around the captain — the HUD's compass reads `yaw`.
export const surfaceView = { yaw: Math.PI, pitch: 0.42, dist: 10 };

const DEPT_COLOR = {
  command: "#c9a227", helm: "#c9a227",
  science: "#3a78b8", medical: "#3a78b8",
  comms: "#b8332a", engineering: "#b8332a", tactical: "#b8332a", security: "#b8332a", operations: "#b8332a",
};
const SKIN = ["#e8c4a0", "#c68e62", "#8d5a3b", "#5c3a24", "#f0d2b6", "#a87450"];

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ground = (x, z) => away.terrain.heightAt(x, z) - edgeDrop(x, z);

// ---------------- controls ----------------
function useControls() {
  const { gl } = useThree();
  useEffect(() => {
    const keys = new Set();
    const typing = () => document.activeElement?.tagName === "INPUT";
    const down = (e) => {
      if (typing()) return;
      keys.add(e.code);
      if (e.code === "KeyE") away?.interact();
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    };
    const up = (e) => keys.delete(e.code);
    const blur = () => keys.clear();
    let dragging = false, lx = 0, ly = 0;
    const el = gl.domElement;
    const pd = (e) => { dragging = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture?.(e.pointerId); document.activeElement?.blur?.(); };
    const pm = (e) => {
      if (!dragging) return;
      surfaceView.yaw -= (e.clientX - lx) * 0.006;
      surfaceView.pitch = Math.max(-0.15, Math.min(1.35, surfaceView.pitch + (e.clientY - ly) * 0.005));
      lx = e.clientX; ly = e.clientY;
    };
    const pu = () => { dragging = false; };
    const wheel = (e) => { surfaceView.dist = Math.max(2.5, Math.min(40, surfaceView.dist * (e.deltaY > 0 ? 1.1 : 0.9))); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerup", pu);
    el.addEventListener("wheel", wheel, { passive: true });
    // Movement, relative to where the camera's looking.
    let raf;
    const tick = () => {
      const f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
      const r = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
      const y = surfaceView.yaw;
      const fwd = [-Math.sin(y), -Math.cos(y)], right = [-fwd[1], fwd[0]];
      awayInput.move = [fwd[0] * f + right[0] * r, fwd[1] * f + right[1] * r];
      awayInput.run = keys.has("ShiftLeft") || keys.has("ShiftRight");
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      awayInput.move = [0, 0];
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      el.removeEventListener("pointerdown", pd);
      el.removeEventListener("pointermove", pm);
      el.removeEventListener("pointerup", pu);
      el.removeEventListener("wheel", wheel);
    };
  }, [gl]);
}

function CameraRig() {
  useControls();
  useFrame(({ camera }) => {
    if (!away) return;
    const [x, z] = away.captain.pos;
    const target = new THREE.Vector3(x, ground(x, z) + 1.5, z);
    const { yaw, pitch, dist } = surfaceView;
    const cp = Math.cos(pitch);
    camera.position.set(x + Math.sin(yaw) * cp * dist, target.y + Math.sin(pitch) * dist, z + Math.cos(yaw) * cp * dist);
    const floor = ground(camera.position.x, camera.position.z) + 0.5;
    if (camera.position.y < floor) camera.position.y = floor;
    camera.lookAt(target);
  });
  return null;
}

// ---------------- sky, sun, light ----------------
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith, uHorizon, uSun; uniform float uDay, uStorm;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.55));
  float s = max(dot(d, uSun), 0.0);
  c += uHorizon * pow(s, 6.0) * 0.35 * uDay;              // glow around the sun
  // Dusk: warm the horizon when the sun is low.
  float dusk = (1.0 - abs(uSun.y) * 3.0);
  c = mix(c, c * vec3(1.35, 0.85, 0.6), clamp(dusk, 0.0, 1.0) * (1.0 - h) * 0.7);
  c *= mix(0.025, 1.0, uDay);
  c = mix(c, c * 0.45, uStorm);
  if (d.y < 0.0) c = mix(c, uHorizon * mix(0.025, 0.7, uDay), smoothstep(0.0, -0.15, d.y));
  gl_FragColor = vec4(c, 1.0);
}`;

function Sky({ env, hasAir }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(env.sky[0]) }, uHorizon: { value: new THREE.Color(env.sky[1]) },
      uSun: { value: new THREE.Vector3(0, 1, 0) }, uDay: { value: 1 }, uStorm: { value: 0 },
    },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
  }), [env]);
  const skyMesh = useRef(), sunMesh = useRef(), halo = useRef(), sunLight = useRef(), hemi = useRef(), lamp = useRef(), stars = useRef();
  const { scene } = useThree();
  const fog = useMemo(() => (env.fog ? new THREE.Fog(env.fog[0], 40, env.fog[1]) : null), [env]);
  const fogBase = useMemo(() => (env.fog ? new THREE.Color(env.fog[0]) : null), [env]);
  useEffect(() => { scene.fog = fog; scene.background = new THREE.Color(hasAir ? env.sky[1] : "#000"); return () => { scene.fog = null; }; }, [scene, fog, env, hasAir]);
  const flash = useRef(0);

  useFrame((_, dt) => {
    if (!away) return;
    const t = ship.time;
    const sun = sunAt(away.site, t);
    const dir = new THREE.Vector3(...sun.dir);
    const day = smooth(-0.12, 0.18, sun.elevation);
    const storm = hasAir && stormAt(away.site, t) ? 1 : 0;
    // Lightning: now and then while a storm's over us.
    if (storm && Math.random() < dt * 0.35) flash.current = 1;
    flash.current = Math.max(0, flash.current - dt * 4);
    mat.uniforms.uSun.value.copy(dir);
    mat.uniforms.uDay.value = hasAir ? day : 0;
    mat.uniforms.uStorm.value += (storm - mat.uniforms.uStorm.value) * Math.min(1, dt);
    const [cx, cz] = away.captain.pos;
    skyMesh.current?.position.set(cx, 0, cz);
    const sunPos = dir.clone().multiplyScalar(1500).add(new THREE.Vector3(cx, 0, cz));
    sunMesh.current.position.copy(sunPos);
    halo.current.position.copy(sunPos);
    sunMesh.current.visible = halo.current.visible = sun.elevation > -0.05;
    const lit = smooth(-0.04, 0.12, sun.elevation) * (1 - 0.6 * mat.uniforms.uStorm.value);
    sunLight.current.intensity = (hasAir ? 1.9 : 3.0) * lit;
    sunLight.current.position.copy(dir.clone().multiplyScalar(300).add(new THREE.Vector3(cx, 0, cz)));
    sunLight.current.target.position.set(cx, 0, cz);
    sunLight.current.target.updateMatrixWorld();
    hemi.current.intensity = (hasAir ? 0.08 + 0.32 * day : 0.04) + flash.current * 2.5;
    // A suit lamp after dark.
    lamp.current.intensity = (1 - lit) * 40;
    lamp.current.position.set(cx, ground(cx, cz) + 2.2, cz);
    if (fog) fog.color.copy(fogBase).multiplyScalar(Math.max(0.03, day) * (1 - 0.5 * mat.uniforms.uStorm.value) + flash.current * 0.5);
    if (hasAir && scene.background) scene.background.copy(fog ? fog.color : new THREE.Color(env.sky[1]));
    if (stars.current) stars.current.visible = !hasAir || day < 0.25;
  });

  return (
    <>
      {hasAir && <mesh ref={skyMesh} material={mat}><sphereGeometry args={[1900, 32, 16]} /></mesh>}
      <group ref={stars}><Stars radius={900} depth={200} count={4000} factor={6} fade /></group>
      <mesh ref={sunMesh}><sphereGeometry args={[hasAir ? 18 : 12, 16, 8]} /><meshBasicMaterial color="#fff6e0" fog={false} /></mesh>
      <mesh ref={halo}>
        <sphereGeometry args={[hasAir ? 60 : 40, 16, 8]} />
        <meshBasicMaterial color="#ffe0a0" transparent opacity={hasAir ? 0.18 : 0.08} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
      </mesh>
      <directionalLight ref={sunLight} color="#fff2dd" />
      <hemisphereLight ref={hemi} args={[env.sky[1], env.ground[0], 0.5]} />
      <pointLight ref={lamp} color="#d8e8ff" distance={35} decay={1.5} />
    </>
  );
}

// The parent planet hanging in a moon's sky — lit by the same sun.
function ParentInSky({ body }) {
  const parent = body.type === "moon" ? byId[body.parent] : null;
  const dir = useMemo(() => {
    const r = rng(away.site.seed ^ 0x9a9a);
    const a = r() * Math.PI * 2, e = 0.35 + r() * 0.5;
    return new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
  }, []);
  const ref = useRef();
  useFrame(() => {
    if (!ref.current || !away) return;
    const [cx, cz] = away.captain.pos;
    ref.current.position.copy(dir).multiplyScalar(1600).add(new THREE.Vector3(cx, 0, cz));
  });
  if (!parent) return null;
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[parent.kind === "gas giant" ? 320 : 180, 48, 24]} />
      <meshStandardMaterial color={parent.color} roughness={1} fog={false} />
    </mesh>
  );
}

// ---------------- the ground ----------------
function Ground({ env }) {
  const geo = useMemo(() => buildTerrainGeometry(away.terrain, env, away.site.seed), [env]);
  useEffect(() => () => geo.dispose(), [geo]);
  const w = away.terrain.water;
  return (
    <>
      <mesh geometry={geo}><meshStandardMaterial vertexColors roughness={0.95} metalness={0} /></mesh>
      {w != null && env.water && (
        <mesh position={[0, w, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[TERRAIN_SIZE, TERRAIN_SIZE]} />
          <meshStandardMaterial color={env.water} transparent opacity={0.82} roughness={0.12} metalness={0.2} />
        </mesh>
      )}
      {away.terrain.vents.map(([x, z], i) => <Vent key={i} x={x} z={z} />)}
    </>
  );
}

function Vent({ x, z }) {
  const light = useRef(), glow = useRef();
  const y = useMemo(() => ground(x, z), [x, z]);
  useFrame(({ clock }) => {
    const k = 0.75 + 0.25 * Math.sin(clock.elapsedTime * 2.3 + x);
    light.current.intensity = 60 * k;
    glow.current.material.opacity = 0.5 + 0.3 * k;
  });
  return (
    <group position={[x, y, z]}>
      <mesh ref={glow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.3, 0]}>
        <circleGeometry args={[9, 24]} />
        <meshBasicMaterial color="#ff7a20" transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <pointLight ref={light} color="#ff6a10" distance={VENT_RADIUS * 1.6} decay={1.2} position={[0, 4, 0]} />
    </group>
  );
}

// ---------------- people ----------------
// A simple figure: torso, head, swinging arms and legs. `state()` returns
// { pos, heading, moving, down, dead } every frame.
function Figure({ state, color, skin, suit, label, beam, scale = 1 }) {
  const root = useRef(), legL = useRef(), legR = useRef(), armL = useRef(), armR = useRef(), sparkle = useRef(), tag = useRef();
  const mats = useMemo(() => ({
    body: new THREE.MeshStandardMaterial({ color, roughness: 0.7, transparent: true }),
    dark: new THREE.MeshStandardMaterial({ color: "#1c1c22", roughness: 0.8, transparent: true }),
    skin: new THREE.MeshStandardMaterial({ color: skin, roughness: 0.6, transparent: true }),
    glass: new THREE.MeshStandardMaterial({ color: "#bcd6ff", roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.28, depthWrite: false }),
  }), [color, skin]);
  const sparkGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(90 * 3), 3));
    return g;
  }, []);
  const phase = useRef(Math.random() * 10);
  useFrame((_, dt) => {
    const s = state();
    if (!s || !root.current) return;
    const [x, z] = s.pos;
    const y = ground(x, z);
    root.current.position.set(x, y, z);
    // Turn smoothly toward the way they're going.
    let dh = s.heading - root.current.rotation.y;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    root.current.rotation.y += dh * Math.min(1, dt * 8);
    root.current.rotation.z = s.down ? Math.PI / 2 : 0;
    root.current.position.y = s.down ? y + 0.25 : y;
    if (s.moving) phase.current += dt * (s.run ? 11 : 7.5);
    const sw = s.moving && !s.down ? Math.sin(phase.current) * 0.6 : 0;
    legL.current.rotation.x = sw; legR.current.rotation.x = -sw;
    armL.current.rotation.x = -sw * 0.8; armR.current.rotation.x = sw * 0.8;
    // Transporter: fade in (or out) inside a column of sparkles.
    const k = beam ? beam() : 1;
    for (const m of Object.values(mats)) m.opacity = (m === mats.glass ? 0.28 : 1) * k;
    for (const m of [mats.body, mats.dark, mats.skin]) m.depthWrite = k > 0.95;
    root.current.visible = k > 0.01 || (beam && beam.sparkling?.());
    if (tag.current && label) { const l = label(); if (tag.current.textContent !== l) tag.current.textContent = l; }
    const sp = beam?.sparkling?.() ?? false;
    sparkle.current.visible = sp;
    if (sp) {
      const a = sparkGeo.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) {
        const r = 0.15 + Math.random() * 0.35, t = Math.random() * Math.PI * 2;
        a[i] = Math.cos(t) * r; a[i + 1] = Math.random() * 2.0; a[i + 2] = Math.sin(t) * r;
      }
      sparkGeo.attributes.position.needsUpdate = true;
    }
  });
  return (
    <group ref={root} scale={scale}>
      {/* legs swing from the hip */}
      <group ref={legL} position={[-0.12, 0.92, 0]}><mesh material={mats.dark} position={[0, -0.45, 0]}><capsuleGeometry args={[0.09, 0.7, 4, 8]} /></mesh></group>
      <group ref={legR} position={[0.12, 0.92, 0]}><mesh material={mats.dark} position={[0, -0.45, 0]}><capsuleGeometry args={[0.09, 0.7, 4, 8]} /></mesh></group>
      <mesh material={mats.body} position={[0, 1.22, 0]}><capsuleGeometry args={[0.2, 0.42, 4, 10]} /></mesh>
      <group ref={armL} position={[-0.29, 1.45, 0]}><mesh material={mats.body} position={[0, -0.3, 0]}><capsuleGeometry args={[0.065, 0.5, 4, 8]} /></mesh></group>
      <group ref={armR} position={[0.29, 1.45, 0]}><mesh material={mats.body} position={[0, -0.3, 0]}><capsuleGeometry args={[0.065, 0.5, 4, 8]} /></mesh></group>
      <mesh material={mats.skin} position={[0, 1.72, 0]}><sphereGeometry args={[0.13, 16, 12]} /></mesh>
      {suit && <mesh material={mats.glass} position={[0, 1.72, 0]}><sphereGeometry args={[0.2, 16, 12]} /></mesh>}
      {/* blob shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <circleGeometry args={[0.4, 16]} />
        <meshBasicMaterial color="#000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <points ref={sparkle} geometry={sparkGeo} visible={false}>
        <pointsMaterial color="#cfe6ff" size={0.06} transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      {label && (
        <Html position={[0, 2.25, 0]} center zIndexRange={[10, 0]}>
          <div ref={tag} className="sf-tag" />
        </Html>
      )}
    </group>
  );
}

// How far through the transporter effect someone is: 0 = not here, 1 = solid.
// `arrives`: beamed down with the team (survivors were already here).
function beamFor(id, arrives = true) {
  const f = () => {
    if (!away) return 0;
    const tr = useUI.getState().transport;
    if (away.beamingUp && tr?.dir === "up" && (id === "captain" || away.beamSet?.has(id))) {
      return 1 - smooth(0.15, 0.85, (performance.now() - tr.at) / 1000 / BEAM_TIME);
    }
    if (away.beamingUp || !arrives) return 1;
    return smooth(0.15, 0.85, away.time / BEAM_TIME);
  };
  f.sparkling = () => { const k = f(); return k > 0.02 && k < 0.98; };
  return f;
}

function Team({ suit }) {
  const members = away.team;
  return (
    <>
      <Figure
        state={() => away && { ...away.captain, down: away.captain.health < 0.3 && !away.captain.moving, run: awayInput.run }}
        color="#c9a227" skin={SKIN[0]} suit={suit} beam={beamFor("captain")}
      />
      {members.map((a, i) => (
        <Figure
          key={a.id}
          state={() => ({ pos: a.pos, heading: a.heading, moving: a.moving, down: a.m.health < 0.3, run: false })}
          color={DEPT_COLOR[a.m.dept] ?? "#b8332a"} skin={SKIN[(i * 3 + 1) % SKIN.length]} suit={suit}
          beam={beamFor(a.id)}
          label={() => `${a.m.name.split(" ").slice(-1)[0]}${a.m.health <= 0 ? " ✝" : a.m.health < 0.3 ? " ⚠" : ""}`}
        />
      ))}
    </>
  );
}

// ---------------- points of interest ----------------
const POI_COLOR = { anomaly: "#59e0ff", specimen: "#9cff6a", deposit: "#ffd06a", survivor: "#ff8a4a" };

function Beacon({ p }) {
  const ref = useRef();
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.visible = !p.done && !p.dead;
    ref.current.material.opacity = 0.12 + 0.06 * Math.sin(clock.elapsedTime * 2 + p.pos[0]);
  });
  return (
    <mesh ref={ref} position={[0, 30, 0]}>
      <cylinderGeometry args={[0.35, 0.35, 60, 8, 1, true]} />
      <meshBasicMaterial color={POI_COLOR[p.kind]} transparent opacity={0.15} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Anomaly({ p }) {
  const ref = useRef();
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    ref.current.rotation.y = t * 0.8;
    ref.current.position.y = 1.3 + Math.sin(t * 1.7) * 0.15;
    ref.current.material.emissiveIntensity = p.done ? 0.2 : 1.2 + Math.sin(t * 3) * 0.4;
  });
  return (
    <mesh ref={ref}>
      <octahedronGeometry args={[0.45, 0]} />
      <meshStandardMaterial color={POI_COLOR.anomaly} emissive={POI_COLOR.anomaly} roughness={0.3} />
    </mesh>
  );
}

function Cluster({ p, color, emissive = 0, tall = 0.6 }) {
  const parts = useMemo(() => {
    const r = rng(Math.floor((p.pos[0] + 1000) * 7919 + p.pos[1] * 31));
    return Array.from({ length: 7 }, () => ({
      x: (r() - 0.5) * 1.6, z: (r() - 0.5) * 1.6, h: tall * (0.5 + r()), tx: (r() - 0.5) * 0.6, tz: (r() - 0.5) * 0.6,
    }));
  }, [p, tall]);
  return (
    <group>
      {parts.map((c, i) => (
        <mesh key={i} position={[c.x, c.h / 2, c.z]} rotation={[c.tx, 0, c.tz]}>
          <coneGeometry args={[0.12 + c.h * 0.12, c.h, 5]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={p.done ? 0 : emissive} roughness={0.4} metalness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

function Wreck({ at }) {
  const y = ground(at[0], at[1]);
  return (
    <group position={[at[0], y, at[1]]} rotation={[0, 0.7, 0]}>
      <mesh position={[0, 0.9, 0]} rotation={[0.25, 0, 0.18]}><boxGeometry args={[3.2, 1.6, 7]} /><meshStandardMaterial color="#8a8f99" roughness={0.6} metalness={0.5} /></mesh>
      <mesh position={[2.6, 0.2, -2]} rotation={[0.1, 0.5, 0.9]}><boxGeometry args={[2.4, 0.15, 3]} /><meshStandardMaterial color="#6d7179" roughness={0.6} metalness={0.5} /></mesh>
      <mesh position={[-2.2, 0.3, 3]} rotation={[0.7, 0.2, 0.1]}><boxGeometry args={[1, 0.6, 1.4]} /><meshStandardMaterial color="#c0442a" roughness={0.7} /></mesh>
      <pointLight color="#ff7040" intensity={8} distance={14} position={[0, 2, 0]} />
    </group>
  );
}

function Pois() {
  const pois = away.pois();
  const fuel = (p) => p.yields === "fuel";
  return (
    <>
      {away.mission?.wreck && <Wreck at={away.mission.wreck} />}
      {pois.filter((p) => p.kind !== "survivor").map((p) => (
        <group key={p.id} position={[p.pos[0], ground(p.pos[0], p.pos[1]), p.pos[1]]}>
          {p.kind === "anomaly" && <Anomaly p={p} />}
          {p.kind === "specimen" && <Cluster p={p} color={POI_COLOR.specimen} emissive={0.25} tall={0.4} />}
          {p.kind === "deposit" && <Cluster p={p} color={fuel(p) ? "#bfe8ff" : "#8a7a6a"} emissive={fuel(p) ? 0.5 : 0.15} tall={0.9} />}
          <Beacon p={p} />
          <PoiTag p={p} />
        </group>
      ))}
      {pois.filter((p) => p.kind === "survivor").map((p, i) => (
        <group key={p.id}>
          <Figure
            state={() => ({ pos: p.pos, heading: p.heading ?? i, moving: !!p.moving, down: !p.done || p.dead, run: false })}
            color={p.dead ? "#55504a" : "#d9772e"} skin={SKIN[(i * 2 + 2) % SKIN.length]} suit={false}
            beam={beamFor(p.id, false)}
            label={() => `${p.label}${p.dead ? " ✝" : p.done ? "" : ` ${Math.round(p.health * 100)}%`}`}
          />
          <SurvivorBeacon p={p} />
        </group>
      ))}
    </>
  );
}
function SurvivorBeacon({ p }) {
  const ref = useRef();
  useFrame(() => { if (ref.current) ref.current.position.set(p.pos[0], ground(p.pos[0], p.pos[1]), p.pos[1]); });
  return <group ref={ref}><Beacon p={p} /></group>;
}

// What it is and how far along, once you're close.
function PoiTag({ p }) {
  const ref = useRef();
  useFrame(() => {
    if (!ref.current || !away) return;
    const d = Math.hypot(p.pos[0] - away.captain.pos[0], p.pos[1] - away.captain.pos[1]);
    const show = d < 30;
    ref.current.style.display = show ? "block" : "none";
    if (show) {
      const pct = p.progress > 0 && !p.done ? ` · ${Math.round(p.progress * 100)}%` : "";
      ref.current.textContent = `${p.label}${p.done ? " ✓" : pct}${d < 4 && !p.done ? " — E" : ""}`;
      ref.current.className = `sf-tag poi ${p.kind} ${p.done ? "done" : ""}`;
    }
  });
  return <Html position={[0, 2.4, 0]} center zIndexRange={[10, 0]}><div ref={ref} className="sf-tag poi" /></Html>;
}

// ---------------- the scene ----------------
export default function SurfaceScene() {
  if (!away) return null;
  const env = away.env;
  const hasAir = env.air !== "none";
  return (
    <Canvas camera={{ fov: 60, near: 0.1, far: 4000, position: [0, 3, 8] }} dpr={[1, 2]}>
      <CameraRig />
      <Sky env={env} hasAir={hasAir} />
      <ParentInSky body={away.body} />
      <Ground env={env} />
      <Pois />
      <Team suit={env.suit != null} />
    </Canvas>
  );
}
