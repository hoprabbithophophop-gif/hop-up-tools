// HarmonyPalette の PuzzleGrid の minimal 表示（作る画面の背景で組み立ての試行を流す所）だけの移植。
// 各マスは framer-motion の initial {scale:0, opacity:0} → animate {scale:1, opacity:1} と
// layoutId（場所が動いたマスは 0.45秒・ease [0.4,0,0.1,1] で滑る）を、同じ値で再現する
import React, { useLayoutEffect, useRef } from "react";
import type { PuzzleData } from "../../../lib/crossword/types";
import { animateElement, buildTrack, prefersReducedMotion } from "../../../lib/crossword/motion";
import { C } from "../style";

const LAYOUT_MS = 450;
const LAYOUT_EASE: [number, number, number, number] = [0.4, 0, 0.1, 1];

export const PuzzleGridMinimal: React.FC<{ data: PuzzleData }> = ({ data }) => {
  const cellSize = 50;
  const gap = 4;
  const containerWidth = data.width * (cellSize + gap) + gap;
  const containerHeight = data.height * (cellSize + gap) + gap;
  const boxRef = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  // マスごとの「動きを除いた」画面上の中心と、走っている滑りの動き
  const layout = useRef(new Map<string, { cx: number; cy: number }>());
  const slides = useRef(new Map<string, Animation>());
  const mounted = useRef(new Set<string>());

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const boxRect = box.getBoundingClientRect();
    const k = box.offsetWidth ? boxRect.width / box.offsetWidth : 1; // 親の scale-125 の分
    const reduce = prefersReducedMotion();
    const alive = new Set<string>();
    els.current.forEach((el, key) => {
      alive.add(key);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const tr = cs.translate && cs.translate !== "none" ? cs.translate.split(" ").map((v) => parseFloat(v) || 0) : [0, 0];
      const tx = tr[0] ?? 0, ty = tr[1] ?? 0;
      const cx = r.left + r.width / 2 - tx * k;
      const cy = r.top + r.height / 2 - ty * k;

      if (!mounted.current.has(key)) {
        // 新しく出たマス: framer の既定（scale はばね 550/30、opacity は 0.3秒）
        mounted.current.add(key);
        animateElement(el, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1 });
      } else {
        const prev = layout.current.get(key);
        if (prev && !reduce && (Math.abs(prev.cx - cx) > 0.5 || Math.abs(prev.cy - cy) > 0.5)) {
          // 今見えている位置から新しい位置へ滑らせる
          const sx = (prev.cx - cx) / k + tx;
          const sy = (prev.cy - cy) / k + ty;
          slides.current.get(key)?.cancel();
          const tX = buildTrack("x", [sx, 0], { duration: LAYOUT_MS / 1000, ease: LAYOUT_EASE });
          const tY = buildTrack("y", [sy, 0], { duration: LAYOUT_MS / 1000, ease: LAYOUT_EASE });
          const kfs: Keyframe[] = [];
          for (let ms = 0; ms <= LAYOUT_MS; ms += 10) {
            kfs.push({ offset: ms / LAYOUT_MS, translate: `${tX.sample(ms)}px ${tY.sample(ms)}px` } as Keyframe);
          }
          const a = el.animate(kfs, { duration: LAYOUT_MS, easing: "linear" });
          slides.current.set(key, a);
          a.finished.then(() => slides.current.delete(key), () => {});
        }
      }
      layout.current.set(key, { cx, cy });
    });
    // 消えたマスの記録を外す
    [...layout.current.keys()].forEach((key) => {
      if (!alive.has(key)) {
        layout.current.delete(key);
        mounted.current.delete(key);
        slides.current.delete(key);
      }
    });
  });

  if (!data.cells || data.cells.length === 0) {
    return (
      <div className="flex items-center justify-center p-12 bg-surface-container-low text-on-surface">
        パズルデータがありません
      </div>
    );
  }

  return (
    <div className="relative mx-auto">
      <div className="relative">
        <div ref={boxRef} className="relative" style={{ width: containerWidth, height: containerHeight }}>
          {data.cells.map((cell) => {
            const cellKey = `${cell.x},${cell.y}`;
            return (
              <div
                key={cellKey}
                ref={(el) => {
                  if (el) els.current.set(cellKey, el);
                  else els.current.delete(cellKey);
                }}
                className="absolute"
                style={{
                  width: cellSize,
                  height: cellSize,
                  left: cell.x * (cellSize + gap),
                  top: cell.y * (cellSize + gap),
                  scale: "0",
                  opacity: 0,
                }}
              >
                <input
                  type="text"
                  value={cell.value}
                  readOnly
                  tabIndex={-1}
                  className="w-full h-full text-center font-bold uppercase cursor-default focus:outline-none"
                  style={{ fontSize: "1.2rem", background: C.high, color: C.ink }}
                  maxLength={1}
                  autoComplete="off"
                />
                {cell.clueNumber && (
                  <div className="absolute top-0 left-1 text-[10px] font-bold z-10 pointer-events-none" style={{ color: C.secondary }}>
                    {cell.clueNumber}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
