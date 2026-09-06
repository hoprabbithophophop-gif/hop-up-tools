// 💎が降り、その面の向きに光の筋が伸びて動画の額縁を照らすキャンバス。
//
// 描く場所のルール（YouTube API 規約）: 動画プレイヤーの上には何も描かない。
// このキャンバスは動画の裏（z-index 下）に置き、さらに描画時に動画の矩形を
// クリップで除外する二重の守りにしている。額縁（動画の周りの帯）と床だけを照らす。
//
// 回転は正面から見た時計の針の動き（平面回転）。光の筋は針と同じ向きに伸び、
// 360度どこを向いても、その先の額縁（下辺・左右）に当たった所が灯る。
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { faGem } from "@fortawesome/free-solid-svg-icons";

export type DiamondCanvasApi = {
  /** 額縁の直下から、キャンバス座標 x の位置に💎を1つ降らせる */
  spawn: (x: number) => void;
};

interface Props {
  /** 動画本体（16:9の箱）の要素。毎フレーム位置を測って額縁と除外範囲を決める */
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
};

const GRAVITY = 260; // px/s^2 【仮】本番の落下速度は要調整
const MAX_GEMS = 40;
const GEM_SIZE = 16;

// Font Awesome Free Solid "gem" (CC BY 4.0)。帰属表示はページのフッターに記載。
function buildGemPath(): { path: Path2D; w: number; h: number } {
  const [w, h, , , d] = faGem.icon;
  const p = Array.isArray(d) ? d.join(" ") : d;
  return { path: new Path2D(p), w, h };
}

const DiamondCanvas = forwardRef<DiamondCanvasApi, Props>(function DiamondCanvas({ videoBoxRef, frame }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gemsRef = useRef<Gem[]>([]);
  const reduceMotionRef = useRef(false);

  useImperativeHandle(ref, () => ({
    spawn(x: number) {
      const canvas = canvasRef.current;
      const box = videoBoxRef.current;
      if (!canvas || !box) return;
      const cr = canvas.getBoundingClientRect();
      const vr = box.getBoundingClientRect();
      const frameBottom = vr.bottom - cr.top + frame;
      const gems = gemsRef.current;
      gems.push({
        x,
        y: frameBottom + GEM_SIZE,
        vy: 0,
        ang: Math.random() * Math.PI * 2,
        spin: (Math.random() < 0.5 ? -1 : 1) * (2.2 + Math.random() * 1.4),
        size: GEM_SIZE,
      });
      if (gems.length > MAX_GEMS) gems.shift();
    },
  }), [videoBoxRef, frame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const gem = buildGemPath();

    try {
      reduceMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch { /* ignore */ }

    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

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
      const floorTop = f.y + f.h;

      // 額縁の地色
      ctx.fillStyle = "#1a1d24";
      ctx.fillRect(f.x, f.y, f.w, f.h);

      const gems = gemsRef.current;
      for (let i = gems.length - 1; i >= 0; i--) {
        const g = gems[i];
        g.vy += GRAVITY * dt;
        g.y += g.vy * dt;
        if (!reduceMotionRef.current) g.ang += g.spin * dt;
        if (g.y > H + 40) gems.splice(i, 1);
      }
      if (gems.length === 0) return;

      // 光：動画の矩形だけを除外して描く
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(v.x, v.y, v.w, v.h);
      ctx.clip("evenodd");
      ctx.globalCompositeOperation = "lighter";
      const len = Math.hypot(W, H);
      for (const g of gems) {
        const life = 1 - Math.min(1, (g.y - floorTop) / Math.max(1, H - floorTop)); // 床の下ほど弱く
        const k = life;
        if (k <= 0.01) continue;
        const dir = g.ang;                                          // 針の向き＝光の向き（360度）
        const cos = Math.cos(dir), sin = Math.sin(dir);
        const ex = g.x + cos * len, ey = g.y + sin * len;
        const grad = ctx.createLinearGradient(g.x, g.y, ex, ey);
        grad.addColorStop(0, `rgba(255,255,255,${0.35 * k})`);
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 6 + 10 * k;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(g.x, g.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        // 額縁に当たった所を灯す。下辺・左辺・右辺のうち、針の先が最初に届く所。
        let hit: { x: number; y: number } | null = null;
        let best = Infinity;
        if (sin < 0) {                                              // 上向き → 下辺
          const t = (floorTop - g.y) / sin;
          const hx = g.x + cos * t;
          if (t > 0 && t < best && hx >= f.x && hx <= f.x + f.w) { best = t; hit = { x: hx, y: floorTop }; }
        }
        for (const edgeX of [f.x, f.x + f.w]) {                     // 左右の辺（額縁の高さの範囲）
          if (cos === 0) continue;
          const t = (edgeX - g.x) / cos;
          const hy = g.y + sin * t;
          if (t > 0 && t < best && hy >= f.y && hy <= floorTop) { best = t; hit = { x: edgeX, y: hy }; }
        }
        if (hit) {
          const rg = ctx.createRadialGradient(hit.x, hit.y, 0, hit.x, hit.y, 60);
          rg.addColorStop(0, `rgba(255,255,255,${0.8 * k})`);
          rg.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = rg;
          ctx.fillRect(hit.x - 60, hit.y - 60, 120, 120);
        }
      }
      ctx.restore();

      // 💎本体。針と同じ向きに平面回転する
      for (const g of gems) {
        const s = g.size * 2.2;
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.ang + Math.PI / 2);                            // 宝石の先端が針の向きを指す
        ctx.scale(s / gem.w, s / gem.h);
        ctx.translate(-gem.w / 2, -gem.h / 2);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fill(gem.path);
        ctx.restore();
      }
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
