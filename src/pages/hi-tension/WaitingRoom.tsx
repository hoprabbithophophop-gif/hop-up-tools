import { useRef, useState } from "react";
import LoadingDots from "./components/LoadingDots";
import HandIcon from "./components/HandIcon";
import { findMember } from "./data";
import type { Participant } from "./useHiTensionRealtime";

interface Props {
  participants: Participant[];
  mySessionId: string;
  isHost: boolean;
  connected: boolean;
  channelError: boolean;
  isOverflow: boolean;
  roomCode: string | null;
  onBounceSignal: () => void;
  bouncingSessionId: string | null;
  onSeno: () => void;
  onSolo: () => void;
  onReenterCode: () => void;
  onBackToTop: () => void;
}

const DOT_SIZE = 12;

export default function WaitingRoom({
  participants,
  mySessionId,
  isHost,
  connected,
  channelError,
  isOverflow,
  roomCode,
  onBounceSignal,
  bouncingSessionId,
  onSeno,
  onSolo,
  onReenterCode,
  onBackToTop,
}: Props) {
  const [selfBouncing, setSelfBouncing] = useState(false);
  const selfBounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHandTap = () => {
    onBounceSignal();
    setSelfBouncing(false);
    // 一度 false にしてから true にすることで再アニメーションを強制
    requestAnimationFrame(() => {
      setSelfBouncing(true);
      if (selfBounceTimerRef.current) clearTimeout(selfBounceTimerRef.current);
      selfBounceTimerRef.current = setTimeout(() => setSelfBouncing(false), 500);
    });
  };

  const count = participants.length;

  // あふれ（5人目以降）: 満員パネルを表示。スタートには参加できない。
  if (isOverflow) {
    return (
      <div
        style={{
          height: "100dvh",
          overflow: "hidden",
          background: "#f8f9fa",
          color: "#191c1d",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1.2rem",
          fontFamily: "Inter, 'Noto Sans JP', sans-serif",
          gap: "1.5rem",
          animation: "hi-tension-fade-in 180ms ease-out",
        }}
      >
        <p style={{ fontSize: "1.125rem", fontWeight: 700, margin: 0, color: "#000" }}>
          満員です（4人まで）
        </p>
        <p style={{ fontSize: "0.875rem", color: "#474747", margin: 0, textAlign: "center", lineHeight: 1.6 }}>
          いま4人が待ってます。
          <br />
          ひとりで始めるか、ロビーに戻ってね。
        </p>
        <button
          type="button"
          onClick={onSolo}
          style={{
            width: "100%",
            maxWidth: 360,
            padding: "1rem",
            background: "#000",
            color: "#fff",
            border: "none",
            fontSize: "0.875rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          ひとりで始める
        </button>
        <button
          type="button"
          onClick={onBackToTop}
          style={{
            background: "none",
            border: "none",
            fontSize: "0.8125rem",
            color: "#777",
            cursor: "pointer",
            padding: "0.25rem 0",
          }}
        >
          ← ロビーに戻る
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100dvh",
        overflow: "hidden",
        background: "#f8f9fa",
        color: "#191c1d",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1.2rem",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
        gap: "2rem",
        animation: "hi-tension-fade-in 180ms ease-out",
      }}
    >
      <style>{`
        @keyframes dot-bounce {
          0%   { transform: translateY(0) scale(1); }
          20%  { transform: translateY(-22px) scale(0.93); }
          48%  { transform: translateY(-22px) scale(0.93); }
          72%  { transform: translateY(0) scale(1.06); }
          88%  { transform: translateY(-7px) scale(1); }
          100% { transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* 合言葉（コード部屋のみ）。SNS等で共有して仲間を呼ぶ */}
      {roomCode && (
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: "0.6875rem", color: "#777", margin: 0, letterSpacing: "0.15em" }}>
            あいことば
          </p>
          <p style={{ fontSize: "2rem", fontWeight: 900, letterSpacing: "0.25em", margin: "0.15rem 0 0", color: "#000" }}>
            {roomCode}
          </p>
        </div>
      )}

      {/* 動画読み込みアニメーション */}
      <LoadingDots />

      {/* ✋ボタン（アイコン自体は動かない） */}
      <button
        type="button"
        onClick={handleHandTap}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <HandIcon size={56} color="#191c1d" />
      </button>

      {/* 参加者ドット（✋の下に並ぶ） */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "0.75rem",
            minHeight: DOT_SIZE,
          }}
        >
          {participants.map((p) => {
            const member = findMember(p.memberId);
            const color = member?.color ?? "#ccc";
            const isSelf = p.sessionId === mySessionId;
            const isBouncing = isSelf ? selfBouncing : bouncingSessionId === p.sessionId;
            return (
              <div
                key={p.sessionId}
                style={{
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  borderRadius: "50%",
                  background: color,
                  boxShadow: isSelf
                    ? `0 0 0 3px #f8f9fa, 0 0 0 5px ${color}`
                    : "0 0 0 1px rgba(0,0,0,0.08)",
                  animation: isBouncing ? "dot-bounce 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards" : "none",
                }}
              />
            );
          })}
        </div>
        <p style={{ fontSize: "0.875rem", color: "#474747", margin: 0 }}>
          {count === 0 ? "つながっています" : `${count}人が待ってる`}
        </p>
      </div>

      {/* 接続エラー */}
      {channelError && (
        <p style={{ fontSize: "0.8125rem", color: "#c00", textAlign: "center", margin: 0, lineHeight: 1.5 }}>
          接続が悪いです。しばらく待つか、ひとりで始めてください。
        </p>
      )}

      {/* せーのボタン（ホストが合図を出す） */}
      <button
        type="button"
        disabled={!isHost || !connected}
        onClick={onSeno}
        style={{
          width: "100%",
          maxWidth: 360,
          padding: "1rem",
          background: isHost && connected ? "#000" : "#c6c6c6",
          color: "#fff",
          border: "none",
          fontSize: "0.875rem",
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          cursor: isHost && connected ? "pointer" : "not-allowed",
          transition: "background 0.12s",
        }}
      >
        {isHost ? "せーの！" : "せーの待ち"}
      </button>

      {/* サブ導線。合言葉部屋では「入力し直す」、グローバル部屋では「やっぱりひとりで」 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.1rem" }}>
        {roomCode ? (
          <button
            type="button"
            onClick={onReenterCode}
            style={{
              background: "none",
              border: "none",
              fontSize: "0.8125rem",
              color: "#777",
              cursor: "pointer",
              padding: "0.25rem 0",
            }}
          >
            合言葉を入力し直す →
          </button>
        ) : (
          <button
            type="button"
            onClick={onSolo}
            style={{
              background: "none",
              border: "none",
              fontSize: "0.8125rem",
              color: "#777",
              cursor: "pointer",
              padding: "0.25rem 0",
            }}
          >
            やっぱりひとりで →
          </button>
        )}
        <button
          type="button"
          onClick={onBackToTop}
          style={{
            background: "none",
            border: "none",
            fontSize: "0.8125rem",
            color: "#777",
            cursor: "pointer",
            padding: "0.25rem 0",
          }}
        >
          ← ロビーに戻る
        </button>
      </div>
    </div>
  );
}
