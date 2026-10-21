// 起こりうる困った場面（2026-10-04 洗い出しの 1〜6）で、詰まらず正しい知らせが出るかを確かめる。
// 何を:
//   1 台帳から消えた動画のヒントは「見られなくなりました」（解く画面・自分が作った問題）
//   2 作る画面の語の窓のヒントの欄: 再生できない動画は「この動画はヒントに使えません。」で選べない（案A「作る｜試す」の語の窓。Hop 決定 2026-10-22）
//   3 解いている途中に問題が隠された・消された時の知らせ
//   4 回の記録が無くなっていた（30日で片付いた）時、新しい回として始め直して解き終えられる（本物の受付係）
//   5 回を始める人が多すぎる時の知らせ
//   6 作る画面の語の窓のヒントの欄: リンクは https だけ・IP アドレスだけの住所は不可（2026-10-04 洗い出しの G）
// なぜ: どれも普段は起きにくく、起きた時に黙って詰まると解く人・作る人が何も分からなくなるため。
// 既定では 2 と 6 だけを手元で流す: この台本が手元の vite を口 5184 で立ち上げ（Supabase の住所は使わない仮の住所。部品のまとめ置き場は口ごとの一時置き場・
//   書き換えの見張りは止める。_lib.mjs の isolatedViteConfig）、棚（/rest/v1）はブラウザの中の作り物で答える（動画の台帳は空）。
//   受付係（/api/）と棚への書き込みは見張り役が断って数える（0件のはず）。終わったら開発サーバーを止める。
//   動画のことは YouTube にもどこにも問い合わせない作り（Hop 決定 2026-10-21）なので、2 の「使えない」は YouTube の再生部品（本物を読む）が返す誤りで決まる。
// 既定では流さない部分: 1・3・4・5。解く画面を本物の問題で開き、本物の受付係で回を始めるので、本番の回の記録（crossword_plays）に行が増えるため
//   （2026-10-19 Hop「確かめの台本を無断で周回しない」）。作りは残してあり、ITEMS に番号を並べた時だけ行き先（プレビュー）で流す。
// 消した確かめ（2026-10-22 案A に書き直した時）: 無し。2 と 6 は「1の段のヒントの窓」から「語の窓」へ開き方を替え、語の一覧の「ヒントがまだ」の確かめを足した
// 使い方: node scripts/verify/crossword/check-edge.mjs（2 と 6 を手元で）
//         ITEMS=1,3,4,5 node scripts/verify/crossword/check-edge.mjs [サイト] [ハロプロの問題の番号] ['<答えの配置 JSON>'] [残すマス x,y]
// （1・3・4・5 で省略した引数は targets.json の問題から決める。答えの配置は受付係に聞いて一時置き場に控える）
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { guardWrites, watchStumbles, interceptCount, arg, outDir, puzzleArgs, BASE_DEFAULT, ID_DEFAULT, cellAt, ROOT, isolatedViteConfig } from './_lib.mjs';
import { writeLines, openWordSheet, waitBoard as waitCreateBoard } from './_create.mjs';

const BASE = arg(2, BASE_DEFAULT);
const ID = arg(3, ID_DEFAULT);
const ITEMS = new Set((process.env.ITEMS || '2,6').split(',').map((x) => x.trim()));
const run = (n) => ITEMS.has(String(n));
const needsPuzzle = [1, 3, 4, 5].some(run);
const needsLocal = [2, 6].some(run);
const P = needsPuzzle ? await puzzleArgs(BASE, ID, { cluesJson: arg(4), last: arg(5) }) : null;
const LAST = P?.last;
const OUT = outDir('check-edge');
const full = {};
for (const c of P?.cluesJson ?? []) c.a.forEach((ch, i) => {
  full[`${c.d === 'horizontal' ? c.x + i : c.x},${c.d === 'vertical' ? c.y + i : c.y}`] = ch;
});
const almost = { ...full };
delete almost[LAST];
const [lx, ly] = LAST ? LAST.split(',').map(Number) : [];
const writes = [];
// 画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）を控える（2026-10-21）
const stumbles = [];
console.log(`流す場面: ${[...ITEMS].join(',')}${needsLocal ? '（2・6 は手元）' : ''}${needsPuzzle ? `（1・3・4・5 は ${BASE}）` : ''}`);

