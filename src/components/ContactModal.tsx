import { useEffect, useRef, useState } from "react";

// トップの問い合わせフォーム。送信は /api/contact（Cloudflare Pages Function）が受け、
// そこで人間確認・連投チェック・無害化・保存・通知をまとめて行う。
// このフォームからデータベースへ直接書き込むことはしない。

const TURNSTILE_SITE_KEY = "0x4AAAAAADzKF09DPiNfSXSR";
const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const X_URL = "https://x.com/hop_rabbit_hop";

const MAX_CONTENT = 1000;
const MAX_REPLY_TO = 200;

const KINDS = [
  { key: "bug", label: "バグ" },
  { key: "request", label: "要望" },
  { key: "question", label: "質問" },
];

const TOOLS = [
  { key: "", label: "選択しない" },
  { key: "fc-ticket", label: "FC 締切リマインダー" },
  { key: "youtube", label: "HELLO! VIDEO" },
  { key: "the-ballad", label: "The Balladデータベース" },
  { key: "hi-tension", label: "ハイ！テンション" },
  { key: "arigato-beat", label: "ありがとビート" },
  { key: "site", label: "サイト全体" },
];

// 送信できなかった理由ごとの案内。理由が分からない時は最後の文言に寄せる。
const FAIL_MESSAGE: Record<string, string> = {
  too_many: "送信が集中しています。時間をおいてもう一度お試しください。",
  verification: "確認に失敗しました。ページを再読み込みしてお試しください。",
  bad_request: "内容をご確認のうえ、もう一度お試しください。",
};
const FAIL_FALLBACK = "送信できませんでした。通信環境を確認してもう一度お試しください。";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

/** Turnstile のスクリプトは一度だけ読み込む。 */
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

const label: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "#777",
  margin: "0 0 0.5rem",
};
const field: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "#f8f9fa",
  color: "#191c1d",
  border: "none",
  borderRadius: 0,
  padding: "0.7rem",
  fontSize: "0.875rem",
  fontFamily: "inherit",
};

export default function ContactModal({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState("");
  const [tool, setTool] = useState("");
  const [content, setContent] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [website, setWebsite] = useState(""); // ハニーポット。人間は触らない。
  const [token, setToken] = useState("");

  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widgetId: string | null = null;
    let alive = true;
    loadTurnstile()
      .then(() => {
        if (!alive || !widgetRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(widgetRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (t: string) => setToken(t),
          "expired-callback": () => setToken(""),
          "error-callback": () => setToken(""),
        });
      })
      .catch(() => setToken(""));
    return () => {
      alive = false;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, []);

  // 開いている間は背面をスクロールさせない。Escで閉じる。
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const ready = kind !== "" && content.trim() !== "" && token !== "" && !sending;

  const submit = async () => {
    if (!ready) return;
    setSending(true);
    setFailure(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, tool, content, replyTo, website, token }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      if (res.ok && data.ok) setSent(true);
      else setFailure(data.reason ?? "server");
    } catch {
      setFailure("server");
    }
    setSending(false);
  };

  const body = sent ? (
    <>
      <p style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>送信しました</p>
      <p style={{ fontSize: "0.8125rem", color: "#585f6c", margin: 0, lineHeight: 1.6 }}>
        ありがとうございました。返信先をご記入いただいた場合のみ、返信することがあります。
      </p>
      <button onClick={onClose} style={{ ...field, background: "#191c1d", color: "#fff", fontWeight: 700, cursor: "pointer", padding: "0.8rem" }}>
        閉じる
      </button>
    </>
  ) : (
    <>
      <div>
        <p style={label}>種類</p>
        <div style={{ display: "flex", gap: 2 }}>
          {KINDS.map((k) => (
            <button
              key={k.key}
              onClick={() => setKind(k.key)}
              style={{
                flex: 1, padding: "0.7rem", border: "none", borderRadius: 0, cursor: "pointer",
                fontSize: "0.8125rem", fontWeight: 700, fontFamily: "inherit",
                background: kind === k.key ? "#191c1d" : "#f8f9fa",
                color: kind === k.key ? "#fff" : "#585f6c",
              }}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p style={label}>対象ツール</p>
        <select value={tool} onChange={(e) => setTool(e.target.value)} style={{ ...field, cursor: "pointer" }}>
          {TOOLS.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </div>

      <div>
        <p style={label}>内容</p>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          maxLength={MAX_CONTENT}
          style={{ ...field, minHeight: "7rem", resize: "vertical" }}
        />
        <p style={{ fontSize: "0.6875rem", color: "#777", margin: "0.3rem 0 0", textAlign: "right" }}>
          {content.length} / {MAX_CONTENT}
        </p>
      </div>

      <div>
        <p style={label}>返信先（任意）</p>
        <input
          value={replyTo}
          onChange={(e) => setReplyTo(e.target.value)}
          maxLength={MAX_REPLY_TO}
          style={field}
        />
        <p style={{ fontSize: "0.6875rem", color: "#777", margin: "0.3rem 0 0", lineHeight: 1.6 }}>
          返信にのみ使用し、サーバーには保存しません。
        </p>
      </div>

      {/* ハニーポット。目に見えず、支援技術からも読み上げない。 */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
        <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      <div ref={widgetRef} />

      <button
        onClick={submit}
        disabled={!ready}
        style={{
          ...field, padding: "0.9rem", fontWeight: 700, cursor: ready ? "pointer" : "default",
          background: ready ? "#191c1d" : "#e6e8ea",
          color: ready ? "#fff" : "#9aa0a6",
        }}
      >
        {sending ? "送信中…" : "送信する"}
      </button>

      {failure && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <p style={{ fontSize: "0.75rem", color: "#c0392b", margin: 0, lineHeight: 1.6 }}>
            {FAIL_MESSAGE[failure] ?? FAIL_FALLBACK}
          </p>
          <a href={X_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.75rem", color: "#777" }}>
            X（旧Twitter）から送る
          </a>
        </div>
      )}
    </>
  );

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="お問い合わせ"
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
          <p style={{ fontSize: "1.125rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>お問い合わせ</p>
          <button onClick={onClose} aria-label="閉じる" style={{ background: "transparent", border: "none", color: "#777", fontSize: "0.75rem", cursor: "pointer", padding: "0.2rem 0.3rem" }}>
            ✕ 閉じる
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}
