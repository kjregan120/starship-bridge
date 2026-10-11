// ViewscreenFX.jsx — what danger looks like on the main viewer, layered over
// the 3D scene as plain HTML (no extra WebGL work):
//   - a red pulse around the edges at red alert
//   - glare that washes the view out as stellar heat climbs
//   - static and flicker as the sensors degrade
// Shake on hits and the emergency-lighting dim are on the whole bridge
// (FlightApp.jsx / flight.css), not just this screen.
import { useMemo } from "react";
import { useUI } from "./store.js";

// One tile of noise, made once, scrolled around by CSS for the static.
function noiseTile() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

export default function ViewscreenFX() {
  const ship = useUI((s) => s.ship);
  const level = useUI((s) => s.alert.level);
  const tile = useMemo(noiseTile, []);
  if (!ship) return null;

  const glare = Math.min(0.85, Math.max(0, (ship.flux.heat - 1.5) / 25));
  // Static: from sensor damage, power starvation and noise together.
  const sensorLoss = 1 - ship.sensorQuality;
  const staticAmt = Math.max(0, sensorLoss - 0.15) * 0.45;
  const flicker = ship.health.sensors < 0.4 || ship.reactor.scrammed;

  return (
    <div className="vfx" aria-hidden="true">
      {glare > 0.01 && <div className="vfx-glare" style={{ opacity: glare }} />}
      {staticAmt > 0.01 && (
        <div className="vfx-static" style={{ opacity: staticAmt, backgroundImage: `url(${tile})` }} />
      )}
      {flicker && <div className="vfx-flicker" />}
      {level === "red" && <div className="vfx-red" />}
    </div>
  );
}
