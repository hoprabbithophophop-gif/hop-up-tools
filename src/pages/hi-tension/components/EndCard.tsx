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
  /** 「最初に戻る」＝選択画面へ戻る。 */
  onChangeColor: () => void;
  /** スペシャル回（お祝い等）。指定時はラベル/総数/シェア文/祝い文を回の仕様に。null=通常練習。 */
  event?: SpecialEvent | null;
  /** 盛り上がりタイムライン（自分の今回分を加算済みの bins）。 */
  heatmap?: { bins: number[]; binSeconds: number } | null;
  /** 期限切れスペシャル回の閲覧専用表示。自分のカウント/シェアを出さず、総数とヒートマップだけ見せる。 */
  viewOnly?: boolean;
  /** 練習に使った映像の YouTube id。元動画リンクの生成に使う。 */
  videoId?: string;
  /** 横向き。低い画面でもスクロール無しで収まるよう、縦積みを「数字+ヒートマップの行／ボタンの行」に組み替える。 */
  landscape?: boolean;
  /** 自分の今回のタップ時刻(秒)。ヒートマップの波の上に推し色ドットで重ねる。 */
  selfTimestamps?: number[];
  /** 各タップの「最寄りの拍からのズレ」(-0.5..+0.5、負=早い)。null=判定不能（表示しない）。 */
  beatOffsets?: number[] | null;
}

// X(旧Twitter)のシェア下書きを開く。文面・タグ・URLは hop 指定（勝手に足さない）。
// API/ログイン不要の Web Intent。URL を独立行で出したいので &url= は使わず本文に含める。
const SHARE_URL = "https://hop-up-tools.pages.dev/hi-tension";
const MV_VIDEO_ID = "WU-IF-cLPCY";
const ARENA_AT = Date.UTC(2026, 5, 16, 9, 0, 0); // 2026-06-16 18:00 JST 開演
function arenaCountdownLine(): string {
  const diff = ARENA_AT - Date.now();
  if (diff <= 0) return "";
  const hour = 3600000, min = 60000, day = 86400000;
  if (diff < day) {
    return diff >= hour
      ? `横浜アリーナまであと${Math.floor(diff / hour)}時間`
      : `横浜アリーナまであと${Math.max(1, Math.floor(diff / min))}分`;
  }
  const jstDay = (ms: number) => Math.floor((ms + 9 * hour) / day);
  return `横浜アリーナまであと${jstDay(ARENA_AT) - jstDay(Date.now())}日`;
}
function shareToX(count: number, event: SpecialEvent | null, videoId?: string) {
  if (event) {
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(event.shareText(count))}`,
      "_blank", "noopener,noreferrer",
    );
    return;
  }
  const isMv = videoId === MV_VIDEO_ID;
  const text = [
    "ハイ！テンション✋ Practice で",
    isMv ? `MV版で${count}回ハイ！した🖐️` : `${count}回ハイ！した🖐️`,
    arenaCountdownLine(),
    "#ハイテンションPractice",
    `MVはこちら→ https://youtu.be/${MV_VIDEO_ID}`,
    isMv ? `${SHARE_URL}?v=${MV_VIDEO_ID}` : SHARE_URL,
  ].filter(Boolean).join("\n");
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
    "_blank", "noopener,noreferrer",
  );
}

/**
 * 動画完走時に表示する終了カード。
 * ハイ！ボタンの位置を置き換える形で出る(動画はそのまま残る)。
 */
