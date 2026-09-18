/**
 * 【試作】OGP の絵の中に数字を押す。
 *
 * 絵を一から描くと無料枠の作業時間（1回10ミリ秒）に収まらないので、描かない。
 * 下絵は「無圧縮で、65535バイトごとに IDAT を分けた PNG」として先に作って置いてある（scratchpad の build-stamp-assets.mjs）。
 * ここでやるのは、数字の所だけ点を書き換え、触った塊の検算値（CRC と Adler）だけをやり直すこと。
 * 触っていない塊の検算値は下ごしらえの時の控えをそのまま使い、Adler は足し合わせの公式でつなぐ。
 */

export type StampMeta = {
  w: number; h: number; row: number; blk: number; adlerOff: number;
  blocks: { typeOff: number; dataOff: number; len: number; crcOff: number; adler: number }[];
};
export type GlyphMeta = { h: number; map: Record<string, { off: number; w: number }> };

const CRC_T = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_T[n] = c >>> 0;
}
function crc32(buf: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function adler32(buf: Uint8Array, from: number, to: number): number {
  let a = 1, b = 0;
  for (let i = from; i < to;) {
    const end = Math.min(to, i + 3800);
    for (; i < end; i++) { a += buf[i]; b += a; }
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}
/** zlib の adler32_combine と同じ。前の分 a1 に、長さ len2 の後ろの分 a2 をつなぐ */
function adlerCombine(a1: number, a2: number, len2: number): number {
  const BASE = 65521;
  const rem = len2 % BASE;
  let s1 = a1 & 0xffff;
  let s2 = (rem * s1) % BASE;
  s1 += (a2 & 0xffff) + BASE - 1;
  s2 += (a1 >>> 16) + (a2 >>> 16) + BASE - rem;
  if (s1 >= BASE) s1 -= BASE;
  if (s1 >= BASE) s1 -= BASE;
  if (s2 >= BASE * 2) s2 -= BASE * 2;
  if (s2 >= BASE) s2 -= BASE;
  return ((s2 << 16) | s1) >>> 0;
}
function putU32(arr: Uint8Array, off: number, v: number) {
  arr[off] = v >>> 24; arr[off + 1] = (v >>> 16) & 255; arr[off + 2] = (v >>> 8) & 255; arr[off + 3] = v & 255;
}

/**
 * @param png   下絵（この配列をそのまま書き換える。呼ぶ側で毎回新しく読むこと）
 * @param parts 左から順に押す判子の名前（'1','2',',','個 降らせました' など）
 * @param cx    押す行の中心 x
 * @param top   押す行の上端 y
 * @param rgb   文字の色
 */
export function stamp(
  png: Uint8Array, meta: StampMeta, sheet: Uint8Array, gm: GlyphMeta,
  parts: string[], cx: number, top: number, rgb: [number, number, number],
): Uint8Array {
  const glyphs = parts.map((p) => gm.map[p]).filter(Boolean);
  const totalW = glyphs.reduce((s, g) => s + g.w, 0);
  let x0 = Math.round(cx - totalW / 2);
  const touched = new Set<number>();
  // 点の並びの i 番目が、ファイルのどこにあるか
  const fileOff = (i: number) => { const k = Math.floor(i / meta.blk); touched.add(k); return meta.blocks[k].dataOff + (i - k * meta.blk); };
  for (const g of glyphs) {
    for (let gy = 0; gy < gm.h; gy++) {
      const y = top + gy;
      if (y < 0 || y >= meta.h) continue;
      for (let gx = 0; gx < g.w; gx++) {
        const a = sheet[g.off + gy * g.w + gx];
        if (a === 0) continue;
        const x = x0 + gx;
        if (x < 0 || x >= meta.w) continue;
        // 1つの点（3バイト）が塊の境目をまたぐことがあるので、1バイトずつ場所を引く
        const i = y * meta.row + 1 + x * 3;
        const o = fileOff(i), o1 = fileOff(i + 1), o2 = fileOff(i + 2);
        const ia = 255 - a;
        png[o] = (png[o] * ia + rgb[0] * a + 127) / 255 | 0;
        png[o1] = (png[o1] * ia + rgb[1] * a + 127) / 255 | 0;
        png[o2] = (png[o2] * ia + rgb[2] * a + 127) / 255 | 0;
      }
    }
    x0 += g.w;
  }
  // 触った塊だけ検算をやり直し、Adler は全部の塊をつなぎ直す
  let total = 0;
  meta.blocks.forEach((b, k) => {
    let ad = b.adler;
    if (touched.has(k)) {
      ad = adler32(png, b.dataOff, b.dataOff + b.len);
      putU32(png, b.crcOff, crc32(png, b.typeOff, b.crcOff));
    }
    total = k === 0 ? ad : adlerCombine(total, ad, b.len);
  });
  putU32(png, meta.adlerOff, total);
  putU32(png, meta.adlerOff + 4, crc32(png, meta.adlerOff - 4, meta.adlerOff + 4));
  return png;
}
