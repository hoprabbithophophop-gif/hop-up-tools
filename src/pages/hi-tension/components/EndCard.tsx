import BouncyNumber from "./BouncyNumber";

interface Props {
  selfCount: number;
  totalCount: number;
  memberColor: string;
  onReplay: () => void;
  onChangeColor: () => void;
}

// X(旧Twitter)のシェア下書きを開く。文面・タグ・URLは hop 指定（勝手に足さない）。
// API/ログイン不要の Web Intent。URL を独立行で出したいので &url= は使わず本文に含める。
const SHARE_URL = "https://hop-up-tools.pages.dev/hi-tension";
function shareToX(count: number) {
  const text = `ハイ！テンション✋ Practice で\n${count}回ハイ！した🖐️\n#ハイテンションPractice #BEYOOOOONDS\n${SHARE_URL}`;
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
    "_blank",
    "noopener,noreferrer",
  );
}

/**
 * 動画完走時に表示する終了カード。
 * ハイ！ボタンの位置を置き換える形で出る(動画はそのまま残る)。
 */
export default function EndCard({ selfCount, totalCount, memberColor, onReplay, onChangeColor }: Props) {
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

      <div
        style={{
          marginTop: "0.4rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.8rem",
          width: "100%",
        }}
      >
        <button
          type="button"
          onClick={onReplay}
          style={{
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
        <button
          type="button"
          onClick={() => shareToX(selfCount)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.4rem",
            padding: "0.7rem 1.6rem",
            background: "#eceef0",
            color: "#191c1d",
            border: "none",
            fontSize: "0.8125rem",
            fontWeight: 700,
            letterSpacing: "0.03em",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          𝕏 でシェアする
        </button>
        <button
          type="button"
          onClick={onChangeColor}
          style={{
            padding: "0.4rem 0.8rem",
            background: "transparent",
            color: "#474747",
            border: "none",
            fontSize: "0.8125rem",
            fontWeight: 500,
            textDecoration: "underline",
            textUnderlineOffset: "0.2rem",
            cursor: "pointer",
          }}
        >
          別の色にする
        </button>
      </div>
    </div>
  );
}
