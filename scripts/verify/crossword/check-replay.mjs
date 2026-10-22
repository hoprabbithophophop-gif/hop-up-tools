// 解き終えた問題を開き直した時に、解けた画面がそのまま出て回が始まらないこと、「もう一度解く」で最初から始まることを確かめる（Hop 指示 2026-10-17）。
// 回数を足す呼び出しは受け止める。3 で本物の回を1つ解く（名前は載せない。本番の crossword_plays に1行残る。30日で片付く）
// 使い方: node scripts/verify/crossword/check-replay.mjs [サイト] [問題の番号] ['<答えの配置 JSON>'] [残すマス x,y]
import { chromium } from 'playwright';
import { interceptCount, humanWaitMs, arg, outDir, puzzleArgs, BASE_DEFAULT, ID_DEFAULT, cellAt } from './_lib.mjs';

const BASE = arg(2, BASE_DEFAULT);
const ID = arg(3, ID_DEFAULT);
const P = await puzzleArgs(BASE, ID, { cluesJson: arg(4), last: arg(5) });
const OUT = outDir('check-replay');
let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
const full = {};
for (const c of P.cluesJson) c.a.forEach((ch, i) => {
  full[`${c.d === 'horizontal' ? c.x + i : c.x},${c.d === 'vertical' ? c.y + i : c.y}`] = ch;
});
const [lx, ly] = P.last.split(',').map(Number);
const text = (page) => page.evaluate(() => document.body.innerText);
const timer = (page) => page.evaluate(() => (document.querySelector('header')?.innerText.match(/\d+:\d{2}(?::\d{2})?/) || [''])[0]);
const mark = (page) => page.evaluate((id) => localStorage.getItem(`crossword_cleared_${id}`), ID);
const browser = await chromium.launch();

// 受付係への「回を始める・開いた」の呼び出しを数える（回数を足す touch は受け止め役が先に取る）
async function openWith(setup, extra) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await interceptCount(ctx);
  const calls = [];
  await ctx.route('**/api/crossword-play', (r) => {
    calls.push(JSON.parse(r.request().postData() || '{}').action);
    return r.fallback();
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/crossword/mine`);
  await page.evaluate(setup, { id: ID, answers: extra });
  await page.goto(`${BASE}/crossword/${ID}`);
  await page.locator('[id^="cell-"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(3000);
  return { ctx, page, calls };
}

// 1. 解き終えた印がある端末で開く → 解けた画面がそのまま。窓なし・タイマーなし・回は始まらない
{
  const { ctx, page, calls } = await openWith(({ id, answers }) => {
    localStorage.setItem('crossword_seen_help', 'true');
    localStorage.setItem(`crossword_cleared_${id}`, JSON.stringify({ clearTime: 123, userAnswers: answers, clearedAt: Date.now() - 86400000 }));
  }, full);
  const t = await text(page);
  await page.screenshot({ path: `${OUT}/restored.png`, fullPage: true });
  check(t.includes('CLEARED!'), '1 ハンコが出る');
  check(!t.includes('遊び方') || !t.includes('始める！'), '1 遊び方の窓は出ない');
  check((await timer(page)) === '', '1 盤の上のタイマーは出ない');
  check(calls.length === 0, `1 受付係に回を始める呼び出しをしない: ${JSON.stringify(calls)}`);
  const firstKey = Object.keys(full)[0];
  const [fx, fy] = firstKey.split(',').map(Number);
  check((await cellAt(page, fx, fy, full[firstKey]).count()) === 1, `1 盤に答えが入っている（${firstKey}=${full[firstKey]}）`);
  check(t.includes('Xに投稿') || t.includes('X に投稿') || (await page.locator('a[href*="twitter.com/intent"]').count()) === 1, '1 X に投稿の入口が出る');
  check(t.includes('ほかの問題') || t.includes('パズルギャラリーへ'), '1 ほかの問題への入口が出る');
  check((await page.getByRole('button', { name: 'もう一度解く' }).count()) === 1, '1 「もう一度解く」が出る');
  check(!t.includes('載せる'), '1 名前を入れる窓は出ない');

  // 2. もう一度解く → 印が外れ、盤は白紙、タイマーが0から動き、回が始まる
  await page.getByRole('button', { name: 'もう一度解く' }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/replay.png` });
  check((await mark(page)) === null, '2 解き終えた印が外れる');
  check((await cellAt(page, fx, fy, '空').count()) === 1, '2 盤が白紙になる');
  check(/^0:0\d$/.test(await timer(page)), `2 タイマーは0から: ${await timer(page)}`);
  check(calls.includes('start'), `2 受付係に新しい回を始める: ${JSON.stringify(calls)}`);
  check(!(await text(page)).includes('CLEARED!'), '2 ハンコが消える');
  check((await page.getByRole('button', { name: 'もう一度解く' }).count()) === 0, '2 「もう一度解く」は消える');
  await ctx.close();
}

