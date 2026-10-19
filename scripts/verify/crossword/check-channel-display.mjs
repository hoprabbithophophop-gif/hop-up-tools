// YouTube のチャンネル名を問題に保存せず、見る人のブラウザがその都度聞く形（Hop 決定 2026-10-19「書き残さない形」）を、手元の開発サーバーで確かめる。
// 本番にもプレビューにも通信しない。手元の vite をこの台本が立ち上げ、棚（/rest/v1）・受付係（/api）・YouTube の oEmbed はブラウザの中で受け止める。
//   (1) ハロプロ: 台帳に無い動画は、開いた時に YouTube に聞いた名前が「チャンネル: …」で出る
//   (2) ハロプロ: 台帳にある動画は聞かず、チャンネル名も出ない
//   (3) ハロプロ: 台帳に無く YouTube にも聞けない動画は「見られなくなりました」
//   (4) その他: 台帳を見ずに聞き、チャンネル名が出る。聞けなくても「見られなくなりました」にはしない
//   (5) 作った問題の一覧: 台帳に無くても聞ける動画なら「見られなくなったヒント」は出ず、聞けなければ出る
// 使い方: node scripts/verify/crossword/check-channel-display.mjs（引数なし）
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { outDir, ROOT } from './_lib.mjs';

const PORT = 5196;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-channel-display');

let fail = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
  if (!ok) fail++;
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

// ---- 見本の問題。盤: バキ 横(0,0)・キクラ 縦(1,0)。横は台帳に無い動画、縦は台帳にある動画 ----
const OUTSIDE = 'outsideVid1';
const IN_CATALOG = 'inCatalog01';
const KEY = 'a'.repeat(64);
const puzzleRow = (id, genre) => ({
  id, title: 'チャンネル名の見本', genre, tags: [], created_at: '2026-10-19T00:00:00Z', play_count: 0, is_beginner: false, group_tags: [],
  body: {
    version: 1, width: 2, height: 3, creatorName: '台本',
    clues: [
      { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: 'ヨコの見本のカギ', length: 2, hint: { kind: 'youtube', videoId: OUTSIDE, startSec: 5 } },
      { clueIndex: 2, direction: 'vertical', startX: 1, startY: 0, clue: 'タテの見本のカギ', length: 3, hint: { kind: 'youtube', videoId: IN_CATALOG, startSec: 7 } },
    ],
  },
});
const ROWS = [puzzleRow('MOCKCHH1', 'hello'), puzzleRow('MOCKCHO1', 'other')];
const SEEN = { crossword_seen_help: 'true', crossword_seen_first_cell: '1', crossword_seen_tutorial: '1' };

const browser = await chromium.launch();
const pageErrors = [];

// oembed: 'ok' なら名前を返し、'gone' なら 401（削除・非公開・埋め込み禁止と同じ返事）
async function newPage({ oembed, marks = SEEN }) {
  const st = { oembedIds: [] };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((m) => {
    try {
      for (const [k, v] of Object.entries(m)) localStorage.setItem(k, v);
    } catch { /* 無視 */ }
  }, marks);
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const u = new URL(route.request().url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.endsWith('/rpc/crossword_is_hidden')) return json(false);
    const table = u.pathname.split('/').pop();
    let rows = [];
    if (table === 'crossword_puzzles') {
      rows = ROWS;
      const idEq = u.searchParams.get('id');
      if (idEq?.startsWith('eq.')) rows = rows.filter((r) => r.id === idEq.slice(3));
      const genreEq = u.searchParams.get('genre');
      if (genreEq?.startsWith('eq.')) rows = rows.filter((r) => r.genre === genreEq.slice(3));
    } else if (table === 'youtube_videos') {
      rows = [{ video_id: IN_CATALOG }];
    }
    if ((route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object')) return json(rows[0] ?? null);
    return json(rows);
  });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com|pagead2\.googlesyndication\.com)\//, (r) => r.fulfill({ status: 204, body: '' }));
  // 後に登録した route が先に当たるので、上の受け止めより後に置く
  await ctx.route(/^https:\/\/www\.youtube\.com\/oembed/, (r) => {
    const id = new URL(new URL(r.request().url()).searchParams.get('url')).searchParams.get('v');
    st.oembedIds.push(id);
    if (oembed === 'gone') return r.fulfill({ status: 401, body: 'Unauthorized' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ author_name: 'テストチャンネル', title: 'テストの動画' }) });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  return { ctx, page, st };
}

