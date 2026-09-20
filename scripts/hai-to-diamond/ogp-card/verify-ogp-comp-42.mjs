// 【使い捨て】焼いた42枚(14色×3構図)と、焼いた時の決めごとを最後に確かめる。
// verify-ogp-comp.tmp.mjs の写し。違いは出力先(OUT)を今回の42枚ぶんの置き場にしただけ。
//  ・演出（きらめき・強い光）が既定のまま入っているか
//  ・反対の色の求め方
//  ・背景のにじみの量が、紙にある上限（最初の版の背景）を超えていないか
//  ・文字と背景の明るさの比
//  ・絵の四隅が透けていないか（角の丸みを落とした確かめ）
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
const DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
// 既定は道具フォルダの中の out/ogp-comp-42。環境変数 OGP_COMP_OUT があればそちらを読む
// （例: 42枚を焼いた元の置き場を指定して確かめ直す）。
const OUT = process.env.OGP_COMP_OUT || DIR + '/out/ogp-comp-42';
const shots = JSON.parse(readFileSync(OUT + '/shots.json', 'utf8'));

const req = createRequire(ROOT + '/package.json');
const pw = await import(pathToFileURL(req.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=default', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 2200, height: 1100 }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('[つまずき]', e.message));
await p.goto(pathToFileURL(DIR + '/out/ogp-comp.bundle.html').href, { waitUntil: 'load' });
await p.waitForFunction(() => window.__studioReady === true);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);

const base = await p.evaluate(() => ({
  sparkle: window.__studioState.sparkle,
  fire: window.__studioState.fire,
  glowMethod: window.__studioState.glow.method,
  glowSetKind: window.__studioState.glow.set.kind,
  layers: window.__studioState.layers,
  autoSpace: window.__studioState.auto.space,
  ref: window.__studioShuffle.reference(),
}));
console.log('きらめき', JSON.stringify(base.sparkle), '／ 強い光の演出', JSON.stringify(base.fire));
console.log('反対の色の求め方', base.glowMethod, '／ 背景の組', base.glowSetKind, '／ 層', JSON.stringify(base.layers), '／ 色の物差し', base.autoSpace);
console.log('紙にある上限（最初の版の背景を測った値）', JSON.stringify(base.ref));

for (const s of shots) {
  await p.evaluate((k) => window.__studioLayout.set(k), s.layout);
  await p.waitForTimeout(500);
  await p.evaluate(({ id, hex }) => {
    const st = JSON.parse(window.__studioExport());
    st.member = { id, hex };
    window.__studioImport(JSON.stringify(st));
  }, { id: s.id, hex: s.hex });
  await p.waitForTimeout(400);
  const b0 = await p.evaluate(() => window.__compHiDraws ?? 0);
  await p.evaluate((seed) => window.__studioShuffle.apply(seed), s.seed);
  await p.waitForFunction((x) => (window.__compHiDraws ?? 0) > x, b0, { timeout: 120000 });
  await p.waitForTimeout(700);
  const v = await p.evaluate(() => ({
    // にじみの濃さにはもう自動の絞り込みが掛かっているので、ここでは倍率1で測る
    amount: window.__studioLayout.amount(1, true),
    amountAll: window.__studioLayout.amount(1, false),
    contrast: window.__studioState.auto.minContrastAfter,
    comp: [window.__studioState.glow.comp.x, window.__studioState.glow.comp.y],
    capped: window.__studioState.auto.capped, shielded: window.__studioState.auto.shielded,
  }));
  console.log(
    s.file.padEnd(18),
    'にじみの浮き 鮮やかさ+' + v.amount.maxDC.toFixed(4) + '・明るさ+' + v.amount.maxDL.toFixed(4),
    '／ 合計C ' + v.amount.sumDC.toFixed(1) + '・合計L ' + v.amount.sumDL.toFixed(1),
    '／ 筋こみ 合計C ' + v.amountAll.sumDC.toFixed(1) + '・合計L ' + v.amountAll.sumDL.toFixed(1),
    '／ 明るさの比 ' + v.contrast.toFixed(2),
    '／ 反対の色の置き場 (' + v.comp.join(',') + ')'
  );
}

// 四隅が透けていないか（全42枚。1回のevaluateに全部渡すと重いので6枚ずつに分ける）
const CHUNK = 6;
const allShotsInfo = shots.map((s) => ({ name: s.file, url: 'data:image/png;base64,' + readFileSync(OUT + '/' + s.file).toString('base64') }));
const corner = [];
for (let i = 0; i < allShotsInfo.length; i += CHUNK) {
  const batch = allShotsInfo.slice(i, i + CHUNK);
  const res = await p.evaluate(async (files) => {
    const out = [];
    for (const f of files) {
      const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = f.url; });
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
      const pts = [[0, 0], [cv.width - 1, 0], [0, cv.height - 1], [cv.width - 1, cv.height - 1]];
      const alphas = pts.map(([px, py]) => x.getImageData(px, py, 1, 1).data[3]);
      out.push({ name: f.name, w: cv.width, h: cv.height, alphas });
    }
    return out;
  }, batch);
  corner.push(...res);
}
for (const c of corner) console.log('四隅の濃さ', c.name, c.w + 'x' + c.h, JSON.stringify(c.alphas), c.alphas.every((a) => a === 255) ? '（透けなし）' : '（透けあり）');

await b.close();
