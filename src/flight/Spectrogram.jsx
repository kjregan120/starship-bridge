// Spectrogram.jsx — a scrolling time/frequency waterfall: one new column of
// colored pixels drawn at the right edge every frame (low freq at the
// bottom), with the whole image shifted one pixel left first via a
// self-blit — the standard cheap trick for a live waterfall. Same shared
// analyser as SignalScope/LoudnessHistory (see audio.js), so it shows
// whatever's actually playing — flat and dark when nothing is.
import { useEffect, useRef } from "react";
import { getAnalyser } from "./audio.js";

function heatColor(v) {
  // dark navy -> magenta -> amber, three-stop lerp
  const stops = [[6, 8, 24], [150, 40, 140], [255, 190, 90]];
  const seg = v < 0.5 ? 0 : 1;
  const t = v < 0.5 ? v * 2 : (v - 0.5) * 2;
  const a = stops[seg], b = stops[seg + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const gg = Math.round(a[1] + (b[1] - a[1]) * t);
  const bb = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${gg},${bb})`;
}

export default function Spectrogram() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas.getContext("2d");
    const analyser = getAnalyser();
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const usableBins = Math.floor(freqData.length * 0.25); // everything here lives well under a few kHz
    g.fillStyle = "rgb(6,8,24)";
    g.fillRect(0, 0, canvas.width, canvas.height);
    let raf;

    function draw() {
      raf = requestAnimationFrame(draw);
      const w = canvas.width, h = canvas.height;
      analyser.getByteFrequencyData(freqData);
      g.drawImage(canvas, -1, 0);
      g.clearRect(w - 1, 0, 1, h);
      for (let y = 0; y < h; y++) {
        const bin = Math.floor((1 - y / h) * usableBins);
        const v = freqData[bin] / 255;
        g.fillStyle = heatColor(v);
        g.fillRect(w - 1, y, 1, 1);
      }
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} width={200} height={90} className="spectrogram-canvas" />;
}
