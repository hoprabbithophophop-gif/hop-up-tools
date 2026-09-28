// 灰toダイヤモンドの入口に、お知らせのリンクが出ていないこと・トップページには残っていることを、実際の画面で確かめる。
// 使い方: `node scripts/verify/hai-to-diamond/check-entry.mjs [住所]`（省略時は本番）
// スクリーンショットの置き場は環境変数 VERIFY_OUT があればそこ、無ければ端末の一時置き場の下
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.argv[2] || 'https://feature-hai-to-diamond.hop-up-tools.pages.dev';
const OUT_ROOT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'hai-to-diamond-verify');
const OUT = path.join(OUT_ROOT, 'entry-check');
mkdirSync(OUT, { recursive: true });
const tag = BASE.includes('feature-') ? 'preview' : 'prod';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(BASE + '/hai-to-diamond/kiyono/2', { waitUntil: 'networkidle' });
const opened = await page.waitForFunction(() => document.body.innerText.includes('はじまります'), null, { timeout: 120000 }).then(() => true, () => false);
await page.waitForTimeout(2500);
const entryText = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: path.join(OUT, `${tag}-entry-kiyono.png`) });
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
const topText = await page.evaluate(() => document.body.innerText);
await browser.close();
const r = {
  入口が開いた: opened,
  入口にお知らせのリンクが無い: !entryText.includes('お知らせ：再生回数の件について'),
  入口に題字がある: entryText.includes('灰toダイヤモンド'),
  入口に副題がある: entryText.includes('#銀河to銀河届けよ'),
  トップページにはお知らせのリンクが残っている: topText.includes('お知らせ：再生回数の件について'),
  つまずき: errs.length ? errs : 'なし',
};
console.log(JSON.stringify(r, null, 1));
const ok = r.入口が開いた && r.入口にお知らせのリンクが無い && r.入口に題字がある && r.入口に副題がある && r.トップページにはお知らせのリンクが残っている && !errs.length;
console.log(ok ? '合' : '否');
process.exit(ok ? 0 : 1);
