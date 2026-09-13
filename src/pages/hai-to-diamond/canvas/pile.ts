// 💎が降って積もる山。落下・積もり高さの帳簿・焼き込み・山のきらめきをここに集めた。
// DiamondCanvas.tsx から切り出しただけで、中身は変えていない。
import { getStoneSprites, stoneIndex } from "../gemSprites";

export type Gem = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number;
  spin: number;
  /** 飛び方の通り道（0〜TUMBLE_PATHS-1）。💎ごとに抽選して、その💎の一生の間は変わらない。
   *  ang がその通り道のどこまで進んだかを表し、倒れ具合と回りが一緒に変わる＝転がって見える */
  path: number;
  /** 画面の上での向き(rad)。💎ごとにばらばらに寝かせる＝みんなが同じ姿勢で降りてこない */
  roll: number;
  size: number;
  rgb: [number, number, number];
  settled: boolean;
  seed: number;
  /** 着地先（世界座標）。降る前に決めて、隙間なく詰まる位置へはめ込む */
  tx: number;
  ty: number;
};

// 【仮】見本の値。実機で見て決める
const GRAVITY = 60;            // px/s^2（世界座標）
export const FALL_SPEED_MIN = 40;     // 初速 px/s
export const FALL_SPEED_RANGE = 90;
export const SPIN_MIN = 0.6;          // rad/s
export const SPIN_RANGE = 3.2;
export const SIZE_MIN = 16;
export const SIZE_RANGE = 8;
export const MIN_SCALE = 0.3;         // いちばん引いた時のカメラ倍率【仮】
export const FINALE_END_SCALE = 0.7;  // 曲の終わりの倍率【仮】。0.3から一気に1まで寄ると急なので途中で止める
// 数が増えるほど💎を小さくする（ハイ！テンションで人が増えると✋が縮むのと同じ考え・Hop決定 2026-09-06）。
// SHRINK_REF 個までは等倍、それ以降は個数の平方根に反比例して縮み、SHRINK_MIN で止まる【仮】
export const SHRINK_REF = 400;
export const SHRINK_MIN = 0.6;          // 縮みすぎると面の影で黒っぽく見えるので、この辺で止める
export const COUNT_REF = 120;         // この数を超えたら、降った数の平方根に反比例してカメラを引く【仮】
export const FINALE_TIME = 206;       // 動画時刻 3:26（曲が一番盛り上がる所）からゆっくり寄り始める（Hop指定 2026-09-06。Live Edit. でも同じ所で良いとHop確認 2026-09-07）
export const FLOOR_DEPTH = 1.0;       // 床の位置（画面高さの倍数）。カメラの軸が床なので 1.0＝画面の下端が床
export const PILE_MAX_ON_SCREEN = 0.7; // 山の頂上が画面のこの高さ（画面高さの倍数）を超えたら、床を画面の下へ送り出して頂上をこの線に留める。
                                // 終盤に寄った時、山が画面をはみ出すと降ってくる💎が画面の外で着地して見えなくなる（Hop報告 2026-09-07）【仮】
                                // 寄りそのものを抑える方式は、山が大きいと最大の引きより引いてしまい両端に帯状の空白ができた（Hop報告 2026-09-07・2回目）
export const MAX_DPR = 2;             // 描く画面の細かさの上限。3倍の端末で画素が2.25倍になり発熱の元になる。焼き込みの絵と同じ上限【仮】
const COL_W = 10;              // 積もり高さの帳簿の列幅
const PACK_RADIUS = 0.6;       // 積もり計算で💎を丸い粒とみなす時の半径（size 倍）。見た目の半径(約1.0)より小さくして深く重ねる＝「ぎっしり」【仮】
const SLOPE = 0.06;            // 山の傾き。小さいほど平らで、瓶に詰めるように下から隙間なく埋まる【仮】
const NEAR_SPAWN = 0.5;        // 散らした位置の近くに落とす強さ。小さいと一番低い所（引いた直後は画面の端）に集まり、動画の周りが寂しくなる【仮】
const OUTSIDE_SLOPE = 1.5;     // 画面の端より外へ 1px 出るごとに、積もり高さ何px分の損と数えるか＝端の外の裾野の急さ【仮】
const MAX_GEMS = 4000;         // 配列に持つ💎の上限（焼き込みの絵が作れない環境での保険）
const LIVE_KEEP = 300;         // 1つずつ描き続ける積もった💎の数（山の表面ぶん）。それより古いものは後ろの絵へ焼き込む
const BAKE_BATCH = 200;        // 1フレームで焼き込む上限（一度に大量に描いて引っかからないように）
const BAKE_HEIGHT = 2.0;       // 焼き込み用の絵の高さ（画面高さの倍数・床から上へ）
const BAKE_MAX_AREA = 12e6;    // 焼き込み用の絵の画素数の上限（iOS Safari の1枚あたりの限界より下）

