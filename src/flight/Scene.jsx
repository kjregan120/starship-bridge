import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { useRef, useMemo, useState, useEffect } from "react";
import * as THREE from "three";
import { sim, view, collective, galaxyPoints, nearestStar, starsWithin, blackholesWithin, beaconsWithin, systemBodies, worldPos } from "./engine.js";
import { useUI } from "./store.js";
import { makeStarMaterials, CORONA_EXTENT } from "./starShader.js";
import { makeFlareLoops } from "./flareLoops.js";
import { ejecta, ejectaClock } from "./ejecta.js";
import { warpStreaks } from "./warpStreaks.js";
import { lens, BASE_FOV } from "./lens.js";
import { makePlanetParts, AURORA_EXTENT } from "./planetShader.js";
import { makeCubeMesh } from "./cubeMesh.js";

// How far out a star system's planets/moons start rendering as real (if tiny)
// spheres, instead of only appearing once that star becomes THE nearest one.
// Comfortably bigger than a typical system radius so bodies grow in gradually
// on approach rather than popping into existence up close.
const SYSTEM_RENDER_RANGE = 180;
// Black holes are rarer and more dramatic — worth spotting from farther out.
const BLACKHOLE_RENDER_RANGE = 320;
// Beacons are tiny and meant to be hunted with `sweep` first, then flown to
// — this only needs to cover final approach, not long-range spotting.
const BEACON_RENDER_RANGE = 220;
// Bodies currently drawn as real meshes (by LocalSystem) — GalaxyField skips
// their flat point so a body doesn't show as both a dot and a sphere at once.
const renderedBodyIds = new Set();

const rel = (p) => [p[0] - sim.pos[0], p[1] - sim.pos[1], p[2] - sim.pos[2]];

// ---- galaxy-scale point cloud (stars + exotic bodies), floating-origin -----
function GalaxyField() {
  const ref = useRef();
  const count = galaxyPoints.length;
  const colors = useMemo(() => {
    const a = new Float32Array(count * 3);
    galaxyPoints.forEach((o, i) => {
      const c = new THREE.Color(o.color || "#ffffff");
      a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
    });
    return a;
  }, [count]);
  const positions = useMemo(() => new Float32Array(count * 3), [count]);

  useFrame(() => {
    if (!ref.current) return;
    const arr = ref.current.geometry.attributes.position.array;
    for (let i = 0; i < count; i++) {
      const o = galaxyPoints[i];
      if (renderedBodyIds.has(o.id)) {
        // already drawn as a real sphere below — park the flat point out of view
        arr[i * 3] = arr[i * 3 + 1] = arr[i * 3 + 2] = 1e6;
        continue;
      }
      const p = rel(worldPos(o));
      arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2];
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={count} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={3} sizeAttenuation={false} vertexColors transparent depthWrite={false} />
    </points>
  );
}

// ---- one body in the local system (floating-origin, self-updating) ---------
// Planets and moons: procedural surface per `kind`, plus clouds, atmosphere
// glow and rings where the kind calls for them (planetShader.js). The outer
// group only moves; the tilt group sets the axis; only the spheres spin, so
// rings and the atmosphere shell don't wobble with the body's rotation.
const starOf = (obj) => { let o = obj; while (o && o.type !== "star") o = sim.byId[o.parent]; return o; };
const _center = new THREE.Vector3(), _sun = new THREE.Vector3();
function BodyMesh({ obj }) {
  const g = useRef();
  const spin = useRef();
  const cloudSpin = useRef();
  const r = obj.size || 0.5;
  const star = useMemo(() => starOf(obj), [obj.id]);
  const parts = useMemo(() => makePlanetParts(obj, star), [obj.id]);
  useEffect(() => () => parts.dispose(), [parts]);
  useFrame((state, dt) => {
    if (!g.current) return;
    const p = rel(worldPos(obj));
    g.current.position.set(p[0], p[1], p[2]);
    if (spin.current) spin.current.rotation.y += dt * 0.05;
    if (cloudSpin.current) cloudSpin.current.rotation.y += dt * 0.065;
    _center.set(p[0], p[1], p[2]);
    if (star) { const s = rel(worldPos(star)); _sun.set(s[0], s[1], s[2]); }
    parts.tick(state.clock.elapsedTime, _center, _sun);
  });
  const segs = parts.segments;
  return (
    <group ref={g}>
      <group rotation={[0, 0, parts.tilt]}>
        <mesh ref={spin} material={parts.surface}>
          <sphereGeometry args={[r, segs, segs]} />
          {/* Lava thrown from the volcanoes turns with the surface it came from. */}
          {parts.eruptions && <primitive object={parts.eruptions.points} />}
        </mesh>
        {parts.clouds && (
          <mesh ref={cloudSpin} material={parts.clouds} scale={1.015}>
            <sphereGeometry args={[r, 64, 64]} />
          </mesh>
        )}
        {parts.rings && (
          <mesh material={parts.rings.material} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[parts.rings.inner, parts.rings.outer, 128, 1]} />
          </mesh>
        )}
      </group>
      {parts.atmosphere && (
        <mesh material={parts.atmosphere} scale={parts.atmoExtent}>
          <sphereGeometry args={[r, 32, 32]} />
        </mesh>
      )}
      {parts.aurora && (
        <mesh material={parts.aurora} scale={AURORA_EXTENT}>
          <sphereGeometry args={[r, 32, 32]} />
        </mesh>
      )}
    </group>
  );
}

