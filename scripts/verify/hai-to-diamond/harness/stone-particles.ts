// 原石の版の「石のまわりの粒」と「削りかすの山」を、区切りごとに並べて描く見本。
// 石そのものはまだ無いので、中心に灰色の円を仮置きする。曲は流さず、時刻を手で進めて各場面の途中の姿を止めて描く。
// 描いた後、機械で測れる所（動画の四角に描いていない・山と文字が領域に収まる・放つ光に色が出ている）を測って window.__stoneCheck に置く。
// 撮影と合否の読み取りは check-stone-particles.mjs が行う。
import {
  createParticleState, updateAmbient, stepParticles, drawParticlesBehind, drawParticlesFront,
  emitChips, emitScatter, emitSpark, emitBurst, updateRays, type ParticleState,
} from "../../../../src/pages/hai-to-diamond/stone/stoneParticles";
import {
  createPileState, setPileTarget, startRain, stepPile, drawPile, pileLabel, type PileState,
} from "../../../../src/pages/hai-to-diamond/stone/stonePile";
import type { Rect, RGB, StoneView } from "../../../../src/pages/hai-to-diamond/stone/stoneTypes";
import type { SectionKey } from "../../../../src/pages/hai-to-diamond/stone/stoneTimeline";

const W = 360, H = 420, DPR = 2;
const BG = "#0b0c10";
// 確かめ用の色（名簿とは無関係の RGB だけ）
const C: RGB[] = [[218, 24, 132], [0, 160, 230], [253, 218, 36], [231, 0, 51], [32, 162, 57], [114, 99, 170]];
const view: StoneView = { cx: 180, cy: 190, r: 70, rotY: 0, rotX: 0.3, bulge: 1 };
const STONE_R = view.r * 1.2;
const FLOOR = 400;
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => results.push({ name, ok, detail });

function panel(title: string): { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement } {
  const fig = document.createElement("figure");
  const cap = document.createElement("figcaption");
  cap.textContent = title;
  const canvas = document.createElement("canvas");
  canvas.width = W * DPR; canvas.height = H * DPR;
  fig.append(cap, canvas);
  document.getElementById("grid")!.append(fig);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  return { ctx, canvas };
}
function offscreen(): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = W * DPR; c.height = H * DPR;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.setTransform(DPR, 0, 0, DPR, 0, 0);
  return x;
}
function drawStone(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.fillStyle = "#6c6c73";
  ctx.beginPath(); ctx.arc(view.cx, view.cy, STONE_R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#8a8a92"; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}
/** 粒の場面を1枚描く（石の裏→石→手前）。測る用に、透明な紙にも粒だけを描いて返す */
function drawScene(title: string, p: ParticleState, now: number, clip?: Rect): CanvasRenderingContext2D {
  const { ctx } = panel(title);
  if (clip) { ctx.fillStyle = "#1d2230"; ctx.fillRect(clip.x, clip.y, clip.w, clip.h); }
  drawParticlesBehind(ctx, p, now, clip);
  drawStone(ctx);
  drawParticlesFront(ctx, p, now, clip);
  const off = offscreen();
  drawParticlesBehind(off, p, now, clip);
  drawParticlesFront(off, p, now, clip);
  return off;
}
/** 区切りを t 秒ぶん進める。extra は毎コマ呼ばれる（💎の当たりなどを足す口） */
function sim(p: ParticleState, key: SectionKey, secDur: number, T: number, extra?: (t: number, now: number) => void, rm = false): number {
  const dt = 1 / 60;
  let now = 0;
  for (let t = 0; t < T; t += dt) {
    now = t * 1000;
    updateAmbient(p, key, Math.min(1, t / secDur), view, now, dt, rm);
    extra?.(t, now);
    stepParticles(p, now, dt, rm);
  }
  return now;
}
function alphaBox(x: CanvasRenderingContext2D): { n: number; x0: number; y0: number; x1: number; y1: number } {
  const d = x.getImageData(0, 0, W * DPR, H * DPR).data;
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let i = 3, k = 0; i < d.length; i += 4, k++) {
    if (d[i] === 0) continue;
    n++;
    const px = k % (W * DPR), py = (k / (W * DPR)) | 0;
    if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
  }
  return { n, x0: x0 / DPR, y0: y0 / DPR, x1: (x1 + 1) / DPR, y1: (y1 + 1) / DPR };
}
function alphaIn(x: CanvasRenderingContext2D, r: Rect): number {
  const d = x.getImageData(Math.round(r.x * DPR), Math.round(r.y * DPR), Math.round(r.w * DPR), Math.round(r.h * DPR)).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
}
function colorCount(x: CanvasRenderingContext2D, rgb: RGB): number {
  const d = x.getImageData(0, 0, W * DPR, H * DPR).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 60) continue;
    const a = d[i + 3] / 255;
    const r = d[i] / a, g = d[i + 1] / a, b = d[i + 2] / a;   // 透明な紙の色は前もって掛けてあるので戻す
    if (Math.abs(r - rgb[0]) < 40 && Math.abs(g - rgb[1]) < 40 && Math.abs(b - rgb[2]) < 40) n++;
  }
  return n;
}

