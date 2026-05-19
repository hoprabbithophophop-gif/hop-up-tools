import LoadingDots from "./components/LoadingDots";
import HandIcon from "./components/HandIcon";

interface Props {
  isHost: boolean;
  selfReadied: boolean;
  readyCount: number;
  groupSize: number;
  failed: boolean;
  memberColor: string;
  onReadyTap: () => void;
  onRetrySeno: () => void;
  onQuit: () => void;
}

const BUTTON_SIZE = 132;

/**
 * せーの → 各自が✋を押して「参加＆動画再生＆開始」を表明する画面。
 * 全員が時間内に押せたら開始。押せなければ「息が合わなかった」。
 */
export default function ReadyCheck({
  isHost,
  selfReadied,
  readyCount,
  groupSize,
  failed,
  memberColor,
  onReadyTap,
  onRetrySeno,
  onQuit,
}: Props) {
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
        gap: "2rem",
        padding: "2rem 1.2rem",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
      }}
    >
      <LoadingDots />

      {failed ? (
        <>
          <p style={{ fontSize: "1.125rem", fontWeight: 700, color: "#000", margin: 0, textAlign: "center" }}>
            息が合わなかった！
          </p>
          {isHost ? (
            <button
              type="button"
              onClick={onRetrySeno}
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
              もう一回 せーの
            </button>
          ) : (
            <p style={{ fontSize: "0.875rem", color: "#777", margin: 0 }}>
              ホストの合図を待ってる…
            </p>
          )}
        </>
      ) : (
        <>
          <p style={{ fontSize: "1rem", fontWeight: 700, color: "#000", margin: 0, textAlign: "center" }}>
            {selfReadied ? "みんなを待ってる…" : "せーの、で✋を押して！"}
          </p>

          <button
            type="button"
            onClick={onReadyTap}
            disabled={selfReadied}
            style={{
              width: BUTTON_SIZE,
              height: BUTTON_SIZE,
              borderRadius: "50%",
              background: selfReadied ? "#c6c6c6" : memberColor,
              color: "#fff",
              border: "none",
              cursor: selfReadied ? "default" : "pointer",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              touchAction: "manipulation",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <HandIcon size={Math.round(BUTTON_SIZE * 0.55)} color="#fff" />
          </button>

          <p style={{ fontSize: "0.875rem", color: "#474747", margin: 0 }}>
            {readyCount} / {groupSize} 人
          </p>
        </>
      )}

      <button
        type="button"
        onClick={onQuit}
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
