// careerStore.js — where the crew record lives between sessions.
//
// The career (universe/personnel/career.js) is one JSON document, kept in
// the browser's localStorage. localStorage rather than IndexedDB because
// it's synchronous: the last checkpoint must land even as the page is
// closing, and an async write in `beforeunload` can be dropped. A career
// is a few hundred KB; the quota is ~5 MB. If careers outgrow that, this
// file is the only one that has to change.
//
// Export/import write and read the same document as a .json file — a
// backup, something to hand-edit, or a way to move a career elsewhere.

import { migrateCareer } from "../universe/personnel/schema.js";
import { dateOf } from "../universe/personnel/util.js";

const KEY = "meridian.career";

export function loadCareer() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrateCareer(JSON.parse(raw)) : null;
  } catch (e) {
    console.warn("[career] could not load the saved career; starting a new one.", e);
    return null;
  }
}

export function saveCareer(c) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
    return true;
  } catch (e) {
    console.warn("[career] could not save the career.", e);
    return false;
  }
}

export function clearCareer() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

export function exportCareer(c) {
  const blob = new Blob([JSON.stringify(c, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `meridian-crew-${dateOf(c.day)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Reads a file chosen by the player, checks it's a career, and saves it in
// place of the current one. The caller reloads to start from it.
export async function importCareer(file) {
  const c = JSON.parse(await file.text());
  if (!c || typeof c !== "object" || !c.profiles || !c.posts) throw new Error("That file isn't a Meridian crew record.");
  migrateCareer(c);
  if (!saveCareer(c)) throw new Error("Couldn't save the imported record.");
  return c;
}
