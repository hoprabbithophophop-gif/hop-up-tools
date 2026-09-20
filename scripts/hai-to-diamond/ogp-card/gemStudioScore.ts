/* =============================================================================
 * 【使い捨て】石の映え方を機械で採点する
 *
 * 人に良し悪しを聞かない。石の絵と向きから測れる数だけで点を付ける。
 * 見ている所は、宝石の世界で昔から言われている3つの見どころに合わせてある。
 *   明るさ   … 白い光をどれだけ返しているか
 *   きらめき … 明暗の粒と境目がどれだけ入り混じっているか
 *   火       … 光が虹に割れた色の点がどれだけ出ているか
 * そこへ、この絵に固有の2つを足す。
 *   その色だと分かるか … 石の部分の平均の色が、元の色の色合いから離れていないか
 *   底の尖りが見えるか … 向きから計算する
 *
 * 採点は石の絵だけで行う。背景と文字は別の話として外で見る。
 * ========================================================================== */

import { renderGem, type StudioLight, type Sparkle } from "./gemStudioRenderer";
import { linearToOklab, labToLch, toLinear, hexToLinear, type Rgb } from "./gemStudioColor";

export type Quat = [number, number, number, number];
export type DrawLight = { dir: [number, number, number]; intensity: number; radius: number };
export type Draw = {
  seed: number;
  quat: Quat;
  roll2dDeg: number;
  lights: DrawLight[];
  /** いまの置き場所からのずらし */
  dx: number;
  dy: number;
  /** 背景のにじみの散らし方 */
  glowSeed: number;
};

/* ---------------------------------------------------------------------------
 * 種から引く
 * ------------------------------------------------------------------------ */
