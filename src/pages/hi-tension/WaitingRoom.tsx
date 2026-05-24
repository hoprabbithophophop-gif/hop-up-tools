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

const MAX_PARTICIPANTS = 4;

export default function WaitingRoom({
  participants,
  mySessionId: _mySessionId,
  isHost,
  connected,
  channelError,
  isOverflow,
  roomCode,
  onBounceSignal: _onBounceSignal,
  bouncingSessionId: _bouncingSessionId,
  onSeno,
  onSolo,
  onReenterCode,
  onBackToTop,
}: Props) {
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

  // 暖機動画は HiTensionPage 側の常時マウントエリアで表示しているため、ここでは下半分だけ表示する。
  // top を動画の高さぶん（16:9 = 56.25vw）空けることで、上に動画が見える。
  return (
    <div
      style={{
        position: "fixed",
        top: "56.25vw",
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
        justifyContent: "space-between",
        padding: "1.2rem 1.2rem 1rem",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
        animation: "hi-tension-fade-in 180ms ease-out",
      }}
    >
      {/* 上部：合言葉と人数 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.8rem" }}>
        {roomCode && (
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: "0.6875rem", color: "#777", margin: 0, letterSpacing: "0.15em" }}>
              あいことば
            </p>
            <p style={{ fontSize: "1.75rem", fontWeight: 900, letterSpacing: "0.25em", margin: "0.15rem 0 0", color: "#000" }}>
              {roomCode}
            </p>
          </div>
        )}
        <p style={{ fontSize: "0.875rem", color: "#474747", margin: 0 }}>
          {`${count}/${MAX_PARTICIPANTS}人`}
        </p>
        {channelError && (
          <p style={{ fontSize: "0.8125rem", color: "#c00", textAlign: "center", margin: 0, lineHeight: 1.5 }}>
            接続が悪いです。しばらく待つか、ひとりで始めてください。
          </p>
        )}
      </div>

      {/* 中央：せーのボタン */}
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

      {/* 下部：サブ導線 */}
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
