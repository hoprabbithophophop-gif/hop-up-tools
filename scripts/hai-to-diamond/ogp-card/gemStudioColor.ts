/* =============================================================================
 * 【使い捨て】色の物差し
 *
 * 好みではなく、公の決まりに書かれている式だけを写したもの。
 *   - 画面の色（sRGB）と、光の量そのもの（linear）の行き来
 *   - 目で見た感じに近い並べ方（Oklab / OkLCh）の行き来
 *   - 画面に出せない色を、色合いを変えずに鮮やかさだけ落として収める手当て
 *     （CSS Color 4 の色域の収め方。見分けの付く最小の差 0.02 を打ち切りに使う）
 *   - 文字と背景の明るさの比（WCAG の relative luminance と contrast ratio）
 *
 * ここには画面を触る処理を一切入れない。数の計算だけ。
 * ========================================================================== */

export type Rgb = [number, number, number]; // 0〜1
export type Lab = [number, number, number]; // Oklab の L, a, b
export type Lch = [number, number, number]; // OkLCh の L, C, 色合いの角度（度）

/* ---------------------------------------------------------------------------
 * 1. 画面の色と、光の量そのものの行き来
 *    画面の色は目に合わせて曲げてあるので、足し算・混ぜ算をする前に
 *    いったん「実際の光の量」に戻す必要がある
 * ------------------------------------------------------------------------ */
export function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
export function toSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/* ---------------------------------------------------------------------------
 * 2. 光の量と Oklab の行き来
 *    Oklab は「目で見た明るさ・色味のずれ」が数の上の距離とそろうように
 *    組まれた並べ方。混ぜても灰色に寄りにくい
 * ------------------------------------------------------------------------ */
export function linearToOklab(c: Rgb): Lab {
  const l = 0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2];
  const m = 0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2];
  const s = 0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2];
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}
export function oklabToLinear(c: Lab): Rgb {
  const l_ = c[0] + 0.3963377774 * c[1] + 0.2158037573 * c[2];
  const m_ = c[0] - 0.1055613458 * c[1] - 0.0638541728 * c[2];
  const s_ = c[0] - 0.0894841775 * c[1] - 1.291485548 * c[2];
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function labToLch(c: Lab): Lch {
  const C = Math.hypot(c[1], c[2]);
  let h = (Math.atan2(c[2], c[1]) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [c[0], C, C < 1e-7 ? 0 : h];
}
export function lchToLab(c: Lch): Lab {
  const r = (c[2] * Math.PI) / 180;
  return [c[0], c[1] * Math.cos(r), c[1] * Math.sin(r)];
}

/** Oklab の上での隔たり。見分けの付く最小の差は 0.02 とされている */
export function deltaEOK(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/* ---------------------------------------------------------------------------
 * 3. 画面に出せない色の手当て
 *    明るさと色合いはそのままに、鮮やかさだけを落として画面に収める。
 *    色合いが動くのがいちばん嫌われるので、そこは触らない
 * ------------------------------------------------------------------------ */
const GAMUT_EPS = 1e-6;
function inGamut(c: Rgb): boolean {
  return (
    c[0] >= -GAMUT_EPS && c[0] <= 1 + GAMUT_EPS &&
    c[1] >= -GAMUT_EPS && c[1] <= 1 + GAMUT_EPS &&
    c[2] >= -GAMUT_EPS && c[2] <= 1 + GAMUT_EPS
  );
}
function clipRgb(c: Rgb): Rgb {
  return [
    Math.max(0, Math.min(1, c[0])),
    Math.max(0, Math.min(1, c[1])),
    Math.max(0, Math.min(1, c[2])),
  ];
}

const JND = 0.02;     // 見分けの付く最小の差
const CHROMA_EPS = 0.0001;

/** OkLCh の色を、画面に出せる光の量へ直す。
 *  はみ出していたら、明るさと色合いを保ったまま鮮やかさだけ減らして収める */
export function lchToLinearInGamut(lch: Lch): { linear: Rgb; lch: Lch } {
  const first = oklabToLinear(lchToLab(lch));
  if (inGamut(first)) return { linear: clipRgb(first), lch: [lch[0], lch[1], lch[2]] };
  if (lch[0] >= 1) return { linear: [1, 1, 1], lch: [1, 0, lch[2]] };
  if (lch[0] <= 0) return { linear: [0, 0, 0], lch: [0, 0, lch[2]] };

  let lo = 0;
  let hi = lch[1];
  let loInGamut = true;
  let current: Rgb = first;
  let clipped: Rgb = clipRgb(first);
  let usedC = lch[1];

  // まず、そのまま切り詰めただけで差が分からない程度なら、それで済ませる
  if (deltaEOK(linearToOklab(clipped), linearToOklab(current)) < JND) {
    return { linear: clipped, lch: labToLch(linearToOklab(clipped)) };
  }

  while (hi - lo > CHROMA_EPS) {
    const c = (lo + hi) / 2;
    usedC = c;
    current = oklabToLinear(lchToLab([lch[0], c, lch[2]]));
    if (loInGamut && inGamut(current)) {
      lo = c;
      continue;
    }
    clipped = clipRgb(current);
    const e = deltaEOK(linearToOklab(clipped), linearToOklab(current));
    if (e < JND) {
      if (JND - e < CHROMA_EPS) break;
      loInGamut = false;
      lo = c;
    } else {
      hi = c;
    }
  }
  const out = clipRgb(oklabToLinear(lchToLab([lch[0], lo, lch[2]])));
  void usedC;
  return { linear: out, lch: labToLch(linearToOklab(out)) };
}

/* ---------------------------------------------------------------------------
 * 4. その色合いで、いちばん鮮やかになる明るさ（色域の尖り）
 *    黄色のように「明るくないとその色に見えない」色のために使う
 * ------------------------------------------------------------------------ */
const cuspCache = new Map<number, { L: number; C: number }>();
function maxChromaAt(L: number, h: number): number {
  let lo = 0;
  let hi = 0.45;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToLinear(lchToLab([L, mid, h])))) lo = mid;
    else hi = mid;
  }
  return lo;
}
/** その色合いで鮮やかさがいちばん大きくなる明るさを返す。色合いごとに覚えておく */
export function cusp(h: number): { L: number; C: number } {
  const key = Math.round(((h % 360) + 360) % 360);
  const hit = cuspCache.get(key);
  if (hit) return hit;
  let best = { L: 0.5, C: 0 };
  for (let L = 0.02; L <= 0.99; L += 0.02) {
    const c = maxChromaAt(L, key);
    if (c > best.C) best = { L, C: c };
  }
  for (let L = Math.max(0.01, best.L - 0.02); L <= Math.min(0.99, best.L + 0.02); L += 0.005) {
    const c = maxChromaAt(L, key);
    if (c > best.C) best = { L, C: c };
  }
  cuspCache.set(key, best);
  return best;
}

