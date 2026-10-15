# The cube — design note

An enemy ship: a cube of ~150 blocks that hunts, fires, holds you with a
tractor beam, adapts to your weapons, hails, and boards. The captain doesn't
fight it shot by shot; Tactical does, the way repair crews handle damage.

Status: **phases 1 and 2 built** (2026-10-14) on top of the ejecta hits
(`universe/cme.js`). Phase 3 (boarding, assimilation) is design.

### As built (phase 2) — where it differs from below

- `universe/tactical.js` holds the state machine and the crew's decisions.
  Gun crew effectiveness = `Roster.workers(["tactical"], "weapons")` ÷ 3
  (capped 1.15); a normal watch is about 0.3–0.6, all hands ~1.1.
- Auto targeting: the tractor array if it holds us → the core once
  reachable → emitters on the faces that bear → regen nodes → plating
  (a weakest bearing face, worked at one spot so a breach opens).
- The core is reachable through a breached face (< 40%) **or** through any
  face once the whole shell is below 65% — otherwise the cube just turns a
  fresh face to us forever.
- Adaptation: +0.3 resistance per unit of damage on a band, −0.012/s on
  every band, cap 0.9; "adapted" at 0.45. Crew notice after 6 s ÷
  effectiveness and pick the least-adapted band (a green crew sometimes
  grabs a random one).
- Regen nerfed to 0.003 hp/s, adjacent blocks only.
- Weapons draw 20 × `power weapons` × load; load is 0 idle, 0.1 holding,
  and while firing by stance (balanced eases to 0.5 below 40% shields).
  Priority: life, shields, engines, **weapons**, sensors, comms.
- The duty `weapons-watch` wasn't added — the Tactical posts keep their
  duties; the skill is enough. Save schema 3 gives existing tactical crew
  weapons xp equal to their tactical-analysis xp.
- Balance (stationary ship, fresh cube, 4 seeds): no gun crew always
  loses; the watch wins about half, in ~6.5–7 min with heavy hull damage;
  all hands always wins, in ~3.5–4.5 min.

### As built (phase 1) — where it differs from below

- Collective space is picked at runtime from a hash of star ids
  (`collectiveSystems` in `universe/collective.js`), not marked by
  generate.js, so universe.json is unchanged.
- 160 blocks (152 shell + 8 core). The cube keeps station 5u off a point
  1.2u above the ship and holds its best face ~35° off square, so two faces
  bear and both show on the viewer.
- Tractor break-free: reactor overdriven (`reactor` > 100) **and** full
  impulse for 6 s (reactor output follows load, so an output threshold
  never triggers). Straining adds heat. 25 s before it can re-lock.
- Cutting beam: 0.10 shield per shot, each emitter every ~13 s; full
  shields last ~30 s against a fresh cube, the facing hull ~2 min more.
- Dev builds expose `window.__bridge` (`summonCube(range)`, `sim`, `ship`,
  `collective`) for testing from the console.

## Principles

- **The crew fight, the captain commands.** Targeting, frequency rotation and
  fire rate are Tactical's job, judged by who is at their posts and how good
  they are (`Roster.workers`). The captain's levers are the ones that already
  exist: power, all hands, evacuation, helm, and when to run.
- **Zero commands still plays sensibly.** Every order is an optional override.
- **Pure logic in `universe/`, rendering in `flight/`**, like `ship.js` and
  `sim.js`. All of it is testable in node (`test.js`).
- **Escape is a win.** Most encounters end with you getting away.

## Files

| File | Role |
|---|---|
| `universe/cube.js` (new) | The cube: blocks, faces, health, AI, adaptation. Pure. |
| `universe/tactical.js` (new) | Engagement state machine + Tactical crew decisions. Pure. |
| `universe/ship.js` | `weapons` component + power demand, `warpInhibit` from tractor, boarding/assimilation hooks. |
| `universe/collective.js` (new) | Collective space + roaming spawns, one cube at a time. |
| `universe/alerts.js` | `assessThreats` gains a `cube` threat and a hold-window countdown. |
| `flight/cubeMesh.js` (new) | `InstancedMesh` of blocks, beams, debris, green venting. |
| `flight/FlightApp.jsx` | Command parsing (beside `repair <x>`), banner for the hold window. |
| `flight/hail.js` (new) | The hail: slowed deep voice over a detuned drone. |

## 1. The cube (`cube.js`)

