// 最後の空きマスが埋まったら、答え合わせのボタンを押さなくても答え合わせが始まることを確かめる。
// 回数を足す呼び出しとスコアの送信は途中で受け止めるので、本物の回数もランキングも変わらない。
// 使い方: node scripts/verify/crossword/check-auto-check.mjs [サイト] [問題の番号] ['<答えの配置 JSON>'] [残すマス x,y] [そのマスの字] [間違いの字]
// （省略した引数は targets.json の問題から決める。答えの配置は受付係に聞いて一時置き場に控える）
import { chromium } from 'playwright';
import { interceptCount, humanWaitMs, arg, outDir, puzzleArgs, BASE_DEFAULT, ID_DEFAULT } from './_lib.mjs';

const BASE = arg(2, BASE_DEFAULT);
const ID = arg(3, ID_DEFAULT);
const P = await puzzleArgs(BASE, ID, { cluesJson: arg(4), last: arg(5), lastChar: arg(6), wrongChar: arg(7) });
const [LAST, LAST_CHAR, WRONG_CHAR] = [P.last, P.lastChar, P.wrongChar];
const OUT = outDir('check-auto-check');
const clues = P.cluesJson;
const full = {};
for (const c of clues) c.a.forEach((ch, i) => {
  const x = c.d === 'horizontal' ? c.x + i : c.x;
  const y = c.d === 'vertical' ? c.y + i : c.y;
  full[`${x},${y}`] = ch;
});
const almost = { ...full };
delete almost[LAST];
const [lx, ly] = LAST.split(',').map(Number);

let fail = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
  if (!ok) fail++;
};

const browser = await chromium.launch();

async function open(answers) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await interceptCount(ctx);
  await ctx.route('**/api/crossword-score', (r) => r.fulfill({ status: 500, body: '{}' }));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/crossword/create`);
  await page.evaluate(({ id, answers }) => {
    localStorage.setItem('crossword_seen_help', 'true');
    localStorage.setItem(`crossword_progress_${id}`, JSON.stringify({ userAnswers: answers, elapsedSeconds: 30, savedAt: Date.now() }));
  }, { id: ID, answers });
  await page.goto(`${BASE}/crossword/${ID}`);
  await page.getByRole('button', { name: /1行|2行|3行/ }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.waitForTimeout(humanWaitMs(Object.keys(full).length));
  return { ctx, page };
}
const stamped = (page) => page.evaluate(() => document.body.innerText.includes('CLEARED!'));
const closeupOpen = async (page) => (await page.getByRole('button', { name: /決定/ }).count()) > 0;
const cellOf = (page, state) => page.getByRole('button', { name: `${ly + 1}行${lx + 1}列: ${state}` });
const press = (page, ch) => page.getByRole('button', { name: ch, exact: true }).last().click();

// 1. 最後の1文字を正しく入れると、ボタンを押さずに終わる
{
  const { ctx, page } = await open(almost);
  await cellOf(page, '空').click();
  await press(page, LAST_CHAR);
  await page.waitForTimeout(4500);
  check(await stamped(page), '正しく埋めると、ボタンを押さずにハンコが出る');
  check(!(await closeupOpen(page)), '拡大の窓は閉じている');
  check((await page.getByRole('button', { name: '載せない' }).count()) > 0, '名前を入れる窓が出る');
  await page.screenshot({ path: `${OUT}/auto-1-correct.png` });
  await ctx.close();
}

// 2. 最後の1文字を間違えると、答え合わせと同じ知らせが出る。直すと黙って終わる
{
  const { ctx, page } = await open(almost);
  await cellOf(page, '空').click();
  await press(page, WRONG_CHAR);
  await page.getByText('どこかに間違いがあります。').first().waitFor({ timeout: 8000 }).catch(() => {}); // 受付係の返事を待つ
  const text = await page.evaluate(() => document.body.innerText);
  check(text.includes('どこかに間違いがあります。'), '間違えて埋めると「どこかに間違いがあります。」が出る');
  check(!text.includes('赤枠') && !text.includes('合っていないカギ') && !text.includes('降参'), 'どこが違うかは示さない（赤枠の案内・合っていないカギの一覧・降参が無い）');
  const wrongColor = await cellOf(page, WRONG_CHAR).evaluate((el) => getComputedStyle(el).color);
  check(wrongColor !== 'rgb(186, 26, 26)', `間違えたマスの字は赤くならない: ${wrongColor}`);
  check(!(await closeupOpen(page)), '拡大の窓は閉じて盤が見える');
  check(!(await stamped(page)), 'ハンコは出ない');
  await page.screenshot({ path: `${OUT}/auto-2-wrong.png` });
  await cellOf(page, WRONG_CHAR).click();
  await press(page, LAST_CHAR);
  await page.waitForTimeout(4500);
  check(await stamped(page), '直して全部合うと、ボタンを押さずにハンコが出る');
  await ctx.close();
}

// 3. 全部埋まった盤を開き直しただけでは始まらない
{
  const wrongFull = { ...full, [LAST]: WRONG_CHAR };
  const { ctx, page } = await open(wrongFull);
  await page.waitForTimeout(1500);
  const text = await page.evaluate(() => document.body.innerText);
  check(!text.includes('どこかに間違いがあります。') && !(await stamped(page)), '開き直しただけでは答え合わせしない');
  await ctx.close();
}

await browser.close();
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
