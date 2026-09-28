// 面付きの💎を1つ、canvas で描く部品。入口の大きな💎ボタンで使う。
import { useEffect, useRef } from "react";
import { hexToRgb, paintFacets } from "./gemFacets";

const MAX_DPR = 2;             // 描く画面の細かさの上限。DiamondCanvas.tsx と同じ考え方（発熱対策）
const LIGHT_SPEED = 0.35;      // 光の向きが1秒に回る角度（rad/s）【仮】。DiamondCanvas.tsx の瞬きと合わせた速さ
const FIXED_LIGHT_ANGLE = -Math.PI / 3; // animate=false の時の固定の光の向き（左上から）

interface Props {
  /** canvas の1辺の大きさ(px) */
  size: number;
  /** 💎の色 */
  color: string;
  /** true の間、光の向きをゆっくり回して面が順番に瞬くようにする */
  animate?: boolean;
}

export default function FacetGem({ size, color, animate = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const rgb = hexToRgb(color);

    const draw = (lightAng: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(size / 2, size / 2);
      ctx.scale((size / 2) * 0.95, (size / 2) * 0.95);
      paintFacets(ctx, rgb, 0, lightAng);
      ctx.restore();
    };

    if (!animate) {
      draw(FIXED_LIGHT_ANGLE);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      draw(((now - start) / 1000) * LIGHT_SPEED);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size, color, animate]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ width: size, height: size, display: "block" }}
    />
  );
}
