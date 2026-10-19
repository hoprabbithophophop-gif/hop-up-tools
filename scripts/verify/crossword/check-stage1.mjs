// クロスワード段階1の完成の定義（docs/definition-of-done.md）の5項目を、実際の画面で順に確かめる。
// 本番にもプレビューにも通信しない（2026-10-19 Hop「本番環境から見える形で検収用パズル登録を二度とするな」）。
// 手元の vite をこの台本が立ち上げ、棚（/rest/v1）・受付係（/api）・人間確認（Turnstile）・YouTube はブラウザの中で受け止める。
// 保存は作り物の受付係が受け、台本の中に持った問題で解く。受付係そのものの動きは check-owner-edit・check-fixtures（手元の受付係）で見る
// 使い方: node scripts/verify/crossword/check-stage1.mjs（引数なし。--skip-save を付けると 1〜4 を飛ばす）
// スクリーンショットの置き場は環境変数 OUT（古い名前の VERIFY_OUT も可）があればそこ、無ければ 一時置き場/hop-up-tools-verify/crossword/check-stage1/
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import path from 'node:path';
import { outDir, ROOT } from './_lib.mjs';

const SKIP_SAVE = process.argv.includes('--skip-save');
const PORT = 5192;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-stage1', process.env.VERIFY_OUT ? path.join(process.env.VERIFY_OUT, 'stage1') : undefined);

let server = null;
function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
}
process.on('exit', stopServer);
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

// ---- 作り物の棚と受付係。保存された問題をここに持つ（ブラウザの記録が別でも同じ問題が開ける） ----
const saved = new Map(); // id → { row, answers }
function storedRow(id, puzzle) {
  const { body } = puzzle;
  return {
    id, title: puzzle.title, genre: puzzle.genre, tags: puzzle.tags ?? [], is_beginner: puzzle.isBeginner === true, group_tags: [], play_count: 0,
    created_at: new Date().toISOString(),
    body: { ...body, clues: body.clues.map(({ answer, ...c }) => ({ ...c, length: answer.length })) },
  };
}
const solutionOf = (id) => {
  const { row, answers } = saved.get(id);
  const cells = {};
  row.body.clues.forEach((c, i) => answers[i].forEach((ch, k) => {
    const x = c.startX + (c.direction === 'horizontal' ? k : 0);
    const y = c.startY + (c.direction === 'vertical' ? k : 0);
    cells[`${x},${y}`] = ch;
  }));
  return cells;
};
async function mockAll(ctx) {
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const u = new URL(route.request().url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: JSON.stringify(body) });
    if (u.pathname.endsWith('/rpc/crossword_is_hidden')) return json(false);
    const table = u.pathname.split('/').pop();
    // 台帳（youtube_videos）は空＝どの動画も台帳に無い
    let rows = table === 'crossword_puzzles' ? [...saved.values()].map((x) => x.row) : [];
    const idEq = u.searchParams.get('id');
    if (idEq?.startsWith('eq.')) rows = rows.filter((r) => r.id === idEq.slice(3));
    if ((route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object')) return json(rows[0] ?? null);
    return json(rows);
  });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await ctx.route('**/api/crossword-save', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const id = `LocalS${String(saved.size + 1).padStart(2, '0')}`;
    saved.set(id, { row: storedRow(id, body.puzzle), answers: body.puzzle.body.clues.map((c) => c.answer) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id }) });
  });
  await ctx.route('**/api/crossword-play', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const reply = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...o }) });
    const id = [body.id, body.puzzleId].find((v) => saved.has(v)) ?? [...saved.keys()].at(-1);
    switch (body.action) {
      case 'start': return reply({ token: 'tok-stage1', startedAt: Date.now() });
      case 'touch': return reply({ counted: true });
      case 'resume': case 'pause': case 'ping': return reply({ activeMs: 0, open: body.action !== 'pause' });
      case 'check': {
        const sol = id ? solutionOf(id) : {};
        const correct = Object.keys(sol).length > 0 && Object.keys(sol).every((k) => body.answers?.[k] === sol[k]);
        return reply(correct ? { correct, answers: saved.get(id).answers, timeSeconds: 10, rankable: false } : { correct });
      }
      case 'reveal': return reply({ char: id ? solutionOf(id)[`${body.x},${body.y}`] : 'ア', reveals: 1 });
      default: return route.fulfill({ status: 400, body: '{}' });
    }
  });
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|www\.youtube-nocookie\.com|challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com|pagead2\.googlesyndication\.com)\//, (r) => r.fulfill({ status: 204, body: '' }));
  // 後に登録した route が先に当たるので、上の受け止めより後に置く
  await ctx.route('https://challenges.cloudflare.com/turnstile/**', (r) =>
    r.fulfill({ contentType: 'application/javascript', body: 'window.turnstile={render:function(el,o){setTimeout(function(){o.callback("check-stage1")},50);return "w"},remove:function(){},reset:function(){}};' }),
  );
  await ctx.route(/^https:\/\/www\.youtube\.com\/oembed/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ author_name: 'テストチャンネル', title: 'テストの動画' }) }));
  // YouTube の再生部品（iframe_api）の作り物。画面が渡した videoId と playerVars（start・autoplay）を、本物と同じく埋め込みの住所の引数にして枠を作る
  await ctx.route('https://www.youtube.com/iframe_api', (r) =>
    r.fulfill({
      contentType: 'application/javascript',
      body: `window.YT={Player:function(el,o){var v=o.playerVars||{};var f=document.createElement('iframe');f.src='https://www.youtube.com/embed/'+o.videoId+'?start='+(v.start||0)+'&autoplay='+(v.autoplay||0)+'&enablejsapi=1';el.replaceWith(f);this.destroy=function(){f.remove()};this.pauseVideo=function(){};this.playVideo=function(){};this.seekTo=function(){};this.getCurrentTime=function(){return 0}}};window.onYouTubeIframeAPIReady&&window.onYouTubeIframeAPIReady();`,
    }),
  );
}

