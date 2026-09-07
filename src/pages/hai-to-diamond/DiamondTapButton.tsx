// 💎ボタン＋回数。ハイ！テンションの✋ボタン(HiTapButton)と同じ作り・同じ手触り。絵だけ gem に差し替えている。
// 長押しの連打はリリース時に外した（Hop決定 2026-09-07）。押した回数だけ💎が降る。
import { forwardRef, useImperativeHandle, useState, type PointerEvent as ReactPointerEvent } from "react";
import { faGem } from "@fortawesome/free-solid-svg-icons";
import BouncyNumber from "../hi-tension/components/BouncyNumber";
import FaIcon from "../hi-tension/components/FaIcon";

const BUTTON_SIZE = 120;
const INVITE_PULSE_SECONDS = 1.6; // 誘いの輪が1回広がって消えるまでの秒数【仮】

export type DiamondTapButtonApi = {
  reset: () => void;
};

interface Props {
  accentColor: string;
  /** 1タップ（または長押しの1刻み）ごとに呼ぶ。true を返したら回数を進める */
  onRecord: (autoRepeat?: boolean) => boolean;
  /** 回数をボタンの上に出さない（親が別の場所＝動画の上に出す時） */
  hideCount?: boolean;
  /** まだ一度も押されていない間、外側の輪をゆっくり脈打たせて押すよう誘う */
  inviting?: boolean;
  /** 動き軽減：脈打ちを止める（輪は静止したまま出す） */
  reduceMotion?: boolean;
}

const DiamondTapButton = forwardRef<DiamondTapButtonApi, Props>(function DiamondTapButton(
  { accentColor, onRecord, hideCount = false, inviting = false, reduceMotion = false },
  ref
) {
  const [count, setCount] = useState(0);
  const [isPressed, setIsPressed] = useState(false);

  useImperativeHandle(ref, () => ({
    reset() {
      setCount(0);
      setIsPressed(false);
    },
  }), []);

  const record = () => {
    if (onRecord(false)) setCount((c) => c + 1);
  };

  /** 押した瞬間（指を離すのを待たない）に1回 */
  const handlePressStart = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsPressed(true);
    record();
  };

  const handlePressEnd = () => {
    setIsPressed(false);
  };

  const showInvitePulse = inviting && !reduceMotion && !isPressed;

  return (
    <>
      {/* 誘いの輪の脈打ち。押されていない間だけ、外側の輪の半径と透明度が広がって消えるのを繰り返す */}
      <style>{`
        @keyframes hai-to-diamond-tap-invite {
          0%   { box-shadow: 0 0 0 3px rgba(255,255,255,0.92), 0 0 0 3px rgba(255,255,255,0.55), 0 6px 20px rgba(0,0,0,0.4); }
          70%  { box-shadow: 0 0 0 3px rgba(255,255,255,0.92), 0 0 0 26px rgba(255,255,255,0), 0 6px 20px rgba(0,0,0,0.4); }
          100% { box-shadow: 0 0 0 3px rgba(255,255,255,0.92), 0 0 0 26px rgba(255,255,255,0), 0 6px 20px rgba(0,0,0,0.4); }
        }
      `}</style>
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
          animation: showInvitePulse ? `hai-to-diamond-tap-invite ${INVITE_PULSE_SECONDS}s ease-out infinite` : undefined,
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
