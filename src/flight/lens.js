// lens.js — the main viewer's magnification and where it's pointed. Read
// every frame by Scene.jsx's CameraRig (which eases the camera toward it), set
// by the `magnify` order in FlightApp.jsx. Plain module state, no imports, so
// the parser below can be tested under node alongside the universe.

export const BASE_FOV = 60;
export const MAX_ZOOM = 10;
// How far off the bow the viewer can swing to hold a target, in degrees.
// Past that, the order is refused (or a held target dropped) — come about.
export const MAX_ARC = 75;

export const lens = {
  zoom: 1, // 1 = normal view; the camera's fov is BASE_FOV / zoom
  targetId: null, // a body the viewer is held on, instead of looking ahead
  targetName: null, // its name, for the HUD and the log
};

export const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(1, z));

// What follows "magnify" → what the order asks for. Each parameter is its own
// clause, so a new one only needs a branch here and a field on `lens`.
//   ""                         → {}                 (report)
//   "off" | "reset" | "clear"  → { reset: true }    (×1, looking ahead)
//   "ahead" | "forward"        → { ahead: true }    (drop the target, keep the zoom)
//   "in" | "out"               → { step: 2 | 0.5 }
//   "4" | "x4" | "4x" | "400%" → { zoom: 4 }
//   "Erebus" | "on Erebus"     → { target: "Erebus" }
//   "6 on Erebus"              → { zoom: 6, target: "Erebus" }
export function parseMagnify(rest) {
  const raw = rest.trim();
  const r = raw.toLowerCase();
  if (!r) return {};
  if (/^(off|reset|clear|normal)$/.test(r)) return { reset: true };
  if (/^(ahead|forward|front)$/.test(r)) return { ahead: true };
  if (r === "in") return { step: 2 };
  if (r === "out") return { step: 0.5 };
  // A suffix only counts when it ends a word, so "4 xeno" is ×4 on Xeno.
  const m = raw.match(/^(?:(?:x|times\s+)?(\d+(?:\.\d+)?)(?:\s*(%|x|times)(?=\s|$))?)?\s*(?:(?:on|at|to)\s+)?(.*)$/i);
  const out = {};
  if (m[1]) out.zoom = m[2] === "%" ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  const name = m[3].trim();
  if (name) {
    if (/^(on|at|to)$/i.test(name)) return { error: raw };
    out.target = name;
  }
  return out;
}
