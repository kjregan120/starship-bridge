import { useGame } from "./state.js";

// Every tool is a pure-ish function over game state. It returns a `fact`:
// the deterministic ground truth. The Computer/officer voice only ever
// *narrates* facts — it never invents them. When the LLM is wired in via the
// Cloudflare proxy, these same `schema` blocks become the function-calling
// definitions, and `run` stays exactly as-is. That's the whole seam:
// LLM decides which tool + args, code decides what's true.

export const tools = {
  list_options: {
    station: "any",
    schema: {
      description:
        "List the commands currently available from the active station.",
      parameters: {}
    },
    run() {
      const { station } = useGame.getState();
      const available = Object.entries(tools)
        .filter(([, t]) => t.station === "any" || t.station === station)
        .map(([name]) => name)
        .filter((n) => n !== "list_options");
      return {
        fact: `Available commands at ${station}: ${available.join(", ")}.`
      };
    }
  },

  scan: {
    station: "science",
    schema: {
      description:
        "Run a sensor sweep of the current on-screen target and report findings.",
      parameters: { target: "the body to scan (defaults to current target)" }
    },
    run() {
      const g = useGame.getState();
      const body = g.targetBody();
      if (!body)
        return {
          fact: "No target on screen. Order a body to the viewer before scanning."
        };
      return { fact: `Scan of ${body.name}: ${body.scan}` };
    }
  },

  on_screen: {
    station: "conn",
    schema: {
      description: "Put a body from the current system on the main viewer.",
      parameters: { body: "name or id of the body to display" }
    },
    run({ body }) {
      const g = useGame.getState();
      const match = g
        .currentBodies()
        .find(
          (b) =>
            b.id === body ||
            b.name.toLowerCase().includes(String(body || "").toLowerCase())
        );
      if (!match)
        return { fact: `No body matching "${body}" in this system.` };
      g.setTarget(match.id);
      return { fact: `On screen: ${match.name}.` };
    }
  },

  set_course: {
    station: "conn",
    schema: {
      description: "Lay in a course to another system and engage.",
      parameters: { system: "name or id of the destination system" }
    },
    run({ system }) {
      const g = useGame.getState();
      const entry = Object.entries(g.world.systems).find(
        ([id, s]) =>
          id === system ||
          s.name.toLowerCase().includes(String(system || "").toLowerCase())
      );
      if (!entry) return { fact: `No system matching "${system}" on the charts.` };
      const [id, sys] = entry;
      if (id === g.currentSystem)
        return { fact: `We're already at ${sys.name}.` };
      g.warpTo(id);
      return { fact: `Course laid in for ${sys.name}. Engaging.` };
    }
  },

  hail: {
    station: "comms",
    schema: {
      description: "Open a comm channel to the current target.",
      parameters: { target: "the body to hail (defaults to current target)" }
    },
    run() {
      const g = useGame.getState();
      const body = g.targetBody();
      if (!body) return { fact: "No target on screen to hail." };
      if (!body.hailable)
        return { fact: `No response from ${body.name}. Channel is silent.` };
      return { fact: `Channel open to ${body.name}. Incoming: "${body.hail}"` };
    }
  },

  shields: {
    station: "tactical",
    schema: {
      description: "Raise or lower the deflector shields.",
      parameters: { up: "true to raise, false to lower" }
    },
    run({ up }) {
      const g = useGame.getState();
      g.setShields(up);
      return { fact: up ? "Shields up." : "Shields down." };
    }
  },

  alert: {
    station: "tactical",
    schema: {
      description: "Set the ship alert condition.",
      parameters: { level: "green | yellow | red" }
    },
    run({ level }) {
      const g = useGame.getState();
      const norm = ["green", "yellow", "red"].includes(level) ? level : "green";
      g.setAlert(`condition-${norm}`);
      if (norm === "red") g.setShields(true);
      return { fact: `Condition ${norm}.` };
    }
  },

  status: {
    station: "any",
    schema: {
      description: "Report ship status: location, alert, shields.",
      parameters: {}
    },
    run() {
      const g = useGame.getState();
      const sys = g.world.systems[g.currentSystem].name;
      const { alert, shields } = g.world.ship;
      return {
        fact: `${g.world.ship.name}, ${g.world.ship.registry}. Location: ${sys}. ${alert}. Shields ${shields ? "up" : "down"}.`
      };
    }
  }
};
