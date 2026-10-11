// computerVoice.js — the ship's computer, speaking alerts worst first.
//
// Uses the browser's built-in speech synthesis: no service, no key, no
// latency. Reads the same threat list as the dashboard (alerts.js) and
// decides what to say:
//   - an alert condition change is announced ("Red alert.")
//   - the worst threat that hasn't been spoken recently is spoken next
//   - a markedly worse threat interrupts whatever is being said
//   - each threat waits out a cooldown before it's repeated (shorter at
//     red), unless it escalates, so the computer informs without nagging
// Swapping in a different voice later only means replacing speak().

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
let enabled = true;
let voice = null;
let speakingSev = -1;
let lastLevel = "green";
const lastSaid = new Map();       // threat id -> { at, level }
const COOLDOWN = { red: 30, yellow: 75 };
const INTERRUPT_MARGIN = 10;

function pickVoice() {
  if (!synth) return null;
  const voices = synth.getVoices().filter((v) => /^en/i.test(v.lang));
  const prefer = [/zira/i, /aria/i, /jenny/i, /samantha/i, /google uk english female/i, /female/i, /google us english/i];
  for (const re of prefer) {
    const v = voices.find((x) => re.test(x.name));
    if (v) return v;
  }
  return voices[0] ?? null;
}
if (synth) synth.onvoiceschanged = () => { voice = pickVoice(); };

function speak(text, sev) {
  if (!synth || !text) return;
  if (!voice) voice = pickVoice();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.rate = 1.05; u.pitch = 1.0; u.volume = 1;
  u.onend = u.onerror = () => { if (!synth.speaking) speakingSev = -1; };
  speakingSev = Math.max(speakingSev, sev);
  synth.speak(u);
}

export function setVoiceEnabled(on) {
  enabled = on;
  if (!on && synth) { synth.cancel(); speakingSev = -1; }
}
export const voiceEnabled = () => enabled;
export const voiceAvailable = () => !!synth;

// Called a few times a second with the AlertBoard (alerts.js).
export function updateVoice(board) {
  if (!synth || !enabled) return;
  // Browsers drop speech until the page has had a click or key press; wait
  // for one rather than marking alerts as said that nobody heard.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  const now = performance.now() / 1000;
  const level = board.level;
  const threats = board.threats;

  if (threats[0]?.id === "crew-lost") {
    if (lastLevel !== "lost") { synth.cancel(); speak("No life signs detected aboard.", 100); lastLevel = "lost"; }
    return;
  }

  let prefix = "";
  if (level !== lastLevel) {
    if (level === "red") prefix = "Red alert. ";
    else if (level === "yellow" && lastLevel === "green") prefix = "Yellow alert. ";
    else if (level === "green") { speak("Condition green. All clear.", 0); lastSaid.clear(); }
    lastLevel = level;
  }

  // A casualty report outranks everything short of a fresh red alert; it
  // waits for the current sentence unless that's about something lesser.
  if (board.report && !prefix) {
    if (!(synth.speaking || synth.pending) || speakingSev < 87) {
      if (synth.speaking || synth.pending) synth.cancel();
      speak(board.takeReport(), 87);
      return;
    }
  }

  // The worst threat that's due to be said.
  const due = threats.find((t) => {
    if (!t.say) return false;
    const prev = lastSaid.get(t.id);
    if (!prev) return true;
    if (t.level === "red" && prev.level !== "red") return true; // escalated
    return now - prev.at > COOLDOWN[t.level];
  });
  if (!due) {
    if (prefix) speak(prefix.trim(), 50);
    return;
  }

  if (synth.speaking || synth.pending) {
    if (due.sev < speakingSev + INTERRUPT_MARGIN && !prefix) return; // let it finish
    synth.cancel();
    speakingSev = -1;
  }
  lastSaid.set(due.id, { at: now, level: due.level });
  speak(prefix + due.say, due.sev);
}
