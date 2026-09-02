import { tools } from "./tools.js";
import { useGame } from "./state.js";

// ============================================================================
// THE SEAM
// ----------------------------------------------------------------------------
// A "brain" turns a line of player English into a { tool, args } decision.
// The rest of the pipeline (execute the tool against real state, narrate the
// result) is identical no matter which brain is used.
//
//   Phase 1 (now):    localBrain — dumb keyword matcher, zero cost, offline.
//   Phase later:      llmBrain   — POSTs to your Cloudflare Worker, which holds
//                                  the API key and does real function calling.
//
// To switch, change the one line at the bottom: `const brain = ...`.
// Nothing else in the game needs to know which brain answered.
// ============================================================================

const localBrain = {
  async interpret(text) {
    const t = text.toLowerCase().trim();

    if (/(what can|options|commands|help|what.*do)/.test(t))
      return { tool: "list_options", args: {} };

    if (/(status|report|where are we|situation)/.test(t))
      return { tool: "status", args: {} };

    if (/(scan|analyz|sensor|readings?)/.test(t))
      return { tool: "scan", args: {} };

    if (/(hail|open a channel|contact|respond)/.test(t))
      return { tool: "hail", args: {} };

    if (/shields? (up|raise)|raise shields?/.test(t))
      return { tool: "shields", args: { up: true } };
    if (/shields? (down|drop|lower)|lower shields?/.test(t))
      return { tool: "shields", args: { up: false } };

    if (/red alert|condition red/.test(t))
      return { tool: "alert", args: { level: "red" } };
    if (/yellow alert|condition yellow/.test(t))
      return { tool: "alert", args: { level: "yellow" } };
    if (/(stand down|condition green|green alert)/.test(t))
      return { tool: "alert", args: { level: "green" } };

    // "on screen: tarsus" / "show me the drifter" / "view vela prime"
    const onScreen = t.match(
      /(?:on screen|on the viewer|show(?: me)?|view|display)\s*:?\s*(.+)/
    );
    if (onScreen) return { tool: "on_screen", args: { body: onScreen[1] } };

    // "set course for erebus" / "take us to vela gate" / "warp to erebus"
    const course = t.match(
      /(?:set course (?:for|to)|course (?:for|to)|take us to|go to|warp to|travel to)\s+(.+)/
    );
    if (course) return { tool: "set_course", args: { system: course[1] } };

    return { tool: null, args: {} };
  },

  // Local narration is thin: the officer states the fact plainly. When the LLM
  // brain is in, this is where personality and phrasing come from instead.
  async narrate(fact) {
    return fact;
  }
};

// ---------------------------------------------------------------------------
// LLM brain — stub. Fill in once the Cloudflare Worker is up.
// The Worker holds the API key, defines `tools` as function-calling schemas,
// and returns { tool, args }. Then narration is a second call that turns the
// tool's `fact` into in-character speech for the active officer.
// ---------------------------------------------------------------------------
// const llmBrain = {
//   async interpret(text) {
//     const res = await fetch("/api/computer", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         text,
//         station: useGame.getState().station,
//         toolSchemas: Object.fromEntries(
//           Object.entries(tools).map(([n, t]) => [n, t.schema])
//         )
//       })
//     });
//     return res.json(); // { tool, args }
//   },
//   async narrate(fact, station) {
//     const res = await fetch("/api/narrate", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ fact, station })
//     });
//     return (await res.json()).text;
//   }
// };

const brain = localBrain;

// The public entry point. One player line in, log updated, state mutated.
export async function runComputer(text) {
  const g = useGame.getState();
  g.addLog("captain", text);

  const { tool, args } = await brain.interpret(text);

  if (!tool || !tools[tool]) {
    g.addLog("computer", "Unable to comply. Rephrase, or ask what's available.");
    return;
  }

  const { fact } = tools[tool].run(args);
  const spoken = await brain.narrate(fact, g.station);

  // list_options and status read as the Computer; everything else as the
  // officer whose station is active. Cheap way to give the bridge texture.
  const voice =
    tool === "list_options" || tool === "status" ? "computer" : g.station;
  g.addLog(voice, spoken);
}
