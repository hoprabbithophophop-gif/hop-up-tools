// 作る画面の案A「作る｜試す」（Hop 決定 2026-10-22）を、完成基準（DONE_CRITERIA.md）の②1〜5 に沿って手元の開発サーバーで通しで確かめる。
// 2026-10-22 に4段の流れの台本から書き直した。本番にもプレビューにも通信しない（2026-10-19 Hop「本番環境から見える形で検収用パズル登録を二度とするな」）。
// 手元の vite をこの台本が立ち上げ（口 5194・Supabase の住所は使わない仮の住所）、棚（/rest/v1）・受付係（/api）・人間確認（Turnstile）・
// 埋め込みの読み込みはブラウザの中で受け止める。保存と組み直しの更新は作り物が受けて、送られた中身を台本が読む。
// ②1〜5 は 375×548 と 390×844 の両方で流す（完成基準の決まり）。
//   (1) ②1 初めて作って配る: 記録が空のブラウザで見本の3行・見本の答え3つとカギの下書き（○・→ の書き方）→ 1行を書き換えて1語足す
//       → 小さい盤が育つ（足した語が盤か「置けなかった語」に出る）→ 語の窓で盤に入った全部の語にカギとヒント → 足りない言葉が消え「公開の準備」が黒くなる
//       → 公開の準備 → 題名が空なら「題名を入力してください。」→ 人間確認を通して保存（作り物）→ URL が出る・保存のジャンルは hello・作りかけが消える
//       （その URL で解けるかは check-stage1 が作り物の棚で見る）
//   (2) ②2 試してから直す: 広げた盤で語を長押しで動かして固定 →「試す」→ 盤を最後まで解いてハンコ →「作る」に戻ると書いた文・カギ・ヒント・盤（動かした位置と固定）がそのまま。
//       「試す」の間、棚（/rest/v1）と受付係（/api）への通信が0本（行き先を問わず数える）
//   (3) ②3 足りないまま共有しようとして止まる: 見本のまま公開の準備 → 押せない理由が「見本の行のままです。…」だけ・共有するが押せない【仮】
//       → 1行を書き換えてヒントの無い答えを2つ入れると「ヒントがあと2つ」で押せない → 1語ずつ埋めると数が減り、全部埋めると「全部の答えにカギとヒントが付きました。」で押せる。
//       カギを空にすると「カギがあと1つ」。（見本には 2026-10-25 から最初からヒントが付くので、足りない物は自分で書いた行で作る）
//       語が1つ・0の時は盤が無く「保存するには、語を2つ以上追加してください。」で押せない
//   (4) ②4 途中で閉じて続きから: 書き換え・カギ・ヒント・盤（固定）が開き直すと戻り、見本で上書きされず組み直さない。前の版（4段の版 version 2）の作りかけも開ける
//   (5) ②5 自分の問題を直す: ?edit= で「作る」から始まり、保存した盤・【語】の行・カギ・ヒント・題名が戻る → カギを1つ直して「更新する」→ 送る中身のジャンルは hello・直したカギ・
//       保存してあった YouTube のヒントの印を引き継ぐ・作りかけを書かない。遊ばれた後の問題はヒントを差し替える画面へ回る
//   (6) 固定を守る: 固定した語は語を足して盤が育っても固定の印と向きが残る
//   (7) 文字盤が出ている間（指で触る端末で書く欄・カギの欄を選んでいる間）は小さい盤と下の段が隠れ、離れると戻る。書く欄は見えたまま
//   (8) 動き: 盤が育つ時は新しく増えたマスだけに動きが付く・【 】で囲むと増えた語の行に下線が引かれる・足りない言葉が消える時に動く・
//       「動きを減らす」では作る画面の動きが0本
//   (9) 大きさ: 見出しと「作る｜試す」44px・小さい盤110px・下の段60px・横にはみ出さない
//   (10) 390×548 の写真（始まり・育った盤・広げた盤・語の窓・共有の窓・試す・解けた）
// 消した確かめ（4段にしか無い物）: 段の札4つと札での行き来・案1〜3から選んで「この盤で進む」・3の段の一覧・「組み合わせを探す」ボタン・
//   なぞる動きの見本（書いた行の一覧と一緒に無くなった）・4の窓の「カギの段へ戻る」（閉じるに替わった）・2 盤 3 カギの上の戻るボタンが無いこと
// 使い方: node scripts/verify/crossword/check-create-flow.mjs（引数なし）
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';
import { outDir, ROOT, leaveFirstVisitMarks, watchStumbles, isolatedViteConfig } from './_lib.mjs';
import {
  CREATE_MARKS, SAMPLE, SAMPLE_WORDS, SAMPLE_HINT_HREFS, writeLines, waitBoard, openWordSheet, closeWordSheet, setLinkHint, setClue, fillWords, openShare, closeShare,
  openBoard, closeBoard, toMode, currentMode, readDraft, draftCells, solveTrial, wordKeys, exampleUrl,
} from './_create.mjs';

// 札の印は台本が場面ごとに立てる
leaveFirstVisitMarks();

const PORT = 5194;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-create-flow');
const SIZES = [[375, 548], [390, 844]];

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
process.on('exit', stopServer);
async function startServer() {
  server = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', isolatedViteConfig(PORT), '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, VITE_SUPABASE_URL: MOCK_SUPA, VITE_SUPABASE_ANON_KEY: 'mock-anon-key' },
  });
  let log = '';
  server.stdout.on('data', (d) => {
    log += d;
    // 読み込み直しの合図は台本の出力にも出す（途中で落ちた時に読み込み直しかを見分ける）
    for (const l of String(d).split(/\r?\n/)) if (/reload|optimiz/i.test(l)) console.log(`    開発サーバー: ${l.replace(/\x1b\[[0-9;]*m/g, '').trim()}`);
  });
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

// 動かせる先は画面と同じ engine.ts の canMoveTo で決める（型だけ外して読み込む。論理は写さない。check-pin.mjs と同じやり方）
const engDir = path.join(OUT, 'engine');
mkdirSync(engDir, { recursive: true });
for (const name of ['types', 'engine']) {
  const src = readFileSync(path.join(ROOT, 'src', 'lib', 'crossword', `${name}.ts`), 'utf8');
  writeFileSync(path.join(engDir, `${name}.mjs`), stripTypeScriptTypes(src).replace(/from '\.\/(types)'/g, "from './$1.mjs'"));
}
const { canMoveTo, tryPlaceAll, shuffleByLength, buildGrid } = await import(pathToFileURL(path.join(engDir, 'engine.mjs')).href + `?t=${Date.now()}`);