function rngOf(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** どの向きも同じ出やすさになる引き方。偏りが出ないことが分かっている決まった式 */
function uniformQuat(r: () => number): Quat {
  const u1 = r();
  const u2 = r();
  const u3 = r();
  const s1 = Math.sqrt(1 - u1);
  const s2 = Math.sqrt(u1);
  return [
    s1 * Math.sin(2 * Math.PI * u2),
    s1 * Math.cos(2 * Math.PI * u2),
    s2 * Math.sin(2 * Math.PI * u3),
    s2 * Math.cos(2 * Math.PI * u3),
  ];
}
function anglesToDir(az: number, el: number): [number, number, number] {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  const c = Math.cos(e);
  return [c * Math.cos(a), c * Math.sin(a), Math.sin(e)];
}

/** 種ひとつから、向き・絵ごとの回し・3灯・置き場所のずらしを全部引く。
 *  同じ種からは必ず同じものが出る */
export function drawFromSeed(seed: number, radii: number[]): Draw {
  const r = rngOf(seed);
  const quat = uniformQuat(r);
  const roll2dDeg = Math.round((r() * 360 - 180) * 10) / 10;
  const lights: DrawLight[] = [];
  for (let i = 0; i < 3; i++) {
    const az = Math.round(r() * 360 - 180);
    const el = Math.round(r() * 180 - 90);
    const intensity = Math.round(r() * 200) / 100;
    lights.push({ dir: anglesToDir(az, el), intensity, radius: radii[i] ?? 0.1 });
  }
  return {
    seed,
    quat,
    roll2dDeg,
    lights,
    dx: Math.round((r() - 0.5) * 80),
    dy: Math.round((r() - 0.5) * 80),
    glowSeed: 1 + Math.floor(r() * 9999),
  };
}

export function quatToRows(q: Quat): number[] {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const x = q[0] / l, y = q[1] / l, z = q[2] / l, w = q[3] / l;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

/* ---------------------------------------------------------------------------
 * 測る
 * ------------------------------------------------------------------------ */
export type Metrics = {
  brightness: number;
  scintillation: number;
  fire: number;
  identity: number;
  culet: number;
  /** 尖りが画面でどれだけ下を向いているか。0 が水平、1 が真下 */
  culetDown: number;
};

const SCORE_PX = 96;
let scoreCv: HTMLCanvasElement | null = null;

/** 石の絵を、採点のための小さな絵として1枚描く。
 *  sparkle を渡すと、画面に出している絵と同じ「きらめきの演出」で採点できる */
export function renderForScore(
  hex: string,
  rows: number[],
  lights: DrawLight[],
  half: number,
  sparkle?: Sparkle
): ImageData | null {
  const cv = renderGem({
    hex,
    px: SCORE_PX,
    rot: rows,
    lights: lights as StudioLight[],
    half,
    superSample: 1,
    sparkle,
    target: (scoreCv ??= document.createElement("canvas")),
  });
  if (!cv) return null;
  return cv.getContext("2d")!.getImageData(0, 0, SCORE_PX, SCORE_PX);
}

/** 明るさの目盛り。画面の色そのままではなく、目で見た明るさに近い形で見る */
function lumOf(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** 表示の明るさを上下に振った条件を作るための曲げ。
 *  1画素ずつ計算すると重いので、256段の早見表を作って使い回す */
const bendCache = new Map<number, Float32Array>();
function bendLut(gamma: number): Float32Array {
  const hit = bendCache.get(gamma);
  if (hit) return hit;
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = Math.pow(i / 255, gamma / 2.2) * 255;
  bendCache.set(gamma, t);
  return t;
}

/**
 * 石の絵から5つの数を測る。
 * scale は 1 でそのまま、0.5 なら縦横を半分に間引いて小さく映った時を見る。
 * gamma は表示の明るさの違いを真似るための曲げ。
 */
export function measure(img: ImageData, baseHex: string, scale: number, gamma: number): Metrics | null {
  const W = img.width;
  const step = scale >= 1 ? 1 : 2;
  const d = img.data;
  const B = bendLut(gamma);
  const gw = Math.ceil(W / step);

  // 石の部分の明るさを升目に並べておく。石でない所は -1。
  // ここで一度だけ作っておけば、まわりを見る時に計算し直さずに済む
  const lg = new Float32Array(gw * gw).fill(-1);
  let n = 0;
  let blown = 0;
  let bright = 0;
  let sr = 0, sg = 0, sb = 0;
  for (let gy = 0; gy < gw; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const o = (gy * step * W + gx * step) * 4;
      if (d[o + 3] < 200) continue;
      const r = B[d[o]], g = B[d[o + 1]], b = B[d[o + 2]];
      const l = lumOf(r, g, b);
      lg[gy * gw + gx] = l;
      n++;
      if (l > 0.42) bright++;
      if (r > 244 && g > 244 && b > 244) blown++;
      sr += toLinear(r / 255); sg += toLinear(g / 255); sb += toLinear(b / 255);
    }
  }
  if (n < 200) return null;

  // 1. 明るさ。明るい点の割合。ただし白く飛んだ点が多すぎるのは引く
  const brightness = Math.max(0, bright / n - 1.5 * Math.max(0, blown / n - 0.05));

  // 2. きらめき。小さく鋭い明るい点の数と、明暗の境目の多さ
  let sharp = 0;
  let edge = 0;
  const rad = step >= 2 ? 1 : 2;
  for (let gy = 0; gy < gw; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const c = lg[gy * gw + gx];
      if (c < 0) continue;
      let sum = 0, cnt = 0, big = 0;
      for (let dy = -rad; dy <= rad; dy++) {
        const yy = gy + dy;
        if (yy < 0 || yy >= gw) continue;
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = gx + dx;
          if (xx < 0 || xx >= gw) continue;
          const v = lg[yy * gw + xx];
          if (v < 0) continue;
          sum += v; cnt++;
          if (Math.abs(v - c) > 0.16) big++;
        }
      }
      if (!cnt) continue;
      if (c > 0.55 && c > (sum / cnt) * 1.35) sharp++;
      if (big > (rad >= 2 ? 3 : 1)) edge++;
    }
  }
  const scintillation = (sharp / n) * 6 + (edge / n) * 0.9;

  // 3. 火。色付きの石は、自分が吸う色の光を通さないので、出る虹は
  //    「その石が通す色の範囲」に限られる。桃色の石なら赤・橙・青紫までで、
  //    緑は出ない。だから「石の色から大きく外れた点」を数えるのは誤りで、
  //    石の色のまわりで色合いがどれだけ散らばっているかを数える。
  //    白い石だけは吸う色が無いので、色が付いていること自体を数える。
  //    1画素おきに見る。全部見ても割合はほとんど変わらないので軽くする
  const baseLch = labToLch(linearToOklab(hexToLinear(baseHex)));
  const baseIsWhite = baseLch[1] < 0.02;
  let fire = 0;
  let fireSeen = 0;
  for (let gy = 0; gy < gw; gy += 2) {
    for (let gx = 0; gx < gw; gx += 2) {
      if (lg[gy * gw + gx] < 0) continue;
      fireSeen++;
      const o = (gy * step * W + gx * step) * 4;
      const lin: Rgb = [
        toLinear(B[d[o]] / 255),
        toLinear(B[d[o + 1]] / 255),
        toLinear(B[d[o + 2]] / 255),
      ];
      const lch = labToLch(linearToOklab(lin));
      if (baseIsWhite) {
        // 白い石は、色が付いた点そのものが虹
        if (lch[1] >= 0.03) fire++;
        continue;
      }
      if (lch[1] < 0.035) continue;
      let dh = Math.abs(lch[2] - baseLch[2]) % 360;
      if (dh > 180) dh = 360 - dh;
      // 石の色合いから 12 度以上ずれていれば、色が分かれて見えている
      if (dh > 12) fire++;
    }
  }
  const fireScore = fireSeen ? fire / fireSeen : 0;

  // 4. その色だと分かるか。石の部分の平均の色だけで見る。背景は入っていない
  const mean = labToLch(linearToOklab([sr / n, sg / n, sb / n]));
  let identity: number;
  if (baseIsWhite) {
    // 白い石は、色が付いていないほどよい
    identity = 1 - Math.min(1, mean[1] / 0.06);
  } else {
    let dh = Math.abs(mean[2] - baseLch[2]) % 360;
    if (dh > 180) dh = 360 - dh;
    const hueKeep = 1 - Math.min(1, dh / 60);
    const chromaKeep = Math.min(1, mean[1] / (baseLch[1] * 0.45));
    identity = 0.5 * hueKeep + 0.5 * chromaKeep;
  }

  return { brightness, scintillation, fire: fireScore, identity, culet: 0, culetDown: 0 };
}

