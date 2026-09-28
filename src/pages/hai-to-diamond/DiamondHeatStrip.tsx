// 盛り上がりの帯。曲の頭から終わりまでを1本の細い帯にして、
// みんなが💎を押した密度が高いところほど明るく光らせる。今どこを再生しているかは白い印で示す。
//
// 描く場所のルール（YouTube API 規約）: 動画プレイヤーの上には何も描かない。
// この帯は動画の額縁より下（動画の矩形の外）に置く。にじみ（ぼかし）が上へ広がっても
// 動画に掛からないよう、親の器で上をはみ出さないようにしている。
import { memo, useMemo } from "react";

/** 帯本体の高さ(px)【仮】 */
const DEFAULT_HEIGHT = 6;
/** 下に敷く「光の滲み」のぼかし量(px)【仮】 */
const GLOW_BLUR = 6;
/** 密度0の時の色（暗い）と、密度1の時の色（明るい）【仮】。モノクロ。色はメンバーの色にだけ使う */
const DARK: [number, number, number] = [26, 29, 36];    // #1a1d24
const LIGHT: [number, number, number] = [223, 230, 245]; // #dfe6f5

interface Props {
  /** 曲を等間隔に割った各区間の密度。0〜1 に正規化済み。空なら帯は暗いまま */
  levels: number[];
  /** いま再生している位置（0〜1）。白い印の場所 */
  progress: number;
  /** 帯本体の高さ(px)。省略時は6【仮】 */
  height?: number;
}

/** 密度（0〜1）を暗い色〜明るい色のあいだの色にする */
function levelColor(v: number): string {
  const k = Math.max(0, Math.min(1, v));
  const r = Math.round(DARK[0] + (LIGHT[0] - DARK[0]) * k);
  const g = Math.round(DARK[1] + (LIGHT[1] - DARK[1]) * k);
  const b = Math.round(DARK[2] + (LIGHT[2] - DARK[2]) * k);
  return `rgb(${r},${g},${b})`;
}

const DiamondHeatStrip = memo(function DiamondHeatStrip({ levels, progress, height = DEFAULT_HEIGHT }: Props) {
  // 帯の模様（左から右へ色が変わるグラデーション）。密度の並びが変わった時だけ作り直す＝
  // 再生中の0.1秒ごとの更新では白い印だけが動く
  const gradient = useMemo(() => {
    if (levels.length === 0) return levelColor(0);
    const stops = levels.map((v, i) => `${levelColor(v)} ${((i + 0.5) / levels.length * 100).toFixed(2)}%`);
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  }, [levels]);

  const left = `${(Math.max(0, Math.min(1, progress)) * 100).toFixed(3)}%`;

  return (
    <div style={{ position: "relative", height, width: "100%" }}>
      {/* 下の層: 同じ模様をぼかして光の滲みにする */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: gradient,
          filter: `blur(${GLOW_BLUR}px)`,
          opacity: 0.85,
        }}
      />
      {/* 上の層: 帯そのもの */}
      <div aria-hidden style={{ position: "absolute", inset: 0, background: gradient }} />
      {/* いま再生している位置。帯より上下に少しはみ出す細い白い印 */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left,
          top: -3,
          bottom: -3,
          width: 2,
          marginLeft: -1,
          background: "#ffffff",
          boxShadow: "0 0 6px rgba(255,255,255,0.8)",
        }}
      />
    </div>
  );
});

export default DiamondHeatStrip;
