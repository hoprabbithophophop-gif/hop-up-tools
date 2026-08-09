import { useEffect, useRef, useState } from "react";

/**
 * 書き込みの直前に一度だけ出す人間確認。
 *
 * 問い合わせフォームで使っているものと同じ仕組み・同じ鍵。
 * ここを通ると、その端末はしばらく書き込める状態になるので、二度目からは出ない。
 *
 * ※ 画面に出す文言はすべて仮置き。あとで差し替える前提。
 */

const TURNSTILE_SITE_KEY = "0x4AAAAAADzKF09DPiNfSXSR";
const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
  if (existing) return new Promise((res) => existing.addEventListener("load", () => res()));
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = TURNSTILE_SRC;
    s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("turnstile load failed"));
    document.head.appendChild(s);
  });
}

type Props = {
  /** 合図が取れたら呼ぶ。やめたときは null */
  onDone: (token: string | null) => void;
};

export default function HumanCheckGate({ onDone }: Props) {
  const widgetRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let widgetId: string | null = null;
    let alive = true;
    loadTurnstile()
      .then(() => {
        if (!alive || !widgetRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(widgetRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (t: string) => onDone(t),
          "expired-callback": () => setError("時間が経ちました。もう一度お試しください。"),
          "error-callback": (code: string) =>
            setError(`人間確認を出せませんでした（${code}）。通信環境を確認してもう一度お試しください。`),
        });
      })
      .catch(() => setError("人間確認を読み込めませんでした。"));
    return () => {
      alive = false;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={S.back} onClick={() => onDone(null)}>
      <div style={S.card} onClick={(e) => e.stopPropagation()}>
        <div style={S.title}>はじめての投稿の前に</div>
        <p style={S.lede}>
          自動の書き込みを防ぐための確認です。名前やメールアドレスは要りません。
          一度通れば、次からは出ません。
        </p>
        <div ref={widgetRef} style={{ minHeight: 70 }} />
        {error && <p style={S.err}>{error}</p>}
        <button onClick={() => onDone(null)} style={S.cancel}>やめる</button>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  back: {
    position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.55)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
  },
  card: { background: "#fff", color: "#000", padding: "22px 20px", maxWidth: 380, width: "100%" },
  title: { fontSize: 15, fontWeight: 900, marginBottom: 8 },
  lede: { fontSize: 12.5, lineHeight: 1.8, color: "#585f6c", margin: "0 0 14px" },
  err: { fontSize: 12, lineHeight: 1.7, color: "#000", background: "#f8f9fa", padding: "8px 10px", margin: "12px 0 0" },
  cancel: {
    font: "inherit", fontSize: 12.5, fontWeight: 700, marginTop: 16,
    padding: "10px 14px", background: "#fff", color: "#585f6c", border: 0, cursor: "pointer",
  },
};
