/* =============================================================================
 * 【使い捨て】背景の層を、混ぜ方を決めて自分で塗る
 *
 * いままでは canvas の普通の重ね塗りに任せていた。それだと画面の色のまま
 * 混ぜるので、暗くくすんだ色になりやすい。ここでは
 *   下地（いまのカードと同じ放射状の暗い地）＋ にじみ全部
 * を、光の量そのもの または 目で見た感じに近い並べ方 の上で混ぜてから、
 * 画面の色に戻す。
 *
 * 1200×630 を毎回全部計算すると重いので、粗い升目で計算して引き伸ばす。
 * にじみは元々ぼやけた丸なので、引き伸ばしても見た目は変わらない。
 * ========================================================================== */

import {
  toLinear,
  toSrgb,
  linearToOklab,
  oklabToLinear,
  labToLch,
  relLuminanceLinear,
  contrastRatio,
  type Rgb,
} from "./gemStudioColor";

export const CARD_W = 1200;
export const CARD_H = 630;

/* ---------------------------------------------------------------------------
 * 下地。いまのカードの CSS と同じ形を、こちらで計算し直す。
 *   radial-gradient(150% 85% at 50% -8%, #1b2030 0%, #0e1016 48%, #07080c 100%)
 * 横の半径はカードの幅の150%、縦の半径は高さの85%、中心は横の真ん中・上に8%出た所。
 * 色の変わり方は CSS と同じく画面の色のまま繋ぐ
 * ------------------------------------------------------------------------ */
const BG_CX = CARD_W * 0.5;
const BG_CY = CARD_H * -0.08;
const BG_RX = CARD_W * 1.5;
const BG_RY = CARD_H * 0.85;
const BG_STOPS: { at: number; rgb: [number, number, number] }[] = [
  { at: 0.0, rgb: [0x1b, 0x20, 0x30] },
  { at: 0.48, rgb: [0x0e, 0x10, 0x16] },
  { at: 1.0, rgb: [0x07, 0x08, 0x0c] },
];

/** 下地の、その位置の画面の色（0〜255） */
export function baseAt(t: number): [number, number, number] {
  const u = Math.max(0, Math.min(1, t));
  for (let i = 1; i < BG_STOPS.length; i++) {
    const a = BG_STOPS[i - 1];
    const b = BG_STOPS[i];
    if (u <= b.at) {
      const f = b.at === a.at ? 0 : (u - a.at) / (b.at - a.at);
      return [
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f,
      ];
    }
  }
  return BG_STOPS[BG_STOPS.length - 1].rgb.slice() as [number, number, number];
}

/* ---------------------------------------------------------------------------
 * 混ぜる場所
 * ------------------------------------------------------------------------ */
/** srgb は、canvas の普通の重ね塗りと同じ混ぜ方。最初の版の見え方を測るために置いてある */
export type Space = "linear" | "oklab" | "srgb";

function intoSpace(lin: Rgb, space: Space): Rgb {
  if (space === "oklab") return linearToOklab(lin);
  if (space === "srgb") return [toSrgb(lin[0]), toSrgb(lin[1]), toSrgb(lin[2])];
  return lin;
}
function outOfSpace(c: Rgb, space: Space): Rgb {
  if (space === "oklab") return oklabToLinear(c);
  if (space === "srgb") return [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])];
  return c;
}

export type LayerBlob = {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  /** 光の量そのものでの色 */
  linear: Rgb;
  /** 細長いかけら用。向き（ラジアン）。省略すると丸いにじみ */
  rot?: number;
  /** 長さ÷幅。1 で丸、大きいほど細長い */
  aspect?: number;
  /** 縁の立ち方。1 でいまのにじみと同じなだらかさ、大きいほど縁がはっきりする */
  edge?: number;
  /** true にすると、丸ではなく角のあるひし形の形で落ちる。面で切り取られた光らしくなる */
  facet?: boolean;
  /** true にすると「光の筋」になる。(x,y) が根元で、rot の向きへ radius の長さだけ
   *  伸びる。根元がいちばん濃く、先へ行くほど淡くなり、先ほど細くなる。
   *  濃さのいちばん高い所が (x,y) そのものなので、かけらの量を測るときは
   *  そこ1点を見れば、いちばん濃い所を見たことになる */
  ray?: boolean;
  /** 光の筋の、根元での幅の半分 */
  width?: number;
};