// 画面の言葉。実装に合わせてここだけ直す
const T = {
  add: 'リストに追加',
  save: '共有する',
  check: '答え合わせ',
  hint: 'ヒント',
  dakuten: '゛',
  del: '消す',
  done: '決定',
  building: '読み込み中',
  optimizing: '組み立て中',
  clear: 'CLEAR',
  notFilled: 'まだ埋まっていないマスがあります',
};

// ひらがなで入れて、カタカナにそろうかも見る。「ボ」は文字盤の ゛ で作る
const WORDS = [
  { a: 'かぼちゃ', clue: 'ハロウィンでくり抜かれる野菜', hint: 'https://youtu.be/dQw4w9WgXcQ?t=83' },
  { a: 'ちゃーはん', clue: '中華料理店のパラパラのご飯', hint: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s' },
  { a: 'はんかち', clue: 'ポケットに入れて手を拭く布', hint: 'https://ja.wikipedia.org/wiki/ハンカチ' },
  { a: 'かき', clue: '秋に実る橙色の果物', hint: 'https://youtu.be/dQw4w9WgXcQ' },
];

const r = {};
const errs = [];
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
await startServer();
const browser = await chromium.launch();

// 見出しと欄が仕組みの上でつながっていないので、見出しのすぐ次にある入力欄を探す。ヒントは案内の文字で探す
const fieldByLabel = (page, label) => label === 'ヒント'
  ? page.getByPlaceholder(/URL を貼る/).first()
  : page.locator('xpath=//label[contains(normalize-space(.), "' + label + '")]/following-sibling::*[1]/descendant-or-self::input').first();
const clickText = (page, text) => page.getByRole('button', { name: text, exact: false }).first().click();

// ---- 1. 作る: 組み立ての動き → 保存 → URL ----
const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
await mockAll(ctxA);
const pa = await ctxA.newPage();
pa.on('pageerror', (e) => errs.push('作る画面: ' + e));
let url = null;
if (SKIP_SAVE) {
  console.log('飛ばす 1〜4（保存して出た URL で解く）: --skip-save が付いている');
} else {
await pa.goto(BASE + '/crossword/create', { waitUntil: 'networkidle' });
await fieldByLabel(pa, '題名').fill(`検収用 ${stamp}`);
await pa.getByText('その他', { exact: true }).first().click();
let sawOptimizing = false;
for (const w of WORDS) {
  await fieldByLabel(pa, '答え').fill(w.a);
  await fieldByLabel(pa, 'カギ').fill(w.clue);
  await fieldByLabel(pa, 'ヒント').fill(w.hint);
  await clickText(pa, T.add);
  sawOptimizing ||= await pa.getByText(T.optimizing).first().isVisible().catch(() => false);
}
// 50試行×100ms の組み立てが終わるのを待つ
await pa.waitForTimeout(6500);
await pa.screenshot({ path: path.join(OUT, '1-built.png'), fullPage: true });
await clickText(pa, T.save);
url = await pa.waitForFunction(() => {
  // 共有カードの URL は入力欄の中に出るので、欄の中身も合わせて探す
  const all = document.body.innerText + ' ' + [...document.querySelectorAll('input')].map((i) => i.value).join(' ');
  const m = all.match(/https?:\/\/\S+\/crossword\/[A-Za-z0-9_-]{8}/);
  return m ? m[0] : null;
}, null, { timeout: 20000 }).then((h) => h.jsonValue(), () => null);
r['1 組み立ての動きが出た'] = sawOptimizing;
r['1 保存して URL が出た'] = Boolean(url);
}

// ---- 5. ヒントの選び方（作る画面のまま確かめる） ----
await pa.goto(BASE + '/crossword/create', { waitUntil: 'networkidle' });
await pa.getByText('ハロプロ', { exact: true }).first().click();
await fieldByLabel(pa, 'ヒント').fill('https://youtu.be/dQw4w9WgXcQ?t=83');
await pa.waitForTimeout(1500);
const helloText = await pa.evaluate(() => document.body.innerText);
// 2026-10-19 案1: 台帳に無い動画は断らず、チャンネル名と「公式の発信か確かめてください」を添える（YouTube への問い合わせは作り物が答える）
r['5 ハロプロで台帳に無い YouTube はチャンネル名付きで通る'] = /チャンネル: .+ ハロプロの公式の発信か確かめてください/.test(helloText);
r['5 ハロプロのヒント欄に公式の発信の案内'] = /ヒントはハロプロの公式の発信/.test(helloText);
await pa.getByLabel('ヒントを外す').click(); // 選ばれた札を外して欄に戻す
await pa.waitForTimeout(300);
await fieldByLabel(pa, 'ヒント').fill('https://youtu.be/6Y2X6RxYnY');
await pa.waitForTimeout(500);
r['5 形の崩れた YouTube はリンクとして通さない'] = /YouTube の URL の形が違います/.test(await pa.evaluate(() => document.body.innerText));
await pa.getByText('その他', { exact: true }).first().click();
await pa.waitForTimeout(500); // 切り替えで欄が空に戻るのを待ってから貼る
await fieldByLabel(pa, 'ヒント').fill('https://youtu.be/dQw4w9WgXcQ?t=83');
await pa.waitForTimeout(1500);
r['5 その他で URL の時刻が欄に入る'] = await pa.locator('input').evaluateAll((els) => els.some((e) => e.value === '1:23'));
await pa.screenshot({ path: path.join(OUT, '5-hint-picker.png'), fullPage: true });

// ---- 2〜4. 記録が空のブラウザで解く ----
if (url) {
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await mockAll(ctxB);
  const pb = await ctxB.newPage();
  pb.on('pageerror', (e) => errs.push('解く画面: ' + e));
  await pb.goto(url, { waitUntil: 'domcontentloaded' });
  // isVisible は待たないので、出るまで待つ形で見る
r['2 構築中の動きが出た'] = await pb.getByText(T.building).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  await pb.waitForTimeout(2500);
  // 初回の遊び方を閉じる
  await pb.getByRole('button', { name: /このまま始める|始める！|はじめる|閉じる/ }).first().click().catch(() => {});
  const t1 = await pb.evaluate(() => (document.body.innerText.match(/\d+:\d\d/) || [''])[0]);
  await pb.waitForTimeout(2200);
  const t2 = await pb.evaluate(() => (document.body.innerText.match(/\d+:\d\d/) || [''])[0]);
  r['2 タイマーが進む'] = Boolean(t1 && t2 && t1 !== t2);
  await pb.screenshot({ path: path.join(OUT, '2-play.png'), fullPage: true });

  // カギの一覧から「ハロウィン」のカギを開いて、文字盤で カ ホ ゛ チ ヤ と入れる（゛ は書き順どおり字のあとに押し、直前の字を濁らせる。Hop 2026-10-06）
  // 小さい字は大きい字と同じ扱い（Hop 決定 2026-10-05）。「かぼちゃ」の答えは カ・ボ・チ・ヤ で、文字盤に「小」は無い
  await pb.getByText(WORDS[0].clue).first().click();
  r['2 文字盤に「小」が無い'] = (await pb.getByRole('button', { name: '小', exact: true }).count()) === 0;
  for (const k of ['カ', 'ホ', T.dakuten, 'チ', 'ヤ']) await pb.getByRole('button', { name: k, exact: true }).first().click();
  const cardText = await pb.evaluate(() => document.body.innerText);
  r['2 文字盤でカタカナと濁点が入り、小さい字は大きい字になる'] = cardText.includes('ボ') && cardText.includes('ヤ') && !cardText.includes('ャ');

  // 3. ヒント: YouTube は止まった状態で時刻つき
  await clickText(pb, T.hint);
  await pb.waitForTimeout(1500);
  const src = await pb.locator('iframe[src*="youtube"]').first().getAttribute('src').catch(() => null);
  r['3 YouTube のヒントが時刻つきで出て自動再生しない'] = Boolean(src && /start=83/.test(src) && !/autoplay=1/.test(src));
  await pb.screenshot({ path: path.join(OUT, '3-hint.png') });
  await clickText(pb, T.hint);
  await clickText(pb, T.done);

  // 2. 開き直しても残る
  await pb.reload({ waitUntil: 'domcontentloaded' });
  await pb.waitForTimeout(3000);
  r['2 開き直しても入れた答えが残る'] = (await pb.evaluate(() => document.body.innerText)).includes('ボ');

  await ctxB.close();
}

await browser.close();
stopServer();
r['外に置いた試しの問題'] = 'なし（手元の作り物の棚だけ）';
r['つまずき'] = errs.length ? errs : 'なし';
let fail = 0;
for (const [k, v] of Object.entries(r)) {
  if (k.startsWith('外に置いた')) { console.log(`   ${k}: ${v}`); continue; }
  const good = k === 'つまずき' ? v === 'なし' : v === true;
  if (!good) fail++;
  console.log(`${good ? 'OK ' : 'NG '} ${k}${k === 'つまずき' ? ': ' + JSON.stringify(v) : ''}`);
}
const ok = fail === 0;
console.log(ok ? 'すべてOK（合）' : `NG ${fail}件（否）`);
console.log('写真: ' + OUT);
process.exit(ok ? 0 : 1);
