# Away team — design note

Leave the bridge. The captain and a hand-picked team go down to a planet,
by transporter or by a shuttle you fly yourself, and play a separate mode on
the surface. The view is third person, with the team following the captain.
Missions cover science, first contact, rescue, salvage, raids, resources and
more. Meanwhile the ship is still up there in orbit, and still in danger.

Status: **phases 1–3 built** (2026-10-15), by transporter. The shuttle
(phase 4) is still design, to be discussed before building.

### As built (phases 1–3) — where it differs from below

- **Terrain** is one 1,400 m mesh per site (`flight/terrainMesh.js`, 5 m
  grid) over `universe/terrain.js`'s height function; the walkable area is
  450 m around the pad, and past that the ground falls away like a horizon.
  The 32 km region is phase 4's.
- **Files**: `universe/surface.js` (kinds, hazards, sites, sun, storms),
  `universe/missions.js`, `universe/away.js`, `flight/awayEngine.js`
  (live mission + orders), `flight/SurfaceApp.jsx` (HUD),
  `flight/SurfaceScene.jsx` (3D), `flight/transporterFX.js`.
- **`standard orbit`** closes to 1.6 × the body's size and circles it
  (~2 min a lap). Given while approaching, or with a name, it orbits on
  arrival.
- **Transporter** blocks: not in orbit, warp, reactor scrammed, tractor
  beam, sensor quality < 25%, interference > 60%, a storm over a toxic
  site, a CME under 20 s out. Beaming drops shields to zero (not an
  alarm in itself, but radiation gets in until they recharge).
- **Mission types built**: science, resource (fuel from volatiles, spare
  parts from ore), rescue (1–3 survivors who die in 5–8 min unless
  stabilised). Picked per site from its seed; done sites are remembered
  in `career.away.done`.
- **Spare parts** speed component repairs ×1.75 and are used up (2 per
  whole component). Not yet required for any fault.
- **The team**: auto-picked by mission type (off-watch first), or
  `away team <names>`. Following crew take tasks within 30 m of the
  captain; `fan out` widens that to 250 m. The captain works too (E).
- **Beam up** needs everyone alive within 30 m of the captain, or
  `beam up anyway`. Anyone left behind stays `away` for the rest of the
  mission. There's no way to fetch them yet.
- Surface orders: `follow me`, `hold here`, `fan out`, `<name> scan |
  sample | collect | stabilise`, `status`, `beam up`, and
  `bridge, <order>` to relay any bridge order.
- Dev builds expose `__away()` and `__order(text)`.

## Decisions so far

- **Separate game mode**, not something run from the bridge. Its own Canvas,
  controls and HUD.
- **Third person on foot.** You move the captain with WASD and the mouse
  orbits the camera; the team follows and takes orders.
- **Captain plus 1–4 crew** picked from the roster. Skills, health, fatigue
  and XP all count, and their posts on the ship are left short.
- **Bounded landing sites**, about 1 km across and highly detailed, set
  inside a coarser **region** about 32 km across that exists for shuttle
  flight. Both come from the same seeded height function, so they match.
- **Any mission type.** Missions are data built from a shared set of
  objectives, so a new type means writing a recipe, not adding a new system.
- **The shuttle is flown by hand**: out of the bay, down through the
  atmosphere, onto the ground, and back up to dock. The computer can fly any
  leg for you (`computer, take us down`), the same way the ship obeys orders.
- **Two ways down**, each better in different situations:

| | Transporter | Shuttle |
|---|---|---|
| Speed | Instant | A flight: launch, entry, approach, landing |
| Needs | Shields down, standard orbit, sensor lock | A working shuttlebay and a pilot (you, or crew with `piloting`) |
| Blocked by | Shields up, flares and CMEs, lightning storms, damaged sensors or comms | Nothing outright; weather, terrain and enemy fire make it risky |
| Carries | Captain + up to 3, and no cargo | Captain + up to 4, plus cargo: samples, survivors, salvage, ore |
| Where you land | The site centre (or a scanned point) | Wherever you can set it down, anywhere in the region |
| Getting out | Instant, if there's a lock | The team has its own ride, even if the ship has to leave orbit |

Cargo is what makes the shuttle necessary for some missions. A rescue with
six survivors, or a salvage run for a warp coil, can't go by transporter.

## Principles

- **The ship doesn't stop.** `loop.js` steps the sim whichever Canvas is
  mounted. Flares, cubes and the crew's watches keep going while you're away.
