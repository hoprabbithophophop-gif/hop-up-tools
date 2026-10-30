// iPhone の大きさと Safari と同じ仕組み（WebKit）で、クロスワードを通しで触る（2026-10-04 洗い出しの D。2026-10-22 案A「作る｜試す」に書き直し）。
// 何を（iPhone SE と iPhone 13 の2台ぶん）:
//   - 指で触る端末として開けている（matchMedia('(pointer: coarse)') が true）。これが偽だと下の「文字盤が出た扱い」を確かめられないので先に見る
//   - 作る: 見本の4行 → 語の窓でカギとヒントを付ける → 広げた盤 → 「試す」で解いてハンコ → 共有の窓を開く（「共有する」は押さない＝棚に書かない）
//   - 文字盤が出た扱い（書く欄・カギの欄を選んだ時）: 小さい盤の高さが0・下の段が下へ隠れ、書く欄は見えている。欄を離れると戻る（Hop 決定 2026-10-22）
//   - 解く: ?debug=true の見本（受付係を通らない）で、ヒントの動画・1文字見る・最後の1字で答え合わせが走りハンコ
//   - 自分が作った問題の引き継ぎ（合言葉 CW1-。端末の中だけで作る）・プライバシーポリシーのクロスワードの段落
//   - どの画面も横にはみ出さない
// なぜ: iPhone の Safari は文字盤が出ると見える高さが縮み、上と下に貼り付く段が書く所を隠しやすいため。実機の文字盤の出方・ホーム画面に置いた時の動きはここでは分からない。
// iPhone SE は Playwright の 'iPhone SE (3rd gen)'（375×667）の作りで、見える高さを Safari のバーを出した時の 548px にした（Playwright の 'iPhone SE' は初代の 320×568）
// 手元だけで流す: この台本が手元の vite を口 5181 で立ち上げ（Supabase の住所は使わない仮の住所）、棚（/rest/v1）はブラウザの中の作り物で答える。
//   受付係（/api/）と棚への書き込みは見張り役が断って数える（0件のはず）。YouTube の再生部品（ヒントの動画）だけは本物を読む。終わったら開発サーバーを止める。
// 既定では流さない部分: 本物の受付係で問題を解く通し（丸付け・1文字見る・名前を入れる窓・ランキング）。
//   本物の受付係に回を始めてもらうので、本番の回の記録（crossword_plays）に行が増えるため（2026-10-19 Hop「確かめの台本を無断で周回しない」）。
//   流す時だけ REAL=1 を付ける: REAL=1 node scripts/verify/crossword/check-iphone.mjs [サイト] [問題の番号] ['<答えの配置 JSON>'] [残すマス1 x,y] [残すマス2 x,y]
// 手元の vite が途中でページを読み込み直さないよう、部品のまとめ置き場は口ごとの一時置き場・書き換えの見張り（HMR）は止めて立て（_lib.mjs の isolatedViteConfig）、
//   始める前に一度ひと回り開く下ごしらえをする。それでも読み込み直しで落ちた時だけ、その回を流し直す（最大3回。流し直した事は行に出す）
// 消した確かめ（2026-10-22 案A に書き直した時）:
//   - 1の段・2の段・3の段ごとの「横にはみ出さない」: 段が無くなった。作る・語の窓・広げた盤・試す・共有の窓ごとに見る
//   - 3の段のカギの欄の○ボタン: ○は書く欄の道具の段へ移った（check-maru-mine が確かめる）
//   - 解く画面の「名前を入れる窓が出る」「ランキングが出る」: 見本の問題は受付係を通らずランキングが無いので、既定の通しでは見ない（REAL=1 の時だけ）
// 使い方: node scripts/verify/crossword/check-iphone.mjs（引数なし）
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { webkit, devices } from 'playwright';
import { outDir, ROOT, guardWrites, watchStumbles, cellAt, xy, arg, BASE_DEFAULT, ID_DEFAULT, isolatedViteConfig } from './_lib.mjs';
import { waitBoard, toMode, openBoard, closeBoard, openShare, fillWords, openWordSheet, closeWordSheet, readDraft, draftCells, solveTrial, SAMPLE_WORDS } from './_create.mjs';