// ---- a star: churning plasma surface + streaming corona (starShader.js),
// with coronal loops rising off the surface, some erupting (flareLoops.js) and
// throwing off clouds that travel on after the star is out of range (Ejecta) -
const _starCenter = new THREE.Vector3();
function StarMesh({ obj }) {
  const g = useRef();
  const r = obj.size || 1;
  const mats = useMemo(() => makeStarMaterials(obj), [obj.id]);
  const loops = useMemo(() => makeFlareLoops(obj, mats), [mats]);
  useEffect(() => () => { mats.surface.dispose(); mats.corona.dispose(); }, [mats]);
  useEffect(() => () => loops.dispose(), [loops]);
  useEffect(() => {
    // Launch from the torn apex, in absolute world space: the cloud is the
    // shared pool's from here on, not this star's.
    loops.onBurst = (d, span, height, giant) => {
      const c = worldPos(obj), lift = r * (1 + height);
      ejecta.launch({
        t: ejectaClock(),
        at: [c[0] + d.x * lift, c[1] + d.y * lift, c[2] + d.z * lift],
        d, radius: r, color: obj.color,
        cone: Math.min(0.8, 0.15 + span * 0.9),
        speed: (giant ? 5 + Math.random() * 3 : 2.5 + Math.random() * 2.5),
        source: obj.name,
      });
    };
    return () => { loops.onBurst = null; };
  }, [loops]);
  useFrame((state, dt) => {
    if (!g.current) return;
    const p = rel(worldPos(obj));
    g.current.position.set(p[0], p[1], p[2]);
    g.current.rotation.y += dt * 0.05;
    const t = state.clock.elapsedTime;
    mats.surface.uniforms.uTime.value = t;
    mats.corona.uniforms.uTime.value = t;
    mats.corona.uniforms.uCenter.value.set(p[0], p[1], p[2]);
    loops.tick(t, _starCenter.set(p[0], p[1], p[2]), g.current.quaternion);
  });
  return (
    <group ref={g}>
      <mesh material={mats.surface}>
        <sphereGeometry args={[r, 64, 64]} />
      </mesh>
      {/* bent in the vertex shader, so three's bounds don't know where it is */}
      <mesh geometry={loops.geometry} material={loops.material} scale={r} frustumCulled={false} />
      <mesh material={mats.corona} scale={CORONA_EXTENT}>
        <sphereGeometry args={[r, 32, 32]} />
      </mesh>
      <pointLight color={obj.color} intensity={2.4} distance={0} decay={0} />
    </group>
  );
}

// ---- a black hole: dark event horizon, a lensed photon ring, a tilted
// accretion disk, and polar jets — light finding a way out at the poles -----
function BlackHoleMesh({ obj }) {
  const g = useRef();
  const disk = useRef();
  const jetTop = useRef();
  const jetBot = useRef();
  const r = obj.size || 3;
  useFrame((state, dt) => {
    if (!g.current) return;
    const p = rel(worldPos(obj));
    g.current.position.set(p[0], p[1], p[2]);
    if (disk.current) disk.current.rotation.z += dt * 0.3;
    const pulse = 0.6 + 0.4 * Math.sin(state.clock.elapsedTime * 3 + r);
    if (jetTop.current) jetTop.current.material.opacity = 0.45 * pulse;
    if (jetBot.current) jetBot.current.material.opacity = 0.45 * pulse;
  });
  return (
    <group ref={g}>
      {/* event horizon — true black, reflects and emits nothing */}
      <mesh>
        <sphereGeometry args={[r, 32, 32]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      {/* photon ring: a thin bright rim hugging the horizon (lensed-light stand-in) */}
      <mesh rotation={[Math.PI / 2.15, 0, 0]}>
        <torusGeometry args={[r * 1.06, r * 0.035, 8, 64]} />
        <meshBasicMaterial color="#ffe9c2" transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* accretion disk, tilted so it reads as a disk rather than a flat ring */}
      <mesh ref={disk} rotation={[Math.PI / 2.15, 0, 0]}>
        <torusGeometry args={[r * 2.4, r * 0.9, 12, 96]} />
        <meshBasicMaterial color="#ff9a4d" transparent opacity={0.35} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* faint ambient glow from the disk lighting up nearby space */}
      <mesh scale={2.2}>
        <sphereGeometry args={[r, 24, 24]} />
        <meshBasicMaterial color="#ff6a3d" transparent opacity={0.06} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {/* relativistic jets — light escaping along the poles */}
      <mesh ref={jetTop} position={[0, r * 4, 0]}>
        <coneGeometry args={[r * 0.4, r * 8, 16, 1, true]} />
        <meshBasicMaterial color="#cfe8ff" transparent opacity={0.45} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={jetBot} position={[0, -r * 4, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[r * 0.4, r * 8, 16, 1, true]} />
        <meshBasicMaterial color="#cfe8ff" transparent opacity={0.45} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <pointLight color="#ff9a4d" intensity={1.4} distance={0} decay={0} />
    </group>
  );
}