/** 光の筋の、先での細まり方。0 で先まで同じ幅、1 で先が点になる */
const RAY_NARROW = 0.75;
/** 根元から先へ向かう濃さの落ち方。大きいほど根元に寄る */
const RAY_FADE = 1.6;

/** 光の筋が地面を覆う広さ。長さ×幅で決まる台形の面積 */
export function rayArea(len: number, width: number): number {
  return 2 * width * len * (1 - RAY_NARROW / 2);
}
export type TextBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** その文字の相対的な明るさ */
  lum: number;
};

export type LayerResult = {
  image: ImageData;
  lowW: number;
  lowH: number;
  /** 上限を掛ける前の、文字と背景の明るさの比のいちばん小さい値 */
  minBefore: number;
  /** 上限を掛けたあとの値 */
  minAfter: number;
  /** にじみ全体に掛けた上限。1 なら手を入れていない */
  capScale: number;
  capped: boolean;
  /** 文字のまわりだけを弱めた度合い。1 なら弱めていない */
  shieldScale: number;
  shielded: boolean;
  ms: number;
};

const LOW_W = 300;
const LOW_H = 158;
const NEED = 4.5; // 文字と背景の明るさの比の下限

/** 下地を、混ぜる場所の色に直した早見表。位置だけで決まるので一度作れば使い回せる */
function buildBaseLut(space: Space): Float64Array {
  const lut = new Float64Array(257 * 3);
  for (let i = 0; i <= 256; i++) {
    const s = baseAt(i / 256);
    const lin: Rgb = [toLinear(s[0] / 255), toLinear(s[1] / 255), toLinear(s[2] / 255)];
    const c = intoSpace(lin, space);
    lut[i * 3] = c[0];
    lut[i * 3 + 1] = c[1];
    lut[i * 3 + 2] = c[2];
  }
  return lut;
}
let lutCache: { space: Space; lut: Float64Array } | null = null;
function baseLut(space: Space): Float64Array {
  if (lutCache && lutCache.space === space) return lutCache.lut;
  const lut = buildBaseLut(space);
  lutCache = { space, lut };
  return lut;
}

/** 位置ごとの、下地の早見表の番号 */
function buildTIndex(): Uint8Array {
  const out = new Uint8Array(LOW_W * LOW_H);
  for (let j = 0; j < LOW_H; j++) {
    const y = ((j + 0.5) * CARD_H) / LOW_H;
    for (let i = 0; i < LOW_W; i++) {
      const x = ((i + 0.5) * CARD_W) / LOW_W;
      const dx = (x - BG_CX) / BG_RX;
      const dy = (y - BG_CY) / BG_RY;
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      out[j * LOW_W + i] = Math.round(t * 256) > 255 ? 255 : Math.round(t * 256);
    }
  }
  return out;
}
let tIndexCache: Uint8Array | null = null;

/* ---------------------------------------------------------------------------
 * 文字のまわりの覆い
 *   文字の箱の中ではにじみをいちばん弱め、そこから外へなだらかに元へ戻す。
 *   全体を薄くするのではなく、文字のまわりだけを弱めるための下ごしらえ
 * ------------------------------------------------------------------------ */
const SHIELD_PAD = 16;   // 文字の箱のまわりに取る余白
const SHIELD_FALL = 150; // そこから元の強さに戻るまでの長さ

