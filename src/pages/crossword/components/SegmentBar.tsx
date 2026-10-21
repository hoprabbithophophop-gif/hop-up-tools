// 解く画面の上の進み具合の帯（Hop が見本で選んだ案 B「マスの数で区切った帯」2026-10-21）。
// 数えるのは埋まったマスの数だけ（合っているかは数えない）。埋まった区切りは左から 180ms で満ちる。
// 区切りが細くなりすぎる大きい問題では、区切りの間を 2px → 1px に詰め、それでも細い時は区切らない帯にする【仮】
import React, { useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../../../lib/crossword/motion";
import { C } from "../style";

const FILL_MS = 180;
const FILL_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
// 区切り1つの幅の下限（px）。間 2px で MIN_WIDE 以上なら 2px、間 1px で MIN_NARROW 以上なら 1px、それより細ければ区切らない【仮】
const MIN_WIDE = 4;
const MIN_NARROW = 3;

export const SegmentBar: React.FC<{ filled: number; total: number }> = ({ filled, total }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const prevRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const segWidth = (gap: number) => (total > 0 ? (width - (total - 1) * gap) / total : 0);
  const gap = width === 0 ? 2 : segWidth(2) >= MIN_WIDE ? 2 : segWidth(1) >= MIN_NARROW ? 1 : null;
  const n = Math.max(0, Math.min(filled, total));

  // 増えた所だけ満ちる（最初の1回・減った時・動きを減らす設定では動かさない）
  useLayoutEffect(() => {
    const prev = prevRef.current;
    prevRef.current = n;
    const box = boxRef.current;
    if (prev === null || n <= prev || !box || prefersReducedMotion()) return;
    if (gap === null) {
      const fill = box.querySelector<HTMLElement>("[data-progress-fill]");
      fill?.animate([{ width: `${(prev / total) * 100}%` }, { width: `${(n / total) * 100}%` }], { duration: FILL_MS, easing: FILL_EASE });
      return;
    }
    const fills = box.querySelectorAll<HTMLElement>("[data-progress-fill]");
    for (let i = prev; i < n; i++) fills[i]?.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: FILL_MS, easing: FILL_EASE });
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={boxRef}
      data-progress-bar={gap === null ? "plain" : `gap-${gap}`}
      data-progress-filled={n}
      className="h-1 flex"
      style={{ gap: gap ?? 0, background: gap === null ? C.high : undefined }}
    >
      {gap === null ? (
        <div data-progress-fill="" className="h-full" style={{ width: total > 0 ? `${(n / total) * 100}%` : 0, background: C.black }} />
      ) : (
        Array.from({ length: total }, (_, i) => (
          <div key={i} data-progress-seg="" className="h-full relative" style={{ flex: "1 1 0", minWidth: 0, background: C.high }}>
            {i < n && <div data-progress-fill="" className="absolute inset-0" style={{ background: C.black, transformOrigin: "left center" }} />}
          </div>
        ))
      )}
    </div>
  );
};
