// 作った本人の端末で解き終えたときは、ランキングの名前入力を出さないことを確かめる。
// 1マスだけ残した途中の状態を端末に置き、最後の1文字を入れて解き終える。
// 回数を足す呼び出しとスコアの送信は途中で受け止めるので、本物の回数もランキングも変わらない。
// 使い方: node scripts/verify/crossword/check-own-ranking.mjs [サイト] [問題の番号] ['<答えの配置 JSON>'] [残すマス x,y] [そのマスの字]
// （省略した引数は targets.json の問題から決める。答えの配置は受付係に聞いて一時置き場に控える）
import { chromium } from 'playwright';
import { interceptCount, humanWaitMs, arg, outDir, puzzleArgs, BASE_DEFAULT, ID_DEFAULT } from './_lib.mjs';

const BASE = arg(2, BASE_DEFAULT);
const ID = arg(3, ID_DEFAULT);
const P = await puzzleArgs(BASE, ID, { cluesJson: arg(4), last: arg(5), lastChar: arg(6) });
const [LAST, LAST_CHAR] = [P.last, P.lastChar];
const OUT = outDir('check-own-ranking');
const clues = P.cluesJson;
const answers = {};
for (const c of clues) c.a.forEach((ch, i) => {
  const x = c.d === 'horizontal' ? c.x + i : c.x;
  const y = c.d === 'vertical' ? c.y + i : c.y;
  answers[`${x},${y}`] = ch;
});
delete answers[LAST];
const [lx, ly] = LAST.split(',').map(Number);

let fail = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
  if (!ok) fail++;
};

const browser = await chromium.launch();

async function solve(own, fast = false) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let blocked = 0;
  await interceptCount(ctx);
  await ctx.route('**/api/crossword-score', (r) => (blocked++, r.fulfill({ status: 500, body: '{}' })));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/crossword/create`);
  await page.evaluate(({ id, answers, own }) => {
    localStorage.setItem('crossword_seen_help', 'true');
    localStorage.setItem(`crossword_progress_${id}`, JSON.stringify({ userAnswers: answers, elapsedSeconds: 30, savedAt: Date.now() }));
    if (own) localStorage.setItem('crossword_my_puzzles', JSON.stringify([{ id, title: 't', key: 'x'.repeat(64), createdAt: 1 }]));
  }, { id: ID, answers, own });
  await page.goto(`${BASE}/crossword/${ID}`);
  const cell = page.getByRole('button', { name: `${ly + 1}行${lx + 1}列: 空` });
  await cell.waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  if (!fast) await page.waitForTimeout(humanWaitMs(Object.keys(answers).length + 1));
  await cell.click();
  await page.getByRole('button', { name: LAST_CHAR, exact: true }).last().click();
  await page.waitForTimeout(4500);
  const nameEntry = (await page.getByRole('button', { name: '載せない' }).count()) > 0;
  const cleared = await page.evaluate(() => document.body.innerText.includes('CLEAR') || document.body.innerText.includes('クリア'));
  await page.screenshot({ path: `${OUT}/own-${own}.png` });
  await ctx.close();
  return { nameEntry, cleared };
}

const other = await solve(false);
check(other.nameEntry, `ほかの人の端末では名前入力が出る: ${JSON.stringify(other)}`);
const own = await solve(true);
check(!own.nameEntry, `作った本人の端末では名前入力が出ない: ${JSON.stringify(own)}`);
const fast = await solve(false, true);
check(fast.cleared && !fast.nameEntry, `字の数×1秒より速く解くと名前入力が出ない: ${JSON.stringify(fast)}`);

await browser.close();
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
