// 書く欄の道具の段（○ボタンが無いこと）と、「自分が作った問題」の別画面を確かめる（作る画面は案A「作る｜試す」。Hop 決定 2026-10-22）。
// 何を:
//   - 書く欄の道具の段は【 】・｜・→ の3つで、○ボタンは無い（Hop 決定 2026-10-25 に○ボタンと説明の○の行をやめた）
//   - 欄を選んだまま｜を押すと、欄のカーソルの位置に｜が入り、欄は選ばれたまま（文字盤が閉じない）・カーソルは｜の後ろ（前は○ボタンで見ていた）
//   - 欄を離れた後に｜を押すと、欄が最後に覚えていたカーソルの所に入り、欄を選んだ状態になる（BulkEntry の作り）
//   - 「自分が作った問題」は別の画面（/crossword/mine）。作る画面には入口がいつも出る・一覧は新しい順・棚に無い問題は「非表示になっています」
//   - 消す前に確かめが出て、「やめる」で戻る（実際には消さない）・作る画面へ戻れる・何も無い時の表示
// なぜ: ○は答えの所を○で書く書き方に使い、押すたびに文字盤が閉じたり位置がずれたりすると書けないため。
// 手元だけで流す: この台本が手元の vite を口 5183 で立ち上げ（Supabase の住所は使わない仮の住所）、棚（/rest/v1）はブラウザの中の作り物で答える（どの問題も無い扱い）。
//   受付係（/api/）と棚への書き込みは見張り役が断って数える（0件のはず。保存も削除も押さない）。終わったら開発サーバーを止める。
// 手元の vite が途中でページを読み込み直さないよう、部品のまとめ置き場は口ごとの一時置き場・書き換えの見張り（HMR）は止めて立て（_lib.mjs の isolatedViteConfig）、
//   始める前に一度ひと回り開く下ごしらえをする。それでも読み込み直しで落ちた時だけ、その回を流し直す（最大3回。流し直した事は行に出す）
// 消した確かめ（2026-10-22 案A に書き直した時）:
//   - 「3の段にも入口が出る」: 段が無くなった。作る画面の入口は1か所（語の一覧の下）なので、開いた時の1回で見る
//   - 「欄を選んでいない時の○は末尾に足すだけで、欄は選ばれない」: ○が書く欄の道具の段へ移り、｜・→ と同じく「覚えていたカーソルの所に入れて欄を選ぶ」作りになったので、その形の確かめに替えた
// 使い方: node scripts/verify/crossword/check-maru-mine.mjs [写真の置き場]（省略時は一時置き場）
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { outDir, ROOT, guardWrites, watchStumbles, isolatedViteConfig } from './_lib.mjs';
import { waitBoard, toMode } from './_create.mjs';

const PORT = 5183;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-maru-mine', process.argv[2]);

let fail = 0;
// 結果は一度ためてから出す（手元の vite が途中でページを読み込み直して落ちた時に、通しで流し直すため）
let sink = null;
const check = (ok, label) => {
  if (sink) return void sink.push([ok, label]);
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
  if (!ok) fail++;
};

// ---- 開発サーバー（仮の Supabase の住所で立てる。本物の鍵は使わない。check-review-fixes と同じ） ----
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
      if ((await fetch(BASE)).ok) return;
    } catch { /* まだ */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('開発サーバーが60秒で立ち上がらなかった');
}
// ---- 棚の作り物（読むだけ。どの表も空で答える）。書き込みは見張り役へ回して数える ----
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
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com|[a-z0-9.]*googlesyndication\.com|[a-z0-9.]*doubleclick\.net)\//, (r) => r.fulfill({ status: 204, body: '' }));
}
// 手元の vite は、画面が初めて読み込んだ部品をその場でまとめ直し、その時ページを読み込み直す。先に一度ひと回り開いておく（check-create-flow と同じ下ごしらえ）
async function warmUp(browser, prepare) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await prepare(ctx);
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 60000 });
    await waitBoard(page);
    await toMode(page, 'try');
    await page.locator('[data-trial] [id^="cell-"]').first().click({ timeout: 20000 });
    await page.waitForTimeout(3000);
    await page.goto(`${BASE}/crossword/mine`);
    await page.waitForTimeout(2000);
  } catch { /* 下ごしらえが落ちても確かめは続ける */ }
  await ctx.close();
}

