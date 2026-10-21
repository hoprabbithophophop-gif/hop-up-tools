// 作る画面のヒントの窓（1の段で下線の語を押すと下から出る。4段の流れ・2026-10-20）で、台帳（youtube_videos）に無い YouTube を問い合わせずにそのまま通す動き（Hop 決定 2026-10-21）と、
// 形の崩れた YouTube の住所をリンクとして通さない抜け穴ふさぎ、台帳の検索（言葉を空白で区切って全部含む・題名とチャンネル名・新しい順に20件）を確かめる。
// 台本の名前は前の作り（チャンネル名を出す）の名残。今はチャンネル名を出さず、動画のことを YouTube にもどこにも問い合わせない。
// 台帳の確かめと検索は本番の棚を読まず、作り物の返事に差し替える（棚に送る住所だけを見る）。
// 手元の vite を立ち上げ、棚（/rest/v1）・受付係（/api）・人間確認（Turnstile）はブラウザの中で受け止める（本番にもプレビューにも通信しない）。
//   (1) ヒントの窓の頭に「ヒントは答えの根拠です。」と公式の発信の案内
//   (2) 台帳に無い動画を貼ると選ばれ、「ハロプロのグループや事務所の公式チャンネルの動画か、確かめてください。」が出る。チャンネル名は出ない
//   (3) 台帳を確かめられなかった時も同じ（outside の側に倒す）
//   (4) 台帳にある動画を貼ると、その1文は出ない
//   (5) 形の崩れた YouTube の住所は「形が違います」で止まる
//   (6) 台帳の検索（言葉ごとに題名かチャンネル名に含む・新しい順に20件）。結果を押すとその動画がヒントになる
//   (7) 390px で横にはみ出さない
//   (8) 4段の流れで共有すると、保存の送信の中身で台帳に無い動画に outside: true が入り、台帳にある動画には入らない
//   (9) ブラウザから YouTube の oEmbed（youtube.com/oembed）・googleapis.com・/api/crossword-video-info への通信が1本も無い。
//       確かめるのはこの3つの宛先だけ。埋め込みの再生の読み込み（www.youtube.com・i.ytimg.com）は範囲の外で、この台本では中身の無い返事で受け止める。
//       googleapis.com のうち字の形の読み込み（fonts.googleapis.com）も動画と関係ないので外す
// 使い方: node scripts/verify/crossword/check-hint-channel.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outDir, watchStumbles } from './_lib.mjs';
import { writeLines, openHintSheet, closeHintSheet, toBoard, toClues, clueInput, clueKeys, openShare } from './_create.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { spawn, spawnSync } = await import('node:child_process');
const { chromium } = await import('playwright');

const PORT = 5198;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-hint-channel');
const OUTSIDE_SENTENCE = 'ハロプロのグループや事務所の公式チャンネルの動画か、確かめてください。';
const IN_CATALOG = 'inCatalog01'; // 台帳にある動画
const FAIL_CHECK = 'failCheck01'; // 台帳の確かめが失敗する動画
const FORBIDDEN = /youtube\.com\/oembed|(?<!fonts\.)googleapis\.com|\/api\/crossword-video-info/;

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

// 台帳の確かめの作り物。video_id=eq.<番号>（1本の確かめ。件数を content-range で返す）と video_id=in.(...)（保存の直前のまとめての確かめ）に答える
function catalogReply(u) {
  const v = u.searchParams.get('video_id') ?? '';
  const ids = v.startsWith('eq.') ? [v.slice(3)] : v.startsWith('in.(') ? v.slice(4, -1).split(',') : [];
  if (ids.includes(FAIL_CHECK)) return { status: 500, rows: { message: 'mock failure' } };
  return { status: 200, rows: ids.filter((id) => id === IN_CATALOG).map((video_id) => ({ video_id })) };
}

