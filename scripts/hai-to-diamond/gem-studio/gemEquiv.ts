/* 【使い捨て】写した描き手（gemStudioRenderer.ts）と、本番の描き手
 * （src/pages/hai-to-diamond/gemRenderer.ts）が、同じ姿勢で本当に同じ絵になるかを確かめる。
 * 回転の並べ方を1か所でも取り違えていれば、ここで差が出る。 */
import { startBake } from "../../../src/pages/hai-to-diamond/gemRenderer";
import { renderGem, poseFitBounds, GEM_FIT, gemBoundRadius } from "../ogp-card/gemStudioRenderer";

const PX = 320;
const HEX = "#da1884";
const TILT = (26 * Math.PI) / 180;
const SPIN = 0.9; // 倒すだけでなく回しも入れて確かめる

const ct = Math.cos(TILT), st = Math.sin(TILT);
const cs = Math.cos(SPIN), ss = Math.sin(SPIN);
// 本番の setPose が組むのと同じ 3x3（行の順）
const ROWS = [cs, ss * st, ss * ct, 0, ct, -st, -ss, cs * st, cs * ct];

function pixels(cv: HTMLCanvasElement): Uint8ClampedArray {
  return cv.getContext("2d")!.getImageData(0, 0, cv.width, cv.height).data;
}

const out = document.getElementById("out")!;
try {
  const fit = poseFitBounds([{ tilt: TILT, spin: SPIN }]);
  if (!fit) throw new Error("枠を出せなかった");

  const job = startBake(HEX, PX, [{ tilt: TILT, spin: SPIN }], "equiv-" + Date.now());
  if (!job) throw new Error("本番の描き手が使えない");
  while (!job.finished) job.advance(1e9);
  const a = job.frames[0];

  const b = renderGem({ hex: HEX, px: PX, rot: ROWS, half: fit.half / GEM_FIT, cx: fit.cx, cy: fit.cy });
  if (!b) throw new Error("写しの描き手が使えない");

  const da = pixels(a), db = pixels(b);
  let maxDiff = 0, sum = 0, opaque = 0;
  for (let i = 0; i < da.length; i++) {
    const d = Math.abs(da[i] - db[i]);
    if (d > maxDiff) maxDiff = d;
    sum += d;
    if (i % 4 === 3 && da[i] > 8) opaque++;
  }
  const meanDiff = sum / da.length;

  document.getElementById("a")!.appendChild(a);
  document.getElementById("b")!.appendChild(b);
  // 枠の取り方のちがい。本番はその姿勢ごとにぴったり、調整ツールはどの向きでも同じ大きさ
  const tight26 = poseFitBounds([{ tilt: TILT, spin: 0 }])!;
  const fitTight = tight26.half / GEM_FIT;
  const fitSphere = gemBoundRadius() / GEM_FIT;
  const sizeRatio = fitSphere / fitTight; // 同じ sizePx でも、この倍率のぶん石が小さく見える

  out.textContent =
    `maxDiff=${maxDiff} meanDiff=${meanDiff.toFixed(4)} opaquePixels=${opaque}` +
    ` ／ 本番の枠(26度) half=${fitTight.toFixed(4)} 調整ツールの枠 half=${fitSphere.toFixed(4)}` +
    ` 見かけの倍率=${(1 / sizeRatio).toFixed(4)}`;
  Object.assign(window as unknown as Record<string, unknown>, {
    __equiv: { maxDiff, meanDiff, opaque, px: PX, fitTight, fitSphere, apparent: 1 / sizeRatio },
    __equivReady: true,
  });
} catch (e) {
  out.textContent = "だめだった: " + (e instanceof Error ? e.message : String(e));
  Object.assign(window as unknown as Record<string, unknown>, {
    __equivError: e instanceof Error ? e.message : String(e),
    __equivReady: true,
  });
}
