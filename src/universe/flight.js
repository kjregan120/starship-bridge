// flight.js — the ship's two movement modes, as pure functions.
//
//   WARP: interstellar. speed = k * factor^exp  (TNG uses exp = 10/3). At warp
//         we ignore local gravity — the ship is in a bubble and moving too fast
//         for it to matter. Used to cross the gaps between stars.
//
//   IMPULSE: sublight, in-system. Real integration under thrust + gravity, so
//            you feel wells, curve past planets, and can slingshot. Capped at a
//            modest top speed so a system feels like a place you move around in.
//
// k is the one calibration knob that ties warp to the size of your galaxy.

export const DEFAULT_FLIGHT = {
  warpK: 0.22,        // scales the whole warp curve to the universe's size
  warpExp: 10 / 3,    // TNG-style: each factor is a big jump over the last
  impulseMax: 2.0,    // top sublight speed (units/sec)
  impulseAccel: 1.4,  // how hard the ship can push (units/sec^2)
  warpFloorMass: 0.3, // bodies lighter than this never block warp
  warpFloorK: 10,     // no-warp radius around a body = K * sqrt(mass)... (was
                      // 20; that put ~33% of all planets/moons inside their
                      // own star's bubble, blocking warp right where you'd
                      // naturally be after flying in under impulse — halved
                      // so it only bites close-in, ~9% of bodies)
  warpFloorMaxRadius: 110 // ...capped here, so the supermassive core makes a
                          // dramatic but finite no-warp zone, not a galaxy-wide one
};

// Warp factor -> units/second. Factor 0 = stopped.
export function warpSpeed(factor, cfg = DEFAULT_FLIGHT) {
  if (factor <= 0) return 0;
  return cfg.warpK * Math.pow(factor, cfg.warpExp);
}

export function travelTime(distance, speed) {
  return speed > 0 ? distance / speed : Infinity;
}

// One impulse tick. thrustDir is a (roughly) unit vector or [0,0,0] to coast.
// gravAccel comes from gravityOnShip(). Returns the next {pos, vel}. Speed is
// clamped to impulseMax UNLESS coasting under gravity (so slingshots can bank
// extra speed the way real ones do).
export function stepImpulse(state, dt, thrustDir, gravAccel = [0, 0, 0], cfg = DEFAULT_FLIGHT) {
  let [vx, vy, vz] = state.vel;
  const a = cfg.impulseAccel;
  vx += (thrustDir[0] * a + gravAccel[0]) * dt;
  vy += (thrustDir[1] * a + gravAccel[1]) * dt;
  vz += (thrustDir[2] * a + gravAccel[2]) * dt;

  const thrusting = thrustDir[0] || thrustDir[1] || thrustDir[2];
  if (thrusting) {
    const sp = Math.hypot(vx, vy, vz);
    if (sp > cfg.impulseMax) {
      const s = cfg.impulseMax / sp;
      vx *= s; vy *= s; vz *= s;
    }
  }
  const [px, py, pz] = state.pos;
  return { pos: [px + vx * dt, py + vy * dt, pz + vz * dt], vel: [vx, vy, vz] };
}

// Whether warp can engage from here. Each heavy body has a no-warp bubble that
// scales with its mass, so you must clear a star (small bubble) or give a black
// hole / the galactic core a very wide berth (large bubble) before jumping.
export function canWarp(shipPos, objects, byId, positionAt, t, cfg = DEFAULT_FLIGHT) {
  let worst = null, worstRatio = 1;
  for (const o of objects) {
    const m = o.mass ?? 0;
    if (m < cfg.warpFloorMass) continue;
    const p = positionAt(o, byId, t);
    const d = Math.hypot(p[0] - shipPos[0], p[1] - shipPos[1], p[2] - shipPos[2]);
    const r = Math.min(cfg.warpFloorK * Math.sqrt(m), cfg.warpFloorMaxRadius);
    if (d < r) {
      const ratio = r / Math.max(d, 0.001);
      if (ratio > worstRatio) { worstRatio = ratio; worst = o; }
    }
  }
  return worst ? { ok: false, blockedBy: worst } : { ok: true };
}
