// ○ボタンで欄の選ばれ方が変わらないことと、「自分が作った問題」の別画面を確かめる
// 使い方: node scripts/verify/crossword/check-maru-mine.mjs [サイト] [スクショの置き場]（省略時は targets.json と一時置き場）
import { chromium } from 'playwright';
import path from 'node:path';
import { arg, outDir, BASE_DEFAULT } from './_lib.mjs';

const BASE = arg(2, BASE_DEFAULT);
const OUT = outDir('check-maru-mine', process.argv[3]);

let fail = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
  if (!ok) fail++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();

// 1. 作る画面の入口は、作った問題の数に関係なくいつも出る（紙: 作る画面には /crossword/mine の入口がいつも出る）
await page.goto(`${BASE}/crossword/create`);
const clue = page.getByPlaceholder('例: 猫の鳴き声').first();
await clue.waitFor();
check((await page.getByRole('link', { name: /自分が作った問題/ }).count()) === 1, '作った問題が無くても入口は出る');

// 2. 欄を選んだまま○を押す → 欄は選ばれたまま、文字の位置に入る
await clue.click();
await clue.fill('音大卒の伝道師');
await clue.evaluate((el) => el.setSelectionRange(3, 3));
const maru = page.getByRole('button', { name: '○を入れる' });
await maru.tap();
await maru.tap();
await maru.tap();
check((await clue.inputValue()) === '音大卒○○○の伝道師', `位置に入る: ${await clue.inputValue()}`);
check(await clue.evaluate((el) => document.activeElement === el), '押したあとも欄が選ばれたまま（キーボードが閉じない）');

// 3. 欄を選んでいないときに○を押す → 末尾に足すだけで、欄は選ばれない（キーボードが出ない）
await clue.evaluate((el) => el.blur());
await maru.tap();
check((await clue.inputValue()) === '音大卒○○○の伝道師○', `末尾に足す: ${await clue.inputValue()}`);
check(await clue.evaluate((el) => document.activeElement !== el), '欄が選ばれない（キーボードが出ない）');

// 4. 作った問題があると入口が出て、別の画面に一覧が出る
await page.evaluate(() =>
  localStorage.setItem(
    'crossword_my_puzzles',
    JSON.stringify([
      { id: 'AAAAAAAA', title: '試しの問題1', key: 'x'.repeat(64), createdAt: 1 },
      { id: 'BBBBBBBB', title: '試しの問題2', key: 'y'.repeat(64), createdAt: 2 },
    ])
  )
);
await page.goto(`${BASE}/crossword/create`);
await page.getByPlaceholder('例: 猫の鳴き声').first().waitFor();
check((await page.getByText('試しの問題1').count()) === 0, '作る画面に一覧は出ない');
const entry = page.getByRole('link', { name: /自分が作った問題/ });
check((await entry.count()) === 1, '作る画面に入口が出る');
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, '1-create-entry.png') });
await entry.click();
await page.waitForURL(/\/crossword\/mine$/);
await page.getByRole('heading', { name: '自分が作った問題' }).waitFor();
const titles = await page.locator('li .font-bold.truncate').allInnerTexts();
check(titles.join(',') === '試しの問題2,試しの問題1', `新しい順に並ぶ: ${titles.join(',')}`);
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '2-mine.png'), fullPage: true });
check((await page.getByText('非表示になっています').count()) === 2, '棚に無い問題は「非表示になっています」');

// 5. 消す？→やめる で戻る（実際には消さない）
await page.getByRole('button', { name: '削除' }).first().click();
check((await page.getByText('「試しの問題2」消す？').count()) === 1, '消す前に確かめる');
await page.getByRole('button', { name: 'やめる' }).click();
check((await page.getByRole('button', { name: '削除' }).count()) === 2, 'やめると元に戻る');

// 6. 戻る
await page.getByRole('link', { name: 'クロスワードパズル作成へ戻る' }).click();
await page.waitForURL(/\/crossword\/create$/);
check(true, '作る画面へ戻れる');

// 7. 何も無い端末で直接開いたとき
await page.evaluate(() => localStorage.removeItem('crossword_my_puzzles'));
await page.goto(`${BASE}/crossword/mine`);
await page.getByRole('heading', { name: '自分が作った問題' }).waitFor();
check((await page.getByText('この端末で作った問題はまだありません').count()) === 1, '空のときの表示');
await page.screenshot({ path: path.join(OUT, '3-mine-empty.png') });

await browser.close();
console.log(fail ? `NG ${fail}件` : 'すべてOK', OUT);
process.exit(fail ? 1 : 0);
