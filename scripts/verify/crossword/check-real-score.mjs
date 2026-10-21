// ランキングの受付係（/api/crossword-score）が、遊んでいる回の記録からタイムと印を出して記録し、ランキングの画面にそのとおり出ることを確かめる。
// 本番にもプレビューにも記録を載せない（2026-10-19 Hop「本番環境から見える形で検収用パズル登録を二度とするな」。ランキングの「検収」の行も同じ扱い）。
//   1. 受付係を手元で動かし、作り物の棚に置いた回で記録する（_localFunctions.mjs）
//      タイムは回の開いていた時間（active_ms）から出る・画面の申告は使わない／ミス0・見た数0／同じ回は2度記録できない
//      人間には無理な速さの回は断る／解けていない回は断る／同じ人の遅い記録は前の速い記録を上書きしない・速い記録は上書きする
//      見た数とミスがそのまま残る／名前が空なら「名無し」
//   2. 手元の vite を立ち上げ、1 で棚に入った行をそのまま返す作り物の棚で、ランキングの画面（/crossword/<番号>/ranking）にタイムと印が出るのを見る
// 使い方: node scripts/verify/crossword/check-real-score.mjs（引数なし）
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';
import { outDir, ROOT, isolatedViteConfig } from './_lib.mjs';
import { openFunctions, fakeShelf, callFunction } from './_localFunctions.mjs';

const PORT = 5190;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-real-score');
let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};

// ---- 1. 受付係（手元） ----
const PUZZLE_ID = 'LocalRk1';
const NAME = '確かめの人';
const shelf = fakeShelf();
shelf.addPuzzle({
  id: PUZZLE_ID, key: 'k'.repeat(64), title: 'ランキングの確かめ用', width: 2, height: 2,
  clues: [
    { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: 'ネコ', answer: ['ネ', 'コ'], hint: { kind: 'link', url: 'https://example.com/' } },
    { clueIndex: 2, direction: 'vertical', startX: 1, startY: 0, clue: 'コイ', answer: ['コ', 'イ'], hint: { kind: 'link', url: 'https://example.com/' } },
  ],
});
const playerA = randomBytes(32).toString('hex');
const playerB = randomBytes(32).toString('hex');
const fns = await openFunctions();
try {
  const score = (await fns.load('functions/api/crossword-score.ts')).onRequestPost;
  const send = (body) => callFunction(score, shelf, { body });
  const rowOf = async (player) => {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(player)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return shelf.scores.find((r) => r.player_hash === hash);
  };

  // ミス0・見た数0、開いていた時間 83 秒。画面がタイムを送っても使わない
  const t1 = randomUUID();
  shelf.addPlay({ id: t1, puzzle_id: PUZZLE_ID, active_ms: 83_400 });
  const r1 = await send({ playToken: t1, playerKey: playerA, name: NAME, timeSeconds: 1 });
  const a1 = await rowOf(playerA);
  check(r1.status === 200 && r1.j?.ok === true && r1.j?.updated === true, `記録できる → ${r1.status} ${JSON.stringify(r1.j)}`);
  check(a1?.time_seconds === 83, `タイムは回の開いていた時間から出る・画面の申告は使わない（${a1?.time_seconds}秒）`);
  check(a1?.reveals === 0 && a1?.misses === 0 && a1?.display_name === NAME, `ミス0・見た数0・名前がそのまま残る（${JSON.stringify({ reveals: a1?.reveals, misses: a1?.misses, name: a1?.display_name })}）`);
  const again = await send({ playToken: t1, playerKey: playerA, name: NAME });
  check(again.status === 400 && again.j?.reason === 'bad_request', `同じ回は2度記録できない → ${again.status} ${again.j?.reason ?? ''}`);

  const fast = randomUUID();
  shelf.addPlay({ id: fast, puzzle_id: PUZZLE_ID, active_ms: 2_000, too_fast: true });
  const rf = await send({ playToken: fast, playerKey: playerB, name: '' });
  check(rf.status === 400, `人間には無理な速さの回は断る → ${rf.status}`);
  const unsolved = randomUUID();
  shelf.addPlay({ id: unsolved, puzzle_id: PUZZLE_ID, active_ms: 50_000, solved: false });
  const ru = await send({ playToken: unsolved, playerKey: playerB, name: '' });
  check(ru.status === 400, `解けていない回は断る → ${ru.status}`);

  // 同じ人の遅い記録は上書きしない、速い記録は上書きする（印もその回の物になる）
  const slow = randomUUID();
  shelf.addPlay({ id: slow, puzzle_id: PUZZLE_ID, active_ms: 200_000, revealed: ['0,0'], misses: 2 });
  const rs = await send({ playToken: slow, playerKey: playerA, name: '' });
  const a2 = await rowOf(playerA);
  check(rs.status === 200 && rs.j?.updated === false && a2?.time_seconds === 83 && a2?.display_name === NAME, `遅い記録は前の速い記録を上書きしない（${a2?.time_seconds}秒・${a2?.display_name}）`);
  const quick = randomUUID();
  shelf.addPlay({ id: quick, puzzle_id: PUZZLE_ID, active_ms: 61_000, revealed: ['0,0', '1,0'], misses: 1 });
  const rq = await send({ playToken: quick, playerKey: playerA, name: '' });
  const a3 = await rowOf(playerA);
  check(rq.status === 200 && rq.j?.updated === true && a3?.time_seconds === 61 && a3?.reveals === 2 && a3?.misses === 1, `速い記録は上書きし、見た数とミスもその回の物になる（${JSON.stringify({ t: a3?.time_seconds, reveals: a3?.reveals, misses: a3?.misses })}）`);
  check(a3?.display_name === NAME, `書き換えで名前が空なら前の名前のまま（${a3?.display_name}）`);

  // 別の人・名前が空
  const tb = randomUUID();
  shelf.addPlay({ id: tb, puzzle_id: PUZZLE_ID, active_ms: 95_000 });
  const rb = await send({ playToken: tb, playerKey: playerB, name: '' });
  const b1 = await rowOf(playerB);
  check(rb.status === 200 && b1?.display_name === '名無し', `名前が空なら「名無し」（${b1?.display_name}）`);
  check(shelf.outside.length === 0, `外への通信は無い${shelf.outside.length ? `（${shelf.outside[0]}）` : ''}`);
} finally {
  await fns.close();
}

