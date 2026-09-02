// Chart.jsx — the tactical chart, in 3D. Same floating-origin convention as
// Scene.jsx (everything drawn relative to sim.pos, re-centered every frame),
// but flown with OrbitControls instead of the ship's own camera, so you can
// pan/rotate/zoom around your position freely. Also draws the ship's plotted
// course (see engine.js's courseWaypoints() / sim.js's route planning).
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html, Grid } from "@react-three/drei";
import { useEffect, useRef, useState, useMemo } from "react";
import * as THREE from "three";
import { sim, view, worldPos, nearbyObjects, courseWaypoints } from "./engine.js";

const MAX_RANGE = 500; // candidate bodies refreshed within this radius; zoom/rotate freely within it
const COURSE_SAMPLES = 48;

const STYLE = {
  star:      { size: 2.2, label: true },
  planet:    { size: 1.1, label: true },
  moon:      { size: 0.5, color: "#8a8f99", label: false },
  blackhole: { size: 1.6, color: "#ff3b30", label: true, ring: true },
  pulsar:    { size: 1.0, color: "#dfefff", label: true },
  nebula:    { size: 2.6, label: true }
};

// ---- one body, floating-origin, self-updating every frame ------------------
function ChartBody({ obj }) {
  const ref = useRef();
  const st = STYLE[obj.type] || STYLE.planet;
  useFrame(() => {
    if (!ref.current) return;
    const p = worldPos(obj);
    ref.current.position.set(p[0] - sim.pos[0], p[1] - sim.pos[1], p[2] - sim.pos[2]);
  });
  const color = st.color || obj.color || "#ffffff";
  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[st.size, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {st.ring && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[st.size * 1.5, st.size * 1.9, 32]} />
          <meshBasicMaterial color="#ff3b30" transparent opacity={0.75} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {st.label && (
        <Html distanceFactor={45} style={hudLabelStyle}>
          {obj.name}
        </Html>
      )}
    </group>
  );
}

const hudLabelStyle = {
  color: "#cbd6ea", fontFamily: "Oswald, sans-serif", fontSize: 12,
  whiteSpace: "nowrap", pointerEvents: "none", transform: "translate(9px,-6px)", textShadow: "0 1px 3px #000"
};

// ---- the ship marker, at the origin, pointed along view.facing -------------
function ShipMarker() {
  const g = useRef();
  useFrame(() => {
    if (!g.current) return;
    const f = view.facing;
    g.current.lookAt(f[0] * 10, f[1] * 10, f[2] * 10);
  });
  return (
    <group ref={g}>
      <mesh rotation={[Math.PI / 2, 0, 0]} scale={2.4}>
        <coneGeometry args={[0.5, 2, 12]} />
        <meshBasicMaterial color="#ffcc33" />
      </mesh>
    </group>
  );
}

// ---- the plotted course: current position -> bends -> destination, drawn as
// a smooth curve through those control points. World-space samples are
// cached and only re-fit when the waypoints/destination change (cheap check
// each frame); the floating-origin offset is re-applied every frame so the
// line stays smooth as the ship moves through it. ---------------------------
function CourseLine() {
  const ref = useRef();
  const positions = useMemo(() => new Float32Array(COURSE_SAMPLES * 3), []);
  const cache = useRef({ sig: "", worldPts: [] });

  useFrame(() => {
    if (!ref.current) return;
    const wp = courseWaypoints(); // [shipPos, ...bends, destination], world-space
    if (wp.length < 2) { ref.current.visible = false; return; }

    // Cache key ignores wp[0] (the ship's own position, changes every frame)
    // so re-fitting the curve only happens when the actual course changes.
    const sig = wp.slice(1).map((p) => p.map((n) => n.toFixed(1)).join(",")).join("|");
    if (sig !== cache.current.sig) {
      const curve = new THREE.CatmullRomCurve3(wp.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
      const n = Math.min(COURSE_SAMPLES, Math.max(wp.length * 10, 12));
      cache.current = { sig, worldPts: curve.getPoints(n - 1) };
    }

    const pts = cache.current.worldPts;
    const arr = ref.current.geometry.attributes.position.array;
    const n = Math.min(pts.length, COURSE_SAMPLES);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = pts[i].x - sim.pos[0];
      arr[i * 3 + 1] = pts[i].y - sim.pos[1];
      arr[i * 3 + 2] = pts[i].z - sim.pos[2];
    }
    ref.current.geometry.setDrawRange(0, n);
    ref.current.geometry.attributes.position.needsUpdate = true;
    ref.current.visible = true;
  });

  return (
    <line ref={ref} visible={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={COURSE_SAMPLES} array={positions} itemSize={3} />
      </bufferGeometry>
      <lineBasicMaterial color="#7fd7ff" transparent opacity={0.9} />
    </line>
  );
}

// ---- periodically-refreshed set of nearby bodies to render -----------------
function ChartBodies() {
  const [ids, setIds] = useState([]);
  useEffect(() => {
    const tick = () => setIds(nearbyObjects(MAX_RANGE).map((n) => n.o.id));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);
  return ids.map((id) => <ChartBody key={id} obj={sim.byId[id]} />);
}

export default function Chart() {
  const [status, setStatus] = useState("No course laid in.");
  useEffect(() => {
    const iv = setInterval(() => {
      const verb = sim.mode === "warp" ? "Warp" : "Course";
      if (sim.heading?.type === "hold") setStatus(`Holding station at ${sim.byId[sim.heading.id]?.name ?? "contact"} — tracking its orbit.`);
      else if (sim.waypoints.length) setStatus(`${verb} bending around ${sim.waypoints.length} hazard${sim.waypoints.length > 1 ? "s" : ""}.`);
      else if (sim.heading) setStatus(`${verb} clear — direct line.`);
      else if (sim.mode === "warp") setStatus("Warping ahead — no destination set.");
      else setStatus("No course laid in.");
    }, 200);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="chart3d-overlay">
      <div className="chart-head">
        <span>TACTICAL CHART · 3D — drag to rotate, scroll to zoom, right-drag to pan</span>
        <span className="chart-status">{status}</span>
      </div>

      <Canvas className="chart3d-canvas" camera={{ position: [0, 150, 280], fov: 55, near: 0.1, far: 6000 }}>
        <color attach="background" args={["#01030a"]} />
        <ambientLight intensity={0.5} />
        <Grid
          args={[2000, 2000]}
          cellSize={20} cellThickness={0.5} cellColor="#16233d"
          sectionSize={100} sectionThickness={1} sectionColor="#2a3f66"
          fadeDistance={700} fadeStrength={1.5}
          infiniteGrid
        />
        <ShipMarker />
        <CourseLine />
        <ChartBodies />
        <OrbitControls target={[0, 0, 0]} enableDamping dampingFactor={0.08} minDistance={12} maxDistance={900} />
      </Canvas>

      <div className="chart-legend">
        <span><i style={{ background: "#ffe6a8" }} />star</span>
        <span><i style={{ background: "#3b7d5a" }} />planet</span>
        <span><i style={{ background: "#ff3b30" }} />anomaly</span>
        <span><i style={{ background: "#dfefff" }} />pulsar</span>
        <span><i style={{ background: "#ffcc33" }} />you</span>
        <span><i style={{ background: "#7fd7ff" }} />plotted course</span>
      </div>
    </div>
  );
}