// 積もった💎も落ちてくる💎も、毎フレーム面を計算せず、色×石の向きごとに一度焼いた小さな絵(スプライト)を貼る。
// 数千個積もっても drawImage の回数が増えるだけで、絵を作る計算は増えない（重さ対策）。
// 絵の作り置きと焼く順番は gemSprites.ts が持つ。ここは受け取って貼るだけ。
// 落ちている💎の光の輪と、動画の裏を通る時の額縁の灯りも、色ごとに一度だけ描いた絵を貼る。
// 毎フレーム createRadialGradient を作るのは1個ごとに重く、大勢の💎が降る時に効く（発熱対策 2026-09-07）
const GLOW_PX = 64;
const glowCache = new Map<string, { halo: HTMLCanvasElement; edge: HTMLCanvasElement }>();
function getGlow(rgb: [number, number, number]): { halo: HTMLCanvasElement; edge: HTMLCanvasElement } {
  const key = rgb.join(",");
  let g = glowCache.get(key);
  if (g) return g;
  const [r, gg, b] = rgb;
  const make = (stops: [number, string][]) => {
    const c = document.createElement("canvas");
    c.width = GLOW_PX; c.height = GLOW_PX;
    const cx = c.getContext("2d");
    if (cx) {
      const grad = cx.createRadialGradient(GLOW_PX / 2, GLOW_PX / 2, 0, GLOW_PX / 2, GLOW_PX / 2, GLOW_PX / 2);
      for (const [o, col] of stops) grad.addColorStop(o, col);
      cx.fillStyle = grad;
      cx.fillRect(0, 0, GLOW_PX, GLOW_PX);
    }
    return c;
  };
  g = {
    halo: make([[0, `rgba(${r},${gg},${b},0.35)`], [1, `rgba(${r},${gg},${b},0)`]]),
    edge: make([[0, "rgba(255,255,255,0.5)"], [0.3, `rgba(${r},${gg},${b},0.55)`], [1, `rgba(${r},${gg},${b},0)`]]),
  };
  glowCache.set(key, g);
  return g;
}

/** 山まわりで持ち回る控え。毎コマ作り直さず、中身だけ書き換える。
 *  cols[c] は列 c の積もった高さ(px)＝地形。
 *  焼き込み用の絵（世界座標そのまま・1px=1px）。上限を超えた古い💎はここへ描き移して配列から外す。
 *  以前は古い順に配列から消していたので、帳簿の高さはそのままなのに山が床側からくり抜かれて宙に浮いた */
export type PileState = {
  cols: number[];
  bake: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; x0: number; y0: number; w: number; h: number } | null;
  floorY: number;
  worldX0: number;
  worldW: number;
};
export function createPileState(): PileState {
  return { cols: [], bake: null, floorY: 0, worldX0: 0, worldW: 0 };
}
/** 画面の大きさが変わった時に、世界の寸法と帳簿の長さを合わせ直す */
export function resizePile(st: PileState, W: number, H: number) {
  st.floorY = H * FLOOR_DEPTH;
  st.worldW = W / MIN_SCALE;
  st.worldX0 = W / 2 - st.worldW / 2;
  const n = Math.ceil(st.worldW / COL_W) + 1;
  while (st.cols.length < n) st.cols.push(0);
}

/** 降っている💎: 自分の向きに合う絵を選んで、回さずに貼る。
 *  光は画面に対して止まっているので、石が回れば面が順番に光る＝絵を回してはいけない。
 *  毎フレーム面を塗るのは、みんなの💎がたくさん降る時に発熱の元になっていた（Hop報告 2026-09-07） */
