// 解く画面の「一時停止」と、タイムが「盤を開いていた時間」になったこと（Hop 決定 2026-10-07）を、手元の開発サーバーで確かめる。
// 本番にもプレビューにも通信しない。手元の vite をこの台本が立ち上げ（Supabase の住所は使わない仮の住所）、
// 棚（/rest/v1）と受付係（/api/crossword-play）への通信はすべてブラウザの中で受け止め、台本の中の見本の問題で答える。
// 受付係の受け止め役は「開いていた時間」を本物と同じ考え方で数える（開いた時刻からの経過を足し込む）。
//   (1) 一時停止ボタンで幕が出て、タイマーが止まる（2秒待って数字が変わらない）。pause が受付係へ届く
//   (2) 幕の「再開」で幕が消えて、タイマーが進む。resume が受付係へ届く
//   (3) タブを隠すと pause が送られ、戻すと幕が出る（自動では再開しない）。閉じる時（pagehide）も pause が送られる
//   (4) 幕の間はマスを押しても・カギの一覧を押しても入力カードが開かない。盤とカギの帯は見えない。キーも受けない
//   (5) 受付係の返事の activeMs で表示が合う（再開の返事を 2:03 にすると、表示が 2:03 から進む）
//   (6) 開いている間は60秒ごとに生存の合図（ping）。幕の間は送らない
//   (7) 開いたまま時計が飛んだ（端末が眠っていた）時は、合図を送らず一時停止になる
//   (8) 解けた後は一時停止のボタンも幕も出ない。タブを隠しても pause は送らない
//   (9) 見本（?debug=true）と練習問題は受付係を通らず、この端末の時計だけで同じ動きになる
// 使い方: node scripts/verify/crossword/check-pause.mjs（引数なし）
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { outDir, ROOT } from './_lib.mjs';

const PORT = 5197;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-pause');
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

// ---- 見本の問題（check-review-fixes と同じ形）。盤: バキ 横(0,0)・キクラ 縦(1,0) ----
const PUZZLE_ID = 'MOCKPAU1';
const SOLUTION = { '0,0': 'バ', '1,0': 'キ', '1,1': 'ク', '1,2': 'ラ' };
const ANSWERS = [['バ', 'キ'], ['キ', 'ク', 'ラ']];
const ROWS = [{
  id: PUZZLE_ID, title: '一時停止の見本', genre: 'other', tags: [], created_at: '2026-10-07T00:00:00Z', play_count: 0, is_beginner: false, group_tags: [],
  body: {
    version: 1, width: 2, height: 3, creatorName: '台本',
    clues: [
      { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: 'ヨコの見本のカギ', length: 2, hint: { kind: 'link', url: 'https://example.com/' } },
      { clueIndex: 2, direction: 'vertical', startX: 1, startY: 0, clue: 'タテの見本のカギ', length: 3, hint: { kind: 'link', url: 'https://example.com/' } },
    ],
  },
}];