const PORT = 5181;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-iphone');
const REAL = process.env.REAL === '1';

let fail = 0;
// 結果は一度ためてから出す（手元の vite が途中でページを読み込み直して落ちた時に、その端末だけ流し直すため）
let sink = null;
const check = (ok, label) => {
  if (sink) return void sink.push([ok, label]);
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
  if (!ok) fail++;
};

// ---- 開発サーバー（仮の Supabase の住所で立てる。本物の鍵は使わない。check-review-fixes と同じ） ----
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
// ---- 棚の作り物（読むだけ。どの表も空で答える）。書き込みは見張り役へ回して数える ----
async function mockShelf(ctx) {
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const req = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.fallback();
    const u = new URL(req.url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.endsWith('/rpc/crossword_is_hidden')) return json(false);
    if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) return json(null);
    return json([]);
  });
  // 人間確認・解析・広告へは出さない（YouTube の再生部品は本物を読む）
  await ctx.route(/^https:\/\/(challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com|[a-z0-9.]*googlesyndication\.com|[a-z0-9.]*doubleclick\.net)\//, (r) => r.fulfill({ status: 204, body: '' }));
}
// 手元の vite は、画面が初めて読み込んだ部品をその場でまとめ直し、その時ページを読み込み直す。先に一度ひと回り開いておく（check-create-flow と同じ下ごしらえ）
async function warmUp(browser, prepare) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await prepare(ctx);
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 60000 });
    await waitBoard(page);
    await toMode(page, 'try');
    await page.locator('[data-trial] [id^="cell-"]').first().click({ timeout: 20000 });
    await page.waitForTimeout(3000);
    for (const p of ['/crossword/create?debug=true', '/crossword/mine', '/privacy']) {
      await page.goto(`${BASE}${p}`);
      await page.waitForTimeout(2000);
    }
  } catch { /* 下ごしらえが落ちても確かめは続ける */ }
  await ctx.close();
}

// 見本の問題（CrosswordPage.tsx の DEBUG_MOCK_PUZZLE）の答え。1文字見るで (0,0)、文字盤で (3,3) を入れて解く
const DEBUG_FULL = { '0,0': 'ね', '1,0': 'こ', '1,1': 'い', '2,1': 'す', '1,2': 'ぬ', '2,2': 'い', '2,3': 'か', '3,3': 'き' };
const D_CELL1 = '0,0';
const D_CELL2 = '3,3';
const D_ALMOST = Object.fromEntries(Object.entries(DEBUG_FULL).filter(([k]) => k !== D_CELL1 && k !== D_CELL2));

const DEVICES = [
  { name: 'iPhone SE', file: 'se', desc: { ...devices['iPhone SE (3rd gen)'], viewport: { width: 375, height: 548 } } },
  { name: 'iPhone 13', file: '13', desc: { ...devices['iPhone 13'] } },
];

const writes = [];
const stumbles = [];
let browser = null;

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
// 文字盤が出た扱いの時の様子
const kbdState = (page) =>
  page.evaluate(() => {
    const mini = document.querySelector('[data-mini]')?.getBoundingClientRect();
    const dock = document.querySelector('[data-dock]')?.getBoundingClientRect();
    const area = document.querySelector('[data-bulk-text]')?.getBoundingClientRect();
    return {
      ih: window.innerHeight,
      mini: mini ? Math.round(mini.height) : null,
      dockTop: dock ? Math.round(dock.top) : null,
      dockT: getComputedStyle(document.querySelector('[data-dock]')).transform,
      area: area ? { t: Math.round(area.top), b: Math.round(area.bottom) } : null,
      head: Math.round(document.querySelector('[data-create-head]')?.getBoundingClientRect().bottom ?? 0),
    };
  });

