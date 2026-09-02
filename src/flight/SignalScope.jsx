// SignalScope.jsx — a live oscilloscope (top) + spectrum analyzer (bottom)
// for whatever's currently playing through commsAudio.js — or a flatline
// when nothing is. Reads audio.js's shared AnalyserNode straight into a
// canvas every animation frame; deliberately bypasses React state so it's
// smooth at 60fps without triggering component re-renders.
import { useEffect, useRef } from "react";
import { getAnalyser } from "./audio.js";

export default function SignalScope() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas.getContext("2d");
    const analyser = getAnalyser();
    const timeData = new Uint8Array(analyser.fftSize);
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    let raf;

    function draw() {
      raf = requestAnimationFrame(draw);
      const w = canvas.width, h = canvas.height;
      const scopeH = h * 0.62;
      const specTop = scopeH + 10;
      const specH = h - specTop;

      g.clearRect(0, 0, w, h);

      // graticule
      g.strokeStyle = "rgba(140,190,255,0.12)"; g.lineWidth = 1;
      for (let x = 0; x <= w; x += w / 12) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, scopeH); g.stroke(); }
      for (let y = 0; y <= scopeH; y += scopeH / 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }

      // oscilloscope trace
      analyser.getByteTimeDomainData(timeData);
      g.strokeStyle = "#6bffc4"; g.lineWidth = 1.6;
      g.shadowColor = "#6bffc4"; g.shadowBlur = 5;
      g.beginPath();
      const step = w / timeData.length;
      for (let i = 0; i < timeData.length; i++) {
        const v = timeData[i] / 128 - 1; // -1..1
        const y = scopeH / 2 + v * (scopeH / 2 - 4);
        const x = i * step;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      g.shadowBlur = 0;

      // spectrum bars — only the low/mid bins, since every recipe here lives
      // well under a few kHz; the upper range would just be empty bars.
      analyser.getByteFrequencyData(freqData);
      const bars = 56;
      const usableBins = Math.floor(freqData.length * 0.25);
      const barW = w / bars;
      for (let i = 0; i < bars; i++) {
        const bin = Math.floor((i / bars) * usableBins);
        const v = freqData[bin] / 255;
        const barH = v * specH;
        g.fillStyle = `rgba(127, 215, 255, ${0.35 + v * 0.65})`;
        g.fillRect(i * barW + 1, h - barH, barW - 2, barH);
      }
    }
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} width={800} height={220} className="scope-canvas" />;
}