A 6×6×6 lattice; only the shell plus the core are modelled (~150 blocks).

```js
// block
{ id, cell: [x, y, z], face: "px"|"nx"|"py"|"ny"|"pz"|"nz"|"core",
  role: "plate" | "emitter" | "tractor" | "regen" | "core",
  hp: 1, max: 1 }
```

Roles per face (data table, tunable): ~4 emitters, 1 tractor node, 1 regen
node, rest plating. Core blocks are interior; they can only be hit through a
**breached** face (plating on that face below ~40%).

```js
class Cube {
  constructor({ seed, pos, random })
  step(dt, { shipPos, shipFacing })  // move, regen, choose actions → events
  faceToward(dir)                     // which face points at a direction
  hit(face, { energy, freq })         // our weapons; returns { blocks, adapted }
  firingFaces(shipPos)                // faces with live emitters that bear on us
  get tractorOn()                     // any live tractor node bearing + in range
  get disabled()                      // core destroyed
  snapshot()                          // for the renderer: block hp[], beams, venting
}
```

- **Damage** lands on blocks of the struck face, plating first, then a random
  share on emitters/tractors/regen (so focus fire on a face strips it).
- **Regen**: each live regen node restores nearby dead blocks slowly.
  Destroying it stops regrowth on that face.
- **Firing**: each face's live emitters fire a cutting beam through
  `ship.hit({ energy, from, facing })` — the existing hook, so hull sections,
  exposed components and shields all already work.
- **Tractor**: while `tractorOn`, `ship.warpInhibit = "held by tractor beam"`
  and impulse is dragged toward the cube. Overdriving the reactor
  (`reactor` order) can break free at a heat cost.
- **Movement**: slow, relentless approach to a holding range; rotates to bring
  its least-damaged face to bear (so it's smart about it too).

### Adaptation

The cube keeps a resistance per weapon frequency band (say 8 bands):

```
resist[f] += ADAPT_RATE * energyTaken      // learns what hurts it
resist[g] -= DECAY * dt  for g != f        // slowly forgets the others
damage   = energy * (1 - resist[f])
```

Shared across the whole cube (the Collective learns). When `resist[f]`
crosses a threshold the cube emits an `adapted` event; Tactical can notice it.

## 2. Engagement (`tactical.js`)

```
idle ──contact──▶ tracking ──cube fires / closes to weapons range──▶ hold
hold ──timer 5s or `engage`──▶ engaged
hold ──`hold fire`──▶ holding (weapons safe; stays until `engage`)
engaged ──`hold fire`──▶ holding
any ──cube disabled / out of range──▶ idle   (encounter over; window re-arms)
```

- **Hold window: once per encounter.** Re-armed only when the encounter ends.
  During it: red alert, the tactical officer reports
  *"Cube is firing on us. Weapons ready, awaiting orders."*, countdown on the
  banner. At expiry: *"No orders. Engaging."*
- The hold window doesn't stop the cube; shields still take hits.

### What Tactical decides each tick (no input)

Effectiveness `k` comes from Tactical crew at their stations:
`roster.workers(["tactical"], "weapons")` summed and normalised, like
`staffing()`.

| Decision | Behaviour | Skill effect |
|---|---|---|
| Target | Firing face's emitters → tractor nodes if held → regen on the face being worked → core once breached | Low skill: more shots on plating |
| Frequency | Rotate when observed damage drops below expectation | Detection delay `~ 6s / k`; low skill picks a band the cube has already adapted to sometimes |
| Fire rate | Throttle when shields < 40% so weapons don't starve them | `stance` shifts the threshold |
| Accuracy | Hit chance `0.5 + 0.4·k`, minus sensor degradation | Sensors damage hurts aim |

XP: `roster.credit(workers, "weapons", …)` per hit, and `tactical-analysis`
when an adaptation is spotted. Survivors get better between missions.

### Weapons and power

- New power consumer `weapons` in `DEMAND` (~20 at full rate), placed **after
  shields** in `PRIORITY`. A starved reactor fires less, automatically.
- **`weapons` is its own component** in `ship.health`, separate from the
  shield emitters. Add it to `MAINTENANCE` (dept tactical, skill `weapons`),
  give it a slot in `SECTION_COMPONENTS` (fore, with sensors and comms, so a
  hit to the front can take out our guns), give it `FAULTS` entries
  (e.g. "phaser coupling burned out", "targeting array misaligned"), and add
  it to the Science schematic. Fire rate and damage scale with
  `health.weapons`; below ~0.15 the weapons are offline.
- New skill `weapons` (dept tactical) in `personnel/data/skills.js`, plus a
  `weapons-watch` duty in `duties.js`.

### Captain's orders (all optional)

| Order | Effect |
|---|---|
| `engage` | End the hold window now / resume firing |
| `hold fire` | Weapons safe until `engage` |
| `target emitters\|tractor\|core\|regen` | Priority override, like `repair <x>`; `target auto` clears |
| `stance defensive\|aggressive` | Shield-vs-firepower balance |

## 3. Hail

On first contact (before the hold window), a fixed transmission that comes
through regardless of `commsQuality`: many voices in unison, heavily
processed (`commsAudio.js`). Shown on Comms as an un-decodable-but-obvious
signal. Answering doesn't change the outcome — it's flavour, and a beat of
dread before the countdown.

Later (phase 3): if a former crew member was assimilated in an earlier
mission, the hail sometimes carries their designation — read from their
personnel file.

## 4. Boarding and assimilation (phase 3)

- While a face is within transporter range and our shields < ~25%, the cube
  beams a **boarding party** into a hull section (biased toward the side
  facing it).
- Boarding is a section-scoped spreading fault, using the same
  "work to contain" model as `faults.js`: security + operations at their
  posts put work into it; `call all hands` and evacuating the section are the
  captain's tools.
- Each tick uncontained, crew in that section take `assimilation` progress;
  at 1 they're lost to the roster with status **Assimilated** (new status in
  `personnel/schema.js`; persists in the career).