export default function EndCard({ selfCount, totalCount, memberColor, onChangeColor, event = null, heatmap = null, viewOnly = false, videoId, landscape = false, selfTimestamps, beatOffsets = null }: Props) {
  const isSpecial = event != null;
  const labelStyle: CSSProperties = {
    fontSize: "0.6875rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "#777",
    margin: "0 0 0.4rem",
  };

  // チューナー風ストリップ：横軸＝最寄りの拍（4分音符）からのズレ（±半拍）。中央の線＝ぴったり。
  // 自分の各タップを推し色ドットで置く＝0付近に固まっていればリズムに乗れている。
  // 同じズレのドットが重ならないよう縦は3段を循環。
  const tunerStrip = beatOffsets && beatOffsets.length > 0 && !viewOnly ? (
    <div style={{ width: "100%" }}>
      <p style={{ ...labelStyle, textAlign: "center" }}>リズム</p>
      <div
        aria-hidden
        style={{
          width: "100%",
          position: "relative",
          height: 26,
          background: "#eef0f2",
          overflow: "hidden",
        }}
      >
        {/* ±50msゾーン：人間が「ちゃんと乗れてる」ブレの目安（採点ではなく背景の帯だけ）。
            横軸は拍間隔(60/155≈387ms)の±半分なので、±50ms ≒ 中央±12.9%。 */}
        <div
          style={{
            position: "absolute",
            left: "37.1%",
            width: "25.8%",
            top: 0,
            bottom: 0,
            background: "rgba(255,255,255,0.75)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 2,
            marginLeft: -1,
            background: "#191c1d",
            opacity: 0.5,
          }}
        />
        <span style={{ position: "absolute", left: 5, top: "50%", transform: "translateY(-50%)", fontSize: "0.625rem", fontWeight: 600, color: "#9aa0a6" }}>
          はやい
        </span>
        <span style={{ position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)", fontSize: "0.625rem", fontWeight: 600, color: "#9aa0a6" }}>
          おそい
        </span>
        {/* ドットは1段（中央の高さ）に集約＋半透明・乗算＝重なるほど濃く焼ける。
            密度を「色の濃淡」で読ませる（hop選定。山グラフ案は時間軸の違う
            「みんなの盛り上がり」と見た目が紛らわしいため不採用）。 */}
        {beatOffsets.map((o, i) => (
          <span
            key={i}
            style={{
              position: "absolute",
              left: `${((0.5 + o) * 100).toFixed(2)}%`,
              top: "50%",
              width: 7,
              height: 7,
              margin: "-3.5px 0 0 -3.5px",
              borderRadius: "50%",
              background: memberColor,
              opacity: 0.3,
              mixBlendMode: "multiply",
            }}
          />
        ))}
      </div>
    </div>
  ) : null;

  // 横向き：スクロール無しの3ブロック構成（hop指定）。
  //   中央＝ヒートマップを動画の真下に（幅も動画と揃える＝波形のx軸が動画の時間軸と対応して読める）
  //   左＝数字を縦並び ／ 右＝ボタンを縦並び（動画の左右に空く帯の中央。play-area 基準の absolute。
  //   ※position:fixed は iOS Safari のアドレスバー伸縮で位置が狂うことがあるため使わない）。
  //   文言・ボタンの種類・順序は縦と同一。
  // 中央列（動画・ヒートマップ）の幅。HiTensionPage の完走後動画と同じ式（時間軸をぴったり揃える）。
  // 左右の帯の幅 = (100% - これ) / 2 ＝数字/ボタンをその帯の真ん中に置くのにも使う。
  const CENTER_W = "min(calc(100vw - 320px), calc(48dvh * 16 / 9))";
  const sideBandStyle = (side: "left" | "right"): CSSProperties => ({
    position: "absolute",
    zIndex: 3,
    [side]: 0,
    top: "50%",
    transform: "translateY(-50%)",
    width: `calc((100% - ${CENTER_W}) / 2)`,
    display: "flex",
    justifyContent: "center",
  });
  if (landscape) {
    return (
      <>
        {/* 中央：動画の真下のヒートマップ */}
        <div
          style={{
            width: CENTER_W,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "0.65rem", // 盛り上がり・リズムの間に呼吸させる
            position: "relative",
            zIndex: 3,
          }}
        >
          {isSpecial && event.endCardCongrats && (
            <p style={{ margin: 0, fontSize: "0.9rem", fontWeight: 800, textAlign: "center", color: memberColor }}>
              {event.endCardCongrats}
            </p>
          )}
          {heatmap && heatmap.bins.length > 0 && (
            <HeatmapChart
              bins={heatmap.bins}
              binSeconds={heatmap.binSeconds}
              color={isSpecial ? memberColor : "#000000"}
              height={40}
              label="みんなの盛り上がり"
              selfTimestamps={selfTimestamps}
              selfColor={memberColor}
              zoomable
            />
          )}
          {tunerStrip}
        </div>

        {/* 左：数字ブロック（左の帯の真ん中・縦中央） */}
        <div style={sideBandStyle("left")}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.9rem",
              textAlign: "center",
            }}
          >
            {!viewOnly && (
              <div>
                <p style={labelStyle}>{isSpecial ? "お祝いに挙げた✋" : "あなたのハイ！"}</p>
                <BouncyNumber value={selfCount} color={memberColor} size="2.4rem" />
              </div>
            )}
            <div>
              <p style={labelStyle}>{isSpecial ? "お祝いに挙がった✋の総数" : "歴代累計"}</p>
              <BouncyNumber value={totalCount} color={memberColor} size="1.8rem" />
            </div>
          </div>
        </div>

        {/* 右：ボタンブロック（右の帯の真ん中・縦中央） */}
        <div style={sideBandStyle("right")}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: "0.7rem",
            }}
          >
          <button type="button" onClick={onChangeColor} style={{ ...primaryBtnStyle, width: "auto", padding: "0.65rem 1.2rem" }}>
            最初に戻る
          </button>
          {!viewOnly && (
            <button
              type="button"
              onClick={() => shareToX(selfCount, event, videoId)}
              style={{ ...secondaryBtnStyle, width: "auto", padding: "0.65rem 1.2rem" }}
            >
              𝕏 でシェアする
            </button>
          )}
          {videoId && (
            <a
              href={`https://youtu.be/${videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                // 0.6875rem＝SE初代の横で右ブロックがヒートマップに被らない幅に収める
                fontSize: "0.6875rem",
                fontWeight: 600,
                color: "#777",
                textDecoration: "underline",
                textUnderlineOffset: "0.2rem",
                textAlign: "center",
              }}
            >
              ▶ YouTubeで元の映像を見る
            </a>
          )}
          </div>
        </div>
      </>
    );
  }

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
          selfTimestamps={selfTimestamps}
          selfColor={memberColor}
          zoomable
        />
      )}
      {tunerStrip}

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
        {/* 「最初に戻る」1本に統一（もう一度/別の色にする/通常にもどるを廃止）。外向きのシェアは一行空けて分ける。 */}
        <button type="button" onClick={onChangeColor} style={primaryBtnStyle}>
          最初に戻る
        </button>
        {!viewOnly && (
          <button
            type="button"
            onClick={() => shareToX(selfCount, event, videoId)}
            style={{ ...secondaryBtnStyle, marginTop: "1.2rem" }}
          >
            𝕏 でシェアする
          </button>
        )}

        {/* 元の映像を YouTube で開く（プレイヤーの外＝規約OK）。別タブ。 */}
        {videoId && (
          <a
            href={`https://youtu.be/${videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              marginTop: "0.4rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "#777",
              textDecoration: "underline",
              textUnderlineOffset: "0.2rem",
            }}
          >
            ▶ YouTubeで元の映像を見る
          </a>
        )}
      </div>
    </div>
  );
}
