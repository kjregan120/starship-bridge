// loop.js — advances the sim on its own requestAnimationFrame loop,
// independent of whichever Canvas happens to be mounted (Scene or Chart).
// Only one Canvas (one WebGL context) is ever mounted at a time — switching
// views would otherwise stop the ship mid-flight while you're looking at the
// chart, so stepping lives here instead of inside either view's render loop.
// The ship's systems (ship.js) step here too, on real time, and hand the sim
// back what the engines can actually do.
import { sim, view, ship, shipFlux } from "./engine.js";
import { ejecta, ejectaClock } from "./ejecta.js";
import { cmeStep, cmeEffects } from "../universe/cme.js";

const MAX_BANK = 0.35;     // ~20° roll at most
const BANK_PER_YAW = 0.45; // rad of roll per rad/s of yaw — full turnRate (π/4) ≈ 20°

// Coronal mass ejections in flight (ejecta.js): any whose front sweeps over
// the ship this tick hits it; the rest still bearing down on it are
// returned for the alerts (ship.incoming), soonest first.
function cmeTick() {
  const t = ejectaClock();
  ejecta.prune(t);
  const incoming = [];
  for (const c of ejecta.clouds) {
    const s = cmeStep(c, sim.pos, t);
    if (s.hit) {
      const r = ship.hit({ ...cmeEffects(s.energy), from: s.from, facing: sim.facing });
      const where = r.through > 0 ? `${r.side} hull damaged${r.damaged.length ? ` (${r.damaged.join(", ")})` : ""}` : "shields holding";
      ship.onEvent(r.through > 0 ? "deny" : "info", `Coronal mass ejection from ${c.source ?? "a star"} — impact ${r.side}, ${where}.`);
    } else if (s.eta != null) {
      incoming.push({ kind: "cme", source: c.source, eta: s.eta, energy: s.energy });
    }
  }
  return incoming.sort((a, b) => a.eta - b.eta);
}

export function startSimLoop() {
  let raf;
  let last = performance.now();
  let flux = { heat: 0, rad: 0 }, fluxIn = 0;
  const tick = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const scale = sim.mode === "warp" ? 40 : 1; // compress warp into seconds
    const prev = view.facing;
    sim.step(dt * scale, dt);
    // Stellar flux only changes as fast as the ship moves — a few times a
    // second is plenty for a sum over every star.
    if ((fluxIn -= dt) <= 0) { flux = shipFlux(); fluxIn = 0.25; }
    ship.step(dt, { mode: sim.mode, throttle: sim.throttle, warpFactor: sim.warpFactor, flux });
    ship.incoming = cmeTick();
    sim.impulseFactor = ship.impulseFactor;
    sim.warpLimit = ship.warpMax;
    sim.warpInhibit = ship.warpInhibit;
    if (ship.warpCollapse) sim.forceDropOut(ship.warpInhibit ?? "engines starved of power");
    view.facing = sim.facing; // sim.facing is kept unit-length and authoritative in every mode
    // Bank into turns: yaw rate around galactic up (+ = port), scaled to a
    // roll angle and eased so a one-frame snap (e.g. warp locking onto a
    // target) barely registers while a sustained turn leans in fully.
    if (dt > 0) {
      const f = view.facing;
      const yawRate = (prev[2] * f[0] - prev[0] * f[2]) / dt;
      const target = Math.max(-MAX_BANK, Math.min(MAX_BANK, yawRate * BANK_PER_YAW));
      view.bank += (target - view.bank) * (1 - Math.exp(-dt * 3));
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
