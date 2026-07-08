import { useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { VideoLink } from "@/data/the-ballad";
import { SHOW_BY_NO } from "@/data/the-ballad";
import { C } from "../ui";

// 不具合報告フォーム。今見ている動画の情報を自動で載せ、症状を選んで匿名で送る。
// 乱打を避けるため、症状の選択を必須にし、送信後は入力欄を畳む。
// inline=true: 親（動画の下）にそのまま展開する（動画に被らない）。false: 下部シート。
const ISSUES = [
  { key: "before_prev", label: "始まる前に前の曲が入る" },
  { key: "after_next", label: "終わりに次の曲が入る" },
  { key: "wrong", label: "全く別の曲が始まる" },
  { key: "audio_stop", label: "音だけ止まる（映像は続く）" },
  { key: "other", label: "その他" },
];

const dim: React.CSSProperties = { fontSize: "0.625rem", color: "rgba(255,255,255,0.5)", letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 };
const btn: React.CSSProperties = { padding: "0.65rem", border: "none", fontSize: "0.8rem", fontWeight: 700 };

export default function ReportForm({ video, onClose, inline = false }: { video: VideoLink; onClose: () => void; inline?: boolean }) {
  const [issue, setIssue] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const date = SHOW_BY_NO.get(video.showNo)?.date ?? video.startLabel;

  const submit = async () => {
    if (!issue || sending) return;
    setSending(true);
    setFailed(false);
    try {
      // getSupabase() は URL 未設定(ローカルで .env.local 無い等)だと同期で throw する。await 前でも捕まえる。
      const { error } = await getSupabase().from("ballad_reports").insert({
        member: video.member,
        song: video.songCore,
        video_id: video.videoId,
        start_sec: video.startSec,
        show_date: date,
        issue_type: issue,
        note: note.trim() || null,
        ua: typeof navigator !== "undefined" ? navigator.userAgent : null,
      });
      if (error) throw error;
      setSent(true);
    } catch {
      setFailed(true); // 失敗をユーザーに見せる(送信中のまま固めない)
    }
    setSending(false);
  };

  const body = sent ? (
    <>
      <p style={{ color: "#fff", fontSize: "0.9rem", fontWeight: 700, margin: 0 }}>ありがとうございました</p>
      <p style={{ color: C.meta, fontSize: "0.75rem", margin: 0 }}>いただいた内容は再生位置の見直しに使わせてもらいます。</p>
      <button onClick={onClose} style={{ ...btn, background: "#fff", color: "#000", cursor: "pointer" }}>閉じる</button>
    </>
  ) : (
    <>
      <div>
        <p style={dim}>報告する動画</p>
        <p style={{ color: "#fff", fontSize: "0.85rem", fontWeight: 700, margin: "0.2rem 0 0" }}>{video.member}「{video.songCore}」</p>
        <p style={{ color: C.meta, fontSize: "0.7rem", margin: "0.1rem 0 0" }}>{date}</p>
      </div>
      <div>
        <p style={{ ...dim, marginBottom: "0.5rem" }}>どんな様子でしたか？</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {ISSUES.map((it) => (
            <button
              key={it.key}
              onClick={() => setIssue(it.key)}
              style={{ textAlign: "left", padding: "0.65rem 0.85rem", border: "none", cursor: "pointer", background: issue === it.key ? "#fff" : "#1a1a1a", color: issue === it.key ? "#000" : "#ddd", fontSize: "0.8rem" }}
            >
              {it.label}
            </button>
          ))}
        </div>
      </div>
      {issue === "other" && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="どんな様子か教えてください"
          rows={4}
          maxLength={300}
          style={{ width: "100%", boxSizing: "border-box", background: "#1a1a1a", color: "#fff", border: "none", padding: "0.6rem", fontSize: "0.8rem", minHeight: "4.5rem", resize: "vertical", fontFamily: "inherit" }}
        />
      )}
      <button
        onClick={submit}
        disabled={!issue || sending}
        style={{ ...btn, background: issue ? "#fff" : "#2a2a2a", color: issue ? "#000" : "#666", cursor: issue && !sending ? "pointer" : "default" }}
      >
        {sending ? "送信中…" : "送信する"}
      </button>
      {failed && <p style={{ color: "#f88", fontSize: "0.7rem", margin: 0, textAlign: "center" }}>送信できませんでした。通信環境を確認してもう一度お試しください。</p>}
      <p style={{ color: C.meta, fontSize: "0.65rem", margin: 0, textAlign: "center" }}>お名前や連絡先は送信されません。</p>
    </>
  );

  // インライン: 動画の下にそのまま展開（fixed オーバーレイにしない＝動画に被らない）
  if (inline) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", padding: "0.9rem 0 0", borderTop: "1px solid #333" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p style={dim}>不具合を報告</p>
          <button onClick={onClose} aria-label="閉じる" style={{ background: "transparent", border: "none", color: "#aaa", fontSize: "0.75rem", cursor: "pointer", padding: "0.2rem 0.3rem" }}>✕ 閉じる</button>
        </div>
        {body}
      </div>
    );
  }

  // 下部シート（聴き比べ側で使用）
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1100 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, background: "#000", padding: "1.2rem 1.3rem calc(1.2rem + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: "0.9rem", maxHeight: "60vh", overflowY: "auto", borderTop: "1px solid #333" }}>
        {body}
      </div>
    </div>
  );
}
