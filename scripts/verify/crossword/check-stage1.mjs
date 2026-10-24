// クロスワードの「初めて作って配る」の通し（完成の線 DONE_CRITERIA.md の②1）を、実際の画面で 375×548 と 390×844 の両方で確かめる。
// 作る画面は 2026-10-22 に案A「作る｜試す」に作り直した（Hop 決定 2026-10-22）。この台本もそれに合わせて書き直した（同日）。
// 流れ: 記録が空のブラウザで /crossword/create → 見本の4行が入っている → 1行を書き換え1語足す → 小さい盤が育つ（足した語が盤か「置けなかった語」に出る）
//   → 語の行から語の窓を開き、盤に入った全部の語にカギとヒント → 「公開の準備」→ 題名 → 共有する → 作り物の人間確認（Turnstile）→ 作り物の保存 → URL が出る
//   → 別の記録の空のブラウザでその URL を開くと、作り物の棚が保存された中身を返し、作り物の受付係が答え合わせする → 最初から解ける
// 解く側の確かめ（構築中の動き・タイマー・文字盤の濁点と小さい字・ヒントの YouTube が時刻つきで自動再生しない・開き直しても残る）は前のまま残す。
// 本番にもプレビューにも通信しない（2026-10-19 Hop「本番環境から見える形で検収用パズル登録を二度とするな」）。
// 手元の vite をこの台本が立ち上げ（Supabase の住所は仮の住所）、棚（/rest/v1）・受付係（/api）・人間確認（Turnstile）・YouTube はブラウザの中で受け止める。
// 動画のことは YouTube にもどこにも問い合わせない作り（Hop 決定 2026-10-21）なので、ブラウザから YouTube の oEmbed（youtube.com/oembed）・googleapis.com・
// /api/crossword-video-info への通信が1本も無いことも見る。確かめるのはこの3つの宛先だけ。埋め込みの再生の読み込み（www.youtube.com・i.ytimg.com）と
// 字の形の読み込み（fonts.googleapis.com）は範囲の外
// 保存は作り物の受付係が受ける。受付係そのものの動きは check-owner-edit・check-fixtures（手元の受付係）で見る
// 盤は毎回組み合わせが変わるので、解く側で使う語は「盤に入った語」を画面から読んで選ぶ（決まった語を決め打ちしない）
// 2026-10-22 に消した確かめ:
//   - 「1 組み立ての動きが出た」: 案A には「組み合わせを探す」ボタンが無く、書くそばで裏で組むので、押して出る組み立ての動きが無くなった
// 使い方: node scripts/verify/crossword/check-stage1.mjs（引数なし。--skip-save を付けると作る→保存→解くを飛ばし、ヒントの選び方だけ見る）
// スクリーンショットの置き場は環境変数 OUT（古い名前の VERIFY_OUT も可）があればそこ、無ければ 一時置き場/hop-up-tools-verify/crossword/check-stage1/
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import path from 'node:path';
import { outDir, ROOT, watchStumbles, isolatedViteConfig } from './_lib.mjs';
import { SAMPLE, SAMPLE_WORDS, writeLines, waitBoard, openWordSheet, closeWordSheet, setClue, fillWords, wordKeys, openShare, readDraft } from './_create.mjs';

const SKIP_SAVE = process.argv.includes('--skip-save');
const PORT = 5192;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-stage1', process.env.VERIFY_OUT ? path.join(process.env.VERIFY_OUT, 'stage1') : undefined);
// 完成の線の②の画面の大きさ（iPhone SE の Safari で見える高さ 548px と、ふつうの幅のスマホ）
const SIZES = [{ width: 375, height: 548 }, { width: 390, height: 844 }];

let server = null;
function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
}
process.on('exit', stopServer);
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

