import { useEffect, useRef, useState } from "react";
import HandIcon from "./components/HandIcon";
import { findMember } from "./data";
import type { Participant } from "./useHiTensionRealtime";

interface Props {
  participants: Participant[];
  mySessionId: string;
  isHost: boolean;
  connected: boolean;
  channelError: boolean;
  onBounceSignal: () => void;        // ✋タップ → bounce broadcast
  bouncingSessionId: string | null;  // 今ドットが跳ねているセッションID
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
  // ✋ボタンを押したとき自分のドットもローカルで跳ねさせる
  const [selfBouncing, setSelfBouncing] = useState(false);
  const selfBounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHandTap = () => {
    onBounceSignal();
    setSelfBouncing(true);
    if (selfBounceTimerRef.current) clearTimeout(selfBounceTimerRef.current);
    selfBounceTimerRef.current = setTimeout(() => setSelfBouncing(false), 400);
  };

  useEffect(() => {
    return () => {
      if (selfBounceTimerRef.current) clearTimeout(selfBounceTimerRef.current);
    };
  }, []);

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
      {/* 接続状態 */}
      {(channelError || !connected) && (
        <p
          style={{
            position: "absolute",
            top: "1.2rem",
            fontSize: "0.75rem",
            color: "#c00",
            textAlign: "center",
          }}
        >
          {channelError ? "接続できませんでした。しばらく待つか、ひとりで始めてください。" : "接続中…"}
        </p>
      )}

      {/* ✋ ボタン（タップで合図） */}
      <button
        type="button"
        onClick={handleHandTap}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: selfBouncing ? "translateY(-16px) scale(1.1)" : "translateY(0) scale(1)",
          transition: "transform 0.15s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        <HandIcon size={72} color="#191c1d" />
      </button>

      {/* 参加者ドット */}
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
                transform: isBouncing ? "translateY(-14px)" : "translateY(0)",
                transition: "transform 0.18s cubic-bezier(0.34,1.56,0.64,1)",
              }}
            />
          );
        })}
      </div>

      {/* 人数テキスト */}
      <p style={{ fontSize: "0.875rem", color: "#474747", margin: 0 }}>
        {count === 0 ? "つながっています" : `${count}人が待ってる`}
      </p>

      {/* スタートボタン（ホストのみ有効） */}
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
