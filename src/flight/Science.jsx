// Science.jsx — the SCIENCE station's screen: the ship's condition at a
// glance. A top-down schematic in the middle, coloured by the state of each
// hull section and the component sitting in it, with the shield bubble
// drawn around it; engineering (reactor, power, fuel, heat) down the left;
// what keeps the crew alive and the ship in one piece down the right.
//
// Everything here reads the ship.js snapshot the flight UI publishes a few
// times a second (store.js `ship`) — no Canvas, no per-frame work. The only
// animation is CSS: the reactor's pulse and the flash where a hit landed.
import { useUI } from "./store.js";
import { POWER_SYSTEMS } from "../universe/ship.js";
import { fmtEta } from "../universe/alerts.js";
import { HULL_PATHS } from "./shipShape.js";

const pct = (x) => `${Math.round(x * 100)}%`;
// Condition colour: `good` is the healthy end — pass `invert` for readings
// where high is bad (heat, CO2, interference).
function level(x, invert = false) {
  const v = invert ? 1 - x : x;
  return v > 0.7 ? "ok" : v > 0.4 ? "warn" : "crit";
}

function Spark({ data, invert = false, max = 1, neutral = false }) {
  if (!data || data.length < 2) return <svg className="sci-spark" />;
  const w = 64, h = 16;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - Math.min(1, v / max) * (h - 2) - 1}`).join(" ");
  const last = data[data.length - 1];
  return (
    <svg className={`sci-spark ${neutral ? "info" : level(last / max, invert)}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} />
    </svg>
  );
}

// One reading: label, value, a bar, and (optionally) the last two minutes.
// `neutral` for readings that aren't good or bad in themselves (reactor output).
function Meter({ label, value, text, invert = false, history, max = 1, sub, neutral = false }) {
  const lv = neutral ? "info" : level(value / max, invert);
  return (
    <div className="sci-meter">
      <div className="sci-meter-head">
        <span className="sci-meter-label">{label}</span>
        {history && <Spark data={history} invert={invert} max={max} neutral={neutral} />}
        <span className={`sci-meter-value ${lv}`}>{text ?? pct(value)}</span>
      </div>
      <div className="sci-bar"><span className={lv} style={{ width: `${Math.min(1, value / max) * 100}%` }} /></div>
      {sub && <div className="sci-meter-sub">{sub}</div>}
    </div>
  );
}

function Panel({ title, children, accent, grid = false }) {
  return (
    <div className={`sci-panel ${accent ?? ""}`}>
      <div className="sci-panel-title">{title}</div>
      {grid ? <div className="sci-panel-grid">{children}</div> : children}
    </div>
  );
}

const POWER_LABEL = { life: "LIFE SUPPORT", shields: "SHIELDS", engines: "ENGINES", sensors: "SENSORS", comms: "COMMS" };

function PowerPanel({ s }) {
  const { power, reactor, settings } = s;
  // Bars share one scale so they compare: the largest demand any system can
  // make (warp 3, or shields boosted) sits comfortably inside it.
  const scale = 50;
  return (
    <Panel title="POWER DISTRIBUTION">
      {POWER_SYSTEMS.map((k) => {
        const d = power.demand[k] ?? 0, a = power.alloc[k] ?? 0;
        const short = d > 0 && a < d - 0.05;
        return (
          <div key={k} className="sci-power-row" title={`${a.toFixed(0)} of ${d.toFixed(0)} units`}>
            <span className="sci-power-name">{POWER_LABEL[k]}</span>
            <span className="sci-power-track">
              <span className="sci-power-want" style={{ width: `${Math.min(1, d / scale) * 100}%` }} />
              <span className={`sci-power-got ${short ? "short" : ""}`} style={{ width: `${Math.min(1, a / scale) * 100}%` }} />
            </span>
            <span className={`sci-power-set ${settings[k] !== 1 ? "changed" : ""}`}>{pct(settings[k])}</span>
          </div>
        );
      })}
      <div className="sci-power-total">
        {power.total.toFixed(0)} / {reactor.capacity.toFixed(0)} units
        {power.want > reactor.capacity + 1 && <span className="crit"> · SHORT {(power.want - reactor.capacity).toFixed(0)}</span>}
      </div>
    </Panel>
  );
}

