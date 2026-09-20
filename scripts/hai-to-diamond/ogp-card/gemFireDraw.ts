/* =============================================================================
 * 【使い捨て】「強い光の虹」の見本用の描き足し（点で拾う作り）
 *
 * 参考にした場面を見て読み取った中身:
 *   ① 地は真っ黒
 *   ② 小さく鋭い光の点がたくさんあり、1つ1つがあふれて虹に割れている
 *   ③ 白く飛んだ芯と、そのまわりへあふれる光
 *   ④ 芯を通る短い筋。筋の片側が青〜水色、反対側が黄〜橙。縁に細い虹の帯
 *   ⑤ 中心ほど密な、黄・水色・白の小さな点
 * 参考の絵そのものは一切取り込んでいない。
 *
 * 前の版は「石の明るい上位◯%」を取り出していた。この描き手の石は面が大きく
 * 平たいので、それだと面がまるごと選ばれて白い塊になり、面の形が消えた。
 * ここでは「まわりより鋭く明るい所」だけを点として拾う。
 *
 * 色の決まり:
 *   色付きの石を通った光は、その石が通す色の範囲でしか割れない。
 *   白い石と、表面で跳ね返っただけの光（芯がほぼ無色の点）だけが全色に割れる。
 * ========================================================================== */

import { hexToLinear, linearToOklab, oklabToLinear, labToLch, lchToLinearInGamut, linearTo255, toLinear, toSrgb } from "./gemStudioColor";

export type FireSet = {
  /** 光の点を出す */
  glints: boolean;
  /** 石のまわりの空いた所にも散らす */
  around: boolean;
  /** 大きい点の数（明るい順の上位いくつ） */
  bigCount: number;
  /** 大きい点の筋の長さ。石の大きさに対する割合 */
  bigLen: number;
  /** 石の面に元からある色のずれを、何倍に広げるか。0 で広げない */
  facetK: number;
  /** 白く飛んだ小さな面に、柔らかいあふれを足す */
  facetBloom: boolean;
  /** 全体の強さ */
  gain: number;
};
export const FIRE_OFF: FireSet = { glints: false, around: false, bigCount: 0, bigLen: 0, facetK: 0, facetBloom: false, gain: 1 };

export type SplitPair = { a: [number, number, number]; b: [number, number, number]; full: boolean };

/** 割れる色の両はし。色付きの石は、その色合いのまわり ±28度だけで割る */
export function splitColors(hex: string, surface: boolean): SplitPair {
  const lch = labToLch(linearToOklab(hexToLinear(hex)));
  const isWhite = lch[1] < 0.02;
  if (surface || isWhite) {
    // 両はしの明るさをそろえる。暗い青にすると、足し算で重ねたときに
    // 黒い地の上でほとんど持ち上がらず、片側だけしか見えなくなる
    return {
      a: linearTo255(lchToLinearInGamut([0.87, 0.15, 232]).linear) as [number, number, number],
      b: linearTo255(lchToLinearInGamut([0.87, 0.16, 78]).linear) as [number, number, number],
      full: true,
    };
  }
  const h = lch[2];
  const c = Math.max(0.11, Math.min(0.20, lch[1]));
  return {
    a: linearTo255(lchToLinearInGamut([0.85, c, (h - 28 + 360) % 360]).linear) as [number, number, number],
    b: linearTo255(lchToLinearInGamut([0.88, c, (h + 28) % 360]).linear) as [number, number, number],
    full: false,
  };
}

/** 石を通った光の芯に使う色。石の色合いのまま、芯として成り立つ明るさにする。
 *  白い石は白のまま */
export function bodyCore(hex: string): [number, number, number] {
  const lch = labToLch(linearToOklab(hexToLinear(hex)));
  if (lch[1] < 0.02) return [255, 255, 255];
  // 明るさは芯として成り立つ所まで、鮮やかさは石と同じだけ残す。
  // 鮮やかさを削ると、点を置いた所だけ石の色が薄くなる
  return linearTo255(lchToLinearInGamut([0.90, lch[1], lch[2]]).linear) as [number, number, number];
}