/** 尖りの先が、最終的に画面でどちらを向くか。
 *  石の上の平らな面の中心から尖りへ向かう向きを画面に落とし、
 *  そのあと絵ごとの回しも掛けた、本当に目に見える向きを返す。
 *  返す y は画面の下向きが正。x は画面の右向きが正 */
export function culetOnScreen(rows: number[], rollDeg: number): { x: number; y: number; len: number; down: number } {
  // 石の座標での尖りの向きは、上の平らな面の逆、つまり -Y
  const wx = -rows[1];
  const wy = -rows[4];
  // 画面は下が正なので、世界の上向きを反転する
  const sx = wx;
  const sy = -wy;
  const a = (rollDeg * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const x = sx * ca - sy * sa;
  const y = sx * sa + sy * ca;
  const len = Math.hypot(x, y);
  return { x, y, len, down: len < 1e-6 ? 0 : y / len };
}

/** 尖りの先が水平より上を向いていないか。上を向いていたら出さない。
 *  ほぼ真正面か真後ろを向いていて画面ではどちらとも言えない時は、
 *  向きの点の方で低く出るので、ここでは落とさない */
export function culetPointsUp(rows: number[], rollDeg: number): boolean {
  const c = culetOnScreen(rows, rollDeg);
  if (c.len < 0.05) return false;
  return c.y < 0;
}

/** 底の尖りが見えるかを向きから出す。
 *  石の軸が見る向きとどれだけ傾いているかだけで決まる。
 *  真上から・真下から・真横すぎるものを低くし、その間を高くする */
export function culetScore(rows: number[]): number {
  // 石の上向き（物の座標の +Y）が、世界でどちらを向いているか
  const az = rows[7]; // r21
  const theta = (Math.acos(Math.max(-1, Math.min(1, az))) * 180) / Math.PI;
  const up = Math.max(0, Math.min(1, (theta - 15) / 25));
  const down = Math.max(0, Math.min(1, (110 - theta) / 25));
  return up * down;
}

/* ---------------------------------------------------------------------------
 * 石の影が文字に掛かるかを、絵を描かずに形だけで見分ける
 *   石は出っぱりの無い塊なので、角の点を画面へ落として外周で囲めば、
 *   それがそのまま石の影になる。描くより 50 倍ほど速いので、
 *   採点の前にここで弾けば無駄な描き直しが要らない
 * ------------------------------------------------------------------------ */
let vertCache: number[][] | null = null;

/** 点の集まりを囲む外周を求める */
function hull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** 石の影を、カードの座標での外周として返す */
export function gemOutline(
  verts: number[][],
  rows: number[],
  half: number,
  cx: number,
  cy: number,
  size: number,
  rollDeg: number
): [number, number][] {
  const k = size / 2 / half;
  const a = (rollDeg * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const pts: [number, number][] = [];
  for (const v of verts) {
    const wx = rows[0] * v[0] + rows[1] * v[1] + rows[2] * v[2];
    const wy = rows[3] * v[0] + rows[4] * v[1] + rows[5] * v[2];
    const ox = wx * k;
    const oy = -wy * k;
    pts.push([cx + ox * ca - oy * sa, cy + ox * sa + oy * ca]);
  }
  return hull(pts);
}

/** 外周と、文字の四角が重なっているか。
 *  どちらも出っぱりの無い形なので、すべての辺の向きで影を比べれば分かる */
export function outlineHitsBox(poly: [number, number][], bx: number, by: number, bw: number, bh: number): boolean {
  if (poly.length < 3) return false;
  const rect: [number, number][] = [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]];
  const axes: [number, number][] = [[1, 0], [0, 1]];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const l = Math.hypot(ex, ey) || 1;
    axes.push([-ey / l, ex / l]);
  }
  for (const ax of axes) {
    let p0 = Infinity, p1 = -Infinity, r0 = Infinity, r1 = -Infinity;
    for (const q of poly) {
      const v = q[0] * ax[0] + q[1] * ax[1];
      if (v < p0) p0 = v;
      if (v > p1) p1 = v;
    }
    for (const q of rect) {
      const v = q[0] * ax[0] + q[1] * ax[1];
      if (v < r0) r0 = v;
      if (v > r1) r1 = v;
    }
    if (p1 < r0 || r1 < p0) return false; // この向きで離れている＝重なっていない
  }
  return true;
}

