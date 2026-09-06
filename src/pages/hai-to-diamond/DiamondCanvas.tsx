// 💎が上から降って画面の下に積もり、曲が進むとカメラが引いて山が動画の背景になるキャンバス。
//
// 描く場所のルール（YouTube API 規約）: 動画プレイヤーの上には何も描かない。
// このキャンバスは動画の裏（z-index 下）に置き、光の類は描画時に動画の矩形をクリップで除外する。
// 💎そのものは動画の裏を通る（隠れる）だけで、動画の上には出ない。
//
// 世界座標: カメラ倍率1のときの画面座標と同じ。y は画面上端=0 で下へ正。
// 床は画面の下（見えない所）にあり、カメラは動画の中心を基準に縮む＝動画は動かず周りだけ縮む。
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type DiamondCanvasApi = {
  /** その色の💎を1つ、画面の上から降らせる。速さ・回転の向きと速さは1つずつ違う */
  spawn: (color: string) => void;
  /** 曲の進み 0..1。カメラの引きに使う */
  setProgress: (p: number) => void;
};

interface Props {
  /** 動画本体（16:9の箱）の要素。毎フレーム位置を測る */
  videoBoxRef: React.RefObject<HTMLElement | null>;
  /** 額縁の太さ(px) */
  frame: number;
}

type Gem = {
  x: number;
  y: number;
  vy: number;
  ang: number;
  spin: number;
  size: number;
  rgb: [number, number, number];
  settled: boolean;
  seed: number;
};

// 【仮】見本の値。実機で見て決める
const GRAVITY = 60;            // px/s^2（世界座標）
const FALL_SPEED_MIN = 40;     // 初速 px/s
const FALL_SPEED_RANGE = 90;
const SPIN_MIN = 0.6;          // rad/s
const SPIN_RANGE = 3.2;
const SIZE_MIN = 22;
const SIZE_RANGE = 14;
const MIN_SCALE = 0.5;         // 曲の終わりのカメラ倍率
const FLOOR_DEPTH = 1.5;       // 床の位置（画面高さの倍数）
const COL_W = 10;              // 積もり高さの帳簿の列幅
const MAX_GEMS = 4000;