export function drawGemLive(
  ctx: CanvasRenderingContext2D,
  g: Pick<Gem, "x" | "y" | "ang" | "path" | "roll" | "size" | "rgb">,
) {
  const sprites = getStoneSprites(g.rgb);
  const w = (g.size * 2 / 0.95);
  const img = sprites[stoneIndex(g.ang, g.path)];
  if (!g.roll) { ctx.drawImage(img, g.x - w / 2, g.y - w / 2, w, w); return; }
  // 画面の上で寝かせる分だけ絵ごと回す。光も一緒に回るが、💎ごとに向きが決まっていて
  // 途中で変わらないので、その石はその向きから照らされているように見える
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.rotate(g.roll);
  ctx.drawImage(img, -w / 2, -w / 2, w, w);
  ctx.restore();
}
/** 積もった💎: スプライトを貼る */
export function drawGemSettled(g: Gem, target: CanvasRenderingContext2D) {
  const sprites = getStoneSprites(g.rgb);
  const i = stoneIndex(g.ang, g.path);
  const w = (g.size * 2 / 0.95) * 1.12;              // 少し大きめに貼って継ぎ目の隙間を埋める【仮】
  if (!g.roll) {
    target.drawImage(sprites[i], g.x - w / 2, g.y - w / 2, w, w);
  } else {
    target.save();
    target.translate(g.x, g.y);
    target.rotate(g.roll);
    target.drawImage(sprites[i], -w / 2, -w / 2, w, w);
    target.restore();
  }
  // 山の瞬きは十字の閃光（flashes）に統一。ここでは点を打たない（Hop指摘 2026-09-06）
}
/** 積もった💎のうち新しい LIVE_KEEP 個を残し、古い順に焼き込み用の絵へ描き移して配列から外す。
 *  止まった💎は動かないのに毎フレーム1つずつ貼り直すのが、長い曲でスマホが熱くなる主因だった（Hop報告 2026-09-07） */
export function bakeOldest(st: PileState, gems: Gem[], count: number, H: number, dpr: number) {
  if (!st.bake) {
    // 画面の細かさ(dpr)に合わせた解像度で焼く。1px=1pxだと寄った時に写真部分だけぼやける。画素数の上限内に収める
    const bw = st.worldW, bh = H * BAKE_HEIGHT;
    const res = Math.min(dpr, 2, Math.sqrt(BAKE_MAX_AREA / (bw * bh)));
    const c = document.createElement("canvas");
    c.width = Math.ceil(bw * res);
    c.height = Math.ceil(bh * res);
    const bctx = c.getContext("2d");
    if (!bctx) { gems.splice(0, gems.length - MAX_GEMS); return; } // 絵が作れない環境では従来どおり消す
    st.bake = { canvas: c, ctx: bctx, x0: st.worldX0, y0: st.floorY - bh, w: bw, h: bh };
    bctx.scale(res, res);
    bctx.translate(-st.bake.x0, -st.bake.y0);
  }
  let n = 0;
  const limit = Math.min(count, BAKE_BATCH);
  for (let i = 0; i < gems.length && n < limit; i++) {
    const g = gems[i];
    if (!g.settled || g.y - g.size < st.bake.y0) continue; // 絵の枠より上に積もった分は1つずつ描き続ける
    drawGemSettled(g, st.bake.ctx);
    gems.splice(i, 1);
    i--;
    n++;
  }
}

