// 公開前レビュー4本（2026-10-06）の直しを、手元の開発サーバーで確かめる。本番にもプレビューにも通信しない。
// 手元の vite をこの台本が立ち上げ（Supabase の住所は使わない仮の住所）、棚（/rest/v1）と受付係（/api）への通信は
// すべてブラウザの中で受け止めて、台本の中の見本の問題で答える。終わったら開発サーバーを止める。
//   (1) ゛゜は直前に打った字のマスに付く（次のマスに交差の字があっても壊れない）
//   (2) 最後のマスが濁る字: 埋まった瞬間の答え合わせは待ってから走り、゛ の後の盤で丸付けする。待ちの間は入力の窓が開いたまま
//   (3) 「始める！」で回は1つだけ始まる（回が返る前に字を入れても二重に始まらない）
//   (4) 解けた後: ↻ が無い・端末の途中経過が消える・開き直すと新しい回で空の盤。終わりの画面の並び（A）と写真
//   (5) 答え合わせの通信中に直した字は、通信の後にもう一度丸付けされる
//   (6) 練習問題のハンコは2秒で薄れる（C）
//   (7) ギャラリー: グループの印が無くてもタグにグループ名（表記ゆれ込み）がある問題を拾う（B）・空の絞り込みの道（E）
//   (8) 作る画面: 「リストに追加」が押せない理由の1行（D）・置けない所の上の影（F）・固定がつながらない盤（8）・1日5個の知らせが無い
//   (9) 作る画面の案内（11段）は、記録の空のブラウザで初めて開いても自動では始まらない
// 使い方: node scripts/verify/crossword/check-review-fixes.mjs（引数なし）
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { outDir, ROOT, leaveFirstVisitMarks, cellState } from './_lib.mjs';

// 「初めて」の印は台本の中で場面ごとに立てる
leaveFirstVisitMarks();

const PORT = 5193;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-review-fixes');
const W = 390;

let fail = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
  if (!ok) fail++;
};

// ---- 開発サーバー（仮の Supabase の住所で立てる。本物の鍵は使わない） ----
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
      if ((await fetch(BASE)).ok) return;
    } catch { /* まだ */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('開発サーバーが60秒で立ち上がらなかった');
}

// ---- 見本の問題 ----
// 盤: バキ 横(0,0)・キクラ 縦(1,0)。(1,0) の キ が交差の字
const PUZZLE_ID = 'MOCKREV1';
const SOLUTION = { '0,0': 'バ', '1,0': 'キ', '1,1': 'ク', '1,2': 'ラ' };
const ANSWERS = [['バ', 'キ'], ['キ', 'ク', 'ラ']];
const puzzleRow = (id, extra = {}) => ({
  id,
  title: `見本 ${id}`,
  genre: 'other',
  tags: [],
  created_at: '2026-10-06T00:00:00Z',
  play_count: 0,
  is_beginner: false,
  group_tags: [],
  body: {
    version: 1, width: 2, height: 3, creatorName: '台本',
    clues: [
      { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: 'ヨコの見本のカギ', length: 2, hint: { kind: 'youtube', videoId: 'dQw4w9WgXcQ', startSec: 0 } },
      { clueIndex: 2, direction: 'vertical', startX: 1, startY: 0, clue: 'タテの見本のカギ', length: 3, hint: { kind: 'link', url: 'https://example.com/' } },
    ],
  },
  ...extra,
});
const BASE_ROWS = [
  puzzleRow(PUZZLE_ID),
  puzzleRow('MOCKOTH1', { title: 'ほかの見本', created_at: '2026-10-05T00:00:00Z' }),
];
// ギャラリーの絞り込み用（B）
const GALLERY_ROWS = [
  puzzleRow('GAL1', { title: '印あり アンジュルム', genre: 'hello', group_tags: ['アンジュルム'], created_at: '2026-10-04T00:00:00Z' }),
  puzzleRow('GAL2', { title: 'タグ 全角ビヨ', genre: 'hello', tags: ['ＢＥＹＯＯＯＯＯＮＤＳ'], created_at: '2026-10-03T00:00:00Z' }),
  puzzleRow('GAL3', { title: 'タグ モー娘年なし', genre: 'hello', tags: ['モーニング娘。が好き'], created_at: '2026-10-02T00:00:00Z' }),
  puzzleRow('GAL4', { title: 'タグ 関係なし', genre: 'other', tags: ['ほかの話'], created_at: '2026-10-01T00:00:00Z' }),
];