// ---- 2. ランキングの画面（手元の vite＋作り物の棚。1 で棚に入った行をそのまま返す） ----
let server = null;
function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
}
process.on('exit', stopServer);
async function startServer() {
  server = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', isolatedViteConfig(PORT), '--port', String(PORT), '--strictPort'], {
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

const browser = await chromium.launch();
const pageErrors = [];
try {
  await startServer();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const u = new URL(route.request().url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: JSON.stringify(body) });
    if (u.pathname.endsWith('/rpc/crossword_is_hidden')) return json(false);
    const table = u.pathname.split('/').pop();
    let rows = [];
    if (table === 'crossword_puzzles') rows = [...shelf.puzzles.values()];
    else if (table === 'crossword_scores') rows = shelf.scores.filter((r) => !r.is_hidden).sort((a, b) => a.time_seconds - b.time_seconds || a.updated_at.localeCompare(b.updated_at));
    if ((route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object')) return json(rows[0] ?? null);
    return json(rows);
  });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com|pagead2\.googlesyndication\.com)\//, (r) => r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/crossword/${PUZZLE_ID}/ranking`);
  await page.getByText(NAME).first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const lines = (await page.evaluate(() => document.body.innerText)).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const i = lines.indexOf(NAME);
  const row = i >= 0 ? lines.slice(Math.max(0, i - 1), i + 4) : null;
  check(i >= 0, `ランキングの画面に名前が出る: ${JSON.stringify(row)}`);
  check(Boolean(row) && row.includes('1:01'), `タイムが記録どおり出る（1:01）: ${JSON.stringify(row)}`);
  check(Boolean(row) && row.includes('2文字見た'), `見た数の印が記録どおり出る（ミス1・見た数2 → 2文字見た）: ${JSON.stringify(row)}`);
  const j = lines.indexOf('名無し');
  const rowB = j >= 0 ? lines.slice(Math.max(0, j - 1), j + 4) : null;
  check(Boolean(rowB) && rowB.includes('ノーミス・ノーアシスト') && rowB.includes('1:35'), `ミス0・見た数0の回は「ノーミス・ノーアシスト」: ${JSON.stringify(rowB)}`);
  check(i >= 0 && j > i, '速い順に並ぶ');
  await page.screenshot({ path: `${OUT}/ranking-390.png` });
  check(pageErrors.length === 0, `画面のつまずき（JS の例外）が無い${pageErrors.length ? `（${pageErrors[0].slice(0, 120)}）` : ''}`);
} catch (e) {
  check(false, `台本が途中で止まった: ${String(e).slice(0, 300)}`);
} finally {
  await browser.close();
  stopServer();
}
console.log('本番のランキングに載せた行: なし（手元の作り物の棚だけ）');
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