function boxesKey(boxes: TextBox[]): string {
  return boxes.map((b) => [b.x, b.y, b.w, b.h].map((v) => Math.round(v)).join(",")).join(";");
}
/** 升目ごとの「元の強さへの戻り具合」。0 が文字の箱の中、1 が覆いの外 */
function buildShield(boxes: TextBox[]): Float32Array {
  const out = new Float32Array(LOW_W * LOW_H);
  for (let j = 0; j < LOW_H; j++) {
    const y = ((j + 0.5) * CARD_H) / LOW_H;
    for (let i = 0; i < LOW_W; i++) {
      const x = ((i + 0.5) * CARD_W) / LOW_W;
      let near = Infinity;
      for (const b of boxes) {
        const dx = Math.max(b.x - SHIELD_PAD - x, 0, x - (b.x + b.w + SHIELD_PAD));
        const dy = Math.max(b.y - SHIELD_PAD - y, 0, y - (b.y + b.h + SHIELD_PAD));
        const d = Math.hypot(dx, dy);
        if (d < near) near = d;
      }
      const t = Math.max(0, Math.min(1, near / SHIELD_FALL));
      out[j * LOW_W + i] = t * t * (3 - 2 * t); // 角が立たないようになだらかに
    }
  }
  return out;
}
let shieldCache: { key: string; field: Float32Array } | null = null;
function shieldField(boxes: TextBox[]): Float32Array {
  const key = boxesKey(boxes);
  if (shieldCache && shieldCache.key === key) return shieldCache.field;
  const field = buildShield(boxes);
  shieldCache = { key, field };
  return field;
}

/** ひとつの升目の、混ぜ終わった色。
 *  k は最後の保険としてにじみ全体に掛ける倍率、
 *  minM は文字の箱の中でのにじみの弱め具合（1 なら弱めていない） */
function mixAt(
  i: number,
  j: number,
  lut: Float64Array,
  tIdx: Uint8Array,
  blobs: LayerBlob[],
  space: Space,
  k: number,
  out: Rgb,
  shield?: Float32Array,
  minM = 1
) {
  const ti = tIdx[j * LOW_W + i] * 3;
  out[0] = lut[ti];
  out[1] = lut[ti + 1];
  out[2] = lut[ti + 2];
  const x = ((i + 0.5) * CARD_W) / LOW_W;
  const y = ((j + 0.5) * CARD_H) / LOW_H;
  // 文字のまわりだけ弱める倍率。覆いの外では 1 のまま
  const s = shield ? shield[j * LOW_W + i] : 1;
  const local = k * (minM + (1 - minM) * s);
  for (let b = 0; b < blobs.length; b++) {
    const bl = blobs[b];
    let dx = x - bl.x;
    let dy = y - bl.y;
    if (bl.ray) {
      // 光の筋。根元から先へ向かう長さを u、それと直角の広がりを v として測る
      const ca = Math.cos(-(bl.rot ?? 0)), sa = Math.sin(-(bl.rot ?? 0));
      const u = dx * ca - dy * sa;
      const v = dx * sa + dy * ca;
      if (u < 0 || u >= bl.radius) continue;
      const t = 1 - u / bl.radius;
      const halfW = (bl.width ?? 6) * (1 - RAY_NARROW * (1 - t));
      if (halfW <= 0) continue;
      const av = Math.abs(v);
      if (av >= halfW) continue;
      const a = bl.alpha * Math.pow(t, RAY_FADE) * (1 - av / halfW) * local;
      if (a <= 0) continue;
      const c = intoSpace(bl.linear, space);
      const inv = 1 - a;
      out[0] = out[0] * inv + c[0] * a;
      out[1] = out[1] * inv + c[1] * a;
      out[2] = out[2] * inv + c[2] * a;
      continue;
    }
    if (bl.rot !== undefined) {
      // かけらの向きに合わせて座標を回し、長い方向を縮めて測る
      const ca = Math.cos(-bl.rot), sa = Math.sin(-bl.rot);
      const rx = dx * ca - dy * sa;
      const ry = dx * sa + dy * ca;
      dx = rx / (bl.aspect ?? 1);
      dy = ry;
    }
    // 角のあるひし形で測ると、面で切り取られた光らしい形になる
    const d = bl.facet ? Math.abs(dx) + Math.abs(dy) : Math.sqrt(dx * dx + dy * dy);
    if (d >= bl.radius) continue;
    const t = 1 - d / bl.radius;
    const a = bl.alpha * (bl.edge && bl.edge !== 1 ? Math.pow(t, bl.edge) : t) * local;
    if (a <= 0) continue;
    const c = intoSpace(bl.linear, space);
    const inv = 1 - a;
    out[0] = out[0] * inv + c[0] * a;
    out[1] = out[1] * inv + c[1] * a;
    out[2] = out[2] * inv + c[2] * a;
  }
}

