// 作る画面の入力欄のまとまりの幅を、画面の幅ごとに測ってスクショを撮る
// 使い方: node scripts/verify/crossword/check-create-width.mjs <サイト> <スクショの置き場>
import { chromium } from 'playwright';

const [BASE, OUT = '.'] = process.argv.slice(2);
const browser = await chromium.launch();
for (const w of [390, 960, 1280]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: 900 } })).newPage();
  await page.goto(`${BASE}/crossword`);
  await page.getByPlaceholder('例: 猫の鳴き声').waitFor();
  await page.waitForTimeout(2500);
  const panel = await page.getByPlaceholder('例: 猫の鳴き声').evaluate((el) => {
    let p = el;
    while (p && !p.className.includes('max-w-[640px]')) p = p.parentElement;
    const r = p?.getBoundingClientRect();
    return r ? { left: Math.round(r.left), width: Math.round(r.width), right: Math.round(window.innerWidth - r.right) } : null;
  });
  console.log(`幅 ${w}px: 入力欄のまとまり ${JSON.stringify(panel)}`);
  await page.screenshot({ path: `${OUT}/create-width-${w}.png` });
  await page.context().close();
}
await browser.close();