// ---- 作り物の棚と受付係。保存された問題をここに持つ（ブラウザの記録が別でも同じ問題が開ける） ----
const asked = []; // 問い合わせてはいけない宛先への通信
const FORBIDDEN = /youtube\.com\/oembed|(?<!fonts\.)googleapis\.com|\/api\/crossword-video-info/;
const saved = new Map(); // id → { row, answers }
function storedRow(id, puzzle) {
  const { body } = puzzle;
  return {
    id, title: puzzle.title, genre: puzzle.genre, tags: puzzle.tags ?? [], is_beginner: puzzle.isBeginner === true, group_tags: [], play_count: 0,
    created_at: new Date().toISOString(),
    // 棚の本文には答えを入れない（本物の受付係と同じく、字の数だけにする）
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
  ctx.on('request', (req) => {
    if (FORBIDDEN.test(req.url())) asked.push(req.url());
  });
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
  hint: 'ヒント',
  dakuten: '゛',
  done: '決定',
  building: '読み込み中',
};

// 見本の4行のうち3行目（ネコ）を書き換え、1語足す。どちらもひらがなで囲み、カタカナにそろうかを見る。
// 書き換えた語は見本の語と「ジ」を、足した語は書き換えた語と「ヤ」（小さい字は大きい字と同じ扱い。Hop 決定 2026-10-05）を分け合うので、たいてい盤に入る。
// 行は「問題文→【答え】」の形にして、カギの下書きが問題文だけになるかも見る
const REWRITE = { a: 'じゃがいも', key: 'ジヤガイモ', clue: 'カレーに入れる芋' };
const ADD = { a: 'かぼちゃ', key: 'カボチヤ', clue: 'ハロウィンでくり抜かれる野菜' };
const sampleLines = SAMPLE.split('\n');
const EDITED = [sampleLines[0], sampleLines[1], `${REWRITE.clue}→【${REWRITE.a}】`, sampleLines[3], `${ADD.clue}→【${ADD.a}】`].join('\n');
const YT_HINT = 'https://youtu.be/dQw4w9WgXcQ?t=83'; // 時刻つき（83秒）
// 字の並びの中に ゛゜ の付く字と、もとが小さい字の両方があると、文字盤の濁点と小さい字の確かめが1語で済む
const hasVoiced = (w) => w.normalize('NFD') !== w;

const clickText = (page, text) => page.getByRole('button', { name: text, exact: false }).first().click();

const r = {};
const errs = [];
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const put = (size, label, ok) => {
  r[`${size.width}×${size.height} ${label}`] = ok;
};
await startServer();
const browser = await chromium.launch();

async function runFlow(size) {
  const tag = `${size.width}x${size.height}`;
  const ctxA = await browser.newContext({ viewport: size });
  await mockAll(ctxA);
  const pa = await ctxA.newPage();
  await watchStumbles(pa, errs, `作る画面 ${tag}`);
  await pa.goto(BASE + '/crossword/create', { waitUntil: 'networkidle' });
  await pa.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
  // ---- 1. 記録が空のブラウザ → 見本の4行 ----
  // ブラウザの記録は台本ごとに新しく作るので空（_lib.mjs が立てる「札を見た」印だけは入る）
  put(size, '1 記録が空のブラウザで開くと、書く欄に見本の4行が入っている', (await pa.locator('[data-bulk-text]').inputValue()) === SAMPLE);
  put(size, '1 見本の4行の答えが語の一覧に並ぶ', JSON.stringify(await wordKeys(pa)) === JSON.stringify(SAMPLE_WORDS));
  await waitBoard(pa);
  await pa.screenshot({ path: path.join(OUT, `${tag}-1a-sample.png`) });

  // ---- 1. 1行を書き換え1語足す → 盤が育つ ----
  await writeLines(pa, EDITED);
  const stats = await waitBoard(pa);
  const keys = await wordKeys(pa);
  put(size, `1 書き換えた語と足した語がカタカナにそろって語の一覧に出る（${keys.join('・')}）`, keys.includes(REWRITE.key) && keys.includes(ADD.key) && !keys.includes('ネコ'));
  const unplacedKeys = await pa.locator('[data-word-row]:has([data-word-unplaced])').evaluateAll((els) => els.map((e) => e.getAttribute('data-word-row')));
  const draft = await readDraft(pa);
  const boardKeys = (draft?.board ?? []).map((i) => i.id);
  put(size, `1 小さい盤が育ち、足した語が盤に入るか「置けなかった語」に出る（${stats}・盤 ${boardKeys.join('・')}${unplacedKeys.length ? '・置けなかった ' + unplacedKeys.join('・') : ''}）`,
    boardKeys.includes(ADD.key) || unplacedKeys.includes(ADD.key));
  const placed = keys.filter((k) => boardKeys.includes(k));
  await pa.screenshot({ path: path.join(OUT, `${tag}-1b-grown.png`) });

  // ---- 1. 語の窓でカギとヒント ----
  // 解く側で文字盤の濁点と小さい字を確かめる語（盤に入った語のうち、足した語→書き換えた語→ほかの ゛ のある語の順で選ぶ）
  const target = [ADD.key, REWRITE.key].find((k) => placed.includes(k)) ?? placed.find(hasVoiced) ?? placed[0];
  await openWordSheet(pa, REWRITE.key);
  put(size, '1 ひらがなの答えはカタカナにそろい、カギの下書きは「問題文→【答え】」の問題文だけ', (await pa.locator('[data-word-sheet] #cw-clue').inputValue()) === REWRITE.clue);
  await closeWordSheet(pa);
  // 時刻つきの YouTube のヒントは、ほかの語より先に手で付ける（fillWords はリンクを付けるので、そこに混ぜない）
  await openWordSheet(pa, target);
  const targetClue = (await pa.locator('[data-word-sheet] #cw-clue').inputValue()).trim() || `${target}の問題`;
  await setClue(pa, targetClue);
  await pa.locator('[data-word-sheet] #cw-hint').fill(YT_HINT);
  await pa.locator('[data-word-sheet] [data-hint-kind]').waitFor({ timeout: 10000 });
  const ytKind = (await pa.locator('[data-word-sheet] [data-hint-kind]').textContent())?.trim();
  await pa.waitForTimeout(500); // 窓が出る動き（0.15秒）が終わってから撮る
  await pa.screenshot({ path: path.join(OUT, `${tag}-1c-word-sheet.png`) });
  await closeWordSheet(pa);
  put(size, `1 語の窓で YouTube の URL がヒントになる（${ytKind}）`, ytKind === 'YouTube');
  await fillWords(pa, placed);
  const stillMissing = await pa.locator('[data-word-row]').evaluateAll((els, on) => els.filter((e) => on.includes(e.getAttribute('data-word-row')) && e.querySelector('[data-word-missing]:not([data-leaving])')).map((e) => e.getAttribute('data-word-row')), placed);
  put(size, `1 盤に入った全部の語（${placed.length}語）にカギとヒントが付いた${stillMissing.length ? '（残り ' + stillMissing.join('・') + '）' : ''}`, placed.length >= 2 && stillMissing.length === 0);
  put(size, '1 そろうと「公開の準備」が強い黒になる', (await pa.locator('[data-dock-share][data-strong]').count()) === 1);

  // ---- 1. 公開の準備 → 題名 → 共有する → 作り物の人間確認・保存 → URL ----
  await openShare(pa);
  const blocks = await pa.locator('[data-share-blocks]').getAttribute('data-share-blocks');
  put(size, '1 共有の窓に押せない理由が無い', blocks === 'ok');
  await pa.locator('#cw-title').fill(`検収用 ${stamp} ${tag}`);
  await pa.waitForTimeout(500);
  await pa.screenshot({ path: path.join(OUT, `${tag}-1d-share.png`) });
  const before = saved.size;
  await pa.locator('[data-share-sheet] [data-save]').click();
  const url = await pa.waitForFunction(() => {
    // 共有カードの URL は入力欄の中に出るので、欄の中身も合わせて探す
    const all = document.body.innerText + ' ' + [...document.querySelectorAll('input')].map((i) => i.value).join(' ');
    const m = all.match(/https?:\/\/\S+\/crossword\/[A-Za-z0-9_-]{8}/);
    return m ? m[0] : null;
  }, null, { timeout: 20000 }).then((h) => h.jsonValue(), () => null);
  await pa.screenshot({ path: path.join(OUT, `${tag}-1e-url.png`) });
  const last = [...saved.values()].at(-1);
  put(size, '1 保存して URL が出た', Boolean(url) && saved.size === before + 1);
  put(size, '1 保存の中身のジャンルは hello', last?.row.genre === 'hello');
  put(size, '1 保存の中身は盤に入った語と同じ数のカギで、どれもカギとヒントがある',
    !!last && last.row.body.clues.length === placed.length && last.row.body.clues.every((c) => c.clue && c.hint) && last.answers.every((a) => Array.isArray(a) && a.length > 0));
  put(size, '1 保存できたら作りかけの控えが消える', (await readDraft(pa)) === null);
  await ctxA.close();
  if (!url) return;

  // ---- 2〜4. 記録が空のブラウザでその URL を開いて解く ----
  const id = url.split('/').pop();
  const sol = solutionOf(id);
  const ctxB = await browser.newContext({ viewport: size });
  await mockAll(ctxB);
  const pb = await ctxB.newPage();
  await watchStumbles(pb, errs, `解く画面 ${tag}`);
  await pb.goto(url, { waitUntil: 'domcontentloaded' });
  // isVisible は待たないので、出るまで待つ形で見る
  put(size, '2 構築中の動きが出た', await pb.getByText(T.building).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false));
  await pb.waitForTimeout(2500);
  // 初回の遊び方を閉じる
  await pb.getByRole('button', { name: /このまま始める|始める！|はじめる|閉じる/ }).first().click().catch(() => {});
  const t1 = await pb.evaluate(() => (document.body.innerText.match(/\d+:\d\d/) || [''])[0]);
  await pb.waitForTimeout(2200);
  const t2 = await pb.evaluate(() => (document.body.innerText.match(/\d+:\d\d/) || [''])[0]);
  put(size, '2 タイマーが進む', Boolean(t1 && t2 && t1 !== t2));
  put(size, '2 最初は全部のマスが空（最初から解ける）', await pb.locator('[id^="cell-"]').evaluateAll((els) => els.length > 0 && els.every((e) => (e.getAttribute('aria-label') || '').endsWith('・空'))));
  await pb.screenshot({ path: path.join(OUT, `${tag}-2-play.png`) });

  // 盤に入った語のうち target のカギを開き、文字盤で1字ずつ入れる（゛ は書き順どおり字のあとに押し、直前の字を濁らせる。Hop 2026-10-06）
  // 小さい字は大きい字と同じ扱い（Hop 決定 2026-10-05）。文字盤に「小」は無い
  const ci = last.answers.findIndex((a) => a.join('') === target);
  const tc = last.row.body.clues[ci];
  await pb.getByText(tc.clue).first().click();
  await pb.locator('[data-coach="keypad"]').waitFor({ timeout: 10000 });
  put(size, '2 文字盤に「小」が無い', (await pb.getByRole('button', { name: '小', exact: true }).count()) === 0);
  for (const ch of target) {
    const parts = ch.normalize('NFD');
    await pb.locator('[data-coach="keypad"]').getByRole('button', { name: parts[0], exact: true }).first().click();
    if (parts.length > 1) await pb.locator('[data-coach="keypad"]').getByRole('button', { name: parts.charCodeAt(1) === 0x3099 ? T.dakuten : '゜', exact: true }).first().click();
  }
  const targetCells = [...target].map((ch, k) => ({ k: `${tc.startX + (tc.direction === 'horizontal' ? k : 0)},${tc.startY + (tc.direction === 'vertical' ? k : 0)}`, ch }));
  const labelOf = (k) => pb.locator(`#cell-${k.replace(',', '-')}`).first().getAttribute('aria-label');
  const typed = [];
  for (const { k } of targetCells) typed.push(String(await labelOf(k)).split('・').at(-1));
  put(size, `2 文字盤でカタカナと濁点が入り、小さい字は大きい字になる（${target} → ${typed.join('')}）`,
    typed.join('') === target && targetCells.every(({ k, ch }) => sol[k] === ch) && !/[ァィゥェォャュョッ]/.test(typed.join('')));

  // 3. ヒント: YouTube は止まった状態で時刻つき
  await clickText(pb, T.hint);
  await pb.waitForTimeout(1500);
  const src = await pb.locator('iframe[src*="youtube"]').first().getAttribute('src').catch(() => null);
  put(size, '3 YouTube のヒントが時刻つきで出て自動再生しない', Boolean(src && /start=83/.test(src) && !/autoplay=1/.test(src)));
  await pb.screenshot({ path: path.join(OUT, `${tag}-3-hint.png`) });
  await clickText(pb, T.hint);
  await clickText(pb, T.done);

  // 2. 開き直しても残る
  await pb.reload({ waitUntil: 'domcontentloaded' });
  await pb.waitForTimeout(3000);
  const kept = [];
  for (const { k } of targetCells) kept.push(String(await labelOf(k)).split('・').at(-1));
  put(size, `2 開き直しても入れた答えが残る（${kept.join('')}）`, kept.join('') === target);
  await ctxB.close();
}

