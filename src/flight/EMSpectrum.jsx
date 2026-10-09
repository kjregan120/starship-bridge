// EMSpectrum.jsx — the object's emission plotted on a real log-wavelength
// axis (100 m radio on the left down to 1 pm gamma on the right), instead of
// the anonymous amplitude bars this replaces. Three things are drawn on it:
//
//   1. the thermal continuum, from Planck's law at the body's effective
//      temperature — this is what makes star class legible as a *shape*,
//      an M-type's curve slumping into the IR while a B-type crowds the UV;
//   2. non-thermal humps for the Radio/Microwave band readings, which a
//      blackbody alone would never produce (a pulsar's radio emission is
//      synchrotron, not heat, so it sits far above its own continuum);
//   3. element emission lines at their actual measured wavelengths, tinted
//      with that wavelength's true visible color.
//
// The whole of visible light is a ~0.24-decade sliver of a 14-decade axis, so
// on the main plot it is about six pixels wide and every element line lands on
// top of every other one. Hence the zoomed inset strip underneath, which
// re-plots 380–780nm linearly — the same thing a real spectroscopy readout
// does, and the only way the lines are readable at all.
//
// Gravimetric and Subspace are not electromagnetic and deliberately have no
// place on the axis — they are reported underneath as separate gauges. See the
// long comment in signals.js for why that omission is the point.
//
// `tunedBand` (one of profile.bands[].name, or null) is the `tune` command's
// state (FlightApp.jsx/store.js) — it dims every region *except* the tuned
// one, so the highlight always shows which band the receiver is actually
// filtering toward. The thermal continuum is deliberately exempt: it isn't
// one of the five tunable bands, it's a separate physical model laid over
// them, so it stays fully visible no matter what's tuned.
import { useEffect, useMemo, useRef } from "react";
import { EM_BANDS, emissionTemperature, planckRadiance, wienPeak, emissionLines } from "../universe/signals.js";

const LOG_MIN = -12; // 1 pm — hard gamma
const LOG_MAX = 2;   // 100 m — long radio
const VIS_LO = 380, VIS_HI = 780; // nm, the inset's linear range

// Authoring size in CSS pixels; the backing store is SCALE times this so the
// 8–10px labels stay crisp when the panel paints it at its natural width.
const W = 330, H = 228, SCALE = 2;

// Dan Bruton's visible-wavelength -> RGB approximation, with the usual
// intensity rolloff at both ends of human vision so the violet and deep-red
// edges fade out instead of terminating on a hard line.
function wavelengthRGB(nm) {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else if (nm <= 780) { r = 1; }
  let f = 1;
  if (nm >= 380 && nm < 420) f = 0.3 + (0.7 * (nm - 380)) / 40;
  else if (nm > 700 && nm <= 780) f = 0.3 + (0.7 * (780 - nm)) / 80;
  else if (nm < 380 || nm > 780) f = 0;
  const ch = (x) => Math.round(255 * Math.pow(Math.max(0, x * f), 0.8));
  return [ch(r), ch(g), ch(b)];
}

// Human-readable wavelength, picking its own unit.
function formatLambda(m) {
  if (m >= 1) return `${Math.round(m)}m`;
  if (m >= 1e-2) return `${Math.round(m * 100)}cm`;
  if (m >= 1e-3) return `${Math.round(m * 1e3)}mm`;
  if (m >= 1e-6) return `${(m * 1e6).toFixed(m * 1e6 < 10 ? 1 : 0)}µm`;
  if (m >= 1e-9) return `${(m * 1e9).toFixed(m * 1e9 < 10 ? 1 : 0)}nm`;
  return `${(m * 1e12).toFixed(0)}pm`;
}

// Alpha for every region except the tuned one. Full brightness (1) when
// nothing is tuned.
const DIM_ALPHA = 0.22;

