// 解く画面と自分の問題の一覧で、ヒントの YouTube 動画に「見られなくなりました」を付ける決め方（Hop 決定 2026-10-04・2026-10-21）を、手元の開発サーバーで確かめる。
// 台本の名前は前の作り（チャンネル名を出す）の名残。今はチャンネル名をどこにも出さず、動画のことを YouTube にもどこにも問い合わせない（Hop 決定 2026-10-21）。
// 本番にもプレビューにも通信しない。手元の vite をこの台本が立ち上げ、棚（/rest/v1）・受付係（/api）はブラウザの中で受け止める。
//   (1) ハロプロ: 保存の時点で台帳に無かった印（outside: true）の動画は、台帳に無くても「見られなくなりました」にしない
//   (2) ハロプロ: 印の無い動画が台帳に無い（消えた）時は「見られなくなりました」
//   (3) ハロプロ: 台帳にある動画はそのまま
//   (4) その他: 台帳に無くても印を付けない
//   (5) 自分の問題の一覧: 印の無い消えた動画がある問題だけ「見られなくなったヒントがあります。」。outside の動画と台帳の動画だけの問題には出ない
//   (6) チャンネル名の札（「チャンネル:」）がどこにも出ない
//   (7) ブラウザから YouTube の oEmbed（youtube.com/oembed）・googleapis.com・/api/crossword-video-info への通信が1本も無い。
//       確かめるのはこの3つの宛先だけ。埋め込みの再生の読み込み（www.youtube.com・i.ytimg.com）は範囲の外で、この台本では中身の無い返事で受け止める。
//       googleapis.com のうち字の形の読み込み（fonts.googleapis.com）も動画と関係ないので外す
// 使い方: node scripts/verify/crossword/check-channel-display.mjs（引数なし）
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { outDir, ROOT, watchStumbles, isolatedViteConfig } from './_lib.mjs';

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

// ---- 見本の問題。盤: バキ 横(0,0)・キクラ 縦(1,0) ----
const OUTSIDE = 'outsideVid1'; // 台帳に無い。保存の時点で outside の印が付いた
const GONE = 'goneVideo01'; // 台帳に無い。印が無い＝台帳から消えた動画
const IN_CATALOG = 'inCatalog01'; // 台帳にある
const KEY = 'a'.repeat(64);
const puzzleRow = (id, genre, title, vertical) => ({
  id, title, genre, tags: [], created_at: '2026-10-19T00:00:00Z', play_count: 0, is_beginner: false, group_tags: [],
  body: {
    version: 1, width: 2, height: 3, creatorName: '台本',
    clues: [
      { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: 'ヨコの見本のカギ', length: 2, hint: { kind: 'youtube', videoId: OUTSIDE, startSec: 5, outside: true } },
      { clueIndex: 2, direction: 'vertical', startX: 1, startY: 0, clue: 'タテの見本のカギ', length: 3, hint: vertical },
    ],
  },
});
const ROWS = [
  puzzleRow('MOCKCHH1', 'hello', '消えた動画のある見本', { kind: 'youtube', videoId: GONE, startSec: 7 }),
  puzzleRow('MOCKCHH2', 'hello', '台帳の動画の見本', { kind: 'youtube', videoId: IN_CATALOG, startSec: 7 }),
  puzzleRow('MOCKCHO1', 'other', 'その他の見本', { kind: 'youtube', videoId: GONE, startSec: 7 }),
];
const SEEN = { crossword_seen_help: 'true', crossword_seen_first_cell: '1', crossword_seen_tutorial: '1' };

const browser = await chromium.launch();
const pageErrors = [];
const asked = []; // 問い合わせてはいけない宛先への通信
const FORBIDDEN = /youtube\.com\/oembed|(?<!fonts\.)googleapis\.com|\/api\/crossword-video-info/;

async function newPage({ marks = SEEN } = {}) {
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
      if (idEq?.startsWith('in.(')) rows = rows.filter((r) => idEq.slice(4, -1).split(',').includes(r.id));
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
  const page = await ctx.newPage();
  await watchStumbles(page, pageErrors); // JS の例外・React の描画の誤り・エラー時の画面（2026-10-21。前は JS の例外だけ）
  page.on('request', (req) => {
    if (FORBIDDEN.test(req.url())) asked.push(req.url());
  });
  return { ctx, page };
}

