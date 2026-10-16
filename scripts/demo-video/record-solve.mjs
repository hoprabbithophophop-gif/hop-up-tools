// 使い方の動画「パズルの解き方」を撮る。動画用の問題「現場の持ち物」（AE86-npN）を、記録が空のブラウザでギャラリーから開いて解き終える。
// ランキングへの送信と遊ばれた回数は途中で受け止める（本物のランキングと回数は変わらない）。
// 使い方: node scripts/demo-video/record-solve.mjs <出力先> [サイト]
import { openRecorder, closeRecorder, wait, scrollTo, tap } from './_rec-lib.mjs';

const OUT = process.argv[2];
const BASE = process.argv[3] || 'https://feature-crossword.hop-up-tools.pages.dev';
const ID = 'AE86-npN';
const TITLE = '現場の持ち物';

// 解く順番。カギの一覧の文で語を開き、文字盤で押す字（゜゛は字のあとに押す）
// mark はテロップを出す場面の区切り（compose.mjs が使う）
// カスタネットは「わからないので飛ばす」→ ほかの語を解いて、交わった字を手がかりに最後に戻る（Hop 2026-10-16）
const WORDS = [
  { clue: '手のひらで打ち鳴らす楽器', skip: true, mark: 'skip' },
  { clue: '首に掛けられる、細長いタオル', keys: ['マ', 'フ', 'ラ', 'ー', 'タ', 'オ', 'ル'], showHint: true, mark: 'type' },
  { clue: 'これが無いと会場に入れない', keys: ['チ', 'ケ', 'ツ', 'ト'] },
  { clue: '曲に合わせて色を変えられる', keys: ['ヘ', '゜', 'ン', 'ラ', 'イ', 'ト'], mark: 'dakuten' },
  { clue: '手のひらで打ち鳴らす楽器', keys: ['カ', 'ス', 'タ', 'ネ', 'ツ', 'ト'], mark: 'back' },
];

const rec = await openRecorder(OUT);
const { page, ctx, mark } = rec;
// 送った名前とタイムは本物のランキングに載せず、送った後の読み直しでその1件だけを返す（載せた時の見え方を映す）
let mine = null;
await ctx.route('**/api/crossword-score', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
await ctx.route('**/rest/v1/crossword_scores*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mine ? [mine] : []) }));
await ctx.route('**/api/crossword-play', (r) => {
  const body = JSON.parse(r.request().postData() || '{}');
  if (body.action !== 'touch') return r.fallback();
  return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"counted":true}' });
});

// 1. ギャラリーで「初めての人向け」に絞って選ぶ
await page.goto(`${BASE}/crossword`, { waitUntil: 'networkidle' });
mark('gallery');
await wait(page, 2000);
const beginner = page.getByText('初めての人向け', { exact: true }).first();
if (await beginner.count()) await tap(page, beginner, 2000);
const card = page.getByText(TITLE, { exact: true }).first();
await card.waitFor({ timeout: 20000 });
await tap(page, card, 3500);

// 2. 遊び方 → 始める！
mark('help');
await wait(page, 1500);
await tap(page, page.getByRole('button', { name: /始める！/ }), 2000);

// 3. 語ごとに開いて文字盤で入れる
const key = (k) => page.getByRole('button', { name: k, exact: true }).last();
for (const w of WORDS) {
  if (w.mark) mark(w.mark);
  await tap(page, page.getByText(new RegExp(w.clue)).first(), 1200);
  if (w.skip) {
    // カギを読んで考えるふりをしてから、何も入れずに閉じる
    await wait(page, 2800);
    await tap(page, page.getByRole('button', { name: '閉じる', exact: true }).last(), 1200);
    continue;
  }
  if (w.mark === 'back') await wait(page, 1500); // 交わった字が入っているのを見せる
  if (w.showHint) {
    const hint = page.getByRole('button', { name: /ヒント/ }).last();
    if (await hint.count()) {
      mark('hint');
      await hint.click();
      await wait(page, 3500);
      await hint.click().catch(() => {});
      await wait(page, 800);
      mark('type2');
    }
  }
  for (const k of w.keys) {
    // 交わる字が先に埋まっていると、語の途中で盤が全部埋まって丸付けが始まる。その後の字は押さない
    if (await page.getByText('CLEARED!').first().isVisible().catch(() => false)) break;
    if (!(await key(k).click({ timeout: 4000 }).then(() => true, () => false))) break;
    await wait(page, 380);
  }
  await wait(page, 700);
  const done = page.getByRole('button', { name: /決定/ }).last();
  if (await done.isVisible().catch(() => false)) await done.click();
  await wait(page, 1200);
}

// 4. 自動で丸付け → CLEARED! → 名前を入れてランキングへ
mark('clear');
await page.getByText('CLEARED!').first().waitFor({ timeout: 20000 }).catch(() => {});
await wait(page, 3500);
const name = page.getByPlaceholder('ニックネーム');
if (await name.isVisible().catch(() => false)) {
  const t = await page.evaluate(() => (document.body.innerText.match(/タイム[：:]\s*(\d+):(\d\d)/) || []).slice(1).map(Number));
  mine = { id: 1, display_name: 'hop', time_seconds: t.length ? t[0] * 60 + t[1] : 30, updated_at: new Date().toISOString(), reveals: 0, misses: 0 };
  mark('rank');
  await name.pressSequentially('hop', { delay: 150 });
  await wait(page, 500);
  await tap(page, page.getByRole('button', { name: '載せる', exact: true }), 2500);
}
const ranking = page.getByText('ノーミス・ノーアシスト').first();
if (await ranking.count()) await scrollTo(page, ranking, 'center');
await wait(page, 3500);
await page.screenshot({ path: OUT + '/solve-end.png' });

console.log(await closeRecorder(rec, OUT, 'solve-raw'));
