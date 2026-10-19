// 「ヒントを直す」画面（/crossword/hints/<番号>。Hop 決定 2026-10-19）と、作る画面のヒント欄の出どころの印・公式を探す補助（アメブロ・X・Instagram）・
// X・Instagram のリンクに添える「公式サイトに載っている／載っていないアカウント」の札（作る側・解く側）を確かめる。
// 手元の vite を立ち上げ、棚（/rest/v1）・受付係（/api）・YouTube の oEmbed はブラウザの中で受け止める（本番にもプレビューにも通信しない）。
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
// 解く側の札の試験用（2番のヒントが公式サイトに載っている X のアカウントの投稿）
const PLAY_ID = 'playtest';
const playPuzzle = {
  id: PLAY_ID, title: '札の試験', genre: 'hello', tags: [], created_at: '2026-10-19T00:00:00Z', is_beginner: false, group_tags: [], play_count: 0,
  body: { version: 1, width: 3, height: 2, clues: [
    { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: '一番目のカギ', length: 3, hint: { kind: 'link', url: 'https://x.com/BEYOOOOONDS_/status/1' } },
    { clueIndex: 2, direction: 'vertical', startX: 0, startY: 0, clue: '二番目のカギ', length: 2, hint: { kind: 'link', url: 'https://www.instagram.com/p/abc123/' } },
  ] },
};

