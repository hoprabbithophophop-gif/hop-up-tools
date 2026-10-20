// 作る画面のヒントの窓（1の段で下線の語を押すと下から出る。4段の流れ・2026-10-20）で、台帳に無い YouTube をチャンネル名付きで通す動き（Hop 決定 2026-10-19 案1）と、
// 形の崩れた YouTube の住所をリンクとして通さない抜け穴ふさぎ、台帳の検索（言葉を空白で区切って全部含む・題名とチャンネル名・新しい順に20件）を確かめる。
// 台帳の検索は本番の棚を読まず、作り物の返事に差し替える（棚に送る住所だけを見る）。2026-10-21 に4段の流れに合わせて書き直し、ジャンル「その他」の項目は消した。
// 手元の vite を立ち上げ、棚（/rest/v1）・受付係（/api）・YouTube の oEmbed はブラウザの中で受け止める（本番にもプレビューにも通信しない）。
// 使い方: node scripts/verify/crossword/check-hint-channel.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outDir } from './_lib.mjs';
import { writeLines, openHintSheet, closeHintSheet } from './_create.mjs';

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
const catalogAsks = []; // 台帳の検索（youtube_videos の題名・チャンネル名）で棚に送った住所
// 台帳の検索の作り物の返事（25件。画面が上限の20件で頼んでいるかを見るため、返事は頼まれた件数で切る）
const catalogRows = Array.from({ length: 25 }, (_, i) => ({
  video_id: `vid${String(i).padStart(8, '0')}`, title: `ハロコン 武道館 見本の動画 ${i + 1}`, channel_name: 'ハロプロの見本チャンネル', published_at: `2026-0${(i % 9) + 1}-01T00:00:00Z`,
}));
try {
  await startServer();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try {
      for (const k of ['crossword_seen_tip_cross', 'crossword_seen_tip_move', 'crossword_seen_tip_saved', 'crossword_seen_trace']) localStorage.setItem(k, '1');
    } catch { /* 無視 */ }
  });
  // 棚は作り物で答える。台帳にある動画の確かめ（数だけ）は0件＝台帳に無い動画として扱われる。台帳の検索は catalogRows を返す
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/rpc/crossword_is_hidden')) return route.fulfill({ status: 200, contentType: 'application/json', body: 'false' });
    let body = [];
    if (u.pathname.endsWith('/youtube_videos') && (u.searchParams.get('select') || '').includes('title')) {
      catalogAsks.push(u);
      body = catalogRows.slice(0, Number(u.searchParams.get('limit') || catalogRows.length));
    }
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

  // 作る画面の1の段で答えを2つ書き、下線の語「ネコ」を押してヒントの窓を開く
  await page.goto(`${BASE}/crossword/create`);
  await writeLines(page, '【ネコ】\n【コアラ】');
  await openHintSheet(page, 'ネコ');
  const sheet = page.locator('[data-hint-sheet]');
  const hint = sheet.locator('#cw-hint');

  // (1) ヒントの窓の頭に「ヒントは答えの根拠です。」と公式の発信の案内
  const guide = await sheet.locator('[data-hint-guide]').textContent().catch(() => null);
  check(guide && guide.startsWith('ヒントはハロプロの公式の発信'), `(1) ヒントの窓に案内（${guide && guide.slice(0, 20)}…）`);
  check((await sheet.innerText()).includes('ヒントは答えの根拠です。'), '(1) 窓の頭に「ヒントは答えの根拠です。」');

  // (2) 台帳に無い YouTube → チャンネル名と「公式の発信か確かめてください」付きで選ばれる
  await hint.fill('https://youtu.be/dQw4w9WgXcQ?t=83');
  await page.waitForTimeout(800);
  const ch = await sheet.locator('[data-hint-channel]').textContent().catch(() => null);
  check(ch === 'チャンネル: テストチャンネル ハロプロの公式の発信か確かめてください。', `(2) 台帳に無い動画はチャンネル名付きで通る（${ch}）`);
  check(oembedCalls === 1, `(2) チャンネル名は YouTube に1回だけ聞く（${oembedCalls}回）`);
  const timeVal = await sheet.locator('#cw-hint-time').inputValue().catch(() => null);
  check(timeVal === '1:23', `(2) URL の時刻が欄に入る（${timeVal}）`);
  await sheet.screenshot({ path: path.join(OUT, '1-hello-channel-390.png') });

  // (3) 形の崩れた YouTube の住所はリンクとして通さない
  await sheet.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  for (const bad of ['https://youtu.be/6Y2X6RxYnY', 'https://youtu.be/u_O3AYOdDr4si=8rMwkOOc4zhUkddH']) {
    await hint.fill(bad);
    await page.waitForTimeout(400);
    const txt = await sheet.innerText();
    check(/YouTube の URL の形が違います/.test(txt) && (await sheet.locator('[data-hint-channel]').count()) === 0 && (await sheet.locator('[data-hint-kind]').count()) === 0, `(3) ${bad.slice(8, 40)} は「形が違います」で止まる`);
  }

  // (4) チャンネル名を聞けない動画（削除・非公開・埋め込み禁止）は使えない
  oembedMode = 'gone';
  await hint.fill('https://www.youtube.com/watch?v=abcdefghijk');
  await page.waitForTimeout(800);
  check(/この動画を確かめられませんでした/.test(await sheet.innerText()), '(4) チャンネル名を聞けない動画は「確かめられませんでした」で使えない');
  oembedMode = 'ok';

  // (5) 台帳の検索: 打った言葉を空白で区切り、題名かチャンネル名に全部の言葉を含む動画を新しい順に20件（2026-10-20 Hop「台帳の動画が見つからない」）
  await hint.fill('');
  await page.waitForTimeout(100);
  catalogAsks.length = 0;
  await hint.fill('武道館　ハロコン');
  await sheet.getByText('ハロコン 武道館 見本の動画 1', { exact: true }).waitFor({ timeout: 10000 }).catch(() => {});
  const ask = catalogAsks.at(-1);
  const ors = ask ? ask.searchParams.getAll('or') : [];
  check(ors.length === 2 && ors.some((o) => o.includes('title.ilike."%武道館%"') && o.includes('channel_name.ilike."%武道館%"')) && ors.some((o) => o.includes('title.ilike."%ハロコン%"') && o.includes('channel_name.ilike."%ハロコン%"')),
    `(5) 言葉ごとに「題名かチャンネル名に含む」を全部の言葉で重ねて頼む（全角の空白も区切り。${ors.join(' ／ ') || '頼んでいない'}）`);
  check(ask?.searchParams.get('limit') === '20' && ask?.searchParams.get('order') === 'published_at.desc' && ask?.searchParams.get('is_active_content') === 'eq.true', `(5) 表示してよい動画を新しい順に20件まで（limit=${ask?.searchParams.get('limit')}・order=${ask?.searchParams.get('order')}）`);
  const shown = await sheet.getByText(/^ハロコン 武道館 見本の動画 \d+$/).count();
  check(shown === 20, `(5) 結果は20件並ぶ（${shown}件）`);
  await sheet.screenshot({ path: path.join(OUT, '2-catalog-search-390.png') });
  // 結果の題名を押すと選ばれる
  await sheet.getByText('ハロコン 武道館 見本の動画 1', { exact: true }).click();
  await page.waitForTimeout(300);
  check((await sheet.locator('[data-hint-kind]').textContent().catch(() => null)) === 'YouTube', '(5) 結果の題名を押すとその動画がヒントになる');
  await closeHintSheet(page);
  check((await page.locator('[data-bulk-hint="on"]').count()) === 1, '(5) 窓を閉じると1の段の「ネコ」に ● が付く');

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
