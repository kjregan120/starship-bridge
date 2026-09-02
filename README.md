# USS Meridian — Bridge (Phase 1 slice)

A command-driven starship bridge. The viewscreen is the stage; you command by
speaking to the Computer. This slice exists to answer one question: **is
commanding a ship by talking to it actually fun to play?**

## Run it

```bash
npm install
npm run dev
```

Then open the local URL Vite prints (usually http://localhost:5173).

## Try these

The active **station** (left rail) decides which commands are lit. Type into
the command line at the bottom:

- `what can I do?` — the Computer lists the current station's commands
- `status` — ship report
- Switch to **CONN**, then `show me Tarsus III` → `set course for Erebus`
- Switch to **SCIENCE**, then `scan` (scans whatever's on screen)
- Switch to **COMMS**, put the derelict on screen in Erebus, then `hail them`
- Switch to **TACTICAL**, then `red alert` / `shields up` / `stand down`

A little loop to feel the fantasy: go to **Erebus**, put **the Vanadis** on
screen, **scan** it (one faint life sign), then **hail** it. Then set course for
**Vela Gate** and scan **Vela Prime** — something down there is broadcasting.

## How it's wired (the important part)

```
player text ──▶ computer.js (brain) ──▶ { tool, args }
                                            │
                                            ▼
                                   tools.js  (deterministic:
                                   mutates real state, returns a FACT)
                                            │
                                            ▼
                                   brain.narrate(fact) ──▶ log
```

- **The brain interprets; code decides.** The brain (currently a dumb keyword
  matcher in `computer.js`) only picks *which tool* to run. The tool is real
  code operating on real state in `state.js`, and it returns the ground-truth
  `fact`. The Computer never invents what's true — it only phrases facts.
- **Tools are the only thing the Computer can do.** That's why
  "what can I do?" is always accurate: it just lists the available tools.
- **The world is data.** `world.json` is the hand-authored universe for now.
  Later phases swap in seed-based procedural generation behind the same shape.

## Swapping in the LLM (phase later)

Everything above the tool layer is a swappable **brain**. `computer.js` ships
with `localBrain` (offline, free). Below it is a commented `llmBrain` stub that
POSTs to `/api/computer` — that endpoint is your **Cloudflare Worker**, which
holds the API key and does real function-calling against the same tool schemas.
Flip one line (`const brain = ...`) and nothing else in the game changes.

## Roadmap

- **Phase 1 (this):** thin brain over a tiny hand-built world. Prove the loop.
- **Phase 2:** deterministic seed generation → an infinite universe.
- **Phase 3:** offline LLM content pipeline → generated species, logs, cultures,
  baked in as data.
- **Special case:** first contact as live LLM conversation (see Vela Prime).