- **The bridge runs itself while you're gone.** The first officer is the
  zero-commands default (like Tactical and repair crews): hold orbit, keep
  shields as they are, fight if attacked. Big events come to you over the
  comm badge.
- **The surface is the planet you saw from orbit.** Palette, sky, clouds,
  lightning and the sun's direction come from the same body data and seed as
  `planetShader.js` and the sim's real star position.
- **Every leg has a hands-off version.** You can hand any shuttle flight, team
  action or firefight to the crew and the computer. Flying it yourself is
  better (faster, safer landings, more XP), but never required.
- **Pure logic in `universe/`, rendering in `flight/`.** Terrain heights,
  missions, transporter rules, shuttle flight physics and surface combat
  resolve in node and are covered by `test.js`.
- **Nothing new in the asset pipeline.** Terrain, avatars, NPCs, wrecks and
  the shuttle are all procedural, like the cube.

## Files

| File | Role |
|---|---|
| `universe/terrain.js` (new) | `heightAt(body, x, z)`: one seeded height function for the region and its sites, with features by kind. Pure. |
| `universe/surface.js` (new) | Landing sites per body, hazards by kind, the suit timer. |
| `universe/missions.js` (new) | Mission recipes, objectives and how they're generated; progress, completion, rewards. |
| `universe/away.js` (new) | The away state machine: who's down, how they got there, transport rules, return. |
| `universe/shuttle.js` (new, phase 4) | Shuttle flight physics for each regime: space, atmosphere, airless powered descent. Pure. |
| `universe/groundCombat.js` (new, phase 5) | Hostiles, hits, cover, stun vs. kill, and crew decisions. Pure. |
| `universe/crew.js` | New location `away`: no `staffing()` contribution; takes surface hazards instead of ship ones. |
| `universe/ship.js` | Transporter (power, shields down); `shuttlebay` component in `MAINTENANCE` and the faults tables; a cargo/stores inventory. |
| `universe/sim.js` | `standard orbit`: a close hold inside `_holdRadius`, so transporter range is a choice you make. |
| `flight/store.js` | Top-level `mode: "bridge" \| "transit" \| "shuttle" \| "surface"`. |
| `flight/FlightApp.jsx` | Mode switching; `standard orbit`, `beam down`, `away team …`, `launch shuttle` orders. |
| `flight/SurfaceApp.jsx` (new) | On-foot mode: Canvas, HUD, command line, objectives, comm-badge log. |
| `flight/ShuttleApp.jsx` (new) | Flight mode: chase camera, cockpit HUD (altitude, vertical speed, attitude, fuel, landing marker). |
| `flight/terrainMesh.js` (new) | Chunked level-of-detail mesh over `heightAt`, reusing `planetShader.js` palettes and noise. |
| `flight/sky.js` (new) | Atmosphere colour, the real star, moons or the parent planet overhead, weather, lightning. |
| `flight/avatars.js` (new) | Low-poly crew, NPCs and hostiles, tinted by department or faction. |
| `flight/teamAI.js` (new) | Formation, moving to an order, slope avoidance, carrying. |
| `flight/shuttleMesh.js` (new) | Shuttle model, engine glow, entry plasma, landing dust. |
| `flight/transporterFX.js` (new) | The beam shimmer, in and out. |

## 1. Modes

```
bridge ─beam down──▶ transit ─▶ surface ─beam up──▶ transit ─▶ bridge
bridge ─launch──▶ shuttle(space ▸ entry ▸ atmosphere) ─land─▶ surface
surface ─board & lift off─▶ shuttle(atmosphere ▸ ascent ▸ space) ─dock─▶ bridge
```

- Only one Canvas at a time, as today. The bridge UI is unmounted, but the
  sim, ship, roster and alerts keep running.
- **Comm badge**: events above a threshold (`deny` events, red alert, cube on
  sensors, a breach) appear on foot and in the cockpit as
  *"Bridge to Captain: …"*.

## 2. Terrain (`terrain.js`, `surface.js`)

- **One height function per body**, `heightAt(body, x, z)`, made from fBm
  noise plus features by kind: dunes (desert), craters (moons, rocky), ridges
  (ice), vents (volcanic, lava), hills and coastline (class-M, ocean).
  It's pure, so ground collision, landing checks and AI can use it in node.
- **Region**: about 32 km square, drawn in chunks with level of detail. It
  only matters for shuttle flight. Edges fade into haze.
