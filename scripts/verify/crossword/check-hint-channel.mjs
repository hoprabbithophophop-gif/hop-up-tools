// 作る画面の「ヒント」欄で、台帳（youtube_videos）に無い YouTube を問い合わせずにそのまま通す動き（Hop 決定 2026-10-21）と、
// 形の崩れた YouTube の住所をリンクとして通さない抜け穴ふさぎを確かめる。
// 台本の名前は前の作り（チャンネル名を出す）の名残。今はチャンネル名を出さず、動画のことを YouTube にもどこにも問い合わせない。
// 手元の vite を立ち上げ、棚（/rest/v1）・受付係（/api）・人間確認（Turnstile）はブラウザの中で受け止める（本番にもプレビューにも通信しない）。
//   (1) ハロプロのヒント欄に公式の発信の案内
//   (2) ハロプロで台帳に無い動画を貼ると選ばれ、「ハロプロのグループや事務所の公式チャンネルの動画か、確かめてください。」が出る
//   (3) ハロプロで台帳を確かめられなかった時も同じ（outside の側に倒す）
//   (4) ハロプロで台帳にある動画を貼ると、その1文は出ない
//   (5) 形の崩れた YouTube の住所は「形が違います」で止まる
//   (6) その他では台帳に無い動画でも1文は出ない
//   (7) ハロプロで共有すると、保存の送信の中身で台帳に無い動画に outside: true が入り、台帳にある動画には入らない
//   (8) ブラウザから YouTube の oEmbed（youtube.com/oembed）・googleapis.com・/api/crossword-video-info への通信が1本も無い。
//       確かめるのはこの3つの宛先だけ。埋め込みの再生の読み込み（www.youtube.com・i.ytimg.com）は範囲の外で、この台本では中身の無い返事で受け止める。
//       googleapis.com のうち字の形の読み込み（fonts.googleapis.com）も動画と関係ないので外す
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

// 台帳の作り物。video_id=eq.<番号>（1本の確かめ。件数を content-range で返す）と video_id=in.(...)（保存の直前のまとめての確かめ）に答える
function catalogReply(u) {
  const v = u.searchParams.get('video_id') ?? '';
  const ids = v.startsWith('eq.') ? [v.slice(3)] : v.startsWith('in.(') ? v.slice(4, -1).split(',') : [];
  if (ids.includes(FAIL_CHECK)) return { status: 500, rows: { message: 'mock failure' } };
  return { status: 200, rows: ids.filter((id) => id === IN_CATALOG).map((video_id) => ({ video_id })) };
}

const fieldByLabel = (page, label) => label === 'ヒント'
  ? page.getByPlaceholder(/URL を貼る/).first()
  : page.locator('xpath=//label[contains(normalize-space(.), "' + label + '")]/following-sibling::*[1]/descendant-or-self::input').first();

