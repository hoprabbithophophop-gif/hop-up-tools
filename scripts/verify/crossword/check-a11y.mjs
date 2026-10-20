// アクセシビリティの確かめ（2026-10-06）。手元の開発サーバー（vite）をこの台本が立ち上げ、終わったら止める。
// 本番の棚は読むだけで、何も書かない（解くのは ?debug=true の見本の問題。受付係を通さない）。
//   (1) axe-core を画面に差し込み、致命的（critical）・重大（serious）の指摘が0件か。場面は
//       見本の問題（遊び方の窓・解く画面・入力カード）・練習問題・作る画面（1の段・ヒントの窓・2の段・3の段・4の窓）・問い合わせの窓・ギャラリー
//       色のコントラスト（color-contrast）は色の決まり（DESIGN.md・Hop が決める）なので数に入れず、別に件数だけ出す
//   (2) キーボードだけで見本の問題を解く: Tab で最初に盤に入ると 1行1列 → 止まっただけでは開かない → Enter でカード
//       → フォーカスはカードの中 → Tab はカードの中だけで回る → 文字盤で字を入れる → Backspace・矢印が効く
//       → Esc で閉じて元のマスへ戻る → 全部埋めると「解けました」を知らせの入れ物で知らせる
//   (2) 作る画面もキーボード（Tab・Enter・矢印・Esc）だけで1の段から4の窓まで行ける（なぞる代わりに欄で選んで「【 】」。段が変わると見出しへフォーカス）
//   (3) 窓（遊び方・ヒントの窓・4の窓・問い合わせ）は role="dialog"・名前つき・開くとフォーカスが中へ・Esc で閉じて元へ戻る
//   作る画面の部分は 2026-10-21 に4段の流れに合わせて書き直した（作る画面の「?」と作り方の窓は 2026-10-20 に外れた）
// 使い方: node scripts/verify/crossword/check-a11y.mjs [サイト（省略すると手元の開発サーバーを立てる）]
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { arg, ROOT, watchStumbles } from './_lib.mjs';
import { writeLines, hintMode, hintAllInAnswers, toBoard, toClues, openShare } from './_create.mjs';

const PORT = 5195;
const LOCAL = `http://localhost:${PORT}`;
const BASE = arg(2, LOCAL);
const AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
// 棚（Supabase）は見本に差し替える（開発サーバーをこの行き先で立て、ブラウザの中で受け止める。本番の棚には行かない）
const MOCK_SUPA = 'https://mock-supabase.invalid';
const puzzleRow = (id, title, extra = {}) => ({
  id, title, genre: 'other', tags: [], created_at: '2026-10-06T00:00:00Z', play_count: 3, is_beginner: false, group_tags: [],
  body: { version: 1, width: 2, height: 3, creatorName: '台本', clues: [
    { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: 'ヨコの見本のカギ', length: 2 },
    { clueIndex: 2, direction: 'vertical', startX: 1, startY: 0, clue: 'タテの見本のカギ', length: 3 },
  ] },
  ...extra,
});
const ROWS = [puzzleRow('A11Y0001', '見本の問題その1', { is_beginner: true }), puzzleRow('A11Y0002', '見本の問題その2')];

let fail = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
  if (!ok) fail++;
};

// --- 開発サーバー ---
let server = null;
function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
}
async function startServer() {
  server = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VITE_SUPABASE_URL: MOCK_SUPA, VITE_SUPABASE_ANON_KEY: 'mock-anon-key' },
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    if (server.exitCode !== null) throw new Error(`開発サーバーが止まった: ${log.slice(-500)}`);
    try {
      const r = await fetch(LOCAL);
      if (r.ok) return;
    } catch { /* まだ */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('開発サーバーが60秒で立ち上がらなかった');
}

let browser = null;
const writes = [];
// 画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）の控え
const stumbles = [];
async function newPage({ seenHelp = true, width = 390 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  if (seenHelp) await ctx.addInitScript(() => { try { localStorage.setItem('crossword_seen_help', 'true'); } catch { /* */ } });
  ctx.on('request', (r) => {
    const u = r.url();
    if (u.includes('/api/') || (u.includes('/rest/v1/') && !u.startsWith(MOCK_SUPA) && !['GET', 'HEAD'].includes(r.method()))) writes.push(`${r.method()} ${u.replace(/\?.*/, '')}`);
  });
  // 外のサイト（YouTube・Turnstile）へは出さない
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|www\.youtube-nocookie\.com|challenges\.cloudflare\.com)\//, (r) => r.fulfill({ status: 204, body: '' }));
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const u = new URL(route.request().url());
    const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname.includes('/rpc/')) return json(false);
    return json(u.pathname.endsWith('/crossword_puzzles') ? ROWS : []);
  });
  const page = await ctx.newPage();
  await watchStumbles(page, stumbles);
  return { ctx, page };
}