- Uncontained boarders also put a `compromised` fault on that section's
  components (`SECTION_COMPONENTS`) — power drain or helm interference until
  cleared.

## 5. Rendering (`cubeMesh.js`)

- One `InstancedMesh` for all blocks; per-instance colour/emissive from
  `hp` (dark when dead, hidden when debris has broken away).
- Greebled box geometry + a dark metal material with green emissive seams;
  live emitters glow brighter on the firing face.
- Beams: a cylinder/shader from emitter to ship's hit point, green.
- Tractor: a translucent cone while held.
- Dead blocks: spawn debris (reuse `ejecta.js` particle approach) + a green
  vent puff.
- Shield impact flash on our side already exists (`cues.hit`).

## 6. Alerts

`assessThreats` adds:
- `cube` — red, "Unknown vessel closing", ETA to weapons range.
- `cube-hold` — red, "Weapons free in Ns" during the window, action `engage`.
- `tractor` — red when held, action `reactor overdrive` / `target tractor`.
- `boarders-<section>` — red, action `call all hands`.

## Phases

1. **Threat** — cube model, render, approach, cutting beam via `ship.hit`,
   tractor + `warpInhibit`, alerts, hail, seeded systems + roaming spawn.
   You can only run.
2. **Fight** — `weapons` component + power, `tactical.js` state machine with the
   once-per-encounter hold window, autonomous targeting / rotation,
   adaptation, `weapons` skill, optional orders.
3. **Assimilation** — boarding, section containment, Assimilated status in
   the career, designation in later hails.

## Tests (`test.js`)

- Hold window: no order → engaged after 5 s; `hold fire` during it → holding;
  second attack in same encounter → no new window; new encounter → window again.
- No Tactical crew at stations → near-zero hit rate; full skilled watch → high.
- Repeated fire on one band → damage falls; rotation restores it.
- Tractor on → `warpInhibit` set; tractor nodes destroyed → cleared.
- Core unreachable until a face is breached.
- Weapons don't fire when the reactor can't cover shields first.
- A fore hit can damage `weapons`; low weapons health cuts fire rate;
  Tactical repairs it.
- Roaming spawn respects cooldown and never fires in home space.

## Decisions

- **Where it appears: both.** A few seeded "Collective space" systems in
  `universe.json` (generate.js marks them; the cube waits there, so entering
  is a choice) plus a rare roaming cube that can turn up anywhere (a low
  per-hour chance outside home space, with a cooldown after any encounter).
  Long-range sensors give warning in proportion to `sensorQuality`.
- **Weapons are their own component** that can be damaged (see §2).

## Open questions

- Naming: "Borg" is fine privately; rename (e.g. "the Collective") before any
  release.
