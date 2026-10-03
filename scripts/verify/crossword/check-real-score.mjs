// 本物のランキングに1件載せて、受付係の記録からタイムと印が出ることを確かめる（棚に書き込む。確かめた後は片付けること）。
// 回数を足す呼び出しだけは途中で受け止める。
// 使い方: node scripts/verify/crossword/check-real-score.mjs <サイト> <問題の番号> '<答えの配置 JSON>' <残すマス x,y> <名前>
import { chromium } from 'playwright';

const [BASE, ID, CLUES_JSON, LAST, NAME] = process.argv.slice(2);
const OUT = process.env.OUT || '.';
const full = {};
for (const c of JSON.parse(CLUES_JSON)) c.a.forEach((ch, i) => {
  full[`${c.d === 'horizontal' ? c.x + i : c.x},${c.d === 'vertical' ? c.y + i : c.y}`] = ch;
});
const almost = { ...full };
delete almost[LAST];
const [lx, ly] = LAST.split(',').map(Number);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route('**/rest/v1/rpc/crossword_add_play', (r) => r.fulfill({ status: 204, body: '' }));
const page = await ctx.newPage();
await page.goto(`${BASE}/crossword`);
await page.evaluate(({ id, answers }) => {
  localStorage.setItem('crossword_seen_help', 'true');
  localStorage.setItem(`crossword_progress_${id}`, JSON.stringify({ userAnswers: answers, elapsedSeconds: 0, savedAt: Date.now() }));
}, { id: ID, answers: almost });
await page.goto(`${BASE}/crossword/${ID}`);
const cell = page.getByRole('button', { name: `${ly + 1}行${lx + 1}列: 空` });
await cell.waitFor({ timeout: 20000 });
await page.waitForTimeout(2500);
await cell.click();
await page.getByRole('button', { name: full[LAST], exact: true }).last().click();
await page.getByRole('button', { name: '載せる' }).waitFor({ timeout: 10000 });
const token = await page.evaluate((id) => JSON.parse(localStorage.getItem(`crossword_progress_${id}`) || '{}').play?.token ?? null, ID);
await page.getByPlaceholder('ニックネーム').fill(NAME);
await page.getByRole('button', { name: '載せる' }).click();
await page.waitForTimeout(3000);
const text = await page.evaluate(() => document.body.innerText);
const lines = text.split(/\r?\n/).map((l) => l.trim());
const i = lines.indexOf(NAME);
console.log('回の番号: ' + token);
console.log('ランキングの行: ' + JSON.stringify(i >= 0 ? lines.slice(i - 1, i + 4) : null));
console.log('名前を入れる窓が閉じた: ' + ((await page.getByRole('button', { name: '載せる' }).count()) === 0));
await page.getByText('ランキング').first().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/real-score.png` });
await browser.close();