const browser = await chromium.launch();
const pageErrors = [];
const asked = [];
const saves = [];
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
  // 棚は作り物で答える。台帳の検索（題名を読む）は catalogRows を返し、台帳の確かめ（番号で引く）は catalogReply で答える
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/rpc/crossword_is_hidden')) return route.fulfill({ status: 200, contentType: 'application/json', body: 'false' });
    if (u.pathname.endsWith('/youtube_videos') && (u.searchParams.get('select') || '').includes('title')) {
      catalogAsks.push(u);
      const body = catalogRows.slice(0, Number(u.searchParams.get('limit') || catalogRows.length));
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: JSON.stringify(body) });
    }
    if (u.pathname.endsWith('/youtube_videos')) {
      const { status, rows } = catalogReply(u);
      const n = Array.isArray(rows) ? rows.length : 0;
      return route.fulfill({ status, contentType: 'application/json', headers: { 'content-range': n ? `0-${n - 1}/${n}` : '*/0', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, body: JSON.stringify(rows) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: '[]' });
  });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|www\.youtube-nocookie\.com|challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com|pagead2\.googlesyndication\.com)\//, (r) => r.fulfill({ status: 204, body: '' }));
  // 後に登録した route が先に当たるので、上の受け止めより後に置く
  await ctx.route('https://challenges.cloudflare.com/turnstile/**', (r) =>
    r.fulfill({ contentType: 'application/javascript', body: 'window.turnstile={render:function(el,o){setTimeout(function(){o.callback("check-hint-channel")},50);return "w"},remove:function(){},reset:function(){}};' }),
  );
  await ctx.route('**/api/crossword-save', (route) => {
    saves.push(JSON.parse(route.request().postData() || '{}'));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'LocalHC1' }) });
  });
  const page = await ctx.newPage();
  await watchStumbles(page, pageErrors);
  page.on('request', (req) => {
    if (FORBIDDEN.test(req.url())) asked.push(req.url());
  });

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

  // (2) 台帳に無い YouTube → 問い合わせずに選ばれ、1文が出る
  await hint.fill('https://youtu.be/dQw4w9WgXcQ?t=83');
  await page.waitForTimeout(800);
  const out1 = await sheet.locator('[data-hint-outside]').textContent().catch(() => null);
  check(out1 === OUTSIDE_SENTENCE, `(2) 台帳に無い動画は選ばれ、1文が出る（${out1}）`);
  const timeVal = await sheet.locator('#cw-hint-time').inputValue().catch(() => null);
  check(timeVal === '1:23', `(2) URL の時刻が欄に入る（${timeVal}）`);
  check((await sheet.getByText(/チャンネル:/).count()) === 0, '(2) チャンネル名は出ない');
  await sheet.screenshot({ path: path.join(OUT, '1-hello-outside-390.png') });

  // (3) 台帳を確かめられなかった時も outside の側
  await sheet.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  await hint.fill(`https://www.youtube.com/watch?v=${FAIL_CHECK}`);
  await page.waitForTimeout(800);
  const out2 = await sheet.locator('[data-hint-outside]').textContent().catch(() => null);
  check(out2 === OUTSIDE_SENTENCE, `(3) 台帳を確かめられなかった時も選ばれ、1文が出る（${out2}）`);

  // (4) 台帳にある動画 → 1文は出ない
  await sheet.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  await hint.fill(`https://youtu.be/${IN_CATALOG}`);
  await page.waitForTimeout(800);
  const pickedIn = (await sheet.getByLabel('ヒントを外す').count()) > 0;
  check(pickedIn && (await sheet.locator('[data-hint-outside]').count()) === 0, `(4) 台帳にある動画は選ばれ、1文は出ない（選ばれた=${pickedIn}）`);

  // (5) 形の崩れた YouTube の住所はリンクとして通さない
  await sheet.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  for (const bad of ['https://youtu.be/6Y2X6RxYnY', 'https://youtu.be/u_O3AYOdDr4si=8rMwkOOc4zhUkddH']) {
    await hint.fill(bad);
    await page.waitForTimeout(400);
    const txt = await sheet.innerText();
    check(/YouTube の URL の形が違います/.test(txt) && (await sheet.locator('[data-hint-outside]').count()) === 0 && (await sheet.locator('[data-hint-kind]').count()) === 0, `(5) ${bad.slice(8, 40)} は「形が違います」で止まる`);
  }

  // (6) 台帳の検索: 打った言葉を空白で区切り、題名かチャンネル名に全部の言葉を含む動画を新しい順に20件（2026-10-20 Hop「台帳の動画が見つからない」）
  await hint.fill('');
  await page.waitForTimeout(100);
  catalogAsks.length = 0;
  await hint.fill('武道館　ハロコン');
  await sheet.getByText('ハロコン 武道館 見本の動画 1', { exact: true }).waitFor({ timeout: 10000 }).catch(() => {});
  const ask = catalogAsks.at(-1);
  const ors = ask ? ask.searchParams.getAll('or') : [];
  check(ors.length === 2 && ors.some((o) => o.includes('title.ilike."%武道館%"') && o.includes('channel_name.ilike."%武道館%"')) && ors.some((o) => o.includes('title.ilike."%ハロコン%"') && o.includes('channel_name.ilike."%ハロコン%"')),
    `(6) 言葉ごとに「題名かチャンネル名に含む」を全部の言葉で重ねて頼む（全角の空白も区切り。${ors.join(' ／ ') || '頼んでいない'}）`);
  check(ask?.searchParams.get('limit') === '20' && ask?.searchParams.get('order') === 'published_at.desc' && ask?.searchParams.get('is_active_content') === 'eq.true', `(6) 表示してよい動画を新しい順に20件まで（limit=${ask?.searchParams.get('limit')}・order=${ask?.searchParams.get('order')}）`);
  const shown = await sheet.getByText(/^ハロコン 武道館 見本の動画 \d+$/).count();
  check(shown === 20, `(6) 結果は20件並ぶ（${shown}件）`);
  await sheet.screenshot({ path: path.join(OUT, '2-catalog-search-390.png') });
  // 結果の題名を押すと選ばれる
  await sheet.getByText('ハロコン 武道館 見本の動画 1', { exact: true }).click();
  await page.waitForTimeout(300);
  check((await sheet.locator('[data-hint-kind]').textContent().catch(() => null)) === 'YouTube', '(6) 結果の題名を押すとその動画がヒントになる');
  await closeHintSheet(page);
  check((await page.locator('[data-bulk-hint="on"]').count()) === 1, '(6) 窓を閉じると1の段の「ネコ」に ● が付く');

  // (7) 390px で横にはみ出さない
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(wide, '(7) 390px で横にはみ出さない');

  // (8) 4段の流れで共有し、保存の送信の中身を見る（ネコ は台帳に無い動画・コアラ は台帳にある動画。2語は「コ」で交わる）
  await openHintSheet(page, 'コアラ');
  await sheet.locator('#cw-hint').fill(`https://youtu.be/${IN_CATALOG}?t=7`);
  await sheet.locator('[data-hint-kind]').waitFor({ timeout: 10000 });
  await closeHintSheet(page);
  await openHintSheet(page, 'ネコ');
  await sheet.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  await sheet.locator('#cw-hint').fill('https://youtu.be/dQw4w9WgXcQ?t=5');
  await sheet.locator('[data-hint-outside]').waitFor({ timeout: 10000 });
  await closeHintSheet(page);
  await toBoard(page);
  await toClues(page);
  for (const k of await clueKeys(page)) await clueInput(page, k).fill(`${k}のカギ`);
  await openShare(page);
  await page.locator('#cw-title').fill('outside の印の試験');
  await page.locator('[data-share-sheet] [data-save]').click();
  for (let i = 0; i < 80 && saves.length === 0; i++) await page.waitForTimeout(250);
  const clues = saves[0]?.puzzle?.body?.clues ?? [];
  const yt = (id) => clues.find((c) => c.hint?.kind === 'youtube' && c.hint.videoId === id)?.hint;
  const hOut = yt('dQw4w9WgXcQ');
  const hIn = yt(IN_CATALOG);
  check(saves.length === 1 && saves[0]?.puzzle?.genre === 'hello', `(8) ハロプロの問題として保存の送信が1本出た（${saves.length}本）`);
  check(hOut?.outside === true && hOut.startSec === 5, `(8) 台帳に無い動画のヒントに outside: true（${JSON.stringify(hOut)}）`);
  check(hIn && !('outside' in hIn), `(8) 台帳にある動画のヒントには outside が無い（${JSON.stringify(hIn)}）`);
  check(clues.every((c) => !('channel' in (c.hint ?? {}))), '(8) チャンネル名は送らない');

  check(asked.length === 0, `(9) oEmbed・googleapis.com・/api/crossword-video-info への通信が無い${asked.length ? `（${asked[0]}）` : ''}`);
  check(pageErrors.length === 0, `(10) 画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）が無い${pageErrors.length ? '：' + pageErrors.join(' / ') : ''}`);
  console.log(`写真: ${OUT}`);
} catch (e) {
  console.log(`NG 台本が途中で止まった: ${String(e).slice(0, 300)}`);
  fails++;
} finally {
  await browser.close();
  stopServer();
}
console.log(fails === 0 ? 'すべてOK' : `NG ${fails} 件`);
process.exit(fails === 0 ? 0 : 1);
