// 使い方の動画「パズルの作り方」を撮る。動画用の小さい問題「現場の持ち物」（Hop 決定 2026-10-16）を作る画面で組み、「共有する」まで押す。
// 使い方: node scripts/demo-video/record-create.mjs <出力先> [サイト] [--headed] [--save]
//   人間確認（Turnstile）は機械に押させない。人間確認の窓が出た所で撮り終える
//   場面の区切りの時刻は <出力先>/create-raw.steps.json に出る（テロップを重ねる compose.mjs が使う）
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { openRecorder, closeRecorder, wait, scrollTo, typeSlow, tap } from './_rec-lib.mjs';

const OUT = process.argv[2];
const BASE = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'https://feature-crossword.hop-up-tools.pages.dev';
const HEADED = process.argv.includes('--headed');

const TITLE = '現場の持ち物';
const CREATOR = 'hop';
// ヒントは HELLO! VIDEO の台帳にある BEYOOOOONDS の動画を検索して選ぶ（q は検索の言葉、pick は結果の題名の一部。Hop 2026-10-16）
// ウチワは現場で持つ文化が無く、広げるのは禁止なので外し、BEYOOOOONDS 独自のグッズのカスタネットにした（Hop 2026-10-16）
const WORDS = [
  { a: 'ペンライト', clue: '曲に合わせて色を変えて振る、光る棒', q: 'BEYOSCOOOOOPE', pick: '6月16日' },
  { a: 'マフラータオル', clue: '首に掛けたり掲げたりする、細長いタオル', q: 'BALLROOOOOM', pick: 'グッズ紹介' },
  { a: 'チケット', clue: 'これが無いと会場に入れない', q: 'BUDOOOOOKAN', pick: 'のお知らせ' },
  { a: 'カスタネット', clue: 'BEYOOOOONDS 独自のグッズ。手のひらで打ち鳴らす楽器', q: 'カスタネット', pick: '全国ツアー版' },
];

const rec = await openRecorder(OUT, { headless: !HEADED });
const { page, mark } = rec;
// --save を付けた時だけ本当に保存する（練習の撮影で本番の棚に問題を増やさない）
const SAVE = process.argv.includes('--save');
if (!SAVE) await rec.ctx.route('**/api/crossword-save', (r) => r.abort());
const field = (label) => page.locator(`xpath=//label[contains(normalize-space(.), "${label}")]/following-sibling::*[1]/descendant-or-self::input`).first();

await page.goto(`${BASE}/crossword/create`, { waitUntil: 'networkidle' });
mark('open');
await wait(page, 1500);

mark('title');
await typeSlow(page, field('題名'), TITLE);
await typeSlow(page, field('作った人の名前'), CREATOR);
await tap(page, page.getByRole('checkbox', { name: /初めての人向け/ }));

for (const [i, w] of WORDS.entries()) {
  mark(i === 0 ? 'word' : `word${i + 1}`);
  await typeSlow(page, page.getByPlaceholder('ネコ'), w.a);
  await typeSlow(page, page.getByPlaceholder(/ニャーと鳴く動物/), w.clue, 70);
  if (i === 0) mark('hint');
  const hint = page.getByPlaceholder(/動画の題名/).first();
  await typeSlow(page, hint, w.q);
  const choice = page.getByRole('button', { name: new RegExp(w.pick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
  await choice.waitFor({ timeout: 15000 });
  await scrollTo(page, choice);
  await wait(page, 500);
  await choice.click();
  // 動画の確かめの窓が出る。少し見せてから「この位置でヒントにする」
  const useIt = page.getByRole('button', { name: /この位置でヒントにする/ });
  await useIt.waitFor({ timeout: 15000 });
  await wait(page, 1800);
  await useIt.click();
  await wait(page, 900);
  if (i === 0) mark('add');
  await tap(page, page.getByRole('button', { name: 'リストに追加' }), 1500);
}

// 組み上がった盤を見せる
mark('board');
await wait(page, 5000);
const board = page.locator('[data-move-layer]').first();
await scrollTo(page, board).catch(() => {});
await wait(page, 2500);

// 組み上がった盤の並び（語の位置と向き）を控える。動画用の問題を棚に入れる時に同じ盤にするため
const layout = await page.evaluate(() => {
  const el = document.querySelector('[data-move-layer]');
  const k = el && Object.keys(el).find((x) => x.startsWith('__reactFiber'));
  let f = k ? el[k] : null;
  while (f && !(f.memoizedProps && f.memoizedProps.data && f.memoizedProps.data.items)) f = f.return;
  const d = f && f.memoizedProps.data;
  return d ? { width: d.width, height: d.height, items: d.items.map((i) => ({ answer: i.answer, question: i.question, direction: i.direction, startX: i.startX, startY: i.startY, clueIndex: i.clueIndex })) } : null;
});
writeFileSync(path.join(OUT, 'layout.json'), JSON.stringify(layout, null, 1));
console.log('layout', JSON.stringify(layout));

mark('share');
const share = page.getByRole('button', { name: /共有する/ }).first();
await tap(page, share, 3000);
await wait(page, 4000);

await page.screenshot({ path: path.join(OUT, 'create-end.png') });
console.log(await closeRecorder(rec, OUT, 'create-raw'));