/** 囲んだ形の面積 */
export function polyArea(poly: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

/** 形をカードの四角で切り落とす。はみ出した分を落として、
 *  中に見えている面積を出すために使う */
export function clipToRect(poly: [number, number][], w: number, h: number): [number, number][] {
  let out = poly.slice();
  const edges: [(p: [number, number]) => number][] = [
    [(p) => p[0]],
    [(p) => w - p[0]],
    [(p) => p[1]],
    [(p) => h - p[1]],
  ];
  for (const [inside] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i];
      const b = src[(i + 1) % src.length];
      const da = inside(a);
      const db = inside(b);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    if (!out.length) return [];
  }
  return out;
}

export function setVerts(v: number[][]) {
  vertCache = v;
}
export function getVerts(): number[][] {
  return vertCache ?? [];
}

/* ---------------------------------------------------------------------------
 * 点をそろえる
 *   生の数のままでは項目ごとに桁が違うので、たくさん引いて作った分布の
 *   どのあたりかで 0〜1 に置き換える。下の表は実測から作ったもの
 * ------------------------------------------------------------------------ */
export type Breaks = Record<keyof Metrics, number[]>;

/** 21個の区切り。下から順に、分布の 0・5・10…100 の位置の値。
 *  calibrate-shuffle.tmp.mjs で実際に引いて測った分布から作ってある。
 *  元にした引きの数は 6000 通り引いて、文字に掛かる姿と尖りが上を向く姿を
 *  除いた 1662 通り。きらめきの演出（色の分かれ幅×5・境目での色の広げ×2）を入にした状態で測っている。
 *  火の測り方を「石の色のまわりで色合いが12度以上散らばる点」に直したので、
 *  前の表（ほとんどが 0 のまま）は使えない。取り直した表がこれ */
