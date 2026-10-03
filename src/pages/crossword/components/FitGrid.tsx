// 盤が置き場の幅より大きいときは、幅に収まる大きさまで縮めて置く（Hop 依頼 2026-10-03「パズルが画面外に出てるのをやめて」）。
// userScale は拡大・縮小のボタンの倍率で、幅に合わせた大きさを 1 としてかける。
// 縮めた分だけ外枠の大きさも小さくするので、まわりの並びが崩れない。
import React, { useEffect, useRef, useState } from "react";

const CELL = 48; // PuzzleGridRetro の 1 マス

export const FitGrid: React.FC<{ width: number; height: number; userScale?: number; children: React.ReactNode }> = ({
  width,
  height,
  userScale = 1,
  children,
}) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState<number | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setAvail(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = width * CELL;
  const h = height * CELL;
  const fit = avail ? Math.min(1, avail / w) : 1;
  const s = fit * userScale;

  return (
    <div ref={boxRef} className="w-full flex justify-center">
      <div style={{ width: w * s, height: h * s, position: "relative", transition: "width 0.2s ease-out, height 0.2s ease-out" }}>
        <div style={{ position: "absolute", left: 0, top: 0, transform: `scale(${s})`, transformOrigin: "top left", transition: "transform 0.2s ease-out" }}>
          {children}
        </div>
      </div>
    </div>
  );
};