// 下ごしらえ（2026-10-22）。手元の vite は画面が初めて読み込んだ部品をその場でまとめ直し、その時ページを読み込み直す。
// 確かめの途中で読み込み直されると落ちるので、確かめの前に作る画面・「試す」・解く画面（?debug=true の見本）を一度開いておく。ここでは何も確かめない
{
  const ctx = await browser.newContext({ viewport: SIZES[1] });
  await mockAll(ctx);
  const p = await ctx.newPage();
  await p.goto(BASE + '/crossword/create');
  await p.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
  await waitBoard(p).catch(() => {});
  await p.locator('[data-mode-tab="try"]').click();
  await p.locator('[data-trial] [id^="cell-"]').first().click({ timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(3000);
  await p.goto(BASE + '/crossword/create?debug=true');
  await p.locator('#cell-0-0').waitFor({ timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2000);
  await ctx.close();
}

if (SKIP_SAVE) console.log('飛ばす 作る→保存→解く: --skip-save が付いている');
else for (const size of SIZES) await runFlow(size);

// ---- 5. ヒントの選び方（作る画面の語の窓で確かめる） ----
{
  const ctx = await browser.newContext({ viewport: SIZES[1] });
  await mockAll(ctx);
  const pa = await ctx.newPage();
  await watchStumbles(pa, errs, '作る画面 ヒント');
  await pa.goto(BASE + '/crossword/create', { waitUntil: 'networkidle' });
  await writeLines(pa, '【ネコ】\n【コアラ】');
  await openWordSheet(pa, 'ネコ');
  const hintBox = pa.locator('[data-hint-sheet] #cw-hint');
  await hintBox.fill('https://youtu.be/dQw4w9WgXcQ?t=83');
  await pa.waitForTimeout(1500);
  const helloText = await pa.locator('[data-hint-sheet]').innerText();
  // 2026-10-21: 台帳に無い動画は問い合わせずにそのまま選び、公式チャンネルの動画か確かめる1文を添える（作り物の台帳は空＝どの動画も台帳に無い）
  r['5 台帳に無い YouTube は問い合わせずに通り、1文が出る'] =
    (await pa.locator('[data-hint-sheet] [data-hint-outside]').textContent().catch(() => null)) === 'ハロプロのグループや事務所の公式チャンネルの動画か、確かめてください。';
  r['5 チャンネル名は出ない'] = !/チャンネル:/.test(helloText);
  r['5 語の窓に公式の発信の案内'] = /ハロプロの公式の発信/.test(helloText);
  r['5 URL の時刻が開始時刻の欄に入る'] = (await pa.locator('#cw-hint-time').inputValue().catch(() => null)) === '1:23';
  await pa.getByLabel('ヒントを外す').click(); // 選ばれた札を外して欄に戻す
  await pa.waitForTimeout(300);
  await hintBox.fill('https://youtu.be/6Y2X6RxYnY');
  await pa.waitForTimeout(500);
  r['5 形の崩れた YouTube はリンクとして通さない'] = /YouTube の URL の形が違います/.test(await pa.locator('[data-hint-sheet]').innerText()) && (await pa.locator('[data-hint-kind]').count()) === 0;
  await pa.screenshot({ path: path.join(OUT, '5-hint-picker.png'), fullPage: true });
  await ctx.close();
}

await browser.close();
stopServer();
r['外に置いた試しの問題'] = 'なし（手元の作り物の棚だけ）';
r['oEmbed・googleapis.com・/api/crossword-video-info への通信が無い'] = asked.length === 0;
if (asked.length) console.log(`   問い合わせた宛先: ${asked[0]}`);
r['つまずき'] = errs.length ? errs : 'なし';
let fail = 0;
let pass = 0;
for (const [k, v] of Object.entries(r)) {
  if (k.startsWith('外に置いた')) { console.log(`   ${k}: ${v}`); continue; }
  const good = k === 'つまずき' ? v === 'なし' : v === true;
  if (!good) fail++;
  else pass++;
  console.log(`${good ? 'OK ' : 'NG '} ${k}${k === 'つまずき' ? ': ' + JSON.stringify(v) : ''}`);
}
const ok = fail === 0;
console.log(ok ? `すべてOK（合）OK ${pass}件` : `OK ${pass}件・NG ${fail}件（否）`);
console.log('写真: ' + OUT);
process.exit(ok ? 0 : 1);
