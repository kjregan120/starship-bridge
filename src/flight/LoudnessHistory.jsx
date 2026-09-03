// LoudnessHistory.jsx — a scrolling strip of the signal's overall level over
// the last ~20s, same self-blit scroll trick as Spectrogram. This is the
// visual counterpart to signals.js's "regularity = artificial" tell: a
// natural source's level jitters, a beacon's steady ping holds a flat,
// repeating shape.
import { useEffect, useRef } from "react";
import { getAnalyser } from "./audio.js";

export default function LoudnessHistory() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas.getContext("2d");
    const analyser = getAnalyser();
    const timeData = new Uint8Array(analyser.fftSize);
    g.fillStyle = "#05070c";
    g.fillRect(0, 0, canvas.width, canvas.height);
    let raf, frame = 0;

    function draw() {
      raf = requestAnimationFrame(draw);
      if (++frame % 2 !== 0) return; // slow the scroll rate a bit vs 60fps
      const w = canvas.width, h = canvas.height;
      analyser.getByteTimeDomainData(timeData);
      let sum = 0;
      for (let i = 0; i < timeData.length; i++) { const v = timeData[i] / 128 - 1; sum += v * v; }
      const rms = Math.sqrt(sum / timeData.length); // ~0..1
      g.drawImage(canvas, -1, 0);
      g.fillStyle = "#05070c";
      g.fillRect(w - 1, 0, 1, h);
      const barH = Math.min(h - 2, rms * h * 3.4);
      g.fillStyle = "#6bffc4";
      g.fillRect(w - 1, h - barH, 1, barH);
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} width={200} height={90} className="loudness-history-canvas" />;
}
