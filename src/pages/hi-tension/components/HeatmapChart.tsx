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

  // データが無い（移行前・取得失敗・全0）なら何も描かない。
  if (n === 0 || max === 0) return null;

  const W = n; // viewBox幅＝ビン数（preserveAspectRatio none で横いっぱいに引き伸ばす）
  const H = 100; // viewBox高さ（実ピクセルは height）
  const pad = 2; // 上の余白

  // 山の頂点列。スムーズに見せるため値はそのまま折れ線で結ぶ（256点なら十分滑らか）。
  const pts = bins.map((v, i) => {
    const x = i + 0.5;
    const y = H - pad - (v / max) * (H - pad);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const linePath = `M${pts.join(" L")}`;
  const areaPath = `M0,${H} L${pts.join(" L")} L${W},${H} Z`;

  // 現在位置の縦線（再生中のみ）。liveTimeRef があればそちらを優先。
  const headSec = liveTimeRef ? liveSec : currentTime;
  const cx =
    headSec != null && binSeconds > 0
      ? Math.max(0, Math.min(W, headSec / binSeconds))
      : null;

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
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        aria-hidden
        style={{ display: "block", opacity: faint ? 0.55 : 1 }}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={faint ? 0.5 : 0.75} />
            <stop offset="100%" stopColor={color} stopOpacity={faint ? 0.08 : 0.12} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gid})`} stroke="none" />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={faint ? 1.2 : 1.6}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {cx != null && (
          <line
            x1={cx}
            y1={0}
            x2={cx}
            y2={H}
            stroke="#fff"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            opacity={0.9}
          />
        )}
      </svg>
    </div>
  );
}