// ---- a beacon: small, faceted, artificial-looking — deliberately unlike the
// smooth spheres every natural body (star/planet/moon) uses, so it reads as
// "not a rock" at a glance. A wireframe cage plus a light pulsing on its own
// clock is the visual counterpart to the steady, too-regular Subspace ping
// that makes it stand out on COMMS (see signals.js/audio.js "beacon").
function BeaconMesh({ obj }) {
  const g = useRef();
  const core = useRef();
  const r = obj.size || 0.25;
  useFrame((state, dt) => {
    if (!g.current) return;
    const p = rel(worldPos(obj));
    g.current.position.set(p[0], p[1], p[2]);
    g.current.rotation.y += dt * 0.6;
    g.current.rotation.x += dt * 0.25;
    if (core.current) {
      const pulse = 0.3 + 0.7 * Math.max(0, Math.sin(state.clock.elapsedTime * 2.2));
      core.current.material.opacity = pulse;
    }
  });
  return (
    <group ref={g}>
      <mesh>
        <octahedronGeometry args={[r, 0]} />
        <meshStandardMaterial color={obj.color} metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh>
        <octahedronGeometry args={[r * 1.9, 0]} />
        <meshBasicMaterial color={obj.color} wireframe transparent opacity={0.5} />
      </mesh>
      <mesh ref={core} scale={0.35}>
        <sphereGeometry args={[r, 8, 8]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={1} />
      </mesh>
      <pointLight color={obj.color} intensity={1} distance={0} decay={0} />
    </group>
  );
}

// ---- the local systems: every star within render range + their planets/moons
// (not just the single nearest one) so a destination grows in gradually as you
// approach instead of its whole system popping into existence at the last
// moment. The HUD's "current system" label still names the true nearest star.
// Black holes get the same early-render treatment, from farther out.
function LocalSystem() {
  const [starIds, setStarIds] = useState([]);
  const [bhIds, setBhIds] = useState([]);
  const [beaconIds, setBeaconIds] = useState([]);
  useEffect(() => {
    const tick = () => {
      const nearStars = starsWithin(SYSTEM_RENDER_RANGE);
      const nearBH = blackholesWithin(BLACKHOLE_RENDER_RANGE);
      const nearBeacons = beaconsWithin(BEACON_RENDER_RANGE);
      setStarIds(nearStars.map((s) => s.id));
      setBhIds(nearBH.map((o) => o.id));
      setBeaconIds(nearBeacons.map((o) => o.id));
      renderedBodyIds.clear();
      nearStars.forEach((s) => renderedBodyIds.add(s.id));
      nearBH.forEach((o) => renderedBodyIds.add(o.id));
      nearBeacons.forEach((o) => renderedBodyIds.add(o.id));
      const { star } = nearestStar();
      useUI.getState().setSystemName(star ? star.name : "deep space");
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);
  const bodies = useMemo(
    () => starIds.flatMap((id) => systemBodies(sim.byId[id])),
    [starIds.join(",")]
  );
  const blackholes = useMemo(() => bhIds.map((id) => sim.byId[id]), [bhIds.join(",")]);
  const beaconBodies = useMemo(() => beaconIds.map((id) => sim.byId[id]), [beaconIds.join(",")]);
  return (
    <>
      {bodies.map((b) => b.type === "star" ? <StarMesh key={b.id} obj={b} /> : <BodyMesh key={b.id} obj={b} />)}
      {blackholes.map((b) => <BlackHoleMesh key={b.id} obj={b} />)}
      {beaconBodies.map((b) => <BeaconMesh key={b.id} obj={b} />)}
    </>
  );
}

// ---- coronal mass ejections from every star, one shared pool (ejecta.js) ---
function Ejecta() {
  const { size, camera } = useThree();
  useFrame((state) => {
    // gl_PointSize is in device pixels, `size` in CSS pixels.
    const pxScale = (size.height * state.gl.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    ejecta.tick(ejectaClock(), sim.pos, pxScale);
  });
  // Placed per particle in the vertex shader, so three's bounds are meaningless.
  return <points geometry={ejecta.geometry} material={ejecta.material} frustumCulled={false} />;
}

// ---- a Collective cube, when one is out (collective.js, cubeMesh.js) -------
// Polls for the cube rather than subscribing: it comes and goes from the
// sim loop, and a new cube (a new id) gets fresh meshes.
function CollectiveCube() {
  const [id, setId] = useState(null);
  useFrame(() => {
    const now = collective.cube?.id ?? null;
    if (now !== id) setId(now);
  });
  return id ? <CubeBody key={id} /> : null;
}
function CubeBody() {
  const cube = collective.cube;
  const parts = useMemo(() => makeCubeMesh(cube.blocks.length), [cube]);
  useEffect(() => () => {
    parts.mesh.geometry.dispose(); parts.mesh.material.dispose();
    parts.beams.forEach((b) => b.material.dispose());
    parts.tractor.material.dispose();
  }, [parts]);
  useFrame((state) => {
    if (collective.cube === cube) parts.update(cube, sim.pos, state.clock.elapsedTime);
  });
  return (
    <>
      <primitive object={parts.mesh} />
      {parts.beams.map((b, i) => <primitive key={i} object={b} />)}
      <primitive object={parts.tractor} />
    </>
  );
}

// ---- warp streaks ----------------------------------------------------------
// See warpStreaks.js. The streaks are laid out along local +z; the wrapping
// group is turned each frame so local +z is view.facing, so they always rush
// out of the point the ship is aimed at.
const STREAK_AXIS = new THREE.Vector3(0, 0, 1);
function WarpStreaks() {
  const groupRef = useRef();
  const flashRef = useRef();
  const { size } = useThree();
  const facing = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, dt) => {
    const pr = state.gl.getPixelRatio();
    warpStreaks.tick(Math.min(dt, 0.1), sim.mode === "warp", sim.warpFactor, size.width * pr, size.height * pr, pr);
    const f = view.facing;
    groupRef.current.quaternion.setFromUnitVectors(STREAK_AXIS, facing.set(f[0], f[1], f[2]).normalize());
    groupRef.current.visible = warpStreaks.visible;
    flashRef.current.visible = warpStreaks.flashing;
  });
  return (
    <>
      <group ref={groupRef}>
        <mesh geometry={warpStreaks.geometry} material={warpStreaks.material} frustumCulled={false} />
      </group>
      <mesh ref={flashRef} geometry={warpStreaks.flashGeometry} material={warpStreaks.flashMaterial} frustumCulled={false} renderOrder={10} />
    </>
  );
}

// ---- camera rig: first-person at the ship --------------------------------
// Magnification (lens.js) narrows the fov, and a held target swings the view
// off the bow onto it — both eased, so a `magnify` order pans and zooms
// rather than cuts.
const ZOOM_RATE = 4; // 1/s — about 95% of the way there in 0.75s
const SNAP_COS = Math.cos((0.5 * Math.PI) / 180); // within half a degree of ahead → lock to it
function CameraRig() {
  const { camera } = useThree();
  const look = useMemo(() => new THREE.Vector3(...view.facing), []);
  const want = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const f = view.facing;
    const k = 1 - Math.exp(-ZOOM_RATE * dt);
    const target = lens.targetId && sim.byId[lens.targetId];
    if (target) {
      const p = rel(worldPos(target));
      want.set(p[0], p[1], p[2]).normalize();
    } else {
      want.set(f[0], f[1], f[2]);
    }
    // Ahead with no target and already (nearly) there: lock on, so ordinary
    // turns track the heading exactly, as they did before there was a lens.
    if (!target && look.dot(want) > SNAP_COS) look.copy(want);
    else look.lerp(want, k).normalize();
    // Roll about the view axis after lookAt (local +Z points back at the
    // viewer, so + rotates the horizon clockwise = leaning to port).
    camera.position.set(0, 0, 0);
    camera.lookAt(look.x * 10, look.y * 10, look.z * 10);
    camera.rotateZ(view.bank);
    const fov = BASE_FOV / lens.zoom;
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov += (fov - camera.fov) * k;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

export default function Scene() {
  return (
    <Canvas camera={{ position: [0, 0, 0], fov: BASE_FOV / lens.zoom, near: 0.05, far: 4000 }}>
      <color attach="background" args={["#01010a"]} />
      <ambientLight intensity={0.08} />
      <CameraRig />
      <Stars radius={200} depth={80} count={2000} factor={5} fade speed={0.1} />
      <GalaxyField />
      <LocalSystem />
      <Ejecta />
      <CollectiveCube />
      <WarpStreaks />
    </Canvas>
  );
}
