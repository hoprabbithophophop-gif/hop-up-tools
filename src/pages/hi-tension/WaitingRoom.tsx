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
  onBounceSignal: () => void;
  bouncingSessionId: string | null;
  onStart: () => void;
  onSolo: () => void;
}

const DOT_SIZE = 48;

export default function WaitingRoom({
  participants,
  mySessionId,
  isHost,
  connected,
  channelError,
  onBounceSignal,
  bouncingSessionId,
  onStart,
  onSolo,
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

      {/* スタートボタン */}
      <button
        type="button"
        disabled={!isHost || !connected}
        onClick={onStart}
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
        {isHost ? "スタート" : "ホストがスタートするのを待ってる"}
      </button>

      {/* やっぱりひとりで */}
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
    </div>
  );
}