function mockSupabase(ctx) {
  return ctx.route(`${MOCK_SUPA}/**`, async (route) => {
    const u = new URL(route.request().url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.endsWith('/rpc/crossword_is_hidden')) return json(false);
    const table = u.pathname.split('/').pop();
    let rows = table === 'crossword_puzzles' ? ROWS : [];
    const idEq = u.searchParams.get('id');
    if (idEq?.startsWith('eq.')) rows = rows.filter((r) => r.id === idEq.slice(3));
    if ((route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object')) return json(rows[0] ?? null);
    return json(rows);
  });
}

// ---- 受付係の受け止め役。開いていた時間を本物と同じ考え方で数える ----
// st.log には届いた合図を順に残す（how = fetch か beacon か。sendBeacon は Content-Type が application/json の Blob で届く）
function mockPlay(ctx) {
  const st = { log: [], activeMs: 0, openAt: null, solved: false, nextResumeMs: null, apiCalls: 0 };
  const total = () => st.activeMs + (st.openAt !== null ? Date.now() - st.openAt : 0);
  ctx.route('**/api/crossword-play', async (route) => {
    st.apiCalls++;
    const req = route.request();
    const raw = req.postData() ?? req.postDataBuffer()?.toString('utf8') ?? '{}';
    const body = JSON.parse(raw || '{}');
    const how = req.resourceType() === 'ping' || req.resourceType() === 'beacon' ? 'beacon' : 'fetch';
    st.log.push({ action: body.action, how, type: req.resourceType(), ct: req.headers()['content-type'] ?? '', at: Date.now() });
    const reply = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...o }) });
    switch (body.action) {
      case 'start':
        st.activeMs = 0;
        st.openAt = Date.now();
        return reply({ token: 'tok-pause', startedAt: Date.now() });
      case 'touch':
        return reply({ counted: true });
      case 'resume': {
        if (st.solved) return reply({ activeMs: st.activeMs, open: false });
        st.activeMs = st.nextResumeMs ?? total();
        st.nextResumeMs = null;
        st.openAt = Date.now();
        return reply({ activeMs: st.activeMs, open: true });
      }
      case 'pause':
        if (st.solved) return reply({ activeMs: st.activeMs, open: false });
        st.activeMs = total();
        st.openAt = null;
        return reply({ activeMs: st.activeMs, open: false });
      case 'ping':
        if (st.solved) return reply({ activeMs: st.activeMs, open: false });
        return reply({ activeMs: total(), open: st.openAt !== null });
      case 'check': {
        const correct = Object.keys(SOLUTION).every((k) => body.answers[k] === SOLUTION[k]);
        if (correct) {
          st.activeMs = total();
          st.openAt = null;
          st.solved = true;
        }
        return reply(correct ? { correct, answers: ANSWERS, timeSeconds: Math.max(1, Math.floor(st.activeMs / 1000)), rankable: true } : { correct });
      }
      case 'reveal':
        return reply({ char: SOLUTION[`${body.x},${body.y}`], reveals: 1 });
      default:
        return route.fulfill({ status: 400, body: '{}' });
    }
  });
  ctx.route('**/api/crossword-score', (r) => r.fulfill({ status: 500, body: '{}' }));
  return st;
}

const browser = await chromium.launch();
const pageErrors = [];
async function newPage({ marks = {}, clock = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((m) => {
    try {
      if (sessionStorage.getItem('__marks')) return;
      sessionStorage.setItem('__marks', '1');
      for (const [k, v] of Object.entries(m)) localStorage.setItem(k, v);
    } catch { /* 無視 */ }
  }, marks);
  await mockSupabase(ctx);
  const st = mockPlay(ctx);
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com|pagead2\.googlesyndication\.com)\//, (r) => r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  if (clock) await page.clock.install();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  return { ctx, page, st };
}
const SEEN = { crossword_seen_help: 'true', crossword_seen_first_cell: '1', crossword_seen_tutorial: '1' };
const cell = (page, x, y) => page.locator(`#cell-${x}-${y}`);
const timer = (page) => page.locator('header [data-timer]').textContent();
const curtain = (page) => page.locator('[data-pause-curtain]');
const pauseBtn = (page) => page.locator('header').getByRole('button', { name: '一時停止' });
const resumeBtn = (page) => page.locator('[data-pause-curtain]').getByRole('button', { name: '再開' });
const cardOpen = async (page) => (await page.locator('[data-coach="keypad"]').count()) > 0;
const actions = (st, name) => st.log.filter((l) => l.action === name);
const sec = (t) => {
  const p = String(t).trim().split(':').map(Number);
  return p.reduce((a, b) => a * 60 + b, 0);
};
// タブを隠す・戻す（visibilityState と hidden を差し替えて visibilitychange を送る）
const setVisibility = (page, state) =>
  page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
const visibleText = (page, text) =>
  page.evaluate((t) => [...document.querySelectorAll('body *')].some((el) => el.childElementCount === 0 && (el.textContent || '').includes(t) && el.checkVisibility({ visibilityProperty: true })), text);