// ---- the schematic ----------------------------------------------------------
// Nose up, port on the left (looking down from galactic up). Hull sections
// and component locations match SECTION_COMPONENTS in ship.js, so a hit on a
// side lights up the parts it can damage.
// Where each section's integrity is printed.
const HULL_LABEL_AT = { fore: [0, -168], port: [-30, 80], starboard: [30, 80], aft: [0, 128] };
// Where a hit on each side flashes on the shield bubble.
const HIT_AT = { fore: [0, -282], aft: [0, 262], port: [-188, -10], starboard: [188, -10] };

function Callout({ x, y, tx, side, label, value, lv }) {
  const anchor = side === "left" ? "end" : "start";
  const lx = side === "left" ? tx + 6 : tx - 6;
  return (
    <g className={`sci-callout ${lv}`}>
      <polyline points={`${x},${y} ${lx},${y}`} />
      <circle cx={x} cy={y} r="2.5" />
      <text x={tx} y={y - 3} textAnchor={anchor} className="sci-callout-label">{label}</text>
      <text x={tx} y={y + 11} textAnchor={anchor} className="sci-callout-value">{value}</text>
    </g>
  );
}

function Schematic({ s }) {
  const h = s.health;
  const lv = (x) => level(x);
  const out = s.reactor.scrammed ? 0 : s.reactor.output / 100;
  const hot = s.heat;
  const recentHit = s.lastHit && Date.now() - s.lastHit.at < 2000 ? s.lastHit : null;
  return (
    <svg className="sci-schematic" viewBox="-270 -300 540 580" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="sci-shield" cx="50%" cy="50%" r="50%">
          <stop offset="70%" stopColor="#6699ff" stopOpacity="0" />
          <stop offset="100%" stopColor="#6699ff" stopOpacity="0.35" />
        </radialGradient>
        <radialGradient id="sci-core">
          <stop offset="0%" stopColor={hot > 0.75 ? "#ffd0a0" : "#d8f4ff"} />
          <stop offset="55%" stopColor={hot > 0.75 ? "#ff5544" : "#5fc8ff"} />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sci-hit">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="40%" stopColor="#ff9c33" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#ff5544" stopOpacity="0" />
        </radialGradient>
        <pattern id="sci-breach" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="#2a0806" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="#ff5544" strokeWidth="3" />
        </pattern>
      </defs>

      {/* grid */}
      <g className="sci-grid">
        {[-200, -100, 0, 100, 200].map((x) => <line key={`x${x}`} x1={x} y1="-290" x2={x} y2="270" />)}
        {[-250, -150, -50, 50, 150, 250].map((y) => <line key={`y${y}`} x1="-260" y1={y} x2="260" y2={y} />)}
      </g>

      {/* shield bubble — fades with strength, flickers when weak, gone at zero */}
      {s.shields >= 0.02 ? (
        <ellipse
          cx="0" cy="-10" rx="190" ry="276"
          fill="url(#sci-shield)"
          className={`sci-shield ${s.shields < 0.25 ? "weak" : ""}`}
          style={{ opacity: 0.1 + 0.9 * s.shields }}
        />
      ) : (
        <ellipse cx="0" cy="-10" rx="190" ry="276" className="sci-shield-gone" />
      )}
      {recentHit && (
        <circle key={recentHit.at} className="sci-hit" cx={HIT_AT[recentHit.side][0]} cy={HIT_AT[recentHit.side][1]} r="70" fill="url(#sci-hit)" />
      )}

      {/* nacelles + pylons (warp coils) */}
      {[-1, 1].map((sx) => (
        <g key={sx} className={`sci-comp ${lv(h.warp)}`}>
          <rect x={sx < 0 ? -156 : 120} y="-92" width="36" height="214" rx="16" />
          <rect x={sx < 0 ? -150 : 126} y="-84" width="24" height="36" rx="10" className="sci-nacelle-cap" />
          {[-30, 0, 30, 60, 90].map((y) => (
            <line key={y} x1={sx * 128} y1={y} x2={sx * 148} y2={y} className="sci-coil" />
          ))}
        </g>
      ))}

      {/* hull sections */}
      {Object.entries(HULL_PATHS).map(([k, d]) => {
        const v = s.hull[k];
        const breached = s.breached.includes(k);
        return (
          <path key={k} d={d} className={`sci-hull ${level(v)} ${breached ? "breached" : ""}`}
            fill={breached ? "url(#sci-breach)" : undefined} />
        );
      })}
      {/* panel lines */}
      <g className="sci-panel-lines">
        <line x1="0" y1="-250" x2="0" y2="225" />
        <path d="M-36,-60 L36,-60 M-50,0 L50,0 M-56,60 L56,60 M-50,170 L50,170" />
      </g>

      {/* radiators — aft fins */}
      <g className={`sci-comp ${lv(h.radiators)}`}>
        <path d="M-56,150 L-112,196 L-104,206 L-50,172 Z" />
        <path d="M56,150 L112,196 L104,206 L50,172 Z" />
        <path d="M-52,188 L-90,228 L-82,236 L-44,206 Z" />
        <path d="M52,188 L90,228 L82,236 L44,206 Z" />
      </g>

      {/* impulse exhaust */}
      <g className={`sci-comp ${lv(h.impulse)}`}>
        <rect x="-28" y="230" width="56" height="12" rx="3" />
        <rect x="-24" y="244" width="48" height={4 + 14 * s.impulseFactor * (s.power.sat.engines ?? 0) * Math.min(1, (s.power.demand.engines ?? 0) / 30)}
          rx="3" className="sci-exhaust" />
      </g>

      {/* reactor core */}
      <g className={`sci-comp ${lv(h.reactor)}`}>
        <circle cx="0" cy="160" r="22" />
        <circle cx="0" cy="160" r={8 + 12 * Math.min(1.2, out)} fill="url(#sci-core)"
          className={`sci-core ${s.reactor.scrammed ? "scram" : ""}`}
          style={{ animationDuration: `${1.6 - Math.min(1.2, out)}s` }} />
      </g>

      {/* life support — starboard */}
      <g className={`sci-comp ${lv(h.life)}`}>
        <rect x="14" y="-20" width="32" height="56" rx="5" />
        <path d="M22,-6 h16 M22,8 h16 M22,22 h16" className="sci-detail" />
      </g>

      {/* shield emitters — port side node and hull-edge nodes */}
      <g className={`sci-comp ${lv(h.emitters)}`}>
        <rect x="-46" y="-20" width="32" height="56" rx="5" />
        <circle cx="-30" cy="8" r="9" className="sci-detail" />
        {[[0, -248], [-44, -126], [44, -126], [-60, 104], [60, 104], [0, 226]].map(([x, y]) => (
          <rect key={`${x},${y}`} x={x - 4} y={y - 4} width="8" height="8" transform={`rotate(45 ${x} ${y})`} />
        ))}
      </g>

      {/* bridge (decor) */}
      <rect x="-14" y="-104" width="28" height="22" rx="6" className="sci-bridge" />

      {/* comms dish */}
      <g className={`sci-comp ${lv(h.comms)}`}>
        <circle cx="0" cy="-150" r="13" />
        <path d="M-8,-150 A8,8 0 0 1 8,-150" className="sci-detail" />
      </g>

      {/* sensor dome */}
      <g className={`sci-comp ${lv(h.sensors)}`}>
        <circle cx="0" cy="-218" r="10" />
        <circle cx="0" cy="-218" r="4" className="sci-detail" />
      </g>

      {/* hull section integrity */}
      {Object.entries(HULL_LABEL_AT).map(([k, [x, y]]) => (
        <text key={k} x={x} y={y} textAnchor="middle" className={`sci-hull-pct ${level(s.hull[k])}`}>{pct(s.hull[k])}</text>
      ))}

      {/* callouts */}
      <Callout x={-10} y={-218} tx={-170} side="left" label="SENSORS" value={pct(h.sensors)} lv={lv(h.sensors)} />
      <Callout x={-13} y={-150} tx={-170} side="left" label="COMMS ARRAY" value={pct(h.comms)} lv={lv(h.comms)} />
      <Callout x={-46} y={8} tx={-170} side="left" label="SHIELD EMITTERS" value={pct(h.emitters)} lv={lv(h.emitters)} />
      <Callout x={-156} y={-60} tx={-176} side="left" label="WARP COILS" value={s.warpMax ? `${pct(h.warp)} · max ${s.warpMax}` : `${pct(h.warp)} · OFF-LINE`} lv={lv(h.warp)} />
      <Callout x={-108} y={200} tx={-170} side="left" label="RADIATORS" value={pct(h.radiators)} lv={lv(h.radiators)} />
      <Callout x={46} y={8} tx={170} side="right" label="LIFE SUPPORT" value={pct(h.life)} lv={lv(h.life)} />
      <Callout x={22} y={160} tx={170} side="right" label="REACTOR" value={s.reactor.scrammed ? "SCRAM" : pct(h.reactor)} lv={s.reactor.scrammed ? "crit" : lv(h.reactor)} />
      <Callout x={28} y={236} tx={170} side="right" label="IMPULSE" value={pct(h.impulse)} lv={lv(h.impulse)} />
    </svg>
  );
}