function rng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------------------
 * 光の点を拾う
 *   明るさから、ぼかした明るさを引いた残り＝「まわりより鋭く明るい所」。
 *   面の広い明るさはぼかしても同じ明るさなので、引くと消える。
 *   面の角や稜線の交わる所だけが山として残る。
 * ------------------------------------------------------------------------ */
export type Glint = {
  /** 石の絵の中での位置（0〜1） */
  u: number;
  v: number;
  /** 鋭さ。大きいほど強い点 */
  sharp: number;
  /** その場所の明るさ */
  lum: number;
  /** 芯がほぼ無色なら、表面で跳ね返った光とみなす */
  surface: boolean;
};

const DET_PX = 320;
let detCv: HTMLCanvasElement | null = null;
let detKey = "";
let detData: Uint8ClampedArray | null = null;

/** 石の絵を 320px に縮めた下書きの点。同じ絵なら作り直さない。
 *
 *  点を拾う・明るさを測る・明るい面を探す の3つが、これまで同じ絵を
 *  3回縮めて3回読み出していた。縮めるのも読み出すのも重いので、1枚を使い回す。
 *  key には石の絵の版を渡すこと。渡さない（空）ときは毎回作り直す */
function detPixels(sprite: HTMLCanvasElement, key: string): Uint8ClampedArray {
  if (detData && key && detKey === key) return detData;
  if (!detCv) {
    detCv = document.createElement("canvas");
    detCv.width = DET_PX;
    detCv.height = DET_PX;
  }
  const g = detCv.getContext("2d", { willReadFrequently: true })!;
  g.clearRect(0, 0, DET_PX, DET_PX);
  g.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in g) g.imageSmoothingQuality = "high";
  g.drawImage(sprite, 0, 0, DET_PX, DET_PX);
  detData = g.getImageData(0, 0, DET_PX, DET_PX).data;
  detKey = key;
  return detData;
}

/** 横と縦に分けて平均を取る、かんたんなぼかし */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * w + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / win;
      const add = src[y * w + Math.min(w - 1, x + r + 1)];
      const sub = src[y * w + Math.max(0, x - r)];
      sum += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const sub = tmp[Math.max(0, y - r) * w + x];
      sum += add - sub;
    }
  }
  return out;
}

/** 石の絵から、鋭く明るい点を明るい順に拾う。
 *  wantMin〜wantMax の数に収まるよう、しきい値を自動で動かす */