// axe を流して、影響ごとの件数と指摘の一覧を返す
const axeTotals = { before: null };
const summary = [];
async function axeScan(page, label) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ url: AXE });
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.target.join(' ')) }));
  });
  const bad = res.filter((v) => (v.impact === 'critical' || v.impact === 'serious') && v.id !== 'color-contrast');
  const contrast = res.find((v) => v.id === 'color-contrast');
  const rest = res.filter((v) => v.impact !== 'critical' && v.impact !== 'serious');
  summary.push({ label, bad: bad.reduce((s, v) => s + v.n, 0), contrast: contrast?.n ?? 0, rest: rest.reduce((s, v) => s + v.n, 0) });
  check(bad.length === 0, `(1) ${label}: 致命的・重大 ${bad.reduce((s, v) => s + v.n, 0)}件${bad.length ? '（' + bad.map((v) => `${v.id}[${v.impact}]×${v.n} 例 ${v.sample.join(' / ')}`).join('；') + '）' : ''}`);
  if (contrast) console.log(`    （色のコントラスト ${contrast.n}件。色は Hop が決めるので数に入れない）`);
  if (rest.length) console.log(`    （中・軽の指摘: ${rest.map((v) => `${v.id}[${v.impact}]×${v.n}`).join('、')}）`);
}

const active = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return { id: a?.id ?? '', label: a?.getAttribute('aria-label') ?? '', text: (a?.textContent ?? '').trim().slice(0, 20), inDialog: !!a?.closest('[role="dialog"][aria-modal="true"]'), tag: a?.tagName ?? '' };
});
const dialogOpen = (page) => page.evaluate(() => !!document.querySelector('[role="dialog"][aria-modal="true"]'));
const dialogName = (page) => page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-modal="true"]');
  const id = d?.getAttribute('aria-labelledby');
  return id ? document.getElementById(id)?.textContent ?? '' : d?.getAttribute('aria-label') ?? '';
});
// 窓が開いている間、Tab を n 回押してもフォーカスが窓の外へ出ないか
async function tabStays(page, n) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    if (!(await active(page)).inDialog) return false;
  }
  return true;
}
// Tab（届かなければ Shift+Tab）だけで selector の物にフォーカスを移す。移れたら true
async function tabTo(page, selector, max = 60) {
  const here = () => page.evaluate((s) => !!document.activeElement?.matches(s), selector);
  if (await here()) return true;
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press(key);
      if (await here()) return true;
    }
  }
  return false;
}
const liveText = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[aria-live="polite"]')).map((e) => e.textContent).join(' '));

// 見本の問題の答え（CrosswordPage.tsx の DEBUG_MOCK_PUZZLE）。カギの文 → 答え
const DEBUG_ANSWERS = {
  '動物の一種、ニャーと鳴く': 'ねこ',
  '犬の子供': 'こいぬ',
  '座るための家具': 'いす',
  '夏に食べる緑と赤の果物': 'すいか',
  '秋に実る橙色の果物': 'かき',
};
const DEBUG_CELLS = ['0,0', '1,0', '1,1', '2,1', '1,2', '2,2', '2,3', '3,3'];

