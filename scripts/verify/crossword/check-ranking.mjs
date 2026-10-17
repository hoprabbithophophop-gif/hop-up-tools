// ランキングだけを見る入口と画面を確かめる（Hop 指示 2026-10-17）。回は始めない（受付係への呼び出しが0件であること）
// 使い方: node scripts/verify/crossword/check-ranking.mjs [サイト] [問題の番号]
import { chromium } from 'playwright';
import { arg, outDir, BASE_DEFAULT, ID_DEFAULT } from './_lib.mjs';

const BASE = arg(2, BASE_DEFAULT);
const ID = arg(3, ID_DEFAULT);
const OUT = outDir('check-ranking');
let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
const text = (page) => page.evaluate(() => document.body.innerText);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const calls = [];
await ctx.route('**/api/crossword-play', (r) => {
  calls.push(JSON.parse(r.request().postData() || '{}').action);
  return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
});
const page = await ctx.newPage();

// 1. ギャラリーのカードに「ランキング」の入口がある。押すとランキングの画面へ（回は始まらない）
await page.goto(`${BASE}/crossword`);
await page.locator('a[href$="/ranking"]').first().waitFor({ timeout: 20000 });
const cards = await page.locator('a[href$="/ranking"]').count();
check(cards > 0, `1 ギャラリーのカードに「ランキング」の入口がある（${cards}枚）`);
const firstCard = page.locator('a[href$="/ranking"]').first();
await firstCard.scrollIntoViewIfNeeded();
const cb = await firstCard.boundingBox();
await page.screenshot({ path: `${OUT}/card.png`, clip: { x: 0, y: Math.max(0, cb.y - 200), width: 390, height: 260 } });
const href = await firstCard.getAttribute('href');
await firstCard.click();
await page.waitForURL(`**${href}`, { timeout: 10000 });
check(page.url().endsWith('/ranking'), `1 押すとランキングの画面へ: ${page.url()}`);
await page.getByText('ランキング').first().waitFor({ timeout: 20000 });
await page.waitForTimeout(2500);
let t = await text(page);
check(/\d+:\d{2}/.test(t) || t.includes('まだ記録がありません。'), '1 ランキングの表（または「まだ記録がありません。」）が出る');
check((await page.getByRole('link', { name: 'この問題を遊ぶ' }).count()) === 1, '1 「この問題を遊ぶ」がある');
check(calls.length === 0, `1 受付係に回の呼び出しをしない: ${JSON.stringify(calls)}`);
await page.screenshot({ path: `${OUT}/ranking-page.png`, fullPage: true });

// 2. 指定の問題のランキングの画面。題名と作った人が出る。「この問題を遊ぶ」で解く画面へ
await page.goto(`${BASE}/crossword/${ID}/ranking`);
await page.getByRole('link', { name: 'この問題を遊ぶ' }).waitFor({ timeout: 20000 });
await page.waitForTimeout(1500);
t = await text(page);
check(t.includes('作った人：'), '2 作った人が出る');
check((await page.locator('h1').innerText()).trim() === 'ランキング', `2 画面の名前が h1「ランキング」: ${(await page.locator('h1').innerText()).trim()}`);
const titleLine = (await page.locator('main p.text-base').first().innerText()).trim();
check(titleLine.length > 0 && !titleLine.includes('読み込み中'), `2 題名が h1 の上に出る: ${titleLine}`);
const sizes = await page.evaluate(() => [document.querySelector('h1'), document.querySelector('main p.text-base')].map((el) => parseFloat(getComputedStyle(el).fontSize)));
check(sizes[0] > sizes[1] && sizes[1] >= 14, `2 「ランキング」が題名より大きく、題名は14px以上: ${JSON.stringify(sizes)}`);
await page.getByRole('link', { name: 'この問題を遊ぶ' }).click();
await page.waitForURL(`**/crossword/${ID}`, { timeout: 10000 });
check(page.url().endsWith(`/crossword/${ID}`), '2 「この問題を遊ぶ」で解く画面へ');

// 3. 無い問題の番号 → 知らせが出て、画面は壊れない
await page.goto(`${BASE}/crossword/zzzzzzzz/ranking`);
await page.locator('[role="alert"]').waitFor({ timeout: 20000 });
t = await text(page);
check(t.includes('問題の読み込みに失敗しました。') || t.includes('この問題は非表示になっています。'), '3 無い問題は知らせが出る');

