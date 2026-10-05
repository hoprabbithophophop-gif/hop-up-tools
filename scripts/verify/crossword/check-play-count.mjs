// 遊ばれた回数を足す時機を確かめる。本物の回数は増やさない（受付係への touch を途中で受け止めて、棚まで届けない）
// 使い方: node scripts/verify/crossword/check-play-count.mjs [サイト] [問題の番号]（省略時は targets.json）
import { chromium } from 'playwright';
import { interceptCount, arg, BASE_DEFAULT, ID_DEFAULT } from './_lib.mjs';

const BASE = arg(2, BASE_DEFAULT);
const ID = arg(3, ID_DEFAULT);

let fail = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
  if (!ok) fail++;
};

const browser = await chromium.launch();

async function session(ctx) {
  let calls = 0;
  await interceptCount(ctx, () => calls++);
  const page = await ctx.newPage();
  const open = async () => {
    await page.goto(`${BASE}/crossword/${ID}`);
    await page.getByRole('button', { name: /1行|2行|3行/ }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /このまま始める|始める！|はじめる|閉じる/ }).first().click({ timeout: 2000 }).catch(() => {});
  };
  const typeOne = async (ch) => {
    await page.getByRole('button', { name: /空$/ }).first().click({ timeout: 3000 }).catch(() => {}); // 拡大の窓が開いていれば、そのまま文字盤を押す
    await page.getByRole('button', { name: ch, exact: true }).last().click();
    await page.waitForTimeout(800);
  };
  return { page, open, typeOne, calls: () => calls };
}

// 1. ほかの人の端末
const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
const a = await session(ctxA);
await a.open();
check(a.calls() === 0, `開いただけでは数えない: ${a.calls()}`);
await a.typeOne('ア');
check(a.calls() === 1, `最初の1文字で1回: ${a.calls()}`);
await a.typeOne('イ');
check(a.calls() === 1, `2文字目では数えない: ${a.calls()}`);
await a.open();
await a.typeOne('ウ');
check(a.calls() === 1, `読み込み直して入れても数えない: ${a.calls()}`);
await ctxA.close();

// 2. 作った本人の端末
const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
const b = await session(ctxB);
await b.page.goto(`${BASE}/crossword/create`);
await b.page.evaluate((id) => localStorage.setItem('crossword_my_puzzles', JSON.stringify([{ id, title: 't', key: 'x'.repeat(64), createdAt: 1 }])), ID);
await b.open();
await b.typeOne('ア');
check(b.calls() === 0, `作った本人の端末では数えない: ${b.calls()}`);
await ctxB.close();

await browser.close();
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
