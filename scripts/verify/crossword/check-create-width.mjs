// 作る画面（/crossword/create）の案A「作る｜試す」（Hop 決定 2026-10-22）が、画面の大きさごとに画面に収まるかを測って写真を撮る。
// 何を: 375×548・390×548（iPhone SE の Safari で見える高さ）・390×844・1280×800 で、
//   - 見出しと切り替え [data-create-head] が44px・小さい盤 [data-mini] が110px・下の段 [data-dock] が60px か
//   - 書く欄・語の一覧・語の窓・広げた盤・試す・共有の窓が横にはみ出さないか（documentElement.clientWidth と各部品の左右の端で見る。scrollWidth も添える）
//   - 下の段が画面の下で切れていないか・窓（語の窓・広げた盤・共有の窓）が画面の上下からはみ出さないか
//   - 共有の窓の「共有する」と押せない理由が、窓を開いたまま（スクロールせずに）画面の中に見えるか（窓の下に貼り付く作り。Hop 決定 2026-10-22）
// なぜ: 案A は上と下に貼り付く段があり、iPhone SE の低い画面で書く所や押す所が隠れやすいため。
// 手元だけで流す: この台本が手元の vite を口 5182 で立ち上げ（Supabase の住所は使わない仮の住所）、棚（/rest/v1）はブラウザの中の作り物で答える。
//   受付係（/api/）と棚への書き込みは見張り役が断って数える（0件のはず。保存は押さない）。終わったら開発サーバーを止める。
// 手元の vite が途中でページを読み込み直さないよう、部品のまとめ置き場は口ごとの一時置き場・書き換えの見張り（HMR）は止めて立て（_lib.mjs の isolatedViteConfig）、
//   始める前に一度ひと回り開く下ごしらえをする。それでも読み込み直しで落ちた時だけ、その回を流し直す（最大3回。流し直した事は行に出す）
// 消した確かめ（2026-10-22 案A に書き直した時）:
//   - 1の段の空の画面: 初めて開くと見本の4行が入っているので、空の画面は無くなった
//   - 1の段の「ヒントを付ける」側（hintMode）: 案A では語の一覧の行から語の窓を開くので、切り替えが無くなった
//   - 2 盤・3 カギの段: 段が無くなった。盤は「広げた盤」、カギは「語の窓」で測る
//   - 960px の幅: 案A の面は640pxまでで、960px は 1280px と同じ形になるので、Hop 指定の4つの大きさに替えた
// 使い方: node scripts/verify/crossword/check-create-width.mjs [写真の置き場]（省略時は一時置き場）
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { outDir, ROOT, guardWrites, watchStumbles, isolatedViteConfig } from './_lib.mjs';
import { writeLines, waitBoard, openWordSheet, closeWordSheet, openBoard, closeBoard, toMode, openShare, SAMPLE_WORDS } from './_create.mjs';

const PORT = 5182;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-create-width', process.argv[2]);

let fail = 0;
// 大きさごとの結果は一度ためてから出す（読み込み直しで落ちた時に、その大きさだけ流し直すため）
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
// 手元の vite は、画面が初めて読み込んだ部品をその場でまとめ直し、その時ページを読み込み直す（特に「試す」を初めて開いた時）。
// 確かめの途中で読み込み直されると書いた中身が消えるので、先に一度ひと回り開いておく（check-create-flow と同じ下ごしらえ）
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
// 開いた後にページが読み込み直されたかを数える（読み込み直しで落ちた大きさだけ、もう一度流す）
const countReloads = (page) => {
  const st = { n: 0 };
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) st.n++; });
  return st;
};

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
  // 外のサイト（YouTube のサムネイル・人間確認・解析・広告）へは出さない
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com|[a-z0-9.]*googlesyndication\.com|[a-z0-9.]*doubleclick\.net)\//, (r) => r.fulfill({ status: 204, body: '' }));
}

// 部品の位置を測る（無い部品は null）
const measure = (page, sels) =>
  page.evaluate((sels) => {
    const cw = document.documentElement.clientWidth;
    const out = { cw, ih: window.innerHeight, sw: document.documentElement.scrollWidth, parts: {} };
    for (const s of sels) {
      const els = [...document.querySelectorAll(s)];
      if (!els.length) {
        out.parts[s] = null;
        continue;
      }
      // 同じ印が複数ある時（語の一覧の行など）は、全部を囲む箱で見る
      const rs = els.map((e) => e.getBoundingClientRect());
      const l = Math.min(...rs.map((r) => r.left)), r = Math.max(...rs.map((r) => r.right));
      const t = Math.min(...rs.map((r) => r.top)), b = Math.max(...rs.map((r) => r.bottom));
      out.parts[s] = { l: Math.round(l * 10) / 10, r: Math.round(r * 10) / 10, t: Math.round(t * 10) / 10, b: Math.round(b * 10) / 10, h: Math.round((b - t) * 10) / 10 };
    }
    return out;
  }, sels);
