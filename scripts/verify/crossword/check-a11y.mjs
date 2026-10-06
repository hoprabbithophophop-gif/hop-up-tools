// アクセシビリティの確かめ（2026-10-06）。手元の開発サーバー（vite）をこの台本が立ち上げ、終わったら止める。
// 本番の棚は読むだけで、何も書かない（解くのは ?debug=true の見本の問題。受付係を通さない）。
//   (1) axe-core を画面に差し込み、致命的（critical）・重大（serious）の指摘が0件か。場面は
//       見本の問題（遊び方の窓・解く画面・入力カード）・練習問題・作る画面（作り方の窓）・ギャラリー
//       色のコントラスト（color-contrast）は色の決まり（DESIGN.md・Hop が決める）なので数に入れず、別に件数だけ出す
//   (2) キーボードだけで見本の問題を解く: Tab で最初に盤に入ると 1行1列 → 止まっただけでは開かない → Enter でカード
//       → フォーカスはカードの中 → Tab はカードの中だけで回る → 文字盤で字を入れる → Backspace・矢印が効く
//       → Esc で閉じて元のマスへ戻る → 全部埋めると「解けました」を知らせの入れ物で知らせる
//   (3) 窓（遊び方・作り方・問い合わせ）は role="dialog"・名前つき・開くとフォーカスが中へ・Esc で閉じて元へ戻る
// 使い方: node scripts/verify/crossword/check-a11y.mjs [サイト（省略すると手元の開発サーバーを立てる）]
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { arg, ROOT } from './_lib.mjs';

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
    const { ctx, page } = await newPage({ width: 1280 });
    await page.goto(`${BASE}/crossword/create`);
    await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    await axeScan(page, '作る画面');
    // 作り方の窓
    const help = page.locator('button[aria-label="パズルの作り方"]');
    await help.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await axeScan(page, '作る画面・作り方の窓');
    const a = await active(page);
    check(a.inDialog, `(3) 作り方の窓が開くとフォーカスは窓の中（${a.tag} ${a.text || a.label}）`);
    let stayed = true;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      if (!(await active(page)).inDialog) stayed = false;
    }
    check(stayed, '(3) 作り方の窓の中で Tab が回る（外へ出ない）');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const b = await active(page);
    check(!(await dialogOpen(page)) && b.label === 'パズルの作り方', `(3) Esc で閉じて「?」へ戻る（${b.tag} ${b.label}）`);
    if (await page.getByRole('heading', { name: 'パズルの作り方' }).count()) await page.getByRole('button', { name: '閉じる' }).last().click();
    // 作り方の窓から問い合わせの窓（要望を送る）
    await help.click();
    await page.getByRole('button', { name: '要望を送る' }).click();
    await page.waitForTimeout(600);
    const c = await active(page);
    const contactName = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-modal="true"]');
      const id = d?.getAttribute('aria-labelledby');
      return id ? document.getElementById(id)?.textContent ?? '' : d?.getAttribute('aria-label') ?? '';
    });
    check(c.inDialog && contactName.includes('お問い合わせ'), `(3) 問い合わせの窓は名前つきで、フォーカスは中（${contactName}・${c.tag}）`);
    await axeScan(page, '問い合わせの窓');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(!(await dialogOpen(page)), '(3) 問い合わせの窓は Esc で閉じる');
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage({ width: 1280 });
    await page.goto(`${BASE}/crossword`);
    await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(3000); // 一覧が届くまで
    const cards = await page.locator('main button h2').count();
    check(cards > 0, `(1) ギャラリーにカードが並んだ状態で見る（${cards}枚）`);
    const spoken = await page.locator('main button').filter({ has: page.locator('h2') }).first().evaluate((b) => { const c = b.cloneNode(true); c.querySelectorAll('[aria-hidden="true"]').forEach((e) => e.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); });
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
    const n = await page.locator('main button h2').count();
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
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    check((await page.locator('#cell-0-0').getAttribute('aria-label'))?.endsWith('・空'), `(2) ← と Backspace で消せる（${await page.locator('#cell-0-0').getAttribute('aria-label')}）`);
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
    await page.waitForTimeout(2500);
    const cleared = await page.evaluate(() => document.body.innerText.includes('CLEARED!') || !!document.querySelector('#cell-0-0[disabled]'));
    check(cleared, '(2) キーボードだけで見本の問題が解けた');
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
console.log('');
console.log('axe の件数（致命的・重大 ／ 色のコントラスト ／ 中・軽）');
for (const s of summary) console.log(`  ${s.label}: ${s.bad} ／ ${s.contrast} ／ ${s.rest}`);
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