let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};

// ---- 手元の開発サーバー（2・6 用。仮の Supabase の住所で立てる。本物の鍵は使わない。check-review-fixes と同じ） ----
const PORT = 5184;
const LOCAL = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
let server = null;
function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
}
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
      if ((await fetch(LOCAL)).ok) return;
    } catch { /* まだ */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('開発サーバーが60秒で立ち上がらなかった');
}
// 棚の作り物（読むだけ。どの表も空で答える＝動画の台帳も空）。書き込みは見張り役へ回して数える
async function mockShelf(ctx) {
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const req = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.fallback();
    const u = new URL(req.url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.endsWith('/rpc/crossword_is_hidden')) return json(false);
    if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) return json(null);
    return json([]);
  });
  // 人間確認・解析・広告へは出さない（YouTube の再生部品は本物を読む）
  await ctx.route(/^https:\/\/(challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com|[a-z0-9.]*googlesyndication\.com|[a-z0-9.]*doubleclick\.net)\//, (r) => r.fulfill({ status: 204, body: '' }));
}

const browser = await chromium.launch();

// 手元の作る画面を開いて2語を書く（2・6 用）
async function openLocalCreate() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await guardWrites(ctx, writes, LOCAL);
  await mockShelf(ctx);
  const page = await ctx.newPage();
  await watchStumbles(page, stumbles, '作る画面（手元）');
  await page.goto(`${LOCAL}/crossword/create`);
  await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
  await writeLines(page, '【ネコ】\n【コアラ】');
  await page.waitForFunction(() => document.querySelectorAll('[data-word-row]').length === 2, null, { timeout: 10000 });
  await waitCreateBoard(page);
  return { ctx, page };
}