async function runDevice(ctx2Factory, dev) {
  const D = dev.name;
  const ctx = await browser.newContext({ ...dev.desc });
  await guardWrites(ctx, writes, BASE);
  await mockShelf(ctx);
  const page = await ctx.newPage();
  await watchStumbles(page, stumbles, D);
  const st = { loads: 0, gotos: 0 };
  page.on('load', () => st.loads++);
  const go = async (url) => {
    st.gotos++;
    await page.goto(url);
  };
  const shot = (name, full = false) => page.screenshot({ path: path.join(OUT, `iphone-${dev.file}-${name}.png`), fullPage: full });
  try {
    // 0. 指で触る端末として開けているか
    await go(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    const coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
    check(coarse, `${D}: 指で触る端末として開けている（matchMedia('(pointer: coarse)') = ${coarse}）`);
    await waitBoard(page);
    check(await noSideScroll(page), `${D}・作る: 横にはみ出さない`);
    await shot('1-make');

    // 1. 文字盤が出た扱い（書く欄を選ぶ）→ 小さい盤と下の段が隠れ、書く欄は見えている
    const area = page.locator('[data-bulk-text]');
    await area.tap();
    await page.waitForTimeout(400);
    const k1 = await kbdState(page);
    check(k1.mini === 0, `${D}・書く欄を選ぶと小さい盤の高さが0（${k1.mini}px）`);
    check(k1.dockTop !== null && k1.dockTop >= k1.ih - 1 && /matrix\(1, 0, 0, 1, 0, 6\d\)/.test(k1.dockT), `${D}・書く欄を選ぶと下の段が下へ隠れる（段の上 ${k1.dockTop}・見える高さ ${k1.ih}・${k1.dockT}）`);
    check(!!k1.area && k1.area.t >= k1.head - 1 && k1.area.t < k1.ih && k1.area.b > k1.head, `${D}・その時も書く欄は見えている（欄 ${k1.area?.t}〜${k1.area?.b}・見出しの下 ${k1.head}・見える高さ ${k1.ih}）`);
    await shot('2-keyboard-up');
    await area.evaluate((el) => el.blur());
    await page.waitForTimeout(500);
    const k2 = await kbdState(page);
    check(k2.mini === 110 && k2.dockTop === k2.ih - 60, `${D}・欄を離れると小さい盤（${k2.mini}px）と下の段（上 ${k2.dockTop}）が戻る`);

    // 2. 語の窓でカギとヒント。カギの欄を選んだ時も文字盤が出た扱いになる
    await openWordSheet(page, SAMPLE_WORDS[0]);
    await page.locator('[data-word-sheet] #cw-clue').tap();
    await page.waitForTimeout(400);
    const k3 = await kbdState(page);
    check(k3.mini === 0 && k3.dockTop >= k3.ih - 1, `${D}・語の窓のカギの欄を選ぶと、小さい盤（${k3.mini}px）と下の段（上 ${k3.dockTop}）が隠れる`);
    check(await noSideScroll(page), `${D}・語の窓: 横にはみ出さない`);
    await shot('3-word-sheet');
    await page.locator('[data-word-sheet] #cw-clue').evaluate((el) => el.blur());
    await closeWordSheet(page);
    await fillWords(page, SAMPLE_WORDS);
    const missing = await page.locator('[data-word-missing]').count();
    check(missing === 0, `${D}・語の窓で4語ともカギとヒントが付く（足りない言葉 ${missing}）`);

    // 3. 広げた盤
    await openBoard(page);
    await page.locator('[data-create-board] [id^="cell-"]').first().waitFor({ timeout: 20000 });
    check(await noSideScroll(page), `${D}・広げた盤: 横にはみ出さない`);
    await shot('4-board');
    await closeBoard(page);

    // 4. 試すで解いてハンコ
    await page.waitForTimeout(500);
    const draft = await readDraft(page);
    const cells = draftCells(draft);
    await toMode(page, 'try');
    await page.locator('[data-trial] [id^="cell-"]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    check(await noSideScroll(page), `${D}・試す: 横にはみ出さない`);
    await solveTrial(page, cells);
    const stamped = await page.getByText('CLEARED!').first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    check(stamped, `${D}・試す: 全部のマスを入れるとハンコ（CLEARED!）が出る（${Object.keys(cells).length}マス）`);
    await shot('5-try-cleared');
    await toMode(page, 'make');

    // 5. 共有の窓（「共有する」は押さない）。見本の行のままでは公開できない【仮】（2026-10-25）ので、
    //    答えは変えずに3行目のカギの文だけ書き換えてから開く
    const text = await page.locator('[data-bulk-text]').inputValue();
    await page.locator('[data-bulk-text]').fill(text.replace('トマトが好きな', 'トマトが大好きな'));
    await page.locator('[data-bulk-text]').evaluate((el) => el.blur());
    await page.waitForTimeout(800);
    await openShare(page);
    await page.waitForTimeout(400);
    const blocks = await page.locator('[data-share-blocks]').getAttribute('data-share-blocks');
    check(blocks === 'ok' && (await page.locator('[data-save]').isEnabled()), `${D}・共有の窓: 足りない物が無く「共有する」が押せる形になる（${await page.locator('[data-share-blocks]').textContent()}）`);
    check(await noSideScroll(page), `${D}・共有の窓: 横にはみ出さない`);
    const save = await page.locator('[data-save]').boundingBox();
    check(!!save && save.y >= 0 && save.y + save.height <= k2.ih + 0.5, `${D}・共有の窓: 「共有する」が画面の中に見える（${save ? Math.round(save.y) + '〜' + Math.round(save.y + save.height) : '無し'}）`);
    await shot('6-share');

    // 6. 解く（?debug=true の見本。受付係を通らない）: ヒントの動画・1文字見る・最後の1字で答え合わせ
    await page.evaluate((answers) => {
      localStorage.setItem('crossword_seen_help', 'true');
      localStorage.setItem('crossword_progress_debug-puzzle', JSON.stringify({ userAnswers: answers, elapsedSeconds: 0, savedAt: Date.now() }));
    }, D_ALMOST);
    await go(`${BASE}/crossword/create?debug=true`);
    await page.locator('[id^="cell-"]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);
    check(await noSideScroll(page), `${D}・解く: 横にはみ出さない`);
    await shot('7-solve');
    await cellAt(page, ...xy(D_CELL1), '空').tap();
    await page.waitForTimeout(800);
    check((await page.locator('[data-coach="keypad"]').count()) > 0, `${D}・解く: マスを押すと入力カードが出る`);
    await page.getByRole('button', { name: 'ヒント', exact: true }).first().tap();
    await page.waitForTimeout(4000);
    check((await page.locator('iframe[src*="youtube"]').count()) >= 1, `${D}・解く: ヒントの動画のプレイヤーが出る`);
    await shot('8-hint');
    await page.getByRole('button', { name: 'ヒント', exact: true }).first().tap();
    await page.getByRole('button', { name: '1文字見る' }).tap();
    const confirmShown = (await page.evaluate(() => document.body.innerText)).includes('1文字見る？');
    check(confirmShown, `${D}・解く: 1文字見るの確かめが出る`);
    if (confirmShown) await page.getByRole('button', { name: '見る', exact: true }).tap();
    await cellAt(page, ...xy(D_CELL1), DEBUG_FULL[D_CELL1]).waitFor({ timeout: 8000 }).catch(() => {});
    check((await cellAt(page, ...xy(D_CELL1), DEBUG_FULL[D_CELL1]).count()) === 1, `${D}・解く: 1文字見るで字が入る`);
    await page.getByRole('button', { name: '閉じる' }).first().tap().catch(() => {});
    await page.waitForTimeout(500);
    await cellAt(page, ...xy(D_CELL2), '空').tap();
    await page.locator('[data-coach="keypad"]').getByRole('button', { name: DEBUG_FULL[D_CELL2], exact: true }).first().tap();
    const cleared = await page.getByText('CLEARED!').first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    check(cleared, `${D}・解く: 最後の1字で答え合わせが走り、ハンコ（CLEARED!）が出る`);
    await page.waitForTimeout(1500);
    check(await noSideScroll(page), `${D}・解けた後: 横にはみ出さない`);
    await shot('9-solve-cleared', true);

    // 7. 自分が作った問題の引き継ぎ（合言葉は端末の中だけで作る）
    await page.evaluate(() => localStorage.setItem('crossword_my_puzzles', JSON.stringify([{ id: 'AAAAAAAA', title: '試しの問題', key: 'a'.repeat(64), createdAt: 1 }])));
    await go(`${BASE}/crossword/mine`);
    await page.getByRole('heading', { name: '自分が作った問題' }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: '合言葉を出す' }).tap();
    const code = await page.locator('#transfer-code').inputValue();
    check(code.startsWith('CW1-'), `${D}・引き継ぎ: 合言葉が出る`);
    check(await noSideScroll(page), `${D}・引き継ぎ: 横にはみ出さない`);
    await shot('10-transfer', true);
    const ctx2 = await ctx2Factory();
    const p2 = await ctx2.newPage();
    await watchStumbles(p2, stumbles, `${D}・別の端末`);
    await p2.goto(`${BASE}/crossword/mine`);
    await p2.getByRole('heading', { name: '自分が作った問題' }).waitFor({ timeout: 15000 });
    await p2.locator('#transfer-input').fill(code);
    await p2.getByRole('button', { name: '引き継ぐ' }).tap();
    await p2.waitForTimeout(1000);
    check((await p2.evaluate(() => document.body.innerText)).includes('引き継ぎました'), `${D}・引き継ぎ: 別の端末で読み込める`);
    const k = (pg) => pg.evaluate(() => localStorage.getItem('crossword_player_key'));
    check((await k(p2)) === (await k(page)) && (await k(page)) !== null, `${D}・引き継ぎ: ランキング用の番号が同じになる`);
    const mine2 = await p2.evaluate(() => JSON.parse(localStorage.getItem('crossword_my_puzzles') || '[]').map((m) => m.id).join(','));
    check(mine2 === 'AAAAAAAA', `${D}・引き継ぎ: 作った問題の控えも移る（${mine2}）`);
    await ctx2.close();

    // 8. プライバシーポリシー
    await go(`${BASE}/privacy`);
    await page.getByText('クロスワードで問題を作って共有した場合').first().waitFor({ timeout: 15000 }).catch(() => {});
    check((await page.evaluate(() => document.body.innerText)).includes('クロスワードで問題を作って共有した場合'), `${D}・プライバシーポリシー: クロスワードの段落が出る`);
  } catch (e) {
    check(false, `${D}: 台本が途中で止まった: ${e.message.split('\n')[0]}`);
    await shot('stopped').catch(() => {});
  }
  await ctx.close();
  return st.loads > st.gotos;
}

// ---- 本物の受付係で解く通し（既定では流さない。REAL=1 の時だけ。頭のコメントの理由） ----
async function runReal() {
  const { interceptCount, humanWaitMs, puzzleArgs, waitForPlayToken } = await import('./_lib.mjs');
  const RB = arg(2, BASE_DEFAULT);
  const ID = arg(3, ID_DEFAULT);
  const P = await puzzleArgs(RB, ID, { cluesJson: arg(4), cell1: arg(5), cell2: arg(6) });
  const [CELL1, CELL2] = [P.cell1, P.cell2];
  const full = P.full;
  const almost = { ...full };
  delete almost[CELL1];
  delete almost[CELL2];
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await interceptCount(ctx);
  await ctx.route('**/api/crossword-score', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  const page = await ctx.newPage();
  await watchStumbles(page, stumbles, '本物の受付係');
  const text = () => page.evaluate(() => document.body.innerText);
  await page.goto(`${RB}/crossword/mine`);
  await page.evaluate(({ id, answers }) => {
    localStorage.setItem('crossword_seen_help', 'true');
    localStorage.setItem(`crossword_progress_${id}`, JSON.stringify({ userAnswers: answers, elapsedSeconds: 0, savedAt: Date.now() }));
  }, { id: ID, answers: almost });
  await page.goto(`${RB}/crossword/${ID}`);
  await page.locator('[id^="cell-"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  await cellAt(page, ...xy(CELL1), '空').tap();
  await page.getByRole('button', { name: '1文字見る' }).tap();
  if ((await text()).includes('1文字見る？')) await page.getByRole('button', { name: '見る', exact: true }).tap();
  await cellAt(page, ...xy(CELL1), full[CELL1]).waitFor({ timeout: 8000 }).catch(() => {});
  check((await cellAt(page, ...xy(CELL1), full[CELL1]).count()) === 1, '本物の受付係: 1文字見るで字が入る');
  await page.getByRole('button', { name: '閉じる' }).first().tap().catch(() => {});
  await waitForPlayToken(page, ID);
  await page.waitForTimeout(humanWaitMs(Object.keys(full).length));
  await cellAt(page, ...xy(CELL2), '空').tap();
  await page.getByRole('button', { name: full[CELL2], exact: true }).last().tap();
  await page.getByRole('button', { name: '載せる' }).waitFor({ timeout: 20000 }).catch(() => {});
  check((await text()).includes('CLEARED!'), '本物の受付係: 最後の1字で答え合わせが走り、ハンコが出る');
  check((await page.getByRole('button', { name: '載せる' }).count()) === 1, '本物の受付係: 名前を入れる窓が出る');
  await page.getByRole('button', { name: '載せない' }).tap().catch(() => {});
  await page.waitForTimeout(2000);
  const after = await text();
  check(after.includes('ランキング') || after.includes('まだ記録がありません'), '本物の受付係: ランキング（または「まだ記録がありません」）が出る');
  await page.screenshot({ path: path.join(OUT, 'iphone-real-clear.png'), fullPage: true });
  await ctx.close();
}

try {
  browser = await webkit.launch();
  if (REAL) {
    await runReal();
  } else {
    await startServer();
    await warmUp(browser, async (ctx) => {
      await guardWrites(ctx, writes, BASE);
      await mockShelf(ctx);
    });
    for (const dev of DEVICES) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        sink = [];
        const stumbleAt = stumbles.length;
        const reloaded = await runDevice(async () => {
          const c = await browser.newContext({ ...dev.desc });
          await guardWrites(c, writes, BASE);
          await mockShelf(c);
          return c;
        }, dev);
        const results = sink;
        sink = null;
        if (reloaded && results.some(([ok]) => !ok) && attempt < 3) {
          console.log(`    ${dev.name}: 途中で手元の vite がページを読み込み直したので、この端末を流し直す（${attempt}回目）`);
          stumbles.length = stumbleAt;
          continue;
        }
        for (const [ok, label] of results) check(ok, label);
        break;
      }
    }
  }
} catch (e) {
  check(false, `台本が途中で止まった: ${e.message.split('\n')[0]}`);
} finally {
  if (browser) await browser.close();
  stopServer();
}

check(stumbles.length === 0, `画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）が無い${stumbles.length ? '：' + stumbles.slice(0, 3).join(' / ') : ''}`);
if (!REAL) check(writes.length === 0, `受付係・棚への書き込みは0件（見張り役が断った通信: ${writes.length}件${writes.length ? ' ' + writes.join(' , ') : ''}）`);
console.log(`写真: ${OUT}`);
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
