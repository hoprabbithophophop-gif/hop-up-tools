import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

interface Props {
  /** 各時間ビンの総タップ数。長さ=ビン数。 */
  bins: number[];
  /** 1ビンあたりの秒数（横軸→秒の換算。RPCの bin_seconds）。 */
  binSeconds: number;
  /** 線・塗りの色（メンバーカラー or スペシャル回の色 / 通常は白・黒）。 */
  color: string;
  /** 再生中の現在位置を毎フレーム読むref。windowSeconds と併用で「中央固定＋波形スクロール」。 */
  liveTimeRef?: { current: number };
  /** SVGの高さ。px数 or CSS文字列（例 "clamp(46px,8.5dvh,84px)"）。 */
  height?: number | string;
  /** 再生中の動画下に薄く敷く用。淡くする。 */
  faint?: boolean;
  /** 見出しラベル（完走後EndCard用）。faint時は出さない。 */
  label?: string;
  /** 指定時：可視幅を windowSeconds 秒に固定し「中央固定プレイヘッド＋波形スクロール」表示。
   *  本編中の拡大表示用（EndCardは未指定＝曲全体・スクロールなし）。 */
  windowSeconds?: number;
  /** 自分のタップ時刻(秒)。みんなの波の上に推し色ドットで重ねる＝山の頂点に乗れたかが見える。 */
  selfTimestamps?: number[];
  /** 自分ドットの色（メンバーカラー）。 */
  selfColor?: string;
  /** チャートをタップでズーム(×1→×4→×8→×1)、ズーム中は横ドラッグで移動（EndCard用）。 */
  zoomable?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const H = 100;
const PAD = 2;

// 盛り上がりタイムライン。全員のタップを時間ビンに集計した山グラフ（YouTube「よく見られてるとこ」風）。
// 純SVG（群衆✋のPixiとは別系統）。本編中のスクロールは CSS transform を ref に直接書いて滑らかに動かす
// （viewBox 再描画＆毎フレームの React 再レンダーを避ける）。
export default function HeatmapChart({
  bins,
  binSeconds,
  color,
  liveTimeRef,
  height = 56,
  faint = false,
  label,
  windowSeconds,
  selfTimestamps,
  selfColor,
  zoomable = false,
}: Props) {
  const n = bins.length;

  // 軽い平滑化（3点加重平均）で波形をなめらかに。
  const smoothed = useMemo(() => {
    if (n < 3) return bins;
    return bins.map((_, i) => {
      const a = bins[i - 1] ?? bins[i];
      const b = bins[i];
      const c = bins[i + 1] ?? bins[i];
      return (a + 2 * b + c) / 4;
    });
  }, [bins, n]);

  // 全体表示(EndCard・windowSeconds未指定)はビンが多いとバーコード状になるので ~256 に間引き(平均)。
  // 本編の窓ズーム(scrolling)と、ズーム可(zoomable)＝拡大して見る前提のときは細かいまま使う。
  const displayBins = useMemo(() => {
    if (windowSeconds || zoomable || n <= 320) return smoothed;
    const target = 256;
    const group = Math.ceil(n / target);
    const out: number[] = [];
    for (let i = 0; i < n; i += group) {
      let s = 0, c = 0;
      for (let j = i; j < i + group && j < n; j++) { s += smoothed[j]; c++; }
      out.push(c ? s / c : 0);
    }
    return out;
  }, [smoothed, n, windowSeconds, zoomable]);
  const dN = displayBins.length;

  const max = useMemo(() => displayBins.reduce((m, v) => (v > m ? v : m), 0), [displayBins]);

  // 山パス（bin座標 x=0..dN）。1回だけ計算（スクロールは transform で動かす）。
  const { linePath, areaPath } = useMemo(() => {
    const m = max || 1;
    const pts = displayBins.map((v, i) => {
      const x = i + 0.5;
      const y = H - PAD - (v / m) * (H - PAD);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return {
      linePath: `M${pts.join(" L")}`,
      areaPath: `M0,${H} L${pts.join(" L")} L${dN},${H} Z`,
    };
  }, [displayBins, max, dN]);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);

  // --- タップズーム＋ドラッグ移動（zoomable=EndCard用）---
  // zoom: 表示倍率（トラック幅=zoom×100%）。viewStart: 可視窓の開始位置（全体に対する割合 0..1-1/zoom）。
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x0: number; vs0: number; moved: boolean } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { x0: e.clientX, vs0: viewStart, moved: false };
    // チャート外へ指が出てもドラッグを追い続ける。古い環境等で失敗しても操作自体は成立するので握りつぶす。
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (Math.abs(dx) > 6) d.moved = true;
    if (d.moved && zoom > 1) {
      const w = boxRef.current?.clientWidth || 1;
      // 指の移動量(px)を「全体に対する割合」へ換算（トラック幅=w×zoom）。指の向きに波形がついてくる。
      setViewStart(clamp(d.vs0 - dx / (w * zoom), 0, 1 - 1 / zoom));
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved) return; // ドラッグはズーム切替しない
    // タップ＝ズーム段階を進める（×1→×4→×8→×1）。タップ位置を新しい窓の中央に。
    const box = boxRef.current;
    const w = box?.clientWidth || 1;
    const fracInView = box ? (e.clientX - box.getBoundingClientRect().left) / w : 0.5;
    const absFrac = viewStart + fracInView / zoom;
    const nz = zoom === 1 ? 4 : zoom === 4 ? 8 : 1;
    setZoom(nz);
    setViewStart(nz === 1 ? 0 : clamp(absFrac - 0.5 / nz, 0, 1 - 1 / nz));
  };

