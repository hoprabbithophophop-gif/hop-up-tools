import type { CSSProperties } from "react";
import BouncyNumber from "./BouncyNumber";
import HeatmapChart from "./HeatmapChart";
import type { SpecialEvent } from "../events";

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
  /** スペシャル回（お祝い等）。指定時はラベル/総数/シェア文/祝い文を回の仕様に。null=通常練習。 */
  event?: SpecialEvent | null;
  /** 盛り上がりタイムライン（自分の今回分を加算済みの bins）。 */
  heatmap?: { bins: number[]; binSeconds: number } | null;
  /** 期限切れスペシャル回の閲覧専用表示。自分のカウント/シェアを出さず、総数とヒートマップだけ見せる。 */
  viewOnly?: boolean;
}

// X(旧Twitter)のシェア下書きを開く。文面・タグ・URLは hop 指定（勝手に足さない）。
// API/ログイン不要の Web Intent。URL を独立行で出したいので &url= は使わず本文に含める。
const SHARE_URL = "https://hop-up-tools.pages.dev/hi-tension";
function shareToX(count: number, event: SpecialEvent | null) {
  const text = event
    ? event.shareText(count)
    : `ハイ！テンション✋ Practice で\n${count}回ハイ！した🖐️\n#ハイテンションPractice\n${SHARE_URL}`;
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
export default function EndCard({ selfCount, totalCount, memberColor, onReplay, onChangeColor, event = null, heatmap = null, viewOnly = false }: Props) {
  const isSpecial = event != null;
  const labelStyle: CSSProperties = {
    fontSize: "0.6875rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "#777",
    margin: "0 0 0.4rem",
  };
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 360,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1.1rem", // 短い画面(iPhone SE)で縦を詰める
        padding: "0.4rem 0.4rem",
      }}
    >
      {isSpecial && event.endCardCongrats && (
        <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800, textAlign: "center", color: memberColor }}>
          {event.endCardCongrats}
        </p>
      )}
      {!viewOnly && (
        <div style={{ textAlign: "center" }}>
          <p style={labelStyle}>{isSpecial ? "お祝いに挙げた✋" : "あなたのハイ！"}</p>
          <BouncyNumber value={selfCount} color={memberColor} size="3rem" />
        </div>
      )}

      <div style={{ textAlign: "center" }}>
        <p style={labelStyle}>{isSpecial ? "お祝いに挙がった✋の総数" : "歴代累計"}</p>
        <BouncyNumber value={totalCount} color={memberColor} size="2.25rem" />
      </div>

      {/* 盛り上がりタイムライン（みんながどこで一斉に✋したか）。データが無ければ自動で非表示。 */}
      {heatmap && heatmap.bins.length > 0 && (
        <HeatmapChart
          bins={heatmap.bins}
          binSeconds={heatmap.binSeconds}
          color={isSpecial ? memberColor : "#000000"}
          height={60}
          label="みんなの盛り上がり"
        />
      )}

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
        {!viewOnly && (
          <button
            type="button"
            onClick={() => shareToX(selfCount, event)}
            style={{ ...secondaryBtnStyle, marginTop: "1.2rem" }}
          >
            𝕏 でシェアする
          </button>
        )}
      </div>
    </div>
  );
}
