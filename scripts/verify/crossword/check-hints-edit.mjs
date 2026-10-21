// 「ヒントを直す」画面（/crossword/hints/<番号>。Hop 決定 2026-10-19）と、作る画面の「公式ブログを探す」を確かめる。
// 手元の vite を立ち上げ、棚（/rest/v1）・受付係（/api）はブラウザの中で受け止める（本番にもプレビューにも通信しない）。
// 差し替えた YouTube が台帳（youtube_videos）に無い時は、問い合わせずに選ばれ、送る中身に outside: true が入る（Hop 決定 2026-10-21）。
// ブラウザから YouTube の oEmbed（youtube.com/oembed）・googleapis.com・/api/crossword-video-info への通信が無いことも見る。
// 確かめるのはこの3つの宛先だけ。埋め込みの再生の読み込み（www.youtube.com・i.ytimg.com）と字の形の読み込み（fonts.googleapis.com）は範囲の外
// 使い方: node scripts/verify/crossword/check-hints-edit.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outDir } from './_lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { spawn, spawnSync } = await import('node:child_process');
const { chromium } = await import('playwright');

const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-hints-edit');
const PUZZLE_ID = 'abcdefgh';
const KEY = 'a'.repeat(64);

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

// 棚の問題（遊ばれた回数 3。2番のヒントが壊れたリンク）
const puzzle = {
  id: PUZZLE_ID, title: 'ヒント直しの試験', genre: 'hello', tags: [], is_beginner: false, group_tags: [], play_count: 3,
  body: { version: 1, width: 3, height: 2, clues: [
    { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: '一番目のカギ', length: 3, hint: { kind: 'youtube', videoId: 'inCatalog01', startSec: 83 } },
    { clueIndex: 2, direction: 'vertical', startX: 0, startY: 0, clue: '二番目のカギ', length: 2, hint: { kind: 'link', url: 'https://youtu.be/6Y2X6RxYnY' } },
  ] },
};
const answers = [['ア', 'イ', 'ウ'], ['ア', 'エ']];