// ───── 1. Aメロ（2本ずつの筋）
{
  const p = createParticleState();
  const now = sim(p, "verseA", 30, 4.15);
  const off = drawScene("verseA 光の筋 2本1組", p, now);
  check("Aメロの筋が描かれている", alphaBox(off).n > 200, String(alphaBox(off).n));
}
// ───── 2. 2番のAメロ
{
  const p = createParticleState();
  const now = sim(p, "verseA2", 15, 4.0);
  drawScene("verseA2 一段上（間隔が短い）", p, now);
}
// ───── 3. Bメロ
{
  const p = createParticleState();
  const now = sim(p, "verseB", 16, 6.0, undefined);
  const off = drawScene("verseB 回る粒・ときどき当たる", p, now);
  check("Bメロの回る粒が描かれている", alphaBox(off).n > 200, String(alphaBox(off).n));
}
// ───── 4. 2番のBメロ
{
  const p = createParticleState();
  const now = sim(p, "verseB2", 16, 6.0);
  drawScene("verseB2 一段上（粒が多い）", p, now);
}
// ───── 5. サビ（揃って当たった直後）
{
  const p = createParticleState();
  const now = sim(p, "chorus", 30, 4.32);
  const off = drawScene("chorus 揃って回り、揃って当たる", p, now);
  check("サビの揃った当たりで削りかすが出ている", p.chips.items.some((c) => c.alive), "");
  check("サビの場面が描かれている", alphaBox(off).n > 400, String(alphaBox(off).n));
}
// ───── 6. 間奏（飛び散り）
{
  const p = createParticleState();
  const now = sim(p, "interlude", 15, 0.4, (t, n) => { if (Math.abs(t - 0.05) < 0.009) emitScatter(p, view, 70, n, FLOOR); });
  drawScene("interlude 脈打ち・削りかすが飛び散る", p, now);
}
// ───── 7. ラップ（刻みの火花）＋エレピ（磨きの光の輪）
{
  const p = createParticleState();
  const pts = [[150, 160], [210, 175], [175, 220]];
  const now = sim(p, "rap", 15, 0.6, (t, n) => {
    pts.forEach(([x, y], i) => { if (Math.abs(t - (0.45 + i * 0.05)) < 0.009) emitSpark(p, x, y, "cut", n); });
  });
  drawScene("rap 刻んだ瞬間の火花", p, now);
  const q = createParticleState();
  const now2 = sim(q, "epiano", 15, 1.0, (t, n) => {
    pts.forEach(([x, y], i) => { if (Math.abs(t - (0.5 + i * 0.15)) < 0.009) emitSpark(q, x, y, "polish", n); });
  });
  drawScene("epiano 磨いた瞬間の光の輪", q, now2);
}
// ───── 8. 完成の瞬間に放つ光
{
  const p = createParticleState();
  updateAmbient(p, "finalChorus", 0.1, view, 0, 0, false);
  const src: { x: number; y: number; rgb: RGB | null; white: boolean }[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, rr = STONE_R * (i % 2 ? 0.75 : 0.45);
    const kind = i % 4;   // 0,1,2=色 / 3=白（色は6色を順に）。null の面も混ぜる
    src.push({ x: view.cx + Math.cos(a) * rr, y: view.cy + Math.sin(a) * rr * 0.8, rgb: kind === 3 ? null : C[i % 6], white: kind === 3 });
  }
  src.push({ x: view.cx, y: view.cy - 10, rgb: null, white: false });   // 染まっていない面（出さない）
  emitBurst(p, src, 0, false);
  stepParticles(p, 450, 0.016, false);
  const off = drawScene("burst 面の色の帯＋白の✦", p, 450);
  check("放つ光に色が出ている（ピンク系の帯）", colorCount(off, C[0]) > 50, String(colorCount(off, C[0])));
  check("放つ光に色が出ている（青系の帯）", colorCount(off, C[1]) > 50, String(colorCount(off, C[1])));
}
// ───── 9. 大サビの光の柱
{
  const p = createParticleState();
  for (let i = 0; i <= 90; i++) updateRays(p, view, 212 + i / 60, i * 1000 / 60, true);   // 伸び切った所（4秒周期の半分）
  for (let i = 90; i <= 120; i++) updateRays(p, view, 214, i * 1000 / 60, true);
  const off = drawScene("rays 上へ伸びる淡い光の柱", p, 2000);
  const b = alphaBox(off);
  check("光の柱が石の上へ伸びている", b.y0 < view.cy - STONE_R * 1.5, JSON.stringify(b));
}
// ───── 10. 後奏のきらめき
{
  const p = createParticleState();
  const now = sim(p, "outro", 17, 4.0);
  drawScene("outro きらめきの粒", p, now);
}
// ───── 11. 💎の当たりの削りかす（常時）
{
  const p = createParticleState();
  const now = sim(p, "verseA", 30, 1.2, (t, n) => {
    for (let i = 0; i < 6; i++) if (Math.abs(t - (0.2 + i * 0.15)) < 0.009) emitChips(p, 130 + i * 20, 170 + (i % 3) * 20, C[i], 7, n, FLOOR);
  });
  const off = drawScene("💎の当たり 削りかすが落ちて床で消える", p, now);
  check("削りかすに当たった色が出ている", colorCount(off, C[4]) + colorCount(off, C[0]) > 10, String(colorCount(off, C[4]) + colorCount(off, C[0])));
}
// ───── 12. 動画の四角に描かない（clip）
{
  const p = createParticleState();
  const clip: Rect = { x: 40, y: 150, w: 280, h: 100 };
  const now = sim(p, "verseB2", 16, 5.0, (t, n) => {
    if (Math.abs(t - 4.7) < 0.009) { emitScatter(p, view, 60, n, FLOOR); emitChips(p, 180, 190, C[1], 9, n, FLOOR); }
  });
  const off = drawScene("clip 動画の四角（紺）には描かない", p, now, clip);
  const inside = alphaIn(off, { x: clip.x + 0.5, y: clip.y + 0.5, w: clip.w - 1, h: clip.h - 1 });
  check("動画の四角の中は1点も描いていない", inside === 0 && alphaBox(off).n > 100, `inside=${inside} total=${alphaBox(off).n}`);
}