// ---- 棚（PostgREST）の受け止め ----
const unq = (s) => s.replace(/^"(.*)"$/, '$1');
const listOf = (s) => s.replace(/^[({]|[)}]$/g, '').split(',').filter(Boolean).map(unq);
function matches(row, key, raw) {
  const v = row[key];
  const [op, ...rest] = raw.split('.');
  const arg = rest.join('.');
  if (op === 'eq') return String(v) === unq(arg);
  if (op === 'neq') return String(v) !== unq(arg);
  if (op === 'in') return listOf(arg).includes(String(v));
  if (op === 'cs') return listOf(arg).every((x) => (v ?? []).includes(x));
  return true;
}
function mockSupabase(ctx, tables, log = []) {
  return ctx.route(`${MOCK_SUPA}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    log.push(`${req.method()} ${u.pathname}${u.search}`);
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.endsWith('/rpc/crossword_is_hidden')) return json(false);
    const table = u.pathname.split('/').pop();
    let rows = [...(tables[table] ?? [])];
    for (const [k, v] of u.searchParams) {
      if (['select', 'order', 'offset', 'limit'].includes(k) || k.includes('->')) continue;
      rows = rows.filter((r) => matches(r, k, v));
    }
    const order = u.searchParams.get('order');
    if (order) {
      const keys = order.split(',').map((o) => o.split('.'));
      rows.sort((a, b) => {
        for (const [k, dir] of keys) {
          if (a[k] === b[k]) continue;
          return (a[k] < b[k] ? -1 : 1) * (dir === 'desc' ? -1 : 1);
        }
        return 0;
      });
    }
    const off = Number(u.searchParams.get('offset') ?? 0);
    const lim = u.searchParams.get('limit');
    rows = rows.slice(off, lim === null ? undefined : off + Number(lim));
    if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) return json(rows[0] ?? null);
    return json(rows);
  });
}

// ---- 受付係（/api/crossword-play）の受け止め ----
function mockPlay(ctx, opts = {}) {
  const st = { starts: 0, checks: [], touches: 0 };
  ctx.route('**/api/crossword-play', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const reply = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...o }) });
    if (body.action === 'start') {
      st.starts++;
      if (opts.startDelay) await new Promise((r) => setTimeout(r, opts.startDelay));
      return reply({ token: `tok-${st.starts}`, startedAt: Date.now() });
    }
    if (body.action === 'touch') {
      st.touches++;
      return reply({ counted: true });
    }
    if (body.action === 'check') {
      st.checks.push({ ...body.answers });
      if (opts.checkDelay) await new Promise((r) => setTimeout(r, opts.checkDelay));
      const correct = Object.keys(SOLUTION).every((k) => body.answers[k] === SOLUTION[k]);
      return reply(correct ? { correct, answers: ANSWERS, timeSeconds: 60, rankable: true } : { correct });
    }
    if (body.action === 'reveal') return reply({ char: SOLUTION[`${body.x},${body.y}`], reveals: 1 });
    return route.fulfill({ status: 400, body: '{}' });
  });
  ctx.route('**/api/crossword-score', (r) => r.fulfill({ status: 500, body: '{}' }));
  return st;
}

const browser = await chromium.launch();
const pageErrors = [];
async function newPage({ marks = {}, tables = { crossword_puzzles: BASE_ROWS, crossword_scores: [], youtube_videos: [] }, play = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((m) => {
    try {
      if (sessionStorage.getItem('__marks')) return; // 開き直した時は印を立て直さない
      sessionStorage.setItem('__marks', '1');
      for (const [k, v] of Object.entries(m)) localStorage.setItem(k, v);
    } catch { /* 無視 */ }
  }, marks);
  const supaLog = [];
  await mockSupabase(ctx, tables, supaLog);
  const st = mockPlay(ctx, play);
  // 外のサイト（YouTube のサムネイル等）へは出さない
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com)\//, (r) => r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  return { ctx, page, st, supaLog };
}
const SEEN_SOLVE = { crossword_seen_help: 'true', crossword_seen_first_cell: '1' };
const progress = (answers) => JSON.stringify({ userAnswers: answers, elapsedSeconds: 5, savedAt: Date.now() });
const cell = (page, x, y) => page.locator(`#cell-${x}-${y}`);
// マスの読み上げ名の最後の字を「1行1列：バ」の形にして返す（読み上げ名は「1ヨコ・2文字の1文字目・バ」の形。2026-10-06）
const cellText = async (page, x, y) => `${y + 1}行${x + 1}列：${cellState(await cell(page, x, y).getAttribute('aria-label'))}`;
const key = (page, ch) => page.locator('[data-coach="keypad"]').getByRole('button', { name: ch, exact: true }).first();
const stamped = (page) => page.evaluate(() => document.body.innerText.includes('CLEARED!'));
async function openPuzzle(page, waitBoard = true) {
  await page.goto(`${BASE}/crossword/${PUZZLE_ID}`);
  if (waitBoard) await cell(page, 0, 0).waitFor({ timeout: 20000 });
}
const openAcross = (page) => page.getByText('ヨコの見本のカギ').last().click();

try {
  await startServer();

  // ---- (1) ゛ は直前に打った字のマスに付く ----
  {
    const { ctx, page } = await newPage({ marks: { ...SEEN_SOLVE, [`crossword_progress_${PUZZLE_ID}`]: progress({ '1,0': 'キ' }) } });
    await openPuzzle(page);
    await openAcross(page);
    await key(page, 'ハ').click();
    await key(page, '゛').click();
    await page.waitForTimeout(300);
    const a = await cellText(page, 0, 0);
    const b = await cellText(page, 1, 0);
    check(a === '1行1列：バ', `(1) ハ のあと ゛ で、打ったマスが バ になる（${a}）`);
    check(b === '1行2列：キ', `(1) 次のマスの交差の字 キ はそのまま（${b}）`);
    await ctx.close();
  }
  {
    // 開いたばかり（直前に打った字が無い）の時は、今のマスの字に効く
    const { ctx, page } = await newPage({ marks: { ...SEEN_SOLVE, [`crossword_progress_${PUZZLE_ID}`]: progress({ '0,0': 'ハ', '1,0': 'キ' }) } });
    await openPuzzle(page);
    await openAcross(page);
    await key(page, '゛').click();
    await page.waitForTimeout(300);
    check((await cellText(page, 0, 0)) === '1行1列：バ', `(1) 開いたばかりで ゛ を押すと、今のマスの字に効く（${await cellText(page, 0, 0)}）`);
    // → で動いてから ゛: 今のマス（キ）に効く
    await page.locator('[data-coach="closeup-cells"] button').nth(1).click();
    await key(page, '゛').click();
    await page.waitForTimeout(300);
    check((await cellText(page, 1, 0)) === '1行2列：ギ', `(1) マスを押して動いた後の ゛ は、今のマスの字に効く（${await cellText(page, 1, 0)}）`);
    await ctx.close();
  }

  // ---- (2) 最後のマスが濁る字: ゛ の後の盤で丸付け。待ちの間は窓が開いたまま ----
  let clearedPage = null;
  {
    const P = await newPage({ marks: { ...SEEN_SOLVE, [`crossword_progress_${PUZZLE_ID}`]: progress({ '1,0': 'キ', '1,1': 'ク', '1,2': 'ラ' }) } });
    const { page, st } = P;
    await openPuzzle(page);
    await openAcross(page);
    await key(page, 'ハ').click();
    await page.waitForTimeout(100);
    const stillOpen = (await key(page, '゛').count()) > 0;
    check(stillOpen && st.checks.length === 0, `(2) 最後のマスを埋めた直後（100ms）は、まだ答え合わせしていない・入力の窓が開いている（答え合わせ ${st.checks.length}回）`);
    await key(page, '゛').click();
    await page.waitForTimeout(3000);
    const text = await page.evaluate(() => document.body.innerText);
    check(st.checks.length === 1 && st.checks[0]['0,0'] === 'バ', `(2) 答え合わせは1回だけ、゛ の後の盤（バ）で走る（${st.checks.map((c) => c['0,0']).join('・')}）`);
    check(!text.includes('どこかに間違いがあります。'), '(2) 「どこかに間違いがあります。」は出ない');
    check(await stamped(page), '(2) ハンコが出る');
    clearedPage = P;
  }

  // ---- (4) 解けた後（(2) の続き） ----
  {
    const { ctx, page, st } = clearedPage;
    await page.waitForTimeout(1500); // 名前の窓が出るまで
    const skip = page.getByRole('button', { name: '載せない' });
    if (await skip.count()) await skip.click();
    await page.waitForTimeout(500);
    check((await page.locator('header button[title="リセット"]').count()) === 0, '(4) 解けた後はヘッダーの ↻ が無い');
    const prog = await page.evaluate((id) => localStorage.getItem(`crossword_progress_${id}`), PUZZLE_ID);
    check(prog === null, `(4) 解けた時に端末の途中経過が消える（${prog === null ? '無し' : '残っている'}）`);
    // 終わりの画面の並び: 盤（ハンコ）→ Xに投稿 → ランキング → ほかの問題 → ヒントの動画を見る
    const order = await page.evaluate(() => {
      const top = (el) => (el ? el.getBoundingClientRect().top + window.scrollY : null);
      const board = document.querySelector('[data-board-area]');
      const stamp = [...document.querySelectorAll('h2')].find((h) => h.textContent === 'CLEARED!');
      const x = [...document.querySelectorAll('a')].find((a) => a.textContent.includes('Xに投稿'));
      const rank = [...document.querySelectorAll('h2,h3,p,div,span')].find((e) => e.childElementCount === 0 && /^(ランキング|まだ記録がありません。?)$/.test((e.textContent || '').trim()));
      const other = [...document.querySelectorAll('h2,h3')].find((h) => h.textContent === 'ほかの問題');
      const hv = [...document.querySelectorAll('button')].find((b) => /^ヒント(の動画)?を見る$/.test(b.textContent));
      const clues = [...document.querySelectorAll('h2,h3')].find((h) => (h.textContent || '').includes('ヨコのカギ'));
      const sb = stamp?.getBoundingClientRect();
      const bb = board?.getBoundingClientRect();
      return {
        board: top(board), boardBottom: bb ? bb.bottom + window.scrollY : null, x: top(x), rank: top(rank), other: top(other), hv: top(hv), clues: top(clues),
        stampInBoard: !!(sb && bb && sb.top >= bb.top - 1 && sb.bottom <= bb.bottom + 1),
        hintListOpen: [...document.querySelectorAll('h2,h3')].some((h) => h.textContent === 'ヒントの動画'),
      };
    });
    console.log(`    並び（ページ上端からの位置）: 盤 ${order.board}〜${order.boardBottom} ／ Xに投稿 ${order.x} ／ ランキング ${order.rank} ／ ほかの問題 ${order.other} ／ ヒントの動画を見る ${order.hv} ／ カギの一覧 ${order.clues}`);
    check(order.stampInBoard, '(4) ハンコは盤の上に押される');
    check(order.x !== null && order.x >= order.boardBottom - 1 && order.x - order.boardBottom < 80, '(4) 「Xに投稿」はハンコ（盤）の直下');
    check(order.rank !== null && order.rank > order.x, '(4) ランキングは「Xに投稿」の下');
    check(order.other !== null && order.other > order.rank, '(4) 「ほかの問題」はランキングの下');
    check(order.hv !== null && order.hv > order.other && !order.hintListOpen, '(4) ヒントの動画の一覧は畳んであり、「ヒントの動画を見る」がほかの問題の下にある');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUT, '4-cleared-390.png'), fullPage: true });
    await page.getByRole('button', { name: /^ヒント(の動画)?を見る$/ }).click();
    await page.waitForTimeout(300);
    const opened = await page.evaluate(() => [...document.querySelectorAll('h2,h3')].some((h) => h.textContent === 'ヒントの動画') && document.body.innerText.includes('▶ YouTube'));
    check(opened, '(4) 「ヒントの動画を見る」で今の一覧（▶ YouTube の表記つき）が開く');
    await page.screenshot({ path: path.join(OUT, '4-cleared-hints-open-390.png'), fullPage: true });
    // 開き直すと新しい回で空の盤
    const startsBefore = st.starts;
    await page.reload();
    await cell(page, 0, 0).waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    const empty = await page.evaluate(() => [...document.querySelectorAll('[id^="cell-"]')].every((b) => /：空$/.test(b.getAttribute('aria-label') || '')));
    check(empty, '(4) 解いた問題を開き直すと、盤は空（最初から）');
    check(st.starts === startsBefore + 1, `(4) 開き直すと新しい回が始まる（回の始まり ${startsBefore} → ${st.starts}）`);
    await ctx.close();
  }

  // ---- (3) 「始める！」で回は1つだけ ----
  {
    const { ctx, page, st } = await newPage({ marks: { crossword_seen_first_cell: '1' }, play: { startDelay: 1500 } });
    await openPuzzle(page, false);
    await page.getByRole('button', { name: '始める！' }).waitFor({ timeout: 20000 });
    const help = await page.evaluate(() => document.body.innerText);
    check(help.includes('作った人：台本') && !help.includes('Created by') && help.includes('最後のマスを埋めると自動で答え合わせ'), '(文言) 遊び方の窓に「作った人: 台本」「最後のマスを埋めると自動で答え合わせ」');
    await page.screenshot({ path: path.join(OUT, '3-help-390.png') });
    await page.getByRole('button', { name: '始める！' }).click();
    await page.waitForTimeout(1500);
    const timer = await page.evaluate(() => (document.querySelector('header')?.innerText.match(/\d+(:\d\d)+/) || [''])[0]);
    check(/^\d{1,2}:\d\d$/.test(timer) && !timer.startsWith('00'), `(文言) ヘッダーのタイムは m:ss（${timer}）`);
    await page.waitForTimeout(300);
    // 回が返る前に字を入れる（遊ばれた回数の知らせも回を要る）
    await openAcross(page);
    await key(page, 'ハ').click();
    await page.waitForTimeout(3000);
    check(st.starts === 1, `(3) 「始める！」から回が返る前に字を入れても、回の始まりは1回（${st.starts}回）`);
    check(st.touches === 1, `(3) 遊ばれた回数の知らせはその回で1回（${st.touches}回）`);
    await ctx.close();
  }

  // ---- (5) 答え合わせの通信中に直した字 ----
  {
    const { ctx, page, st } = await newPage({ marks: { ...SEEN_SOLVE, [`crossword_progress_${PUZZLE_ID}`]: progress({ '1,0': 'キ', '1,1': 'ク', '1,2': 'ラ' }) }, play: { checkDelay: 2000 } });
    await openPuzzle(page);
    await openAcross(page);
    await key(page, 'ア').click(); // 間違いの字で埋める
    await page.waitForTimeout(900); // 400ms 待って答え合わせが始まり、通信中
    check(st.checks.length === 1, `(5) 間違いの字で埋めると答え合わせが始まる（${st.checks.length}回）`);
    await cell(page, 0, 0).click();
    await key(page, 'ハ').click();
    await key(page, '゛').click();
    await page.waitForTimeout(5000);
    console.log(`    答え合わせで送った (0,0): ${st.checks.map((c) => c['0,0']).join(' → ')}`);
    check(st.checks.length === 2 && st.checks[1]['0,0'] === 'バ', '(5) 通信の後に、今の盤（バ）でもう一度丸付けする');
    check(await stamped(page), '(5) 直した盤で解けてハンコが出る');
    await ctx.close();
  }

  // ---- (6) 練習問題のハンコは2秒で薄れる ----
  {
    const { ctx, page } = await newPage({ marks: SEEN_SOLVE });
    await page.goto(`${BASE}/crossword/tutorial`);
    await cell(page, 0, 0).waitFor({ timeout: 20000 });
    const skipBtn = page.locator('[data-coach-bubble]').getByRole('button', { name: 'とばす' });
    if (await skipBtn.count()) await skipBtn.click();
    // ネコ（横）→ コアラ（縦）の アラ → ラムネ（横）の ムネ
    await cell(page, 0, 0).click();
    for (const ch of ['ネ', 'コ']) await key(page, ch).click();
    await page.mouse.click(5, 5);
    await page.waitForTimeout(300);
    await page.getByText('ユーカリの葉を食べる動物').last().click();
    for (const ch of ['コ', 'ア', 'ラ']) await key(page, ch).click();
    await page.mouse.click(5, 5);
    await page.waitForTimeout(300);
    await page.getByText('ビー玉で栓をした炭酸の飲み物').last().click();
    for (const ch of ['ラ', 'ム', 'ネ']) await key(page, ch).click();
    await page.waitForTimeout(1600);
    const s1 = await page.evaluate(() => getComputedStyle(document.querySelector('[data-stamp]')).opacity);
    await page.screenshot({ path: path.join(OUT, '6-tutorial-stamp-1s-390.png') });
    await page.waitForTimeout(2500);
    const s2 = await page.evaluate(() => ({ o: getComputedStyle(document.querySelector('[data-stamp]')).opacity, f: document.querySelector('[data-stamp]').getAttribute('data-stamp') }));
    check(Number(s1) === 1 && s2.f === 'faded' && Number(s2.o) < 0.3, `(6) 練習問題のハンコは、出た直後は濃く（${s1}）、2秒の後に薄れる（${s2.o}）`);
    const btn = page.locator('[data-coach="tutorial-done"]').getByRole('button', { name: '本番へ' });
    check((await btn.count()) > 0 && (await btn.isVisible()), '(6) 「本番へ」が見えている');
    await page.screenshot({ path: path.join(OUT, '6-tutorial-stamp-faded-390.png') });
    await ctx.close();
  }

  // ---- (7) ギャラリー ----
  {
    const { ctx, page } = await newPage({ tables: { crossword_puzzles: GALLERY_ROWS } });
    await page.goto(`${BASE}/crossword`);
    await page.getByText('印あり アンジュルム').waitFor({ timeout: 20000 });
    const groupSelect = page.locator('select').nth(1);
    const titles = () => page.evaluate(() => [...new Set([...document.body.innerText.matchAll(/(印あり \S+|タグ \S+)/g)].map((m) => m[0]))]);
    await groupSelect.selectOption('BEYOOOOONDS');
    await page.waitForTimeout(800);
    const t1 = await titles();
    check(t1.length === 1 && t1[0] === 'タグ 全角ビヨ', `(7) BEYOOOOONDS で絞ると、印が無くてもタグ「ＢＥＹＯＯＯＯＯＮＤＳ」（全角）の問題を拾う（${t1.join('・')}）`);
    await groupSelect.selectOption("モーニング娘。'26");
    await page.waitForTimeout(800);
    const t2 = await titles();
    check(t2.length === 1 && t2[0] === 'タグ モー娘年なし', `(7) モーニング娘。'26 で絞ると、タグ「モーニング娘。が好き」（年なし・名前を含む）の問題を拾う（${t2.join('・')}）`);
    await groupSelect.selectOption('アンジュルム');
    await page.waitForTimeout(800);
    const t3 = await titles();
    check(t3.length === 1 && t3[0] === '印あり アンジュルム', `(7) 印のある問題は今まで通り拾う（${t3.join('・')}）`);
    await groupSelect.selectOption('OCHA NORMA');
    await page.waitForTimeout(800);
    const ways = page.locator('[data-empty-ways]');
    check((await page.getByText('条件に合う問題がありません').count()) > 0 && (await ways.count()) === 1, '(7) 絞った結果が空のとき「条件に合う問題がありません」の下に道が出る');
    check((await ways.getByRole('button', { name: 'すべての問題を見る' }).count()) === 1 && (await ways.getByRole('link', { name: '作る' }).getAttribute('href')) === '/crossword/create', '(7) 道は「すべての問題を見る」と「作る」（/crossword/create）');
    await page.screenshot({ path: path.join(OUT, '7-gallery-empty-390.png'), fullPage: true });
    await ways.getByRole('button', { name: 'すべての問題を見る' }).click();
    await page.waitForTimeout(800);
    const t4 = await titles();
    check(t4.length === 4 && (await groupSelect.inputValue()) === '', `(7) 「すべての問題を見る」で絞り込みが外れ、全部の問題が出る（${t4.length}件）`);
    await ctx.close();
  }

  // ---- (9) 作る画面の案内は初めて開いても自動で始まらない（記録の空のブラウザ） ----
  {
    const { ctx, page } = await newPage({ marks: {} });
    await page.goto(`${BASE}/crossword/create`);
    await page.getByText('リストに追加').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(4000);
    const st = await page.evaluate(() => ({ layer: document.querySelectorAll('[data-coach-layer]').length, tip: document.querySelectorAll('[data-tip]').length, keys: Object.keys(localStorage).filter((k) => k.startsWith('crossword_')) }));
    check(st.layer === 0, `(9) 記録の空のブラウザで作る画面を初めて開いても、11段の案内（幕と吹き出し）は出ない（幕 ${st.layer}）`);
    console.log(`    その時の札 ${st.tip}枚・端末の記録 ${JSON.stringify(st.keys)}`);
    await page.screenshot({ path: path.join(OUT, '9-create-first-open-390.png') });
    await ctx.close();
  }

  // ---- (8) 作る画面 ----
  {
    const { ctx, page } = await newPage({ marks: { crossword_seen_tip_cross: '1', crossword_seen_tip_move: '1', crossword_seen_tip_saved: '1' } });
    const toasts = [];
    page.on('console', () => {});
    await page.goto(`${BASE}/crossword/create`);
    await page.getByText('リストに追加').first().waitFor({ timeout: 20000 });
    const reason = page.locator('[data-add-reason]');
    check((await reason.textContent()) === 'ヒントの動画を選ぶと追加できます。', `(8) ハロプロでヒントが未選択の時、ボタンの下に「${await reason.textContent()}」`);
    await page.getByText('その他', { exact: true }).first().click();
    await page.waitForTimeout(300);
    check((await reason.textContent()) === 'ヒントの URL を入れると追加できます', `(8) その他で URL が無い時は「${await reason.textContent()}」`);
    await page.screenshot({ path: path.join(OUT, '8-add-reason-390.png') });
    const field = (label) => page.locator(`xpath=//label[contains(normalize-space(.), "${label}")]/following-sibling::*[1]/descendant-or-self::input`).first();
    const hint = () => page.getByPlaceholder(/URL を貼る/).first();
    const add = async (a, q) => {
      await field('答え').fill(a);
      await field('カギ').fill(q);
      await hint().fill('https://example.com/' + encodeURIComponent(a));
      await page.waitForTimeout(200);
      await page.getByRole('button', { name: 'リストに追加' }).click();
    };
    await hint().fill('https://example.com/x');
    await page.waitForTimeout(200);
    check((await reason.count()) === 0, '(8) URL を入れると理由の1行は消える');
    // ヰ・ヱ は使えない字として断る
    await field('答え').fill('ヰド');
    await field('カギ').fill('見本');
    await page.getByRole('button', { name: 'リストに追加' }).click();
    await page.waitForTimeout(300);
    check((await page.getByText('「ヰ」「ヱ」は使えません。').count()) > 0, '(8) 答えに ヰ が入っていると「「ヰ」「ヱ」は使えません。」と断る');
    // 半角カナは NFKC でそろう（ヒントは選んだまま残っている）
    await field('答え').fill('ｶﾞｸ');
    await field('カギ').fill('半角の見本');
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'リストに追加' }).click();
    await page.waitForTimeout(300);
    check((await page.getByText('ガ ク', { exact: true }).count()) > 0, '(8) 半角カナ「ｶﾞｸ」は「ガ ク」の2マスにそろう');
    await page.getByRole('button', { name: '消す', exact: true }).first().click();
    await page.waitForTimeout(500);

    // F: 置けない所の上では影が薄い
    await add('コアラ', 'ユーカリの葉を食べる動物');
    await page.waitForTimeout(800);
    await add('ネコ', 'ニャーと鳴く動物');
    await page.waitForTimeout(8000);
    const box = async (x, y) => (await cell(page, x, y).boundingBox());
    // 盤: コアラ 横(0,1)・ネコ 縦(0,0)。ネコ の ネ (0,0) をつまむ
    await cell(page, 0, 0).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const ne = await box(0, 0);
    const label00 = await cellText(page, 0, 0);
    check(label00 === '1行1列：ネ', `(8) 見本の盤が組めた（${label00}）`);
    const cx = ne.x + ne.width / 2, cy = ne.y + ne.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(450);
    // 右へ2マス（どの語とも交わらない所）
    for (let i = 1; i <= 8; i++) await page.mouse.move(cx + (ne.width * 2 * i) / 8, cy);
    await page.waitForTimeout(200);
    const g1 = await page.evaluate(() => { const g = document.querySelector('[data-ghost]'); return g ? { p: g.getAttribute('data-placeable'), o: getComputedStyle(g).opacity } : null; });
    await page.screenshot({ path: path.join(OUT, '8-ghost-blocked-390.png') });
    // 元の場所へ戻す（置ける扱い）
    for (let i = 7; i >= 0; i--) await page.mouse.move(cx + (ne.width * 2 * i) / 8, cy);
    await page.waitForTimeout(200);
    const g2 = await page.evaluate(() => { const g = document.querySelector('[data-ghost]'); return g ? { p: g.getAttribute('data-placeable'), o: getComputedStyle(g).opacity } : null; });
    await page.screenshot({ path: path.join(OUT, '8-ghost-placeable-390.png') });
    await page.mouse.up();
    check(g1 && g1.p === 'no' && Number(g1.o) < 0.3, `(8) 置けない所の上では持ち上げた語の影が薄い（${g1 ? g1.o : '影なし'}）`);
    check(g2 && g2.p === 'yes' && Math.abs(Number(g2.o) - 0.6) < 0.01, `(8) 置ける所（元の場所）では今の濃さ（${g2 ? g2.o : '影なし'}）`);
    check((await page.getByText(/1日に作成・保存できるパズルは5個まで/).count()) === 0, '(8) 「1日5個まで」の知らせは無い');
    void toasts;
    await ctx.close();
  }

  // ---- (8) 固定した語どうしがつながらない盤 ----
  {
    const { ctx, page } = await newPage({ marks: { crossword_seen_tip_cross: '1', crossword_seen_tip_move: '1', crossword_seen_tip_saved: '1' } });
    await page.goto(`${BASE}/crossword/create`);
    await page.getByText('リストに追加').first().waitFor({ timeout: 20000 });
    await page.getByText('その他', { exact: true }).first().click();
    const field = (label) => page.locator(`xpath=//label[contains(normalize-space(.), "${label}")]/following-sibling::*[1]/descendant-or-self::input`).first();
    const hint = () => page.getByPlaceholder(/URL を貼る/).first();
    for (const [a, q] of [['アイアイア', '見本の横'], ['アカ', '見本の縦1'], ['アキ', '見本の縦2']]) {
      await field('答え').fill(a);
      await field('カギ').fill(q);
      await hint().fill('https://example.com/' + encodeURIComponent(a));
      await page.waitForTimeout(200);
      await page.getByRole('button', { name: 'リストに追加' }).click();
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(8500);
    // 縦の語の2字目（カ・キ）のある列を探す
    const colOf = async (ch) => page.evaluate((c) => {
      const b = [...document.querySelectorAll('[id^="cell-"]')].find((e) => (e.getAttribute('aria-label') || '').endsWith(`：${c}`));
      return b ? Number(b.id.split('-')[1]) : null;
    }, ch);
    const drag = async (fromX, toX) => {
      await cell(page, fromX, 1).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const f = await cell(page, fromX, 1).boundingBox();
      const t = await cell(page, 0, 0).boundingBox();
      const cx = f.x + f.width / 2, cy = f.y + f.height / 2;
      const tx = t.x + t.width / 2 + (toX * t.width), ty = cy;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.waitForTimeout(450);
      for (let i = 1; i <= 10; i++) await page.mouse.move(cx + ((tx - cx) * i) / 10, ty);
      await page.waitForTimeout(150);
      await page.mouse.up();
      await page.waitForTimeout(500);
    };
    const free = (used) => [0, 2, 4].find((x) => !used.includes(x));
    let ka = await colOf('カ'), ki = await colOf('キ');
    console.log(`    組めた盤: アカ ${ka}列・アキ ${ki}列`);
    let to = free([ka, ki]);
    await drag(ka, to);
    ka = await colOf('カ');
    to = free([ka, ki]);
    await drag(ki, to);
    ki = await colOf('キ');
    const pins = await page.locator('[data-pin]').count();
    console.log(`    動かした後: アカ ${ka}列・アキ ${ki}列・固定の印 ${pins}`);
    check(pins === 2, `(8) 縦の2語を動かして固定した（固定の印 ${pins}）`);
    // 橋になっている横の語を消すと、固定した2語が離れる
    const rows = page.locator('div.max-h-40 > div');
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      if ((await rows.nth(i).textContent()).includes('ア イ ア イ ア')) {
        await rows.nth(i).getByRole('button', { name: '消す', exact: true }).click();
        break;
      }
    }
    await page.waitForTimeout(8000);
    const msg = page.locator('[data-not-connected]');
    check((await msg.count()) === 1 && (await msg.textContent()).includes('固定した語がつながっていません'), '(8) 固定した語がつながらない盤では「固定した語がつながっていません。…」が出る');
    const share = page.getByRole('button', { name: /共有する/ });
    check((await share.count()) === 1 && (await share.isDisabled()), '(8) 「共有する」は押せない');
    await page.screenshot({ path: path.join(OUT, '8-not-connected-390.png'), fullPage: true });
    await page.getByRole('button', { name: '固定を外す' }).click();
    await page.waitForTimeout(8000);
    check((await page.locator('[data-not-connected]').count()) === 0, '(8) 「固定を外す」で組み直すと知らせは消える');
    await ctx.close();
  }
} catch (e) {
  check(false, `台本が途中で止まった: ${e.message}`);
} finally {
  await browser.close();
  stopServer();
}

check(pageErrors.length === 0, `画面のつまずき（JS の例外）が無い${pageErrors.length ? `: ${pageErrors.slice(0, 3).join(' / ')}` : ''}`);
console.log(`写真: ${OUT}`);
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
