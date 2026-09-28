// 平らな面で描く、今までの💎。面の形のデータはこの1ファイルだけが持つ。
// DiamondCanvas.tsx にあった同じ写しは消して、こちらを読むようにした（2026-09-10）。
//
// いま2通りの描き方が並んでいる理由:
//   本物の描き方（gemRenderer.ts）… 屈折・全反射・分散まで計算する。落ちてくる💎と積もった💎はこちらへ差し替え済み
//   こちらの描き方              … 次の2つの居場所がまだ残っている
//     1. 入口の大きな💎（FacetGem.tsx）。本物への差し替えは次の工程で行う
//     2. WebGL が使えない端末での代わり。💎が消えて遊べなくなるより、見た目が古い方がまし
//
// 宝石の面（Font Awesome gem の外形に合わせた 5+3 面）。座標は -1..1。n は擬似的な法線
export type Facet = { pts: [number, number][]; n: [number, number, number] };
export const FACETS: Facet[] = [
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

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  if (!Number.isFinite(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 面ごとの明るさを計算して 2D コンテキストに宝石を描く（座標は宝石中心・半径1） */
export function paintFacets(ctx: CanvasRenderingContext2D, rgb: [number, number, number], ang: number, lightAng: number) {
  const L: [number, number, number] = [Math.cos(lightAng - ang), Math.sin(lightAng - ang), 0.8];
  const ll = Math.hypot(L[0], L[1], L[2]);
  L[0] /= ll; L[1] /= ll; L[2] /= ll;
  for (const f of FACETS) {
    const d = Math.max(0, f.n[0] * L[0] + f.n[1] * L[1] + f.n[2] * L[2]);
    const k = 0.5 + 0.5 * d * d;   // 影の側も暗くしすぎない（小さい💎が黒っぽく見えないように）
    ctx.fillStyle = `rgb(${(rgb[0] * k) | 0},${(rgb[1] * k) | 0},${(rgb[2] * k) | 0})`;
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
}
