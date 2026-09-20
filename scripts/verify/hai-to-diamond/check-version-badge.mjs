// 灰toダイヤモンドの入口の右下に版番号が出ているか・動画に重なっていないかを、実際の画面で確かめる。
// 使い方: `node scripts/verify/hai-to-diamond/check-version-badge.mjs [住所] [欲しい文字]`（省略時は手元の開発サーバーと v.dev）
// スクリーンショットの置き場は環境変数 VERIFY_OUT があればそこ、無ければ端末の一時置き場の下
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.argv[2] || 'http://localhost:5199';
const WANT = process.argv[3] || 'v.dev';
const OUT_ROOT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'hai-to-diamond-verify');
const OUT = path.join(OUT_ROOT, 'entry-check');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(BASE + '/hai-to-diamond', { waitUntil: 'load' });
const opened = await page.waitForFunction(() => document.body.innerText.includes('はじまります'), null, { timeout: 120000 }).then(() => true, () => false);
await page.waitForTimeout(1500);
const r = await page.evaluate((want) => {
  const el = [...document.querySelectorAll('span')].find((s) => s.textContent.trim().startsWith('v.'));
  const frame = document.querySelector('iframe');
  const b = el?.getBoundingClientRect();
  const f = frame?.getBoundingClientRect();
  const overlap = b && f ? !(b.right < f.left || b.left > f.right || b.bottom < f.top || b.top > f.bottom) : null;
  return {
    文字: el?.textContent.trim() ?? null,
    欲しい文字と同じ: el?.textContent.trim() === want,
    右下にある: b ? b.right > innerWidth - 40 && b.bottom > innerHeight - 40 : false,
    動画と重なっている: overlap,
    押せない: el ? getComputedStyle(el).pointerEvents === 'none' : null,
  };
}, WANT);
await page.screenshot({ path: path.join(OUT, 'version-badge.png'), clip: { x: 190, y: 744, width: 200, height: 100 } });
await browser.close();
console.log(JSON.stringify({ 入口が開いた: opened, ...r, つまずき: errs.length ? errs : 'なし' }, null, 1));
const ok = opened && r.欲しい文字と同じ && r.右下にある && r.動画と重なっている === false && r.押せない && !errs.length;
console.log(ok ? '合' : '否');
process.exit(ok ? 0 : 1);
