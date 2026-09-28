// 本番のほかのページが、ブラウザで実際に開けるかを確かめる。
// 使い方: `node scripts/verify/hai-to-diamond/check-other-pages.mjs [住所]`（省略時は本番）
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'https://hop-up-tools.pages.dev';
const browser = await chromium.launch();
let ng = 0;
for (const p of ['/', '/hi-tension', '/youtube', '/fc-ticket', '/the-ballad', '/news/2026-09-11-play-count']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  const res = await page.goto(BASE + p, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(5000);
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').trim();
  const ok = text.length > 20 && !errs.length;
  if (!ok) ng++;
  console.log(`${ok ? '合' : '否'} ${p} ／ 応答 ${res.status()} ／ 画面の文字 ${text.length}字「${text.slice(0, 28)}…」${errs.length ? ' ／ つまずき ' + errs.join(' | ') : ''}`);
  await page.close();
}
await browser.close();
process.exit(ng ? 1 : 0);