// マスを押して拡大カードを開き、「ヒント」を押した後のヒント欄の文字
async function hintText(page, x, y) {
  await page.locator(`#cell-${x}-${y}`).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'ヒント', exact: true }).first().click();
  await page.waitForTimeout(500);
  const ch = await page.locator('[data-hint-channel]').first().textContent({ timeout: 1000 }).catch(() => null);
  const goneShown = await page.getByText('このヒントの動画は見られなくなりました。').count();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return { ch, gone: goneShown > 0 };
}

async function openPuzzle(page, id) {
  await page.goto(`${BASE}/crossword/${id}`);
  await page.locator('#cell-0-0').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500); // 開いた後の台帳と YouTube への問い合わせを待つ
}

try {
  await startServer();

  // ---- (1)(2) ハロプロ・YouTube に聞ける ----
  {
    const { ctx, page, st } = await newPage({ oembed: 'ok' });
    await openPuzzle(page, 'MOCKCHH1');
    const a = await hintText(page, 0, 0);
    check(a.ch === 'チャンネル: テストチャンネル' && !a.gone, `(1) ハロプロ・台帳に無い動画はチャンネル名が出る（${a.ch}）`);
    await page.screenshot({ path: path.join(OUT, '1-hello-outside-390.png') });
    const b = await hintText(page, 1, 2);
    check(b.ch === null && !b.gone, `(2) ハロプロ・台帳にある動画はチャンネル名が出ない（${b.ch}）`);
    check(!st.oembedIds.includes(IN_CATALOG), `(2) 台帳にある動画は YouTube に聞かない（聞いた番号: ${st.oembedIds.join(',') || 'なし'}）`);
    await ctx.close();
  }

  // ---- (3) ハロプロ・YouTube に聞けない ----
  {
    const { ctx, page } = await newPage({ oembed: 'gone' });
    await openPuzzle(page, 'MOCKCHH1');
    const a = await hintText(page, 0, 0);
    check(a.gone && a.ch === null, `(3) ハロプロ・台帳に無く聞けない動画は「見られなくなりました」（gone=${a.gone} ch=${a.ch}）`);
    await page.screenshot({ path: path.join(OUT, '3-hello-gone-390.png') });
    await ctx.close();
  }

  // ---- (4) その他 ----
  {
    const { ctx, page, st } = await newPage({ oembed: 'ok' });
    await openPuzzle(page, 'MOCKCHO1');
    const a = await hintText(page, 0, 0);
    const b = await hintText(page, 1, 2);
    check(a.ch === 'チャンネル: テストチャンネル' && b.ch === 'チャンネル: テストチャンネル', `(4) その他は台帳を見ずにチャンネル名が出る（${a.ch} / ${b.ch}）`);
    check(st.oembedIds.includes(IN_CATALOG), '(4) その他は台帳にある動画も YouTube に聞く');
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage({ oembed: 'gone' });
    await openPuzzle(page, 'MOCKCHO1');
    const a = await hintText(page, 0, 0);
    check(!a.gone && a.ch === null, `(4) その他は聞けなくても「見られなくなりました」にしない（gone=${a.gone} ch=${a.ch}）`);
    await ctx.close();
  }

  // ---- (5) 作った問題の一覧 ----
  const mine = JSON.stringify([{ id: 'MOCKCHH1', key: KEY, title: 'チャンネル名の見本', createdAt: Date.now() }]);
  for (const [mode, expectGone] of [['ok', false], ['gone', true]]) {
    const { ctx, page } = await newPage({ oembed: mode, marks: { ...SEEN, crossword_my_puzzles: mine } });
    await page.goto(`${BASE}/crossword/mine`);
    await page.getByText('チャンネル名の見本').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const shown = (await page.getByText('見られなくなったヒントがあります。').count()) > 0;
    check(shown === expectGone, `(5) 一覧: YouTube に${mode === 'ok' ? '聞ける' : '聞けない'}時は「見られなくなったヒント」が${expectGone ? '出る' : '出ない'}（出た=${shown}）`);
    await page.screenshot({ path: path.join(OUT, `5-mine-${mode}-390.png`) });
    await ctx.close();
  }

  check(pageErrors.length === 0, `画面のつまずき（JS の例外）が無い${pageErrors.length ? `（${pageErrors[0].slice(0, 120)}）` : ''}`);
} catch (e) {
  console.log(`NG 台本が途中で止まった: ${String(e).slice(0, 300)}`);
  fail++;
} finally {
  await browser.close();
  stopServer();
}
console.log(fail === 0 ? 'すべてOK' : `NG ${fail} 件`);
console.log(`写真: ${OUT}`);
process.exit(fail === 0 ? 0 : 1);
