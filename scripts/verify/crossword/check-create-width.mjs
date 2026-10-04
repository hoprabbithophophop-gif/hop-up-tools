// 作る画面の入力欄のまとまりの幅を、画面の幅ごとに測ってスクショを撮る
// 使い方: node scripts/verify/crossword/check-create-width.mjs [サイト] [スクショの置き場]（省略時は targets.json と一時置き場）
import { chromium } from 'playwright';
import { arg, outDir, BASE_DEFAULT } from './_lib.mjs';

const BASE = arg(2, BASE_DEFAULT);
const OUT = outDir('check-create-width', process.argv[3]);
let fail = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
  if (!ok) fail++;
};
const browser = await chromium.launch();
for (const w of [390, 960, 1280]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: 900 } })).newPage();
  await page.goto(`${BASE}/crossword/create`);
  await page.getByPlaceholder('例: 猫の鳴き声').waitFor();
  await page.waitForTimeout(2500);
  const panel = await page.getByPlaceholder('例: 猫の鳴き声').evaluate((el) => {
    let p = el;
    while (p && !p.className.includes('max-w-[640px]')) p = p.parentElement;
    const r = p?.getBoundingClientRect();
    return r ? { left: Math.round(r.left), width: Math.round(r.width), right: Math.round(window.innerWidth - r.right) } : null;
  });
  const noSide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(Boolean(panel) && panel.left >= 0 && panel.right >= 0 && noSide, `幅 ${w}px: 入力欄のまとまりが画面に収まり横にはみ出さない ${JSON.stringify(panel)}`);
  await page.screenshot({ path: `${OUT}/create-width-${w}.png` });
  await page.context().close();
}
await browser.close();
console.log(fail ? `NG ${fail}件` : 'すべてOK', OUT);
process.exit(fail ? 1 : 0);