export function findGlints(sprite: HTMLCanvasElement, wantMin: number, wantMax: number, key = ""): Glint[] {
  const d = detPixels(sprite, key);

  const n = DET_PX * DET_PX;
  const lum = new Float32Array(n);
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (d[o + 3] < 200) continue;
    inside[i] = 1;
    lum[i] = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255;
  }
  // 鮮やかさは「表面で跳ねた光か」を見分けるためだけに使う。
  // 使うのは山として残った数十個だけなので、10万点ぜんぶで先に計算しない。
  // 先に全部やると、向きを変えるたびに 10万回の色の変換が走って重かった
  const chromaAt = (i: number): number => {
    const o = i * 4;
    return labToLch(linearToOklab([toLinear(d[o] / 255), toLinear(d[o + 1] / 255), toLinear(d[o + 2] / 255)]))[1];
  };
  // 石の外周のきわは、暗い地との境目なので「鋭く明るい所」として必ず山になる。
  // そこばかり拾うと、光の点が石のふちに並んでしまう。
  // 石の内側だけを見るよう、内と外の型紙をぼかして、きわを外す
  const mask = new Float32Array(n);
  for (let i = 0; i < n; i++) mask[i] = inside[i] ? 1 : 0;
  const maskBlur = boxBlur(mask, DET_PX, DET_PX, 6);

  // 面の広さよりひと回り小さい幅でぼかす。ここを大きくしすぎると面がまるごと残る
  const blur = boxBlur(lum, DET_PX, DET_PX, 7);
  const sharp = new Float32Array(n);
  let maxSharp = 0;
  for (let i = 0; i < n; i++) {
    if (!inside[i]) continue;
    const v = lum[i] - blur[i];
    sharp[i] = v > 0 ? v : 0;
    // いちばん鋭い値も、きわを外した内側だけで取る
    if (maskBlur[i] >= 0.995 && sharp[i] > maxSharp) maxSharp = sharp[i];
  }
  if (maxSharp <= 0.001) return [];

  // まわりより高い所（山）だけを残す
  const peaks: Glint[] = [];
  for (let y = 2; y < DET_PX - 2; y++) {
    for (let x = 2; x < DET_PX - 2; x++) {
      const i = y * DET_PX + x;
      if (!inside[i] || maskBlur[i] < 0.995 || sharp[i] < maxSharp * 0.45) continue;
      let top = true;
      for (let dy = -2; dy <= 2 && top; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          if (sharp[(y + dy) * DET_PX + (x + dx)] > sharp[i]) { top = false; break; }
        }
      }
      if (!top) continue;
      peaks.push({ u: x / DET_PX, v: y / DET_PX, sharp: sharp[i], lum: lum[i], surface: chromaAt(i) < 0.035 });
    }
  }
  peaks.sort((a, b) => b.sharp - a.sharp);
  // 近すぎる点は間引く
  const keep: Glint[] = [];
  const minD = 11 / DET_PX;
  for (const q of peaks) {
    if (keep.length >= wantMax) break;
    let ok = true;
    for (const k of keep) {
      if (Math.hypot(k.u - q.u, k.v - q.v) < minD) { ok = false; break; }
    }
    if (ok) keep.push(q);
  }
  // 少なすぎる時は、間引く幅をゆるめてもう一度
  if (keep.length < wantMin) {
    const keep2: Glint[] = [];
    const minD2 = 7 / DET_PX;
    for (const q of peaks) {
      if (keep2.length >= wantMax) break;
      let ok = true;
      for (const k of keep2) {
        if (Math.hypot(k.u - q.u, k.v - q.v) < minD2) { ok = false; break; }
      }
      if (ok) keep2.push(q);
    }
    return keep2;
  }
  return keep;
}

/* ---------------------------------------------------------------------------
 * 光の点を1つ描く
 *   小さな白い芯 → そのまわりの柔らかいあふれ → 芯を通る短い筋。
 *   筋は、長さ方向に色をずらして3本重ねる。芯では全部が重なって白、
 *   先へ行くほど届く色が減って、片側が寒色・反対側が暖色に分かれる。
 *   すべて足し算で重ねる。段々が出ないよう、絵を引き伸ばさず
 *   その場で作った なめらかな濃淡 だけで描く。
 * ------------------------------------------------------------------------ */