const writes = [];
const stumbles = [];
let browser = null;

async function run(page) {
  // ページの読み込みを数える（台本が開いた数より多ければ、手元の vite が読み込み直した）
  const st = { loads: 0, gotos: 0 };
  page.on('load', () => st.loads++);
  const go = async (url) => {
    st.gotos++;
    await page.goto(url);
  };
  try {
    // 1. 作る画面の入口は、作った問題が無くても出る
    await go(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    check((await page.locator('[data-create-mine]').count()) === 1 && (await page.getByRole('link', { name: /自分が作った問題/ }).count()) === 1, '作った問題が無くても、作る画面に「自分が作った問題」の入口が出る');

    // 2. ○ボタンは無く、道具の段は【 】・｜・→ の3つ（Hop 決定 2026-10-25）
    const area = page.locator('[data-bulk-text]');
    check((await page.locator('[data-bulk-insert="maru"]').count()) === 0 && (await page.getByRole('button', { name: '○を入れる' }).count()) === 0, '○ボタンは無い（[data-bulk-insert="maru"]・「○を入れる」が0）');
    const tools = await page.locator('[data-bulk] [data-bulk-insert]').evaluateAll((els) => els.map((e) => e.textContent.trim()));
    check(tools.join(' ') === '【 】 ｜ →', `道具の段は3つ: ${tools.join(' ')}`);
    // 欄を選んだまま｜を3回 → 欄は選ばれたまま、カーソルの位置に入る（前は○ボタンで見ていた）
    const bar = page.locator('[data-bulk] [data-bulk-insert="bar"]');
    await area.tap();
    await area.fill('音大卒の伝道師');
    await area.evaluate((el) => el.setSelectionRange(3, 3));
    await bar.tap();
    await bar.tap();
    await bar.tap();
    await page.waitForTimeout(100);
    check((await area.inputValue()) === '音大卒｜｜｜の伝道師', `欄のカーソルの位置に入る: ${await area.inputValue()}`);
    check(await area.evaluate((el) => document.activeElement === el), '押したあとも欄が選ばれたまま（文字盤が閉じない）');
    const caret = await area.evaluate((el) => [el.selectionStart, el.selectionEnd]);
    check(caret[0] === 6 && caret[1] === 6, `カーソルは入れた｜の後ろ（${caret.join('〜')}）`);
    await page.screenshot({ path: path.join(OUT, '1-tools-focused.png') });

    // 3. 欄を離れた後に｜ → 覚えていたカーソルの所に入り、欄を選んだ状態になる
    await area.evaluate((el) => el.blur());
    await page.waitForTimeout(500);
    await bar.tap();
    await page.waitForTimeout(100);
    check((await area.inputValue()) === '音大卒｜｜｜｜の伝道師', `欄を離れた後は、覚えていたカーソルの所に入る: ${await area.inputValue()}`);
    check(await area.evaluate((el) => document.activeElement === el), '欄を離れた後に押すと、欄を選んだ状態になる');
    await area.evaluate((el) => el.blur());

    // 4. 作った問題があっても作る画面に一覧は出ず、入口から別の画面に一覧が出る
    await page.evaluate(() =>
      localStorage.setItem(
        'crossword_my_puzzles',
        JSON.stringify([
          { id: 'AAAAAAAA', title: '試しの問題1', key: 'x'.repeat(64), createdAt: 1 },
          { id: 'BBBBBBBB', title: '試しの問題2', key: 'y'.repeat(64), createdAt: 2 },
        ])
      )
    );
    await go(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    check((await page.getByText('試しの問題1').count()) === 0, '作る画面に一覧は出ない');
    const entry = page.locator('[data-create-mine]');
    check((await entry.count()) === 1, '作った問題があっても、作る画面の入口は1つ');
    await entry.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, '2-create-entry.png') });
    await entry.click();
    await page.waitForURL(/\/crossword\/mine$/);
    await page.getByRole('heading', { name: '自分が作った問題' }).waitFor();
    const titles = await page.locator('li .font-bold.truncate').allInnerTexts();
    check(titles.join(',') === '試しの問題2,試しの問題1', `新しい順に並ぶ: ${titles.join(',')}`);
    await page.getByText('非表示になっています').nth(1).waitFor({ timeout: 15000 }).catch(() => {}); // 棚に1件ずつ聞いてから出る
    await page.screenshot({ path: path.join(OUT, '3-mine.png'), fullPage: true });
    check((await page.getByText('非表示になっています').count()) === 2, '棚に無い問題は「非表示になっています」');

    // 5. 消す？→やめる で戻る（実際には消さない）
    await page.getByRole('button', { name: '消す', exact: true }).first().click();
    check((await page.getByText('「試しの問題2」消す？').count()) === 1, '消す前に確かめる');
    await page.getByRole('button', { name: 'やめる' }).click();
    check((await page.getByRole('button', { name: '消す', exact: true }).count()) === 2, '「やめる」で元に戻る（どちらも残る）');
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('crossword_my_puzzles') || '[]').length);
    check(kept === 2, `端末の控えも2件のまま（${kept}件）`);

    // 6. 作る画面へ戻る
    await page.getByRole('link', { name: 'クロスワードパズル作成へ戻る' }).click();
    await page.waitForURL(/\/crossword\/create$/);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    check(true, '作る画面へ戻れる');

    // 7. 何も無い端末で直接開いたとき
    await page.evaluate(() => localStorage.removeItem('crossword_my_puzzles'));
    await go(`${BASE}/crossword/mine`);
    await page.getByRole('heading', { name: '自分が作った問題' }).waitFor();
    check((await page.getByText('この端末で作った問題はまだありません').count()) === 1, '何も無い時は「この端末で作った問題はまだありません。」');
    await page.screenshot({ path: path.join(OUT, '4-mine-empty.png') });
  } catch (e) {
    check(false, `台本が途中で止まった: ${e.message.split('\n')[0]}`);
  }
  return st.loads > st.gotos;
}

