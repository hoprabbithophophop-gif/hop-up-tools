import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import BouncyNumber from "./BouncyNumber";
import HandIcon from "./HandIcon";

const LONG_PRESS_INTERVAL_MS = 150;
const LONG_PRESS_THRESHOLD_MS = 250;
const BUTTON_SIZE = 120;

export type HiTapButtonApi = {
  /** 再プレイ開始時にカウンタ・押下状態を初期化する。 */
  reset: () => void;
};

interface Props {
  /** ボタンとカウンタの色（メンバーカラー or スペシャル回の色）。 */
  accentColor: string;
  /** タップ/長押し連打の記録（HiTensionPage の recordHi）。記録できたら true＝カウントを進める。 */
  onRecord: (autoRepeat?: boolean) => boolean;
}

// ハイ！ボタン＋ごほうびカウンタ。タップごとの state 更新（押し込みエフェクト・カウント）を
// この小さなコンポーネントに閉じ込め、巨大な HiTensionPage 全体を再レンダーさせない
// （INP対策：タップ遅延がスマホ相当のCPUで約1秒→数十msに落ちる）。見た目・挙動は従来と同一。
const HiTapButton = forwardRef<HiTapButtonApi, Props>(function HiTapButton({ accentColor, onRecord }, ref) {
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
      {/* ごほうび：押した回数。✋ボタン群(z:3)内・上部に置く。 */}
      <div style={{ position: "relative", zIndex: 3 }}>
        <BouncyNumber value={count} color={accentColor} size="2rem" />
      </div>
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
          flexShrink: 0, // 縦が足りない画面でも丸を保つ（楕円に潰れない）
          borderRadius: "50%",
          background: accentColor,
          color: "#fff",
          border: "none",
          cursor: "pointer",
          // 暗いアリーナ背景＋濃いメンカラでも埋もれないよう白リングで縁取り。
          boxShadow: isPressed
            ? "0 0 0 3px rgba(255,255,255,0.92), 0 0 0 11px rgba(255,255,255,0.14)"
            : "0 0 0 3px rgba(255,255,255,0.92), 0 6px 20px rgba(0,0,0,0.4)",
          transform: isPressed ? "scale(0.92)" : "scale(1)",
          transition: "transform 0.12s, box-shadow 0.12s",
          touchAction: "manipulation",
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
        <HandIcon size={Math.round(BUTTON_SIZE * 0.55)} color="#fff" />
      </button>
    </>
  );
});

export default HiTapButton;
