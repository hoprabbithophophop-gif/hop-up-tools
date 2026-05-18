import { useEffect, useRef, useState } from "react";
import HandIcon from "./components/HandIcon";

interface Props {
  startAt: number;        // Unix ms。この時刻に動画を開始する
  onReady: () => void;    // iOS Safari 対応: 最後にユーザータップで play() を呼ぶ
}

type Phase = 3 | 2 | 1 | "tap" | "go";

export default function Countdown({ startAt, onReady }: Props) {
  const [phase, setPhase] = useState<Phase>(3);
  const rafRef = useRef<number | null>(null);
  const calledRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      const remaining = startAt - Date.now();
      if (remaining > 2000) {
        setPhase(3);
      } else if (remaining > 1000) {
        setPhase(2);
      } else if (remaining > 0) {
        setPhase(1);
      } else {
        // 時刻到達 → TAP フェーズ（iOS Safari はここでユーザータップが必要）
        setPhase("tap");
        return; // RAF 停止
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    // 既に過去の start_at（ネットワーク遅延で受信が遅れた場合）→ 即 TAP
    if (startAt <= Date.now()) {
      setPhase("tap");
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [startAt]);

  const handleTap = () => {
    if (calledRef.current) return;
    calledRef.current = true;
    setPhase("go");
    onReady(); // ← ここがユーザージェスチャー文脈。iOS の play() はここで呼ぶ
  };

  const isNumber = phase === 3 || phase === 2 || phase === 1;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "#f8f9fa",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {isNumber && (
        <span
          key={phase}
          style={{
            fontSize: "20vw",
            fontWeight: 900,
            color: "#000",
            lineHeight: 1,
            animation: "countdown-pop 0.9s ease-out forwards",
          }}
        >
          {phase}
        </span>
      )}

      {phase === "tap" && (
        <button
          type="button"
          onClick={handleTap}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1rem",
            padding: 0,
            animation: "countdown-pop 0.3s ease-out forwards",
          }}
        >
          <HandIcon size={80} color="#000" />
          <span style={{ fontSize: "1rem", fontWeight: 700, letterSpacing: "0.1em", color: "#000" }}>
            TAP!
          </span>
        </button>
      )}

      {phase === "go" && (
        <span style={{ fontSize: "12vw", fontWeight: 900, color: "#000", lineHeight: 1 }}>
          GO
        </span>
      )}

      <style>{`
        @keyframes countdown-pop {
          0%   { transform: scale(1.4); opacity: 0.7; }
          60%  { transform: scale(0.95); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
