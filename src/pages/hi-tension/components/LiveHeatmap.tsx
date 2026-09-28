import { useEffect, useMemo, useRef } from "react";

interface Props {
  /** 各時間ビンの総タップ数。 */
  bins: number[];
  /** 1ビンあたりの秒数。 */
  binSeconds: number;
  /** 線・塗りの色（通常=白／スペシャル=主役メンカラ）。 */
  color: string;
  /** 現在位置を毎フレーム読むref。 */
  liveTimeRef: { current: number };
  /** 可視幅（秒）。中央固定プレイヘッド＋波形スクロールの窓幅。 */
  windowSeconds: number;
  /** CSS高さ（px数 or 文字列）。 */
  height?: number | string;
  /** 動画下に薄く敷く用。 */
  faint?: boolean;
}

// 本編中の盛り上がりタイムライン（Canvas）。可視範囲だけを毎フレーム描き直すので軽く、群衆(Pixi)に干渉せず滑らか。
// 動き：前半=白バー左→中央／中盤=白バー中央固定で波形が左へ流れる／終端=波形静止で白バー中央→右端。
// ビート毎のピーク（約0.37秒間隔）をハッキリ見せるため平滑化せず、細かいビン(0.1秒)をそのまま描く。
export default function LiveHeatmap({
  bins,
  binSeconds,
  color,
  liveTimeRef,
  windowSeconds,
  height = 56,
  faint = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const max = useMemo(() => bins.reduce((m, v) => (v > m ? v : m), 0), [bins]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || bins.length === 0 || max === 0 || binSeconds <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const n = bins.length;
    const total = n * binSeconds;
    const span = Math.min(total, windowSeconds);
    const m = max || 1;
    let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
    };
    resize();

    let raf = 0;
    const draw = () => {
      const cw = canvas.width;
      const ch = canvas.height;
      const pad = 2 * dpr;
      const t = liveTimeRef.current;
      // viewStart を [0, total-可視幅] にクランプ＝3フェーズが1式で出る。
      const viewStart = Math.max(0, Math.min(Math.max(0, total - span), t - span / 2));
      const xOf = (sec: number) => ((sec - viewStart) / span) * cw;
      const yOf = (v: number) => ch - pad - (v / m) * (ch - pad);

      ctx.clearRect(0, 0, cw, ch);

      const b0 = Math.max(0, Math.floor(viewStart / binSeconds) - 1);
      const b1 = Math.min(n - 1, Math.ceil((viewStart + span) / binSeconds) + 1);
      if (b1 < b0) { raf = requestAnimationFrame(draw); return; }

      // 塗り（縦グラデーション）
      ctx.beginPath();
      ctx.moveTo(xOf((b0 + 0.5) * binSeconds), ch);
      for (let i = b0; i <= b1; i++) ctx.lineTo(xOf((i + 0.5) * binSeconds), yOf(bins[i]));
      ctx.lineTo(xOf((b1 + 0.5) * binSeconds), ch);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, ch);
      grad.addColorStop(0, hexA(color, faint ? 0.55 : 0.75));
      grad.addColorStop(1, hexA(color, faint ? 0.1 : 0.12));
      ctx.fillStyle = grad;
      ctx.fill();

      // 線
      ctx.beginPath();
      for (let i = b0; i <= b1; i++) {
        const x = xOf((i + 0.5) * binSeconds);
        const y = yOf(bins[i]);
        if (i === b0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6 * dpr;
      ctx.lineJoin = "round";
      ctx.stroke();

      // 中央固定の白いプレイヘッド
      const hx = Math.round(xOf(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, ch);
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [bins, max, binSeconds, windowSeconds, color, faint, liveTimeRef]);

  if (bins.length === 0 || max === 0) return null;

  const heightStyle = typeof height === "number" ? `${height}px` : height;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ display: "block", width: "100%", maxWidth: 360, height: heightStyle, opacity: faint ? 0.85 : 1 }}
    />
  );
}

// "#rrggbb" + alpha → "rgba(...)"。color が rgb/名前でも fillStyle に渡せるよう、#hex のみ変換。
function hexA(color: string, a: number): string {
  const hex = color.replace("#", "");
  if (hex.length === 6 && /^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return color; // 想定外フォーマットはそのまま（alpha無し）
}