// マスを押して拡大カードを開き、「ヒント」を押した後のヒント欄
async function hintText(page, x, y) {
  await page.locator(`#cell-${x}-${y}`).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'ヒント', exact: true }).first().click();
  await page.waitForTimeout(500);
  const goneShown = await page.getByText('このヒントの動画は見られなくなりました。').count();
  const channelShown = (await page.locator('[data-hint-channel]').count()) + (await page.getByText(/チャンネル:/).count());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return { gone: goneShown > 0, channel: channelShown > 0 };
}

async function openPuzzle(page, id) {
  await page.goto(`${BASE}/crossword/${id}`);
  await page.locator('#cell-0-0').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500); // 開いた後の台帳の確かめを待つ
}

try {
  await startServer();
  let channelSeen = false;

  // ---- (1)(2) ハロプロ・消えた動画のある問題 ----
  {
    const { ctx, page } = await newPage();
    await openPuzzle(page, 'MOCKCHH1');
    const a = await hintText(page, 0, 0);
    check(!a.gone, `(1) ハロプロ・outside の印のある台帳に無い動画は「見られなくなりました」にしない（gone=${a.gone}）`);
    await page.screenshot({ path: path.join(OUT, '1-hello-outside-390.png') });
    const b = await hintText(page, 1, 2);
    check(b.gone, `(2) ハロプロ・印の無い台帳に無い動画は「見られなくなりました」（gone=${b.gone}）`);
    channelSeen ||= a.channel || b.channel;
    await ctx.close();
  }

  // ---- (3) ハロプロ・台帳にある動画 ----
  {
    const { ctx, page } = await newPage();
    await openPuzzle(page, 'MOCKCHH2');
    const a = await hintText(page, 0, 0);
    const b = await hintText(page, 1, 2);
    check(!a.gone && !b.gone, `(3) ハロプロ・台帳にある動画と outside の動画はそのまま（gone=${a.gone}/${b.gone}）`);
    channelSeen ||= a.channel || b.channel;
    await ctx.close();
  }

  // ---- (4) その他 ----
  {
    const { ctx, page } = await newPage();
    await openPuzzle(page, 'MOCKCHO1');
    const a = await hintText(page, 0, 0);
    const b = await hintText(page, 1, 2);
    check(!a.gone && !b.gone, `(4) その他は台帳に無くても「見られなくなりました」にしない（gone=${a.gone}/${b.gone}）`);
    channelSeen ||= a.channel || b.channel;
    await ctx.close();
  }

  // ---- (5) 自分の問題の一覧 ----
  for (const [id, title, expectGone] of [['MOCKCHH1', '消えた動画のある見本', true], ['MOCKCHH2', '台帳の動画の見本', false]]) {
    const mine = JSON.stringify([{ id, key: KEY, title, createdAt: Date.now() }]);
    const { ctx, page } = await newPage({ marks: { ...SEEN, crossword_my_puzzles: mine } });
    await page.goto(`${BASE}/crossword/mine`);
    await page.getByText(title).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const shown = (await page.getByText('見られなくなったヒントがあります。').count()) > 0;
    check(shown === expectGone, `(5) 一覧: 「${title}」は「見られなくなったヒント」が${expectGone ? '出る' : '出ない'}（出た=${shown}）`);
    channelSeen ||= (await page.getByText(/チャンネル:/).count()) > 0;
    await page.screenshot({ path: path.join(OUT, `5-mine-${id}-390.png`), timeout: 10000 }).catch(() => console.log(`   写真を撮れなかった: 5-mine-${id}`)); // 写真は確かめの項目ではないので、撮れなくても続ける
    await ctx.close();
  }

  check(!channelSeen, '(6) チャンネル名の札がどこにも出ない');
  check(asked.length === 0, `(7) oEmbed・googleapis.com・/api/crossword-video-info への通信が無い${asked.length ? `（${asked[0]}）` : ''}`);
  check(pageErrors.length === 0, `画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）が無い${pageErrors.length ? `（${pageErrors[0].slice(0, 120)}）` : ''}`);
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
