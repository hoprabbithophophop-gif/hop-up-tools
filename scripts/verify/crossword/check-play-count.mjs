// 遊ばれた回数を足す時機を確かめる。本物の回数は増やさない（足す呼び出しは途中で受け止めて、棚まで届けない）
// 使い方: node scripts/verify/crossword/check-play-count.mjs http://localhost:5193 <問題の番号>
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'https://feature-crossword.hop-up-tools.pages.dev';
const ID = process.argv[3];
if (!ID) throw new Error('問題の番号を渡してください');

let fail = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
  if (!ok) fail++;
};

const browser = await chromium.launch();

async function session(ctx) {
  let calls = 0;
  await ctx.route('**/rest/v1/rpc/crossword_add_play', (route) => {
    calls++;
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await ctx.newPage();
  const open = async () => {
    await page.goto(`${BASE}/crossword/${ID}`);
    await page.getByRole('button', { name: /1行|2行|3行/ }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /始める|はじめる|閉じる/ }).first().click({ timeout: 2000 }).catch(() => {});
  };
  const typeOne = async (ch) => {
    await page.getByRole('button', { name: /空$/ }).first().click();
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
await b.page.goto(`${BASE}/crossword`);
await b.page.evaluate((id) => localStorage.setItem('crossword_my_puzzles', JSON.stringify([{ id, title: 't', key: 'x'.repeat(64), createdAt: 1 }])), ID);
await b.open();
await b.typeOne('ア');
check(b.calls() === 0, `作った本人の端末では数えない: ${b.calls()}`);
await ctxB.close();

await browser.close();
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