const inX = (m, s) => !!m.parts[s] && m.parts[s].l >= -0.5 && m.parts[s].r <= m.cw + 0.5;
const inY = (m, s) => !!m.parts[s] && m.parts[s].t >= -0.5 && m.parts[s].b <= m.ih + 0.5;
const box = (m, s) => (m.parts[s] ? `${s} 左${m.parts[s].l}〜右${m.parts[s].r}・上${m.parts[s].t}〜下${m.parts[s].b}` : `${s} 無し`);

const SIZES = [
  { w: 375, h: 548, phone: true },
  { w: 390, h: 548, phone: true },
  { w: 390, h: 844, phone: true },
  { w: 1280, h: 800, phone: false },
];
const heights = [];
const writes = [];
const stumbles = [];
let browser = null;

try {
  await startServer();
  browser = await chromium.launch();
  await warmUp(browser, async (ctx) => {
    await guardWrites(ctx, writes, BASE);
    await mockShelf(ctx);
  });
  for (const { w, h, phone } of SIZES) for (let attempt = 1; attempt <= 3; attempt++) {
    const tag = `${w}×${h}`;
    sink = [];
    const heightsAt = heights.length;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
    await guardWrites(ctx, writes, BASE);
    await mockShelf(ctx);
    const page = await ctx.newPage();
    const stumbleAt = stumbles.length;
    await watchStumbles(page, stumbles, tag);
    const reloads = countReloads(page);
    let base = 2; // 開いた時は2回動く（開く・住所の整え）
    const shot = (name) => page.screenshot({ path: path.join(OUT, `create-width-${w}x${h}-${name}.png`) });
    try {
      await page.goto(`${BASE}/crossword/create`);
      await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
      await waitBoard(page);
      base = reloads.n;

      // 1. 作る（見本の4行が入った初めの画面）
      const m1 = await measure(page, ['[data-create-head]', '[data-mini]', '[data-dock]', '[data-bulk-text]', '[data-word-list]', '[data-word-row]']);
      const hh = m1.parts['[data-create-head]']?.h, mh = m1.parts['[data-mini]']?.h, dh = m1.parts['[data-dock]']?.h;
      heights.push(`${tag}: 見出し${hh}px・小さい盤${mh}px・下の段${dh}px`);
      check(hh === 44, `${tag}・作る: 見出しと切り替えが44px（${hh}px）`);
      check(mh === 110, `${tag}・作る: 小さい盤が110px（${mh}px）`);
      check(dh === 60, `${tag}・作る: 下の段が60px（${dh}px）`);
      check(inY(m1, '[data-dock]') && Math.abs(m1.parts['[data-dock]'].b - m1.ih) <= 0.5, `${tag}・作る: 下の段が画面の下で切れない（${box(m1, '[data-dock]')}・見える高さ${m1.ih}）`);
      for (const s of ['[data-create-head]', '[data-mini]', '[data-bulk-text]', '[data-word-list]', '[data-word-row]']) {
        check(inX(m1, s), `${tag}・作る: 横にはみ出さない（${box(m1, s)}・画面の幅${m1.cw}）`);
      }
      check(m1.sw <= m1.cw, `${tag}・作る: ページが横にスクロールしない（scrollWidth ${m1.sw}・画面の幅${m1.cw}）`);
      await shot('1-make');
      // 語の一覧が見える所までスクロールした写真（低い画面で下の段に隠れないかを見る）
      await page.locator('[data-word-row]').last().scrollIntoViewIfNeeded();
      const m1b = await measure(page, ['[data-dock]']);
      const lastRow = await page.locator('[data-word-row]').last().boundingBox();
      check(!!lastRow && lastRow.y + lastRow.height <= m1b.parts['[data-dock]'].t + 0.5, `${tag}・作る: 語の一覧の最後の行までスクロールすると、下の段に隠れない（行の下${lastRow ? Math.round(lastRow.y + lastRow.height) : '?'}・下の段の上${m1b.parts['[data-dock]'].t}）`);
      await shot('1b-make-list');
      await page.evaluate(() => window.scrollTo(0, 0));

      // 2. 語の窓
      await openWordSheet(page, SAMPLE_WORDS[2]);
      await page.waitForTimeout(300);
      const m2 = await measure(page, ['[data-word-sheet]', '[data-word-sheet] #cw-clue', '[data-word-sheet] #cw-hint']);
      for (const s of ['[data-word-sheet]', '[data-word-sheet] #cw-clue', '[data-word-sheet] #cw-hint']) check(inX(m2, s), `${tag}・語の窓: 横にはみ出さない（${box(m2, s)}・画面の幅${m2.cw}）`);
      check(inY(m2, '[data-word-sheet]'), `${tag}・語の窓: 画面の上下からはみ出さない（${box(m2, '[data-word-sheet]')}・見える高さ${m2.ih}）`);
      check(m2.sw <= m2.cw, `${tag}・語の窓: ページが横にスクロールしない（scrollWidth ${m2.sw}）`);
      await shot('2-word-sheet');
      await closeWordSheet(page);

      // 3. 広げた盤
      await openBoard(page);
      await page.waitForTimeout(400);
      const m3 = await measure(page, ['[data-board-sheet]', '[data-create-board]', '[data-reshuffle]', '[data-bulk-proposal]']);
      for (const s of ['[data-board-sheet]', '[data-create-board]', '[data-reshuffle]', '[data-bulk-proposal]']) check(inX(m3, s), `${tag}・広げた盤: 横にはみ出さない（${box(m3, s)}・画面の幅${m3.cw}）`);
      check(inY(m3, '[data-board-sheet]'), `${tag}・広げた盤: 画面の上下からはみ出さない（${box(m3, '[data-board-sheet]')}・見える高さ${m3.ih}）`);
      await shot('3-board-sheet');
      await closeBoard(page);

      // 4. 試す
      await toMode(page, 'try');
      await page.locator('[data-trial] [id^="cell-"]').first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(2500); // 組み上がりの演出
      const m4 = await measure(page, ['[data-trial]', '[data-trial] [id^="cell-"]', '[data-dock]']);
      for (const s of ['[data-trial]', '[data-trial] [id^="cell-"]']) check(inX(m4, s), `${tag}・試す: 横にはみ出さない（${box(m4, s)}・画面の幅${m4.cw}）`);
      check(inY(m4, '[data-dock]') && m4.parts['[data-dock]'].h === 60, `${tag}・試す: 下の段が60pxで切れない（${box(m4, '[data-dock]')}）`);
      check(m4.sw <= m4.cw, `${tag}・試す: ページが横にスクロールしない（scrollWidth ${m4.sw}）`);
      await shot('4-try');
      await toMode(page, 'make');

      // 5. 共有の窓（見本はヒントが無いので、押せない理由が出て「共有する」は押せない）
      await openShare(page);
      await page.waitForTimeout(400);
      const m5 = await measure(page, ['[data-share-sheet]', '#cw-title', '#cw-tag', '[data-share-blocks]', '[data-save]', '[data-copyright]']);
      for (const s of ['[data-share-sheet]', '#cw-title', '#cw-tag', '[data-share-blocks]', '[data-save]']) check(inX(m5, s), `${tag}・共有の窓: 横にはみ出さない（${box(m5, s)}・画面の幅${m5.cw}）`);
      check(inY(m5, '[data-share-sheet]'), `${tag}・共有の窓: 画面の上下からはみ出さない（${box(m5, '[data-share-sheet]')}・見える高さ${m5.ih}）`);
      check(inY(m5, '[data-save]') && inY(m5, '[data-share-blocks]'), `${tag}・共有の窓: 開いたままで「共有する」と押せない理由が画面の中に見える（${box(m5, '[data-share-blocks]')}・${box(m5, '[data-save]')}）`);
      const blocks = (await page.locator('[data-share-blocks]').textContent())?.trim() ?? '';
      check(blocks.includes('ヒントがあと4つ') && (await page.locator('[data-save]').isDisabled()), `${tag}・共有の窓: 押せない理由「${blocks}」が出て「共有する」は押せない`);
      check(m5.sw <= m5.cw, `${tag}・共有の窓: ページが横にスクロールしない（scrollWidth ${m5.sw}）`);
      await shot('5-share');
    } catch (e) {
      check(false, `${tag}: 台本が途中で止まった: ${e.message.split('\n')[0]}`);
      await shot('stopped').catch(() => {});
    }
    await ctx.close();
    const results = sink;
    sink = null;
    if (reloads.n > base && results.some(([ok]) => !ok) && attempt < 3) {
      console.log(`    ${tag}: 途中で手元の vite がページを読み込み直したので、この大きさを流し直す（${attempt}回目）`);
      stumbles.length = stumbleAt;
      heights.length = heightsAt;
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

console.log(`測った高さ: ${heights.join(' / ')}`);
check(stumbles.length === 0, `画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）が無い${stumbles.length ? '：' + stumbles.slice(0, 3).join(' / ') : ''}`);
check(writes.length === 0, `受付係・棚への書き込みは0件（見張り役が断った通信: ${writes.length}件${writes.length ? ' ' + writes.join(' , ') : ''}）`);
console.log(`写真: ${OUT}`);
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