// 行き先（プレビュー）の解く画面を開く（1・3・4・5 用。本物の受付係で回を始めるので見張らない）
async function open(path, { answers = null, play = undefined, routes = [], mine = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await interceptCount(ctx);
  await ctx.route('**/api/crossword-score', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  for (const [pattern, handler] of routes) await ctx.route(pattern, handler);
  const page = await ctx.newPage();
  await watchStumbles(page, stumbles, path);
  await page.goto(`${BASE}/crossword/mine`);
  await page.evaluate(({ id, answers, play, mine }) => {
    localStorage.setItem('crossword_seen_help', 'true');
    if (answers) localStorage.setItem(`crossword_progress_${id}`, JSON.stringify({ userAnswers: answers, elapsedSeconds: 0, play, savedAt: Date.now() }));
    if (mine) localStorage.setItem('crossword_my_puzzles', JSON.stringify([{ id, title: 't', key: 'x'.repeat(64), createdAt: 1 }]));
  }, { id: ID, answers, play, mine });
  await page.goto(`${BASE}${path}`);
  return { ctx, page };
}
const text = (page) => page.evaluate(() => document.body.innerText);
const waitBoard = async (page) => {
  await page.locator('[id^="cell-"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
};
const fillLast = async (page) => {
  await cellAt(page, lx, ly, '空').click();
  await page.getByRole('button', { name: full[LAST], exact: true }).last().click();
};
const noCatalog = ['**/rest/v1/youtube_videos*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })];

try {
  if (needsLocal) await startServer();

  // 1a. ハロプロのジャンル: 台帳から消えた動画のヒントは「見られなくなりました」
  if (run(1)) {
    const { ctx, page } = await open(`/crossword/${ID}`, { routes: [noCatalog] });
    await waitBoard(page);
    await page.locator('[id^="cell-"]').first().click();
    await page.getByRole('button', { name: 'ヒント', exact: true }).first().click();
    await page.waitForTimeout(1500);
    const t = await text(page);
    check(t.includes('このヒントの動画は見られなくなりました'), '1 台帳から消えた動画のヒントは「見られなくなりました」');
    check((await page.locator('iframe[src*="youtube"]').count()) === 0, '1 その時はプレイヤーを置かない');
    await page.screenshot({ path: `${OUT}/edge-1-gone.png` });
    await ctx.close();
  }
  // 1b. 台帳にあれば今まで通りプレイヤー
  if (run(1)) {
    const { ctx, page } = await open(`/crossword/${ID}`);
    await waitBoard(page);
    await page.locator('[id^="cell-"]').first().click();
    await page.getByRole('button', { name: 'ヒント', exact: true }).first().click();
    await page.waitForTimeout(4000);
    check((await page.locator('iframe[src*="youtube"]').count()) >= 1, '1 台帳にある動画は今まで通りプレイヤーが出る');
    await ctx.close();
  }
  // 1c. 自分が作った問題: 見られなくなったヒントがあると知らせる
  if (run(1)) {
    const { ctx, page } = await open('/crossword/mine', { routes: [noCatalog], mine: true });
    await page.getByRole('heading', { name: '自分が作った問題' }).waitFor();
    await page.waitForTimeout(3000);
    check((await text(page)).includes('見られなくなったヒントがあります'), '1 自分が作った問題に「見られなくなったヒントがあります」');
    await ctx.close();
  }

  // 2. 作る画面の語の窓: 再生できない動画（存在しない番号）は「この動画はヒントに使えません。」で選べない（YouTube の再生部品は本物）。
  //    動画のことは YouTube にもどこにも問い合わせない（Hop 決定 2026-10-21）。台帳にあるかの確かめは、手元の画面が作り物の棚（空の台帳）を読むだけ
  if (run(2)) {
    const { ctx, page } = await openLocalCreate();
    await openWordSheet(page, 'ネコ');
    const sheet = page.locator('[data-word-sheet="ネコ"]');
    await sheet.locator('#cw-hint').fill('https://youtu.be/aaaaaaaaaa0');
    await sheet.getByText('この動画はヒントに使えません。').waitFor({ timeout: 20000 }).catch(() => {});
    const t = await sheet.innerText();
    check(t.includes('この動画はヒントに使えません。') && (await sheet.locator('[data-hint-kind]').count()) === 0, '2 語の窓で、再生できない動画は「この動画はヒントに使えません。」で選べない');
    await page.screenshot({ path: `${OUT}/edge-2-unusable.png` });
    await page.locator('[data-word-close]').click();
    await page.locator('[data-word-sheet]').waitFor({ state: 'detached', timeout: 10000 });
    check((await page.locator('[data-word-row="ネコ"] [data-word-missing="hint"]').count()) === 1, '2 その語は語の一覧で「ヒントがまだ」のまま');
    await ctx.close();
  }

  // 3. 解いている途中に問題が隠された・消された
  if (run(3)) {
    const gone = ['**/api/crossword-play', (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      if (body.action === 'check') return r.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false,"reason":"not_found"}' });
      return r.fallback();
    }];
    const { ctx, page } = await open(`/crossword/${ID}`, { answers: almost, routes: [gone] });
    await waitBoard(page);
    await fillLast(page);
    await page.waitForTimeout(1500);
    check((await text(page)).includes('この問題は非表示になったか、消されました。'), '3 「この問題は非表示になったか、消されました。」');
    await ctx.close();
  }
  // 4. 回の記録が無くなっていた（30 日で片付いた）→ 新しい回として始め直して解き終える（本物の受付係）
  if (run(4)) {
    const { ctx, page } = await open(`/crossword/${ID}`, { answers: almost, play: { token: '00000000-0000-4000-8000-000000000000', localStart: Date.now() - 40 * 86400 * 1000 } });
    // NG の時に原因を切り分けられるよう、受付係とのやり取り（動作・返事の番号・返事の頭）を控える
    const talk = [];
    page.on('response', async (r) => {
      if (!r.url().includes('/api/crossword-play')) return;
      const action = (() => { try { return JSON.parse(r.request().postData() || '{}').action; } catch { return '?'; } })();
      talk.push(`${action}:${r.status()}:${(await r.text().catch(() => '')).slice(0, 40)}`);
    });
    await waitBoard(page);
    await fillLast(page);
    // 無い回 → 始め直し → 丸付け と受付係を3往復するので、決め打ちの4秒ではなく最大15秒まで待つ（2026-10-05 run-all の中で4秒では足りず NG になった）
    await page.getByText('CLEARED!').first().waitFor({ timeout: 15000 }).catch(() => {});
    const t = await text(page);
    const ok4 = t.includes('CLEARED!') && !t.includes('通信できませんでした');
    if (!ok4) await page.screenshot({ path: `${OUT}/edge-4-restart.png` });
    check(ok4, `4 古い回の番号でも始め直して解き終えられる${ok4 ? '' : '（受付係とのやり取り: ' + talk.join(' , ') + '）'}`);
    // 解けた後は端末の途中経過が消える（2026-10-06 の直し）。新しい回で解き終えられたこと自体は上の CLEARED! で見ている
    const progress = await page.evaluate((id) => localStorage.getItem(`crossword_progress_${id}`), ID);
    check(progress === null, `4 解けた後は端末の途中経過が消える: ${progress === null ? '消えている' : '残っている'}`);
    await ctx.close();
  }
  // 5. 回を始める人が多すぎる
  if (run(5)) {
    const busy = ['**/api/crossword-play', (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      if (body.action === 'start') return r.fulfill({ status: 429, contentType: 'application/json', body: '{"ok":false,"reason":"too_many"}' });
      return r.fallback();
    }];
    const { ctx, page } = await open(`/crossword/${ID}`, { answers: almost, routes: [busy] });
    await waitBoard(page);
    await fillLast(page);
    await page.waitForTimeout(1500);
    check((await text(page)).includes('混み合っています。少し待ってからもう一度お試しください。'), '5 「混み合っています。少し待ってからもう一度お試しください。」');
    await ctx.close();
  }

  // 6. リンクのヒントの決まり（https だけ・IP アドレスだけの住所は不可。2026-10-04 洗い出しの G）。作る画面の語の窓で
  if (run(6)) {
    const { ctx, page } = await openLocalCreate();
    await openWordSheet(page, 'ネコ');
    const sheet = page.locator('[data-word-sheet="ネコ"]');
    const link = sheet.locator('[data-hint-source="link"]');
    if (await link.count()) await link.click();
    const box = sheet.locator('#cw-hint');
    for (const bad of ['http://example.com/', 'https://192.168.0.1/']) {
      await box.fill(bad);
      await page.waitForTimeout(600);
      check((await sheet.innerText()).includes('リンクは https から始まる URL だけ使えます。') && (await sheet.locator('[data-hint-kind]').count()) === 0, `6 ${bad} は使えないと出る`);
    }
    await box.fill('https://example.com/page');
    await page.waitForTimeout(600);
    check((await sheet.locator('[data-hint-kind]').textContent().catch(() => null)) === 'リンク' && !(await sheet.innerText()).includes('リンクは https から'), '6 https のサイトは選べる');
    await page.screenshot({ path: `${OUT}/edge-6-link.png` });
    await page.locator('[data-word-close]').click();
    await page.locator('[data-word-sheet]').waitFor({ state: 'detached', timeout: 10000 });
    check((await page.locator('[data-word-row="ネコ"] [data-word-missing="hint"]').count()) === 0, '6 選んだリンクで、語の一覧の「ヒントがまだ」が消える');
    await ctx.close();
  }
} catch (e) {
  check(false, `台本が途中で止まった: ${e.message.split('\n')[0]}`);
} finally {
  await browser.close();
  stopServer();
}

check(stumbles.length === 0, `画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）が無い${stumbles.length ? '：' + stumbles.slice(0, 3).join(' / ') : ''}`);
if (needsLocal) check(writes.length === 0, `手元の 2・6 で受付係・棚への書き込みは0件（見張り役が断った通信: ${writes.length}件${writes.length ? ' ' + writes.join(' , ') : ''}）`);
console.log(`写真: ${OUT}`);
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