// ---- 組み直し（?edit=）の見本。棚には置かない（受付係の作り物が答える） ----
const EDIT_ID = 'LocalCF9';
const EDIT_KEY = 'e'.repeat(64);
const editPuzzle = (playCount) => ({
  id: EDIT_ID, title: '組み直しの見本', genre: 'other', tags: ['見本'], is_beginner: true, group_tags: [], play_count: playCount,
  body: { version: 1, width: 2, height: 3, creatorName: '台本', clues: [
    { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: 'ニャーと鳴く動物', length: 2, hint: { kind: 'link', url: 'https://example.com/neko' } },
    // 保存の時点では台帳にあった動画（outside なし）。今の台帳には無い＝台帳から消えた動画として、組み直しで印を引き継ぐかを見る
    { clueIndex: 2, direction: 'vertical', startX: 1, startY: 0, clue: 'ユーカリの葉を食べる動物', length: 3, hint: { kind: 'youtube', videoId: 'goneVideo01', startSec: 7 } },
  ] },
});
const editAnswers = [['ネ', 'コ'], ['コ', 'ア', 'ラ']];

const browser = await chromium.launch();
const pageErrors = [];
const sent = { saves: [], updates: [], outside: [] };
const asked = [];
// 棚と受付係への通信（行き先を問わず）。「試す」の間に1本も無いことを数える
const shelfAndApi = [];
const FORBIDDEN = /youtube\.com\/oembed|(?<!fonts\.)googleapis\.com|\/api\/crossword-video-info/;
let editPlayCount = 0;