const browser = await chromium.launch();
const pageErrors = [];
let updateCalls = [];
const asked = [];
const FORBIDDEN = /youtube\.com\/oembed|(?<!fonts\.)googleapis\.com|\/api\/crossword-video-info/;
try {
  await startServer();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(({ id, key }) => {
    try {
      for (const k of ['crossword_seen_tip_cross', 'crossword_seen_tip_move', 'crossword_seen_tip_saved', 'crossword_seen_create_guide']) localStorage.setItem(k, '1');
      // この端末で作った問題として合言葉を置く（自分が作った問題と同じ置き場）
      localStorage.setItem('crossword_my_puzzles', JSON.stringify([{ id, key, title: 'ヒント直しの試験', createdAt: Date.now() }]));
    } catch { /* 無視 */ }
  }, { id: PUZZLE_ID, key: KEY });
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const u = new URL(route.request().url());
    let body = [];
    if (u.pathname.endsWith('/rpc/crossword_is_hidden')) body = false;
    else if (u.pathname.endsWith('/crossword_puzzles')) body = [{ id: PUZZLE_ID, play_count: 3 }];
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: JSON.stringify(body) });
  });
  // 後に登録した route が先に当たるので、受付係全体の受け止めを先に、個別の受付係を後に置く
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await ctx.route('**/api/crossword-owner-get', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, puzzle, answers }) }));
  await ctx.route('**/api/crossword-update-hints', (r) => {
    updateCalls.push(r.request().postDataJSON());
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com)\//, (r) => r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('request', (req) => {
    if (FORBIDDEN.test(req.url())) asked.push(req.url());
  });

  // (1) 自分が作った問題: 遊ばれた問題に「ヒントを直す」
  await page.goto(`${BASE}/crossword/mine`);
  const fix = page.getByRole('link', { name: 'ヒントを直す' });
  await fix.waitFor({ timeout: 30000 });
  check((await page.getByRole('link', { name: '組み直す' }).count()) === 0, '(1) 遊ばれた問題には「組み直す」が無く「ヒントを直す」が出る');
  await fix.click();
  await page.waitForURL(`**/crossword/hints/${PUZZLE_ID}`);

  // (2) ヒントを直す画面: カギごとに今のヒント。ボタンは変えるまで押せない
  await page.locator('[data-hints-edit]').waitFor();
  await page.waitForTimeout(800);
  const rowsN = await page.locator('[data-hints-row]').count();
  check(rowsN === 2, `(2) カギが2行並ぶ（${rowsN}）${rowsN === 2 ? '' : ' 画面: ' + (await page.locator('[data-hints-edit]').innerText()).slice(0, 80)}`);
  const txt = await page.evaluate(() => document.body.innerText);
  check(/1\s*ヨコ\s*アイウ\s*一番目のカギ/.test(txt) && /2\s*タテ\s*アエ\s*二番目のカギ/.test(txt), '(2) 各行に 番号・向き・答え・カギの文');
  check(/YouTube 1:23/.test(txt) && /youtu\.be\/6Y2X6RxYnY/.test(txt), '(2) 今のヒントが選ばれた状態で出る');
  const btn = page.getByRole('button', { name: 'ヒントを更新する' });
  check(await btn.isDisabled() && /変えたヒントがありません/.test(txt), '(2) 変える前はボタンが押せず理由が出る');
  await page.screenshot({ path: path.join(OUT, '1-hints-edit-390.png'), fullPage: true });

  // (3) 2番のヒントを外して公式の動画に替える → 送るのは 2番だけ
  const row2 = page.locator('[data-hints-row="vertical:2"]');
  await row2.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  check(await btn.isDisabled() && /ヒントが未選択の語が 1 語あります/.test(await page.evaluate(() => document.body.innerText)), '(3) 外した直後は未選択 1 語で押せない');
  await row2.locator('input').first().fill('https://youtu.be/dQw4w9WgXcQ?t=5');
  await page.waitForTimeout(1000);
  check(await btn.isEnabled(), '(3) 差し替えるとボタンが押せる');
  const outsideTxt = await row2.locator('[data-hint-outside]').textContent().catch(() => null);
  check(outsideTxt === 'ハロプロのグループや事務所の公式チャンネルの動画か、確かめてください。', `(3) 台帳に無い動画は問い合わせずに選ばれ、1文が出る（${outsideTxt}）`);
  await btn.click();
  await page.waitForTimeout(500);
  check(updateCalls.length === 1 && Object.keys(updateCalls[0].hints).join() === 'vertical:2' && updateCalls[0].hints['vertical:2'].videoId === 'dQw4w9WgXcQ' && updateCalls[0].hints['vertical:2'].startSec === 5 && updateCalls[0].id === PUZZLE_ID && updateCalls[0].key === KEY, `(3) 受付係へは変えた 2番だけを送る（${JSON.stringify(updateCalls[0]?.hints)}）`);
  check(updateCalls.length === 1 && updateCalls[0].hints['vertical:2'].outside === true, `(3) 台帳に無い動画には outside: true を付けて送る（${JSON.stringify(updateCalls[0]?.hints['vertical:2'])}）`);
  check(updateCalls.length === 1 && !('channel' in (updateCalls[0].hints['vertical:2'] ?? {})), '(3) チャンネル名は送らない');
  await page.waitForTimeout(300);
  check(/ヒントを更新しました/.test(await page.evaluate(() => document.body.innerText)), '(3) 「ヒントを更新しました」');
  check(await btn.isDisabled(), '(3) 更新後はまた「変えたヒントがありません」で押せない');

  // (4) 組み直し（?edit=）に遊ばれた問題で入ると、この画面へ回る
  await page.goto(`${BASE}/crossword/create?edit=${PUZZLE_ID}`);
  await page.waitForURL(`**/crossword/hints/${PUZZLE_ID}`, { timeout: 30000 }).catch(() => {});
  check(page.url().endsWith(`/crossword/hints/${PUZZLE_ID}`), `(4) 遊ばれた問題の組み直しは「ヒントを直す」へ回る（${page.url()}）`);

  // (5) 作る画面の「公式ブログを探す」（ハロプロだけ。言葉が空なら押せない。Google の site: 検索を新しいタブで）
  await page.goto(`${BASE}/crossword/create`);
  await page.locator('#cw-hint').waitFor({ timeout: 30000 });
  await page.getByText('ハロプロ', { exact: true }).first().click();
  await page.waitForTimeout(300);
  const blog = page.locator('[data-blog-search]');
  check((await blog.count()) === 1, '(5) ハロプロのヒント欄の下に「公式ブログを探す」');
  const link = blog.locator('a');
  check((await link.getAttribute('aria-disabled')) === 'true', '(5) 言葉が空の間は押せない');
  await blog.locator('select').selectOption('beyooooonds');
  await blog.locator('input').fill('武道館');
  await page.waitForTimeout(100);
  const href = await link.getAttribute('href');
  const q = href ? decodeURIComponent(new URL(href).searchParams.get('q')) : '';
  check(href?.startsWith('https://www.google.com/search?q=') && q.includes('武道館') && q.includes('site:ameblo.jp/beyooooonds') && q.includes('site:ameblo.jp/beyooooonds-rfro') && !q.includes('inurl:') && (await link.getAttribute('target')) === '_blank', `(5) Google の site: 検索の住所になる（${q}）`);
  await page.getByText('その他', { exact: true }).first().click();
  await page.waitForTimeout(300);
  check((await page.locator('[data-blog-search]').count()) === 0, '(5) その他では出ない');
  await page.getByText('ハロプロ', { exact: true }).first().click();
  await page.waitForTimeout(300);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(wide, '(5) 390px で横にはみ出さない');
  await page.locator('[data-coach="create-hint"]').screenshot({ path: path.join(OUT, '2-blog-search-390.png') });

  check(asked.length === 0, `(6) oEmbed・googleapis.com・/api/crossword-video-info への通信が無い${asked.length ? `（${asked[0]}）` : ''}`);
  check(pageErrors.length === 0, `(6) 画面のつまずき（JS の例外）が無い${pageErrors.length ? '：' + pageErrors.join(' / ') : ''}`);
  console.log(`写真: ${OUT}`);
} finally {
  await browser.close();
  stopServer();
}
console.log(fails === 0 ? 'すべてOK' : `NG ${fails} 件`);
process.exit(fails === 0 ? 0 : 1);
