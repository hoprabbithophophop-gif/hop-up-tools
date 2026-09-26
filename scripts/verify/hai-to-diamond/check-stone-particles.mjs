// 手元の開発サーバーで harness/stone-particles.html を開き、測った結果を読んで、見本の絵を PNG に撮る。
// サーバーは呼ぶ側で立てて止める（5199 は verify-all が使うので、既定は 5197）。
// 使い方: `node scripts/verify/hai-to-diamond/check-stone-particles.mjs`（BASE・OUT は環境変数で差し替え可能）
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const BASE = process.env.BASE || 'http://localhost:5197';
const OUT = process.env.OUT || path.join(os.tmpdir(), 'hai-to-diamond-stone');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1520, height: 1000 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(BASE + '/scripts/verify/hai-to-diamond/harness/stone-particles.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.__stoneCheck, null, { timeout: 60000 });
const r = await page.evaluate(() => window.__stoneCheck);
const all = path.join(OUT, 'stone-particles-all.png');
await page.screenshot({ path: all, fullPage: true });
// 1枚ずつも撮る（目で見やすいように）
const figs = await page.$$('figure');
for (let i = 0; i < figs.length; i++) {
  await figs[i].screenshot({ path: path.join(OUT, `stone-particles-${String(i + 1).padStart(2, '0')}.png`) });
}
await browser.close();
for (const x of r.results) if (!x.ok) console.log('✗', x.name, x.detail);
if (errs.length) console.log('つまずき', errs);
console.log(`撮影 ${all} ほか ${figs.length}枚`);
console.log(`確かめ ${r.ok + r.ng}件 ／ 合 ${r.ok} ／ 否 ${r.ng}`);
process.exit(r.ng || errs.length ? 1 : 0);
