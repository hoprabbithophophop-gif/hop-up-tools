// 【使い捨て】2つの確かめ。
//  ① 構図1・構図2 が、調整台の型1・型2 と本当に1画素も違わないか
//     （同じ種を当てて撮り、点の差を測る）
//  ② 大きい石で「内部の細かさ(superSample)」と「石の絵の上限」が
//     描く時間にどれだけ効くか（ミリ秒）
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, mkdirSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
const DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
const OUT = process.env.OGP_COMP_OUT || DIR + '/out/same';
mkdirSync(OUT, { recursive: true });

const req = createRequire(ROOT + '/package.json');
const pw = await import(pathToFileURL(req.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;
const GL = ['--use-gl=angle', '--use-angle=default', '--ignore-gpu-blocklist'];

const b = await chromium.launch({ args: GL });
const p = await b.newPage({ viewport: { width: 2200, height: 1100 }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('[つまずき]', e.message));
await p.goto(pathToFileURL(DIR + '/out/ogp-comp.bundle.html').href, { waitUntil: 'load' });
await p.waitForFunction(() => window.__studioReady === true);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1300);

const hiNow = () => p.evaluate(() => window.__compHiDraws ?? 0);
async function waitHi(before) {
  await p.waitForFunction((x) => (window.__compHiDraws ?? 0) > x, before, { timeout: 120000 });
  await p.waitForTimeout(800);
}

// ① 同じ種で、新しい構図と元の型を撮り比べる
const PAIRS = [['c1', 'l1', 2738785948], ['c2', 'l2', 1096884426]];
const shots = [];
for (const [a, c, seed] of PAIRS) {
  for (const key of [a, c]) {
    await p.evaluate((k) => window.__studioLayout.set(k), key);
    await p.waitForTimeout(700);
    await p.evaluate(() => {
      const s = JSON.parse(window.__studioExport());
      s.member = { id: 'nishida', hex: '#da1884' };
      window.__studioImport(JSON.stringify(s));
    });
    await p.waitForTimeout(500);
    const b0 = await hiNow();
    await p.evaluate((s) => window.__studioShuffle.apply(s), seed);
    await waitHi(b0);
    const path = `${OUT}/${key}-${seed}.png`;
    await p.locator('#gs-cardbox').screenshot({ path });
    shots.push([key, path]);
    console.log('撮った', key, seed);
  }
}

// ② 描く時間。石の絵を作り直させてから測る
console.log('\n--- 描く時間（大きさ1100・石の絵の上限は外した状態） ---');
for (const ss of [1, 2, 3]) {
  const b0 = await hiNow();
  await p.evaluate((n) => {
    window.__studioLayout.set('c3');
    window.__compTune.setSpriteMax(4000);
    window.__compTune.setSS(n);
    window.__compTune.redrawGem();
  }, ss);
  await waitHi(b0);
  // 同じ設定でもう一度だけ作り直して、落ち着いた値を取る
  const b1 = await hiNow();
  await p.evaluate(() => window.__compTune.redrawGem());
  await waitHi(b1);
  const r = await p.evaluate(() => ({ ms: window.__compTune.lastMs(), px: window.__compTune.lastPx(), ss: window.__compTune.ss() }));
  console.log(`内部の細かさ ×${r.ss}／石の絵 ${r.px}px → ${r.ms.toFixed(0)}ミリ秒`);
}
for (const [max, size] of [[860, 1100], [4000, 1100], [4000, 780]]) {
  const b0 = await hiNow();
  await p.evaluate(({ max, size }) => {
    window.__compTune.setSS(2);
    window.__compTune.setSpriteMax(max);
    window.__compTune.setGem(240, 250, size);
    window.__compTune.redrawGem();
  }, { max, size });
  await waitHi(b0);
  const b1 = await hiNow();
  await p.evaluate(() => window.__compTune.redrawGem());
  await waitHi(b1);
  const r = await p.evaluate(() => ({ ms: window.__compTune.lastMs(), px: window.__compTune.lastPx() }));
  console.log(`石の大きさ${size}・絵の上限${max} → 実際に描いたのは ${r.px}px・${r.ms.toFixed(0)}ミリ秒`);
}

// ①の比べ
const diff = async (x, y) => {
  const d1 = 'data:image/png;base64,' + readFileSync(x).toString('base64');
  const d2 = 'data:image/png;base64,' + readFileSync(y).toString('base64');
  return p.evaluate(async ([u1, u2]) => {
    const load = (u) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = u; });
    const [i1, i2] = await Promise.all([load(u1), load(u2)]);
    const g = (im) => { const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
      const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(im, 0, 0); return c.getImageData(0, 0, cv.width, cv.height).data; };
    const A = g(i1), B = g(i2);
    let sum = 0, max = 0, diffPx = 0, n = 0;
    for (let k = 0; k < A.length; k += 4) {
      const d = Math.max(Math.abs(A[k] - B[k]), Math.abs(A[k + 1] - B[k + 1]), Math.abs(A[k + 2] - B[k + 2]));
      sum += d; if (d > max) max = d; if (d > 0) diffPx++; n++;
    }
    return { mean: sum / n, max, diffPx, n };
  }, [d1, d2]);
};
console.log('\n--- 構図1と型1／構図2と型2 の撮り比べ ---');
for (let i = 0; i < shots.length; i += 2) {
  const r = await diff(shots[i][1], shots[i + 1][1]);
  console.log(`${shots[i][0]} と ${shots[i + 1][0]}: 違う点 ${r.diffPx}個/${r.n}個 ／ いちばん大きい差 ${r.max} ／ 平均 ${r.mean.toFixed(4)}`);
}
await b.close();