// 着地先の割り当て。cols[c] は列 c の積もった高さ(px)＝地形。
// 💎を半径 R の丸い粒として、「その列に落としたら地形のどこで止まるか（中心の高さ hc）」を
// 粒の下側が地形に触れる条件から求める。いま見えている横幅の中で、止まる高さ hc が一番低い列を選ぶ
// （中心からの距離と散らした位置で軽く重み付け）＝瓶に砂を入れるように下から隙間なく埋まる。
// 以前は候補を見えている列に限り、土台を「隣の列の一番高い所」にしていたので、カメラが引いて
// 新しく見えた端の1列に💎が縦に積み上がって塔になり、次の列はその塔の肩に乗る…の連鎖で
// 山の底辺が斜めに削れて空洞ができていた（Hop指摘 2026-09-07）。
function restHeight(cols: number[], c: number, R: number): number {
  const hc = Math.ceil(R / COL_W);
  let h = 0;
  for (let j = c - hc; j <= c + hc; j++) {
    const dx = (j - c) * COL_W;
    if (Math.abs(dx) > R) continue;
    const ground = j >= 0 && j < cols.length ? cols[j] : 0;
    const v = ground + Math.sqrt(R * R - dx * dx);
    if (v > h) h = v;
  }
  return h;
}
export function allocSlot(
  st: PileState, x: number, size: number, scale: number, self: boolean, W: number, camCx: number,
): { tx: number; ty: number } {
  const cols = st.cols;
  const worldX0 = st.worldX0, floorY = st.floorY;
  const cx = camCx || W / 2;
  const visibleCols = (W / 2) / scale / COL_W;
  const cC = (x - worldX0) / COL_W; // 押した位置ではなく散らした位置を中心の目安に使う（山が偏らない）
  const cMid = (cx - worldX0) / COL_W;
  const R = size * PACK_RADIUS;
  let best = 0, bestScore = Infinity, bestH = 0;
  // 候補は見えている範囲に限らず世界の全列。範囲の外は「端から離れるほど損」にして、
  // 端に塔が立つ代わりに裾野が外へ伸びる（カメラが引くと裾野が見えて、そこが埋まっていく）。
  // 自分の💎だけは必ず画面の中に落とす（押した手応えと閃光が見えなくなるのを防ぐ）
  for (let c = 0; c < cols.length; c++) {
    const off = Math.abs(c - cMid) - visibleCols;
    if (self && off > 0) continue;
    const h = restHeight(cols, c, R);
    const outside = Math.max(0, off) * COL_W * OUTSIDE_SLOPE;
    const score = h + outside + Math.abs(c - cMid) * COL_W * SLOPE + Math.abs(c - cC) * COL_W * NEAR_SPAWN + Math.random() * size * 0.4;
    if (score < bestScore) { bestScore = score; best = c; bestH = h; }
  }
  // 止まった粒の上側の丸みを地形に足す
  const hc = Math.ceil(R / COL_W);
  for (let j = best - hc; j <= best + hc; j++) {
    if (j < 0 || j >= cols.length) continue;
    const dx = (j - best) * COL_W;
    if (Math.abs(dx) > R) continue;
    cols[j] = Math.max(cols[j], bestH + Math.sqrt(R * R - dx * dx));
  }
  const ty = floorY - bestH;
  const tx = worldX0 + best * COL_W + (Math.random() - 0.5) * COL_W * 0.6;
  return { tx, ty };
}

/** 落下（世界座標）: 着地先まで落ちて止まる。横には流れない（着地先が最初から詰まる位置なので） */
export function stepFall(
  gems: Gem[], dt: number, reduceMotion: boolean,
  sparkPoints: { x: number; y: number; rgb: [number, number, number]; size: number }[],
) {
  for (const g of gems) {
    if (g.settled) continue;
    g.vy += GRAVITY * dt;
    g.y += g.vy * dt;
    if (!reduceMotion) g.ang += g.spin * dt;
    if (g.y >= g.ty) {
      g.y = g.ty; g.settled = true; g.vx = 0;
      sparkPoints.push({ x: g.x, y: g.y, rgb: g.rgb, size: g.size });
    }
  }
}

