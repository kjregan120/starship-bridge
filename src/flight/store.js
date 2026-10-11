// store.js — UI-facing state for the flight view. The 3D scene reads the sim
// directly every frame for smoothness; React panels read this store, which a
// ticker refreshes a few times a second (so we don't re-render React 60x/sec).
import { create } from "zustand";

export const useUI = create((set) => ({
  snapshot: { mode: "impulse", speed: 0, throttle: 0, warpReady: true, warpBlockedBy: null, t: 0 },
  nearest: null,
  nav: [],
  systemName: "",
  log: [],
  // Station picks the screen: conn = forward viewscreen, science = the
  // ship-status dashboard, tactical = the 3D chart, comms = the
  // signal-detection/sonification screen. Orders still all work no matter
  // which is selected.
  station: "conn", // "conn" | "science" | "tactical" | "comms"
  // The ship's systems (ship.js snapshot()), refreshed with the rest — null
  // until the first tick.
  ship: null,
  // The alert condition (alerts.js AlertBoard): level, threats worst first,
  // and the incident log the game-over screen replays.
  alert: { level: "green", threats: [], incidents: [] },
  // Runs a typed order — set by FlightApp.jsx so a panel (the dashboard's
  // recommended-action chips) can issue one without owning the parser.
  runOrder: null,
  // Whose personnel file is open on the CREW screen (a profile id) | null.
  personnelId: null,
  // Which contact COMMS is currently sonifying, if any — { id, name } | null.
  // Lives here (not in Comms.jsx's own state) so playback survives switching
  // to a different station; commsAudio.js owns the actual audio nodes.
  listening: null,
  // The receiver's tuned band, if any — one of signals.js's band names
  // ("Radio" | "Microwave" | "Elements" | "Gravimetric" | "Subspace") | null.
  // Set by the `tune` command (FlightApp.jsx); like `listening`, it lives here
  // so it survives switching stations. This only drives the UI highlight —
  // audio.js's tuneFilterTo() is what actually changes the sound, and it's a
  // receiver-wide setting independent of which object is on screen, the same
  // way tuning a real radio dial doesn't care what you're looking at.
  tunedBand: null,
  // A `decode` command in progress, if any — { id, name, startedAt, duration,
  // decodable, text } | null. `id`/`name` mirror `listening` (decode can only
  // ever target the object currently being listened to); `text`/`decodable`
  // are precomputed by signals.js's decodeMessage() at start time, and
  // `startedAt`/`duration` (ms epoch / seconds) are what decodeEngine.js's
  // timer counts down against. Lives here for the same reason `listening`
  // does — decodeEngine.js owns the countdown outside React, the same way
  // commsAudio.js owns the audio nodes, so it survives switching stations.
  decoding: null,

  setSnapshot: (snapshot) => set({ snapshot }),
  setNearest: (nearest) => set({ nearest }),
  setNav: (nav) => set({ nav }),
  setSystemName: (systemName) => set({ systemName }),
  setLog: (log) => set({ log: [...log] }),
  setStation: (station) => set({ station }),
  setShip: (ship) => set({ ship }),
  setAlert: (alert) => set({ alert }),
  setRunOrder: (runOrder) => set({ runOrder }),
  setPersonnel: (personnelId) => set({ personnelId }),
  setListening: (listening) => set({ listening }),
  setTunedBand: (tunedBand) => set({ tunedBand }),
  setDecoding: (decoding) => set({ decoding })
}));
