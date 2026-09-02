import { create } from "zustand";
import world from "./world.json";

// Deep-clone the authored world so runtime mutations (deltas) never touch the
// source data. In later phases the seed generator fills this in procedurally;
// for the slice it's just our hand-built systems.
const initialWorld = structuredClone(world);

export const useGame = create((set, get) => ({
  world: initialWorld,

  // The system we're currently sitting in, and the body the viewscreen is
  // pointed at (the "on screen" target). Null target = looking at open space.
  currentSystem: initialWorld.ship.location,
  target: null,

  // Which bridge station has the conning — this only changes which command
  // grammar is lit, never what's on the viewscreen.
  station: "conn", // conn | science | tactical | comms

  // True while a warp jump is animating. The viewscreen watches this to run
  // the streak/flash sequence; the arrival is committed when it clears.
  isWarping: false,

  // The scrolling record of everything the Computer and crew have said.
  log: [
    {
      from: "computer",
      text: "USS Meridian systems online. Ahead: Sol Relay Station. Standing by."
    }
  ],

  // ---- helpers the tools call ---------------------------------------------

  addLog: (from, text) => set((s) => ({ log: [...s.log, { from, text }] })),

  setStation: (station) => set({ station }),

  setTarget: (bodyId) => set({ target: bodyId }),

  setSystem: (systemId) =>
    set((s) => {
      const sys = s.world.systems[systemId];
      return {
        currentSystem: systemId,
        target: null,
        world: {
          ...s.world,
          ship: { ...s.world.ship, location: systemId }
        }
      };
    }),

  // Trigger a warp: flip the flag, let the viewer animate, then commit the
  // system change and log arrival. The 1600ms matches the streak sequence.
  warpTo: (systemId) => {
    const s = get();
    const sys = s.world.systems[systemId];
    if (!sys) return;
    set({ isWarping: true });
    setTimeout(() => {
      get().setSystem(systemId);
      get().addLog("conn", `Arrived at ${sys.name}.`);
      set({ isWarping: false });
    }, 1600);
  },

  setShields: (up) =>
    set((s) => ({
      world: { ...s.world, ship: { ...s.world.ship, shields: up } }
    })),

  setAlert: (level) =>
    set((s) => ({
      world: { ...s.world, ship: { ...s.world.ship, alert: level } }
    })),

  // Convenience selectors
  currentBodies: () => {
    const s = get();
    return s.world.systems[s.currentSystem].bodies.map(
      (id) => ({ id, ...s.world.bodies[id] })
    );
  },
  targetBody: () => {
    const s = get();
    return s.target ? { id: s.target, ...s.world.bodies[s.target] } : null;
  }
}));