/** 文字の箱の中で、文字と背景の明るさの比がいちばん小さい所を探す */
function minRatio(
  lut: Float64Array,
  tIdx: Uint8Array,
  blobs: LayerBlob[],
  space: Space,
  k: number,
  boxes: TextBox[],
  shield?: Float32Array,
  minM = 1
): number {
  if (!boxes.length) return Infinity;
  const c: Rgb = [0, 0, 0];
  let worst = Infinity;
  for (const box of boxes) {
    const i0 = Math.max(0, Math.floor((box.x / CARD_W) * LOW_W));
    const i1 = Math.min(LOW_W - 1, Math.ceil(((box.x + box.w) / CARD_W) * LOW_W));
    const j0 = Math.max(0, Math.floor((box.y / CARD_H) * LOW_H));
    const j1 = Math.min(LOW_H - 1, Math.ceil(((box.y + box.h) / CARD_H) * LOW_H));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        mixAt(i, j, lut, tIdx, blobs, space, k, c, shield, minM);
        const lin = outOfSpace(c, space);
        const lum = relLuminanceLinear([
          Math.max(0, Math.min(1, lin[0])),
          Math.max(0, Math.min(1, lin[1])),
          Math.max(0, Math.min(1, lin[2])),
        ]);
        const r = contrastRatio(box.lum, lum);
        if (r < worst) worst = r;
      }
    }
  }
  return worst;
}

/** 背景の層を塗る。文字が読めなくなる手前で、にじみ全体の強さに上限を掛ける */
export function buildLayer(
  blobs: LayerBlob[],
  space: Space,
  boxes: TextBox[],
  useCap: boolean,
  /** すでに決まっている弱め方をそのまま使う。
   *  層に分けて塗るとき、下地＋にじみだけの絵を、全部入りの絵と同じ弱め方で
   *  作るために使う。別々に決め直すと、引き算で光の層を取り出せなくなる */
  forced?: { k: number; minM: number }
): LayerResult {
  const t0 = performance.now();
  if (!tIndexCache) tIndexCache = buildTIndex();
  const tIdx = tIndexCache;
  const lut = baseLut(space);

  const shield = boxes.length ? shieldField(boxes) : undefined;
  const minBefore = forced ? Infinity : minRatio(lut, tIdx, blobs, space, 1, boxes);

  // まず「文字のまわりだけ弱める」で通るところまで下ろす。
  // 全体に掛ける倍率は、これでも足りなかった時のための最後の保険
  let minM = forced ? forced.minM : 1;
  let k = forced ? forced.k : 1;
  if (!forced && useCap && minBefore < NEED) {
    let found = 0;
    for (let s = 1; s >= 0; s -= 0.02) {
      if (minRatio(lut, tIdx, blobs, space, 1, boxes, shield, s) >= NEED) {
        found = s;
        break;
      }
    }
    let lo = found;
    let hi = Math.min(1, found + 0.02);
    for (let it = 0; it < 6; it++) {
      const mid = (lo + hi) / 2;
      if (minRatio(lut, tIdx, blobs, space, 1, boxes, shield, mid) >= NEED) lo = mid;
      else hi = mid;
    }
    minM = Math.max(0, lo);
    // 文字の箱の中を完全に消しても届かない時だけ、全体を薄くする
    if (minRatio(lut, tIdx, blobs, space, 1, boxes, shield, 0) < NEED) {
      let g = 0;
      for (let s = 1; s >= 0; s -= 0.02) {
        if (minRatio(lut, tIdx, blobs, space, s, boxes, shield, 0) >= NEED) { g = s; break; }
      }
      k = Math.max(0, g);
      minM = 0;
    }
  }

  const img = new ImageData(LOW_W, LOW_H);
  const data = img.data;
  const c: Rgb = [0, 0, 0];
  for (let j = 0; j < LOW_H; j++) {
    for (let i = 0; i < LOW_W; i++) {
      mixAt(i, j, lut, tIdx, blobs, space, k, c, shield, minM);
      const lin = outOfSpace(c, space);
      const o = (j * LOW_W + i) * 4;
      data[o] = Math.max(0, Math.min(255, Math.round(toSrgb(Math.max(0, Math.min(1, lin[0]))) * 255)));
      data[o + 1] = Math.max(0, Math.min(255, Math.round(toSrgb(Math.max(0, Math.min(1, lin[1]))) * 255)));
      data[o + 2] = Math.max(0, Math.min(255, Math.round(toSrgb(Math.max(0, Math.min(1, lin[2]))) * 255)));
      data[o + 3] = 255;
    }
  }

  const minAfter = forced
    ? Infinity
    : k === 1 && minM === 1
      ? minBefore
      : minRatio(lut, tIdx, blobs, space, k, boxes, shield, minM);
  return {
    image: img,
    lowW: LOW_W,
    lowH: LOW_H,
    minBefore,
    minAfter,
    capScale: k,
    capped: k < 1,
    /** 文字のまわりをどれだけ弱めたか。1 なら手を入れていない */
    shieldScale: minM,
    shielded: minM < 1,
    ms: performance.now() - t0,
  };
}

