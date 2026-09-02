// physics.js — the two systems, kept deliberately separate.
//
//   1. positionAt(): where a body is at time t. On-rails / kinematic — a pure
//      function of time. Circular by construction, deterministic, never drifts.
//      Orbits are hierarchical: a moon's orbit is relative to its planet, whose
//      orbit is relative to its star, whose orbit is relative to the core.
//
//   2. gravityOnShip(): the pull every massive body exerts ON THE SHIP. Bodies
//      never feel this — they're on rails — so nothing goes chaotic. This is
//      where slingshots and hazards live.
//
// No imports on purpose: node (generator, tests) and the browser (the game)
// both use this exact file.

const TAU = Math.PI * 2;

// Rotate a point around the X axis by `inc` (orbital inclination / tilt).
function tilt([x, y, z], inc) {
  const c = Math.cos(inc), s = Math.sin(inc);
  return [x, y * c - z * s, y * s + z * c];
}

// World-space position of an object at time t (seconds). Walks up the parent
// chain, adding each orbit. Root objects (parent === null) sit at their fixed
// point — for us, the galactic core at the origin.
export function positionAt(obj, byId, t, _depth = 0) {
  if (!obj) return [0, 0, 0];
  if (obj.parent == null || _depth > 8) {
    return obj.fixed ?? [0, 0, 0];
  }
  const parent = byId[obj.parent];
  const p = positionAt(parent, byId, t, _depth + 1);

  const { radius, period, phase, inclination = 0 } = obj.orbit;
  const theta = phase + TAU * (t / period);
  const local = tilt(
    [radius * Math.cos(theta), 0, radius * Math.sin(theta)],
    inclination
  );
  return [p[0] + local[0], p[1] + local[1], p[2] + local[2]];
}

// Net gravitational acceleration on the ship from nearby massive bodies.
// Softened (r^2 + eps) so passing through a body's centre doesn't blow up, and
// cutoff so we only sum bodies whose pull actually matters — cheap even with
// thousands of objects. Returns the vector plus the dominant body (for UI:
// "entering the gravity well of ...").
export function gravityOnShip(shipPos, objects, byId, t, opts = {}) {
  const G = opts.G ?? 0.06;
  const eps = opts.softening ?? 4;
  const cutoff = opts.cutoff ?? 600;
  const cutoff2 = cutoff * cutoff;

  let ax = 0, ay = 0, az = 0;
  let strongest = null, strongestMag = 0;

  for (const o of objects) {
    if (!o.mass) continue;
    const pos = positionAt(o, byId, t);
    const dx = pos[0] - shipPos[0];
    const dy = pos[1] - shipPos[1];
    const dz = pos[2] - shipPos[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > cutoff2) continue;

    const invD = 1 / Math.sqrt(d2 + eps * eps);
    const mag = (G * o.mass) * invD * invD; // G*m / (r^2 + eps^2)
    ax += dx * invD * mag;
    ay += dy * invD * mag;
    az += dz * invD * mag;

    if (mag > strongestMag) { strongestMag = mag; strongest = o; }
  }
  return { accel: [ax, ay, az], strongest, strongestMag };
}

// Convenience: magnitude of a vector.
export function magnitude([x, y, z]) {
  return Math.sqrt(x * x + y * y + z * z);
}