// 宝石の面（Font Awesome gem の外形に合わせた 5+3 面）。座標は -1..1。n は擬似的な法線
type Facet = { pts: [number, number][]; n: [number, number, number] };
const FACETS: Facet[] = [
  { pts: [[-0.55, -0.35], [-0.9, 0], [-0.3, 0]], n: [-0.7, -0.3, 0.65] },
  { pts: [[-0.55, -0.35], [0, -0.35], [-0.3, 0]], n: [-0.25, -0.6, 0.76] },
  { pts: [[-0.3, 0], [0, -0.35], [0.3, 0]], n: [0, -0.45, 0.9] },
  { pts: [[0.55, -0.35], [0, -0.35], [0.3, 0]], n: [0.25, -0.6, 0.76] },
  { pts: [[0.55, -0.35], [0.9, 0], [0.3, 0]], n: [0.7, -0.3, 0.65] },
  { pts: [[-0.9, 0], [-0.3, 0], [0, 0.9]], n: [-0.55, 0.5, 0.67] },
  { pts: [[-0.3, 0], [0.3, 0], [0, 0.9]], n: [0, 0.35, 0.94] },
  { pts: [[0.9, 0], [0.3, 0], [0, 0.9]], n: [0.55, 0.5, 0.67] },
].map((f) => {
  const l = Math.hypot(f.n[0], f.n[1], f.n[2]);
  return { pts: f.pts as [number, number][], n: [f.n[0] / l, f.n[1] / l, f.n[2] / l] as [number, number, number] };
});

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  if (!Number.isFinite(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const DiamondCanvas = forwardRef<DiamondCanvasApi, Props>(function DiamondCanvas({ videoBoxRef, frame }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gemsRef = useRef<Gem[]>([]);
  const progressRef = useRef(0);
  const sizeRef = useRef({ W: 0, H: 0 });
  const camRef = useRef({ scale: 1, cx: 0, cy: 0 });

  useImperativeHandle(ref, () => ({
    spawn(color: string) {
      const { W } = sizeRef.current;
      const { scale, cx } = camRef.current;
      if (!W) return;
      const size = SIZE_MIN + Math.random() * SIZE_RANGE;
      // いま見えている範囲の横幅に散らす（引くほど広がる）
      const visibleHalf = (W / 2) / scale;
      const x = cx + (Math.random() * 2 - 1) * visibleHalf * 0.94;
      const gems = gemsRef.current;
      gems.push({
        x,
        y: -size * 2,
        vy: FALL_SPEED_MIN + Math.random() * FALL_SPEED_RANGE,
        ang: Math.random() * Math.PI * 2,
        spin: (Math.random() < 0.5 ? -1 : 1) * (SPIN_MIN + Math.random() * SPIN_RANGE),
        size,
        rgb: hexToRgb(color),
        settled: false,
        seed: Math.random() * 1000,
      });
      if (gems.length > MAX_GEMS) gems.shift();
    },
    setProgress(p: number) {
      progressRef.current = Math.max(0, Math.min(1, p));
    },
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0, dpr = 1;
    let floorY = 0, worldX0 = 0, worldW = 0;
    const cols: number[] = [];
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      sizeRef.current = { W, H };
      floorY = H * FLOOR_DEPTH;
      worldW = W / MIN_SCALE;
      worldX0 = W / 2 - worldW / 2;
      const n = Math.ceil(worldW / COL_W) + 1;
      while (cols.length < n) cols.push(floorY);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const colTop = (ci: number, half: number) => {
      let top = Infinity;
      for (let j = ci - half; j <= ci + half; j++) if (j >= 0 && j < cols.length) top = Math.min(top, cols[j]);
      return top;
    };

    const drawGem = (g: Gem, lightAng: number) => {
      const L: [number, number, number] = [Math.cos(lightAng - g.ang), Math.sin(lightAng - g.ang), 0.8];
      const ll = Math.hypot(L[0], L[1], L[2]);
      L[0] /= ll; L[1] /= ll; L[2] /= ll;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.ang);
      ctx.scale(g.size, g.size);
      for (const f of FACETS) {
        const d = Math.max(0, f.n[0] * L[0] + f.n[1] * L[1] + f.n[2] * L[2]);
        const k = 0.35 + 0.65 * d * d;
        ctx.fillStyle = `rgb(${(g.rgb[0] * k) | 0},${(g.rgb[1] * k) | 0},${(g.rgb[2] * k) | 0})`;
        ctx.beginPath();
        ctx.moveTo(f.pts[0][0], f.pts[0][1]);
        ctx.lineTo(f.pts[1][0], f.pts[1][1]);
        ctx.lineTo(f.pts[2][0], f.pts[2][1]);
        ctx.closePath();
        ctx.fill();
        // 面がちょうど光を返す瞬間だけ白く瞬く
        if (d > 0.965) {
          ctx.fillStyle = `rgba(255,255,255,${((d - 0.965) / 0.035) * 0.95})`;
          ctx.fill();
        }
      }
      ctx.lineWidth = 0.06;
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.moveTo(-0.55, -0.35); ctx.lineTo(0.55, -0.35); ctx.lineTo(0.9, 0); ctx.lineTo(0, 0.9); ctx.lineTo(-0.9, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    };

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const box = videoBoxRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!box) return;

      const cr = canvas.getBoundingClientRect();
      const vr = box.getBoundingClientRect();
      const v = { x: vr.left - cr.left, y: vr.top - cr.top, w: vr.width, h: vr.height };
      const f = { x: v.x - frame, y: v.y - frame, w: v.w + frame * 2, h: v.h + frame * 2 };
      const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
      const p = progressRef.current;
      const scale = 1 - (1 - MIN_SCALE) * p * p;
      camRef.current = { scale, cx, cy };

      // 物理（世界座標）。塔にならないよう、低い方へ転がって山になる
      const gems = gemsRef.current;
      for (const g of gems) {
        if (g.settled) continue;
        g.vy += GRAVITY * dt;
        g.y += g.vy * dt;
        g.ang += g.spin * dt;
        const ci = Math.max(0, Math.min(cols.length - 1, Math.round((g.x - worldX0) / COL_W)));
        const half = Math.max(1, Math.round((g.size * 0.8) / COL_W));
        const top = colTop(ci, half);
        if (g.y + g.size * 0.8 < top) continue;
        let bestJ = ci, bestTop = top;
        for (const d of [-1, 1]) {
          for (let k = half + 1; k <= half * 3; k++) {
            const j = ci + d * k;
            if (j < 0 || j >= cols.length) continue;
            const t = colTop(j, half);
            if (t > bestTop + g.size * 0.9) { bestTop = t; bestJ = j; }
          }
        }
        if (bestJ !== ci) {
          g.x += (bestJ - ci) * COL_W * (0.6 + Math.random() * 0.4);
          g.vy = Math.max(g.vy * 0.4, 25);
          g.y = Math.min(g.y, top - g.size * 0.8);
        } else {
          g.y = top - g.size * 0.8;
          g.settled = true;
          for (let j = ci - half; j <= ci + half; j++) {
            if (j >= 0 && j < cols.length) cols[j] = Math.min(cols[j], g.y - g.size * 0.35 + Math.abs(j - ci) * COL_W * 0.5);
          }
        }
      }

      // 額縁の地色（画面座標・カメラの外）
      ctx.fillStyle = "#1a1d24";
      ctx.fillRect(f.x, f.y, f.w, f.h);

      if (gems.length === 0) return;
      const lightAng = (now / 1000) * 0.35; // 全体の光の向きをゆっくり回す＝山の面が順番に瞬く

      // 光（画面座標）: 💎のまわりの小さな輪。動画の裏を通っている間は、いちばん近い額縁の辺を灯す。
      // どちらも動画の矩形を除外して描く
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(v.x, v.y, v.w, v.h);
      ctx.clip("evenodd");
      ctx.globalCompositeOperation = "lighter";
      for (const g of gems) {
        if (g.settled) continue;
        const sx = cx + (g.x - cx) * scale, sy = cy + (g.y - cy) * scale;
        const r = g.size * scale * 1.6;
        const [cr_, cg, cb] = g.rgb;
        const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        halo.addColorStop(0, `rgba(${cr_},${cg},${cb},0.35)`);
        halo.addColorStop(1, `rgba(${cr_},${cg},${cb},0)`);
        ctx.fillStyle = halo;
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
        // 動画の裏を通っている？
        if (sx > v.x && sx < v.x + v.w && sy > v.y && sy < v.y + v.h) {
          const dl = sx - v.x, dr = v.x + v.w - sx, dtp = sy - v.y, db = v.y + v.h - sy;
          const m = Math.min(dl, dr, dtp, db);
          const hit = m === dl ? { x: v.x, y: sy } : m === dr ? { x: v.x + v.w, y: sy } : m === dtp ? { x: sx, y: v.y } : { x: sx, y: v.y + v.h };
          const reach = 90 * scale;
          const k = Math.max(0, 1 - m / Math.max(1, Math.min(v.w, v.h) / 2)) * 0.9;
          const rg = ctx.createRadialGradient(hit.x, hit.y, 0, hit.x, hit.y, reach);
          rg.addColorStop(0, `rgba(255,255,255,${0.5 * k})`);
          rg.addColorStop(0.3, `rgba(${cr_},${cg},${cb},${0.55 * k})`);
          rg.addColorStop(1, `rgba(${cr_},${cg},${cb},0)`);
          ctx.fillStyle = rg;
          ctx.fillRect(hit.x - reach, hit.y - reach, reach * 2, reach * 2);
        }
      }
      ctx.restore();

      // 💎本体（世界座標をカメラで縮めて描く）
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
      for (const g of gems) {
        drawGem(g, g.settled ? lightAng + Math.sin((now / 1000) * 0.9 + g.seed) * 0.6 : lightAng);
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [videoBoxRef, frame]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", pointerEvents: "none" }}
    />
  );
});

export default DiamondCanvas;
