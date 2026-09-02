import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useGame } from "../game/state.js";

// Map a star's spectral class to a colour + a very dark background tint, so
// every system reads as a distinct place the moment you arrive.
function starLook(starType = "") {
  if (starType.includes("M-type"))
    return { star: "#ff6a48", bg: "#0a0304", halo: "#ff8866" };
  if (starType.includes("A-type"))
    return { star: "#bcd0ff", bg: "#05060d", halo: "#dde8ff" };
  return { star: "#ffe6a8", bg: "#07060a", halo: "#ffdf9c" }; // G-type default
}

// The rushing star streaks. In cruise they drift slowly; during warp their
// velocity ramps way up and they stretch into a tunnel past the camera.
function WarpField({ speedRef }) {
  const ref = useRef();
  const COUNT = 900;
  const positions = useMemo(() => {
    const a = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      a[i * 3] = (Math.random() - 0.5) * 22;
      a[i * 3 + 1] = (Math.random() - 0.5) * 22;
      a[i * 3 + 2] = -Math.random() * 70;
    }
    return a;
  }, []);

  useFrame((_, dt) => {
    if (!ref.current) return;
    const pos = ref.current.geometry.attributes.position.array;
    const v = speedRef.current;
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3 + 2] += v * dt;
      if (pos[i * 3 + 2] > 7) {
        pos[i * 3 + 2] = -70;
        pos[i * 3] = (Math.random() - 0.5) * 22;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 22;
      }
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
    // Brighter/larger points as we accelerate — reads as streaking.
    ref.current.material.size = 0.05 + Math.min(v / 55, 1) * 0.22;
    ref.current.material.opacity = 0.5 + Math.min(v / 55, 1) * 0.5;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={COUNT}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        color="#cfe0ff"
        transparent
        opacity={0.6}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// The system's star, sitting far back as a coloured glow. Gives the whole
// scene its ambient identity.
function DistantStar({ color, halo }) {
  return (
    <group position={[-6, 3.5, -45]}>
      <mesh>
        <sphereGeometry args={[5, 32, 32]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh>
        <sphereGeometry args={[9, 32, 32]} />
        <meshBasicMaterial
          color={halo}
          transparent
          opacity={0.18}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// The on-screen target: a lit globe (strong terminator) with a faint
// atmosphere, or a metallic box for a derelict.
function Body({ color, size, isDerelict }) {
  const mesh = useRef();
  useFrame((_, dt) => {
    if (mesh.current) mesh.current.rotation.y += dt * 0.06;
  });
  return (
    <group position={[1.2, -0.1, 0]}>
      <mesh ref={mesh}>
        {isDerelict ? (
          <boxGeometry args={[size * 1.7, size * 0.5, size * 0.5]} />
        ) : (
          <sphereGeometry args={[size, 64, 64]} />
        )}
        <meshStandardMaterial
          color={color}
          roughness={isDerelict ? 0.4 : 0.9}
          metalness={isDerelict ? 0.7 : 0.05}
        />
      </mesh>
      {!isDerelict && (
        <mesh scale={1.06}>
          <sphereGeometry args={[size, 48, 48]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.12}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.BackSide}
          />
        </mesh>
      )}
    </group>
  );
}

// Drives camera: FOV punch during warp, gentle push-in when a body appears,
// and the star-speed ramp.
function Director({ warping, hasBody, speedRef }) {
  const { camera } = useThree();
  useFrame((_, dt) => {
    const k = (rate) => Math.min(1, dt * rate);

    const targetSpeed = warping ? 55 : 1.4;
    speedRef.current += (targetSpeed - speedRef.current) * k(3);

    const targetFov = warping ? 80 : 55;
    camera.fov += (targetFov - camera.fov) * k(4);

    const targetZ = warping ? 6 : hasBody ? 4.7 : 6;
    camera.position.z += (targetZ - camera.position.z) * k(2);

    camera.updateProjectionMatrix();
  });
  return null;
}

export default function Viewscreen() {
  const target = useGame((s) => s.target);
  const bodies = useGame((s) => s.world.bodies);
  const warping = useGame((s) => s.isWarping);
  const starType = useGame(
    (s) => s.world.systems[s.currentSystem].star
  );
  const body = target ? bodies[target] : null;
  const look = starLook(starType);
  const speedRef = useRef(1.4);

  return (
    <Canvas camera={{ position: [0, 0, 6], fov: 55 }}>
      <color attach="background" args={[look.bg]} />
      <ambientLight intensity={0.12} />
      <directionalLight position={[6, 2, 4]} intensity={1.5} />
      <Director warping={warping} hasBody={!!body} speedRef={speedRef} />
      <Stars radius={90} depth={60} count={3500} factor={4} fade speed={0.2} />
      <WarpField speedRef={speedRef} />
      <DistantStar color={look.star} halo={look.halo} />
      {body && !warping && (
        <Body
          color={body.color}
          size={body.size}
          isDerelict={body.type === "derelict"}
        />
      )}
    </Canvas>
  );
}
