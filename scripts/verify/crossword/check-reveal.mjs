// 「1文字見る」とランキングの印を確かめる。
// 記録の送信・回数を足す呼び出しは途中で受け止め、ランキングの読み込みは見本の行に差し替える（本物のランキングは変わらない）。
// 丸付けと1文字見るは本物の受付係（/api/crossword-play）を通るので、遊んでいる回の記録（crossword_plays）が増える。
// 見た数・ミス・解けた時刻は受付係の記録にしか無いので、最後に書き出す回の番号で棚を直接見て確かめる。
// 使い方: node scripts/verify/crossword/check-reveal.mjs <サイト> <問題の番号> '<答えの配置 JSON>' <残すマス1 x,y> <残すマス2 x,y> <マス1の間違いの字>
import { chromium } from 'playwright';
import { interceptCount, humanWaitMs } from './_lib.mjs';

const [BASE, ID, CLUES_JSON, CELL1, CELL2, WRONG_CHAR] = process.argv.slice(2);
const OUT = process.env.OUT || '.';
const clues = JSON.parse(CLUES_JSON);
const full = {};
for (const c of clues) c.a.forEach((ch, i) => {
  const x = c.d === 'horizontal' ? c.x + i : c.x;
  const y = c.d === 'vertical' ? c.y + i : c.y;
  full[`${x},${y}`] = ch;
});
const without = (...keys) => {
  const a = { ...full };
  for (const k of keys) delete a[k];
  return a;
};
const label = (k) => {
  const [x, y] = k.split(',').map(Number);
  return `${y + 1}行${x + 1}列`;
};

let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};

const browser = await chromium.launch();

async function open(answers, rankingRows = []) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sent = [];
  await interceptCount(ctx);
  await ctx.route('**/api/crossword-score', async (r) => {
    sent.push(JSON.parse(r.request().postData() || '{}'));
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"updated":true}' });
  });
  await ctx.route('**/rest/v1/crossword_scores*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rankingRows) }),
  );
  const page = await ctx.newPage();
  await page.goto(`${BASE}/crossword`);
  await page.evaluate(({ id, answers }) => {
    localStorage.setItem('crossword_seen_help', 'true');
    localStorage.setItem(`crossword_progress_${id}`, JSON.stringify({ userAnswers: answers, elapsedSeconds: 30, savedAt: Date.now() }));
  }, { id: ID, answers });
  await page.goto(`${BASE}/crossword/${ID}`);
  await page.getByRole('button', { name: /1行|2行|3行/ }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.waitForTimeout(humanWaitMs(Object.keys(full).length));
  return { ctx, page, sent };
}
const text = (page) => page.evaluate(() => document.body.innerText);
const tokenOf = (page) => page.evaluate((id) => JSON.parse(localStorage.getItem(`crossword_progress_${id}`) || "{}").play?.token ?? null, ID);
const tokens = {};
const submitName = async (page) => {
  await page.getByRole('button', { name: '載せる' }).waitFor({ timeout: 8000 });
  await page.getByPlaceholder('ニックネーム').fill('試し');
  await page.getByRole('button', { name: '載せる' }).click();
  await page.waitForTimeout(1500);
};

// 1. 2マス残して、1つ目は確かめてから見る、2つ目は確かめずに見る → 解き終わり、見た数 2・ミス 0 で送られる
{
  const { ctx, page, sent } = await open(without(CELL1, CELL2));
  await page.getByRole('button', { name: `${label(CELL1)}: 空` }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/reveal-0-card.png` });
  await page.getByRole('button', { name: '1文字見る' }).click();
  const t1 = await text(page);
  check(t1.includes('1文字見る？') && t1.includes('ノーヒントの印は付かなくなります。'), '初めての時はその場で確かめる');
  await page.screenshot({ path: `${OUT}/reveal-1-confirm.png` });
  await page.getByRole('button', { name: '見る', exact: true }).click();
  await page.getByRole('button', { name: `${label(CELL1)}: ${full[CELL1]}` }).waitFor({ timeout: 8000 }).catch(() => {}); // 受付係の返事を待つ
  check((await page.getByRole('button', { name: `${label(CELL1)}: ${full[CELL1]}` }).count()) === 1, '選んだマスに正しい字が入る');
  await page.getByRole('button', { name: '閉じる' }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: `${label(CELL2)}: 空` }).click();
  await page.getByRole('button', { name: '1文字見る' }).click();
  await page.waitForTimeout(600);
  check(!(await text(page)).includes('1文字見る？'), '2回目からは確かめない');
  await page.waitForTimeout(3500);
  check((await text(page)).includes('CLEARED!'), '見た字で埋まっても自動で答え合わせして終わる');
  await submitName(page);
  tokens.reveal2 = await tokenOf(page);
  check(sent.length === 1 && sent[0].playToken === tokens.reveal2 && !('timeSeconds' in sent[0]) && !('reveals' in sent[0]), `記録は回の番号だけを送る（タイム・数は送らない）: ${JSON.stringify(sent.map((x) => Object.keys(x)))}`);
  await ctx.close();
}

// 2. 間違えて埋める（ミス1）→ 直して終わる → 見た数 0・ミス 1。開き直してもミスの数は残る
{
  const { ctx, page, sent } = await open(without(CELL1));
  await page.getByRole('button', { name: `${label(CELL1)}: 空` }).click();
  await page.getByRole('button', { name: WRONG_CHAR, exact: true }).last().click();
  await page.waitForTimeout(1500);
  await page.reload();
  await page.getByRole('button', { name: /1行|2行|3行/ }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: `${label(CELL1)}: ${WRONG_CHAR}` }).click();
  await page.getByRole('button', { name: full[CELL1], exact: true }).last().click();
  await page.waitForTimeout(3500);
  await submitName(page);
  tokens.miss1 = await tokenOf(page);
  check(sent.length === 1 && sent[0].playToken === tokens.miss1, '開き直しても同じ回のまま記録を送る');
  await ctx.close();
}

// 3. ランキングの印
{
  const now = new Date().toISOString();
  const rows = [
    { display_name: 'A', time_seconds: 30, updated_at: now, reveals: 0, misses: 0 },
    { display_name: 'B', time_seconds: 40, updated_at: now, reveals: 0, misses: 2 },
    { display_name: 'C', time_seconds: 50, updated_at: now, reveals: 2, misses: 0 },
    { display_name: 'D', time_seconds: 60, updated_at: now, reveals: 1, misses: 1 },
  ];
  const { ctx, page } = await open(without(CELL1), rows);
  await page.getByRole('button', { name: `${label(CELL1)}: 空` }).click();
  await page.getByRole('button', { name: full[CELL1], exact: true }).last().click();
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: '載せない' }).click();
  await page.waitForTimeout(1500);
  const t = await text(page);
  const lines = t.split(/\r?\n/).map((l) => l.trim());
  check(lines.includes('ノーミス・ノーヒント'), '両方 0 は「ノーミス・ノーヒント」');
  check(lines.includes('ノーヒント'), 'ミスありで見ていないのは「ノーヒント」');
  check(lines.includes('ノーミス・2文字見た'), 'ミス 0 で2文字見たのは「ノーミス・2文字見た」');
  check(lines.includes('1文字見た'), 'ミスありで1文字見たのは「1文字見た」');
  await page.getByText('ランキング').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/reveal-3-ranking.png` });
  await ctx.close();
}

await browser.close();
console.log('回の番号（棚で確かめる）: ' + JSON.stringify(tokens));
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