// ---- priorities ---------------------------------------------------------------
// The top of the alert board (alerts.js): what's wrong, worst first, with a
// countdown where there's a rate to count down from, and the order that
// deals with it — click to give it.
function Priority() {
  const alert = useUI((st) => st.alert);
  const runOrder = useUI((st) => st.runOrder);
  const top = alert.threats.filter((t) => t.id !== "crew-lost").slice(0, 3);
  // One button per order — two threats fixed by the same order share it.
  const offered = new Set();
  const actionFor = (t) => (t.action && !offered.has(t.action) && offered.add(t.action) ? t.action : null);
  if (alert.threats[0]?.id === "crew-lost") {
    return <div className="sci-priority red"><span className="sci-priority-ok crit">NO LIFE SIGNS</span></div>;
  }
  if (!top.length) {
    return <div className="sci-priority green"><span className="sci-priority-ok">CONDITION GREEN — no threats</span></div>;
  }
  return (
    <div className={`sci-priority ${alert.level}`}>
      {top.map((t) => ({ ...t, action: actionFor(t) })).map((t) => (
        <div key={t.id} className={`sci-threat ${t.level}`}>
          <span className="sci-threat-dot" />
          <span className="sci-threat-text">
            <span className="sci-threat-title">{t.title}</span>
            {t.detail && <span className="sci-threat-detail">{t.detail}</span>}
          </span>
          {t.eta != null && t.eta < 600 && <span className="sci-threat-eta">{fmtEta(t.eta)}</span>}
          {t.action && (
            <button className="sci-threat-action" onClick={() => runOrder?.(t.action)} title="Give this order">
              {t.action}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---- the screen -------------------------------------------------------------
export default function Science() {
  const s = useUI((st) => st.ship);
  if (!s) return <div className="sci-overlay" />;
  const hist = s.history;
  const a = s.atmo;
  const flux = s.flux.heat + s.flux.rad > 0.05
    ? `Stellar flux — heat ${s.flux.heat.toFixed(1)} · radiation ${s.flux.rad.toFixed(1)}`
    : "Deep space — no significant stellar flux";

  return (
    <div className="sci-overlay">
      <div className="sci-head">
        <span>SHIP STATUS — USS MERIDIAN</span>
        <span className="sci-head-flux">{flux}</span>
      </div>
      <div className="sci-body">
        <div className="sci-col">
          <Panel title="REACTOR" accent="a-amber">
            <Meter
              label={s.reactor.scrammed ? `SCRAMMED — restart ${Math.max(0, s.reactor.restartIn).toFixed(0)}s` : "OUTPUT"}
              value={s.reactor.output / 100} max={1.2} history={hist.power} neutral={!s.reactor.scrammed}
              text={`${s.reactor.output.toFixed(0)} u`}
              sub={`limit ${pct(s.reactor.setting)} · core ${pct(s.health.reactor)}`}
            />
          </Panel>
          <PowerPanel s={s} />
          <Panel title="FUEL — REGENERATIVE" accent="a-amber">
            <Meter label="RESERVE" value={s.fuel} history={hist.fuel}
              sub={s.flux.heat > 0.2 ? "Collectors drawing from stellar flux" : "Collectors idle — no star close enough"} />
          </Panel>
          <Panel title="HEAT" accent="a-amber">
            <Meter label="THERMAL LOAD" value={s.heat} invert history={hist.heat}
              sub={s.heat > 0.9 ? "Components overheating" : s.heat > 0.75 ? "Reactor derating" : `Radiators ${pct(s.health.radiators)}`} />
          </Panel>
        </div>

        <div className="sci-center">
          <Priority />
          <Schematic s={s} />
          <div className="sci-legend">
            <span className="ok">■ NOMINAL</span><span className="warn">■ DEGRADED</span><span className="crit">■ CRITICAL</span>
          </div>
        </div>

        <div className="sci-col">
          <Panel title="DEFENSE" accent="a-blue">
            <Meter label="SHIELDS" value={s.shields} history={hist.shields}
              sub={s.shields < 0.02 ? `DOWN — emitters ${pct(s.health.emitters)}` : s.flux.rad > 0.5 ? `Absorbing radiation — emitters ${pct(s.health.emitters)}` : `Emitters ${pct(s.health.emitters)}`} />
            <Meter label="HULL INTEGRITY" value={s.hullIntegrity} history={hist.hull}
              sub={s.breached.length ? `BREACH — ${s.breached.join(", ")}` : null} />
          </Panel>
          <Panel title="LIFE SUPPORT" accent="a-blue">
            <Meter label="BREATHABLE AIR" value={a.breathable} history={hist.o2}
              sub={a.pressure < 0.95 ? `O₂ mix ${pct(a.o2)} at ${a.pressure.toFixed(2)} atm` : null} />
            <Meter label="CO₂" value={a.co2} invert />
            <Meter label="PRESSURE" value={a.pressure} text={`${a.pressure.toFixed(2)} atm`} />
          </Panel>
          <Panel title="CREW" accent="a-blue">
            {(() => {
              const c = s.roster.counts, total = s.roster.total, alive = total - c.dead;
              return (
                <Meter label="ALIVE" value={alive / total} history={hist.crew} text={`${alive} / ${total}`}
                  sub={[c.injured && `${c.injured} injured`, c.critical && `${c.critical} critical`, s.roster.sheltered && "in shelter"]
                    .filter(Boolean).join(" · ") || "All fit"} />
              );
            })()}
            <Meter label="WORST DOSE" value={s.dose} max={4} invert history={hist.dose}
              text={`${s.dose.toFixed(2)} Sv`}
              sub={`${(s.doseRate * 3600).toFixed(2)} Sv/h now`} />
          </Panel>
          <Panel title="SYSTEMS" accent="a-blue" grid>
            <Meter label="IMPULSE" value={s.impulseFactor} />
            <Meter label="WARP" value={s.warpInhibit ? 0 : s.warpMax / 3} text={s.warpInhibit ? "OFF-LINE" : `MAX ${s.warpMax}`}
              sub={s.warpInhibit ? s.warpInhibit : null} />
            <Meter label="COMMS" value={s.commsQuality} sub={s.interference > 0.1 ? `Interference ${pct(s.interference)}` : null} />
            <Meter label="SENSORS" value={s.sensorQuality} sub={s.noise > 0.1 ? `Noise ${pct(s.noise)}` : null} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