const browser = await chromium.launch();
const pageErrors = [];
const asked = [];
const saves = [];
try {
  await startServer();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try {
      for (const k of ['crossword_seen_tip_cross', 'crossword_seen_tip_move', 'crossword_seen_tip_saved', 'crossword_seen_create_guide']) localStorage.setItem(k, '1');
    } catch { /* 無視 */ }
  });
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/rpc/crossword_is_hidden')) return route.fulfill({ status: 200, contentType: 'application/json', body: 'false' });
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
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('request', (req) => {
    if (FORBIDDEN.test(req.url())) asked.push(req.url());
  });

  await page.goto(`${BASE}/crossword/create`);
  const hint = page.locator('#cw-hint');
  await hint.waitFor({ timeout: 30000 });
  await page.getByText('ハロプロ', { exact: true }).first().click();
  await page.waitForTimeout(300);

  // (1) ハロプロのヒント欄に公式の発信の案内
  const guide = await page.locator('[data-hint-guide]').textContent().catch(() => null);
  check(guide && guide.startsWith('ヒントはハロプロの公式の発信'), `(1) ハロプロのヒント欄に案内（${guide && guide.slice(0, 20)}…）`);

  // (2) 台帳に無い YouTube → 問い合わせずに選ばれ、1文が出る
  await hint.fill('https://youtu.be/dQw4w9WgXcQ?t=83');
  await page.waitForTimeout(800);
  const out1 = await page.locator('[data-hint-outside]').textContent().catch(() => null);
  check(out1 === OUTSIDE_SENTENCE, `(2) ハロプロで台帳に無い動画は選ばれ、1文が出る（${out1}）`);
  const timeVal = await page.locator('#cw-hint-time').inputValue().catch(() => null);
  check(timeVal === '1:23', `(2) URL の時刻が欄に入る（${timeVal}）`);
  check((await page.getByText(/チャンネル:/).count()) === 0, '(2) チャンネル名は出ない');
  await page.locator('[data-coach="create-hint"]').screenshot({ path: path.join(OUT, '1-hello-outside-390.png') });

  // (3) 台帳を確かめられなかった時も outside の側
  await page.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  await hint.fill(`https://www.youtube.com/watch?v=${FAIL_CHECK}`);
  await page.waitForTimeout(800);
  const out2 = await page.locator('[data-hint-outside]').textContent().catch(() => null);
  check(out2 === OUTSIDE_SENTENCE, `(3) 台帳を確かめられなかった時も選ばれ、1文が出る（${out2}）`);

  // (4) 台帳にある動画 → 1文は出ない
  await page.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  await hint.fill(`https://youtu.be/${IN_CATALOG}`);
  await page.waitForTimeout(800);
  const pickedIn = (await page.getByLabel('ヒントを外す').count()) > 0;
  check(pickedIn && (await page.locator('[data-hint-outside]').count()) === 0, `(4) 台帳にある動画は選ばれ、1文は出ない（選ばれた=${pickedIn}）`);

  // (5) 形の崩れた YouTube の住所はリンクとして通さない
  await page.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  for (const bad of ['https://youtu.be/6Y2X6RxYnY', 'https://youtu.be/u_O3AYOdDr4si=8rMwkOOc4zhUkddH']) {
    await hint.fill(bad);
    await page.waitForTimeout(400);
    const txt = await page.evaluate(() => document.body.innerText);
    check(/YouTube の URL の形が違います/.test(txt) && (await page.locator('[data-hint-outside]').count()) === 0 && !/^リンク$/m.test(txt), `(5) ${bad.slice(8, 40)} は「形が違います」で止まる`);
  }

  // (6) その他: 案内は無し。台帳に無い動画でも1文は出ない
  await page.getByText('その他', { exact: true }).first().click();
  await page.waitForTimeout(500);
  check((await page.locator('[data-hint-guide]').count()) === 0, '(6) その他のヒント欄に案内は出ない');
  await hint.fill('https://youtu.be/dQw4w9WgXcQ');
  await page.waitForTimeout(800);
  const pickedOther = (await page.getByLabel('ヒントを外す').count()) > 0;
  check(pickedOther && (await page.locator('[data-hint-outside]').count()) === 0, `(6) その他では選ばれ、1文は出ない（選ばれた=${pickedOther}）`);
  await page.locator('[data-coach="create-hint"]').screenshot({ path: path.join(OUT, '2-other-390.png') });

  // 390px で横にはみ出さない
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(wide, '390px で横にはみ出さない');

  // (7) ハロプロで2語を作って共有し、保存の送信の中身を見る（かき・きく は「き」で交わる）
  await page.getByText('ハロプロ', { exact: true }).first().click();
  await page.waitForTimeout(500);
  await fieldByLabel(page, '題名').fill('outside の印の試験');
  for (const w of [{ a: 'かき', clue: '秋に実る橙色の果物', hint: 'https://youtu.be/dQw4w9WgXcQ?t=5' }, { a: 'きく', clue: '秋に咲く花', hint: `https://youtu.be/${IN_CATALOG}?t=7` }]) {
    await fieldByLabel(page, '答え').fill(w.a);
    await fieldByLabel(page, 'カギ').fill(w.clue);
    await fieldByLabel(page, 'ヒント').fill(w.hint);
    await page.getByLabel('ヒントを外す').first().waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'リストに追加', exact: false }).first().click();
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(6500); // 組み立てが終わるのを待つ
  await page.getByRole('button', { name: '共有する', exact: false }).first().click();
  for (let i = 0; i < 40 && saves.length === 0; i++) await page.waitForTimeout(250);
  const clues = saves[0]?.puzzle?.body?.clues ?? [];
  const yt = (id) => clues.find((c) => c.hint?.kind === 'youtube' && c.hint.videoId === id)?.hint;
  const hOut = yt('dQw4w9WgXcQ');
  const hIn = yt(IN_CATALOG);
  check(saves.length === 1 && saves[0]?.puzzle?.genre === 'hello', `(7) ハロプロの問題として保存の送信が1本出た（${saves.length}本）`);
  check(hOut?.outside === true, `(7) 台帳に無い動画のヒントに outside: true（${JSON.stringify(hOut)}）`);
  check(hIn && !('outside' in hIn), `(7) 台帳にある動画のヒントには outside が無い（${JSON.stringify(hIn)}）`);
  check(clues.every((c) => !('channel' in (c.hint ?? {}))), '(7) チャンネル名は送らない');

  check(asked.length === 0, `(8) oEmbed・googleapis.com・/api/crossword-video-info への通信が無い${asked.length ? `（${asked[0]}）` : ''}`);
  check(pageErrors.length === 0, `画面のつまずき（JS の例外）が無い${pageErrors.length ? '：' + pageErrors.join(' / ') : ''}`);
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