function streak(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  len: number,
  wide: number,
  col: [number, number, number],
  alpha: number,
  /** 芯からどちらへ伸ばすか。+1 か -1 */
  dir: number
) {
  if (alpha <= 0.004 || len <= 0.5) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const g = ctx.createLinearGradient(0, 0, len * dir, 0);
  g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${Math.min(1, alpha).toFixed(4)})`);
  g.addColorStop(0.45, `rgba(${col[0]},${col[1]},${col[2]},${(alpha * 0.45).toFixed(4)})`);
  g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
  ctx.fillStyle = g;
  // 先へ行くほど細くなる形
  ctx.beginPath();
  ctx.moveTo(0, -wide);
  ctx.lineTo(len * dir, -wide * 0.18);
  ctx.lineTo(len * dir, wide * 0.18);
  ctx.lineTo(0, wide);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 光の点を1つ。x,y はカードの座標 */
export function drawGlint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  /** 石の中心から見た向き。筋の1本目をこの向きに合わせる */
  radialAng: number,
  /** 0〜1。点の強さ */
  power: number,
  scale: number,
  pair: SplitPair,
  gain: number,
  /** 芯とあふれに使う色。石を通った光なら石の色、表面で跳ねた光なら白 */
  coreCol: [number, number, number] = [255, 255, 255]
) {
  const a = power * gain;
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // あふれ。なめらかな丸い濃淡を2枚
  const CC = coreCol;
  // 石を通った光は、広いあふれを弱める。広く薄く覆うと石の色が白へ寄るため。
  // 表面で跳ねた光は元々白いので、そのまま
  const hz = (CC[0] === 255 && CC[1] === 255 && CC[2] === 255) ? 1 : 0.45;
  const halo = 13 * scale * (0.7 + power * 0.8);
  for (const [r, k] of [[halo, 0.42 * hz], [halo * 2.3, 0.16 * hz]] as [number, number][]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${CC[0]},${CC[1]},${CC[2]},${Math.min(1, a * k).toFixed(4)})`);
    g.addColorStop(0.45, `rgba(${CC[0]},${CC[1]},${CC[2]},${(a * k * 0.32).toFixed(4)})`);
    g.addColorStop(1, `rgba(${CC[0]},${CC[1]},${CC[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 筋。石の中心からの放射と、それに直角。強い点だけ3本目を斜めに足す
  const len = 26 * scale * (0.55 + power);
  const wide = 1.5 * scale * (0.6 + power * 0.7);
  const angs = [radialAng, radialAng + Math.PI / 2];
  if (power > 0.62) angs.push(radialAng + Math.PI / 4);
  const white = CC;
  for (const ang of angs) {
    // 片側は pair.a、反対側は pair.b。どちらの側も、芯に近い所は白を重ねて白く保つ
    for (const [dir, col] of [[1, pair.b], [-1, pair.a]] as [number, [number, number, number]][]) {
      // 色の筋は長く、白の筋は短く。重なる芯は白、先だけ色が残る
      streak(ctx, x, y, ang, len * 1.0, wide, col, a * 0.5, dir);
      streak(ctx, x, y, ang, len * 0.42, wide * 1.15, white, a * 0.85, dir);
    }
  }

  // 芯。いちばん小さく白い所
  const core = 2.1 * scale * (0.6 + power * 0.7);
  const cg = ctx.createRadialGradient(x, y, 0, x, y, core);
  cg.addColorStop(0, `rgba(${CC[0]},${CC[1]},${CC[2]},${Math.min(1, a * 0.95).toFixed(4)})`);
  cg.addColorStop(1, `rgba(${CC[0]},${CC[1]},${CC[2]},0)`);
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(x, y, core, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/** 大きい点。筋を長く太くして、カードの大きさのままで色が見えるようにする。
 *  芯のすぐそばだけ白で、そこから先はずっと色のまま伸ばす。
 *  白を長く重ねると色が白に負けて、引いた絵で色が見えなくなる。
 *
 *  stopAt を渡すと、その向きへ進んだ時に筋を止めてよい長さを返してもらう。
 *  文字の箱の手前で消すために使う。 */
export function drawBigGlint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radialAng: number,
  power: number,
  len: number,
  pair: SplitPair,
  gain: number,
  stopAt?: (ang: number) => number,
  coreCol: [number, number, number] = [255, 255, 255]
) {
  const a = Math.min(1, (0.62 + power * 0.38) * gain);
  if (a <= 0.02) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // あふれ。芯のまわりだけ
  const CC = coreCol;
  const hz = (CC[0] === 255 && CC[1] === 255 && CC[2] === 255) ? 1 : 0.45;
  const halo = 26 * (0.7 + power * 0.6);
  for (const [r, k] of [[halo, 0.34 * hz], [halo * 2.2, 0.13 * hz]] as [number, number][]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${CC[0]},${CC[1]},${CC[2]},${(a * k).toFixed(4)})`);
    g.addColorStop(0.42, `rgba(${CC[0]},${CC[1]},${CC[2]},${(a * k * 0.3).toFixed(4)})`);
    g.addColorStop(1, `rgba(${CC[0]},${CC[1]},${CC[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const wide = 4.2 * (0.7 + power * 0.6);
  const angs = [radialAng, radialAng + Math.PI / 2];
  for (const ang of angs) {
    for (const [dir, col] of [[1, pair.b], [-1, pair.a]] as [number, [number, number, number]][]) {
      const want = stopAt ? Math.min(len, stopAt(ang + (dir < 0 ? Math.PI : 0))) : len;
      if (want < 12) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      // 色の筋。芯のそばから先まで、ずっと色を乗せたまま細くなる
      const g = ctx.createLinearGradient(0, 0, want * dir, 0);
      g.addColorStop(0, `rgba(${CC[0]},${CC[1]},${CC[2]},${a.toFixed(4)})`);
      g.addColorStop(0.09, `rgba(${CC[0]},${CC[1]},${CC[2]},${(a * 0.85).toFixed(4)})`);
      g.addColorStop(0.17, `rgba(${col[0]},${col[1]},${col[2]},${(a * 0.92).toFixed(4)})`);
      g.addColorStop(0.55, `rgba(${col[0]},${col[1]},${col[2]},${(a * 0.5).toFixed(4)})`);
      g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -wide);
      ctx.lineTo(want * dir, -wide * 0.10);
      ctx.lineTo(want * dir, wide * 0.10);
      ctx.lineTo(0, wide);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // 芯
  const core = 4.4 * (0.7 + power * 0.6);
  const cg = ctx.createRadialGradient(x, y, 0, x, y, core);
  cg.addColorStop(0, `rgba(${CC[0]},${CC[1]},${CC[2]},${a.toFixed(4)})`);
  cg.addColorStop(1, `rgba(${CC[0]},${CC[1]},${CC[2]},0)`);
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(x, y, core, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/** 石の絵が元々どれだけ明るいか。白い石ほど大きい。
 *  小さい点を何個まで置くかを、ここから決める */
export function brightFraction(sprite: HTMLCanvasElement, key = ""): number {
  // 前は、下書き用の紙がまだ無いと 0.1 を返していた。あふれは点より先に描くので、
  // 初めの1枚ではいつも 0.1 のまま控えに入り、石が明るくても弱まらなかった。
  // いまは共通の下書きを使うので、無ければその場で作られる
  const d = detPixels(sprite, key);
  let n = 0, bright = 0;
  for (let i = 0; i < d.length; i += 4 * 7) {
    if (d[i + 3] < 200) continue;
    n++;
    if ((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255 > 0.82) bright++;
  }
  return n ? bright / n : 0.1;
}

/** 案B 石のまわりの空いた所に置く点。石から離れるほど小さくまばらに */
export function scatterAround(
  cx: number,
  cy: number,
  gemR: number,
  seed: number,
  count: number
): { x: number; y: number; power: number; scale: number }[] {
  const r = rng(seed);
  const out: { x: number; y: number; power: number; scale: number }[] = [];
  for (let i = 0; i < count; i++) {
    // 石のすぐ外から、離れるほどまばらになるように引く
    const t = Math.pow(r(), 1.7);
    const dist = gemR * (1.02 + t * 1.6);
    const ang = r() * Math.PI * 2;
    const far = Math.max(0, Math.min(1, (dist / gemR - 1.02) / 1.6));
    out.push({
      x: cx + Math.cos(ang) * dist,
      y: cy + Math.sin(ang) * dist,
      power: (0.30 + r() * 0.40) * (1 - far * 0.62),
      scale: 1 - far * 0.5,
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * 石の面に元からある虹色を濃くする
 *   石の絵の各点で、「その石の地の色」からの色のずれを Oklab で測り、
 *   ずれだけを k 倍に広げる。明るさ（L）は動かさない。
 *   色域からはみ出したら、色合いを保ったまま鮮やかさだけ削る。
 *
 *   元に無い色は増えないので、「色付きの石は石が通す色の範囲でしか割れない」
 *   という決まりが自動で守られる。
 *   見分けの付かないほど小さなずれ（0.02 未満）は広げない。雑音を色にしないため。
 * ------------------------------------------------------------------------ */
const JND = 0.02;       // これ未満のずれは広げない
const BIG_SHIFT = 0.05; // 「虹に見える面」と数えるずれの大きさ

let boostCv: HTMLCanvasElement | null = null;
let boostKey = "";
let boostStat = { wide: 0, n: 0, ms: 0 };

/** 色合いを石の色の ±この角度に折り返す（色付きの石だけ） */
const HUE_KEEP = 28;

/** その色が画面に収まるか */
function inGamut(L: number, a: number, b: number): boolean {
  const lin = oklabToLinear([L, a, b]);
  return lin[0] >= -0.001 && lin[1] >= -0.001 && lin[2] >= -0.001 &&
    lin[0] <= 1.001 && lin[1] <= 1.001 && lin[2] <= 1.001;
}

/** Oklab から画面の色へ。はみ出したら鮮やかさだけ決まった回数で削って中へ入れる。
 *  回数を決め打ちにしてあるので、掛かる時間が読める */
function labToRgbClamped(L: number, a: number, b: number, out: [number, number, number]): void {
  let lo = 0, hi = 1;
  // まず、そのままで収まるかを見る
  let lin = oklabToLinear([L, a, b]);
  if (lin[0] >= -0.001 && lin[1] >= -0.001 && lin[2] >= -0.001 &&
      lin[0] <= 1.001 && lin[1] <= 1.001 && lin[2] <= 1.001) {
    out[0] = lin[0]; out[1] = lin[1]; out[2] = lin[2];
    return;
  }
  // 収まらない時だけ、鮮やかさを 4 回の折半で詰める。色合いは動かさない
  for (let i = 0; i < 4; i++) {
    const mid = (lo + hi) / 2;
    lin = oklabToLinear([L, a * mid, b * mid]);
    if (lin[0] >= -0.001 && lin[1] >= -0.001 && lin[2] >= -0.001 &&
        lin[0] <= 1.001 && lin[1] <= 1.001 && lin[2] <= 1.001) lo = mid;
    else hi = mid;
  }
  lin = oklabToLinear([L, a * lo, b * lo]);
  out[0] = lin[0]; out[1] = lin[1]; out[2] = lin[2];
}

/** 広げたあとの絵を返す。同じ絵と同じ k なら作り直さない。
 *
 *  ・地の色より鮮やかさが低い点（無色の軸に近い点＝表面で跳ね返った光）は広げない。
 *    白い面を広げると、石の色の反対側へずれたものと数えられて補色に染まる。
 *  ・色付きの石は、広げたあとの色合いを石の色合いの ±28度に折り返す。
 *  ・白い石は色合いの中心が決まらないので、鮮やかさそのものを k 倍する。 */
export function boostFacetColor(sprite: HTMLCanvasElement, k: number, key: string): HTMLCanvasElement {
  const want = key + "|" + k.toFixed(2);
  if (boostCv && boostKey === want) return boostCv;
  const t0 = performance.now();
  const px = sprite.width;
  if (!boostCv) boostCv = document.createElement("canvas");
  if (boostCv.width !== px || boostCv.height !== px) {
    boostCv.width = px;
    boostCv.height = px;
  }
  const bx = boostCv.getContext("2d")!;
  bx.clearRect(0, 0, px, px);
  bx.drawImage(sprite, 0, 0);
  const img = bx.getImageData(0, 0, px, px);
  const d = img.data;

  // 画面の色 → 光の量 の早見表。1画素ごとに計算し直さない
  const lin255 = new Float64Array(256);
  for (let i = 0; i < 256; i++) lin255[i] = toLinear(i / 255);
  // 光の量 → 画面の色 の早見表（1024段）
  const srgbLut = new Uint8Array(1025);
  for (let i = 0; i <= 1024; i++) srgbLut[i] = Math.max(0, Math.min(255, Math.round(toSrgb(i / 1024) * 255)));

  // 地の色。石の中の a,b の中央値
  const as: number[] = [];
  const bs: number[] = [];
  const sampA: number[] = [];
  const sampB: number[] = [];
  for (let i = 0; i < d.length; i += 4 * 23) {
    if (d[i + 3] < 200) continue;
    const lab = linearToOklab([lin255[d[i]], lin255[d[i + 1]], lin255[d[i + 2]]]);
    as.push(lab[1]);
    bs.push(lab[2]);
    sampA.push(lab[1]);
    sampB.push(lab[2]);
  }
  if (!as.length) return boostCv;
  as.sort((p, q) => p - q);
  bs.sort((p, q) => p - q);
  const a0 = as[as.length >> 1];
  const b0 = bs[bs.length >> 1];
  const c0 = Math.hypot(a0, b0);
  const h0 = Math.atan2(b0, a0);
  const isWhite = c0 < 0.02;
  const keep = (HUE_KEEP * Math.PI) / 180;

  // 広げるときの中心にする色合い。
  //
  // 中央値は a と b を別々に取っているので、そこから出した色合いは
  // 石ぜんたいの色合いの真ん中とは少しずれる。そのずれた所を中心にして
  // ずれを k 倍すると、ずれ自体も k 倍になって石の平均の色合いが動く
  // （実測: 石の平均が人の色から 6.3度 → 7.7度 へ離れた）。
  // 広げても石の色が変わって見えないよう、動かす色の点だけを鮮やかさで
  // 重み付けして集めた「色合いの真ん中」を中心にする。
  // a,b をそのまま足すと、長さ（＝鮮やかさ）で重みの付いた向きの合計になる
  let hcX = 0;
  let hcY = 0;
  for (let i = 0; i < sampA.length; i++) {
    if (sampA[i] * sampA[i] + sampB[i] * sampB[i] <= c0 * c0) continue;
    hcX += sampA[i];
    hcY += sampB[i];
  }
  const hc = (hcX === 0 && hcY === 0) ? h0 : Math.atan2(hcY, hcX);

  let wide = 0;
  let n = 0;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    n++;
    const lab = linearToOklab([lin255[d[i]], lin255[d[i + 1]], lin255[d[i + 2]]]);
    const L = lab[0];
    const a = lab[1];
    const b = lab[2];
    const c = Math.hypot(a, b);
    let na: number;
    let nb: number;
    if (isWhite) {
      // 白い石。色合いの中心が無いので、鮮やかさそのものを広げる
      if (c < JND) { if (c > BIG_SHIFT) wide++; continue; }
      const nc = JND + (c - JND) * k;
      const s = nc / c;
      na = a * s;
      nb = b * s;
    } else {
      // 色付きの石。地の色より鮮やかさが低い点＝表面で跳ねた白い光は、そのまま残す
      if (c <= c0) { continue; }
      let dh = Math.atan2(b, a) - hc;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      if (Math.abs(dh) < 0.01) { if (c - c0 > BIG_SHIFT) wide++; continue; }
      // 色合いのずれを広げる。折り返す上限は「元のずれ」と 28度 の大きい方。
      //
      // 前は 28度 で決め打ちに折り返していた。すると、元から 28度 より外にあった面
      // ——緑の石の水色、紫の石の紅紫——が内側へ引き込まれ、
      // 虹を濃くするはずの処理が虹を減らしていた（実測: 元のずれから平均13〜21度ぶん
      // 内側へ、石の色の重みの4〜17%が縮んでいた）。
      // 元からある色合いのずれは決して縮めない。
      const lim = Math.max(Math.abs(dh), keep);
      let nh = dh * k;
      if (nh > lim) nh = lim;
      if (nh < -lim) nh = -lim;
      // k が 1 未満でも縮めない
      if (Math.abs(nh) < Math.abs(dh)) nh = dh;
      // 回した先が画面に収まらない時は、鮮やかさを削るのではなく回す角を戻す。
      // 削ると人の色が薄くなる（黄の石で鮮やかさが2割落ちた）。
      // 戻す先は「元のずれ」まで。元の色は必ず画面に収まっているので、
      // そこより内側へ戻る心配がない
      let ha = hc + nh;
      if (!inGamut(L, Math.cos(ha) * c, Math.sin(ha) * c)) {
        let lo2 = dh, hi2 = nh;
        for (let t2 = 0; t2 < 4; t2++) {
          const mid2 = (lo2 + hi2) / 2;
          if (inGamut(L, Math.cos(hc + mid2) * c, Math.sin(hc + mid2) * c)) lo2 = mid2;
          else hi2 = mid2;
        }
        ha = hc + lo2;
      }
      na = Math.cos(ha) * c;
      nb = Math.sin(ha) * c;
    }
    if (Math.hypot(na - a0, nb - b0) > BIG_SHIFT) wide++;
    labToRgbClamped(L, na, nb, out);
    d[i] = srgbLut[Math.max(0, Math.min(1024, (out[0] * 1024) | 0))];
    d[i + 1] = srgbLut[Math.max(0, Math.min(1024, (out[1] * 1024) | 0))];
    d[i + 2] = srgbLut[Math.max(0, Math.min(1024, (out[2] * 1024) | 0))];
  }
  bx.putImageData(img, 0, 0);
  boostKey = want;
  boostStat = { wide, n, ms: performance.now() - t0 };
  return boostCv;
}

/** 直前に広げたときの控え。虹に見える面の量と、かかった時間 */
export function boostInfo(): { wideRatio: number; ms: number } {
  return { wideRatio: boostStat.n ? boostStat.wide / boostStat.n : 0, ms: boostStat.ms };
}

/* ---------------------------------------------------------------------------
 * 白く飛んだ小さな面のあふれ
 *   面の中でとくに明るく、かつ小さい面にだけ、柔らかいあふれを足す。
 *   大きな面をまるごと光らせると白い塊になるので、広さで弾く。
 * ------------------------------------------------------------------------ */
export type BrightBlob = { u: number; v: number; r: number; power: number };

export function findBrightFacets(sprite: HTMLCanvasElement, maxArea: number, key = ""): BrightBlob[] {
  const d = detPixels(sprite, key);
  const n = DET_PX * DET_PX;
  const hot = new Uint8Array(n);
  const lums: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (d[o + 3] < 200) continue;
    lums.push((0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255);
  }
  if (!lums.length) return [];
  lums.sort((p, q) => p - q);
  const cut = lums[Math.floor(lums.length * 0.90)];
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (d[o + 3] < 200) continue;
    if ((0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255 >= cut) hot[i] = 1;
  }
  // つながった塊に分ける
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const out: BrightBlob[] = [];
  for (let i = 0; i < n; i++) {
    if (!hot[i] || seen[i]) continue;
    let top = 0;
    stack[top++] = i;
    seen[i] = 1;
    let area = 0, sx = 0, sy = 0, sl = 0;
    while (top) {
      const q = stack[--top];
      const qy = (q / DET_PX) | 0;
      const qx = q - qy * DET_PX;
      area++;
      sx += qx;
      sy += qy;
      sl += (0.2126 * d[q * 4] + 0.7152 * d[q * 4 + 1] + 0.0722 * d[q * 4 + 2]) / 255;
      if (qx > 0 && hot[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack[top++] = q - 1; }
      if (qx < DET_PX - 1 && hot[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack[top++] = q + 1; }
      if (qy > 0 && hot[q - DET_PX] && !seen[q - DET_PX]) { seen[q - DET_PX] = 1; stack[top++] = q - DET_PX; }
      if (qy < DET_PX - 1 && hot[q + DET_PX] && !seen[q + DET_PX]) { seen[q + DET_PX] = 1; stack[top++] = q + DET_PX; }
    }
    // 広い面は外す。まるごと光らせると白い塊になる
    if (area < 6 || area > maxArea) continue;
    out.push({
      u: sx / area / DET_PX,
      v: sy / area / DET_PX,
      r: Math.sqrt(area / Math.PI) / DET_PX,
      power: Math.min(1, sl / area),
    });
  }
  return out;
}
