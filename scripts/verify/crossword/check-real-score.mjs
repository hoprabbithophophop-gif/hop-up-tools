// 本物のランキングに1件載せて、受付係の記録からタイムと印が出ることを確かめる（棚に書き込む。確かめた後は片付けること）。
// 回数を足す呼び出しだけは途中で受け止める。
// 載せる名前は既定で「検収」＋月日時分（本番のランキングに残る行を後で見分けて片付けるための印）。
// 使い方: node scripts/verify/crossword/check-real-score.mjs [サイト] [問題の番号] ['<答えの配置 JSON>'] [残すマス x,y] [名前]
// （省略した引数は targets.json の問題から決める。答えの配置は受付係に聞いて一時置き場に控える）
import { chromium } from 'playwright';
import { interceptCount, humanWaitMs, arg, outDir, puzzleArgs, BASE_DEFAULT, ID_DEFAULT } from './_lib.mjs';

const BASE = arg(2, BASE_DEFAULT);
const ID = arg(3, ID_DEFAULT);
const P = await puzzleArgs(BASE, ID, { cluesJson: arg(4), last: arg(5) });
const LAST = P.last;
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const NAME = arg(6, `検収${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`);
const OUT = outDir('check-real-score');
let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
const full = {};
for (const c of P.cluesJson) c.a.forEach((ch, i) => {
  full[`${c.d === 'horizontal' ? c.x + i : c.x},${c.d === 'vertical' ? c.y + i : c.y}`] = ch;
});
const almost = { ...full };
delete almost[LAST];
const [lx, ly] = LAST.split(',').map(Number);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await interceptCount(ctx);
const page = await ctx.newPage();
await page.goto(`${BASE}/crossword/create`);
await page.evaluate(({ id, answers }) => {
  localStorage.setItem('crossword_seen_help', 'true');
  localStorage.setItem(`crossword_progress_${id}`, JSON.stringify({ userAnswers: answers, elapsedSeconds: 0, savedAt: Date.now() }));
}, { id: ID, answers: almost });
await page.goto(`${BASE}/crossword/${ID}`);
const cell = page.getByRole('button', { name: `${ly + 1}行${lx + 1}列：空` });
await cell.waitFor({ timeout: 20000 });
await page.waitForTimeout(2500);
  await page.waitForTimeout(humanWaitMs(Object.keys(full).length));
await cell.click();
await page.getByRole('button', { name: full[LAST], exact: true }).last().click();
await page.getByRole('button', { name: '載せる' }).waitFor({ timeout: 10000 });
const token = await page.evaluate((id) => JSON.parse(localStorage.getItem(`crossword_progress_${id}`) || '{}').play?.token ?? null, ID);
await page.getByPlaceholder('ニックネーム').fill(NAME);
await page.getByRole('button', { name: '載せる' }).click();
await page.waitForTimeout(3000);
const text = await page.evaluate(() => document.body.innerText);
// 空の行を除く（行の並びは 順位・名前・日付・印・タイム）
const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const i = lines.indexOf(NAME);
const row = i >= 0 ? lines.slice(i - 1, i + 4) : null;
console.log('回の番号: ' + token);
console.log('載せた名前（本番のランキングに残る）: ' + NAME);
check(i >= 0, `本物のランキングに名前が載る: ${JSON.stringify(row)}`);
check(Boolean(row) && row.some((l) => /\d+:\d{2}/.test(l)), `タイムが出る: ${JSON.stringify(row)}`);
check(Boolean(row) && row.includes('ノーミス・ノーヒント'), `ミス0・見た数0の回は「ノーミス・ノーヒント」: ${JSON.stringify(row)}`);
check((await page.getByRole('button', { name: '載せる' }).count()) === 0, '名前を入れる窓が閉じた');
await page.getByText('ランキング').first().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/real-score.png` });
await browser.close();
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
