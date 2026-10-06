// ランキングの名前の通報（2026-10-04 洗い出しの 7）を確かめる。
// ランキングは見本の行に差し替え、通報の送信は途中で受け止める（本物の棚にも Discord にも送らない）。
// 使い方: node scripts/verify/crossword/check-name-report.mjs [サイト] [問題の番号] ['<答えの配置 JSON>'] [残すマス x,y]
// （省略した引数は targets.json の問題から決める。答えの配置は受付係に聞いて一時置き場に控える）
import { chromium } from 'playwright';
import { interceptCount, humanWaitMs, arg, outDir, puzzleArgs, BASE_DEFAULT, ID_DEFAULT, cellAt } from './_lib.mjs';

const BASE = arg(2, BASE_DEFAULT);
const ID = arg(3, ID_DEFAULT);
const P = await puzzleArgs(BASE, ID, { cluesJson: arg(4), last: arg(5) });
const LAST = P.last;
const OUT = outDir('check-name-report');
const full = {};
for (const c of P.cluesJson) c.a.forEach((ch, i) => {
  full[`${c.d === 'horizontal' ? c.x + i : c.x},${c.d === 'vertical' ? c.y + i : c.y}`] = ch;
});
const almost = { ...full };
delete almost[LAST];
const [lx, ly] = LAST.split(',').map(Number);

let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const sent = [];
await interceptCount(ctx);
await ctx.route('**/api/crossword-score', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
await ctx.route('**/api/crossword-report-name', async (r) => {
  sent.push(JSON.parse(r.request().postData() || '{}'));
  await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
});
const now = new Date().toISOString();
await ctx.route('**/rest/v1/crossword_scores*', (r) => r.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify([
    { id: 101, display_name: 'たろう', time_seconds: 30, updated_at: now, reveals: 0, misses: 0 },
    { id: 102, display_name: 'ひどい名前', time_seconds: 40, updated_at: now, reveals: 1, misses: 1 },
  ]),
}));
const page = await ctx.newPage();
await page.goto(`${BASE}/crossword/mine`);
await page.evaluate(({ id, answers }) => {
  localStorage.setItem('crossword_seen_help', 'true');
  localStorage.setItem(`crossword_progress_${id}`, JSON.stringify({ userAnswers: answers, elapsedSeconds: 0, savedAt: Date.now() }));
}, { id: ID, answers: almost });
await page.goto(`${BASE}/crossword/${ID}`);
await page.getByRole('button', { name: /1行|2行|3行/ }).first().waitFor({ timeout: 20000 });
await page.waitForTimeout(2500);
  await page.waitForTimeout(humanWaitMs(Object.keys(full).length));
await cellAt(page, lx, ly, '空').click();
await page.getByRole('button', { name: full[LAST], exact: true }).last().click();
await page.getByRole('button', { name: '載せない' }).click({ timeout: 10000 });
await page.waitForTimeout(1500);

const flags = page.getByRole('button', { name: '名前を通報する' });
check((await flags.count()) === 2, `行ごとに通報の旗がある: ${await flags.count()}`);
await flags.nth(1).click();
const t1 = await page.evaluate(() => document.body.innerText);
check(t1.includes('「ひどい名前」を通報する？'), 'その場で「「ひどい名前」を通報する？」と確かめる');
check(sent.length === 0, '確かめの前には送らない');
await page.getByText('ランキング').first().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/name-report-ask.png` });
await page.getByRole('button', { name: '通報する', exact: true }).click();
await page.waitForTimeout(1000);
check(sent.length === 1 && sent[0].scoreId === 102, `その行の記録の番号を送る: ${JSON.stringify(sent)}`);
const t2 = await page.evaluate(() => document.body.innerText);
check(t2.includes('通報しました'), '「通報しました」と出る');
check((await flags.count()) === 1, '通報した行の旗は消える');
await page.screenshot({ path: `${OUT}/name-report-done.png` });
await browser.close();
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