  // 自分のタップのドット（推し色・白フチ）。波の高さに乗せる＝山の頂点に乗れたかが見える。
  // トラック内に%座標で置くのでズーム/ドラッグにそのまま追従し、ドット自体の大きさは変わらない。
  const totalSec = n * binSeconds;
  const selfDots = useMemo(() => {
    if (!selfTimestamps || !selfColor || totalSec <= 0 || dN === 0) return null;
    const m = max || 1;
    return selfTimestamps.map((t, i) => {
      const fx = clamp(t / totalSec, 0, 1);
      const v = displayBins[Math.min(dN - 1, Math.floor(fx * dN))];
      const fy = (H - PAD - (v / m) * (H - PAD)) / H;
      return (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${(fx * 100).toFixed(3)}%`,
            top: `${(fy * 100).toFixed(2)}%`,
            width: 7,
            height: 7,
            marginLeft: -3.5,
            marginTop: -3.5,
            borderRadius: "50%",
            background: selfColor,
            boxShadow: "0 0 0 1.5px #fff",
            pointerEvents: "none",
          }}
        />
      );
    });
  }, [selfTimestamps, selfColor, totalSec, dN, displayBins, max]);

  // 本編中（windowSeconds + liveTimeRef）＝中央固定プレイヘッド＋波形スクロール。
  // 毎フレーム ref に直接 transform/left を書く（React state を介さない＝再レンダー無し）。
  const scrolling = !!(liveTimeRef && windowSeconds && windowSeconds > 0 && binSeconds > 0);
  useEffect(() => {
    if (!scrolling || !liveTimeRef) return;
    const total = n * binSeconds;
    const span = Math.min(total, windowSeconds as number);
    const visBins = span / binSeconds;
    let raf = 0;
    const tick = () => {
      const t = liveTimeRef.current;
      // viewStart を [0, total-可視幅] にクランプ＝前半は左→中央、中盤は中央固定、終端は中央→右端。
      const viewStartSec = Math.max(0, Math.min(Math.max(0, total - span), t - span / 2));
      const viewX0bin = viewStartSec / binSeconds;
      const headXbin = t / binSeconds;
      if (trackRef.current) {
        trackRef.current.style.transform = `translateX(${(-(viewX0bin / n) * 100).toFixed(3)}%)`;
      }
      if (headRef.current) {
        headRef.current.style.left = `${(((headXbin - viewX0bin) / visBins) * 100).toFixed(3)}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scrolling, liveTimeRef, windowSeconds, binSeconds, n]);

  // データが無い（移行前・取得失敗・全0）なら何も描かない。
  if (n === 0 || max === 0) return null;

  const visBins = scrolling ? Math.min(n, (windowSeconds as number) / binSeconds) : n;
  const gid = `hi-heat-${Math.round(max)}-${n}-${faint ? "f" : "s"}`;

  const svg = (
    <svg
      viewBox={`0 0 ${dN} ${H}`}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      aria-hidden
      style={{ display: "block" }}
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
    </svg>
  );

  const heightStyle = typeof height === "number" ? `${height}px` : height;

  return (
    // 幅は親に従う（EndCard縦=カード幅360 / 横=動画と同じ幅。固定maxWidthだと横で動画とズレる）
    <div style={{ width: "100%" }}>
      {label && !faint && (
        <p
          style={{
            margin: "0 0 0.3rem",
            fontSize: "0.6875rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "#aab0b6",
            textAlign: "center",
          }}
        >
          {label}
        </p>
      )}
      {scrolling ? (
        // 可視窓（overflow hidden）の中で、全曲ぶんの幅を持つ track を transform で左へ流す。
        <div
          style={{
            position: "relative",
            width: "100%",
            height: heightStyle,
            overflow: "hidden",
            opacity: faint ? 0.7 : 1,
          }}
        >
          <div
            ref={trackRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: `${(dN / visBins) * 100}%`,
              willChange: "transform",
            }}
          >
            {svg}
          </div>
          {/* 中央固定の白いプレイヘッド（位置は ref で毎フレーム更新）。 */}
          <div
            ref={headRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: 2,
              marginLeft: -1,
              background: "#fff",
              opacity: 0.95,
              willChange: "left",
            }}
          />
        </div>
      ) : zoomable ? (
        // タップでズーム段階切替（×1→×4→×8→×1）・ズーム中は横ドラッグで移動。
        // 全曲ぶんのトラック（幅 zoom×100%）を transform で左へずらす（本編スクロールと同じ機構）。
        <div
          ref={boxRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { dragRef.current = null; }}
          style={{
            position: "relative",
            width: "100%",
            height: heightStyle,
            overflow: "hidden",
            opacity: faint ? 0.7 : 1,
            touchAction: "pan-y", // 縦スクロールは通し、横の操作だけこのチャートが受け取る
            cursor: zoom > 1 ? "grab" : "zoom-in",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: `${zoom * 100}%`,
              transform: `translateX(-${(viewStart * 100).toFixed(3)}%)`,
            }}
          >
            {svg}
            {selfDots}
          </div>
          {zoom > 1 && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: 1,
                right: 4,
                fontSize: "0.625rem",
                fontWeight: 700,
                color: "#999",
                pointerEvents: "none",
              }}
            >
              ×{zoom}
            </span>
          )}
        </div>
      ) : (
        <div style={{ position: "relative", width: "100%", height: heightStyle, opacity: faint ? 0.7 : 1 }}>
          {svg}
          {selfDots}
        </div>
      )}
    </div>
  );
}
