// 隠れた問題と画像の無い問題の扱いを確かめる。本番にもプレビューにも問題を置かない（2026-10-19 Hop「本番環境から見える形で検収用パズル登録を二度とするな」）。
//  紙: 「隠された・消された問題は URL を直接開いても中身が届かない」「URL を開くと『運営により非表示』の知らせが出る」
//      「画像を置けなかった問題の URL を X に貼っても、無い画像を指す札は出ない」
// 1. 隠れた問題: targets.json の hiddenPuzzleId（本番にもとからある、隠れた問題）をサイトで開いて読むだけ。棚には何も書かない（回も始めない）
//    この問題の隠れた印が外されると NG になる。その時は別の隠れた問題の番号に替える（作って置かない）
// 2. 画像の無い問題: X の取りに来る係に返す札の受付係（functions/crossword/[id].ts）を手元で動かし、作り物の棚に置いた問題で確かめる（_localFunctions.mjs）
// 使い方: node scripts/verify/crossword/check-fixtures.mjs [サイト]（省略時は targets.json）
import { chromium } from 'playwright';
import { arg, outDir, TARGETS, BASE_DEFAULT } from './_lib.mjs';
import { openFunctions, fakeShelf, callFunction, installHtmlRewriter } from './_localFunctions.mjs';

const BASE = arg(2, BASE_DEFAULT);
const OUT = outDir('check-fixtures');
const HIDDEN = TARGETS.hiddenPuzzleId;
let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};

// 1. 隠れた問題（読むだけ）
if (!HIDDEN) {
  check(false, '隠れた問題: targets.json に hiddenPuzzleId が無い');
} else {
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
  const rows = [bodies].flat(2);
  check(rows.every((r) => !r?.body), `隠れた問題の本文はブラウザに届かない（棚からの返事 ${bodies.length} 回・本文つきの行 ${rows.filter((r) => r?.body).length}）`);
  check((await page.locator('[id^="cell-"]').count()) === 0, '隠れた問題の盤は出ない');
  await page.screenshot({ path: `${OUT}/hidden.png` });
  await browser.close();
}

// 2. 画像の無い問題を X の取りに来る係（Twitterbot）として取る（手元の受付係＋作り物の棚）
{
  installHtmlRewriter();
  const fns = await openFunctions();
  try {
    const onRequest = (await fns.load('functions/crossword/[id].ts')).onRequest;
    const shelf = fakeShelf();
    const clues = [
      { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: 'ネコ', answer: ['ネ', 'コ'], hint: { kind: 'link', url: 'https://example.com/' } },
      { clueIndex: 2, direction: 'vertical', startX: 1, startY: 0, clue: 'コイ', answer: ['コ', 'イ'], hint: { kind: 'link', url: 'https://example.com/' } },
    ];
    const key = 'k'.repeat(64);
    shelf.addPuzzle({ id: 'LocalNoI', key, title: '画像の無い確かめ用', width: 2, height: 2, clues });
    shelf.addPuzzle({ id: 'LocalImg', key, title: '画像のある確かめ用', width: 2, height: 2, clues });
    shelf.images.add('LocalImg');
    const assets = { fetch: async () => new Response('<!doctype html><html><head><title>t</title></head><body></body></html>', { headers: { 'Content-Type': 'text/html' } }) };
    const get = (id) => callFunction(onRequest, shelf, { path: `/crossword/${id}`, method: 'GET', headers: { 'User-Agent': 'Twitterbot/1.0' }, params: { id }, assets });

    const r = await get('LocalNoI');
    const title = (r.text.match(/<meta property="og:title" content="([^"]*)"/) || [])[1];
    check(r.status === 200, `画像の無い問題の URL は 200: ${r.status}`);
    check(title === '画像の無い確かめ用', `og:title がある: ${title}`);
    check(!/property="og:image"/.test(r.text) && !/name="twitter:image"/.test(r.text), 'og:image・twitter:image が無い（無い画像を指す札を出さない）');
    console.log(`   twitter:card = ${(r.text.match(/<meta name="twitter:card" content="([^"]*)"/) || [])[1]}`);
    // 比べ: 画像のある問題では og:image が付く（確かめの仕組みが画像の有無を見分けられることの確かめ）
    const ref = await get('LocalImg');
    check(/property="og:image"/.test(ref.text), '比べ: 画像のある問題には og:image が付く');
    check(shelf.outside.length === 0, `外への通信は無い${shelf.outside.length ? `（${shelf.outside[0]}）` : ''}`);
  } finally {
    await fns.close();
  }
}

console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
