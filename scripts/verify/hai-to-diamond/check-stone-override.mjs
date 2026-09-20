// 手元の開発サーバーで harness/stone-override.html を開き、結果を読む。サーバーは呼ぶ側で立てて止める。
// 使い方: `node scripts/verify/hai-to-diamond/check-stone-override.mjs`（BASE は環境変数で差し替え可能。省略時は手元の開発サーバー）
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5199';
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(BASE + '/scripts/verify/hai-to-diamond/harness/stone-override.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.__overrideCheck, null, { timeout: 150000 });
const r = await page.evaluate(() => window.__overrideCheck);
await browser.close();
console.log(JSON.stringify(r, null, 1));
if (errs.length) console.log('つまずき', errs);
const ok = !r.error && r.map['#fc4c02'] === '#df6f00' && r.map['#e70033'] === '#e70033' && r.map['#fdda24'] === '#fdda24'
  && r.orangeVsShifted.differing === 0 && r.orangeVsShifted.opaque > 0 && r.orangeVsRed.differing > 0;
console.log(ok ? '合' : '否');
process.exit(ok ? 0 : 1);
