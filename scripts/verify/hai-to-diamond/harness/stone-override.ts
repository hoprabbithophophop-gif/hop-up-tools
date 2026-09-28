// 石のオレンジの読み替えを、本番の焼きの道そのものを通して確かめる。
// 名簿のオレンジ(#fc4c02)を頼んだ絵が、#df6f00 を直接頼んだ絵と1点も違わないこと、
// 読み替えの対象でない色（赤・黄）は「その色を直接頼んだ絵」そのものであることを見る
import { requestStoneSpritesByHex, hasRealStoneSprites, getStoneSprites, stoneHexForBake } from "../../../../src/pages/hai-to-diamond/gemSprites";

const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const HEXES = ["#fc4c02", "#df6f00", "#e70033", "#fdda24"];

function pixels(c: HTMLCanvasElement): Uint8ClampedArray {
  const t = document.createElement("canvas");
  t.width = c.width; t.height = c.height;
  const cx = t.getContext("2d", { willReadFrequently: true })!;
  cx.drawImage(c, 0, 0);
  return cx.getImageData(0, 0, t.width, t.height).data;
}
function diffCount(a: HTMLCanvasElement[], b: HTMLCanvasElement[]): { frames: number; differing: number; opaque: number } {
  let differing = 0, opaque = 0;
  for (let i = 0; i < a.length; i++) {
    const pa = pixels(a[i]), pb = pixels(b[i]);
    for (let p = 0; p < pa.length; p += 4) {
      if (pa[p + 3] > 0) opaque++;
      if (pa[p] !== pb[p] || pa[p + 1] !== pb[p + 1] || pa[p + 2] !== pb[p + 2] || pa[p + 3] !== pb[p + 3]) differing++;
    }
  }
  return { frames: a.length, differing, opaque };
}

(async () => {
  try {
    for (const h of HEXES) requestStoneSpritesByHex(h, true);
    const t0 = performance.now();
    while (!HEXES.every((h) => hasRealStoneSprites(rgbOf(h)))) {
      if (performance.now() - t0 > 120000) throw new Error("焼きが2分で終わらない");
      await new Promise((r) => setTimeout(r, 100));
    }
    const s = Object.fromEntries(HEXES.map((h) => [h, getStoneSprites(rgbOf(h))]));
    (window as unknown as Record<string, unknown>).__overrideCheck = {
      map: Object.fromEntries(HEXES.map((h) => [h, stoneHexForBake(rgbOf(h))])),
      orangeVsShifted: diffCount(s["#fc4c02"], s["#df6f00"]),
      orangeVsRed: diffCount(s["#fc4c02"], s["#e70033"]),
      frames: s["#fc4c02"].length,
    };
  } catch (e) {
    (window as unknown as Record<string, unknown>).__overrideCheck = { error: String(e) };
  }
})();