try {
  await startServer();
  browser = await chromium.launch();
  await warmUp(browser, async (ctx) => {
    await guardWrites(ctx, writes, BASE);
    await mockShelf(ctx);
  });
  for (let attempt = 1; attempt <= 3; attempt++) {
    sink = [];
    const stumbleAt = stumbles.length;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await guardWrites(ctx, writes, BASE);
    await mockShelf(ctx);
    const page = await ctx.newPage();
    await watchStumbles(page, stumbles);
    const reloaded = await run(page);
    await ctx.close();
    const results = sink;
    sink = null;
    if (reloaded && results.some(([ok]) => !ok) && attempt < 3) {
      console.log(`    途中で手元の vite がページを読み込み直したので、通しで流し直す（${attempt}回目）`);
      stumbles.length = stumbleAt;
      continue;
    }
    for (const [ok, label] of results) check(ok, label);
    break;
  }
} catch (e) {
  check(false, `台本が途中で止まった: ${e.message.split('\n')[0]}`);
} finally {
  if (browser) await browser.close();
  stopServer();
}

check(stumbles.length === 0, `画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）が無い${stumbles.length ? '：' + stumbles.slice(0, 3).join(' / ') : ''}`);
check(writes.length === 0, `受付係・棚への書き込みは0件（見張り役が断った通信: ${writes.length}件${writes.length ? ' ' + writes.join(' , ') : ''}）`);
console.log(`写真: ${OUT}`);
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