/** 山の見た目ぜんぶ。光の輪・💎本体・山のきらめき・閃光 */
export function drawPile(
  ctx: CanvasRenderingContext2D, st: PileState, gems: Gem[],
  sparkPoints: { x: number; y: number; rgb: [number, number, number]; size: number }[],
  flashes: { x: number; y: number; t0: number; rgb: [number, number, number]; size: number }[],
  W: number, H: number, dpr: number, v: { x: number; y: number; w: number; h: number },
  cx: number, scale: number, oy: number, p: number, dt: number, now: number, reduceMotion: boolean,
) {
  if (gems.length === 0) return;
  const floorY = st.floorY;

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
    const sx = cx + (g.x - cx) * scale, sy = H + oy + (g.y - floorY) * scale;
    const r = g.size * scale * 1.6;
    const glow = getGlow(g.rgb);
    ctx.drawImage(glow.halo, sx - r, sy - r, r * 2, r * 2);
    // 動画の裏を通っている？
    if (sx > v.x && sx < v.x + v.w && sy > v.y && sy < v.y + v.h) {
      const dl = sx - v.x, dr = v.x + v.w - sx, dtp = sy - v.y, db = v.y + v.h - sy;
      const m = Math.min(dl, dr, dtp, db);
      const hit = m === dl ? { x: v.x, y: sy } : m === dr ? { x: v.x + v.w, y: sy } : m === dtp ? { x: sx, y: v.y } : { x: sx, y: v.y + v.h };
      const reach = 90 * scale;
      const k = Math.max(0, 1 - m / Math.max(1, Math.min(v.w, v.h) / 2)) * 0.9;
      ctx.globalAlpha = k;   // 灯りの強さは色の濃さの掛け算なので、絵を1枚にして全体の透明度で代える
      ctx.drawImage(glow.edge, hit.x - reach, hit.y - reach, reach * 2, reach * 2);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  // 💎本体（世界座標をカメラで縮めて描く。軸は床＝画面の下端、横は動画の中心）
  ctx.save();
  ctx.translate(cx, H + oy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -floorY);
  let settledCount = 0;
  for (const g of gems) if (g.settled) settledCount++;
  if (settledCount > LIVE_KEEP) bakeOldest(st, gems, settledCount - LIVE_KEEP, H, dpr);
  else if (gems.length > MAX_GEMS) bakeOldest(st, gems, gems.length - MAX_GEMS, H, dpr);
  if (st.bake) ctx.drawImage(st.bake.canvas, st.bake.x0, st.bake.y0, st.bake.w, st.bake.h);
  for (const g of gems) {
    if (g.settled) drawGemSettled(g, ctx);
    else drawGemLive(ctx, g);
  }
  // 山のきらめき: 積もった💎（焼き込んだ分も含む）からランダムに1つ選び、押した時と同じ閃光を出す。
  // 画面の外や動画の裏にある💎を選んでも見えないので、画面内のものが当たるまで数回引き直す（Hop報告 2026-09-07）。
  // 曲が進むほど頻度が上がり、最後の山で一番ピカピカする【仮: 毎秒 0.5〜6回】。動き軽減では出さない（飾りなので）
  if (!reduceMotion) {
    const pts = sparkPoints;
    if (pts.length > 0) {
      const rate = 0.5 + 5.5 * p * p;
      if (Math.random() < rate * dt) {
        for (let tries = 0; tries < 12; tries++) {
          const pt = pts[Math.floor(Math.random() * pts.length)];
          const sx = cx + (pt.x - cx) * scale, sy = H + oy + (pt.y - floorY) * scale;
          if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
          if (sx > v.x && sx < v.x + v.w && sy > v.y && sy < v.y + v.h) continue;
          flashes.push({ x: pt.x, y: pt.y, t0: now, rgb: pt.rgb, size: pt.size * 0.8 });
          break;
        }
      }
    }
  }
  // 閃光: 白い芯＋その色の輪が広がって消える（約320ms）。押した手応えの分は動き軽減でも出す
  if (flashes.length) {
    ctx.globalCompositeOperation = "lighter";
    for (let i = flashes.length - 1; i >= 0; i--) {
      const fl = flashes[i];
      const k = (now - fl.t0) / 320;
      if (k >= 1) { flashes.splice(i, 1); continue; }
      const r = fl.size * (1.2 + 2.6 * k);
      const a = 1 - k;
      const rg = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, r);
      rg.addColorStop(0, `rgba(255,255,255,${0.95 * a})`);
      rg.addColorStop(0.35, `rgba(${fl.rgb[0]},${fl.rgb[1]},${fl.rgb[2]},${0.7 * a})`);
      rg.addColorStop(1, `rgba(${fl.rgb[0]},${fl.rgb[1]},${fl.rgb[2]},0)`);
      ctx.fillStyle = rg;
      ctx.fillRect(fl.x - r, fl.y - r, r * 2, r * 2);
      // 十字の光条
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * a})`;
      ctx.lineWidth = 2 / Math.max(scale, 0.01);
      const L = fl.size * (2 + 3 * k);
      ctx.beginPath();
      ctx.moveTo(fl.x - L, fl.y); ctx.lineTo(fl.x + L, fl.y);
      ctx.moveTo(fl.x, fl.y - L); ctx.lineTo(fl.x, fl.y + L);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
}
