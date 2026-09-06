// 💎ボタン＋回数。ハイ！テンションの✋ボタン(HiTapButton)と同じ作り・同じ手触り
// （タップで1回、長押しで連打）。絵だけ gem に差し替えている。
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { faGem } from "@fortawesome/free-solid-svg-icons";
import BouncyNumber from "../hi-tension/components/BouncyNumber";
import FaIcon from "../hi-tension/components/FaIcon";

const LONG_PRESS_INTERVAL_MS = 150;
const LONG_PRESS_THRESHOLD_MS = 250;
const BUTTON_SIZE = 120;

export type DiamondTapButtonApi = {
  reset: () => void;
};

interface Props {
  accentColor: string;
  /** 1タップ（または長押しの1刻み）ごとに呼ぶ。true を返したら回数を進める */
  onRecord: (autoRepeat?: boolean) => boolean;
  /** 回数をボタンの上に出さない（親が別の場所＝動画の上に出す時） */
  hideCount?: boolean;
}

const DiamondTapButton = forwardRef<DiamondTapButtonApi, Props>(function DiamondTapButton({ accentColor, onRecord, hideCount = false }, ref) {
  const [count, setCount] = useState(0);
  const [isPressed, setIsPressed] = useState(false);
  const pressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPressTimers = () => {
    if (pressIntervalRef.current) { clearInterval(pressIntervalRef.current); pressIntervalRef.current = null; }
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
  };
  useEffect(() => clearPressTimers, []);

  useImperativeHandle(ref, () => ({
    reset() {
      setCount(0);
      setIsPressed(false);
      clearPressTimers();
    },
  }), []);

  const record = (autoRepeat = false) => {
    if (onRecord(autoRepeat)) setCount((c) => c + 1);
  };

  const handlePressStart = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsPressed(true);
    record();
    clearPressTimers();
    holdTimerRef.current = setTimeout(() => {
      pressIntervalRef.current = setInterval(() => record(true), LONG_PRESS_INTERVAL_MS);
    }, LONG_PRESS_THRESHOLD_MS);
  };

  const handlePressEnd = () => {
    setIsPressed(false);
    clearPressTimers();
  };

  return (
    <>
      {!hideCount && (
        <div style={{ position: "relative", zIndex: 3 }}>
          <BouncyNumber value={count} color={accentColor} size="2rem" />
        </div>
      )}
      <button
        type="button"
        onPointerDown={handlePressStart}
        onPointerUp={handlePressEnd}
        onPointerLeave={handlePressEnd}
        onPointerCancel={handlePressEnd}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          flexShrink: 0,
          borderRadius: "50%",
          background: accentColor,
          color: "#fff",
          border: "none",
          cursor: "pointer",
          boxShadow: isPressed
            ? "0 0 0 3px rgba(255,255,255,0.92), 0 0 0 11px rgba(255,255,255,0.14)"
            : "0 0 0 3px rgba(255,255,255,0.92), 0 6px 20px rgba(0,0,0,0.4)",
          transform: isPressed ? "scale(0.92)" : "scale(1)",
          transition: "transform 0.12s, box-shadow 0.12s",
          touchAction: "none",   // 連打中に指が滑ってもスクロールにしない（Hop報告 2026-09-07）
          userSelect: "none",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
          WebkitTapHighlightColor: "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
      >
        <FaIcon icon={faGem} size={Math.round(BUTTON_SIZE * 0.5)} color="#fff" />
      </button>
    </>
  );
});

export default DiamondTapButton;
