// 前回の続きを開いた時の「つづきから／はじめから」を確かめる（2026-10-04 洗い出しの 6）。
// 回数を足す呼び出しは受け止める。丸付けはしないので受付係の記録は増えない（はじめからの時だけ新しい回が1つ増える）。
// 使い方: node scripts/verify/crossword/check-resume.mjs [サイト] [問題の番号]（省略時は targets.json）
// 入れておく字は 4,0 の「ダ」（targets.json の問題 SJ2cjTJe の盤に合わせてある。別の問題では 4,0 にマスが要る）
import { chromium } from 'playwright';
import { interceptCount, arg, outDir, BASE_DEFAULT, ID_DEFAULT } from './_lib.mjs';

const BASE = arg(2, BASE_DEFAULT);
const ID = arg(3, ID_DEFAULT);
const OUT = outDir('check-resume');
let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
const browser = await chromium.launch();
const HOUR = 3600 * 1000;

async function open(savedAgoMs, startedAgoMs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await interceptCount(ctx);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/crossword/mine`);
  await page.evaluate(({ id, savedAt, localStart }) => {
    localStorage.setItem('crossword_seen_help', 'true');
    localStorage.setItem(`crossword_progress_${id}`, JSON.stringify({
      userAnswers: { '4,0': 'ダ' },
      elapsedSeconds: 0,
      play: { token: '00000000-0000-4000-8000-000000000000', localStart },
      savedAt,
    }));
  }, { id: ID, savedAt: Date.now() - savedAgoMs, localStart: Date.now() - startedAgoMs });
  await page.goto(`${BASE}/crossword/${ID}`);
  await page.getByRole('button', { name: /1行|2行|3行/ }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  return { ctx, page };
}
const text = (page) => page.evaluate(() => document.body.innerText);
const timer = (page) => page.evaluate(() => (document.querySelector('header')?.innerText.match(/\d+:\d{2}(?::\d{2})?/) || [''])[0]);

// 1. 前回から2時間空いた → 聞かれる。つづきから → 字もタイムもそのまま
{
  const { ctx, page } = await open(2 * HOUR, 2 * HOUR);
  const t = await text(page);
  check(t.includes('前回の続きがあります') && /タイムは始めた時から数えています（2:00:\d\d）/.test(t), '1 2時間空くと聞かれ、始めてからの時間が出る');
  await page.screenshot({ path: `${OUT}/resume-ask.png` });
  // 窓が出ている間は、窓の中の時間が止まったままで、盤の上のタイマーは出ない（数え始めない）
  const askTime = async () => ((await text(page)).match(/（(\d+:\d{2}:\d{2})）/) || [])[1] || null;
  const ask1 = await askTime();
  const head1 = await timer(page);
  await page.waitForTimeout(3000);
  const ask2 = await askTime();
  const head2 = await timer(page);
  check(Boolean(ask1) && ask1 === ask2 && head1 === '' && head2 === '', `1 答えるまでタイマーは動かない: 窓の時間 ${ask1} → 3秒後 ${ask2} ／ 盤の上のタイマー「${head1}」→「${head2}」`);
  await page.getByRole('button', { name: 'つづきから' }).click();
  await page.waitForTimeout(1500);
  check(!(await text(page)).includes('前回の続きがあります'), '1 つづきからで窓が閉じる');
  check((await page.getByRole('button', { name: '1行5列：ダ' }).count()) === 1, '1 入れた字は残る');
  const run1 = await timer(page);
  check(/^2:0\d:\d{2}$/.test(run1), `1 タイマーは始めた時から（2時間＝120分）: ${run1}`);
  await page.waitForTimeout(3000);
  const run2 = await timer(page);
  check(Boolean(run1) && Boolean(run2) && run1 !== run2, `1 つづきからを押すとタイマーが進み出す: ${run1} → 3秒後 ${run2}`);
  await ctx.close();
}
// 2. はじめから → 字が消えて、タイマーは0から
{
  const { ctx, page } = await open(2 * HOUR, 2 * HOUR);
  await page.getByRole('button', { name: 'はじめから' }).click();
  await page.waitForTimeout(2500);
  check((await page.getByRole('button', { name: '1行5列：ダ' }).count()) === 0, '2 はじめからで入れた字が消える');
  check(/^0:0\d$/.test(await timer(page)), `2 タイマーは0から: ${await timer(page)}`);
  await ctx.close();
}
// 3. 前回から5分しか空いていない → 聞かない
{
  const { ctx, page } = await open(5 * 60 * 1000, 10 * 60 * 1000);
  check(!(await text(page)).includes('前回の続きがあります'), '3 少ししか空いていなければ聞かない');
  await ctx.close();
}
await browser.close();
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
