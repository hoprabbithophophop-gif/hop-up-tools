import HandIcon from "./components/HandIcon";
import NavButton from "./components/NavButton";

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
  /** 動画エリアの直下から始めるための top 値（WaitingRoom と同じ）。 */
  topOffset?: string;
}

const BUTTON_SIZE = 132;

/**
 * せーの → 各自が✋を押して「参加＆開始」を表明する画面。
 * 暖機動画は HiTensionPage 側で常時表示しているため、ここでは下半分だけ表示。
 * ✋押下後はユーザー操作なし。暖機動画の同期確認が完了したら自動で本動画へ遷移する。
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
  topOffset,
}: Props) {
  return (
    <div
      style={{
        position: "fixed",
        top: topOffset ?? "56.25vw",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 200,
        background: "#f8f9fa",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.25rem",
        padding: "1.2rem 1.2rem 1rem",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
        animation: "hi-tension-fade-in 180ms ease-out",
      }}
    >
      {/* 状態テキスト・✋・最初に戻る をコンパクトな中央クラスタに（短い実機画面でも切れない） */}

      {/* 上部：状態テキスト */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
        {failed ? (
          <p style={{ fontSize: "1.125rem", fontWeight: 700, color: "#000", margin: 0, textAlign: "center" }}>
            息が合わなかった！
          </p>
        ) : (
          <>
            {!selfReadied && (
              <p style={{ fontSize: "1rem", fontWeight: 700, color: "#000", margin: 0, textAlign: "center" }}>
                Let's go！
              </p>
            )}
            {selfReadied && (
              <p style={{ fontSize: "0.875rem", color: "#474747", margin: 0, textAlign: "center", lineHeight: 1.5 }}>
                ほかの人を待っています
              </p>
            )}
            <p style={{ fontSize: "0.875rem", color: "#474747", margin: 0 }}>
              {readyCount} / {groupSize} 人
            </p>
          </>
        )}
      </div>

      {/* 中央：✋ボタン or 失敗時の「もう一回 せーの」 */}
      {failed ? (
        isHost ? (
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
            もう一回 せーの！
          </button>
        ) : (
          <p style={{ fontSize: "0.875rem", color: "#777", margin: 0 }}>
            せーの待ち…
          </p>
        )
      ) : (
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
      )}

      {/* 下部：やめる（左寄せ・最下部キープ） */}
      <div style={{ width: "100%", maxWidth: 360, display: "flex", justifyContent: "flex-start" }}>
        <NavButton direction="back" onClick={onQuit}>
          最初に戻る
        </NavButton>
      </div>
    </div>
  );
}