try {
  await startServer();

  // ---- (1)(2)(4)(5) 一時停止ボタン → 幕 → 再開 ----
  {
    const { ctx, page, st } = await newPage({ marks: SEEN });
    await page.goto(`${BASE}/crossword/${PUZZLE_ID}`);
    await cell(page, 0, 0).waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    check(actions(st, 'start').length === 1, `回は1つだけ始まる（start ${actions(st, 'start').length}回）`);
    const t0 = sec(await timer(page));
    check(t0 >= 1, `開いている間はタイマーが進む（${t0}秒）`);
    check((await pauseBtn(page).count()) === 1, 'ヘッダーのタイマーの隣に「一時停止」のボタンがある');
    await page.screenshot({ path: path.join(OUT, '0-playing-390.png') });

    // 入力カードを開いてから一時停止すると、カードは閉じる
    await cell(page, 0, 0).click();
    await page.waitForTimeout(300);
    const openedBefore = await cardOpen(page);
    // カードが開いている間はヘッダーが隠れることがあるので、ボタンは画面の中から押す
    await pauseBtn(page).evaluate((b) => b.click());
    // カードは下へ消える動きの後に外れる
    await page.locator('[data-coach="keypad"]').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    check(openedBefore && !(await cardOpen(page)), `(1) 入力カードが開いていたら、一時停止で閉じる（前: ${openedBefore ? '開' : '閉'}）`);
    check((await curtain(page).count()) === 1 && (await resumeBtn(page).isVisible()), '(1) 一時停止で盤に幕がかかり、「再開」が見える');
    const curtainBox = await curtain(page).boundingBox();
    const areaBox = await page.locator('[data-board-area]').boundingBox();
    check(!!curtainBox && !!areaBox && Math.abs(curtainBox.y - areaBox.y) < 1 && Math.abs(curtainBox.height - areaBox.height) < 1 && Math.abs(curtainBox.width - areaBox.width) < 1, `(1) 幕は盤の領域を全部覆う（幕 ${curtainBox?.width}x${curtainBox?.height} ／ 領域 ${areaBox?.width}x${areaBox?.height}）`);
    check(actions(st, 'pause').length === 1, `(1) pause が受付係へ届く（${actions(st, 'pause').length}回）`);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    check(focused === '再開', `(1) フォーカスは「再開」へ移る（${focused}）`);
    const t1 = await timer(page);
    await page.waitForTimeout(2000);
    const t2 = await timer(page);
    check(t1 === t2, `(1) 幕の間はタイマーが止まる（${t1} → 2秒後 ${t2}）`);
    check((await pauseBtn(page).isDisabled()), '(1) 幕の間はヘッダーの一時停止は押せない');
    await page.screenshot({ path: path.join(OUT, '1-paused-390.png') });
    await page.screenshot({ path: path.join(OUT, '1-paused-full-390.png'), fullPage: true });

    // (4) 幕の間は入力できない
    await page.evaluate(() => document.getElementById('cell-0-0')?.click());
    await page.waitForTimeout(300);
    check(!(await cardOpen(page)), '(4) 幕の間はマスを押しても入力カードが開かない（中のマスを直接押しても）');
    await page.mouse.click(areaBox.x + areaBox.width / 2, areaBox.y + 40);
    await page.waitForTimeout(300);
    check(!(await cardOpen(page)), '(4) 幕の上を押しても入力カードが開かない');
    await page.evaluate(() => [...document.querySelectorAll('li')].find((l) => (l.textContent || '').includes('ヨコの見本のカギ'))?.click());
    await page.waitForTimeout(300);
    check(!(await cardOpen(page)), '(4) 幕の間はカギの一覧を押しても入力カードが開かない');
    check(!(await visibleText(page, 'ヨコの見本のカギ')) && !(await visibleText(page, 'タテの見本のカギ')), '(4) 幕の間はカギの帯もカギの一覧も見えない');
    check(!(await cell(page, 0, 0).isVisible()), '(4) 幕の間は盤のマスが見えない');
    const before = await page.evaluate(() => JSON.stringify(Object.keys(localStorage)));
    await page.keyboard.press('Backspace');
    await page.keyboard.press('ArrowRight');
    check((await curtain(page).count()) === 1 && !(await cardOpen(page)), `(4) 幕の間はキーを押しても何も起きない（${before.length > 0 ? '記録あり' : ''}）`);

    // (5)(2) 再開: 受付係の返事を 2:03 にすると、表示が 2:03 から進む
    st.nextResumeMs = 123000;
    await resumeBtn(page).click();
    await page.waitForTimeout(400);
    check((await curtain(page).count()) === 0, '(2) 「再開」で幕が消える');
    check(actions(st, 'resume').length === 1, `(2) resume が受付係へ届く（${actions(st, 'resume').length}回）`);
    const r0 = sec(await timer(page));
    check(r0 >= 123 && r0 <= 124, `(5) 表示が受付係の activeMs に合う（${await timer(page)}・受付係 2:03）`);
    await page.waitForTimeout(2200);
    const r1 = sec(await timer(page));
    check(r1 >= r0 + 2, `(2) 再開の後はタイマーが進む（${r0}秒 → 2.2秒後 ${r1}秒）`);
    check(await cell(page, 0, 0).isVisible(), '(2) 再開で盤のマスが見える');
    await cell(page, 0, 0).click();
    await page.waitForTimeout(300);
    check(await cardOpen(page), '(2) 再開の後はマスを押すと入力カードが開く');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // (3) タブを隠す → pause（sendBeacon）。戻すと幕が出て、タイマーは止まったまま
    const pausesBefore = actions(st, 'pause').length;
    await setVisibility(page, 'hidden');
    await page.waitForTimeout(800);
    const hidePause = actions(st, 'pause').slice(pausesBefore);
    check(hidePause.length === 1, `(3) タブを隠すと pause が送られる（${hidePause.length}回・送り方 ${hidePause.map((l) => `${l.type}/${l.ct}`).join(',')}）`);
    check(hidePause.length === 1 && hidePause[0].how === 'beacon' && hidePause[0].ct.startsWith('application/json'), '(3) 隠した時の pause は sendBeacon（application/json）で届く');
    await setVisibility(page, 'visible');
    await page.waitForTimeout(300);
    check((await curtain(page).count()) === 1 && (await resumeBtn(page).isVisible()), '(3) 戻すと幕と「再開」が出ている（自動では再開しない）');
    const h1 = await timer(page);
    await page.waitForTimeout(2000);
    check(h1 === (await timer(page)), `(3) 戻った後もタイマーは止まったまま（${h1}）`);
    await page.screenshot({ path: path.join(OUT, '3-after-hide-390.png') });
    // 幕の間に隠しても、pause は二重に送らない
    await setVisibility(page, 'hidden');
    await page.waitForTimeout(500);
    check(actions(st, 'pause').length === pausesBefore + 1, '(3) 幕の間に隠しても pause は二重に送らない');
    await setVisibility(page, 'visible');
    // 閉じる時（pagehide）
    await resumeBtn(page).click();
    await page.waitForTimeout(400);
    const p2 = actions(st, 'pause').length;
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.waitForTimeout(800);
    check(actions(st, 'pause').length === p2 + 1, '(3) 閉じる時（pagehide）も pause が送られる');
    await ctx.close();
  }

  // ---- (6)(7) 生存の合図と、時計が飛んだ時（時計を差し替えて進める） ----
  {
    const { ctx, page, st } = await newPage({ marks: SEEN, clock: true });
    await page.goto(`${BASE}/crossword/${PUZZLE_ID}`);
    await cell(page, 0, 0).waitFor({ timeout: 20000 });
    await page.clock.runFor(2000);
    await page.clock.runFor(61000);
    await page.waitForTimeout(500);
    check(actions(st, 'ping').length === 1, `(6) 開いている間は60秒ごとに ping（61秒で ${actions(st, 'ping').length}回）`);
    await pauseBtn(page).click();
    await page.waitForTimeout(300);
    const pings = actions(st, 'ping').length;
    await page.clock.runFor(130000);
    await page.waitForTimeout(500);
    check(actions(st, 'ping').length === pings, `(6) 幕の間は ping を送らない（130秒で ${actions(st, 'ping').length - pings}回）`);
    await resumeBtn(page).click();
    await page.waitForTimeout(500);
    await page.clock.runFor(3000);
    const beforeJump = sec(await timer(page));
    const pBefore = actions(st, 'pause').length;
    const pingBefore = actions(st, 'ping').length;
    // 端末が眠っていた（タイマーも合図も止まったまま時計だけ5分進んだ）
    await page.clock.fastForward(300000);
    await page.waitForTimeout(800);
    const afterJump = sec(await timer(page));
    check((await curtain(page).count()) === 1, '(7) 開いたまま時計が飛んだら一時停止の幕がかかる');
    check(afterJump - beforeJump <= 2, `(7) 眠っていた5分はタイムに入らない（${beforeJump}秒 → ${afterJump}秒）`);
    check(actions(st, 'ping').length === pingBefore && actions(st, 'pause').length === pBefore + 1, `(7) 眠りから覚めた時は ping を送らず pause を送る（ping ${actions(st, 'ping').length - pingBefore}回・pause ${actions(st, 'pause').length - pBefore}回）`);
    await ctx.close();
  }

  // ---- (8) 解けた後 ----
  {
    const progress = JSON.stringify({ userAnswers: { '0,0': 'バ', '1,0': 'キ', '1,1': 'ク' }, elapsedSeconds: 5, savedAt: Date.now() });
    const { ctx, page, st } = await newPage({ marks: { ...SEEN, [`crossword_progress_${PUZZLE_ID}`]: progress } });
    await page.goto(`${BASE}/crossword/${PUZZLE_ID}`);
    await cell(page, 1, 2).waitFor({ timeout: 20000 });
    await page.waitForTimeout(2200);
    await cell(page, 1, 2).click();
    await page.locator('[data-coach="keypad"]').getByRole('button', { name: 'ラ', exact: true }).first().click();
    await page.waitForTimeout(3500);
    check(await page.evaluate(() => document.body.innerText.includes('CLEARED!')), '(8) 見本の問題が解ける');
    check((await pauseBtn(page).count()) === 0, '(8) 解けた後はヘッダーに一時停止のボタンが無い');
    const pz = actions(st, 'pause').length;
    await setVisibility(page, 'hidden');
    await page.waitForTimeout(500);
    await setVisibility(page, 'visible');
    await page.waitForTimeout(300);
    check((await curtain(page).count()) === 0 && actions(st, 'pause').length === pz, '(8) 解けた後はタブを隠しても幕が出ず、pause も送らない');
    await ctx.close();
  }

  // ---- (9) 見本（?debug=true）と練習問題: 受付係を通らず同じ動き ----
  for (const [name, url] of [['見本', `${BASE}/crossword/create?debug=true`], ['練習問題', `${BASE}/crossword/tutorial`]]) {
    const { ctx, page, st } = await newPage({ marks: SEEN });
    await page.goto(url);
    await cell(page, 0, 0).waitFor({ timeout: 20000 });
    // 練習問題の案内（吹き出し）が出ていたら閉じる
    const skip = page.getByRole('button', { name: 'とばす' });
    if (await skip.count()) await skip.first().click();
    await page.waitForTimeout(1500);
    check((await pauseBtn(page).count()) === 1, `(9) ${name}にも一時停止のボタンがある`);
    const hasTimer = (await page.locator('header [data-timer]').count()) === 1;
    await pauseBtn(page).click();
    await page.waitForTimeout(300);
    check((await curtain(page).count()) === 1, `(9) ${name}: 一時停止で幕がかかる`);
    if (hasTimer) {
      const a = await timer(page);
      await page.waitForTimeout(2000);
      check(a === (await timer(page)), `(9) ${name}: 幕の間はタイマーが止まる（${a}）`);
    }
    await resumeBtn(page).click();
    await page.waitForTimeout(300);
    check((await curtain(page).count()) === 0, `(9) ${name}: 「再開」で幕が消える`);
    await setVisibility(page, 'hidden');
    await page.waitForTimeout(300);
    await setVisibility(page, 'visible');
    await page.waitForTimeout(300);
    check((await curtain(page).count()) === 1, `(9) ${name}: タブを隠して戻ると幕が出る`);
    await page.screenshot({ path: path.join(OUT, `9-${name === '見本' ? 'debug' : 'tutorial'}-paused-390.png`) });
    check(st.apiCalls === 0, `(9) ${name}: 受付係には何も送らない（${st.apiCalls}回）`);
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