- **Sites**: 3–5 per landable body, each about 1 km, with extra detail, points of
  interest and mission content. Each sits somewhere in the region, and the
  transporter puts you at its centre.
- **Lighting** uses the real direction from the body to its star at `sim.t`.
  The night side is night.
- **Not landable**: gas giants and stars. Every other moon is landable.

### Hazards by kind

| Kind | Air | Hazard | Shuttle flight |
|---|---|---|---|
| class-M, ocean | Breathable | Weather | Atmosphere: lift, drag, turbulence in storms |
| desert | Thin | Heat: fatigue builds faster | Atmosphere, thin: less lift, dust on landing |
| toxic | Poison | Suit timer, fast | Atmosphere, dense |
| ice, icy moon | None or thin | Cold: suit timer | Thin, or airless |
| rocky, cratered moon | None | Suit timer | Airless: powered descent, lander-style |
| volcanic, lava moon | Poison | Suit timer, eruptions near vents | Thin, with ash turbulence |

## 3. Missions (`missions.js`)

A mission is data: a type, a site, a briefing, objectives, what to spawn,
limits, and rewards.

```js
{ id, type, bodyId, siteId, source, briefing,
  objectives: [{ kind, target, count, optional }],
  spawns:     [{ what: "poi"|"npc"|"hostile"|"wreck"|"deposit"|"cache", … }],
  limits:     { suitTimer, deadline, transport: "any"|"shuttle" },
  rewards:    { xp: {skill: n}, stores: {fuel, parts, …}, science, standing } }
```

**Objective kinds**, shared by every mission type: `reach`, `scan`, `sample`,
`collect`, `retrieve` (carry an item to the shuttle or a beam-out point),
`rescue` (find, stabilise, extract), `talk`, `defeat`, `disable`, `hold`
(stay put for a time), `extract` (everyone off-world).

**Types are recipes** built from those objectives:

| Type | Typical objectives | Needs | Pays |
|---|---|---|---|
| Science / survey | reach + scan POIs, sample | POIs | Science, sensor and astrophysics XP |
| Resource | collect deposits, retrieve | Deposits, cargo | Fuel, stores |
| Salvage | reach wreck, retrieve parts | Wrecks, cargo, often the shuttle | Spare parts, for faster or better repairs |
| Rescue | find survivors, stabilise, extract | NPCs, carrying, medic, often the shuttle | Standing, medicine and first-aid XP |
| First contact | reach, talk | NPCs, dialogue (`xenolinguistics`); a live-LLM special case per the README | Standing, story |
| Raid | reach, defeat / disable, retrieve, extract | Hostiles, ground combat | Stores, standing (+/−) |
| …more | (escort, defuse, investigate) | Combinations of the above | — |

