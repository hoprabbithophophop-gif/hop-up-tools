import BouncyNumber from "./BouncyNumber";

interface Props {
  selfCount: number;
  totalCount: number;
  memberColor: string;
  onReplay: () => void;
}

/**
 * 動画完走時に表示する終了カード。
 * ハイ！ボタンの位置を置き換える形で出る(動画はそのまま残る)。
 */
export default function EndCard({ selfCount, totalCount, memberColor, onReplay }: Props) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 360,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1.6rem",
        padding: "1.2rem 0.4rem",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <p
          style={{
            fontSize: "0.6875rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "#777",
            margin: "0 0 0.4rem",
          }}
        >
          あなたのハイ！
        </p>
        <BouncyNumber value={selfCount} color={memberColor} size="3rem" />
      </div>

      <div style={{ textAlign: "center" }}>
        <p
          style={{
            fontSize: "0.6875rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "#777",
            margin: "0 0 0.4rem",
          }}
        >
          歴代累計
        </p>
        <BouncyNumber value={totalCount} color={memberColor} size="2.25rem" />
      </div>

      <button
        type="button"
        onClick={onReplay}
        style={{
          marginTop: "0.4rem",
          padding: "0.8rem 2.4rem",
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
        もう一度
      </button>
    </div>
  );
}