/* ---------------------------------------------------------------------------
 * 脇役の量を測る
 *   地（何も置いていない暗い地）に対して、にじみがどれだけ浮いているかを
 *   目で見た感じに近い並べ方で測る。
 *     いちばん浮いている所の 鮮やかさ C の増え方 と 明るさ L の増え方
 *     カードの左半分での、その増え方の合計
 *   石の側（横600より右）は主役の場所なので数に入れない。
 * ------------------------------------------------------------------------ */
export const AMOUNT_X_MAX = 600;
const AMOUNT_STEP = 2;

let baseLchCache: Float64Array | null = null;
function baseLchLut(): Float64Array {
  if (baseLchCache) return baseLchCache;
  const t = new Float64Array(257 * 2);
  for (let i = 0; i <= 256; i++) {
    const s = baseAt(i / 256);
    const lch = labToLch(linearToOklab([toLinear(s[0] / 255), toLinear(s[1] / 255), toLinear(s[2] / 255)]));
    t[i * 2] = lch[0];
    t[i * 2 + 1] = lch[1];
  }
  baseLchCache = t;
  return t;
}

export type Amount = { maxDC: number; maxDL: number; sumDC: number; sumDL: number; n: number };
/** 量を測る場所。カードの中の四角（カードの座標）。
 *  石の無い側の半分を測るために使う。どの型でも広さは同じ（カードの半分） */
export type AmountRect = { x0: number; y0: number; x1: number; y1: number };
/** 場所は1つとは限らない（型2は左右の両はしを合わせて半分ぶん）ので、四角の並びで持つ */
export type AmountArea = AmountRect[];
/** 最初の版と同じ「左半分」。型1の基準を測るときはこれを使う */
export const AMOUNT_LEFT: AmountArea = [{ x0: 0, y0: 0, x1: AMOUNT_X_MAX, y1: CARD_H }];

/** にじみの浮き方を測る。mul はにじみ全部に掛ける倍率。
 *  area を渡すと、その四角の中だけを測る（省略すると左半分） */
