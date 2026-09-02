// route.js — obstacle-aware waypoint planning for impulse navigation. Given a
// straight start->destination leg, checks whether any massive body sits close
// enough to the line to be a hazard, and if so bends the path around it with
// one waypoint per conflicting body. Pure geometry, no imports — testable in
// node exactly like physics.js/flight.js.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const magnitude = (a) => Math.sqrt(dot(a, a));
const unit = (a) => { const m = magnitude(a) || 1; return scale(a, 1 / m); };

// The "don't bump into it" bubble around a body — bigger than its visual mesh
// so a plotted course visibly skirts it, plus a flat margin.
export function clearanceRadius(obj) {
  return (obj.size || 1) * 4 + 4;
}

// Closest point on segment a->b to point p, as {t, point, dist}.
function closestOnSegment(a, b, p) {
  const ab = sub(b, a);
  const len2 = dot(ab, ab) || 1e-9;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  const point = add(a, scale(ab, t));
  return { t, point, dist: magnitude(sub(p, point)) };
}

// Plan a route from `start` to `dest` (world-space [x,y,z]) that clears every
// body in `bodies` ({id, name, size, pos}) by at least its clearanceRadius.
// Returns { points, bent, hazards }: points always starts with `start` and
// ends with `dest`; anything between is a bend inserted to clear a hazard.
export function planRoute(start, dest, bodies, opts = {}) {
  const maxBends = opts.maxBends ?? 3;
  // Extra padding beyond the bare clearance radius. Generous by design: the
  // ship doesn't stop exactly on a bend waypoint, it starts steering for the
  // next leg once within the waypoint's pass-by radius (sim.js, ~6 units) and
  // cuts the corner — this margin needs to absorb that shortcut, not just the
  // planning error, or a tight bend can still nick the hazard it was meant to
  // clear.
  const margin = opts.margin ?? 10;

  if (magnitude(sub(dest, start)) < 1e-6) return { points: [start, dest], bent: false, hazards: [] };

  const hazards = [];
  for (const b of bodies) {
    const clr = clearanceRadius(b);
    const { t, point, dist } = closestOnSegment(start, dest, b.pos);
    if (t <= 0.02 || t >= 0.98) continue; // ignore anything essentially at either endpoint
    if (dist < clr) hazards.push({ body: b, t, point, dist, clr, penetration: clr - dist });
  }

  if (hazards.length === 0) return { points: [start, dest], bent: false, hazards: [] };

  // Worst penetrations first (most urgent to route around), then re-order the
  // ones we act on by position along the path so the polyline stays sane.
  hazards.sort((a, b) => b.penetration - a.penetration);
  const worst = hazards.slice(0, maxBends).sort((a, b) => a.t - b.t);

  const points = [start];
  for (const h of worst) {
    let away = sub(h.point, h.body.pos);
    if (magnitude(away) < 1e-6) {
      // Dead-on-center (rare): push perpendicular to the flight path instead.
      const dir = unit(sub(dest, start));
      away = Math.abs(dir[1]) < 0.9 ? [-dir[2], 0, dir[0]] : [1, 0, 0];
    }
    away = unit(away);
    points.push(add(h.point, scale(away, h.clr - h.dist + margin)));
  }
  points.push(dest);

  return { points, bent: true, hazards: worst };
}