export default function EMSpectrum({ obj, profile, tunedBand = null }) {
  const canvasRef = useRef(null);
  // memoized so its identity doesn't restart the draw loop on every poll tick
  const lines = useMemo(() => emissionLines(obj, profile), [obj.id, profile]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas.getContext("2d");

    const padL = 8, padR = 8, padT = 10;
    const plotW = W - padL - padR;
    const baseY = 132, plotH = baseY - padT;
    const insetTop = 176, insetH = 32, insetBot = insetTop + insetH;

    const T = emissionTemperature(obj);
    const peak = wienPeak(T);
    const bandAmp = (n) => profile.bands.find((b) => b.name === n)?.amplitude ?? 0;
    const alphaFor = (name) => (!tunedBand || tunedBand === name ? 1 : DIM_ALPHA);

    // log10(wavelength in m) -> x. Long wavelengths on the left, the way every
    // textbook EM chart is drawn.
    const x = (m) => padL + ((LOG_MAX - Math.log10(m)) / (LOG_MAX - LOG_MIN)) * plotW;
    // the inset's own linear nm -> x
    const xv = (nm) => padL + ((nm - VIS_LO) / (VIS_HI - VIS_LO)) * plotW;

    // Precompute the continuum, normalized to its own peak, so a 1.2 MK
    // accretion disk and a 110 K ice world are both readable on one axis.
    let curve = null;
    if (T) {
      curve = new Array(Math.ceil(plotW));
      let max = 0;
      for (let px = 0; px < curve.length; px++) {
        const logL = LOG_MAX - (px / plotW) * (LOG_MAX - LOG_MIN);
        const v = planckRadiance(Math.pow(10, logL), T);
        curve[px] = v;
        if (v > max) max = v;
      }
      if (max > 0) for (let px = 0; px < curve.length; px++) curve[px] /= max;
    }

    let raf;
    function draw(t) {
      raf = requestAnimationFrame(draw);
      g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      g.clearRect(0, 0, W, H);

      // ---- main log-wavelength plot ----------------------------------------
      EM_BANDS.forEach((band) => {
        const x0 = x(band.from), x1 = x(band.to);
        if (band.tint) {
          g.fillStyle = band.tint + "1c";
          g.fillRect(x0, padT, x1 - x0, plotH);
        } else {
          for (let px = Math.floor(x0); px < x1; px++) {
            const logL = LOG_MAX - ((px - padL) / plotW) * (LOG_MAX - LOG_MIN);
            const [r, gg, bb] = wavelengthRGB(Math.pow(10, logL) * 1e9);
            g.fillStyle = `rgba(${r},${gg},${bb},0.55)`;
            g.fillRect(px, padT, 1, plotH);
          }
        }
        g.strokeStyle = "rgba(140,190,255,0.14)"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x0, padT); g.lineTo(x0, baseY); g.stroke();
      });

      // decade ticks
      g.font = "8px Oswald, monospace"; g.textAlign = "center";
      for (let e = LOG_MAX; e >= LOG_MIN; e -= 2) {
        const px = x(Math.pow(10, e));
        g.strokeStyle = "rgba(140,190,255,0.08)";
        g.beginPath(); g.moveTo(px, padT); g.lineTo(px, baseY); g.stroke();
        g.fillStyle = "#3f5f74";
        // the outermost ticks sit on the plot edge, so centring clips them
        g.textAlign = e === LOG_MAX ? "left" : e === LOG_MIN ? "right" : "center";
        g.fillText(formatLambda(Math.pow(10, e)), px, baseY + 10);
      }

      // Non-thermal Radio / Microwave humps. Drawn before the continuum so a
      // strong continuum still reads as the dominant feature where it applies.
      const hump = (from, to, amp, color) => {
        if (amp <= 0.02) return;
        const x0 = x(from), x1 = x(to), mid = (x0 + x1) / 2, half = (x1 - x0) / 2;
        g.beginPath(); g.moveTo(x0, baseY);
        for (let px = x0; px <= x1; px += 2) {
          const u = (px - mid) / half;
          g.lineTo(px, baseY - amp * Math.exp(-u * u * 2.2) * plotH * 0.82);
        }
        g.lineTo(x1, baseY); g.closePath();
        g.fillStyle = color + "55"; g.fill();
        g.strokeStyle = color + "cc"; g.lineWidth = 1.2; g.stroke();
      };
      // a slow breath so the panel reads as a live instrument, not a diagram
      const breathe = 1 + Math.sin(t / 900) * 0.03;
      g.save(); g.globalAlpha = alphaFor("Radio");
      hump(1e2, 1e-1, bandAmp("Radio") * breathe, "#6bffc4");
      g.restore();
      g.save(); g.globalAlpha = alphaFor("Microwave");
      hump(1e-1, 1e-3, bandAmp("Microwave") * (2 - breathe), "#7fd7ff");
      g.restore();

      // thermal continuum
      if (curve) {
        g.beginPath();
        for (let px = 0; px < curve.length; px++) {
          const y = baseY - curve[px] * plotH * 0.88;
          if (px === 0) g.moveTo(padL + px, y); else g.lineTo(padL + px, y);
        }
        g.strokeStyle = "#ffcc99"; g.lineWidth = 1.5;
        g.shadowColor = "#ffcc99"; g.shadowBlur = 5;
        g.stroke();
        g.shadowBlur = 0;

        const pxPeak = x(peak);
        g.strokeStyle = "rgba(255,204,153,0.45)"; g.lineWidth = 1;
        g.setLineDash([2, 3]);
        g.beginPath(); g.moveTo(pxPeak, padT); g.lineTo(pxPeak, baseY); g.stroke();
        g.setLineDash([]);
        g.fillStyle = "#ffcc99"; g.font = "9px Oswald, monospace";
        g.textAlign = pxPeak > W / 2 ? "right" : "left";
        g.fillText(`λmax ${formatLambda(peak)} · ${Math.round(T).toLocaleString()}K`,
          pxPeak + (pxPeak > W / 2 ? -4 : 4), padT + 8);
      }

      // element lines on the main axis — a single dense smear, which is the
      // honest picture at this scale; the inset below is where they resolve
      g.save(); g.globalAlpha = alphaFor("Elements");
      lines.forEach((line) => {
        const px = x(line.nm * 1e-9);
        g.strokeStyle = "rgba(255,255,255,0.5)"; g.lineWidth = 0.7;
        // kept low: at this scale they are an unreadable smear whose only job
        // is to say "there is line structure in here" — the inset is the readout
        g.beginPath(); g.moveTo(px, baseY); g.lineTo(px, baseY - line.strength * plotH * 0.45); g.stroke();
      });
      g.restore();

      g.strokeStyle = "rgba(140,190,255,0.3)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(padL, baseY); g.lineTo(W - padR, baseY); g.stroke();

      // band names, skipping any region too narrow to hold its own label
      g.font = "8px Oswald, monospace"; g.textAlign = "center";
      EM_BANDS.forEach((band) => {
        const x0 = x(band.from), x1 = x(band.to);
        if (x1 - x0 < 18) return;
        g.fillStyle = band.tint || "#cfe0ff";
        g.fillText(band.short, (x0 + x1) / 2, baseY + 21);
      });

      // ---- zoom callout: that sliver, expanded ------------------------------
      // The whole inset is Elements' territory, same as the main-axis lines
      // above — one alpha for the pair rather than repeating alphaFor() calls.
      g.save(); g.globalAlpha = alphaFor("Elements");
      const vx0 = x(VIS_HI * 1e-9), vx1 = x(VIS_LO * 1e-9);
      g.fillStyle = "rgba(255,255,255,0.06)";
      g.beginPath();
      g.moveTo(vx0, baseY); g.lineTo(vx1, baseY);
      g.lineTo(W - padR, insetTop); g.lineTo(padL, insetTop);
      g.closePath(); g.fill();
      g.strokeStyle = "rgba(140,190,255,0.28)"; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(vx0, baseY); g.lineTo(padL, insetTop); g.stroke();
      g.beginPath(); g.moveTo(vx1, baseY); g.lineTo(W - padR, insetTop); g.stroke();
      // outline the source sliver so it's clear what's being magnified
      g.strokeStyle = "rgba(255,255,255,0.55)";
      g.strokeRect(vx0, padT, Math.max(2, vx1 - vx0), plotH);

      // The visible range, linear and in true color. Dimmed hard when there
      // are no lines on it, so an empty strip reads as an unused scale rather
      // than as a claim that the body is glowing in visible light.
      const stripAlpha = lines.length ? 0.42 : 0.1;
      for (let px = padL; px < W - padR; px++) {
        const nm = VIS_LO + ((px - padL) / plotW) * (VIS_HI - VIS_LO);
        const [r, gg, bb] = wavelengthRGB(nm);
        g.fillStyle = `rgba(${r},${gg},${bb},${stripAlpha})`;
        g.fillRect(px, insetTop, 1, insetH);
      }
      if (!lines.length) {
        g.fillStyle = "rgba(120,140,170,0.75)"; g.font = "8px Oswald, monospace"; g.textAlign = "center";
        g.fillText("NO EMISSION LINES", W / 2, insetTop + insetH / 2 + 3);
      }
      g.strokeStyle = "rgba(140,190,255,0.28)"; g.lineWidth = 1;
      g.strokeRect(padL, insetTop, plotW, insetH);

      lines.forEach((line) => {
        const px = xv(line.nm);
        const [r, gg, bb] = wavelengthRGB(line.nm);
        const h = 6 + line.strength * (insetH - 8);
        g.strokeStyle = `rgb(${r},${gg},${bb})`; g.lineWidth = 1.4;
        g.shadowColor = `rgb(${r},${gg},${bb})`; g.shadowBlur = 5;
        g.beginPath(); g.moveTo(px, insetBot - 1); g.lineTo(px, insetBot - 1 - h); g.stroke();
        g.shadowBlur = 0;
      });

      // Caption sits *below* the strip: above it the two zoom connectors are
      // converging on the strip's top corners and would run straight through.
      g.font = "8px Oswald, monospace"; g.fillStyle = "#4f7a8f";
      g.textAlign = "left"; g.fillText("380nm", padL, insetBot + 10);
      g.textAlign = "center"; g.fillText("VISIBLE — EMISSION LINES", W / 2, insetBot + 10);
      g.textAlign = "right"; g.fillText("780nm", W - padR, insetBot + 10);
      g.restore();

      if (!T && lines.length === 0 && bandAmp("Radio") < 0.05 && bandAmp("Microwave") < 0.05) {
        g.fillStyle = "rgba(255,85,68,0.9)"; g.font = "10px Oswald, monospace"; g.textAlign = "center";
        g.fillText("NO ELECTROMAGNETIC EMISSION", W / 2, padT + plotH / 2 - 5);
        g.fillText("DETECTED", W / 2, padT + plotH / 2 + 7);
      }
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [obj.id, profile, lines, tunedBand]);

  const nonEM = ["Gravimetric", "Subspace"].map((name) => ({
    name,
    amplitude: profile.bands.find((b) => b.name === name)?.amplitude ?? 0
  }));

  // Strongest four only — the inset plots every line; these just name the
  // headline ones, and a second chip row costs more height than the column has.
  const named = [...lines].sort((a, b) => b.strength - a.strength).slice(0, 4);

  return (
    <div className="em-panel">
      <div className="scope-label">
        <span>EM SPECTRUM · λ</span>
        <span className={tunedBand ? "em-tuned-flag" : ""}>
          {tunedBand ? `TUNED · ${tunedBand.toUpperCase()}` : "UNTUNED"}
        </span>
      </div>
      <canvas ref={canvasRef} width={W * SCALE} height={H * SCALE} className="em-canvas" />
      {named.length > 0 && (
        <div className="em-lines" style={{ opacity: !tunedBand || tunedBand === "Elements" ? 1 : DIM_ALPHA }}>
          {named.map((line) => (
            <span key={line.el + line.nm} className="em-line-chip">
              {line.el} <em>{line.nm.toFixed(1)}</em>
            </span>
          ))}
        </div>
      )}
      <div className="em-nonem-label">NON-ELECTROMAGNETIC</div>
      {nonEM.map((b) => (
        <div
          key={b.name}
          className="em-gauge"
          style={{ opacity: !tunedBand || tunedBand === b.name ? 1 : DIM_ALPHA }}
        >
          <span className="em-gauge-name">{b.name.slice(0, 4).toUpperCase()}</span>
          <span className="em-gauge-track">
            <span
              className={`em-gauge-fill ${b.name === "Subspace" && b.amplitude > 0.5 ? "hot" : ""}`}
              style={{ width: `${Math.round(b.amplitude * 100)}%` }}
            />
          </span>
          <span className="em-gauge-value">{Math.round(b.amplitude * 100)}%</span>
        </div>
      ))}
    </div>
  );
}