export function sampleAmount(blobs: LayerBlob[], space: Space, mul: number, area?: AmountArea): Amount {
  if (!tIndexCache) tIndexCache = buildTIndex();
  const tIdx = tIndexCache;
  const lut = baseLut(space);
  const bl = baseLchLut();
  const c: Rgb = [0, 0, 0];
  const rects = area && area.length ? area : AMOUNT_LEFT;
  let maxDC = 0, maxDL = 0, sumDC = 0, sumDL = 0, n = 0;
  for (const a of rects) {
  const iMin = Math.max(0, Math.floor((a.x0 / CARD_W) * LOW_W));
  const iMax = Math.min(LOW_W - 1, Math.floor((a.x1 / CARD_W) * LOW_W));
  const jMin = Math.max(0, Math.floor((a.y0 / CARD_H) * LOW_H));
  const jMax = Math.min(LOW_H - 1, Math.floor((a.y1 / CARD_H) * LOW_H));
  for (let j = jMin; j <= jMax; j += AMOUNT_STEP) {
    for (let i = iMin; i <= iMax; i += AMOUNT_STEP) {
      mixAt(i, j, lut, tIdx, blobs, space, mul, c);
      const lin = outOfSpace(c, space);
      const got = labToLch(linearToOklab([
        Math.max(0, Math.min(1, lin[0])),
        Math.max(0, Math.min(1, lin[1])),
        Math.max(0, Math.min(1, lin[2])),
      ]));
      const ti = tIdx[j * LOW_W + i] * 2;
      const dL = got[0] - bl[ti];
      const dC = got[1] - bl[ti + 1];
      if (dC > maxDC) maxDC = dC;
      if (dL > maxDL) maxDL = dL;
      if (dC > 0) sumDC += dC;
      if (dL > 0) sumDL += dL;
      n++;
    }
  }
  }
  return { maxDC, maxDL, sumDC, sumDL, n };
}

/** 決めた量に収まるよう、にじみ全部に掛ける倍率を探す。
 *  量の合計を基準に合わせ、いちばん浮いている所が基準を超えないところまで下げる */
export function fitAmount(blobs: LayerBlob[], space: Space, target: Amount): number {
  if (!blobs.length) return 1;
  const at = (m: number) => sampleAmount(blobs, space, m);
  const ok = (a: Amount) =>
    a.sumDC <= target.sumDC * 1.02 && a.sumDL <= target.sumDL * 1.02 &&
    a.maxDC <= target.maxDC * 1.02 && a.maxDL <= target.maxDL * 1.02;
  if (ok(at(1.5))) return 1.5;
  let lo = 0, hi = 1.5;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (ok(at(mid))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/* ---------------------------------------------------------------------------
 * 近い色ほど遠くへ置く割り当て
 *   色どうしの隔たりが小さいほど重みを大きくして、
 *   「重み × 置き場所どうしの距離」の合計がいちばん大きくなる組み合わせを選ぶ。
 *   色は多くても5つなので、あり得る組み合わせを全部試して構わない
 * ------------------------------------------------------------------------ */
export function bestAssignment(
  labs: [number, number, number][],
  slots: [number, number][]
): number[] {
  const n = labs.length;
  if (n <= 1) return [0];
  const w: number[][] = [];
  for (let i = 0; i < n; i++) {
    w.push([]);
    for (let j = 0; j < n; j++) {
      const d = Math.hypot(labs[i][0] - labs[j][0], labs[i][1] - labs[j][1], labs[i][2] - labs[j][2]);
      w[i].push(1 / (d + 0.02));
    }
  }
  const dist: number[][] = slots.map((a) => slots.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));

  let best: number[] = [];
  let bestScore = -Infinity;
  const used: boolean[] = new Array(slots.length).fill(false);
  const cur: number[] = new Array(n).fill(-1);
  const walk = (i: number) => {
    if (i === n) {
      let s = 0;
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) s += w[a][b] * dist[cur[a]][cur[b]];
      if (s > bestScore) {
        bestScore = s;
        best = cur.slice();
      }
      return;
    }
    for (let sI = 0; sI < slots.length; sI++) {
      if (used[sI]) continue;
      used[sI] = true;
      cur[i] = sI;
      walk(i + 1);
      used[sI] = false;
    }
  };
  walk(0);
  return best;
}
