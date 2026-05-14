import { useState, useEffect, useRef, useCallback } from "react";
import MemberSelect from "./components/MemberSelect";
import YouTubePlayer from "./components/YouTubePlayer";
import { VIDEO_ID, findMember } from "./data";
import {
  getLastSelectedMemberId,
  setLastSelectedMemberId,
  getOrCreateAnonymousSessionId,
} from "./storage";

type Screen = "select" | "play";

const LONG_PRESS_INTERVAL_MS = 150;

export default function HiTensionPage() {
  const [screen, setScreen] = useState<Screen>("select");
  const [memberId, setMemberId] = useState<string | null>(() => getLastSelectedMemberId());
  const timestampsRef = useRef<number[]>([]);
  const currentTimeRef = useRef(0);
  const pressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getOrCreateAnonymousSessionId();
  }, []);

  useEffect(() => {
    return () => {
      if (pressIntervalRef.current) clearInterval(pressIntervalRef.current);
    };
  }, []);

  const handleConfirm = (id: string) => {
    setMemberId(id);
    setLastSelectedMemberId(id);
    timestampsRef.current = [];
    setScreen("play");
  };

  const handleVideoEnded = () => {
    console.log("[hi-tension] video ended. timestamps:", timestampsRef.current);
    // Phase 1: Supabase 保存をここで結線する
  };

  const handleTimeUpdate = useCallback((t: number) => {
    currentTimeRef.current = t;
  }, []);

  const recordHi = useCallback(() => {
    const t = currentTimeRef.current;
    timestampsRef.current.push(t);
    console.log(
      `[hi-tension] HI! @ ${t.toFixed(2)}s (total: ${timestampsRef.current.length})`,
    );
  }, []);

  const clearPressInterval = () => {
    if (pressIntervalRef.current) {
      clearInterval(pressIntervalRef.current);
      pressIntervalRef.current = null;
    }
  };

  const handlePressStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    recordHi();
    clearPressInterval();
    pressIntervalRef.current = setInterval(recordHi, LONG_PRESS_INTERVAL_MS);
  };

  const handlePressEnd = () => {
    clearPressInterval();
  };

  if (screen === "select") {
    return (
      <MemberSelect initialSelectedId={memberId} onConfirm={handleConfirm} />
    );
  }

  const member = findMember(memberId);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8f9fa",
        color: "#191c1d",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <YouTubePlayer
        videoId={VIDEO_ID}
        onEnded={handleVideoEnded}
        onTimeUpdate={handleTimeUpdate}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "1.6rem 1.2rem 2rem",
        }}
      >
        <button
          type="button"
          onPointerDown={handlePressStart}
          onPointerUp={handlePressEnd}
          onPointerLeave={handlePressEnd}
          onPointerCancel={handlePressEnd}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            width: 120,
            height: 120,
            borderRadius: "50%",
            background: member?.color ?? "#000",
            color: "#fff",
            border: "none",
            fontSize: "1.5rem",
            fontWeight: 800,
            letterSpacing: "0.05em",
            cursor: "pointer",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.08)",
            touchAction: "manipulation",
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          ハイ！
        </button>

        <p
          style={{
            marginTop: "auto",
            paddingTop: "2.4rem",
            fontSize: "0.625rem",
            color: "#777",
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          楽曲・映像の著作権は権利者に帰属します。
          <br />
          権利者からの申し出により直ちに公開を停止します。
        </p>
      </div>
    </div>
  );
}
