import type { CSSProperties } from "react";
import BouncyNumber from "./BouncyNumber";

// 完走後の3アクション共通のボタン形。横幅(100%)・余白・字を揃え、色だけで主役/副次を分ける。
const baseBtnStyle: CSSProperties = {
  width: "100%",
  padding: "0.85rem",
  border: "none",
  fontSize: "0.875rem",
  fontWeight: 700,
  letterSpacing: "0.05em",
  cursor: "pointer",
  fontFamily: "inherit",
};
const primaryBtnStyle: CSSProperties = { ...baseBtnStyle, background: "#000", color: "#fff" };
const secondaryBtnStyle: CSSProperties = { ...baseBtnStyle, background: "#eceef0", color: "#191c1d" };

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
        {/* 3アクションは横幅を揃えた同形ボタンに統一（テキストリンクは廃止）。
            ツール内で続ける動作（もう一度・別の色にする）をまとめ、外向き動作（シェア）は
            一行空けて分ける。主役の「もう一度」だけ黒、他は灰色で段差を付ける。 */}
        <button type="button" onClick={onReplay} style={primaryBtnStyle}>
          もう一度
        </button>
        <button type="button" onClick={onChangeColor} style={secondaryBtnStyle}>
          別の色にする
        </button>
        <button
          type="button"
          onClick={() => shareToX(selfCount)}
          style={{ ...secondaryBtnStyle, marginTop: "1.2rem" }}
        >
          𝕏 でシェアする
        </button>
      </div>
    </div>
  );
}