/* ---------------------------------------------------------------------------
 * 5. 文字の読みやすさ
 *    WCAG の決まりそのまま。明るさの比が 4.5 以上あれば普通の文字でも読める
 * ------------------------------------------------------------------------ */
/** 0〜255 の画面の色から、決まりで言う「相対的な明るさ」を出す */
export function relLuminance(r: number, g: number, b: number): number {
  return 0.2126 * toLinear(r / 255) + 0.7152 * toLinear(g / 255) + 0.0722 * toLinear(b / 255);
}
/** 光の量そのものから直に出す版。層の計算の途中で使う */
export function relLuminanceLinear(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** 明るい方と暗い方がどちらでも正しく出るように、両方向で比べる */
export function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------------------------------------------------------------------------
 * 6. 使う側の入口
 * ------------------------------------------------------------------------ */
export function hexToLinear(hex: string): Rgb {
  let h = String(hex).replace("#", "").trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const v = parseInt(h, 16);
  const r = isFinite(v) ? (v >> 16) & 255 : 255;
  const g = isFinite(v) ? (v >> 8) & 255 : 255;
  const b = isFinite(v) ? v & 255 : 255;
  return [toLinear(r / 255), toLinear(g / 255), toLinear(b / 255)];
}
export function linearTo255(c: Rgb): [number, number, number] {
  return [
    Math.max(0, Math.min(255, Math.round(toSrgb(Math.max(0, Math.min(1, c[0]))) * 255))),
    Math.max(0, Math.min(255, Math.round(toSrgb(Math.max(0, Math.min(1, c[1]))) * 255))),
    Math.max(0, Math.min(255, Math.round(toSrgb(Math.max(0, Math.min(1, c[2]))) * 255))),
  ];
}

/** 人の色を、決めた明るさまで持ち上げた色にする。
 *  明るさは下げない。色合いは動かさない。はみ出す分は鮮やかさを削って収める。
 *  cuspToward が true のときは、その色合いでいちばん鮮やかに見える明るさを目標にする */
export function liftToTargetL(
  hex: string,
  targetL: number,
  cuspToward: boolean
): { linear: Rgb; rgb255: [number, number, number]; lch: Lch; before: Lch } {
  const lin = hexToLinear(hex);
  const before = labToLch(linearToOklab(lin));
  let want = targetL;
  if (cuspToward && before[1] > 1e-6) want = cusp(before[2]).L;
  const L = Math.max(before[0], Math.min(1, want));
  const fixed = lchToLinearInGamut([L, before[1], before[2]]);
  return { linear: fixed.linear, rgb255: linearTo255(fixed.linear), lch: fixed.lch, before };
}
