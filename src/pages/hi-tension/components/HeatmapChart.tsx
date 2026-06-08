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
  /** 指定時：現在地が属する windowSeconds 秒ブロックだけをズーム表示し、windowSeconds 秒ごとに次へページ送り。
   *  本編中の拡大表示用（EndCardは未指定＝曲全体）。 */
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

  // データが無い（移行前・取得失敗・全0）なら何も描かない。
  if (n === 0 || max === 0) return null;

  const headSec = liveTimeRef ? liveSec : (currentTime ?? null);

  // 表示区間（窓）。windowSeconds 指定時は現在地が属する windowSeconds 秒ブロックだけをズームし、
  // windowSeconds 秒ごとに次のブロックへページ送り（連続スクロールではなくカクッと切替）。
  let viewBins = bins;
  let viewStartSec = 0;
  let viewSpanSec = n * binSeconds;
  if (windowSeconds && windowSeconds > 0 && headSec != null && binSeconds > 0) {
    const ws = Math.max(0, Math.floor(headSec / windowSeconds) * windowSeconds);
    const startBin = Math.min(n - 1, Math.max(0, Math.round(ws / binSeconds)));
    const endBin = Math.min(n, startBin + Math.max(1, Math.round(windowSeconds / binSeconds)));
    viewBins = bins.slice(startBin, endBin);
    viewStartSec = ws;
    viewSpanSec = windowSeconds;
  }
  const vN = viewBins.length;
  if (vN === 0) return null;

  const W = vN; // viewBox幅＝表示ビン数（preserveAspectRatio none で横いっぱいに引き伸ばす）
  const H = 100;
  const pad = 2;

  // 山の頂点列。高さは「全体の最大値」で正規化＝窓を切り替えても高さの意味が一定。
  const pts = viewBins.map((v, i) => {
    const x = i + 0.5;
    const y = H - pad - (v / max) * (H - pad);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const linePath = `M${pts.join(" L")}`;
  const areaPath = `M0,${H} L${pts.join(" L")} L${W},${H} Z`;

  // 現在位置の縦線。窓表示中は窓内の進捗、全体表示中は曲全体の位置。
  const cx =
    headSec != null && viewSpanSec > 0
      ? Math.max(0, Math.min(W, ((headSec - viewStartSec) / viewSpanSec) * W))
      : null;

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const rangeLabel = windowSeconds ? `${fmtTime(viewStartSec)} – ${fmtTime(viewStartSec + viewSpanSec)}` : null;

  const gid = `hi-heat-${Math.round(max)}-${vN}`;

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
        {cx != null && (
          <line
            x1={cx}
            y1={0}
            x2={cx}
            y2={H}
            stroke="#fff"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            opacity={0.95}
          />
        )}
      </svg>
      {rangeLabel && (
        <p
          style={{
            margin: "0.15rem 0 0",
            fontSize: "0.625rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            color: "#fff",
            textAlign: "center",
            textShadow: "0 1px 2px rgba(0,0,0,0.6)",
          }}
        >
          {rangeLabel}
        </p>
      )}
    </div>
  );
}
