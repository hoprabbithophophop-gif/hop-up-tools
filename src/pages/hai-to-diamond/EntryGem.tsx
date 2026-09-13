// 入口の「歴代累計」の横に置く💎。本編と同じ本物の描き方（gemRenderer.ts）で焼いた、いま選んでいる色の絵を使う。
// 以前は白の平らな面の絵（FacetGem）で、本編と画風が違っていた（Hop指摘 2026-09-14）。
// 入口はその色が焼き上がってから開くので、ここで焼き待ちは起きない（Hop案 2026-09-14「描画完了した自分色の💎にするのは」）。
// 焼けない端末（本物の描き方が使えない）では今までの平らな絵のまま。
// アニメは隣り合う2枚の焼いた絵をクロスフェードで繋いでいる。焼いてあるのは24姿勢だけなので、
// 1枚ずつ切り替えるとパラパラ漫画のようにカクついていた（Hop指摘 2026-09-14）
import { useEffect, useRef } from "react";
import FacetGem from "./FacetGem";
import { hexToRgb } from "./gemFacets";
import { getStoneSprites, stonesSettled, stoneIndex, TUMBLE_FRAMES, FACE_ON_ANG } from "./gemSprites";

const ENTRY_PATH = 3;            // 使う転がり方の通り道。3番＝倒す角72度±44度で1周1回転。正面に近い姿勢を長く見せる【仮】
const ENTRY_TURN_MS = 9000;      // 1周にかける時間(ms)【仮】。入口は静かな画面なのでゆっくり

interface Props {
  /** 1辺の大きさ(css px) */
  size: number;
  /** 💎の色（hex）。いま選んでいる色 */
  color: string;
  /** true の間、石をゆっくり転がす。false は正面に近い姿勢で止める */
  animate?: boolean;
}

export default function EntryGem({ size, color, animate = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rgb = hexToRgb(color);
  // 本物の絵があるか。無ければ（焼けない端末）平らな絵へ下りる。焼き待ちの間も平らな絵だが、入口はその色が焼けてから開く
  const real = stonesSettled([color]) ? getStoneSprites(rgb) : null;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !real) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    const draw = (ang: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(real[stoneIndex(ang, ENTRY_PATH)], 0, 0, size, size);
    };
    if (!animate) { draw(FACE_ON_ANG[ENTRY_PATH]); return; }
    // 焼いてある姿勢は24枚だけなので、毎フレーム隣り合う2枚をクロスフェードして繋ぎ、
    // なめらかに転がって見えるようにする（1枚ずつの切り替えは375msごとのカクつきになる）
    const frame = (i: number) => real[stoneIndex((i / TUMBLE_FRAMES) * Math.PI * 2, ENTRY_PATH)];
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) / ENTRY_TURN_MS) % 1;
      const pos = t * TUMBLE_FRAMES;
      const i0 = Math.floor(pos) % TUMBLE_FRAMES;
      const i1 = (i0 + 1) % TUMBLE_FRAMES;
      const f = pos - Math.floor(pos);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.globalAlpha = 1 - f;
      ctx.drawImage(frame(i0), 0, 0, size, size);
      ctx.globalAlpha = f;
      ctx.drawImage(frame(i1), 0, 0, size, size);
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size, animate, real]);
  if (!real) return <FacetGem size={size} color={color} animate={animate} />;
  // data-entry-gem: 再生開始時にこの💎の画面上の位置を測って、そこから動画へ飛ばす目印（HaiToDiamondPage側で参照）
  return <canvas ref={canvasRef} data-entry-gem="1" aria-hidden="true" style={{ width: size, height: size, display: "block" }} />;
}