async function run() {
  // ===== (1) axe =====
  {
    // 遊び方の窓（初めて開いた時）
    const { ctx, page } = await newPage({ seenHelp: false });
    await page.goto(`${BASE}/crossword/create?debug=true`);
    await page.getByText('始める！').waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    await axeScan(page, '見本の問題・遊び方の窓');
    const a = await active(page);
    check(a.inDialog, `(3) 遊び方の窓が開くとフォーカスは窓の中（${a.tag} ${a.text || a.label}）`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check(!(await page.getByText('始める！').isVisible()), '(3) 遊び方の窓は Esc で閉じる');
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/crossword/create?debug=true`);
    await page.locator('#cell-0-0').waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500); // 組み上がりの演出
    await axeScan(page, '見本の問題・解く画面');
    await page.locator('#cell-0-0').click();
    await page.locator('[data-coach="keypad"]').waitFor();
    await page.waitForTimeout(500);
    await axeScan(page, '見本の問題・入力カード');
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/crossword/tutorial`);
    await page.locator('#cell-0-0').waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    await axeScan(page, '練習問題（案内の吹き出しつき）');
    await ctx.close();
  }
  {
    // 練習問題: 先頭からの最初の Tab が盤の 1行1列 より先へ飛ばない（案内が左上のマスへスクロールしても Tab の出発点が動かない）
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/crossword/tutorial`);
    await page.locator('#cell-0-0').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    let firstCell = null;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const a = await active(page);
      if (a.id.startsWith('cell-')) { firstCell = a.id; break; }
    }
    check(firstCell === 'cell-0-0', `(2) 練習問題で Tab で最初に止まるマスは 1行1列（${firstCell}）`);
    await ctx.close();
  }
  {
    // 文字200%（390px）: 入力カードの中が縦にスクロールできる（収まらない時だけ縦の指の動きを許す）
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/crossword/create?debug=true`);
    await page.locator('#cell-0-0').waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await page.locator('#cell-0-0').click();
    await page.locator('[data-coach="keypad"]').waitFor();
    await page.waitForTimeout(800);
    const sheet = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-modal="true"]');
      return d ? { over: d.scrollHeight > d.clientHeight, touch: getComputedStyle(d).touchAction, overflowY: getComputedStyle(d).overflowY } : null;
    });
    check(!!sheet && (!sheet.over || (/pan-y/.test(sheet.touch) && /auto|scroll/.test(sheet.overflowY))), `(1) 文字200%の入力カードは中を縦にスクロールできる（${JSON.stringify(sheet)}）`);
    await ctx.close();
  }
  {
    // 作る画面（4段の流れ・2026-10-20）。1の段・ヒントの窓・2の段・3の段・4の窓で axe。窓は名前つき・フォーカスが中・Tab が中で回る・Esc で閉じて元へ
    const { ctx, page } = await newPage({ width: 1280 });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    await axeScan(page, '作る画面・1の段（書く）');
    await writeLines(page, 'ニャーと鳴く動物→【ネコ】\n【コアラ】はユーカリを食べる');
    await hintMode(page);
    await axeScan(page, '作る画面・1の段（ヒントを付ける）');
    // ヒントの窓（下線の語に Enter）
    await page.locator('[data-bulk-mark="ネコ"]').focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-hint-sheet]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(400);
    await axeScan(page, '作る画面・ヒントの窓');
    const a = await active(page);
    check(a.inDialog && (await dialogName(page)) === '「ネコ」のヒント', `(3) ヒントの窓は名前つき（${await dialogName(page)}）で、開くとフォーカスは窓の中（${a.tag} ${a.text || a.label}）`);
    check(await tabStays(page, 15), '(3) ヒントの窓の中で Tab が回る（外へ出ない）');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const b = await active(page);
    check(!(await dialogOpen(page)) && b.label === 'ネコ を選ぶ', `(3) Esc でヒントの窓が閉じて、押した語へ戻る（${b.tag} ${b.label}）`);
    await hintAllInAnswers(page, ['ネコ', 'コアラ']);
    await toBoard(page);
    await page.waitForTimeout(300);
    await axeScan(page, '作る画面・2の段');
    await toClues(page);
    await page.waitForTimeout(300);
    const h = await active(page);
    check(h.tag === 'H2' && h.text === 'カギを書く', `(2) 段が変わるとフォーカスは段の見出しへ（${h.tag} ${h.text}）`);
    await axeScan(page, '作る画面・3の段');
    await openShare(page);
    await page.waitForTimeout(400);
    await axeScan(page, '作る画面・4の窓（共有する）');
    const c = await active(page);
    check(c.inDialog && (await dialogName(page)) === '共有する', `(3) 4の窓は名前つき（${await dialogName(page)}）で、開くとフォーカスは窓の中（${c.tag} ${c.text || c.label}）`);
    check(await tabStays(page, 15), '(3) 4の窓の中で Tab が回る（外へ出ない）');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check(!(await dialogOpen(page)) && (await page.locator('[data-create-step="3"]').count()) === 1, '(3) Esc で4の窓が閉じて3の段に戻る');
    await ctx.close();
  }
  {
    // 解く画面の「?」（遊び方）→「要望を送る」で問い合わせの窓（作る画面の「?」は 2026-10-20 に外したので、解く画面の見本の問題で）
    const { ctx, page } = await newPage({ width: 1280 });
    await page.goto(`${BASE}/crossword/create?debug=true`);
    await page.locator('#cell-0-0').waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    await page.getByTitle('遊び方').first().click();
    await page.getByRole('button', { name: '要望を送る' }).click();
    await page.waitForTimeout(600);
    const c = await active(page);
    const contactName = await dialogName(page);
    check(c.inDialog && contactName.includes('お問い合わせ'), `(3) 問い合わせの窓は名前つきで、フォーカスは中（${contactName}・${c.tag}）`);
    await axeScan(page, '問い合わせの窓');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(!(await dialogOpen(page)), '(3) 問い合わせの窓は Esc で閉じる');
    await ctx.close();
  }
  {
    // (2) 作る画面もキーボードだけで1の段から4の窓まで行ける（なぞる代わりに、欄で文字を選んで「【 】」ボタン）
    const { ctx, page } = await newPage({ width: 1280 });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    const reached = [];
    const step = async (label, ok) => { reached.push(`${ok ? '○' : '×'}${label}`); if (!ok) throw new Error(`キーボードで ${label} に行けない`); };
    try {
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await step('書く欄', await tabTo(page, '#cw-bulk-text'));
      await page.keyboard.insertText('ニャーと鳴く動物→ネコ\nコアラはユーカリを食べる');
      // 1行目の「ネコ」を Shift＋矢印で選び、Tab で「【 】」へ移って Enter
      await page.keyboard.press('Control+Home');
      for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
      for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowRight');
      await step('「【 】」ボタン', await tabTo(page, '[data-bulk-insert="brackets"]'));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      // 2行目の「コアラ」も同じく
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Home');
      for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
      await step('「【 】」ボタン（2語目）', await tabTo(page, '[data-bulk-insert="brackets"]'));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      const v = await page.locator('[data-bulk-text]').inputValue();
      await step(`【 】で囲めた（${v.replace(/\n/g, ' ／ ')}）`, v === 'ニャーと鳴く動物→【ネコ】\n【コアラ】はユーカリを食べる');
      await step('「ヒントを付ける」', await tabTo(page, '[data-bulk-mode-button="hint"]'));
      await page.keyboard.press('Enter');
      await page.locator('[data-bulk-lines]').waitFor({ timeout: 5000 });
      for (const w of ['ネコ', 'コアラ']) {
        await step(`下線の語「${w}」`, await tabTo(page, `[data-bulk-mark="${w}"]`));
        await page.keyboard.press('Enter');
        await page.locator('[data-hint-sheet]').waitFor({ timeout: 5000 });
        await step(`「${w}」のヒントの欄`, await tabTo(page, '[data-hint-sheet] #cw-hint'));
        await page.keyboard.insertText(`https://example.com/${encodeURIComponent(w)}`);
        await page.locator('[data-hint-sheet] [data-hint-kind]').waitFor({ timeout: 5000 });
        await page.keyboard.press('Escape');
        await page.locator('[data-hint-sheet]').waitFor({ state: 'detached', timeout: 5000 });
      }
      await step('「組み合わせを探す」', await tabTo(page, '[data-bulk-search]'));
      await page.keyboard.press('Enter');
      await page.locator('[data-bulk-adopt]:enabled').waitFor({ timeout: 45000 });
      await step('「この盤で進む」', await tabTo(page, '[data-bulk-adopt]'));
      await page.keyboard.press('Enter');
      await page.locator('[data-create-step="3"]').waitFor({ timeout: 5000 });
      await step('「共有する」', await tabTo(page, '[data-open-share]'));
      await page.keyboard.press('Enter');
      await page.locator('[data-share-sheet]').waitFor({ timeout: 5000 });
      await step('題名の欄', await tabTo(page, '#cw-title'));
      await page.keyboard.insertText('キーボードの確かめ');
      await step('4の窓の「共有する」', await tabTo(page, '[data-share-sheet] [data-save]'));
    } catch { /* 下で NG にする */ }
    check(!reached.some((r) => r.startsWith('×')) && reached.length === 14, `(2) キーボード（Tab・Enter・矢印・Esc）だけで1の段から4の窓の「共有する」まで行ける（${reached.join(' → ')}）`);
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage({ width: 1280 });
    await page.goto(`${BASE}/crossword`);
    await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(3000); // 一覧が届くまで
    const cards = await page.locator('main article h2').count(); // カードは article（面の押下＋下段の「ランキング」「遊ぶ」のリンク。2026-10-17）
    check(cards > 0, `(1) ギャラリーにカードが並んだ状態で見る（${cards}枚）`);
    const spoken = await page.locator('main article a').evaluateAll((as) => as.map((a) => a.getAttribute('aria-label') || a.textContent.replace(/\s+/g, ' ').trim()).join(' / '));
    check(!/extension|person|calendar_today|play_arrow/.test(spoken), `(1) カードの読み上げ名にアイコンの綴りが混ざらない（${spoken.slice(0, 40)}）`);
    await axeScan(page, 'ギャラリー');
    await ctx.close();
  }
  {
    // 文字200%（390px）: ギャラリーに横スクロールが出ない
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/crossword`);
    await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 20000 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await page.waitForTimeout(800);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const n = await page.locator('main article h2').count();
    check(over <= 0 && n > 0, `(1) 文字200%・390px のギャラリー（カード ${n}枚）に横スクロールが無い（はみ出し ${over}px）`);
    await ctx.close();
  }

  // ===== (2) キーボードだけで見本の問題を解く =====
  {
    const { ctx, page } = await newPage({ width: 1280 });
    await page.goto(`${BASE}/crossword/create?debug=true`);
    await page.locator('#cell-0-0').waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    // 先頭から Tab で盤に入る
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    let first = null;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const a = await active(page);
      if (a.id.startsWith('cell-')) { first = a; break; }
    }
    check(first?.id === 'cell-0-0', `(2) Tab で最初に止まるマスは 1行1列（${first?.id}・${first?.label}）`);
    check(/^1ヨコ・2文字の1文字目/.test(first?.label ?? ''), `(2) マスの読み上げ名に番号・向き・位置（${first?.label}）`);
    await page.waitForTimeout(300);
    check(!(await dialogOpen(page)), '(2) マスに Tab で止まっただけではカードは開かない');
    // Tab で次のマスへ（読む順）
    await page.keyboard.press('Tab');
    const second = await active(page);
    check(second.id === 'cell-1-0', `(2) 次の Tab は 1行2列（${second.id}）`);
    await page.keyboard.press('Shift+Tab');

    // Enter でカード
    await page.keyboard.press('Enter');
    await page.locator('[data-coach="keypad"]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(400);
    const inCard = await active(page);
    check(inCard.inDialog, `(2) Enter でカードが開き、フォーカスはカードの中（${inCard.tag} ${inCard.label || inCard.text}）`);
    check(/1文字目・空・選択中/.test(inCard.label), `(2) カードのマスの読み上げ名（${inCard.label}）`);
    let stayed = true;
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press('Tab');
      if (!(await active(page)).inDialog) { stayed = false; break; }
    }
    check(stayed, '(2) カードが開いている間、Tab はカードの中だけで回る');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const back = await active(page);
    check(!(await dialogOpen(page)) && back.id === 'cell-0-0', `(2) Esc で閉じて元のマスへ戻る（${back.id}）`);

    // 文字盤で字を入れる → Backspace・矢印
    await page.keyboard.press('Enter');
    await page.locator('[data-coach="keypad"]').waitFor();
    await page.waitForTimeout(300);
    const keyBtn = (ch) => page.locator('[data-coach="keypad"]').getByRole('button', { name: ch, exact: true }).first();
    await keyBtn('の').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    check((await page.locator('#cell-0-0').getAttribute('aria-label'))?.endsWith('・の'), `(2) 文字盤のキーに Enter で字が入る（${await page.locator('#cell-0-0').getAttribute('aria-label')}）`);
    // 縦線（2026-10-07）: 字を入れると縦線は次へ。読み上げは「2文字目の前」。← で戻ると「1文字目の前」、→ でまた「2文字目の前」
    const caretText = () => page.locator('[data-coach="closeup-cells"] [aria-live="polite"]').textContent();
    check((await caretText()) === '2文字目の前', `(2) 字を入れると縦線が次へ進み、位置を読み上げる（${await caretText()}）`);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(100);
    check((await caretText()) === '1文字目の前', `(2) ← で縦線が1つ左へ（${await caretText()}）`);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    check((await page.locator('#cell-0-0').getAttribute('aria-label'))?.endsWith('・空') && (await caretText()) === '1文字目の前', `(2) Backspace で縦線の左の字が消え、縦線が1つ左へ（${await page.locator('#cell-0-0').getAttribute('aria-label')}・${await caretText()}）`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // 全部のマスを埋める（マスに Enter → カードのカギを読んで、選択中のマスから先を打つ → Esc）
    for (let round = 0; round < 10; round++) {
      const empty = [];
      for (const k of DEBUG_CELLS) {
        const [x, y] = k.split(',');
        if ((await page.locator(`#cell-${x}-${y}`).getAttribute('aria-label'))?.endsWith('・空')) empty.push(k);
      }
      if (!empty.length) break;
      const [x, y] = empty[0].split(',');
      await page.locator(`#cell-${x}-${y}`).focus();
      await page.keyboard.press('Enter');
      await page.locator('[data-coach="keypad"]').waitFor();
      await page.waitForTimeout(250);
      const q = (await page.locator('[role="dialog"][aria-modal="true"] [data-closeup-question]').textContent()).trim();
      const ans = DEBUG_ANSWERS[q];
      const labels = await page.locator('[data-coach="closeup-cells"] button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      const idx = labels.findIndex((l) => l?.endsWith('選択中'));
      if (!ans || idx < 0) { check(false, `(2) カードのカギと選択中のマスが読めない（${q} / ${labels.join(' | ')}）`); break; }
      for (const ch of ans.slice(idx)) {
        await keyBtn(ch).focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(80);
      }
      await page.waitForTimeout(700);
      if (await dialogOpen(page)) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      }
    }
    await page.waitForFunction(() => document.body.innerText.includes('CLEARED!') || !!document.querySelector('#cell-0-0[disabled]'), null, { timeout: 15000 }).catch(() => {});
    const cleared = await page.evaluate(() => document.body.innerText.includes('CLEARED!') || !!document.querySelector('#cell-0-0[disabled]'));
    check(cleared, '(2) キーボードだけで見本の問題が解けた');
    await page.waitForFunction(() => /解けました/.test([...document.querySelectorAll('[aria-live]')].map((e) => e.textContent).join(' ')), null, { timeout: 5000 }).catch(() => {}); // 知らせはハンコの直後に入る
    const live = await liveText(page);
    check(/解けました/.test(live), `(2) 解けたことを知らせの入れ物で知らせる（${live.trim().slice(0, 40)}）`);
    check(!/\berror\b/.test(live), '(2) 知らせの入れ物にアイコンの綴り（error）が混ざらない');
    await ctx.close();
  }
  {
    // 知らせ: 間違いを全部埋めた時、「どこかに間違いがあります。」が入れ物に入る（入れ物は最初からある）
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/crossword/create?debug=true`);
    await page.locator('#cell-0-0').waitFor({ timeout: 20000 });
    const before = await page.evaluate(() => document.querySelectorAll('[aria-live="polite"]').length);
    check(before > 0, `(2) 知らせの入れ物（aria-live）は最初から置いてある（${before}個）`);
    await ctx.close();
  }
  check(writes.length === 0, `書き込み・受付係への呼び出しは0回（${writes.length}回${writes.length ? ': ' + writes.join(' / ') : ''}）`);
}

try {
  if (BASE === LOCAL) await startServer();
  browser = await chromium.launch();
  await run();
} catch (e) {
  console.log(`NG 台本が途中で止まった: ${e.stack || e.message}`);
  fail++;
} finally {
  await browser?.close().catch(() => {});
  stopServer();
}
check(stumbles.length === 0, `画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）が無い${stumbles.length ? ': ' + stumbles.slice(0, 3).join(' / ') : ''}`);
console.log('');
console.log('axe の件数（致命的・重大 ／ 色のコントラスト ／ 中・軽）');
for (const s of summary) console.log(`  ${s.label}: ${s.bad} ／ ${s.contrast} ／ ${s.rest}`);
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