// ───── 山
function pileScene(title: string, n: number, region: Rect, tSec: number, rm: boolean, colors: { rgb: RGB; weight: number }[]): PileState {
  const st = createPileState();
  setPileTarget(st, n, region);
  startRain(st, 0, rm);
  const dt = 1 / 60;
  let now = 0;
  for (let t = 0; t < tSec; t += dt) { now = t * 1000; stepPile(st, now, dt); }
  const { ctx } = panel(title);
  ctx.strokeStyle = "rgba(120,140,200,0.5)"; ctx.setLineDash([4, 4]);
  ctx.strokeRect(region.x - 0.5, region.y - 0.5, region.w + 1, region.h + 1);   // 領域の枠（見本だけ）
  ctx.setLineDash([]);
  drawPile(ctx, st, now, region, DPR, colors);
  const off = offscreen();
  drawPile(off, st, now, region, DPR, colors);
  const b = alphaBox(off);
  const tol = 0.5;
  check(`${title}: 山と文字が領域に収まる`, b.n > 0 && b.x0 >= region.x - tol && b.y0 >= region.y - tol && b.x1 <= region.x + region.w + tol && b.y1 <= region.y + region.h + tol, JSON.stringify(b));
  const lab = pileLabel(st, region, now);
  check(`${title}: 文言は「N個」だけ`, !!lab && /^\d{1,3}(,\d{3})*個$/.test(lab.text), lab?.text ?? "null");
  if (lab) {
    const box = { x: Math.max(region.x, lab.x - 20), y: Math.max(region.y, lab.y - lab.fontPx), w: 40, h: lab.fontPx };
    const d = off.getImageData(Math.round(box.x * DPR), Math.round(box.y * DPR), Math.round(box.w * DPR), Math.round(box.h * DPR)).data;
    let white = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) white++;
    check(`${title}: 「N個」の白い文字が描かれている`, white > 20, String(white));
  }
  return st;
}
const colors = [
  { rgb: C[0], weight: 5 }, { rgb: C[1], weight: 3 }, { rgb: C[2], weight: 2 }, { rgb: C[3], weight: 2 }, { rgb: C[4], weight: 1 }, { rgb: C[5], weight: 1 },
];
const portrait: Rect = { x: 10, y: 170, w: 340, h: 240 };
pileScene("rain 降り注ぎの途中（3秒）", 270000, portrait, 3.0, false, colors);
pileScene("pile 出来上がり 270,000", 270000, portrait, 7.5, false, colors);
pileScene("pile 1人（n=1・色1つ）", 1, portrait, 7.5, false, [{ rgb: C[0], weight: 1 }]);
pileScene("pile 動きを減らす設定（1.5秒で完成）", 270000, portrait, 1.5, true, colors);
pileScene("pile 横長の山の領域（wide）", 270000, { x: 0, y: 320, w: 360, h: 95 }, 7.5, false, colors);
pileScene("pile 1兆個（はみ出さない）", 1e12, portrait, 7.5, false, colors);

(window as unknown as Record<string, unknown>).__stoneCheck = {
  ok: results.filter((r) => r.ok).length,
  ng: results.filter((r) => !r.ok).length,
  results,
};
