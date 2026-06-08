import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  /** 各時間ビンの総タップ数。長さ=ビン数（既定256＝1秒刻み）。 */
  bins: number[];
  /** 1ビンあたりの秒数（横軸→秒の換算。RPCの bin_seconds）。 */
  binSeconds: number;
  /** 線・塗りの色（メンバーカラー or スペシャル回の色）。 */
  color: string;
  /** 再生中の現在位置（秒）。指定すると縦線を出す（静的）。 */
  currentTime?: number;
  /** 再生中の現在位置を毎フレーム読むref。指定すると親を再レンダーせず縦線だけ動かす。 */
  liveTimeRef?: { current: number };
  /** SVGの高さ(px)。既定56。 */
  height?: number;
  /** 再生中の動画下に薄く敷く用。淡くする。 */
  faint?: boolean;
  /** 見出しラベル（完走後EndCard用）。faint時は出さない。 */
  label?: string;
  /** 指定時：可視幅を windowSeconds 秒に固定し「中央固定プレイヘッド＋波形スクロール」表示。
   *  本編中の拡大表示用（EndCardは未指定＝曲全体・スクロールなし）。 */
  windowSeconds?: number;
}

// 盛り上がりタイムライン。全員のタップを時間ビンに集計した山グラフ（YouTube「よく見られてるとこ」風）。
// 純SVG（群衆✋のPixiとは別系統）。静的描画なので軽量。
export default function HeatmapChart({
  bins,
  binSeconds,
  color,
  currentTime,
  liveTimeRef,
  height = 56,
  faint = false,
  label,
  windowSeconds,
}: Props) {
  const n = bins.length;
  const max = useMemo(() => bins.reduce((m, v) => (v > m ? v : m), 0), [bins]);

  // ライブ縦線：liveTimeRef があれば rAF で自分の中だけ再レンダー（親は触らない）。
  const [liveSec, setLiveSec] = useState(0);
  const rafRef = useRef(0);
  useEffect(() => {
    if (!liveTimeRef) return;
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      setLiveSec(liveTimeRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { mounted = false; cancelAnimationFrame(rafRef.current); };
  }, [liveTimeRef]);

  const H = 100;
  const pad = 2;

  // 全体の山パス（bin座標 x=0..n）。1回だけ計算し、フレーム毎は viewBox だけ動かす＝滑らか＆軽量。
  const { linePath, areaPath } = useMemo(() => {
    const m = max || 1;
    const pts = bins.map((v, i) => {
      const x = i + 0.5;
      const y = H - pad - (v / m) * (H - pad);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return {
      linePath: `M${pts.join(" L")}`,
      areaPath: `M0,${H} L${pts.join(" L")} L${n},${H} Z`,
    };
  }, [bins, max, n]);

  // データが無い（移行前・取得失敗・全0）なら何も描かない。
  if (n === 0 || max === 0) return null;

  const headSec = liveTimeRef ? liveSec : (currentTime ?? null);
  const total = n * binSeconds;

  // 既定（EndCard等・windowSeconds未指定）＝曲全体を表示・スクロールなし。
  let viewX0 = 0;
  let viewW = n;
  let headX: number | null = headSec != null && binSeconds > 0 ? headSec / binSeconds : null;

  // 本編中（windowSeconds 指定）＝可視幅一定で「中央固定プレイヘッド＋波形スクロール」。
  //   前半: 白バー左→中央（波形は先頭で静止）／中盤: 白バー中央固定・波形が左へスクロール／
  //   終端: 波形が静止し白バー中央→右端。viewStart を [0, total-可視幅] にクランプすると3フェーズが1式で出る。
  if (windowSeconds && windowSeconds > 0 && binSeconds > 0) {
    viewW = Math.min(n, Math.max(1, windowSeconds / binSeconds));
    const spanSec = viewW * binSeconds;
    const t = headSec ?? 0;
    const viewStartSec = Math.max(0, Math.min(Math.max(0, total - spanSec), t - spanSec / 2));
    viewX0 = viewStartSec / binSeconds;
    headX = t / binSeconds;
  }

  const gid = `hi-heat-${Math.round(max)}-${n}`;

  return (
    <div style={{ width: "100%", maxWidth: 360 }}>
      {label && !faint && (
        <p
          style={{
            margin: "0 0 0.3rem",
            fontSize: "0.6875rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "#777",
            textAlign: "center",
          }}
        >
          {label}
        </p>
      )}
      <svg
        viewBox={`${viewX0.toFixed(3)} 0 ${viewW} ${H}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        aria-hidden
        style={{ display: "block", opacity: faint ? 0.7 : 1 }}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={faint ? 0.55 : 0.75} />
            <stop offset="100%" stopColor={color} stopOpacity={faint ? 0.1 : 0.12} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gid})`} stroke="none" />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {headX != null && (
          <line
            x1={headX}
            y1={0}
            x2={headX}
            y2={H}
            stroke="#fff"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            opacity={0.95}
          />
        )}
      </svg>
    </div>
  );
}