export let BREAKS: Breaks = {
  brightness: [0.03137, 0.51188, 0.59308, 0.64737, 0.68564, 0.72576, 0.75651, 0.78293, 0.80981, 0.83884, 0.85756, 0.88097, 0.90252, 0.92539, 0.94621, 0.97614, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000],
  scintillation: [0.03626, 0.12222, 0.14900, 0.17418, 0.19117, 0.20558, 0.22363, 0.23558, 0.25065, 0.26596, 0.27774, 0.29201, 0.30285, 0.31762, 0.33475, 0.35043, 0.36843, 0.39053, 0.42198, 0.46507, 0.65651],
  fire: [0.00805, 0.04104, 0.05009, 0.05909, 0.06522, 0.07249, 0.07856, 0.08326, 0.09018, 0.09620, 0.10117, 0.10676, 0.11249, 0.11900, 0.12629, 0.13350, 0.14085, 0.15040, 0.16584, 0.19894, 0.37470],
  identity: [0.73789, 0.89155, 0.91861, 0.93361, 0.94754, 0.95679, 0.96397, 0.96879, 0.97275, 0.97611, 0.97863, 0.98057, 0.98269, 0.98513, 0.98734, 0.98942, 0.99100, 0.99331, 0.99549, 0.99737, 1.00000],
  culet: [0.00000, 0.00000, 0.00000, 0.00000, 0.00000, 0.00000, 0.16137, 0.32096, 0.47936, 0.66780, 0.79423, 0.90814, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000],
  culetDown: [0.00225, 0.04752, 0.10633, 0.15579, 0.20753, 0.26055, 0.29872, 0.34044, 0.38124, 0.43313, 0.48262, 0.53560, 0.58378, 0.62159, 0.67382, 0.72551, 0.76694, 0.80843, 0.86513, 0.91045, 0.99861],
};
/** 重み。尖りの下向きだけは「他の項目を食わない」よう 0.3 に抑えてある。
 *  合計 5.3 のうち 0.3、つまり全体の約 5.7% ぶんの効き目 */
export let WEIGHTS: Record<keyof Metrics, number> = {
  brightness: 1, scintillation: 1, fire: 1, identity: 1, culet: 1, culetDown: 0.3,
};
/** 合格の線。3条件の「いちばん低い点」の上位25%の位置。
 *  前は1条件目だけの上位25%を線にしていたので、実際に通るのは14.4%しかなく、
 *  「上位25%が合格」という決めごとと合っていなかった。合否と同じ数で線を引き直した */
export let PASS_MARK = 0.5587;

export function setCalibration(breaks: Breaks, weights: Record<keyof Metrics, number>, pass: number) {
  BREAKS = breaks;
  WEIGHTS = weights;
  PASS_MARK = pass;
}

/* ---------------------------------------------------------------------------
 * 配置の型ごとの目盛り
 *   文字の置き場所が変わると「文字に掛かって捨てられる姿」の割合が変わるので、
 *   分布も合格の線も型ごとに取り直す。
 *   型2は文字を指す構図なので、尖りが下を向く姿を少しだけ優遇する（重み 0.3→0.6）。
 *   上の BREAKS / WEIGHTS / PASS_MARK は、いま選ばれている型のもの（初めは型1）。
 * ------------------------------------------------------------------------ */
export type Calib = { breaks: Breaks; weights: Record<keyof Metrics, number>; pass: number };
const W_BASE: Record<keyof Metrics, number> = {
  brightness: 1, scintillation: 1, fire: 1, identity: 1, culet: 1, culetDown: 0.3,
};
/** 型2だけ、尖りの下向きの効き目を倍にする。
 *  合計 5.6 のうち 0.6、つまり全体の約 10.7% ぶん（型1・型3は約 5.7%） */
const W_L2: Record<keyof Metrics, number> = { ...W_BASE, culetDown: 0.6 };

