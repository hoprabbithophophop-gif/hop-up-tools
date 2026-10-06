// 本番に置いた検収用の問題で、隠れた問題と画像の無い問題の扱いを確かめる。
//  紙: 「隠された・消された問題は URL を直接開いても中身が届かない」「URL を開くと『運営により非表示』の知らせが出る」
//      「画像を置けなかった問題の URL を X に貼っても、無い画像を指す札は出ない」
// 問題の番号は targets.json の hiddenPuzzleId（隠れた問題）・noImagePuzzleId（隠れていないが画像の無い問題）。
// どちらも中身は puzzleId の問題の写しという前提で、写し元のカギの文が画面に出ないことを見る。
// 無ければ「用意されていない」と出して飛ばす。棚には何も書かない（回も始めない）。
// 使い方: node scripts/verify/crossword/check-fixtures.mjs [サイト]（省略時は targets.json）
import { chromium } from 'playwright';
import { arg, outDir, puzzleLayout, TARGETS, BASE_DEFAULT, ID_DEFAULT } from './_lib.mjs';

const BASE = arg(2, BASE_DEFAULT);
const OUT = outDir('check-fixtures');
const HIDDEN = TARGETS.hiddenPuzzleId;
const NOIMG = TARGETS.noImagePuzzleId;
let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};

// 1. 隠れた問題
if (!HIDDEN) {
  console.log('飛ばす 隠れた問題: targets.json に hiddenPuzzleId が用意されていない');
} else {
  const { clueTexts } = await puzzleLayout(BASE, ID_DEFAULT);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const bodies = [];
  page.on('response', async (r) => {
    if (r.url().includes('/rest/v1/crossword_puzzles') && r.url().includes(`id=eq.${HIDDEN}`)) {
      try { bodies.push(await r.json()); } catch { /* 読めない返事は数えない */ }
    }
  });
  await page.goto(`${BASE}/crossword/${HIDDEN}`);
  const shown = await page.getByText(/非表示/).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
  await page.waitForTimeout(1500);
  const text = await page.evaluate(() => document.body.innerText);
  const msg = (text.split(/\r?\n/).find((l) => l.includes('非表示')) || '').trim();
  check(shown, `隠れた問題を開くと非表示の知らせが出る: 「${msg}」`);
  const leaked = clueTexts.filter((c) => text.includes(c));
  check(leaked.length === 0, `隠れた問題のカギは画面に出ない（写し元のカギ ${clueTexts.length} 本のうち出た数 ${leaked.length}）`);
  const rows = bodies.flat();
  check(rows.every((r) => !r?.body), `隠れた問題の本文はブラウザに届かない（棚からの返事 ${bodies.length} 回・本文つきの行 ${rows.filter((r) => r?.body).length}）`);
  check((await page.locator('[id^="cell-"]').count()) === 0, '隠れた問題の盤は出ない');
  await page.screenshot({ path: `${OUT}/hidden.png` });
  await browser.close();
}

// 2. 画像の無い問題を X の取りに来る係（Twitterbot）として取る
if (!NOIMG) {
  console.log('飛ばす 画像の無い問題: targets.json に noImagePuzzleId が用意されていない');
} else {
  const res = await fetch(`${BASE}/crossword/${NOIMG}`, { headers: { 'User-Agent': 'Twitterbot/1.0' } });
  const html = await res.text();
  const title = (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1];
  check(res.status === 200, `画像の無い問題の URL は 200: ${res.status}`);
  check(Boolean(title), `og:title がある: ${title}`);
  check(!/property="og:image"/.test(html) && !/name="twitter:image"/.test(html), 'og:image・twitter:image が無い（無い画像を指す札を出さない）');
  const card = (html.match(/<meta name="twitter:card" content="([^"]*)"/) || [])[1];
  console.log(`   twitter:card = ${card}`);
  // 比べ（合否には入れない）: 写し元の問題で同じ取り方をすると og:image が付くか
  const ref = await (await fetch(`${BASE}/crossword/${ID_DEFAULT}`, { headers: { 'User-Agent': 'Twitterbot/1.0' } })).text();
  console.log(`   比べ: 写し元 ${ID_DEFAULT} の og:image ${/property="og:image"/.test(ref) ? 'あり' : 'なし'}`);
}

console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
