// 「原石の版」の石の描き方（stone/stoneRender.ts）を、曲を通さずに1枚の絵で見る見本。
// 横に 削れ0 / 0.3 / 0.7 / 1 / 透明 / 頭サビの透け の6姿、縦に回転の角度を変えた2段を並べる。
// 2段目の「削れ1」の姿には動画の矩形に見立てたクリップを置き、その中に何も描かれないことを見る。
// 描いた後、向き・的選びの簡単な確かめを window.__stonePreview に置く（撮る側が読む）。
import { buildStoneMesh, morphVertices } from "../../../../src/pages/hai-to-diamond/stone/stoneGeometry";
import { drawStone, drawStoneGhost, pickTargetFace, projectFaceCenter } from "../../../../src/pages/hai-to-diamond/stone/stoneRender";
import type { FaceState, RGB, StoneView } from "../../../../src/pages/hai-to-diamond/stone/stoneTypes";

const mesh = buildStoneMesh(1);
const nF = mesh.faces.length;
// ?big=回転角 を付けると、その角度の原石（削れ0）だけを大きく1つ描く（細部の確かめ用）
const BIG = new URLSearchParams(location.search).get("big");
const PANEL = BIG ? 600 : 260, COLS = BIG ? 1 : 6, ROWS = BIG ? 1 : 2;
const canvas = document.getElementById("c") as HTMLCanvasElement;
canvas.width = PANEL * COLS; canvas.height = PANEL * ROWS;
const ctx = canvas.getContext("2d")!;
const L = (() => { const v = [-0.45, 0.7, 0.55]; const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l] as [number, number, number]; })();
// 見本の色（どのメンバーの色でもない、確かめ用の3色）
const SAMPLE: RGB[] = [[231, 0, 51], [253, 218, 36], [0, 150, 220]];
const WIN = 0.12; // 見本の中での、1枚の面が削れ始めてから削れ終わるまでの幅【仮】

function stateAt(F: number, clear: boolean): FaceState {
  const st: FaceState = { cut: new Float32Array(nF), color: new Array(nF).fill(null), glow: new Float32Array(nF), own: new Uint8Array(nF), clear };
  for (let f = 0; f < nF; f++) {
    st.cut[f] = Math.max(0, Math.min(1, (F - mesh.faces[f].cutRank) / WIN));
    if (st.cut[f] > 0.3 && f % 3 === 0) st.color[f] = SAMPLE[f % SAMPLE.length];
    if (st.cut[f] > 0.3 && f % 11 === 0) st.own[f] = 1;
    if (st.cut[f] > 0.3 && f % 13 === 5) st.glow[f] = 0.8;
  }
  return st;
}
const allCols: { label: string; F: number; clear: boolean; ghost?: boolean }[] = [
  { label: "cut 0", F: 0, clear: false },
  { label: "cut 0.3", F: 0.3, clear: false },
  { label: "cut 0.7", F: 0.7, clear: false },
  { label: "cut 1", F: 1.2, clear: false },
  { label: "clear", F: 1.2, clear: true },
  { label: "ghost", F: 0, clear: false, ghost: true },
];
const cols = BIG ? allCols.slice(0, 1) : allCols;
const verts = new Float32Array(mesh.fine.length);
const rows = BIG ? [Number(BIG)] : [0.35, 1.25];
rows.forEach((rotY, ri) => {
  cols.forEach((c, ci) => {
    const view: StoneView = { cx: ci * PANEL + PANEL / 2, cy: ri * PANEL + PANEL / 2 + 8, r: (PANEL * 0.4) / mesh.roughRadius, rotY, rotX: 0.45, bulge: 1 };
    const st = stateAt(c.F, c.clear);
    morphVertices(mesh, st.cut, verts);
    const clip = ri === 1 && ci === 3 ? { x: view.cx - 30, y: view.cy - 110, w: 60, h: 90 } : undefined;
    drawStone(ctx, mesh, verts, st, view, { now: 1000, reduceMotion: false, light: L, clip });
    if (c.ghost) drawStoneGhost(ctx, mesh, view, 0.55, { now: 1000, reduceMotion: false, light: L });
    if (clip) { ctx.strokeStyle = "rgba(255,80,80,0.9)"; ctx.setLineDash([4, 3]); ctx.strokeRect(clip.x, clip.y, clip.w, clip.h); ctx.setLineDash([]); }
    ctx.fillStyle = "#888"; ctx.font = "12px sans-serif"; ctx.fillText(`${c.label}  rotY ${rotY}`, ci * PANEL + 8, ri * PANEL + 16);
  });
});