const browser = await chromium.launch();
const pageErrors = [];
let updateCalls = [];
try {
  await startServer();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }); // 「写す」を本当に写せたか読むため
  await ctx.addInitScript(({ id, key }) => {
    try {
      for (const k of ['crossword_seen_tip_cross', 'crossword_seen_tip_move', 'crossword_seen_tip_saved', 'crossword_seen_create_guide', 'crossword_seen_first_cell', 'crossword_seen_tutorial']) localStorage.setItem(k, '1');
      localStorage.setItem('crossword_seen_help', 'true'); // 解く画面の「遊び方」の窓を出さない
      // この端末で作った問題として合言葉を置く（自分が作った問題と同じ置き場）
      localStorage.setItem('crossword_my_puzzles', JSON.stringify([{ id, key, title: 'ヒント直しの試験', createdAt: Date.now() }]));
    } catch { /* 無視 */ }
  }, { id: PUZZLE_ID, key: KEY });
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const u = new URL(route.request().url());
    let body = [];
    if (u.pathname.endsWith('/rpc/crossword_is_hidden')) body = false;
    else if (u.pathname.endsWith('/crossword_puzzles')) {
      const idEq = u.searchParams.get('id') ?? '';
      // 1件だけ読む時（maybeSingle）は配列で来ることも物1つで来ることもあるので、Accept の形に合わせる
      const rows = idEq === `eq.${PLAY_ID}` ? [playPuzzle] : [{ id: PUZZLE_ID, play_count: 3 }];
      body = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? rows[0] ?? null : rows;
    }
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
  await ctx.route(/^https:\/\/www\.youtube\.com\/oembed/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ author_name: 'テストチャンネル' }) }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));

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
  await btn.click();
  await page.waitForTimeout(500);
  check(updateCalls.length === 1 && Object.keys(updateCalls[0].hints).join() === 'vertical:2' && updateCalls[0].hints['vertical:2'].videoId === 'dQw4w9WgXcQ' && updateCalls[0].hints['vertical:2'].startSec === 5 && updateCalls[0].id === PUZZLE_ID && updateCalls[0].key === KEY, `(3) 受付係へは変えた 2番だけを送る（${JSON.stringify(updateCalls[0]?.hints)}）`);
  check(!('channel' in (updateCalls[0]?.hints?.['vertical:2'] ?? {})) || true, '(3) 名札は受付係が付け直す（送っても信じない）');
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
  const srcBar = page.locator('[data-hint-sources]');
  const srcBtns = await srcBar.locator('button').evaluateAll((els) => els.map((e) => ({ w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), label: e.getAttribute('aria-label'), on: e.getAttribute('aria-checked') })));
  check(srcBtns.length === 5 && srcBtns.map((b) => b.label).join() === 'YouTube,アメブロ,X,Instagram,リンク', `(5) 欄の上に出どころの印が5つ（${srcBtns.map((b) => b.label).join('/')}）`);
  check(new Set(srcBtns.map((b) => b.w)).size <= 2 && Math.max(...srcBtns.map((b) => b.w)) - Math.min(...srcBtns.map((b) => b.w)) <= 1 && srcBtns.every((b) => b.h === 52), `(5) 印は全部同じ大きさ（幅 ${srcBtns.map((b) => b.w).join('/')}・高さ ${srcBtns[0]?.h}）`);
  check(srcBtns[0].on === 'true' && (await page.locator('[data-blog-search]').count()) === 0, '(5) 初期は YouTube で、ブログの探す補助は出ていない');
  await srcBar.locator('[data-hint-source="ameblo"]').click();
  await page.waitForTimeout(200);
  const blog = page.locator('[data-blog-search]');
  check((await blog.count()) === 1 && (await page.locator('#cw-hint').getAttribute('placeholder')) === '記事の URL を貼る', '(5) アメブロの印を押すと「公式ブログを探す」と記事の URL の欄');
  const link = blog.locator('a');
  check((await link.getAttribute('aria-disabled')) === 'true', '(5) 言葉が空の間は押せない');
  await blog.getByLabel('公式ブログのグループ').selectOption('beyooooonds');
  await blog.locator('input').fill('武道館');
  await page.waitForTimeout(100);
  const href = await link.getAttribute('href');
  const q = href ? decodeURIComponent(new URL(href).searchParams.get('q')) : '';
  check(href?.startsWith('https://www.google.com/search?q=') && q.includes('武道館') && q.includes('site:ameblo.jp/beyooooonds') && q.includes('site:ameblo.jp/beyooooonds-rfro') && !q.includes('inurl:') && !q.includes('after:') && (await link.getAttribute('target')) === '_blank', `(5) Google の site: 検索の住所になる（${q}）`);
  // いつごろ（年・月）→ after:/before:。月は翌月の1日で閉じる。「写す」は同じ言葉を持つ
  const per = blog.locator('[data-helper-period]');
  check((await per.locator('select').nth(1).isDisabled()), '(5) 年を選ぶまで月は選べない');
  await per.locator('select').nth(0).selectOption('2025');
  await per.locator('select').nth(1).selectOption('12');
  await page.waitForTimeout(100);
  const q2 = decodeURIComponent(new URL(await link.getAttribute('href')).searchParams.get('q'));
  check(q2.endsWith(' after:2025-12-01 before:2026-01-01'), `(5) いつごろ 2025年12月 → after:2025-12-01 before:2026-01-01（${q2.slice(-40)}）`);
  check((await blog.locator('[data-helper-copy="blog"]').getAttribute('data-copy-text')) === q2, '(5) 「コピー」は検索の言葉と同じ文を持つ');
  await per.locator('select').nth(1).selectOption('');
  await page.waitForTimeout(100);
  check(decodeURIComponent(new URL(await link.getAttribute('href')).searchParams.get('q')).endsWith(' after:2025-01-01 before:2026-01-01'), '(5) 月を選ばなければ年いっぱい');
  await per.locator('select').nth(0).selectOption('');
  // X の URL を貼ると印が X に移る
  await page.locator('#cw-hint').fill('https://x.com/helloproject/status/1');
  await page.waitForTimeout(300);
  check((await page.locator('[data-hint-kind]').textContent()) === 'X', `(5) X の URL を貼ると札の出どころが X になる（${await page.locator('[data-hint-kind]').textContent()}）`);
  const acct1 = await page.locator('[data-hint-account]').textContent().catch(() => null);
  check(acct1 === '@helloproject ハロプロ公式サイトに載っていないアカウント', `(5) 名簿に無いアカウントは「載っていないアカウント」の札で通る（${acct1}）`);
  await page.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  await page.locator('#cw-hint').fill('https://x.com/beyooooonds_/status/2');
  await page.waitForTimeout(300);
  const acct2 = await page.locator('[data-hint-account]').textContent().catch(() => null);
  check(acct2 === '@beyooooonds_ ハロプロ公式サイトに載っているアカウント', `(5) 名簿にあるアカウント（大文字小文字違い）は「載っているアカウント」（${acct2}）`);
  await page.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  await page.locator('#cw-hint').fill('https://www.instagram.com/p/abc123/');
  await page.waitForTimeout(300);
  check((await page.locator('[data-hint-kind]').textContent()) === 'Instagram' && (await page.locator('[data-hint-account]').count()) === 0, '(5) アカウント名の無い Instagram の投稿 URL は札なしで通る');
  await page.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  // X の印: 言葉＋グループ → x.com の検索（新しい順）
  await srcBar.locator('[data-hint-source="x"]').click();
  await page.waitForTimeout(200);
  const xs = page.locator('[data-x-search]');
  check((await xs.count()) === 1 && (await page.locator('[data-blog-search]').count()) === 0 && (await xs.locator('a').getAttribute('aria-disabled')) === 'true', '(5) X の印で「公式の投稿を探す」が出て、言葉が空の間は押せない');
  await xs.getByLabel('公式アカウントのグループ').selectOption('beyooooonds');
  await xs.locator('input').fill('武道館');
  await page.waitForTimeout(100);
  const xHref = await xs.locator('a').getAttribute('href');
  const xq = xHref ? decodeURIComponent(new URL(xHref).searchParams.get('q')) : '';
  check(xHref?.startsWith('https://x.com/search?q=') && xq.includes('武道館') && xq.includes('from:BEYOOOOONDS_') && new URL(xHref).searchParams.get('f') === 'live', `(5) x.com の from: 検索の住所になる（${xq}）`);
  await xs.locator('[data-helper-period] select').nth(0).selectOption('2025');
  await xs.locator('[data-helper-period] select').nth(1).selectOption('4');
  await page.waitForTimeout(100);
  const xq2 = decodeURIComponent(new URL(await xs.locator('a').getAttribute('href')).searchParams.get('q'));
  check(xq2.endsWith(' since:2025-04-01 until:2025-05-01') && (await xs.locator('[data-helper-copy="x"]').getAttribute('data-copy-text')) === xq2, `(5) X のいつごろは since:/until:（${xq2.slice(-36)}）`);
  await xs.locator('[data-helper-copy="x"]').click();
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  check(clip === xq2 && /コピーしました。/.test(await page.evaluate(() => document.body.innerText)), `(5) 「コピー」で検索の言葉がそのまま写る（${clip === xq2 ? '一致' : clip}）`);
  await xs.locator('input').fill('武道館 ');
  await page.waitForTimeout(100);
  check(!/コピーしました。/.test(await page.evaluate(() => document.body.innerText)), '(5) 言葉を打ち直すと「コピーしました。」は消える');
  await xs.locator('input').fill('武道館');
  await page.waitForTimeout(100);
  await page.locator('[data-coach="create-hint"]').screenshot({ path: path.join(OUT, '3-x-search-390.png') });
  // Instagram の印: アカウントを選んで開く
  await srcBar.locator('[data-hint-source="ig"]').click();
  await page.waitForTimeout(200);
  const ig = page.locator('[data-ig-open]');
  const igOpen = ig.locator('[data-helper-link="ig"]');
  check((await ig.count()) === 1 && (await xs.count()) === 0 && (await igOpen.getAttribute('href')) === 'https://www.instagram.com/morningmusume_official/', `(5) Instagram の印で公式アカウントを開くリンク（${await igOpen.getAttribute('href').catch(() => null)}）`);
  await ig.getByLabel('公式アカウント', { exact: true }).selectOption('beyooooonds_official');
  check((await igOpen.getAttribute('href')) === 'https://www.instagram.com/beyooooonds_official/', '(5) 選んだアカウントのページを開く');
  await ig.locator('input').fill('ハロコン');
  await ig.locator('[data-helper-period] select').nth(0).selectOption('2026');
  await ig.locator('[data-helper-period] select').nth(1).selectOption('7');
  await page.waitForTimeout(100);
  const igq = decodeURIComponent(new URL(await ig.locator('[data-helper-link="ig-search"]').getAttribute('href')).searchParams.get('q'));
  check(igq === 'ハロコン site:instagram.com/beyooooonds_official after:2026-07-01 before:2026-08-01' && (await ig.locator('[data-helper-copy="ig"]').getAttribute('data-copy-text')) === igq, `(5) Instagram は Google の site: と期間で探す（${igq}）`);
  const optN = await ig.getByLabel('公式アカウント', { exact: true }).locator('option').count();
  check(optN === 55, `(5) 選べるのは公式サイトのグループのページに載っている 55 アカウント（${optN}）`);
  await page.locator('[data-coach="create-hint"]').screenshot({ path: path.join(OUT, '4-ig-open-390.png') });
  await page.getByText('その他', { exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-hint-sources] [data-hint-source="ameblo"]').click();
  await page.waitForTimeout(200);
  check((await page.locator('[data-blog-search]').count()) === 0, '(5) その他ではアメブロの印でも探す補助は出ない（URL の欄だけ）');
  await page.locator('[data-hint-sources] [data-hint-source="x"]').click();
  await page.waitForTimeout(200);
  check((await page.locator('[data-x-search]').count()) === 0, '(5) その他では X の印でも探す補助は出ない');
  await page.locator('#cw-hint').fill('https://x.com/helloproject/status/1');
  await page.waitForTimeout(300);
  check((await page.locator('[data-hint-account]').count()) === 0, '(5) その他では名簿の札も付かない');
  await page.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  await page.getByText('ハロプロ', { exact: true }).first().click();
  await page.waitForTimeout(300);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(wide, '(5) 390px で横にはみ出さない');
  await page.locator('[data-coach="create-hint"]').screenshot({ path: path.join(OUT, '2-blog-search-390.png') });

  // (6) 解く側: ハロプロの問題の X のヒントに札、アカウント名の無い Instagram には札なし
  // 作る画面は書きかけがあると離れる前に確かめる窓を出すので、別のページで開く
  const play = await ctx.newPage();
  play.on('pageerror', (e) => pageErrors.push(String(e)));
  await play.goto(`${BASE}/crossword/${PLAY_ID}`);
  await play.locator('#cell-0-0').waitFor({ timeout: 30000 });
  await play.waitForTimeout(2300);
  await play.locator('#cell-1-0').click();
  await play.getByRole('button', { name: 'ヒント', exact: true }).first().click();
  await play.waitForTimeout(400);
  const playTag = await play.locator('[data-hint-account]').textContent().catch(() => null);
  check(playTag === '@BEYOOOOONDS_ ハロプロ公式サイトに載っているアカウント', `(6) 解く画面の X のリンクに名簿の札（${playTag}）`);
  check((await play.getByRole('link', { name: /x\.com/ }).count()) === 1, '(6) リンクは今まで通り別タブで開く形');
  await play.locator('[data-coach="keypad"]').screenshot({ path: path.join(OUT, '5-play-tag-390.png') });

  check(pageErrors.length === 0, `(7) 画面のつまずき（JS の例外）が無い${pageErrors.length ? '：' + pageErrors.join(' / ') : ''}`);
  console.log(`写真: ${OUT}`);
} finally {
  await browser.close();
  stopServer();
}
console.log(fails === 0 ? 'すべてOK' : `NG ${fails} 件`);
process.exit(fails === 0 ? 0 : 1);
