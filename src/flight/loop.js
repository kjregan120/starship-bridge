// loop.js — advances the sim on its own requestAnimationFrame loop,
// independent of whichever Canvas happens to be mounted (Scene or Chart).
// Only one Canvas (one WebGL context) is ever mounted at a time — switching
// views would otherwise stop the ship mid-flight while you're looking at the
// chart, so stepping lives here instead of inside either view's render loop.
import { sim, view } from "./engine.js";

export function startSimLoop() {
  let raf;
  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const scale = sim.mode === "warp" ? 40 : 1; // compress warp into seconds
    sim.step(dt * scale);
    view.facing = sim.facing; // sim.facing is kept unit-length and authoritative in every mode
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
