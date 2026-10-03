// クロスワード段階1の完成の定義（docs/definition-of-done.md）の5項目を、実際の画面で順に確かめる。
// 使い方: `node scripts/verify/crossword/check-stage1.mjs [住所]`（省略時はプレビュー）
// 作る画面で本当に保存するので、本番の Supabase に題名が「検収用」で始まる問題が2つ残る。片付けは Hop に確認してから
// スクリーンショットの置き場は環境変数 VERIFY_OUT があればそこ、無ければ端末の一時置き場の下
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.argv[2] || 'https://feature-crossword.hop-up-tools.pages.dev';
const OUT = path.join(process.env.VERIFY_OUT || path.join(os.tmpdir(), 'crossword-verify'), 'stage1');
mkdirSync(OUT, { recursive: true });

// 画面の言葉。実装に合わせてここだけ直す
const T = {
  add: 'リストに追加',
  save: '共有する',
  check: '答え合わせ',
  hint: 'ヒント',
  dakuten: '゛',
  del: '削除',
  done: '決定',
  building: 'パズルを構築中',
  optimizing: '最適化中',
  clear: 'CLEAR',
  notFilled: 'まだ埋まっていないマスがあります',
};

// ひらがなで入れて、カタカナにそろうかも見る。「ボ」は文字盤の ゛ で作る
const WORDS = [
  { a: 'かぼちゃ', clue: 'ハロウィンでくり抜かれる野菜', hint: 'https://youtu.be/dQw4w9WgXcQ?t=83' },
  { a: 'ちゃーはん', clue: '中華料理店のパラパラのご飯', hint: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s' },
  { a: 'はんかち', clue: 'ポケットに入れて手を拭く布', hint: 'https://ja.wikipedia.org/wiki/ハンカチ' },
  { a: 'かき', clue: '秋に実る橙色の果物', hint: 'https://youtu.be/dQw4w9WgXcQ' },
];

const r = {};
const errs = [];
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const browser = await chromium.launch();

// 見出しと欄が仕組みの上でつながっていないので、見出しのすぐ次にある入力欄を探す。ヒントは案内の文字で探す
const fieldByLabel = (page, label) => label === 'ヒント'
  ? page.getByPlaceholder(/URL を貼る/).first()
  : page.locator('xpath=//label[contains(normalize-space(.), "' + label + '")]/following-sibling::*[1]/descendant-or-self::input').first();
const clickText = (page, text) => page.getByRole('button', { name: text, exact: false }).first().click();

// ---- 1. 作る: 組み立ての動き → 保存 → URL ----
const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
const pa = await ctxA.newPage();
pa.on('pageerror', (e) => errs.push('作る画面: ' + e));
await pa.goto(BASE + '/crossword', { waitUntil: 'networkidle' });
await fieldByLabel(pa, 'タイトル').fill(`検収用 ${stamp}`);
await pa.getByText('その他', { exact: true }).first().click();
let sawOptimizing = false;
for (const w of WORDS) {
  await fieldByLabel(pa, '答え').fill(w.a);
  await fieldByLabel(pa, 'カギ').fill(w.clue);
  await fieldByLabel(pa, 'ヒント').fill(w.hint);
  await clickText(pa, T.add);
  sawOptimizing ||= await pa.getByText(T.optimizing).first().isVisible().catch(() => false);
}
// 50試行×100ms の組み立てが終わるのを待つ
await pa.waitForTimeout(6500);
await pa.screenshot({ path: path.join(OUT, '1-built.png'), fullPage: true });
await clickText(pa, T.save);
const url = await pa.waitForFunction(() => {
  // 共有カードの URL は入力欄の中に出るので、欄の中身も合わせて探す
  const all = document.body.innerText + ' ' + [...document.querySelectorAll('input')].map((i) => i.value).join(' ');
  const m = all.match(/https?:\/\/\S+\/crossword\/[A-Za-z0-9_-]{8}/);
  return m ? m[0] : null;
}, null, { timeout: 20000 }).then((h) => h.jsonValue(), () => null);
r['1 組み立ての動きが出た'] = sawOptimizing;
r['1 保存して URL が出た'] = Boolean(url);

// ---- 5. ヒントの選び方（作る画面のまま確かめる） ----
await pa.goto(BASE + '/crossword', { waitUntil: 'networkidle' });
await pa.getByText('ハロプロ', { exact: true }).first().click();
await fieldByLabel(pa, 'ヒント').fill('https://youtu.be/dQw4w9WgXcQ?t=83');
await pa.waitForTimeout(1500);
const helloText = await pa.evaluate(() => document.body.innerText);
r['5 ハロプロで台帳に無い YouTube を断る'] = /HELLO! VIDEO に載っている動画だけ/.test(helloText);
await pa.getByText('その他', { exact: true }).first().click();
await pa.waitForTimeout(500); // 切り替えで欄が空に戻るのを待ってから貼る
await fieldByLabel(pa, 'ヒント').fill('https://youtu.be/dQw4w9WgXcQ?t=83');
await pa.waitForTimeout(1500);
r['5 その他で URL の時刻が欄に入る'] = await pa.locator('input').evaluateAll((els) => els.some((e) => e.value === '1:23'));
await pa.screenshot({ path: path.join(OUT, '5-hint-picker.png'), fullPage: true });

// ---- 2〜4. 記録が空のブラウザで解く ----
if (url) {
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pb = await ctxB.newPage();
  pb.on('pageerror', (e) => errs.push('解く画面: ' + e));
  await pb.goto(url, { waitUntil: 'domcontentloaded' });
  // isVisible は待たないので、出るまで待つ形で見る
r['2 構築中の動きが出た'] = await pb.getByText(T.building).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  await pb.waitForTimeout(2500);
  // 初回の遊び方を閉じる
  await pb.getByRole('button', { name: /始める|はじめる|閉じる/ }).first().click().catch(() => {});
  const t1 = await pb.evaluate(() => (document.body.innerText.match(/\d\d:\d\d/) || [''])[0]);
  await pb.waitForTimeout(2200);
  const t2 = await pb.evaluate(() => (document.body.innerText.match(/\d\d:\d\d/) || [''])[0]);
  r['2 タイマーが進む'] = Boolean(t1 && t2 && t1 !== t2);
  await pb.screenshot({ path: path.join(OUT, '2-play.png'), fullPage: true });

  // カギの一覧から「ハロウィン」のカギを開いて、文字盤で カ ゛ボ チ 小ャ と入れる（HarmonyPalette と同じく、空きマスでは ゛ や 小 を先に押すと、文字盤の字が濁った字・小さい字の表示に変わる）
  await pb.getByText(WORDS[0].clue).first().click();
  for (const k of ['カ', T.dakuten, 'ボ', 'チ', '小', 'ャ']) await pb.getByRole('button', { name: k, exact: true }).first().click();
  const cardText = await pb.evaluate(() => document.body.innerText);
  r['2 文字盤でカタカナと濁点・小さい字が入る'] = cardText.includes('ボ') && cardText.includes('ャ');

  // 3. ヒント: YouTube は止まった状態で時刻つき
  await clickText(pb, T.hint);
  await pb.waitForTimeout(1500);
  const src = await pb.locator('iframe[src*="youtube"]').first().getAttribute('src').catch(() => null);
  r['3 YouTube のヒントが時刻つきで出て自動再生しない'] = Boolean(src && /start=83/.test(src) && !/autoplay=1/.test(src));
  await pb.screenshot({ path: path.join(OUT, '3-hint.png') });
  await clickText(pb, T.hint);
  await clickText(pb, T.done);

  // 2. 開き直しても残る
  await pb.reload({ waitUntil: 'domcontentloaded' });
  await pb.waitForTimeout(3000);
  r['2 開き直しても入れた答えが残る'] = (await pb.evaluate(() => document.body.innerText)).includes('ボ');

  // 4. 途中で答え合わせ → どこが違うかは示さず、埋まっていないことだけ知らせる（降参は 2026-10-04 に外した）。
  // 全部埋めたときの自動の答え合わせとクリアの演出は check-auto-check.mjs で確かめる
  await clickText(pb, T.check);
  await pb.waitForTimeout(500);
  const afterCheck = await pb.evaluate(() => document.body.innerText);
  r['4 途中の答え合わせは埋まっていないことだけ知らせる'] = afterCheck.includes(T.notFilled);
  await pb.screenshot({ path: path.join(OUT, '4-check.png'), fullPage: true });
  await ctxB.close();
}

await browser.close();
r['残った試しの問題'] = url || 'なし';
r['つまずき'] = errs.length ? errs : 'なし';
console.log(JSON.stringify(r, null, 1));
const ok = Object.entries(r).every(([k, v]) => k.startsWith('残った') || (k === 'つまずき' ? v === 'なし' : v === true));
console.log(ok ? '合' : '否');
console.log('写真: ' + OUT);
process.exit(ok ? 0 : 1);
