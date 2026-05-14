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

// 「ハイ！テンション」の特殊区間（動画再生秒）
const STOP_WINDOW = { start: 185, end: 188 };       // 「STOP！ハイは一回ね」(押下不可)
const LONGPRESS_WINDOW = { start: 188, end: 190 };  // ロングトーン「ハーイ！」(長押し推奨)

type ButtonMode = "normal" | "stop" | "longpress";

function computeButtonMode(t: number): ButtonMode {
  if (t >= STOP_WINDOW.start && t < STOP_WINDOW.end) return "stop";
  if (t >= LONGPRESS_WINDOW.start && t < LONGPRESS_WINDOW.end) return "longpress";
  return "normal";
}

export default function HiTensionPage() {
  const [screen, setScreen] = useState<Screen>("select");
  const [memberId, setMemberId] = useState<string | null>(() => getLastSelectedMemberId());
  const [buttonMode, setButtonMode] = useState<ButtonMode>("normal");
  const timestampsRef = useRef<number[]>([]);
  const currentTimeRef = useRef(0);
  const pressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getOrCreateAnonymousSessionId();
  }, []);

  const clearPressInterval = useCallback(() => {
    if (pressIntervalRef.current) {
      clearInterval(pressIntervalRef.current);
      pressIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearPressInterval();
  }, [clearPressInterval]);

  // STOP区間に入ったら連射ループも止める
  useEffect(() => {
    if (buttonMode === "stop") clearPressInterval();
  }, [buttonMode, clearPressInterval]);

  const handleConfirm = (id: string) => {
    setMemberId(id);
    setLastSelectedMemberId(id);
    timestampsRef.current = [];
    setButtonMode("normal");
    setScreen("play");
  };

  const handleVideoEnded = () => {
    console.log(`[hi-tension] video ended (${timestampsRef.current.length} presses)`);
  };

  const handleTimeUpdate = useCallback((t: number) => {
    currentTimeRef.current = t;
    const mode = computeButtonMode(t);
    setButtonMode((prev) => (prev === mode ? prev : mode));
  }, []);

  const recordHi = useCallback(() => {
    const t = currentTimeRef.current;
    if (computeButtonMode(t) === "stop") return;
    timestampsRef.current.push(t);
    console.log(`[hi-tension] HI! @ ${t.toFixed(2)}s`);
  }, []);

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
  const isStop = buttonMode === "stop";
  const isLongPress = buttonMode === "longpress";
  const buttonSize = isStop ? 64 : 120;

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
      <style>{`
        @keyframes hi-tension-longpress-pulse {
          0% { transform: translate(-50%, 0) scale(1); }
          100% { transform: translate(-50%, 0) scale(1.12); }
        }
      `}</style>

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
          padding: "2.4rem 1.2rem 2rem",
        }}
      >
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 120 }}>
          {isLongPress && (
            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: "calc(100% + 0.4rem)",
                whiteSpace: "nowrap",
                fontWeight: 800,
                fontSize: "1.1rem",
                letterSpacing: "0.05em",
                color: member?.color ?? "#000",
                transformOrigin: "center bottom",
                animation: "hi-tension-longpress-pulse 0.4s ease-in-out infinite alternate",
                pointerEvents: "none",
              }}
            >
              長押し！
            </div>
          )}
          <button
            type="button"
            disabled={isStop}
            onPointerDown={isStop ? undefined : handlePressStart}
            onPointerUp={handlePressEnd}
            onPointerLeave={handlePressEnd}
            onPointerCancel={handlePressEnd}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              width: buttonSize,
              height: buttonSize,
              borderRadius: "50%",
              background: member?.color ?? "#000",
              color: "#fff",
              border: "none",
              fontSize: isStop ? "0.75rem" : "1.5rem",
              fontWeight: 800,
              letterSpacing: "0.05em",
              cursor: isStop ? "not-allowed" : "pointer",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.08)",
              opacity: isStop ? 0.3 : 1,
              transition: "width 0.25s, height 0.25s, opacity 0.25s, font-size 0.25s",
              touchAction: "manipulation",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            ハイ！
          </button>
        </div>

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
