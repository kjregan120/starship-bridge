// shipShape.js — the USS Meridian's top-down outline, shared by the Science
// schematic and the Crew deck plan. Nose up, port on the left (looking down
// from galactic up); the four sections match HULL_SECTIONS in ship.js.
export const HULL_PATHS = {
  fore: "M0,-262 C20,-242 38,-196 46,-120 L-46,-120 C-38,-196 -20,-242 0,-262 Z",
  port: "M0,-120 L-46,-120 C-53,-74 -58,-36 -58,-14 L-122,2 L-122,30 L-60,50 L-62,110 L0,110 Z",
  starboard: "M0,-120 L46,-120 C53,-74 58,-36 58,-14 L122,2 L122,30 L60,50 L62,110 L0,110 Z",
  aft: "M-62,110 L62,110 L56,198 L30,230 L-30,230 L-56,198 Z",
};
