// ミラーボールの席割りで使う「色の近さ」の物差しと、色ごとの居場所。
//
// 近さを画面の値（赤・緑・青の数字）の引き算で測ると、人の目が感じる近さとずれる。
// 赤と橙は数字の上では遠いのに目には近く、緑どうしは数字が離れていても同じ色に見える、といったことが起きる。
// そこで、目が感じる差がそのまま距離になるように作られた並べ方（OKLab）へ置き換えてから測る。
// 外の部品は使わず、変換の式をここに持つ。
//
// OKLab は色を3つの数で表す。
//   L … 明るさ（0=黒、1=白）
//   a, b … 色合いと鮮やかさ。原点(0,0)からの距離が鮮やかさ、原点まわりの角度が色合い（色相環の角度）

export type Rgb = [number, number, number];

/** 画面に出す時に曲げてある明るさを、まっすぐな明るさへ戻す */
function toLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

const oklabCache = new Map<string, [number, number, number]>();
/** 色を OKLab（明るさ・色合いの2軸）へ置き換える。同じ色は何度も計算せず控えを使い回す */
export function toOklab(rgb: Rgb): [number, number, number] {
  const key = rgb.join(",");
  const hit = oklabCache.get(key);
  if (hit) return hit;
  const r = toLinear(rgb[0]), g = toLinear(rgb[1]), b = toLinear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const out: [number, number, number] = [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
  oklabCache.set(key, out);
  return out;
}

/** 2色の目に見える近さ。小さいほど近い */
export function colorDistance(a: Rgb, b: Rgb): number {
  const p = toOklab(a), q = toOklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** 色合いを持たない（白・灰・黒）とみなす鮮やかさの境目。
 *  この値を下回ると色合いの角度は数字の揺れでしかなくなるので、色合いでは居場所を決めない */
const NEUTRAL_CHROMA = 0.03;

/** その色の居場所。
 *  lon … 球の経度（地球でいう縦の線）。色合いの角度をそのまま経度にする＝球が色相環になる。
 *         同じ色は同じ経度に集まって縦長の塊になり、隣の経度には色合いの近い色が来るので、
 *         塊どうしが隣り合った時に色が少しずつ移り変わって見える。
 *         緯度（南北）は決めない＝塊は北にも南にも伸びられる。
 *         緯度まで決めてしまうと、明るさが中くらいの色は帯のまん中に釘付けになり、
 *         そこはちょうど動画に隠れる高さなので、その色を選んだ人の板が1枚も見えなくなる
 *  lon が null … 色合いを持たない色（白）。居場所を決めない */
export type ColorHome = { lon: number | null };

/** 白（色合いを持たない色）には居場所を決めない。
 *  色合いが無い色は色相環のどこにも属さないので、経度を決める根拠が無い。
 *  1枚目は今までどおり散らばった順から取り、2枚目からはその隣へ伸びる＝白も塊にはなる。
 *  明るさから緯度を決めて極に置くやり方も試したが、球の天辺は動画に隠れない
 *  いちばんよく見える場所なので、白だけがそこを占め続けてしまった（2026-09-10 に見て取りやめ） */
export function colorHome(rgb: Rgb): ColorHome {
  const [, a, b] = toOklab(rgb);
  if (Math.hypot(a, b) < NEUTRAL_CHROMA) return { lon: null };
  return { lon: Math.atan2(b, a) };
}
