import { useEffect, useState } from "react";

// 開閉を高さ（grid-template-rows 0fr↔1fr）で滑らかに伸縮させるアコーディオン。
// 開いている間だけ中身をマウントし（同時に開くのは1つの前提で軽量）、閉じるアニメーション完了後にアンマウントする。
export function Accordion({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [render, setRender] = useState(open);
  const [expanded, setExpanded] = useState(open);

  useEffect(() => {
    if (open) {
      setRender(true);
      // マウント直後の 0fr を一度描画してから 1fr にして伸びるアニメを効かせる（二重 rAF）。
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
      return () => cancelAnimationFrame(id);
    }
    setExpanded(false);
  }, [open]);

  if (!render) return null;

  return (
    <div
      className="acc-grid"
      style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      onTransitionEnd={(e) => {
        if (e.propertyName === "grid-template-rows" && !open) setRender(false);
      }}
    >
      <div style={{ overflow: "hidden", minHeight: 0 }}>{children}</div>
    </div>
  );
}