// 4. 解き終えた画面のランキングの見出しが、ランキングの画面へのリンク
await page.goto(`${BASE}/crossword/mine`);
await page.evaluate((id) => {
  localStorage.setItem('crossword_seen_help', 'true');
  localStorage.setItem(`crossword_cleared_${id}`, JSON.stringify({ clearTime: 123, userAnswers: {}, clearedAt: Date.now() }));
}, ID);
// 印は盤の全マスの字が要る。解く画面を一度開いて盤を知り、全部埋めた印に差し替える
await page.goto(`${BASE}/crossword/${ID}`);
await page.locator('[id^="cell-"]').first().waitFor({ timeout: 20000 });
const keys = await page.evaluate(() => Array.from(document.querySelectorAll('[id^="cell-"]')).map((el) => el.id.replace('cell-', '').replace('-', ',')));
await page.evaluate(({ id, keys }) => {
  localStorage.setItem(`crossword_cleared_${id}`, JSON.stringify({ clearTime: 123, userAnswers: Object.fromEntries(keys.map((k) => [k, 'ア'])), clearedAt: Date.now() }));
}, { id: ID, keys });
await page.goto(`${BASE}/crossword/${ID}`);
await page.locator('[id^="cell-"]').first().waitFor({ timeout: 20000 });
await page.waitForTimeout(3500);
const heading = page.locator(`a[href="/crossword/${ID}/ranking"]`);
check((await heading.count()) === 1, '4 解き終えた画面のランキングの見出しがリンク');
// 縦に並ぶボタンの幅が揃っている（ヒントの動画を見る・もう一度解く・新規作成）
const widths = await page.evaluate(() => ['パズルギャラリーへ', 'ヒントの動画を見る', 'もう一度解く', '新規作成'].map((label) => {
  const el = Array.from(document.querySelectorAll('button, a')).find((e) => e.textContent.includes(label));
  return el ? Math.round(el.getBoundingClientRect().width) : null;
}));
check(widths.every((w) => w !== null) && new Set(widths).size === 1, `4 縦に並ぶボタンの幅が同じ: ${JSON.stringify(widths)}`);
// 間隔は16px（紙31行目）。4つの入口の、上の下端と次の上端の差
const STACK_LABELS = ['パズルギャラリーへ', 'ヒントの動画を見る', 'もう一度解く', '新規作成'];
const stackBoxes = (p, labels) => p.evaluate((labels) => labels.map((label) => {
  const el = Array.from(document.querySelectorAll('button, a')).find((e) => e.textContent.includes(label));
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { left: Math.round(b.left), width: Math.round(b.width), top: Math.round(b.top + window.scrollY), bottom: Math.round(b.bottom + window.scrollY), text: el.textContent.trim() };
}), labels);
const b390 = await stackBoxes(page, STACK_LABELS);
const gaps = b390.slice(1).map((b, i) => b.top - b390[i].bottom);
check(gaps.every((g) => g === 16), `4 縦に並ぶボタンの間隔が16px: ${JSON.stringify(gaps)}`);
// 印の決まり: ページを移る物（パズルギャラリーへ・新規作成）は後ろに →、その場の操作（ヒントの動画を見る・もう一度解く）は印なし
const arrow = b390.map((b) => /→$/.test(b.text));
check(arrow[0] && arrow[3] && !arrow[1] && !arrow[2], `4 印の決まり（移る物は →・その場の操作は無印）: ${JSON.stringify(b390.map((b) => b.text))}`);
// sm以上（768px）では 320px で中央
await page.setViewportSize({ width: 768, height: 1024 });
await page.waitForTimeout(500);
const b768 = await stackBoxes(page, STACK_LABELS);
const mid768 = await page.evaluate(() => document.body.clientWidth / 2); // 縦のスクロールバーの分だけ 384 より狭い（本文の幅の中央）
const centered = b768.every((b) => b.width === 320 && Math.abs(b.left + b.width / 2 - mid768) <= 1);
check(centered, `4 768px では幅320pxで中央（画面の中央 ${mid768}）: ${JSON.stringify(b768.map((b) => [b.left, b.width]))}`);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const btn = page.getByRole('button', { name: 'もう一度解く' });
await btn.scrollIntoViewIfNeeded();
const bb = await btn.boundingBox();
await page.screenshot({ path: `${OUT}/stack.png`, clip: { x: 0, y: Math.max(0, bb.y - 180), width: 390, height: 330 } });
await heading.click();
await page.waitForURL(`**/crossword/${ID}/ranking`, { timeout: 10000 });
check(page.url().endsWith('/ranking'), '4 見出しからランキングの画面へ');

await browser.close();
console.log(fail ? `NG ${fail} 件` : 'すべて OK');
process.exit(fail ? 1 : 0);
