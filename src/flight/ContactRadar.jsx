// ContactRadar.jsx — a live radar/polar scope: every contact within RANGE,
// plotted by bearing and distance around the ship at the center, with a
// rotating sweep wedge for that "active sensor" feel. Bearing here uses the
// same atan2(dz, dx) convention as the sweep command and the nav panel, just
// reinterpreted as a compass angle (0=up, clockwise) for the plot — stylized
// like everything else in signals.js, not literally correct as physical
// bearing-from-north, but consistent with what the player already reads
// elsewhere on screen.
//
// This was called SoundField until the 3D wavefront display took that name.
// It never plotted sound - it plots contacts - so the rename is the fix, not
// the regression; WaveField.jsx is the panel that shows what a signal
// actually sounds like.
import { useEffect, useRef } from "react";
import { nearbyObjects } from "./engine.js";

const RANGE = 400;
const TYPE_STYLE = {
  star: { r: 3.5, color: "#ffe6a8" },
  planet: { r: 2, color: "#7fd0a0" },
  moon: { r: 1.3, color: "#8fa0c0" },
  blackhole: { r: 3.5, color: "#ff6a3d" },
  pulsar: { r: 3, color: "#cfe8ff" },
  nebula: { r: 3, color: "#cc88ff" },
  beacon: { r: 3, color: "#ffcc55" }
};

export default function ContactRadar() {
  const canvasRef = useRef(null);
  const contactsRef = useRef([]);

  useEffect(() => {
    const poll = () => { contactsRef.current = nearbyObjects(RANGE); };
    poll();
    const iv = setInterval(poll, 500);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas.getContext("2d");
    let raf;

    function draw(t) {
      raf = requestAnimationFrame(draw);
      const w = canvas.width, h = canvas.height;
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 6;
      g.clearRect(0, 0, w, h);

      g.strokeStyle = "rgba(140,190,255,0.15)"; g.lineWidth = 1;
      for (let i = 1; i <= 3; i++) { g.beginPath(); g.arc(cx, cy, (R * i) / 3, 0, Math.PI * 2); g.stroke(); }
      for (let a = 0; a < 360; a += 30) {
        const rad = (a * Math.PI) / 180;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(rad) * R, cy - Math.cos(rad) * R); g.stroke();
      }

      // rotating sweep wedge
      const sweep = ((t / 1000) * 0.7) % (Math.PI * 2);
      g.save();
      g.beginPath(); g.moveTo(cx, cy);
      g.arc(cx, cy, R, sweep - 0.55, sweep, false);
      g.closePath();
      g.fillStyle = "rgba(107,255,196,0.14)";
      g.fill();
      g.restore();
      g.beginPath(); g.moveTo(cx, cy);
      g.lineTo(cx + Math.sin(sweep) * R, cy - Math.cos(sweep) * R);
      g.strokeStyle = "rgba(107,255,196,0.75)"; g.lineWidth = 1.3;
      g.stroke();

      // contacts
      const contacts = contactsRef.current;
      contacts.forEach(({ o, dx, dz, d }, i) => {
        const bearing = ((Math.atan2(dz, dx) * 180) / Math.PI + 360) % 360;
        const rad = (bearing * Math.PI) / 180;
        const rr = (Math.min(d, RANGE) / RANGE) * R;
        const x = cx + Math.sin(rad) * rr, y = cy - Math.cos(rad) * rr;
        const style = TYPE_STYLE[o.type] || TYPE_STYLE.moon;
        let radius = style.r, color = style.color, glow = 0;
        if (o.type === "beacon") {
          const pulse = 0.5 + 0.5 * Math.sin(t / 260 + i);
          radius = style.r * (0.8 + pulse * 0.6);
          glow = 6 + pulse * 4;
        }
        if (i === 0) { // nearest / currently-monitored contact
          g.strokeStyle = "rgba(255,255,255,0.6)"; g.lineWidth = 1;
          g.beginPath(); g.arc(x, y, radius + 3, 0, Math.PI * 2); g.stroke();
        }
        if (glow) { g.shadowColor = color; g.shadowBlur = glow; }
        g.fillStyle = color;
        g.beginPath(); g.arc(x, y, radius, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
      });

      // ship at center
      g.fillStyle = "#cfe0ff";
      g.beginPath(); g.arc(cx, cy, 2.5, 0, Math.PI * 2); g.fill();
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} width={200} height={200} className="contact-radar-canvas" />;
}
