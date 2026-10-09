// decodeEngine.js — owns the decode countdown, the same way commsAudio.js
// owns audio playback: as a module-level interval outside React, so a decode
// in progress keeps running (and completes) no matter which station is on
// screen, mirroring how `listening`/`tunedBand` survive a station switch in
// store.js. `decodeMessage()` (signals.js) has already computed the outcome
// and duration by the time startDecode() is called — this module just times
// it out and drops the result into the log, exactly like every other order
// result surfaces via sim.log.
import { useUI } from "./store.js";
import { sim } from "./engine.js";

let ticker = null;

function ensureTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    const { decoding } = useUI.getState();
    if (!decoding) { clearInterval(ticker); ticker = null; return; }
    if (Date.now() - decoding.startedAt < decoding.duration * 1000) return;
    sim.log(decoding.decodable ? "info" : "deny", `Decode — ${decoding.name}: ${decoding.text}`);
    useUI.getState().setDecoding(null);
    clearInterval(ticker); ticker = null;
  }, 200);
}

// `result` is a decodeMessage() return value — { decodable, duration, text }.
export function startDecode(id, name, result) {
  useUI.getState().setDecoding({ id, name, startedAt: Date.now(), ...result });
  ensureTicker();
}

// Silent — called on every stopListening()/startListening(), most of which
// aren't aborting an actual decode, so this must not itself log anything.
export function cancelDecode() {
  useUI.getState().setDecoding(null);
}

// The user-facing abort (the `decode stop` command and Comms.jsx's abort
// button both call this, not cancelDecode(), so both get the same log line
// and neither duplicates the other's "was anything even running?" check).
// Returns whether it actually aborted something.
export function abortDecode() {
  if (!useUI.getState().decoding) return false;
  cancelDecode();
  sim.log("info", "Decode aborted.");
  return true;
}