export const CALIB: Record<string, Calib> = {
  l1: {
    // 型1 左に文字・右に石
    breaks: {
      brightness: [0.03137, 0.51188, 0.59308, 0.64737, 0.68564, 0.72576, 0.75651, 0.78293, 0.80981, 0.83884, 0.85756, 0.88097, 0.90252, 0.92539, 0.94621, 0.97614, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000],
      scintillation: [0.03626, 0.12222, 0.14900, 0.17418, 0.19117, 0.20558, 0.22363, 0.23558, 0.25065, 0.26596, 0.27774, 0.29201, 0.30285, 0.31762, 0.33475, 0.35043, 0.36843, 0.39053, 0.42198, 0.46507, 0.65651],
      fire: [0.00805, 0.04104, 0.05009, 0.05909, 0.06522, 0.07249, 0.07856, 0.08326, 0.09018, 0.09620, 0.10117, 0.10676, 0.11249, 0.11900, 0.12629, 0.13350, 0.14085, 0.15040, 0.16584, 0.19894, 0.37470],
      identity: [0.73789, 0.89155, 0.91861, 0.93361, 0.94754, 0.95679, 0.96397, 0.96879, 0.97275, 0.97611, 0.97863, 0.98057, 0.98269, 0.98513, 0.98734, 0.98942, 0.99100, 0.99331, 0.99549, 0.99737, 1.00000],
      culet: [0.00000, 0.00000, 0.00000, 0.00000, 0.00000, 0.00000, 0.16137, 0.32096, 0.47936, 0.66780, 0.79423, 0.90814, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000],
      culetDown: [0.00225, 0.04752, 0.10633, 0.15579, 0.20753, 0.26055, 0.29872, 0.34044, 0.38124, 0.43313, 0.48262, 0.53560, 0.58378, 0.62159, 0.67382, 0.72551, 0.76694, 0.80843, 0.86513, 0.91045, 0.99861],
    },
    weights: W_BASE,
    pass: 0.5587,
  },
  l2: {
    // 型2 中央そろえ。尖りの下向きを少し優遇している
    breaks: {
      brightness: [0.22759, 0.50433, 0.58945, 0.65427, 0.69796, 0.73523, 0.76655, 0.79145, 0.81314, 0.83923, 0.85950, 0.88094, 0.90545, 0.92770, 0.94611, 0.97424, 0.99967, 1.00000, 1.00000, 1.00000, 1.00000],
      scintillation: [0.03626, 0.11508, 0.14418, 0.16486, 0.18200, 0.19804, 0.21266, 0.22977, 0.24326, 0.25657, 0.27103, 0.28363, 0.29551, 0.31027, 0.32416, 0.34266, 0.36084, 0.38180, 0.41098, 0.44592, 0.65715],
      fire: [0.01435, 0.04068, 0.05136, 0.05833, 0.06459, 0.06996, 0.07503, 0.08102, 0.08632, 0.09225, 0.09784, 0.10468, 0.11125, 0.11726, 0.12354, 0.13247, 0.14153, 0.15152, 0.16789, 0.20516, 0.40420],
      identity: [0.66966, 0.88930, 0.91522, 0.93126, 0.94514, 0.95499, 0.96246, 0.96806, 0.97226, 0.97467, 0.97768, 0.97967, 0.98158, 0.98428, 0.98734, 0.98943, 0.99155, 0.99371, 0.99600, 0.99788, 1.00000],
      culet: [0.00000, 0.00000, 0.00000, 0.00000, 0.00000, 0.00000, 0.04004, 0.17027, 0.33474, 0.48556, 0.67023, 0.79999, 0.95181, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000],
      culetDown: [0.00688, 0.39734, 0.52005, 0.61426, 0.66999, 0.72296, 0.75132, 0.78387, 0.81533, 0.84429, 0.87696, 0.89702, 0.91193, 0.93287, 0.94788, 0.96703, 0.97881, 0.98669, 0.99391, 0.99884, 1.00000],
    },
    weights: W_L2,
    pass: 0.5528,
  },
  l3: {
    // 型3 対角
    breaks: {
      brightness: [0.03137, 0.48625, 0.58868, 0.65071, 0.69530, 0.72716, 0.75914, 0.78884, 0.81274, 0.83922, 0.85895, 0.88417, 0.90820, 0.92784, 0.94855, 0.97325, 0.99976, 1.00000, 1.00000, 1.00000, 1.00000],
      scintillation: [0.04247, 0.12430, 0.14907, 0.17140, 0.18764, 0.20204, 0.21686, 0.23125, 0.24390, 0.25738, 0.27181, 0.28571, 0.29784, 0.31241, 0.32741, 0.34622, 0.36364, 0.38822, 0.41631, 0.45932, 0.65715],
      fire: [0.00805, 0.04056, 0.04970, 0.05790, 0.06474, 0.07099, 0.07610, 0.08238, 0.08835, 0.09513, 0.10024, 0.10661, 0.11206, 0.11779, 0.12596, 0.13345, 0.14219, 0.15181, 0.16968, 0.20453, 0.44922],
      identity: [0.73789, 0.89263, 0.91522, 0.93248, 0.94705, 0.95642, 0.96343, 0.96879, 0.97253, 0.97498, 0.97813, 0.98012, 0.98213, 0.98510, 0.98731, 0.98952, 0.99121, 0.99331, 0.99552, 0.99730, 1.00000],
      culet: [0.00000, 0.00000, 0.00000, 0.00000, 0.00000, 0.00000, 0.00290, 0.13342, 0.33213, 0.50102, 0.68763, 0.84225, 0.96793, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000, 1.00000],
      culetDown: [0.00225, 0.05324, 0.11657, 0.17308, 0.23841, 0.28937, 0.33472, 0.37942, 0.44183, 0.49081, 0.55414, 0.60895, 0.67058, 0.73715, 0.79134, 0.84540, 0.89500, 0.93915, 0.97556, 0.99383, 0.99996],
    },
    weights: W_BASE,
    pass: 0.5585,
  },
};

