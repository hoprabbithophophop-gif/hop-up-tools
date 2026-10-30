// 「ヒントを直す」画面（/crossword/hints/<番号>。Hop 決定 2026-10-19）と、作る画面（/crossword/create・案A「作る｜試す」。Hop 決定 2026-10-22）の語の窓のヒント欄を確かめる。
// なぜ: ヒントは解く人が答えの出どころを確かめる根拠なので、公式の発信を探す補助と出どころの札が正しく働き、遊ばれた後でもヒントだけは直せるようにするため。
// 作る画面のヒント欄は、語の一覧の行を押して出る語の窓（[data-word-sheet]）の1か所だけにある（Hop 決定 2026-10-22）。そこで次を見る:
//   出どころの印・「① 探す」「② 見つけた◯◯の URL を貼る」の箱・②の一文・「貼り付け」・公式を探す補助（アメブロの「全部／1つだけ」とその月の記事一覧・X・Instagram・リンクの公式サイト検索）・
//   X・Instagram のリンクに添える「公式サイトに載っている／載っていないアカウント」の札（作る側・解く側）。
// (5b) は「① 探す」所の選択と言葉を覚える作り（Hop 決定 2026-10-22。グループはブラウザにずっと・言葉と年月は画面を開いている間）を、語の窓を語をまたいで開き直して見る。
// 手元の vite を立ち上げ（口 5199）、棚（/rest/v1）・受付係（/api）はブラウザの中で受け止める（本番にもプレビューにも通信しない）。
// 差し替えた YouTube が台帳（youtube_videos）に無い時は、問い合わせずに選ばれ、送る中身に outside: true が入る（Hop 決定 2026-10-21）。
// ブラウザから YouTube の oEmbed（youtube.com/oembed）・googleapis.com・/api/crossword-video-info への通信が無いことも見る。
// 確かめるのはこの3つの宛先だけ。埋め込みの再生の読み込み（www.youtube.com・i.ytimg.com）と字の形の読み込み（fonts.googleapis.com）は範囲の外
// 2026-10-22 に案A に合わせて書き直した。消した確かめ: 無し（ヒント欄の確かめは全部、語の窓で同じ意味のまま見られる）。
// 足した確かめ: (5) の頭で、開いたのが語の窓（その語の窓にカギの欄とヒントの欄が両方ある）こと。途中で止まった時も締めの行を出す。
// 足した下ごしらえ: 確かめの前に通る画面を一度開き、開発サーバーは口ごとのまとめ置き場で書き換えの見張りを止めて立てる（_lib.mjs の isolatedViteConfig）。
// どちらも確かめの途中でページが読み込み直されて書いた中身が消えるのを防ぐため（2026-10-22）
// 使い方: node scripts/verify/crossword/check-hints-edit.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outDir, watchStumbles, isolatedViteConfig } from './_lib.mjs';
import { writeLines, openWordSheet, closeWordSheet, waitBoard, toMode } from './_create.mjs';

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
let serverLog = ''; // 開発サーバーの記録（部品のまとめ直しで読み込み直した回数を最後に出すため）
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
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    if (server.exitCode !== null) throw new Error(`開発サーバーが止まった: ${serverLog.slice(-500)}`);
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
const asked = [];
const FORBIDDEN = /youtube\.com\/oembed|(?<!fonts\.)googleapis\.com|\/api\/crossword-video-info/;
try {
  await startServer();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }); // 「写す」を本当に写せたか読むため
  await ctx.addInitScript(({ id, key }) => {
    try {
      for (const k of ['crossword_seen_tip_cross', 'crossword_seen_tip_move', 'crossword_seen_tip_saved', 'crossword_seen_trace', 'crossword_seen_first_cell', 'crossword_seen_tutorial']) localStorage.setItem(k, '1');
      localStorage.setItem('crossword_seen_help', 'true'); // 解く画面の「遊び方」の窓を出さない
      // この端末で作った問題として合言葉を置く（自分が作った問題と同じ置き場）
      localStorage.setItem('crossword_my_puzzles', JSON.stringify([{ id, key, title: 'ヒント直しの試験', createdAt: Date.now() }]));
    } catch { /* 無視 */ }
  }, { id: PUZZLE_ID, key: KEY });
  // 手元の画面のほかへは一切出さない（広告・字の形・解析など、下で個別に受け止めない外の宛先は中身の無い返事で止める）。
  // 後に登録した route が先に当たるので、いちばん先に置いて最後の受け皿にする
  await ctx.route((u) => u.hostname !== 'localhost', (r) => r.fulfill({ status: 204, body: '' }));
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
  const page = await ctx.newPage();
  await watchStumbles(page, pageErrors);
  page.on('request', (req) => {
    if (FORBIDDEN.test(req.url())) asked.push(req.url());
  });

  // 下ごしらえ: 手元の開発サーバーは、画面が初めて読み込んだ部品をその場でまとめ直し、まとめ直すとページを読み込み直す。
  // 確かめの途中で読み込み直されると書いた中身が消えて落ちるので、この台本が通る画面（自分が作った問題・ヒントを直す・作る画面の語の窓の出どころ全部・試す・解く画面）を
  // 先に一度開いて部品をまとめ終えてから確かめる（check-create-flow と同じ考え。2026-10-22）。下ごしらえで端末に残った物は消してから始める
  for (let pass = 0; pass < 2; pass++) { // 1回目で見つけた部品をまとめ直した後、2回目で落ち着いたのを通す
    const w = await ctx.newPage();
    await w.goto(`${BASE}/crossword/mine`);
    await w.getByRole('link', { name: 'ヒントを直す' }).waitFor({ timeout: 30000 });
    await w.goto(`${BASE}/crossword/hints/${PUZZLE_ID}`);
    await w.locator('[data-hints-row]').first().waitFor({ timeout: 30000 });
    await w.goto(`${BASE}/crossword/create`);
    await waitBoard(w);
    await openWordSheet(w, 'キララ');
    for (const src of ['ameblo', 'x', 'ig', 'link', 'youtube']) {
      const b = w.locator(`[data-word-sheet] [data-hint-source="${src}"]`);
      if (await b.count()) await b.click();
      await w.waitForTimeout(300);
    }
    await closeWordSheet(w);
    await toMode(w, 'try');
    await w.locator('[data-trial] [id^="cell-"]').first().click({ timeout: 30000 });
    await w.waitForTimeout(500);
    await w.goto(`${BASE}/crossword/${PLAY_ID}`);
    await w.locator('#cell-0-0').waitFor({ timeout: 30000 });
    await w.waitForTimeout(3000);
    await w.evaluate(() => { localStorage.removeItem('crossword_draft'); localStorage.removeItem('crossword_draft_v3'); localStorage.removeItem('crossword_hint_groups'); });
    await w.close();
  }

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
  const btn = page.getByRole('button', { name: 'ヒントを保存する' });
  check(await btn.isDisabled() && /直したヒントがありません/.test(txt), '(2) 変える前はボタンが押せず理由が出る');
  await page.screenshot({ path: path.join(OUT, '1-hints-edit-390.png'), fullPage: true });

  // (3) 2番のヒントを外して公式の動画に替える → 送るのは 2番だけ
  const row2 = page.locator('[data-hints-row="vertical:2"]');
  await row2.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  check(await btn.isDisabled() && /ヒントがあと1個/.test(await page.evaluate(() => document.body.innerText)), '(3) 外した直後は「ヒントがあと1個」で押せない');
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
  check(/ヒントを保存しました/.test(await page.evaluate(() => document.body.innerText)), '(3) 「ヒントを更新しました」');
  check(await btn.isDisabled(), '(3) 更新後はまた「変えたヒントがありません」で押せない');

  // (4) 組み直し（?edit=）に遊ばれた問題で入ると、この画面へ回る
  await page.goto(`${BASE}/crossword/create?edit=${PUZZLE_ID}`);
  await page.waitForURL(`**/crossword/hints/${PUZZLE_ID}`, { timeout: 30000 }).catch(() => {});
  check(page.url().endsWith(`/crossword/hints/${PUZZLE_ID}`), `(4) 遊ばれた問題の組み直しは「ヒントを直す」へ回る（${page.url()}）`);

  // (5) 作る画面の語の窓（語の一覧の行を押すと下から出る）。出どころの印・「① 探す」「② 見つけた◯◯の URL を貼る」の箱・公式を探す補助・「貼り付け」
  await page.goto(`${BASE}/crossword/create`);
  await writeLines(page, '【ネコ】\n【コアラ】');
  await openWordSheet(page, 'ネコ');
  const sheet = page.locator('[data-word-sheet]');
  const opened = page.locator('[data-word-sheet="ネコ"]');
  check((await opened.count()) === 1 && (await opened.locator('#cw-clue').count()) === 1 && (await opened.locator('#cw-hint').count()) === 1 && (await opened.locator('h2').first().textContent()) === '「ネコ」のカギとヒント',
    `(5) 語の一覧の「ネコ」の行を押すと「ネコ」の語の窓が開き、カギの欄とヒントの欄が同じ窓にある（${await opened.locator('h2').first().textContent().catch(() => '窓なし')}）`);
  const urlBox = sheet.locator('#cw-hint');
  const srcBar = sheet.locator('[data-hint-sources]');
  const srcBtns = await srcBar.locator('button').evaluateAll((els) => els.map((e) => ({ w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), label: e.getAttribute('aria-label'), on: e.getAttribute('aria-checked') })));
  check(srcBtns.length === 5 && srcBtns.map((b) => b.label).join() === 'YouTube,アメブロ,X,Instagram,リンク', `(5) 欄の上に出どころの印が5つ（${srcBtns.map((b) => b.label).join('/')}）`);
  check(new Set(srcBtns.map((b) => b.w)).size <= 2 && Math.max(...srcBtns.map((b) => b.w)) - Math.min(...srcBtns.map((b) => b.w)) <= 1 && srcBtns.every((b) => b.h === 52), `(5) 印は全部同じ大きさ（幅 ${srcBtns.map((b) => b.w).join('/')}・高さ ${srcBtns[0]?.h}）`);
  check(srcBtns[0].on === 'true' && (await sheet.locator('[data-blog-search]').count()) === 0 && (await sheet.locator('[data-hint-step]').count()) === 0, '(5) 初期は YouTube で、①②の箱と探す補助は出ていない');
  // 箱の見出し（①・②）と②の一文（出どころ別。Hop 承認 2026-10-20・10-21）
  const boxes = async () => sheet.locator('[data-hint-step]').evaluateAll((els) => els.map((e) => ({ step: e.getAttribute('data-hint-step'), head: e.querySelector('p')?.textContent ?? '', note: e.querySelectorAll('p')[1]?.textContent ?? '' })));
  const BOX = {
    ameblo: ['①公式ブログを探す', '②見つけた記事の URL を貼る', '記事のシェアボタンか、ブラウザの住所の欄から URL をコピーして、ここに貼ります。'],
    x: ['①公式の投稿を探す', '②見つけた投稿の URL を貼る', '投稿の共有アイコンから「リンクをコピー」を選んで、ここに貼ります。'],
    ig: ['①公式の投稿を探す', '②見つけた投稿の URL を貼る', '投稿の「送信」（ブラウザでは「オプション」）から「リンクをコピー」を選んで、ここに貼ります。'],
    link: ['①公式サイトを探す', '②見つけたページの URL を貼る', '開いたページの URL をコピーして、ここに貼ります。'],
  };
  const checkBoxes = async (src) => {
    const b = await boxes();
    const [h1, h2, note] = BOX[src];
    check(b.length === 2 && b[0].step === '1' && b[0].head === h1 && b[1].step === '2' && b[1].head === h2 && b[1].note === note,
      `(5) ${src} の印: 「${h1}」「${h2}」の2つの箱と②の一文（${b.map((x) => x.head).join(' ／ ')} ／ ${b[1]?.note}）`);
    const paste = sheet.locator('[data-hint-step="2"] [data-helper-paste]');
    check((await paste.count()) === 1 && (await paste.textContent()) === '貼り付け' && (await sheet.locator('[data-hint-step="2"] #cw-hint').count()) === 1, `(5) ${src} の印: ②の箱の欄の横に「貼り付け」`);
  };
  await srcBar.locator('[data-hint-source="ameblo"]').click();
  await page.waitForTimeout(200);
  const blog = sheet.locator('[data-blog-search]');
  check((await blog.count()) === 1 && (await urlBox.getAttribute('placeholder')) === '記事の URL を貼る', '(5) アメブロの印を押すと「公式ブログを探す」と記事の URL の欄');
  await checkBoxes('ameblo');
  const link = blog.locator('[data-helper-link="blog"]');
  // 探す言葉は、空かほかの答えの字のままなら、開いた答えの字が入る（2026-10-24）。消すと押せない
  const kwNow = await blog.locator('input').inputValue();
  check(kwNow !== '', `(5) 探す言葉に開いた答えの字が入る（${kwNow}）`);
  await blog.locator('input').fill('');
  await page.waitForTimeout(100);
  check((await link.getAttribute('aria-disabled')) === 'true', '(5) 言葉が空の間は押せない');
  // 公式ブログ: グループ全部（g:）と1つだけ（b:）を選べる（2026-10-21 Hop 依頼「全部からも細かくも選べると嬉しい」）
  const blogSel = blog.getByLabel('公式ブログ', { exact: true });
  const beyoOpts = await blogSel.locator('optgroup[label="BEYOOOOONDS"] option').evaluateAll((els) => els.map((e) => `${e.value}=${e.textContent}`));
  check(beyoOpts.join(',') === 'g:beyooooonds=BEYOOOOONDS（全部）,b:beyooooonds=SeasoningS,b:beyooooonds-blog=BEYOOOOONDS,b:beyooooonds-chicatetsu=CHICA#TETSU,b:beyooooonds-rfro=雨ノ森 川海', `(5) BEYOOOOONDS は「（全部）」と各ブログの名前が並ぶ（${beyoOpts.join(' / ')}）`);
  await blogSel.selectOption('g:beyooooonds');
  await blog.locator('input').fill('武道館');
  await page.waitForTimeout(100);
  const href = await link.getAttribute('href');
  const q = href ? decodeURIComponent(new URL(href).searchParams.get('q')) : '';
  check(href?.startsWith('https://www.google.com/search?q=') && q.startsWith('武道館 (') && ['beyooooonds', 'beyooooonds-blog', 'beyooooonds-chicatetsu', 'beyooooonds-rfro'].every((id) => q.includes(`site:ameblo.jp/${id})`) || q.includes(`site:ameblo.jp/${id} `)) && !q.includes('inurl:') && !q.includes('after:') && (await link.getAttribute('target')) === '_blank', `(5) 「BEYOOOOONDS（全部）」は4つのブログの site: 検索（${q}）`);
  await blogSel.selectOption('b:beyooooonds-rfro');
  await page.waitForTimeout(100);
  const q1 = decodeURIComponent(new URL(await link.getAttribute('href')).searchParams.get('q'));
  check(q1 === '武道館 (site:ameblo.jp/beyooooonds-rfro)', `(5) 1つだけ（雨ノ森 川海）を選ぶとそのブログだけの site: 検索（${q1}）`);
  // その月の記事一覧を開く（Hop 決定 2026-10-22）: ブログを1つ（b:）選び、年と月の両方を選んだ時だけ。期間の外の月・グループ全部・月なしでは出さない。
  // 住所の形を見るだけで、開かない（アメブロの中身は読まない）
  const archive = blog.locator('[data-helper-link="blog-archive"]');
  const perSel = blog.locator('[data-helper-period] select');
  check((await archive.count()) === 0, '(5) 年と月を選ぶ前は「その月の記事一覧を開く」が出ない');
  await perSel.nth(0).selectOption('2020');
  await page.waitForTimeout(100);
  check((await archive.count()) === 0, '(5) 年だけ（月を選ばない）では出ない');
  await perSel.nth(1).selectOption('10');
  await page.waitForTimeout(100);
  check((await archive.count()) === 1 && (await archive.textContent()) === 'その月の記事一覧を開く' && (await archive.getAttribute('href')) === 'https://ameblo.jp/beyooooonds-rfro/archive1-202010.html' && (await archive.getAttribute('target')) === '_blank',
    `(5) 雨ノ森 川海・2020年10月で「その月の記事一覧を開く」が出て、住所は月ごとの一覧（${await archive.getAttribute('href').catch(() => null)}）`);
  check((await link.getAttribute('href'))?.startsWith('https://www.google.com/search?q=') === true, '(5) Google で探すボタンはそのまま残る');
  await sheet.screenshot({ path: path.join(OUT, '2-blog-archive-390.png') });
  await blog.locator('input').fill('');
  await page.waitForTimeout(100);
  check((await archive.count()) === 1, '(5) 探す言葉が空でも「その月の記事一覧を開く」は出る（言葉を使わないため）');
  await blog.locator('input').fill('武道館');
  await perSel.nth(1).selectOption('3');
  await page.waitForTimeout(100);
  check((await archive.getAttribute('href').catch(() => null)) === 'https://ameblo.jp/beyooooonds-rfro/archive1-202003.html', `(5) 月を選び直すと住所の月も変わる・1桁の月は0を付ける（${await archive.getAttribute('href').catch(() => null)}）`);
  await blogSel.selectOption('g:beyooooonds');
  await page.waitForTimeout(100);
  check((await archive.count()) === 0, '(5) グループの全部を選んだ時は出ない');
  // ブログが1本だけのグループ（Juice=Juice）は、グループを選んだだけでブログが1つに決まるので出す（Hop 決定 2026-10-22「出す」）
  await blogSel.selectOption('g:juicejuice');
  await page.waitForTimeout(100);
  check((await archive.getAttribute('href').catch(() => null)) === 'https://ameblo.jp/juicejuice-official/archive1-202003.html', `(5) ブログが1本だけのグループ（Juice=Juice）でも出る（${await archive.getAttribute('href').catch(() => null)}）`);
  // そのブログの期間の外（雨ノ森 川海は 2018年10月から）: 2018年9月では選択肢から外れて選び直され、出ない
  await blogSel.selectOption('b:beyooooonds-rfro');
  await perSel.nth(0).selectOption('2018');
  await perSel.nth(1).selectOption('9');
  await page.waitForTimeout(150);
  check((await archive.count()) === 0 && (await blogSel.inputValue()) !== 'b:beyooooonds-rfro', `(5) ブログの期間の外の月（2018年9月）では出ない（選択 ${await blogSel.inputValue()}）`);
  await perSel.nth(1).selectOption('10');
  await blogSel.selectOption('b:beyooooonds-rfro');
  await page.waitForTimeout(100);
  check((await archive.getAttribute('href').catch(() => null)) === 'https://ameblo.jp/beyooooonds-rfro/archive1-201810.html', '(5) 期間の最初の月（2018年10月）では出る');
  await perSel.nth(0).selectOption('');
  await page.waitForTimeout(100);
  await blogSel.selectOption('g:beyooooonds');
  // いつごろ（年・月）→ after:/before:。月は翌月の1日で閉じる。「コピー」は同じ言葉を持つ
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
  await page.waitForTimeout(100);
  // 公式ブログの選択肢は「いつごろ」に記事があるブログだけ（Hop 決定 2026-10-21。正は src/data/officialBlogs.ts の BLOG_PERIODS と blogOptions）
  const blogOpts = () => blogSel.locator('option').evaluateAll((els) => els.map((e) => ({ v: e.value, t: e.textContent })));
  const has = (opts, v) => opts.some((o) => o.v === v);
  const ENDED = ['b:kobushi-factory', 'b:countrygirls', 'b:c-ute-official'];
  const all = await blogOpts();
  check(all.some((o) => o.v === 'b:morningmusume-9ki' && o.t === 'Q期（2012〜2025）') && all.some((o) => o.v === 'b:c-ute-official' && o.t === '℃-ute（2015〜2017）'), `(5) いつごろ無しでは更新が止まったブログも期間つきで並ぶ（${all.filter((o) => /（\d{4}〜\d{4}）/.test(o.t)).map((o) => o.t).join(' / ')}）`);
  await blogSel.selectOption('b:morningm-13ki');
  await per.locator('select').nth(0).selectOption('2016');
  await page.waitForTimeout(150);
  const y2016 = await blogOpts();
  check(!has(y2016, 'b:morningm-13ki'), '(5) 2016年ではモーニング娘。の13期（2017年から）が出ない');
  check(ENDED.every((v) => has(y2016, v)), `(5) 2016年では活動を終えたグループの3つが出る（${ENDED.filter((v) => has(y2016, v)).join('・')}）`);
  check(!y2016.some((o) => o.v.includes('beyooooonds')), `(5) 2016年では BEYOOOOONDS が出ない（${y2016.filter((o) => o.v.includes('beyooooonds')).map((o) => o.v).join('・') || 'なし'}）`);
  const chosen = await blogSel.inputValue();
  check(chosen === 'g:morningmusume', `(5) 13期を選んだまま2016年にすると先頭（モーニング娘。（全部））に選び直される（${chosen}）`);
  const q2016 = decodeURIComponent(new URL(await link.getAttribute('href')).searchParams.get('q'));
  const sites2016 = [...q2016.matchAll(/site:ameblo\.jp\/([\w-]+)/g)].map((m) => m[1]);
  check(sites2016.join(',') === 'morningmusume-9ki,morningmusume-10ki,mm-12ki' && q2016.endsWith(' after:2016-01-01 before:2017-01-01'), `(5) 2016年の「モーニング娘。（全部）」は Q期・天気組・12期の3つだけを探す（${q2016}）`);
  await per.locator('select').nth(0).selectOption('2026');
  await page.waitForTimeout(150);
  const y2026 = await blogOpts();
  check(!has(y2026, 'b:morningmusume-9ki') && !has(y2026, 'b:morningm-13ki') && ENDED.every((v) => !has(y2026, v)) && !has(y2026, 'g:ended'), `(5) 2026年では Q期・13期・活動を終えたグループが出ない（残った物 ${[...ENDED, 'g:ended', 'b:morningmusume-9ki', 'b:morningm-13ki'].filter((v) => has(y2026, v)).join('・') || 'なし'}）`);
  await per.locator('select').nth(0).selectOption('');
  await blogSel.selectOption('g:beyooooonds');
  await sheet.screenshot({ path: path.join(OUT, '2-blog-search-390.png') });
  // X の URL を貼ると印が X に移る
  await urlBox.fill('https://x.com/helloproject/status/1');
  await page.waitForTimeout(300);
  check((await sheet.locator('[data-hint-kind]').textContent()) === 'X', `(5) X の URL を貼ると札の出どころが X になる（${await sheet.locator('[data-hint-kind]').textContent()}）`);
  const acct1 = await sheet.locator('[data-hint-account]').textContent().catch(() => null);
  check(acct1 === '@helloproject ハロプロ公式サイトに載っていないアカウント', `(5) 名簿に無いアカウントは「載っていないアカウント」の札で通る（${acct1}）`);
  await sheet.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  await urlBox.fill('https://x.com/beyooooonds_/status/2');
  await page.waitForTimeout(300);
  const acct2 = await sheet.locator('[data-hint-account]').textContent().catch(() => null);
  check(acct2 === '@beyooooonds_ ハロプロ公式サイトに載っているアカウント', `(5) 名簿にあるアカウント（大文字小文字違い）は「載っているアカウント」（${acct2}）`);
  await sheet.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  await urlBox.fill('https://www.instagram.com/p/abc123/');
  await page.waitForTimeout(300);
  check((await sheet.locator('[data-hint-kind]').textContent()) === 'Instagram' && (await sheet.locator('[data-hint-account]').count()) === 0, '(5) アカウント名の無い Instagram の投稿 URL は札なしで通る');
  await sheet.getByLabel('ヒントを外す').click();
  await page.waitForTimeout(200);
  // X の印: 言葉＋グループ → x.com の検索（新しい順）。探す言葉は出どころ共通なので、アメブロで打った「武道館」が残る（2026-10-21 Hop 依頼）
  await srcBar.locator('[data-hint-source="x"]').click();
  await page.waitForTimeout(200);
  const xs = sheet.locator('[data-x-search]');
  check((await xs.count()) === 1 && (await sheet.locator('[data-blog-search]').count()) === 0, '(5) X の印で「公式の投稿を探す」が出る');
  await checkBoxes('x');
  check((await xs.locator('input').inputValue()) === '武道館', `(5) 探す言葉は出どころを替えても残る（${await xs.locator('input').inputValue()}）`);
  await xs.locator('input').fill('');
  await page.waitForTimeout(100);
  check((await xs.locator('a').getAttribute('aria-disabled')) === 'true', '(5) X でも言葉が空の間は押せない');
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
  check(clip === xq2 && /コピーしました。/.test(await sheet.innerText()), `(5) 「コピー」で検索の言葉がそのまま写る（${clip === xq2 ? '一致' : clip}）`);
  await xs.locator('input').fill('武道館 ');
  await page.waitForTimeout(100);
  check(!/コピーしました。/.test(await sheet.innerText()), '(5) 言葉を打ち直すと「コピーしました。」は消える');
  await xs.locator('input').fill('武道館');
  await page.waitForTimeout(100);
  await sheet.screenshot({ path: path.join(OUT, '3-x-search-390.png') });
  // Instagram の印: アカウントを選んで開く・言葉と期間で Google に頼む
  await srcBar.locator('[data-hint-source="ig"]').click();
  await page.waitForTimeout(200);
  const ig = sheet.locator('[data-ig-open]');
  const igOpen = ig.locator('[data-helper-link="ig"]');
  check((await ig.count()) === 1 && (await xs.count()) === 0 && (await igOpen.getAttribute('href')) === 'https://www.instagram.com/morningmusume_official/', `(5) Instagram の印で公式アカウントを開くリンク（${await igOpen.getAttribute('href').catch(() => null)}）`);
  await checkBoxes('ig');
  const igPer = ig.locator('[data-helper-period] select');
  check((await ig.locator('input').inputValue()) === '武道館' && (await igPer.nth(0).inputValue()) === '2025' && (await igPer.nth(1).inputValue()) === '4', '(5) 探す言葉といつごろは Instagram に替えても残る');
  await ig.getByLabel('公式アカウント', { exact: true }).selectOption('beyooooonds_official');
  check((await igOpen.getAttribute('href')) === 'https://www.instagram.com/beyooooonds_official/', '(5) 選んだアカウントのページを開く');
  await ig.locator('input').fill('ハロコン');
  await igPer.nth(0).selectOption('2026');
  await igPer.nth(1).selectOption('7');
  await page.waitForTimeout(100);
  const igq = decodeURIComponent(new URL(await ig.locator('[data-helper-link="ig-search"]').getAttribute('href')).searchParams.get('q'));
  check(igq === '"beyooooonds_official" ハロコン site:instagram.com after:2026-07-01 before:2026-08-01' && (await ig.locator('[data-helper-copy="ig"]').getAttribute('data-copy-text')) === igq, `(5) Instagram はアカウント名を言葉にして Google の site: と期間で探す（${igq}）`);
  const optN = await ig.getByLabel('公式アカウント', { exact: true }).locator('option').count();
  check(optN === 55, `(5) 選べるのは公式サイトのグループのページに載っている 55 アカウント（${optN}）`);
  await sheet.screenshot({ path: path.join(OUT, '4-ig-open-390.png') });
  // リンクの印: ① はハロプロ公式サイトと関連サイトだけを対象にした Google 検索（Hop 決定 2026-10-20。対象は src/data/officialSites.ts）
  await srcBar.locator('[data-hint-source="link"]').click();
  await page.waitForTimeout(200);
  const site = sheet.locator('[data-site-search]');
  check((await site.count()) === 1 && (await urlBox.getAttribute('placeholder')) === 'ハロプロ公式サイトなどの URL を貼る', '(5) リンクの印で「公式サイトを探す」とハロプロ公式サイトなどの URL の欄');
  await checkBoxes('link');
  await site.locator('input').fill('武道館');
  await site.locator('[data-helper-period] select').nth(0).selectOption('');
  await page.waitForTimeout(100);
  const siteHref = await site.locator('[data-helper-link="site"]').getAttribute('href');
  const sq = siteHref ? decodeURIComponent(new URL(siteHref).searchParams.get('q')) : '';
  check(siteHref?.startsWith('https://www.google.com/search?q=') && sq.startsWith('武道館 (site:helloproject.com OR ') && sq.includes('site:up-front-works.jp') && !/elineupmall|helloshop|ody-books|orical/.test(sq) && sq.split(/\s+/).length <= 30,
    `(5) リンクの ① は公式サイトと関連サイトだけの site: 検索（ショップは入らない・30語まで。${sq.slice(0, 60)}…）`);
  check((await site.locator('[data-helper-copy="site"]').getAttribute('data-copy-text')) === sq, '(5) リンクの「コピー」も検索の言葉と同じ文');
  // 「貼り付け」: コピーした URL をそのまま欄に入れて選ぶ（2026-10-20 案C・言葉は 2026-10-21 承認）
  await page.evaluate(() => navigator.clipboard.writeText('https://x.com/beyooooonds_/status/3'));
  await sheet.locator('[data-helper-paste]').click();
  await page.waitForTimeout(400);
  check((await sheet.locator('[data-hint-kind]').textContent().catch(() => null)) === 'X' && (await sheet.locator('[data-hint-account]').textContent().catch(() => null)) === '@beyooooonds_ ハロプロ公式サイトに載っているアカウント', '(5) 「貼り付け」でコピーした X の URL がヒントになり、印も札も合う');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(wide, '(5) 390px で横にはみ出さない');
  await closeWordSheet(page);
  // (5b) 「① 探す」所の選択と言葉を覚える（Hop 決定 2026-10-22「グループはずっと・言葉は問題の間」）。別の語（コアラ）の語の窓で見る。
  // 2026-10-21 に担当が足した「別の語のヒントを開き直すと探す言葉は空に戻る」の確かめは、この決定で逆になったので書き換えた。
  // ここまでに人が選んだ物: アメブロ「BEYOOOOONDS（全部）」・X「BEYOOOOONDS」・Instagram「beyooooonds_official」。探す言葉は「武道館」・いつごろは無し
  const GROUPS_KEY = 'crossword_hint_groups';
  const DEFAULTS = { blog: 'g:morningmusume', x: 'morningmusume', ig: 'morningmusume_official' };
  // 開いている語の窓（またはヒントを直す画面の欄）で、出どころを替えながら選択と言葉を読む
  const readSearch = async (root, pg) => {
    const out = {};
    await root.locator('[data-hint-source="ameblo"]').click();
    await pg.waitForTimeout(150);
    out.blog = await root.locator('[data-blog-search]').getByLabel('公式ブログ', { exact: true }).inputValue();
    out.keyword = await root.locator('[data-blog-search] input').inputValue();
    const per = root.locator('[data-blog-search] [data-helper-period] select');
    out.year = await per.nth(0).inputValue();
    out.month = await per.nth(1).inputValue();
    await root.locator('[data-hint-source="x"]').click();
    await pg.waitForTimeout(150);
    out.x = await root.locator('[data-x-search]').getByLabel('公式アカウントのグループ').inputValue();
    out.xKeyword = await root.locator('[data-x-search] input').inputValue();
    await root.locator('[data-hint-source="ig"]').click();
    await pg.waitForTimeout(150);
    out.ig = await root.locator('[data-ig-open]').getByLabel('公式アカウント', { exact: true }).inputValue();
    return out;
  };
  const show = (o) => JSON.stringify(o);
  await openWordSheet(page, 'コアラ');
  let got = await readSearch(sheet, page);
  check(got.keyword === '武道館' && got.xKeyword === '武道館' && got.blog === 'g:beyooooonds' && got.x === 'beyooooonds' && got.ig === 'beyooooonds_official',
    `(5b) 別の語の語の窓でも、探す言葉とグループの選択が残る（${show(got)}）`);
  await sheet.locator('[data-hint-source="ameblo"]').click();
  await page.waitForTimeout(150);
  await sheet.locator('[data-blog-search] input').fill('ハロコン');
  await sheet.locator('[data-blog-search] [data-helper-period] select').nth(0).selectOption('2020');
  await sheet.locator('[data-blog-search] [data-helper-period] select').nth(1).selectOption('10');
  await page.waitForTimeout(100);
  await closeWordSheet(page);
  await openWordSheet(page, 'コアラ');
  got = await readSearch(sheet, page);
  check(got.keyword === 'ハロコン' && got.year === '2020' && got.month === '10' && got.blog === 'g:beyooooonds', `(5b) 窓を閉じて開き直しても、言葉と年月が残る（${show(got)}）`);
  await closeWordSheet(page);
  const stored = await page.evaluate((k) => localStorage.getItem(k), GROUPS_KEY);
  // 2026-10-23 からヒントの出どころも同じ所に覚える（最後に使った出どころから次の答えでも始める。Hop 決定 2026-10-23）
  const storedObj = JSON.parse(stored || 'null');
  check(storedObj && storedObj.blog === 'g:beyooooonds' && storedObj.x === 'beyooooonds' && storedObj.ig === 'beyooooonds_official' && ['yt', 'ameblo', 'x', 'ig', 'link'].includes(storedObj.source) && Object.keys(storedObj).length === 4, `(5b) ブラウザに覚えるのはグループの選択の3つと出どころだけ（言葉・年月は入らない。${stored}）`);
  const allStored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  check(!allStored.includes('ハロコン'), '(5b) 探す言葉はブラウザのどこにも残さない（作りかけの控えにも入らない）');
  // 作る画面を開き直す（作りかけがあると離れる前に確かめる窓が出るので、別のページで開く。ブラウザの保存は同じ）
  const openCreate = async (label, init) => {
    const p2 = await ctx.newPage();
    await watchStumbles(p2, pageErrors, label);
    if (init) await p2.addInitScript(init, GROUPS_KEY);
    await p2.goto(`${BASE}/crossword/create`);
    await openWordSheet(p2, 'コアラ');
    const r = await readSearch(p2.locator('[data-word-sheet]'), p2);
    return { p2, r };
  };
  let { p2: again, r: re } = await openCreate('開き直した作る画面');
  check(re.keyword === 'コアラ' && re.year === '' && re.month === '' && re.blog === 'g:beyooooonds' && re.x === 'beyooooonds' && re.ig === 'beyooooonds_official',
    `(5b) 作る画面を開き直すと、グループの選択は残り、年月は空・言葉は開いた答えの字から（${show(re)}）`);
  await again.locator('[data-word-sheet]').screenshot({ path: path.join(OUT, '6-remembered-group-390.png') });
  await again.close();
  // ヒントを直す画面でも、グループの選択は覚えた物から。言葉と年月は語の欄をまたいで同じ1つ
  const edit = await ctx.newPage();
  await watchStumbles(edit, pageErrors, 'ヒントを直す画面');
  await edit.goto(`${BASE}/crossword/hints/${PUZZLE_ID}`);
  await edit.locator('[data-hints-row]').first().waitFor({ timeout: 30000 });
  await edit.waitForTimeout(500);
  const er1 = edit.locator('[data-hints-row="horizontal:1"]');
  const er2 = edit.locator('[data-hints-row="vertical:2"]');
  await er1.getByLabel('ヒントを外す').click();
  await er1.locator('[data-hint-source="ameblo"]').click();
  await edit.waitForTimeout(150);
  const e1Blog = await er1.getByLabel('公式ブログ', { exact: true }).inputValue();
  check(e1Blog === 'g:beyooooonds' && (await er1.locator('[data-blog-search] input').inputValue()) === '', `(5b) ヒントを直す画面でもアメブロは覚えた選択から・言葉は空から（${e1Blog}）`);
  await er1.locator('[data-blog-search] input').fill('武道館');
  await er1.locator('[data-blog-search] [data-helper-period] select').nth(0).selectOption('2024');
  await er2.getByLabel('ヒントを外す').click();
  await er2.locator('[data-hint-source="ameblo"]').click();
  await edit.waitForTimeout(150);
  const e2 = { kw: await er2.locator('[data-blog-search] input').inputValue(), y: await er2.locator('[data-blog-search] [data-helper-period] select').nth(0).inputValue() };
  check(e2.kw === '武道館' && e2.y === '2024', `(5b) ヒントを直す画面では、別の語の欄にも言葉と年が残る（${show(e2)}）`);
  await edit.close();
  // 覚えた値が今の名簿に無い・壊れている時は先頭から
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ blog: 'g:nope', x: 'nope', ig: 'nope' })), GROUPS_KEY);
  ({ p2: again, r: re } = await openCreate('名簿に無い値'));
  check(re.blog === DEFAULTS.blog && re.x === DEFAULTS.x && re.ig === DEFAULTS.ig, `(5b) 覚えた値が名簿に無い時は先頭から（${show(re)}）`);
  await again.close();
  await page.evaluate((k) => localStorage.setItem(k, '{壊れた'), GROUPS_KEY);
  ({ p2: again, r: re } = await openCreate('壊れた値'));
  check(re.blog === DEFAULTS.blog && re.x === DEFAULTS.x && re.ig === DEFAULTS.ig, `(5b) 覚えた値が壊れている時も先頭から（${show(re)}）`);
  await again.close();
  // localStorage を空にすると先頭から
  await page.evaluate((k) => localStorage.removeItem(k), GROUPS_KEY);
  ({ p2: again, r: re } = await openCreate('空にした後'));
  check(re.blog === DEFAULTS.blog && re.x === DEFAULTS.x && re.ig === DEFAULTS.ig, `(5b) 覚えた物を空にすると先頭から（${show(re)}）`);
  await again.close();
  // localStorage が使えない時（この鍵の読み書きが例外になる）も、先頭から始まり、選び直しは画面の中で効き、画面は止まらない
  ({ p2: again, r: re } = await openCreate('保存が使えない', (k) => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) { if (key === k) throw new Error('blocked'); return get.call(this, key); };
    Storage.prototype.setItem = function (key, v) { if (key === k) throw new Error('blocked'); return set.call(this, key, v); };
  }));
  const bs = again.locator('[data-word-sheet]');
  await bs.locator('[data-hint-source="x"]').click();
  await bs.locator('[data-x-search]').getByLabel('公式アカウントのグループ').selectOption('beyooooonds');
  await again.waitForTimeout(150);
  const xNow = await bs.locator('[data-x-search]').getByLabel('公式アカウントのグループ').inputValue();
  check(re.blog === DEFAULTS.blog && re.x === DEFAULTS.x && xNow === 'beyooooonds', `(5b) ブラウザに保存できない時も先頭から始まり、選び直しは効く（${show(re)} → ${xNow}）`);
  await again.close();

  // (6) 解く側: ハロプロの問題の X のヒントに札、アカウント名の無い Instagram には札なし
  // 作る画面は書きかけがあると離れる前に確かめる窓を出すので、別のページで開く
  const play = await ctx.newPage();
  await watchStumbles(play, pageErrors, '解く画面');
  play.on('request', (req) => {
    if (FORBIDDEN.test(req.url())) asked.push(req.url());
  });
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

  check(asked.length === 0, `(7) oEmbed・googleapis.com・/api/crossword-video-info への通信が無い${asked.length ? `（${asked[0]}）` : ''}`);
  check(pageErrors.length === 0, `(7) 画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）が無い${pageErrors.length ? '：' + pageErrors.join(' / ') : ''}`);
  console.log(`写真: ${OUT}`);
} catch (e) {
  console.log(`NG 台本が途中で止まった: ${String(e).slice(0, 300)}`);
  fails++;
} finally {
  await browser.close();
  stopServer();
}
// 落ちた時の見分け用（確かめではない）: 確かめの途中で開発サーバーが部品をまとめ直してページを読み込み直した回数
console.log(`開発サーバーの部品のまとめ直し: ${(serverLog.match(/optimized dependencies changed/g) || []).length}回`);
(await import('node:fs')).writeFileSync(path.join(OUT, 'vite.log'), serverLog); // 落ちた時に開発サーバーの記録を見られるように
console.log(fails === 0 ? 'すべてOK' : `NG ${fails} 件`);
process.exit(fails === 0 ? 0 : 1);