// 3. 本物の回を解く → 印が残る → 開き直すと解けた画面（同じタイム）・回は始まらない
{
  const almost = { ...full };
  delete almost[P.last];
  const { ctx, page, calls } = await openWith(({ id }) => {
    localStorage.setItem('crossword_seen_help', 'true');
    localStorage.removeItem(`crossword_cleared_${id}`);
  });
  // 既にある回に字を入れる（開いた時点で回は始まっている）。受付係の返事が遅いと途中経過にまだ回の番号が無く、
  // その場合は開き直した後の最初の丸付けで新しい回が始まって「速すぎる回」扱いになる（名前の窓が出ない）。回の番号が入るまで待つ
  await page.waitForFunction((id) => {
    try { return !!JSON.parse(localStorage.getItem(`crossword_progress_${id}`) || '{}').play; } catch { return false; }
  }, ID, { timeout: 20000 }).catch(() => {});
  await page.evaluate(({ id, answers }) => {
    const p = JSON.parse(localStorage.getItem(`crossword_progress_${id}`) || '{}');
    localStorage.setItem(`crossword_progress_${id}`, JSON.stringify({ ...p, userAnswers: answers, savedAt: Date.now() }));
  }, { id: ID, answers: almost });
  await page.reload();
  const cell = cellAt(page, lx, ly, '空');
  await cell.waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.waitForTimeout(humanWaitMs(Object.keys(full).length));
  await cell.click();
  await page.getByRole('button', { name: full[P.last], exact: true }).last().click();
  await page.getByRole('button', { name: '載せる' }).waitFor({ timeout: 20000 });
  check((await cellAt(page, lx, ly, full[P.last]).count()) === 1, '3 解けた直後の盤に入れた字が残っている');
  const m1 = JSON.parse((await mark(page)) || 'null');
  check(m1 && typeof m1.clearTime === 'number' && m1.clearTime >= 1, `3 解けると印が残る（タイム ${m1?.clearTime} 秒）`);
  check(m1 && m1.userAnswers && Object.keys(m1.userAnswers).length === Object.keys(full).length, '3 印に入れた字が全部残る');
  // 名前は載せない
  await page.getByRole('button', { name: '載せない' }).click().catch(() => page.getByRole('button', { name: /スキップ|あとで|やめる|載せない/ }).click());
  await page.waitForTimeout(1000);
  const before = calls.length;
  await page.reload();
  await page.locator('[id^="cell-"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/after-real-clear.png`, fullPage: true });
  const t = await text(page);
  check(t.includes('CLEARED!') && (await timer(page)) === '', '3 開き直すと解けた画面で、タイマーは出ない');
  check(calls.length === before, `3 開き直しで受付係に回の呼び出しをしない: ${JSON.stringify(calls.slice(before))}`);
  check((await cellAt(page, lx, ly, full[P.last]).count()) === 1, '3 最後に入れたマスにも答えが入っている');
  check((await page.getByRole('button', { name: 'もう一度解く' }).count()) === 1, '3 「もう一度解く」が出る');
  check(!t.includes('載せる'), '3 名前を入れる窓はもう出ない');
  await ctx.close();
}

await browser.close();
console.log(fail ? `NG ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);