// 簡単な確かめ
const view0: StoneView = { cx: 200, cy: 200, r: 100, rotY: 0, rotX: 0.45, bulge: 1 };
const fTable = mesh.faces.findIndex((f) => f.kind === "table"), fCulet = mesh.faces.findIndex((f) => f.kind === "culet");
const pT = { x: 0, y: 0, depth: 0, front: false }, pC = { x: 0, y: 0, depth: 0, front: false };
projectFaceCenter(mesh, mesh.fine, fTable, view0, pT);
projectFaceCenter(mesh, mesh.fine, fCulet, view0, pC);
const full = stateAt(1.2, false), none = stateAt(0, false);
let seed = 3; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const picks = new Set<number>();
for (let i = 0; i < 200; i++) picks.add(pickTargetFace(mesh, mesh.fine, full, view0, "uncolored", rng));
// projectFaceCenter の front と pickTargetFace の判定が一致する: 選ばれた面はすべて front、front の面はいつか選ばれる
const anyPicks = new Set<number>();
for (let i = 0; i < 3000; i++) anyPicks.add(pickTargetFace(mesh, mesh.fine, full, view0, "any", rng));
const fronts = new Set<number>();
const pp = { x: 0, y: 0, depth: 0, front: false };
for (let f = 0; f < nF; f++) { projectFaceCenter(mesh, mesh.fine, f, view0, pp); if (pp.front) fronts.add(f); }
const frontMatchesPick = anyPicks.size === fronts.size && [...anyPicks].every((f) => fronts.has(f));
const allColored = stateAt(1.2, false); for (let f = 0; f < nF; f++) allColored.color[f] = SAMPLE[0];
// 裏返りの確かめ: rotX に大きすぎる値を渡しても、尖りが上に来ない
const pC2 = { x: 0, y: 0, depth: 0, front: false }, pT2 = { x: 0, y: 0, depth: 0, front: false };
projectFaceCenter(mesh, mesh.fine, fCulet, { ...view0, rotX: 3.0 }, pC2);
projectFaceCenter(mesh, mesh.fine, fTable, { ...view0, rotX: 3.0 }, pT2);
// 速さ: 毎コマ相当（形の更新＋描画）を 300 回
const off = document.createElement("canvas"); off.width = 400; off.height = 400;
const octx = off.getContext("2d")!;
const mid = stateAt(0.5, false), clr = stateAt(1.2, true);
let t0 = performance.now();
for (let i = 0; i < 300; i++) { morphVertices(mesh, mid.cut, verts); drawStone(octx, mesh, verts, mid, { ...view0, rotY: i * 0.02 }, { now: i * 16, reduceMotion: false, light: L }); }
const msOpaque = (performance.now() - t0) / 300;
morphVertices(mesh, clr.cut, verts);
t0 = performance.now();
for (let i = 0; i < 300; i++) drawStone(octx, mesh, verts, clr, { ...view0, rotY: i * 0.02 }, { now: i * 16, reduceMotion: false, light: L });
const msClear = (performance.now() - t0) / 300;
(window as unknown as Record<string, unknown>).__stonePreview = {
  tableAboveCulet: pT.y < pC.y,
  tableFront: pT.front,
  culetBack: !pC.front,
  frontMatchesPick,
  frontCount: fronts.size,
  tableNearerThanCulet: pT.depth > pC.depth,
  flipGuard: pT2.y < pC2.y,
  pickCount: picks.size,
  pickNoneWhenUncut: pickTargetFace(mesh, mesh.rough, none, view0, "uncolored", rng) === -1,
  pickUncoloredOnly: [...picks].every((f) => f >= 0 && full.color[f] === null),
  pickFallbackWhenAllColored: pickTargetFace(mesh, mesh.fine, allColored, view0, "uncolored", rng) >= 0,
  msOpaque: +msOpaque.toFixed(3),
  msClear: +msClear.toFixed(3),
};