**Where missions come from**: scans from orbit (anomalies, deposits),
signals decoded on Comms (`signals.js`), distress calls, hails, the existing
hand-placed content (Vela Prime's broadcast, the Vanadis), and seeded
generation per site. The computer lists what it knows: `missions`.

**Rewards change the ship.** Missions add to a new ship inventory:
`stores.fuel` raises `ship.fuel`, `stores.parts` speeds repairs or makes
failed components fixable, and science and standing are tracked for later.
This is why you'd leave the bridge at all.

## 4. The away team

- `away team <name>, …`, or let the first officer choose by mission type
  (science lead, security, medic, pilot).
- Crew go to `location: "away"`. Their departments lose staffing. That's
  the cost: if the cube turns up while your best Tactical officer is down
  here, the guns are weaker.
- **Orders**: `follow me`, `hold here`, `<name> scan`, `<name> sample`,
  `fan out`, `regroup`, `carry <name>`. Without orders, they follow and
  work any objective nearby.
- The captain has health. Critical means the team must carry them out. Death
  is game over (`GameOver.jsx`).
- Injuries, deaths and XP go back to the roster and the career save.

## 5. Transporter (`away.js`)

```js
canBeam(ship, sim, site)  // → { ok, why }
```

- Needs standard orbit, shields down, and sensor and comms health above a
  floor. Blocked by lightning over the site (`hasLightning`), CMEs and flares.
- **Emergency beam-out**: any lock, even with shields up. Drops them for a
  moment; it can fail under interference.
- No cargo beyond what people carry by hand (a sample case).

## 6. The shuttle (`shuttle.js`, phase 4)

One craft and one set of controls, with the physics changing by **regime**:

| Regime | Where | Physics | Hand-off |
|---|---|---|---|
| **Space** | Bay to entry interface | Thrust plus RCS (reaction thrusters) in the existing universe, with the planet's gravity from `physics.js`. Shown in the space `Scene` with a chase camera | Below the entry altitude → **Entry** |
| **Entry** | Upper atmosphere | Heating rises with speed and angle; plasma on screen; too steep and the hull is damaged, too shallow and you skip off | Speed and altitude low enough → Atmosphere |
| **Atmosphere** | Region, about 32 km | Lift, drag and stall; hover jets for vertical landing; storms add turbulence and lightning | Touchdown → Surface |
| **Airless descent** | Region, airless bodies | No lift: thrust against gravity, lander-style; the fuel budget is the challenge | Touchdown → Surface |

- **Scale hand-off.** The universe is compressed (a planet is about 1 unit
  across), so you can't fly continuously from orbit to the ground. The space
  leg ends at the entry interface, and the region begins at its matching
  heading, speed and position over the ground. The entry plasma covers the
  join.
- **Landing**: judged on vertical speed, ground slope (`heightAt`) and
  attitude. A soft landing is fine, a hard one damages the shuttle and
  injures crew, and too hard is a crash.
- **Return**: board, lift off, climb out (or burn out, on airless bodies),
  then the space leg: rendezvous with the ship and dock into the bay through
  an approach corridor at low closing speed.
- **Controls**: W/S throttle, mouse for pitch and roll, A/D yaw,
  Space/C hover jets up and down. Gamepad later.
- **Autopilot**: `computer, take us down` / `take us home` / `dock` fly
  each leg using the pilot's `piloting` skill. Worse pilots land harder.
- **Shuttle state** (hull, fuel, cargo) lives in `ship.js` beside the bay. A
  shuttle lost on the surface stays lost.
- **Danger in the space leg**: a cube can intercept the shuttle as well as
  the ship.

## 7. Ground combat (`groundCombat.js`, phase 5, for raids)

Following the Tactical principle: **the crew fight, the captain commands.**
The captain aims and fires their own phaser (with stun and kill settings);
the team picks targets and takes cover on their own, judged by
`security-ops` and `weapons`. Orders are optional: `take cover`, `focus
<target>`, `fall back`, `phasers to stun`. Hostiles use the same avatars
with a simple cover-and-advance AI. Any mission type can turn violent
(first contact gone wrong, a defended wreck), so combat is shared, not
specific to raids.

## Phases

1. **Mode switch and a bare surface, by transporter.** `standard orbit`,
   `beam down`, a seeded site from `heightAt`, sky and sun, third-person
   movement, `beam up`. The ship keeps simulating; comm-badge messages.
   *Tests*: `heightAt` is deterministic, `canBeam` rules.
2. **The away team.** Picking crew, the `away` location and its staffing
   cost, follower AI, team orders, the suit timer and hazards by kind.
3. **Mission framework and the first types.** `missions.js`, objectives and the
   HUD, the ship inventory and rewards. Ship **science**, **resource** and
   **rescue** (by transporter: few survivors). Injuries and death carried
   back to the career.
4. **The shuttle**, in three parts:
   - 4a: region terrain with level of detail, the atmosphere and airless flight
     regimes, landing and take-off within the region (start already in the air).
   - 4b: space leg: launch from the bay, entry hand-off, ascent,
     rendezvous and docking.
   - 4c: `shuttlebay` component and faults, cargo, autopilot, crew pilots.
     **Salvage** and large-scale rescue unlock here.
5. **Ground combat.** Hostiles, phasers, cover, crew combat decisions.
   **Raid** unlocks.
6. **First contact and the danger from above.** NPC dialogue (offline
   `xenolinguistics` gating; live LLM as the special case), transporter blocks
   by flares and storms, emergency beam-out, stranding, a cube appearing
   mid-mission, shuttle intercepts.

## Open questions

- **Shuttle feel**: arcade or simulation? Proposed: arcade-leaning
  (assisted attitude hold, forgiving stall), with real fuel and landing
  limits.
- **Ground combat feel**: how much shooter? Proposed: light: click a target
  to fire at it, no twitch aiming, crew doing most of the work.
- **The ship inventory**: does `stores.parts` replace or speed up today's
  time-based repairs? Proposed: speeds them up, and is required for some
  faults.
- **Captain death**: proposed yes, with the team able to carry them out.
- **Time**: the same clock (a ship hour is a minute) on foot and in flight.