/** その型の目盛りに切り替える */
export function useCalibration(key: string) {
  const c = CALIB[key] ?? CALIB.l1;
  BREAKS = c.breaks;
  WEIGHTS = c.weights;
  PASS_MARK = c.pass;
}

/** 生の数を、分布のどのあたりかに置き換える */
export function rank(v: number, table: number[]): number {
  if (v <= table[0]) return 0;
  const last = table.length - 1;
  if (v >= table[last]) return 1;
  for (let i = 1; i <= last; i++) {
    if (v <= table[i]) {
      const lo = table[i - 1], hi = table[i];
      const f = hi === lo ? 0 : (v - lo) / (hi - lo);
      return (i - 1 + f) / last;
    }
  }
  return 1;
}

export function total(m: Metrics): number {
  const keys: (keyof Metrics)[] = ["brightness", "scintillation", "fire", "identity", "culet", "culetDown"];
  let s = 0, w = 0;
  for (const k of keys) {
    s += rank(m[k], BREAKS[k]) * WEIGHTS[k];
    w += WEIGHTS[k];
  }
  return w ? s / w : 0;
}

export type Scored = {
  metrics: Metrics;
  /** 小さく映した時と、表示の明るさを上下に振った時も含めた、いちばん低い合計点 */
  score: number;
  /** 条件ごとの合計点 */
  perCase: number[];
  /** 条件ごとの生の数。目盛りを取り直すときに、描き直さずに計算し直すために持つ */
  cases: Metrics[];
};

/** 3つの見え方の条件で測り、いちばん低い点を採る。
 *  そのまま／小さく映して表示が暗め／小さく映して表示が明るめ */
export function scoreGem(img: ImageData, baseHex: string, rows: number[], rollDeg = 0): Scored | null {
  const cu = culetScore(rows);
  const cd = Math.max(0, culetOnScreen(rows, rollDeg).down);
  const cases: [number, number][] = [[1, 2.2], [0.5, 1.8], [0.5, 2.6]];
  const per: number[] = [];
  const raw: Metrics[] = [];
  let first: Metrics | null = null;
  for (const [scale, gamma] of cases) {
    const m = measure(img, baseHex, scale, gamma);
    if (!m) return null;
    m.culet = cu;
    m.culetDown = cd;
    if (!first) first = m;
    raw.push(m);
    per.push(total(m));
  }
  return { metrics: first!, score: Math.min(...per), perCase: per, cases: raw };
}