async function newPage({ size = [390, 844], marks = CREATE_MARKS, reducedMotion, touch = false, extra = {} } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: size[0], height: size[1] },
    deviceScaleFactor: 1,
    ...(touch ? { hasTouch: true, isMobile: true } : {}),
    ...(reducedMotion ? { reducedMotion } : {}),
  });
  await ctx.addInitScript((m) => {
    try {
      if (sessionStorage.getItem('__marks')) return; // 開き直した時は印を立て直さない
      sessionStorage.setItem('__marks', '1');
      for (const [k, v] of Object.entries(m)) localStorage.setItem(k, v);
    } catch { /* 無視 */ }
  }, { ...marks, ...extra });
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const u = new URL(route.request().url());
    const body = u.pathname.endsWith('/rpc/crossword_is_hidden') ? false : [];
    // 台帳は空（どの動画も台帳に無い）
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: JSON.stringify(body) });
  });
  await ctx.route('**/api/**', (r) => {
    sent.outside.push(r.request().url());
    return r.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });
  await ctx.route('**/api/crossword-save', (r) => {
    sent.saves.push(r.request().postDataJSON());
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: `LocalCF${sent.saves.length}` }) });
  });
  await ctx.route('**/api/crossword-owner-get', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, puzzle: editPuzzle(editPlayCount), answers: editAnswers }) }));
  await ctx.route('**/api/crossword-update', (r) => {
    sent.updates.push(r.request().postDataJSON());
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|www\.youtube-nocookie\.com|challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com|pagead2\.googlesyndication\.com)\//, (r) => r.fulfill({ status: 204, body: '' }));
  // 後に登録した route が先に当たるので、上の受け止めより後に置く
  await ctx.route('https://challenges.cloudflare.com/turnstile/**', (r) =>
    r.fulfill({ contentType: 'application/javascript', body: 'window.turnstile={render:function(el,o){setTimeout(function(){o.callback("check-create-flow")},50);return "w"},remove:function(){},reset:function(){}};' }),
  );
  const page = await ctx.newPage();
  await watchStumbles(page, pageErrors);
  page.on('request', (req) => {
    const u = req.url();
    if (FORBIDDEN.test(u)) asked.push(u);
    if (/\/rest\/v1\/|\/api\//.test(u)) shelfAndApi.push(`${req.method()} ${u}`);
  });
  return { ctx, page };
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const tag = (size) => `${size[0]}x${size[1]}`;
const missingOf = (page, key) => page.locator(`[data-word-row="${key}"] [data-word-missing]:not([data-leaving])`).evaluateAll((els) => els.map((e) => e.getAttribute('data-word-missing')));

// 見本の答えのカギの下書き（○は答えの字数ぶん。→ の書き方は問題文だけ）。見本は 2026-10-25 に3行（キララ・アニマルランド・ドイフウカ）に替わった
const SAMPLE_DRAFTS = {
  キララ: '米村○○○はOCHA NORMA兼DECA☆BEATのリーダー',
  アニマルランド: '「生きるってマジMy Life」の歌詞が印象的な研修生曲',
  ドイフウカ: 'つばきファクトリーの大阪出身でトマトが好きなメンバーは？',
};
// ②1 の書き換え: 1行目を書き換え、ランドセル（ラ・ン・ドで交差できる）の行を足す
const ADDED = 'ランドセル';
const LINE1 = '米村【キララ】はOCHA NORMA兼DECA☆BEATのリーダー';
const LINE1_EDITED = '米村【キララ】はOCHA NORMAのリーダー';
const EDITED = SAMPLE.replace(LINE1, LINE1_EDITED) + `\n【${ADDED}】を背負った`;

// 広げた盤で、語を長押しで持ち上げて (dx, dy) マスずらして離す。置ける印（data-placeable="yes"）を見てから離す
const cellsOfItem = (it) => Array.from({ length: it.length }, (_, i) => (it.direction === 'horizontal' ? [it.startX + i, it.startY] : [it.startX, it.startY + i]));
async function dragWord(page, board, it, dx, dy) {
  const owners = new Map();
  for (const o of board) for (const [x, y] of cellsOfItem(o)) owners.set(`${x},${y}`, [...(owners.get(`${x},${y}`) || []), o.id]);
  const own = cellsOfItem(it).find(([x, y]) => owners.get(`${x},${y}`).length === 1) || [it.startX, it.startY];
  const minX = Math.min(...board.map((o) => o.startX));
  const minY = Math.min(...board.map((o) => o.startY));
  const w = Math.max(...board.map((o) => (o.direction === 'horizontal' ? o.startX + o.length : o.startX + 1))) - minX;
  const layer = page.locator('[data-board-sheet] [data-move-layer]');
  await layer.scrollIntoViewIfNeeded();
  const rect = await layer.boundingBox();
  const cs = rect.width / (w + 2); // 盤の周りの余白（MOVE_MARGIN）は1マス
  const px = rect.x + (1 + own[0] - minX + 0.5) * cs;
  const py = rect.y + (1 + own[1] - minY + 0.5) * cs;
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.waitForTimeout(500); // 長押し（300ms）より長く
  const lifted = await page.locator('[data-ghost]').waitFor({ timeout: 3000 }).then(() => true, () => false);
  if (!lifted) {
    await page.mouse.up();
    return false;
  }
  await page.mouse.move(px + dx * cs, py + dy * cs, { steps: 12 });
  await page.waitForTimeout(150);
  const ok = (await page.locator('[data-ghost]').getAttribute('data-placeable')) === 'yes';
  await page.mouse.up();
  await page.waitForTimeout(300);
  return ok;
}
const findMove = (board, skip = []) => {
  const tries = [];
  for (let r = 1; r <= 4; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) tries.push([dx, dy]);
  for (const it of board) {
    if (skip.includes(it.id)) continue;
    for (const [dx, dy] of tries) if (canMoveTo(board, it.uuid, it.startX + dx, it.startY + dy)) return { it, dx, dy };
  }
  return null;
};
// 広げた盤で1語を動かして固定する。探して出た盤に動かせる語が無い時は、同じ engine で組んだ動かせる盤を作りかけとして置いて開き直す
async function pinOne(page, words) {
  let d = await readDraft(page);
  if (!findMove(d.board)) {
    const items = words.map((w) => ({ id: w, question: '', answer: Array.from(w) }));
    let loose = null;
    for (let t = 0; t < 500 && !loose; t++) {
      const b = buildGrid(tryPlaceAll(shuffleByLength(items))).items;
      if (b.length === words.length && findMove(b)) loose = b;
    }
    const board = loose.map(({ id, uuid, answer, direction, startX, startY, length }) => ({ id, uuid, question: '', answer, direction, startX, startY, length, pinned: false }));
    await page.evaluate((x) => localStorage.setItem('crossword_draft', JSON.stringify(x)), { ...d, board, proposals: null, picked: null });
    await page.reload();
    await waitBoard(page);
    console.log('    探して出た盤では動かせる語が無いので、同じ engine で組んだ盤を作りかけから出した');
    d = await readDraft(page);
  }
  await openBoard(page);
  await page.locator('[data-board-sheet] [data-move-layer]').waitFor({ timeout: 10000 });
  const mv = findMove(d.board);
  const ok = await dragWord(page, d.board, mv.it, mv.dx, mv.dy);
  const moved = (await readDraft(page)).board.find((i) => i.id === mv.it.id);
  await closeBoard(page);
  return ok && moved?.pinned ? moved : null;
}

try {
  await startServer();
  // 下ごしらえ: 開発サーバーは、画面が初めて読み込んだ部品をその場でまとめ直し、まとめ直すとページを読み込み直す。
  // 確かめの途中で読み込み直されると書いた中身が消えるので、先に作る画面と「試す」を一度開いて、部品をまとめ終えてから確かめる
  {
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/crossword/create`);
    await waitBoard(page);
    await toMode(page, 'try');
    await page.locator('[data-trial] [id^="cell-"]').first().waitFor({ timeout: 30000 });
    await page.locator('[data-trial] [id^="cell-"]').first().click();
    await page.waitForTimeout(3000);
    await ctx.close();
  }

  for (const size of SIZES) {
    const T = tag(size);
    // ===== (1) ②1 初めて作って配る ／ (2) ②2 試してから直す =====
    {
      const { ctx, page } = await newPage({ size });
      await page.goto(`${BASE}/crossword/create`);
      await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
      check((await page.locator('[data-bulk-text]').inputValue()) === SAMPLE, `${T} (1) 記録が空のブラウザでは見本の3行が入っている`);
      check(JSON.stringify(await wordKeys(page)) === JSON.stringify(SAMPLE_WORDS), `${T} (1) 語の一覧は見本の答え3つ（${(await wordKeys(page)).join('・')}）`);
      const stats0 = await waitBoard(page);
      check(/^答え3つ・\d+マス・交わる所\d+$/.test(stats0), `${T} (1) 見本の3語で盤が組める（${stats0}）`);
      check(await currentMode(page) === 'make', `${T} (1) 「作る」から始まる`);
      for (const [k, want] of Object.entries(SAMPLE_DRAFTS)) {
        await openWordSheet(page, k);
        const got = await page.locator('#cw-clue').inputValue();
        check(got === want, `${T} (1) 「${k}」のカギの下書きは「${got}」`);
        // 見本の答えには最初からヒントが付いている（2026-10-25）。ヒントの欄は出ず、付いたヒントの行き先が出る
        const href = await page.locator('[data-word-sheet] a[data-hint-state]').getAttribute('href').catch(() => null);
        check(href === SAMPLE_HINT_HREFS[k] && (await page.locator('[data-word-sheet] #cw-hint').count()) === 0, `${T} (1) 見本の「${k}」には最初からヒントが付いていて、ヒントの欄は出ない（${href}）`);
        await closeWordSheet(page);
      }
      const sampleMissing = [];
      for (const k of SAMPLE_WORDS) sampleMissing.push(...(await missingOf(page, k)).map((m) => `${k}:${m}`));
      check(sampleMissing.length === 0, `${T} (1) 見本の答えには足りない言葉（カギがまだ・ヒントがまだ）が出ない（${sampleMissing.join(' ') || 'なし'}）`);
      await page.screenshot({ path: path.join(OUT, `${T}-1-start.png`) });

      await writeLines(page, EDITED);
      const stats1 = await waitBoard(page);
      const d1 = await readDraft(page);
      const inBoard = d1.board.some((i) => i.id === ADDED);
      const unplacedTag = await page.locator(`[data-word-row="${ADDED}"] [data-word-unplaced]`).count();
      check(inBoard || unplacedTag === 1, `${T} (1) 足した語「${ADDED}」は盤に入るか「置けなかった語」に出る（盤 ${inBoard}・札 ${unplacedTag}・${stats1}）`);
      check(await page.locator('[data-dock-share][data-strong]').count() === 0, `${T} (1) 足りない物がある間は「公開の準備」が灰`);
      await page.screenshot({ path: path.join(OUT, `${T}-1-grown.png`) });

      // 盤に入った全部の語にカギとヒントを付ける（カギは下書きのまま。空なら書く）
      const placed = d1.board.map((i) => i.id);
      await fillWords(page, placed, { clueOf: (k) => `${k}の問題` });
      const left = [];
      for (const k of placed) left.push(...(await missingOf(page, k)).map((m) => `${k}:${m}`));
      check(left.length === 0, `${T} (1) 盤に入った語の足りない言葉が全部消える（残り ${left.join(' ') || 'なし'}）`);
      // 台本がヒントを付けた語（見本の答えでない語）があればそれ、無ければ見本の答えで見る
      const linkKey = placed.find((k) => !SAMPLE_WORDS.includes(k)) ?? placed[0];
      const linkWant = SAMPLE_WORDS.includes(linkKey) ? SAMPLE_HINT_HREFS[linkKey] : exampleUrl(linkKey);
      await openWordSheet(page, linkKey);
      const link = page.locator('[data-word-sheet] a[data-hint-state]');
      check((await link.getAttribute('href')) === linkWant && (await link.getAttribute('target')) === '_blank', `${T} (1) 語の窓でヒントの行き先を別のタブで開ける（${linkKey}・${await link.getAttribute('href')}）`);
      check((await page.locator('[data-word-sheet] button', { hasText: '次の語' }).count()) === 0, `${T} (1) 語の窓に「次の語 →」は無い`);
      await page.screenshot({ path: path.join(OUT, `${T}-1-sheet.png`) });
      await closeWordSheet(page);
      check(await page.locator('[data-dock-share][data-strong]').count() === 1, `${T} (1) そろうと「公開の準備」が黒くなる`);

      // (2) 広げた盤で1語を動かして固定 → 試す → 作るに戻る
      const words = d1.board.map((i) => i.id);
      const pinnedItem = await pinOne(page, words);
      check(!!pinnedItem, `${T} (2) 広げた盤で語を長押しで動かして固定できた（${pinnedItem ? `${pinnedItem.id} ${pinnedItem.direction} ${pinnedItem.startX},${pinnedItem.startY}` : 'できない'}）`);
      // 動かした盤に入った語が変わっていれば埋め直す
      await fillWords(page, (await readDraft(page)).board.map((i) => i.id));
      const before = await readDraft(page);
      const textBefore = await page.locator('[data-bulk-text]').inputValue();
      const netAt = shelfAndApi.length;
      await toMode(page, 'try');
      await page.locator('[data-trial] [id^="cell-"]').first().waitFor({ timeout: 15000 });
      await page.screenshot({ path: path.join(OUT, `${T}-2-try.png`) });
      await solveTrial(page, draftCells(before));
      const stamped = await page.locator('[data-trial] [data-stamp]').waitFor({ timeout: 6000 }).then(() => true, () => false);
      check(stamped, `${T} (2) 「試す」で盤を最後まで解くとハンコが押される`);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT, `${T}-2-solved.png`) });
      const during = shelfAndApi.slice(netAt);
      check(during.length === 0, `${T} (2) 「試す」の間、棚と受付係への通信が0本${during.length ? `（${during.slice(0, 3).join(' / ')}）` : ''}`);
      check(await page.evaluate(() => Object.keys(localStorage).filter((k) => /^crossword_(progress|played|cleared)_/.test(k)).length) === 0, `${T} (2) 「試す」は端末に途中経過・遊んだ印・解き終えた印を残さない`);
      await toMode(page, 'make');
      const after = await readDraft(page);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      check((await page.locator('[data-bulk-text]').inputValue()) === textBefore, `${T} (2) 「作る」に戻ると書いた文がそのまま`);
      check(same(after.clues, before.clues) && same(after.hints, before.hints), `${T} (2) 「作る」に戻るとカギとヒントがそのまま`);
      check(same(after.board, before.board), `${T} (2) 「作る」に戻ると盤（動かした位置と固定）がそのまま`);

      // (1) 公開の準備 → 題名が空 → 保存
      await openShare(page);
      check((await page.locator('[data-share-blocks]').getAttribute('data-share-blocks')) === 'ok', `${T} (1) 共有の窓は「${await page.locator('[data-share-blocks]').textContent()}」`);
      const savesBefore = sent.saves.length;
      await page.locator('[data-save]').click();
      check(await page.locator('[data-title-error]').isVisible(), `${T} (1) 題名が空なら「題名を入力してください。」`);
      await page.locator('#cw-title').fill('台本の問題');
      await page.screenshot({ path: path.join(OUT, `${T}-1-share.png`) });
      await page.locator('[data-save]').click();
      await page.locator('#cw-share-url').waitFor({ timeout: 20000 });
      const url = await page.locator('#cw-share-url').inputValue();
      const saved = sent.saves[savesBefore];
      check(/\/crossword\/LocalCF\d+$/.test(url), `${T} (1) 保存すると URL が出る（${url}）`);
      check(saved?.puzzle?.genre === 'hello' && saved?.puzzle?.body?.clues?.length === after.board.length, `${T} (1) 保存の中身のジャンルは hello・盤の語の数だけカギがある（${saved?.puzzle?.genre}・${saved?.puzzle?.body?.clues?.length}）`);
      check((await readDraft(page)) === null, `${T} (1) 保存できたら作りかけが消える`);
      await page.screenshot({ path: path.join(OUT, `${T}-1-saved.png`) });
      // 公開の呼び方（Hop 決定 2026-10-23）: 窓の見出しとボタンは「公開する」、保存できた後の見出しは「公開しました」・「次の問題を作る」がある
      check((await page.locator('#cw-share-title').textContent()) === '公開しました' && (await page.locator('[data-next-puzzle]').textContent()) === '次の問題を作る', `${T} (1) 保存できた後の窓の見出しは「${await page.locator('#cw-share-title').textContent()}」・「次の問題を作る」がある`);
      // 「次の問題を作る」: 書いた文・カギ・ヒント・題名・タグ・初めての人向けが空になり、作った人の名前だけ残る。書く欄は見本でなく空（Hop 決定 2026-10-23）
      await page.locator('[data-next-puzzle]').click();
      await page.locator('#cw-share-title').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(400);
      const nextDraft = await readDraft(page);
      const nextText = await page.locator('[data-bulk-text]').inputValue();
      check(nextText === '' && (await page.locator('[data-word-row]').count()) === 0 && (!nextDraft || (Object.keys(nextDraft.clues ?? {}).length === 0 && Object.keys(nextDraft.hints ?? {}).length === 0 && !nextDraft.title && (nextDraft.tags ?? []).length === 0 && !nextDraft.isBeginner)), `${T} (1) 「次の問題を作る」で書く欄（見本でなく空）・カギ・ヒント・題名・タグ・初めての人向けが空になる（欄 ${JSON.stringify(nextText)}・作りかけ ${JSON.stringify(nextDraft && { t: nextDraft.title, tags: nextDraft.tags, c: Object.keys(nextDraft.clues ?? {}).length })}）`);
      check(await page.evaluate(() => !!document.activeElement?.hasAttribute('data-bulk-text')), `${T} (1) 「次の問題を作る」の後は書く欄から始まる`);
      check((await page.locator('[data-bulk-insert-sample]').count()) === 1, `${T} (1) 空の書く欄の下に「見本を入れる」が出る`);
      await ctx.close();
    }

    // ===== (3) ②3 足りないまま共有しようとして止まる =====
    {
      const { ctx, page } = await newPage({ size });
      await page.goto(`${BASE}/crossword/create`);
      await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
      await waitBoard(page);
      await openShare(page);
      const blocks = await page.locator('[data-share-blocks]').textContent();
      // 見本の行のままでは公開できない【仮】（2026-10-25）。見本はカギもヒントもそろっているので、理由はこれ1つだけ
      check(blocks === '見本の行のままです。1行でも書き換えると公開できます。' && (await page.locator('[data-save]').isDisabled()), `${T} (3) 見本のままだと押せない理由は「${blocks}」だけで、共有するが押せない`);
      check((await page.locator('[data-dock-share][data-strong]').count()) === 0, `${T} (3) 見本のままの間は「公開の準備」が灰`);
      const foot = await page.locator('[data-save]').boundingBox();
      check(foot && foot.y + foot.height <= size[1] + 0.5, `${T} (3) 共有の窓の「共有する」と押せない理由が窓の下に見えている（下端 ${foot && Math.round(foot.y + foot.height)}）`);
      await page.screenshot({ path: path.join(OUT, `${T}-3-missing.png`) });
      await closeShare(page);
      // 1行目を書き換え（キララ → ランドセル）、1行足す（ドラマ）。どちらも見本のヒントが無い答え。ラ・ン・ド・マをアニマルランドと分け合うので、たいてい盤に入る
      const SCEN3 = ['【ランドセル】を背負った', ...SAMPLE.split('\n').slice(1), '【ドラマ】を見た'].join('\n');
      await writeLines(page, SCEN3);
      await waitBoard(page);
      let keys = [];
      for (let i = 0; i < 20; i++) {
        keys = (await readDraft(page))?.board?.map((x) => x.id) ?? [];
        if (keys.includes('ランドセル') && keys.includes('ドラマ')) break;
        await page.waitForTimeout(250);
      }
      const noHint = keys.filter((k) => !SAMPLE_WORDS.includes(k));
      check(noHint.length === 2, `${T} (3) 下ごしらえ: ヒントの無い答え2つ（ランドセル・ドラマ）が盤に入った（盤 ${keys.join('・')}）`);
      await openShare(page);
      const b2 = await page.locator('[data-share-blocks]').textContent();
      check(b2.startsWith(`ヒントがあと${noHint.length}つ`) && !b2.includes('見本の行のまま') && (await page.locator('[data-save]').isDisabled()), `${T} (3) 1行を書き換えた後、ヒントの無い答えが残っていると「${b2}」で押せない（見本の理由は消える）`);
      await closeShare(page);
      await fillWords(page, noHint.slice(0, -1));
      await openShare(page);
      check((await page.locator('[data-share-blocks]').textContent()).startsWith('ヒントがあと1つ') && (await page.locator('[data-save]').isDisabled()), `${T} (3) 1語残すと「ヒントがあと1つ」で押せない`);
      await closeShare(page);
      await fillWords(page, noHint.slice(-1));
      await openShare(page);
      check((await page.locator('[data-share-blocks]').textContent()) === '全部の答えにカギとヒントが付きました。' && (await page.locator('[data-save]').isEnabled()), `${T} (3) 全部埋めると「全部の答えにカギとヒントが付きました。」で押せる`);
      await closeShare(page);
      await openWordSheet(page, keys[0]);
      await setClue(page, '');
      await closeWordSheet(page);
      check(JSON.stringify(await missingOf(page, keys[0])) === '["clue"]', `${T} (3) カギを空にすると語の行に「カギがまだ」`);
      await openShare(page);
      check((await page.locator('[data-share-blocks]').textContent()).startsWith('カギがあと1つ') && (await page.locator('[data-save]').isDisabled()), `${T} (3) 共有の窓は「カギがあと1つ」で押せない`);
      await closeShare(page);
      for (const [text, label] of [['【ネコ】', '語が1つ'], ['', '語が0']]) {
        await writeLines(page, text);
        await page.waitForTimeout(800);
        const status = await page.locator('[data-mini-status]').textContent().catch(() => '');
        await openShare(page);
        const b = await page.locator('[data-share-blocks]').textContent();
        check(b.includes('答えを2つ以上書くと、マス目ができます。') && (await page.locator('[data-save]').isDisabled()) && (await page.locator('[data-dock-share][data-strong]').count()) === 0,
          `${T} (3) ${label}の時は盤が無く共有できない（小さい盤「${status}」・理由「${b}」）`);
        await closeShare(page);
      }
      await ctx.close();
    }

    // ===== (4) ②4 途中で閉じて続きから ／ (6) 固定を守る =====
    {
      const { ctx, page } = await newPage({ size });
      await page.goto(`${BASE}/crossword/create`);
      await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
      await waitBoard(page);
      await writeLines(page, EDITED);
      await waitBoard(page);
      const d0 = await readDraft(page);
      // 窓でカギを直すと、書く欄のその行も「直したカギ→【答え】」に書き換わる（Hop 決定 2026-10-25）
      await openWordSheet(page, 'キララ');
      // ヒントを先に付け替えてからカギを直す。見本のヒントが付いた答えは、窓でカギを直した後だと「ヒントを外す」が効かない（画面の側の不具合と見て報告した。2026-10-25）
      await setLinkHint(page, exampleUrl('キララ'));
      await setClue(page, '台本で書き直したカギ');
      await closeWordSheet(page);
      const textFixed = EDITED.replace(LINE1_EDITED, '台本で書き直したカギ→【キララ】');
      check((await page.locator('[data-bulk-text]').inputValue()) === textFixed, `${T} (4) 窓でカギを直すと書く欄の行が「台本で書き直したカギ→【キララ】」になる`);
      const pinned = await pinOne(page, d0.board.map((i) => i.id));
      check(!!pinned, `${T} (6) 広げた盤で1語を固定できた`);
      const saved = await readDraft(page);
      await page.close();
      const page2 = await ctx.newPage();
      await watchStumbles(page2, pageErrors);
      await page2.goto(`${BASE}/crossword/create`);
      await page2.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
      await page2.waitForTimeout(1500);
      const back = await readDraft(page2);
      check((await page2.locator('[data-bulk-text]').inputValue()) === textFixed, `${T} (4) 開き直すと書いた文（窓で直したカギの行を含む）が戻り、見本の3行で上書きされない`);
      await openWordSheet(page2, 'キララ');
      const clueBack = await page2.locator('#cw-clue').inputValue();
      await closeWordSheet(page2);
      check(clueBack === '台本で書き直したカギ' && back.hints['キララ']?.url === exampleUrl('キララ'), `${T} (4) カギとヒントが戻る（カギ「${clueBack}」）`);
      check(JSON.stringify(back.board) === JSON.stringify(saved.board), `${T} (4) 盤（固定した位置）が戻り、組み直さない`);
      check((await page2.locator('[data-mini-stats]').textContent()) !== '', `${T} (4) 開いてすぐ小さい盤に盤が出る`);
      await page2.screenshot({ path: path.join(OUT, `${T}-4-resumed.png`) });
      // (6) 語を足して盤が育っても固定の印と向きが残る
      await writeLines(page2, `${textFixed}\n【ライオン】がいる`);
      await waitBoard(page2);
      const grown = await readDraft(page2);
      const p = grown.board.find((i) => i.id === pinned?.id);
      check(!!p && p.pinned === true && p.direction === pinned.direction, `${T} (6) 語を足して盤が育っても固定した語の固定と向きが残る（${p ? `${p.id} ${p.direction} 固定=${p.pinned}` : 'なし'}）`);
      await ctx.close();
    }

    // ===== (4) 前の版（4段の版 version 2）の作りかけも開ける =====
    {
      const text = '【ネコ】\n【コアラ】はユーカリを食べる';
      const v2 = {
        version: 2, step: 3, bulkText: text, collapsed: true,
        hints: { ネコ: { kind: 'link', url: 'https://example.com/neko' }, コアラ: { kind: 'youtube', videoId: 'abcdefghijk', startSec: 5, outside: true } },
        hintLabels: {}, clues: { ネコ: 'ニャーと鳴く動物' },
        board: [
          { id: 'ネコ', uuid: 'ネコ', question: '', answer: ['ネ', 'コ'], direction: 'horizontal', startX: 0, startY: 0, length: 2, pinned: false },
          { id: 'コアラ', uuid: 'コアラ', question: '', answer: ['コ', 'ア', 'ラ'], direction: 'vertical', startX: 1, startY: 0, length: 3, pinned: true },
        ],
        proposals: null, picked: null, boardSig: 'コアラ:コアラ|ネコ:ネコ', searchedSig: 'コアラ:コアラ|ネコ:ネコ', title: '前の版', creatorName: '', tags: [], isBeginner: false,
      };
      const { ctx, page } = await newPage({ size, extra: { crossword_draft: JSON.stringify(v2) } });
      await page.goto(`${BASE}/crossword/create`);
      await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      const d = await readDraft(page);
      // 窓の側だけに持っていたカギは、書く欄の行に移る（Hop 決定 2026-10-25）
      const textMoved = 'ニャーと鳴く動物→【ネコ】\n【コアラ】はユーカリを食べる';
      const textNow = await page.locator('[data-bulk-text]').inputValue();
      check(textNow === textMoved, `${T} (4) 前の版の作りかけの文が戻り、窓の側のカギは書く欄の行に移る（${textNow.split('\n').join(' ／ ')}）`);
      check(JSON.stringify(d.board) === JSON.stringify(v2.board) && d.version === 3, `${T} (4) 前の版の盤がそのまま戻り、新しい版で残し直す（版 ${d.version}）`);
      check(JSON.stringify(await missingOf(page, 'ネコ')) === '[]' && JSON.stringify(await missingOf(page, 'コアラ')) === '[]', `${T} (4) 前の版のカギとヒントが戻る（コアラは○だけの下書きでなく「○○○はユーカリを食べる」）`);
      await ctx.close();
    }

    // ===== (5) ②5 自分の問題を直す =====
    {
      editPlayCount = 0;
      const mine = JSON.stringify([{ id: EDIT_ID, key: EDIT_KEY, title: '組み直しの見本', createdAt: Date.now() }]);
      const { ctx, page } = await newPage({ size, extra: { crossword_my_puzzles: mine } });
      await page.goto(`${BASE}/crossword/create?edit=${EDIT_ID}`);
      await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
      await page.waitForTimeout(800);
      check((await page.locator('h1').first().textContent()) === '問題の組み直し' && (await currentMode(page)) === 'make', `${T} (5) 組み直しの画面になり「作る」から始まる`);
      // 組み直しで開くと、書く欄の行は「カギ→【答え】」の形で入る（Hop 決定 2026-10-25。前は【答え】だけ）
      const editText = await page.locator('[data-bulk-text]').inputValue();
      check(editText === 'ニャーと鳴く動物→【ネコ】\nユーカリの葉を食べる動物→【コアラ】', `${T} (5) 語は「カギ→【答え】」の行として戻る（${editText.split('\n').join(' ／ ')}）`);
      check((await page.locator('[data-mini-stats]').textContent()) === '答え2つ・4マス・交わる所1', `${T} (5) 保存した時の盤が出る（${await page.locator('[data-mini-stats]').textContent()}）`);
      await openWordSheet(page, 'コアラ');
      check((await page.locator('#cw-clue').inputValue()) === 'ユーカリの葉を食べる動物', `${T} (5) カギが戻る`);
      await setClue(page, 'ユーカリを食べる動物（直した）');
      await closeWordSheet(page);
      await openShare(page);
      check((await page.locator('#cw-title').inputValue()) === '組み直しの見本' && (await page.locator('#cw-creator').inputValue()) === '台本', `${T} (5) 題名・作った人が戻る`);
      const btn = page.locator('[data-share-sheet] [data-save]');
      check((await btn.textContent()) === '更新する', `${T} (5) 保存のボタンは「${await btn.textContent()}」`);
      const upBefore = sent.updates.length;
      await btn.click();
      await page.getByText('この問題を更新しました。URL は変わりません。').waitFor({ timeout: 20000 }).catch(() => {});
      check((await bodyText(page)).includes('この問題を更新しました。URL は変わりません。'), `${T} (5) 「この問題を更新しました。URL は変わりません。」`);
      check((await page.locator('#cw-share-url').inputValue()).endsWith(`/crossword/${EDIT_ID}`), `${T} (5) 同じ URL のまま`);
      const up = sent.updates[upBefore];
      const clues = up?.puzzle?.body?.clues ?? [];
      check(up?.id === EDIT_ID && up?.puzzle?.genre === 'hello', `${T} (5) 更新で送る中身のジャンルは hello（元の問題は other）`);
      check(clues.some((c) => c.clue === 'ユーカリを食べる動物（直した）'), `${T} (5) 直したカギが送られる`);
      const koara = clues.find((c) => c.hint?.kind === 'youtube' && c.hint.videoId === 'goneVideo01')?.hint;
      check(koara && koara.startSec === 7 && !('outside' in koara), `${T} (5) 保存してあった YouTube のヒントは保存してあった印（outside なし）のまま送る（${JSON.stringify(koara)}）`);
      check((await readDraft(page)) === null, `${T} (5) 組み直しの間は作りかけを書かない`);
      await ctx.close();
      // 遊ばれた後の問題はヒントを差し替える画面へ回る
      editPlayCount = 1;
      const v = await newPage({ size, extra: { crossword_my_puzzles: mine } });
      await v.page.goto(`${BASE}/crossword/create?edit=${EDIT_ID}`);
      const moved = await v.page.waitForURL(new RegExp(`/crossword/hints/${EDIT_ID}$`), { timeout: 15000 }).then(() => true, () => false);
      check(moved, `${T} (5) 遊ばれた後の問題はヒントを差し替える画面へ回る（${v.page.url()}）`);
      await v.ctx.close();
      editPlayCount = 0;
    }
  }

  // ===== (7) 文字盤が出ている間は小さい盤と下の段を隠す（指で触る端末） =====
  {
    const { ctx, page } = await newPage({ size: [375, 548], touch: true });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await waitBoard(page);
    check(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), '(7) 指で触る端末として開いている（pointer: coarse）');
    await page.locator('[data-bulk-text]').focus();
    await page.waitForTimeout(400);
    const up = await page.evaluate(() => ({
      mini: document.querySelector('[data-mini]').getBoundingClientRect().height,
      dock: getComputedStyle(document.querySelector('[data-dock]')).transform,
      area: (() => { const r = document.querySelector('[data-bulk-text]').getBoundingClientRect(); return [r.top, r.bottom]; })(),
      focused: document.activeElement?.hasAttribute('data-bulk-text'),
    }));
    check(up.mini === 0 && up.dock !== 'none' && up.focused && up.area[0] >= 44 && up.area[0] < 548, `(7) 書く欄を選ぶと小さい盤と下の段が隠れ、書く欄は見えたまま（${JSON.stringify(up)}）`);
    await page.screenshot({ path: path.join(OUT, '375x548-7-keyboard.png') });
    await page.locator('[data-bulk-text]').blur();
    await page.waitForTimeout(400);
    const down = await page.evaluate(() => ({ mini: document.querySelector('[data-mini]').getBoundingClientRect().height, dock: getComputedStyle(document.querySelector('[data-dock]')).transform }));
    check(down.mini === 110 && down.dock === 'none', `(7) 離れると戻る（${JSON.stringify(down)}）`);
    await openWordSheet(page, 'キララ');
    await page.locator('#cw-clue').focus();
    await page.waitForTimeout(400);
    const clueUp = await page.evaluate(() => document.querySelector('[data-mini]').getBoundingClientRect().height);
    check(clueUp === 0, `(7) カギの欄を選んでいる間も小さい盤が隠れる（${clueUp}）`);
    await ctx.close();
    // パソコン（指で触らない端末）では隠さない
    const pc = await newPage({ size: [1280, 800] });
    await pc.page.goto(`${BASE}/crossword/create`);
    await pc.page.locator('[data-bulk-text]').focus();
    await pc.page.waitForTimeout(400);
    check((await pc.page.evaluate(() => document.querySelector('[data-mini]').getBoundingClientRect().height)) === 110, '(7) パソコンでは書いている間も小さい盤を隠さない（盤が育つのを見られる）');
    await pc.ctx.close();
  }

  // ===== (8) 動き =====
  {
    const { ctx, page } = await newPage({ size: [390, 844] });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await waitBoard(page);
    // 盤に新しく増えたマスだけに動き（盤が組み上がった瞬間を見張る）
    await page.evaluate(() => {
      window.__fx = null;
      const host = document.querySelector('[data-mini-board]');
      new MutationObserver(() => {
        const cells = [...host.querySelectorAll('[data-cell]')];
        const moving = cells.filter((c) => c.getAnimations().length > 0);
        if (moving.length && !window.__fx) window.__fx = { moving: moving.length, total: cells.length };
      }).observe(host, { subtree: true, childList: true, attributes: true });
    });
    await page.locator('[data-bulk-text]').fill(`${SAMPLE}\n【${ADDED}】を背負った`);
    await page.waitForFunction(() => !!window.__fx, null, { timeout: 15000 }).catch(() => {});
    const fx = await page.evaluate(() => window.__fx);
    check(!!fx && fx.moving > 0 && fx.moving < fx.total, `(8) 盤が育つ時は新しく増えたマスだけに動きが付く（${JSON.stringify(fx)}）`);
    // 下線（増えた語の行）
    const line = await page.evaluate(async (added) => {
      for (let i = 0; i < 40; i++) {
        const el = document.querySelector(`[data-word-row="${added}"] [data-word-line]`);
        if (el && el.getAnimations().length) return 'moving';
        await new Promise((r) => setTimeout(r, 50));
      }
      return 'none';
    }, ADDED);
    check(line === 'moving', `(8) 【 】で囲んで増えた語の行に下線が引かれる（${line}）`);
    const others = await page.evaluate((added) => [...document.querySelectorAll(`[data-word-row]:not([data-word-row="${added}"]) [data-word-line]`)].filter((e) => e.getAnimations().length).length, ADDED);
    check(others === 0, `(8) ほかの語の行には下線を引かない（${others}）`);
    // 足りない言葉が消える時に動く
    await openWordSheet(page, ADDED);
    await setLinkHint(page, exampleUrl(ADDED));
    await closeWordSheet(page);
    await page.waitForTimeout(150);
    await page.evaluate(() => 0);
    await ctx.close();
    const rm = await newPage({ size: [390, 844] });
    await rm.page.goto(`${BASE}/crossword/create`);
    await waitBoard(rm.page);
    // 見本の答えには最初からヒントが付いているので（2026-10-25）、ヒントの無い語を足して、その語で見る
    await writeLines(rm.page, `${SAMPLE}\n【${ADDED}】を背負った`);
    await waitBoard(rm.page);
    await openWordSheet(rm.page, ADDED);
    await setLinkHint(rm.page, exampleUrl(ADDED));
    await rm.page.locator('[data-word-close]').click();
    const leaving = await rm.page.evaluate(async (added) => {
      for (let i = 0; i < 30; i++) {
        const el = document.querySelector(`[data-word-row="${added}"] [data-word-missing="hint"][data-leaving]`);
        if (el && el.getAnimations().length) return 'moving';
        await new Promise((r) => setTimeout(r, 20));
      }
      return 'none';
    }, ADDED);
    check(leaving === 'moving', `(8) 足りない言葉（ヒントがまだ）が消える時に動く（${leaving}）`);
    await rm.page.waitForTimeout(400);
    check((await rm.page.locator(`[data-word-row="${ADDED}"] [data-word-missing="hint"]`).count()) === 0, '(8) 消える動きの後に言葉が無くなる');
    await rm.ctx.close();

    // 動きを減らす設定では作る画面の動きが0本
    const still = await newPage({ size: [390, 844], reducedMotion: 'reduce' });
    const p = still.page;
    await p.goto(`${BASE}/crossword/create`);
    await waitBoard(p);
    await p.evaluate(() => {
      window.__anims = 0;
      // 数えるのは画面の動きの仕組み（Web Animations）と、小さい盤・下の段の隠れる動き。ボタンの色の移り変わり（CSS の transition-colors）など前からある色の動きは数えない
      const mine = (a) => {
        if (a.playState !== 'running') return false;
        if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) return !!a.effect?.target?.closest?.('[data-mini], [data-dock]') && ['height', 'transform', 'opacity'].includes(a.transitionProperty);
        if (typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation) return false;
        return true;
      };
      const tick = () => { window.__anims += document.getAnimations().filter(mine).length; requestAnimationFrame(tick); };
      tick();
    });
    await p.locator('[data-bulk-text]').fill(`${SAMPLE}\n【${ADDED}】を背負った`);
    await p.waitForTimeout(3000);
    await openWordSheet(p, ADDED);
    await setLinkHint(p, exampleUrl(ADDED));
    await closeWordSheet(p);
    await openBoard(p);
    await closeBoard(p);
    await toMode(p, 'try');
    await toMode(p, 'make');
    await openShare(p);
    await closeShare(p);
    const n = await p.evaluate(() => window.__anims);
    if (n === undefined) console.log(`    動きを数える見張りが消えた（${p.url()}）`);
    check(n === 0, `(8) 「動きを減らす」では、盤が育つ・下線・足りない言葉が消える・窓・切り替えの動きが0本（${n}）`);
    await still.ctx.close();
  }

  // ===== (9) 大きさ =====
  for (const size of [[375, 548], [390, 548], [390, 844], [1280, 800]]) {
    const { ctx, page } = await newPage({ size });
    await page.goto(`${BASE}/crossword/create`);
    await waitBoard(page);
    const m = await page.evaluate(() => ({
      head: document.querySelector('[data-create-head]').getBoundingClientRect().height,
      mini: document.querySelector('[data-mini]').getBoundingClientRect().height,
      dock: document.querySelector('[data-dock]').getBoundingClientRect().height,
      dockBottom: document.querySelector('[data-dock]').getBoundingClientRect().bottom,
      over: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    check(m.head === 44 && m.mini === 110 && m.dock === 60 && Math.round(m.dockBottom) === size[1] && !m.over, `(9) ${tag(size)} 見出し ${m.head}px・小さい盤 ${m.mini}px・下の段 ${m.dock}px・下の段は画面の下に切れずに付く・横にはみ出さない（${m.over ? 'はみ出し' : 'なし'}）`);
    await ctx.close();
  }

  // ===== (10) 390×548 の写真（始まり・育った盤・広げた盤・語の窓・試す・共有の窓） =====
  {
    const S = [390, 548];
    const { ctx, page } = await newPage({ size: S });
    await page.goto(`${BASE}/crossword/create`);
    await waitBoard(page);
    await page.screenshot({ path: path.join(OUT, '390x548-01-start.png') });
    await writeLines(page, EDITED);
    await waitBoard(page);
    await page.screenshot({ path: path.join(OUT, '390x548-02-grown.png') });
    await openBoard(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '390x548-03-expanded.png') });
    await closeBoard(page);
    await openWordSheet(page, 'アニマルランド');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '390x548-04-sheet.png') });
    await closeWordSheet(page);
    await openShare(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '390x548-05-share-missing.png') });
    await closeShare(page);
    await fillWords(page, (await readDraft(page)).board.map((i) => i.id));
    await openShare(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '390x548-06-share-ok.png') });
    await closeShare(page);
    await toMode(page, 'try');
    await page.locator('[data-trial] [id^="cell-"]').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '390x548-07-try.png') });
    await solveTrial(page, draftCells(await readDraft(page)));
    await page.locator('[data-trial] [data-stamp]').waitFor({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, '390x548-08-solved.png') });
    check(true, '(10) 390×548 の写真を撮った（始まり・育った盤・広げた盤・語の窓・共有の窓・試す・解けた）');
    await ctx.close();
  }

  check(asked.length === 0, `oEmbed・googleapis.com・/api/crossword-video-info への通信が無い${asked.length ? `（${asked[0]}）` : ''}`);
  const stray = sent.outside.filter((u) => !/crossword-(save|update|owner-get)/.test(u));
  check(stray.length === 0, `受付係へのほかの呼び出しが無い${stray.length ? `（${stray.slice(0, 3).join(' / ')}）` : ''}`);
} catch (e) {
  check(false, `台本が途中で止まった: ${e.message}`);
} finally {
  await browser.close();
  stopServer();
}
check(pageErrors.length === 0, `画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）が無い${pageErrors.length ? `: ${pageErrors.slice(0, 3).join(' / ')}` : ''}`);
console.log(`写真: ${OUT}`);
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
