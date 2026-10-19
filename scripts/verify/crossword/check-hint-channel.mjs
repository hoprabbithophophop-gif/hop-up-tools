// 作る画面の「ヒント」欄で、台帳に無い YouTube をチャンネル名付きで通す動き（Hop 決定 2026-10-19 案1）と、
// 形の崩れた YouTube の住所をリンクとして通さない抜け穴ふさぎを確かめる。
// 手元の vite を立ち上げ、棚（/rest/v1）・受付係（/api）・YouTube の oEmbed はブラウザの中で受け止める（本番にもプレビューにも通信しない）。
// 使い方: node scripts/verify/crossword/check-hint-channel.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outDir } from './_lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { spawn, spawnSync } = await import('node:child_process');
const { chromium } = await import('playwright');

const PORT = 5198;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-hint-channel');

let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fails++;
};

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

const browser = await chromium.launch();
const pageErrors = [];
let oembedMode = 'ok'; // ok | gone
let oembedCalls = 0;
try {
  await startServer();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try {
      for (const k of ['crossword_seen_tip_cross', 'crossword_seen_tip_move', 'crossword_seen_tip_saved', 'crossword_seen_create_guide']) localStorage.setItem(k, '1');
    } catch { /* 無視 */ }
  });
  // 棚は空で答える（台帳に無い動画として扱われる）
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const u = new URL(route.request().url());
    const body = u.pathname.endsWith('/rpc/crossword_is_hidden') ? false : [];
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: JSON.stringify(body) });
  });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com)\//, (r) => r.fulfill({ status: 204, body: '' }));
  // YouTube の oEmbed は作り物で答える（後に登録した route が先に当たるので、上の受け止めより後に置く）
  await ctx.route(/^https:\/\/www\.youtube\.com\/oembed/, (r) => {
    oembedCalls++;
    if (oembedMode === 'gone') return r.fulfill({ status: 401, body: 'Unauthorized' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ author_name: 'テストチャンネル', title: 'テストの動画' }) });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(`${BASE}/crossword/create`);
  const hint = page.locator('#cw-hint');
  await hint.waitFor({ timeout: 30000 });
  await page.getByText('ハロプロ', { exact: true }).first().click();
  await page.waitForTimeout(300);

  // (1) ハロプロのヒント欄に公式の発信の案内
  const guide = await page.locator('[data-hint-guide]').textContent().catch(() => null);
  check(guide && guide.startsWith('ヒントは公式の発信'), `(1) ハロプロのヒント欄に案内（${guide && guide.slice(0, 20)}…）`);

  // (2) 台帳に無い YouTube → チャンネル名と「公式の発信か確かめてください」付きで選ばれる
  await hint.fill('https://youtu.be/dQw4w9WgXcQ?t=83');
  await page.waitForTimeout(800);
  const ch = await page.locator('[data-hint-channel]').textContent().catch(() => null);
  check(ch === 'チャンネル: テストチャンネル 公式の発信か確かめてください。', `(2) ハロプロで台帳に無い動画はチャンネル名付きで通る（${ch}）`);
  check(oembedCalls === 1, `(2) チャンネル名は YouTube に1回だけ聞く（${oembedCalls}回）`);
  const timeVal = await page.locator('#cw-hint-time').inputValue().catch(() => null);
  check(timeVal === '1:23', `(2) URL の時刻が欄に入る（${timeVal}）`);
  await page.locator('[data-coach="create-hint"]').screenshot({ path: path.join(OUT, '1-hello-channel-390.png') });

  // (3) 形の崩れた YouTube の住所はリンクとして通さない
  await page.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  for (const bad of ['https://youtu.be/6Y2X6RxYnY', 'https://youtu.be/u_O3AYOdDr4si=8rMwkOOc4zhUkddH']) {
    await hint.fill(bad);
    await page.waitForTimeout(400);
    const txt = await page.evaluate(() => document.body.innerText);
    check(/YouTube の URL の形が違います/.test(txt) && (await page.locator('[data-hint-channel]').count()) === 0 && (await page.locator('[data-hint-kind]').count()) === 0, `(3) ${bad.slice(8, 40)} は「形が違います」で止まる`);
  }

  // (4) チャンネル名を聞けない動画（削除・非公開・埋め込み禁止）は使えない
  oembedMode = 'gone';
  await hint.fill('https://www.youtube.com/watch?v=abcdefghijk');
  await page.waitForTimeout(800);
  const goneTxt = await page.evaluate(() => document.body.innerText);
  check(/この動画を確かめられませんでした/.test(goneTxt), '(4) チャンネル名を聞けない動画は「確かめられませんでした」で使えない');
  oembedMode = 'ok';

  // (5) その他: 案内は無し。チャンネル名は出るが「公式の発信か確かめて」は付かない
  await page.getByText('その他', { exact: true }).first().click();
  await page.waitForTimeout(500);
  check((await page.locator('[data-hint-guide]').count()) === 0, '(5) その他のヒント欄に案内は出ない');
  await hint.fill('https://youtu.be/dQw4w9WgXcQ');
  await page.waitForTimeout(800);
  const ch2 = await page.locator('[data-hint-channel]').textContent().catch(() => null);
  check(ch2 === 'チャンネル: テストチャンネル', `(5) その他でもチャンネル名が出る（${ch2}）`);
  await page.locator('[data-coach="create-hint"]').screenshot({ path: path.join(OUT, '2-other-channel-390.png') });

  // (6) 390px で横にはみ出さない
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(wide, '(6) 390px で横にはみ出さない');

  check(pageErrors.length === 0, `(7) 画面のつまずき（JS の例外）が無い${pageErrors.length ? '：' + pageErrors.join(' / ') : ''}`);
  console.log(`写真: ${OUT}`);
} finally {
  await browser.close();
  stopServer();
}
console.log(fails === 0 ? 'すべてOK' : `NG ${fails} 件`);
process.exit(fails === 0 ? 0 : 1);
