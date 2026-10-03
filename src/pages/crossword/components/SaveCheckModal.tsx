import { useEffect, useRef, useState } from "react";
import { loadTurnstile, TURNSTILE_SITE_KEY } from "../../../lib/crossword/turnstile";

// 保存の直前に Turnstile を通す小窓。見た目は src/components/ContactModal.tsx に合わせる。
// 確かめが済んだら onPass を1回だけ呼ぶ（保存はそのまま続けて行う）。
export function SaveCheckModal({ onPass, onClose }: { onPass: (token: string, website: string) => void; onClose: () => void }) {
  const widgetRef = useRef<HTMLDivElement>(null);
  const websiteRef = useRef<HTMLInputElement>(null); // ハニーポット。人間は触らない。
  const passedRef = useRef(false);
  const onPassRef = useRef(onPass);
  onPassRef.current = onPass;
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let widgetId: string | null = null;
    let alive = true;
    loadTurnstile()
      .then(() => {
        if (!alive || !widgetRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(widgetRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (t: string) => {
            if (passedRef.current || !t) return;
            passedRef.current = true;
            onPassRef.current(t, websiteRef.current?.value ?? "");
          },
        });
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, []);

  // 開いている間は背面をスクロールさせない。Escで閉じる。
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="保存の前の確認"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1200,
        display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto",
          background: "#fff", color: "#191c1d", padding: "1.6rem",
          display: "flex", flexDirection: "column", gap: "1.2rem",
          fontFamily: "Inter, 'Noto Sans JP', sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <p style={{ fontSize: "1.125rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>保存の前の確認</p>
          <button onClick={onClose} aria-label="閉じる" style={{ background: "transparent", border: "none", color: "#777", fontSize: "0.75rem", cursor: "pointer", padding: "0.2rem 0.3rem" }}>
            ✕ 閉じる
          </button>
        </div>

        {/* ハニーポット。目に見えず、支援技術からも読み上げない。 */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
          <input ref={websiteRef} tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>

        <div ref={widgetRef} />

        {loadFailed && (
          <p style={{ fontSize: "0.75rem", color: "#c0392b", margin: 0, lineHeight: 1.6 }}>
            確認を読み込めませんでした。ページを再読み込みしてお試しください。
          </p>
        )}
      </div>
    </div>
  );
}
