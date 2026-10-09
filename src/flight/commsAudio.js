// commsAudio.js — owns the single "currently listening" playback. Kept
// outside React entirely (a module-level reference, not component state) so
// switching stations — which unmounts Comms.jsx — doesn't interrupt it. The
// status bar and Comms.jsx both just read useUI's `listening` field to know
// what's playing; only this module touches the actual audio nodes.
import { playSignal } from "./audio.js";
import { useUI } from "./store.js";
import { cancelDecode } from "./decodeEngine.js";

let stopFn = null;

export function startListening(obj, profile) {
  stopListening();
  stopFn = playSignal(profile);
  useUI.getState().setListening({ id: obj.id, name: obj.name });
}

export function stopListening() {
  stopFn?.();
  stopFn = null;
  useUI.getState().setListening(null);
  // A decode can only ever target the channel currently open — closing it
  // (including startListening()'s own call to this, above, when switching
  // to a different contact) leaves nothing left to decode.
  cancelDecode();
}
