import { useRef, useState } from "react";
import HandIcon from "./components/HandIcon";
import NavButton from "./components/NavButton";
import { findMember } from "./data";
import { MAX_PARTICIPANTS, type Participant } from "./useHiTensionRealtime";

interface Props {
  participants: Participant[];
  mySessionId: string;
  isHost: boolean;
  connected: boolean;
  channelError: boolean;
  isOverflow: boolean;
  roomCode: string | null;
  /** 自分でコードを打って入った人か。true のときだけ「入力し直す」を出す（部屋を作った人には出さない） */
  enteredByCode: boolean;
  onBounceSignal: () => void;
  bouncingSessionId: string | null;
  onSeno: () => void;
  onSolo: () => void;
  onReenterCode: () => void;
  onBackToTop: () => void;
  /** 動画エリアの直下から始めるための top 値（例: "56.25vw"、PC では動画実高さの px 値）。
   *  動画ラッパー縮小時に動画と密着させるため、HiTensionPage が計算して渡す。 */
  topOffset?: string;
}

const DOT_SIZE = 14;

export default function WaitingRoom({
  participants,
  mySessionId,
  isHost,
  connected,
  channelError,
  isOverflow,
  roomCode,
  enteredByCode,
  onBounceSignal,
  bouncingSessionId,
  onSeno,
  onSolo,
  onReenterCode,
  onBackToTop,
  topOffset,
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
  // せーのは2人(MAX_PARTICIPANTS)揃ってから。1人で押すと相手が合流できないまま進んで詰むため。
  const canSeno = isHost && connected && count >= MAX_PARTICIPANTS;

  // あふれ（3人目以降）: 満員パネルを表示。スタートには参加できない。
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
          満員です（{MAX_PARTICIPANTS}人まで）
        </p>
        <p style={{ fontSize: "0.875rem", color: "#474747", margin: 0, textAlign: "center", lineHeight: 1.6 }}>
          いま{MAX_PARTICIPANTS}人が待ってます。
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
        <div style={{ width: "100%", maxWidth: 360, display: "flex", justifyContent: "flex-start" }}>
          <NavButton direction="back" onClick={onBackToTop}>
            ロビーに戻る
          </NavButton>
        </div>
      </div>
    );
  }

  // 暖機動画は HiTensionPage 側の常時マウントエリアで表示しているため、ここでは下半分だけ表示する。
  // top は動画の実高さに合わせる（モバイル: 56.25vw = 動画 100vw 幅×9/16。PC: 動画 360px 縮小時は 202.5px）。
  return (
    <div
      style={{
        position: "fixed",
        top: topOffset ?? "56.25vw",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
        overflow: "hidden",
        background: "#f8f9fa",
        color: "#191c1d",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-evenly",
        padding: "1rem 1.2rem",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
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

      {/* 上部：合言葉と人数 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem" }}>
        {roomCode && (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <p style={{ fontSize: "0.6875rem", color: "#777", margin: 0, letterSpacing: "0.15em" }}>
              あいことば
            </p>
            <p style={{ fontSize: "1.5rem", fontWeight: 900, letterSpacing: "0.25em", margin: "0.1rem 0 0", color: "#000" }}>
              {roomCode}
            </p>
            {/* 打ち間違えた時の入れ直し。あいことば表示の真下に置き「その場で直す」を位置で示す（戻る導線とは別物）。
                コードを打って入った人にだけ出す。打ち間違いで空室に入りホストになっても入れ直せるよう、
                isHost ではなく入室経路(enteredByCode)で判定する。部屋を作った人には出さない。 */}
            {enteredByCode && (
            <button
              type="button"
              onClick={onReenterCode}
              style={{
                marginTop: "0.5rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                minHeight: 36,
                padding: "0 0.7rem",
                background: "#eceef0",
                color: "#191c1d",
                border: "none",
                borderRadius: 0,
                fontSize: "0.75rem",
                fontWeight: 700,
                fontFamily: "inherit",
                whiteSpace: "nowrap",
                cursor: "pointer",
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
                transition: "background 0.12s",
              }}
            >
              <span aria-hidden>✎</span>
              入力し直す
            </button>
            )}
          </div>
        )}
        {channelError && (
          <p style={{ fontSize: "0.8125rem", color: "#c00", textAlign: "center", margin: 0, lineHeight: 1.5 }}>
            接続が悪いです。しばらく待つか、ひとりで始めてください。
          </p>
        )}
      </div>

      {/* 中央：✋ボタン + 参加者ドット（タップでピョンピョン、お互いに挨拶する仕掛け） */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
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
            touchAction: "manipulation",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <HandIcon size={56} color="#191c1d" />
        </button>
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
        <p style={{ fontSize: "0.8125rem", color: "#474747", margin: 0 }}>
          {`${count}/${MAX_PARTICIPANTS}人`}
        </p>
      </div>

      {/* 下部：せーのボタン + サブ導線 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", width: "100%" }}>
        <button
          type="button"
          disabled={!canSeno}
          onClick={onSeno}
          style={{
            width: "100%",
            maxWidth: 360,
            padding: "0.85rem",
            background: canSeno ? "#000" : "#c6c6c6",
            color: "#fff",
            border: "none",
            fontSize: "0.875rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            cursor: canSeno ? "pointer" : "not-allowed",
            transition: "background 0.12s",
          }}
        >
          {!isHost ? "せーの待ち" : count >= MAX_PARTICIPANTS ? "せーの！" : `あと${MAX_PARTICIPANTS - count}人待ってね`}
        </button>
        {/* 戻るは1つ（ロビーへ）。合言葉の入れ直しは上のあいことば表示の隣に置いた。 */}
        <div style={{ width: "100%", maxWidth: 360, display: "flex", justifyContent: "flex-start" }}>
          <NavButton direction="back" onClick={onBackToTop}>
            ロビーに戻る
          </NavButton>
        </div>
      </div>
    </div>
  );
}
