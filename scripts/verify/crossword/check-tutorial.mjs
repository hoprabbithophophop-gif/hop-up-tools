// 作る側と解く側の「初めて」の案内（Hop 決定 2026-10-05「止めない・読ませない・その場で1行」）を確かめる。
// 作る画面は 2026-10-22 に案A「作る｜試す」に作り直した（Hop 決定 2026-10-22）。(c) の作る画面の札をそれに合わせて書き直した（同日）。
// 本番にもプレビューにも Supabase にもつながない（2026-10-19 Hop「本番環境から見える形で検収用パズル登録を二度とするな」）。
// 手元の vite をこの台本が仮の Supabase の住所で立ち上げ、終わったら止める。棚（/rest/v1）と受付係（/api/crossword-play）は
// ブラウザの中の作り物が台本の中の見本の問題で答える（check-pause・check-review-fixes と同じ作り）。前は本物の棚の問題（targets.json の puzzleId）を読んでいたが、それをやめた（2026-10-22）。
//   (a) 記録が空の端末で問題を開く → 遊び方の窓は「始める！」だけ → 始めると最初のマスが脈打ち、盤の下に1行
//       → マスを押すと両方消える → 開き直しても出ない。幕は無い
//   (b) 「?」→「練習する」→ 案内は2段（×つき）→ 案内なしで解き切る → ハンコ → 「本番へ」。見出しの戻る矢印はいつも出ている
//   (c) 作る画面（案A）: 初めて開いても幕の案内は出ない（見本の4行が入っていて札も出ない）→ 見本を消して答えを1つにすると札 cross（書く欄の下）→ ×
//       → 2語にして広げた盤を開くと札 move（盤の下）→ × → 「公開の準備」の共有の窓に札 saved（題名の欄より上）→ ×（保存は押さない）
//       → 開き直しても札 cross・move・saved は二度と出ない
//   (d) 作る画面に「?」（パズルの作り方）と11段の案内は無い（2026-10-20 Hop 決定で外した）
//   (e) 受付係・棚への書き込み（保存・更新・記録・通報・削除）は0回。問題を開く時の回の開始（/api/crossword-play）と、読むだけの rpc/crossword_is_hidden は数えない
// 場面ごとに 390px の写真を残し、吹き出しと「×」が画面に収まっているか・横にはみ出したスクロールが無いかを見る。
// 2026-10-22 に消した確かめ:
//   - 「2の段で盤ができると札2」「3の段から4の窓」: 4段の流れが無くなった。札 move は広げた盤の中、札 saved は「公開の準備」の共有の窓の中で見る
//   - 4の窓の「3の段へ戻る」（[data-step-back="3"]）での開き直し: 段が無くなったので、共有の窓の「閉じる」で閉じて開き直す
//   - 「答えが無い間は札も出ない」: 初めて開くと見本の4行が入っているので、答えが無い状態から始まらなくなった。代わりに「見本の4行の間は札が出ない」を見る
//   - 本物の問題が読めない時（「supabaseUrl is required」）に見本の問題 /crossword/create?debug=true へ切り替える迂回: 手元ではいつも作り物の棚で答えるので要らなくなった
// 使い方: node scripts/verify/crossword/check-tutorial.mjs [サイト（省略すると手元の開発サーバーを立てる）] [問題の番号（サイトを渡した時だけ使う）]
//   サイトを渡した時は棚と受付係の作り物を使わず、そのサイトの棚と受付係へ行く（読むだけ。保存は台本が受け止めて外へ出さない）
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { arg, outDir, ROOT, ID_DEFAULT, leaveFirstVisitMarks, cellAt, watchStumbles, isolatedViteConfig } from './_lib.mjs';
import { SAMPLE, writeLines, waitBoard, openBoard, closeBoard, openShare, closeShare } from './_create.mjs';

// 「初めて」の印を立てずに流す（ほかの台本は _lib.mjs が印を立ててから開く）
leaveFirstVisitMarks();

const PORT = 5191;
const LOCAL = `http://localhost:${PORT}`;
const BASE = arg(2, LOCAL);
const IS_LOCAL = BASE === LOCAL;
const MOCK_SUPA = 'https://mock-supabase.invalid';
// 見本の問題（check-pause と同じ形）。盤: バキ 横(0,0)・キクラ 縦(1,0)。1番のカギは横で (0,0) から始まる（(a) の脈打ちの確かめに使う）
const MOCK_ID = 'MOCKTUT1';
const ID = IS_LOCAL ? MOCK_ID : arg(3, ID_DEFAULT);
const SOLUTION = { '0,0': 'バ', '1,0': 'キ', '1,1': 'ク', '1,2': 'ラ' };
const ANSWERS = [['バ', 'キ'], ['キ', 'ク', 'ラ']];
const ROWS = [{
  id: MOCK_ID, title: 'チュートリアルの見本', genre: 'hello', tags: [], created_at: '2026-10-22T00:00:00Z', play_count: 0, is_beginner: false, group_tags: [],
  body: {
    version: 1, width: 2, height: 3, creatorName: '台本',
    clues: [
      { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: 'ヨコの見本のカギ', length: 2, hint: { kind: 'link', url: 'https://example.com/' } },
      { clueIndex: 2, direction: 'vertical', startX: 1, startY: 0, clue: 'タテの見本のカギ', length: 3, hint: { kind: 'link', url: 'https://example.com/' } },
    ],
  },
}];
// 読むだけの呼び出し（_lib.mjs の READ_ONLY_RPC と同じ）。POST で届くが書き込みではない
const READ_ONLY_RPC = ['/rest/v1/rpc/crossword_is_hidden'];
const OUT = outDir('check-tutorial');
const W = 390;

let fail = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
  if (!ok) fail++;
};

// --- 開発サーバー ---
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
    // 仮の Supabase の住所で立てる（本物の棚にはつながない。鍵も作り物）
    env: { ...process.env, VITE_SUPABASE_URL: MOCK_SUPA, VITE_SUPABASE_ANON_KEY: 'mock-anon-key' },
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    if (server.exitCode !== null) throw new Error(`開発サーバーが止まった: ${log.slice(-500)}`);
    try {
      const r = await fetch(LOCAL);
      if (r.ok) return;
    } catch { /* まだ */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('開発サーバーが60秒で立ち上がらなかった');
}

const browser = { b: null };
// 受付係・棚への書き込み（外へ出た物）と、台本が受け止めた保存
const writes = [];
let mockedSaves = 0;
// 画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）を控える（2026-10-21）
const stumbles = [];

// --- 小物 ---
async function newCtx() {
  const ctx = await browser.b.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 1 });
  ctx.on('request', (r) => {
    const u = r.url();
    const m = r.method();
    if (u.includes('/api/crossword-save')) return; // 下の受け止め役が外へ出さずに返す
    if (u.includes('/api/crossword-play')) return; // 本物の問題を開く (a) では回を始める通信が正しく起きる。練習中の0回は (b) で別に見る
    const readOnly = READ_ONLY_RPC.some((x) => u.replace(/\?.*/, '').endsWith(x));
    if (u.includes('/api/crossword-') || (u.includes('/rest/v1/') && m !== 'GET' && m !== 'HEAD' && !readOnly)) writes.push(`${m} ${u.replace(/\?.*/, '')}`);
  });
  if (IS_LOCAL) {
    // 棚の作り物（見本の問題1件だけを返す）
    await ctx.route(`${MOCK_SUPA}/**`, (route) => {
      const u = new URL(route.request().url());
      const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname.endsWith('/rpc/crossword_is_hidden')) return json(false);
      const table = u.pathname.split('/').pop();
      let rows = table === 'crossword_puzzles' ? ROWS : [];
      const idEq = u.searchParams.get('id');
      if (idEq?.startsWith('eq.')) rows = rows.filter((r) => r.id === idEq.slice(3));
      if ((route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object')) return json(rows[0] ?? null);
      return json(rows);
    });
    // 受付係の作り物（回の始まり・合図・答え合わせ・1文字見る）。ほかの受付係は 503 で断る
    await ctx.route('**/api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await ctx.route('**/api/crossword-play', (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const reply = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...o }) });
      switch (body.action) {
        case 'start': return reply({ token: 'tok-tutorial', startedAt: Date.now() });
        case 'touch': return reply({ counted: true });
        case 'resume': case 'pause': case 'ping': return reply({ activeMs: 0, open: body.action !== 'pause' });
        case 'check': {
          const correct = Object.keys(SOLUTION).every((k) => body.answers?.[k] === SOLUTION[k]);
          return reply(correct ? { correct, answers: ANSWERS, timeSeconds: 10, rankable: false } : { correct });
        }
        case 'reveal': return reply({ char: SOLUTION[`${body.x},${body.y}`], reveals: 1 });
        default: return route.fulfill({ status: 400, body: '{}' });
      }
    });
    // 外のサイト（YouTube・広告・計測）へは出さない
    await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|www\.youtube-nocookie\.com|[a-z.]*cloudflareinsights\.com|pagead2\.googlesyndication\.com)\//, (r) => r.fulfill({ status: 204, body: '' }));
  }
  // 保存の直前の人間確認（Turnstile）は、すぐ通ったことにする見本に差し替える（外の確かめには行かない）
  await ctx.route('https://challenges.cloudflare.com/turnstile/**', (r) =>
    r.fulfill({ contentType: 'application/javascript', body: 'window.turnstile={render:function(el,o){setTimeout(function(){o.callback("check-tutorial")},50);return "w"},remove:function(){}};' })
  );
  // 保存の受付係は呼ばずに、保存できたことにして返す（棚には何も書かない）
  await ctx.route('**/api/crossword-save', (r) => {
    mockedSaves++;
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"id":"TUTORIALCHECK"}' });
  });
  const page = await ctx.newPage();
  await watchStumbles(page, stumbles);
  return { ctx, page };
}
const bubble = (page) => page.locator('[data-coach-bubble]');
const layerGone = async (page) => {
  await page.waitForTimeout(300);
  return (await page.locator('[data-coach-layer]').count()) === 0;
};
async function waitBubble(page, text, label, timeout = 15000) {
  const ok = await page
    .waitForFunction((t) => document.querySelector('[data-coach-bubble]')?.textContent?.includes(t), text, { timeout })
    .then(() => true)
    .catch(() => false);
  check(ok, `${label}: 吹き出し「${text}」が出る`);
  return ok;
}
const enabledNext = (page, timeout = 30000) =>
  page.waitForFunction(() => {
    const b = [...document.querySelectorAll('[data-coach-bubble] button')].find((x) => x.textContent === '次へ');
    return b && !b.disabled;
  }, null, { timeout });
// 吹き出しと「×」が画面に収まり、ページが横にはみ出していないか。写真も撮る
async function shot(page, name) {
  await page.waitForTimeout(500); // スクロールが落ち着くのを待つ
  const m = await page.evaluate(() => {
    const d = document.documentElement;
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const b = document.querySelector('[data-coach-bubble]');
    const x = document.querySelector('[data-coach-close]');
    const xr = box(x);
    const hit = xr ? x.contains(document.elementFromPoint((xr.left + xr.right) / 2, (xr.top + xr.bottom) / 2)) : false;
    const skip = !!b && [...b.querySelectorAll('button')].some((e) => e.textContent === 'スキップ');
    const tip = document.querySelector('[data-tip]');
    const tx = tip?.querySelector('button');
    return { r: box(b), xr, hit, skip, tr: box(tip), txr: box(tx), sw: d.scrollWidth, vw: d.clientWidth, vh: d.clientHeight };
  });
  const inView = (r) => r.left >= 0 && r.right <= m.vw && r.top >= 0 && r.bottom <= m.vh;
  if (m.r) {
    check(inView(m.r), `${name}: 吹き出しが画面に収まる（左${Math.round(m.r.left)} 右${Math.round(m.r.right)} 上${Math.round(m.r.top)} 下${Math.round(m.r.bottom)} ／ 画面 ${m.vw}×${m.vh}）`);
    check(!!m.xr && m.hit && inView(m.xr), `${name}: 右上の「×」が見えていて画面に収まる${m.xr ? `（左${Math.round(m.xr.left)} 右${Math.round(m.xr.right)} 上${Math.round(m.xr.top)}）` : ''}`);
    check(m.skip, `${name}: 「とばす」もある`);
  }
  if (m.tr) check(m.tr.left >= 0 && m.tr.right <= m.vw && !!m.txr && m.txr.right <= m.vw, `${name}: 札と札の「×」が横幅に収まる（札 左${Math.round(m.tr.left)} 右${Math.round(m.tr.right)}）`);
  check(m.sw <= m.vw, `${name}: 横にはみ出したスクロールが無い（${m.sw}px）`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}
const nextBtn = (page) => bubble(page).getByRole('button', { name: '次へ' });
const key = (page, ch) => page.locator('[data-coach="keypad"]').getByRole('button', { name: ch, exact: true }).first();
// 幕（暗い所）の、吹き出しにも穴にも当たらない1点を押す
async function tapMask(page) {
  const pt = await page.evaluate(() => {
    const d = document.documentElement;
    const pts = [[5, 5], [d.clientWidth - 5, 5], [5, d.clientHeight - 5], [d.clientWidth - 5, d.clientHeight - 5], [5, d.clientHeight / 2]];
    for (const [x, y] of pts) {
      const el = document.elementFromPoint(x, y);
      if (el && el.hasAttribute('data-coach-mask')) return [x, y];
    }
    return null;
  });
  if (!pt) return false;
  await page.mouse.click(pt[0], pt[1]);
  return true;
}
const closeSheet = async (page) => {
  await page.locator('[data-coach="closeup-head"]').getByRole('button', { name: '閉じる' }).click();
  await page.waitForTimeout(500);
};
// 下ごしらえ（2026-10-22）。手元の vite は画面が初めて読み込んだ部品をその場でまとめ直し、その時ページを読み込み直す。
// 確かめの途中で読み込み直されると落ちるので、確かめの前に解く画面・作る画面・「試す」・練習問題を一度ずつ開いておく。ここでは何も確かめない
async function warmUp() {
  const { ctx, page } = await newCtx();
  try {
    await page.goto(`${BASE}/crossword/${ID}`);
    await page.getByRole('button', { name: /始める！/ }).waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await waitBoard(page).catch(() => {});
    await page.locator('[data-mode-tab="try"]').click();
    await page.locator('[data-trial] [id^="cell-"]').first().click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.goto(`${BASE}/crossword/tutorial`);
    await page.locator('#cell-0-0').waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
  } finally {
    await ctx.close();
  }
}

async function run() {
  // ===== (a) 解く側: 初めての脈打ちと1行 =====
  const entryPath = `/crossword/${ID}`;
  const fromExpected = ID;
  const playCalls = [];
  {
    const { ctx, page } = await newCtx();
    let counting = false;
    ctx.on('request', (r) => {
      if (counting && r.url().includes('/api/crossword-play')) playCalls.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${(() => { try { return JSON.parse(r.postData() || '{}').action; } catch { return '?'; } })()} ${page.url().replace(/^https?:\/\/[^/]+/, '')}`);
    });
    const notes = [];
    page.on('console', (m) => m.type() === 'error' && notes.push(m.text().slice(0, 160)));
    await page.goto(`${BASE}${entryPath}`);
    const opened = await page.getByRole('button', { name: /始める！/ }).waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    check(opened, `(a) 記録が空の端末で解く画面（${entryPath}）を開くと遊び方の窓に「始める！」が出る`);
    if (!opened) throw new Error(`解く画面が開けない: ${notes.join(' ／ ')}`);
    await page.waitForTimeout(2500); // ページ移動の波が引くのを待つ
    check((await page.getByRole('button', { name: '練習してから始める' }).count()) === 0 && (await page.getByRole('button', { name: 'このまま始める' }).count()) === 0, '(a) 「練習してから始める」「このまま始める」の2択は出ない');
    check((await page.getByRole('button', { name: '練習する' }).count()) === 0, '(a) 初めて開いた時の窓には「練習する」も出ない（「?」から開いた時だけ）');
    await page.screenshot({ path: path.join(OUT, 'a1-help.png') });
    await page.getByRole('button', { name: /始める！/ }).click();
    await page.waitForTimeout(800);
    const pulse = await page.evaluate(() => {
      const p = document.querySelector('[data-pulse]');
      if (!p) return null;
      const cs = getComputedStyle(p);
      const btn = p.parentElement?.querySelector('button.puzzle-cell');
      const num = p.parentElement?.querySelector('.text-\\[9px\\]')?.textContent ?? null;
      return { name: cs.animationName, dur: cs.animationDuration, bg: cs.backgroundColor, id: btn?.id ?? '', num, count: document.querySelectorAll('[data-pulse]').length };
    });
    check(!!pulse && pulse.count === 1, `(a) 始めると最初のマスだけが脈打つ（${pulse ? pulse.id : '無し'}）`);
    check(!!pulse && pulse.name === 'crossword-cell-pulse' && pulse.dur === '1.2s', `(a) 脈打ちは 1.2秒周期（${pulse ? `${pulse.name} ${pulse.dur}` : '-'}）`);
    check(!!pulse && /^rgba\(0, 0, 0, 0\.\d+\)$/.test(pulse.bg), `(a) 脈打ちは色を使わず濃淡だけ（${pulse?.bg}）`);
    check(pulse?.num === '1', `(a) 脈打つのは1番のカギの先頭のマス（番号 ${pulse?.num}）`);
    const line = page.locator('[data-first-cell-hint]');
    check((await line.innerText().catch(() => '')) === 'マスを押すと、字を入れられます。', '(a) 盤のすぐ下に1行「マスを押すと字が入ります」');
    check((await page.locator('[data-coach-layer]').count()) === 0, '(a) 幕は無い');
    check(await page.getByRole('button', { name: 'ズームイン' }).isEnabled(), '(a) ほかの部品はそのまま押せる（操作を奪わない）');
    await page.screenshot({ path: path.join(OUT, 'a2-pulse.png') });
    await page.locator(`#${pulse?.id || 'cell-0-0'}`).click();
    await page.waitForTimeout(400);
    check((await page.locator('[data-pulse]').count()) === 0 && (await line.count()) === 0, '(a) マスを押した瞬間に脈打ちと1行が消える');
    check((await page.evaluate(() => localStorage.getItem('crossword_seen_first_cell'))) === '1', '(a) 消えた印が端末に残る');
    await page.screenshot({ path: path.join(OUT, 'a3-after-press.png') });
    await closeSheet(page);
    await page.reload();
    await page.waitForTimeout(5000);
    check((await page.locator('[data-pulse]').count()) === 0 && (await page.locator('[data-first-cell-hint]').count()) === 0, '(a) 開き直しても脈打ちと1行は出ない');

    // ===== (b) 「?」→「練習する」 =====
    await page.getByTitle('遊び方').first().click();
    await page.getByRole('button', { name: '練習する' }).waitFor();
    await page.screenshot({ path: path.join(OUT, 'b0-help-practice.png') });
    await page.getByRole('button', { name: '練習する' }).click();
    await page.waitForURL((u) => u.pathname === '/crossword/tutorial', { timeout: 15000 });
    // 本物の問題の画面を離れる時の一時停止（pause）は、離れた問題の回の合図で練習の通信ではない。それが出終わってから数え始める（2026-10-22）
    await page.waitForTimeout(1000);
    counting = true; // 練習が終わるまで受付係への通信を数える
    check(new URL(page.url()).searchParams.get('from') === fromExpected, `(b) 練習問題の住所へ移る（from=${fromExpected}）`);
    await waitBubble(page, '左上のマスを押してみましょう', '(b) 段1');
    check((await nextBtn(page).count()) === 0, '(b) 段1 は「次へ」が無く、マスを押して進む');
    check(await page.locator('header').getByRole('button', { name: '本番へ' }).isVisible(), '(b) 練習中も見出しの戻る矢印が出ている');
    check(!(await page.evaluate(() => /\d\d:\d\d/.test(document.querySelector('header')?.innerText || ''))), '(b) 練習問題ではタイマーを出さない');
    await page.waitForTimeout(400); // 開いた直後の約300msは組み立ての動きの透明なマスが × に重なる
    await shot(page, 'b1-cell');
    await page.locator('#cell-0-0').click();
    await waitBubble(page, '文字盤で字を入れると、次のマスへ進みます', '(b) 段2');
    const closeBtn = bubble(page).getByRole('button', { name: '閉じる' });
    check(await closeBtn.isDisabled(), '(b) 段2 は字を入れるまで「閉じる」を押せない');
    await shot(page, 'b2-keypad');
    await key(page, 'ネ').click();
    await page.waitForTimeout(300);
    await closeBtn.click();
    check(await layerGone(page), '(b) 段2 の後は案内なし（2段だけ）');
    await key(page, 'コ').click();
    await closeSheet(page);
    await page.locator('#cell-1-1').click();
    await key(page, 'ア').click();
    await key(page, 'ラ').click();
    await closeSheet(page);
    await page.locator('#cell-2-2').click();
    await key(page, 'ム').click();
    await key(page, 'ネ').click();
    const stamped = await page.waitForFunction(() => document.body.innerText.includes('CLEARED!'), null, { timeout: 10000 }).then(() => true).catch(() => false);
    check(stamped, '(b) 案内なしで解き切ると自動で答え合わせしてハンコが出る');
    await page.waitForTimeout(2500);
    check((await page.locator('[data-coach-layer]').count()) === 0, '(b) ハンコの後も幕は出ない');
    const text = await page.evaluate(() => document.body.innerText);
    check(!text.includes('Xに投稿') && !text.includes('通報') && !text.includes('載せない') && !text.includes('ランキング'), '(b) 練習問題では X 投稿・通報・名前を入れる窓・ランキングを出さない');
    const real = page.locator('[data-coach="tutorial-done"]').getByRole('button', { name: '本番へ' });
    check(await real.isVisible(), '(b) ハンコの後に「本番へ」が出ている');
    await page.screenshot({ path: path.join(OUT, 'b3-done.png') });
    check(playCalls.length === 0, `(b) 練習中に受付係（/api/crossword-play）への通信が無い（${playCalls.length}回${playCalls.length ? ': ' + playCalls.join(' / ') : ''}）`);
    counting = false;
    await real.click();
    const backPath = `/crossword/${fromExpected}`;
    check(await page.waitForURL((u) => u.pathname === backPath, { timeout: 15000 }).then(() => true).catch(() => false), `(b) 「本番へ」で ${backPath} へ移る`);
    await ctx.close();
  }

  // 練習問題の抜け道（×・「次へ」を押せない段で幕のタップ・Esc）。終えた後は本物の部品が押せる。見出しの矢印で戻れる
  {
    const { ctx, page } = await newCtx();
    await page.goto(`${BASE}/crossword/tutorial?from=${ID}`);
    await waitBubble(page, '左上のマスを押してみましょう', '(b) 抜け道 ×');
    await page.locator('[data-coach-close]').click();
    check(await layerGone(page), '(b) 段1 の「×」で案内が終わる');
    await page.locator('#cell-0-0').click();
    await key(page, 'ネ').click();
    check((await cellAt(page, 0, 0, 'ネ').count()) > 0, '(b) 終えた後に本物のマスと文字盤で字が入る');
    await closeSheet(page);
    await page.locator('header').getByRole('button', { name: '本番へ' }).click();
    check(await page.waitForURL((u) => u.pathname === `/crossword/${ID}`, { timeout: 15000 }).then(() => true).catch(() => false), `(b) 見出しの戻る矢印で元の問題 /crossword/${ID} へ戻る`);
    await page.goto(`${BASE}/crossword/tutorial`);
    await waitBubble(page, '左上のマスを押してみましょう', '(b) 抜け道 幕');
    await page.locator('#cell-0-0').click();
    await waitBubble(page, '文字盤で字を入れると', '(b) 抜け道 幕 段2');
    check(await tapMask(page), '(b) 幕の1点を押せた');
    check(await layerGone(page), '(b) 「閉じる」を押せない段2 でも幕のタップで案内が終わる');
    await key(page, 'ネ').click();
    check((await cellAt(page, 0, 0, 'ネ').count()) > 0, '(b) 幕で終えた後も文字盤で字が入る');
    await page.goto(`${BASE}/crossword/tutorial`);
    await waitBubble(page, '左上のマスを押してみましょう', '(b) 抜け道 Esc');
    await page.keyboard.press('Escape');
    check(await layerGone(page), '(b) Esc キーで案内が終わる');
    await ctx.close();
  }

  // ===== (c) 作る側: 場面ごとの札（案A・2026-10-22 に書き直し）。札は cross（答えが1つの時・書く欄の下）・move（広げた盤の中）・saved（共有の窓の中）の3つ =====
  {
    const { ctx, page } = await newCtx();
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500);
    check((await page.locator('[data-coach-layer]').count()) === 0, '(c) 作る画面を初めて開いても幕つきの案内は出ない');
    check((await page.locator('[data-bulk-text]').inputValue()) === SAMPLE, '(c) 初めて開くと書く欄に見本の4行が入っている');
    check((await page.locator('[data-tip]').count()) === 0, '(c) 見本の4行（答えが4つ）の間は札が出ない');
    await page.screenshot({ path: path.join(OUT, 'c0-create.png') });
    // 札 cross: 見本を消して答えを1つにする
    await writeLines(page, 'ニャーと鳴く動物→【ネコ】');
    const tip1 = await page.locator('[data-tip="cross"]').waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    check(tip1, '(c) 見本を消して答えを1つにすると札 cross が出る');
    check((await page.locator('[data-tip="cross"]').innerText().catch(() => '')).includes('答えをもう1つ足すと、同じ字のマスで交わるように組まれます'), '(c) 札 cross の文「答えをもう1つ足すと、同じ字で交差して組まれます」');
    check((await page.locator('[data-tip]').count()) === 1 && (await page.locator('[data-coach-layer]').count()) === 0, '(c) 札は1つだけ・幕は無い');
    const below1 = await page.evaluate(() => {
      const a = document.querySelector('[data-bulk-text]')?.getBoundingClientRect();
      const t = document.querySelector('[data-tip="cross"]')?.getBoundingClientRect();
      return !!a && !!t && t.top >= a.bottom - 1;
    });
    check(below1, '(c) 札 cross は書く欄の下');
    await page.locator('[data-tip="cross"]').scrollIntoViewIfNeeded();
    await shot(page, 'c1-tip-cross');
    await page.locator('[data-tip="cross"]').getByRole('button', { name: '閉じる' }).click();
    check((await page.locator('[data-tip]').count()) === 0, '(c) 札 cross の × で消える');
    // 札 move: 2語にして盤ができたら、小さい盤を押して広げた盤を開く
    await writeLines(page, 'ニャーと鳴く動物→【ネコ】\n【コアラ】はユーカリを食べる');
    await waitBoard(page);
    check((await page.locator('[data-tip]').count()) === 0, '(c) 札 move は広げた盤を開くまで出ない（作る画面には出ない）');
    await openBoard(page);
    const tip2 = await page.locator('[data-board-sheet] [data-tip="move"]').waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    check(tip2, '(c) 広げた盤に盤が出ると札 move が出る');
    check((await page.locator('[data-tip="move"]').innerText().catch(() => '')).includes('マス目の答えは長押しで動かせます'), '(c) 札 move の文「マス目の答えは長押しで動かせます」');
    const below2 = await page.evaluate(() => {
      const b = document.querySelector('[data-create-board]')?.getBoundingClientRect();
      const t = document.querySelector('[data-tip="move"]')?.getBoundingClientRect();
      return !!b && !!t && t.top >= b.bottom - 1;
    });
    check(below2, '(c) 札 move は盤の下');
    check((await page.locator('[data-tip]').count()) === 1, '(c) 札は1つだけ');
    await page.locator('[data-tip="move"]').scrollIntoViewIfNeeded();
    await shot(page, 'c2-tip-move');
    await page.locator('[data-tip="move"]').getByRole('button', { name: '閉じる' }).click();
    check((await page.locator('[data-tip]').count()) === 0, '(c) 札 move の × で消える');
    await closeBoard(page);
    // 札 saved: 「公開の準備」で共有の窓（カギとヒントが無くても窓は開く。保存は押さない）
    await openShare(page);
    const tip3 = page.locator('[data-share-sheet] [data-tip="saved"]');
    check((await tip3.innerText().catch(() => '')).includes('作りかけはこの端末に自動で残ります。作った問題は「自分が作った問題」にあり、遊ばれる前なら組み直せます'), '(c) 共有の窓の中に札 saved が出る');
    const above = await page.evaluate(() => {
      const t = document.querySelector('[data-share-sheet] [data-tip="saved"]')?.getBoundingClientRect();
      const title = document.querySelector('#cw-title')?.getBoundingClientRect();
      return !!t && !!title && t.bottom <= title.top + 1;
    });
    check(above, '(c) 札 saved は窓の上（題名の欄より上）');
    await shot(page, 'c3-tip-saved');
    await tip3.getByRole('button', { name: '閉じる' }).click();
    check((await page.locator('[data-tip]').count()) === 0, '(c) 札 saved の × で消える');
    await closeShare(page);
    await openShare(page);
    check((await page.locator('[data-tip="saved"]').count()) === 0, '(c) 二度目の共有の窓には札 saved は出ない');
    await closeShare(page);
    // 作りかけを消して開き直し、1語目から作り直しても、札 cross・move はもう出ない
    await page.evaluate(() => { localStorage.removeItem('crossword_draft'); localStorage.removeItem('crossword_draft_v3'); });
    await page.reload();
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await writeLines(page, 'ニャーと鳴く動物→【ネコ】');
    await page.waitForTimeout(1000);
    check((await page.locator('[data-tip]').count()) === 0, '(c) 二度目は札 cross が出ない');
    await writeLines(page, 'ニャーと鳴く動物→【ネコ】\n【コアラ】はユーカリを食べる');
    await waitBoard(page);
    await openBoard(page);
    await page.waitForTimeout(1000);
    check((await page.locator('[data-tip]').count()) === 0, '(c) 二度目は広げた盤に札 move も出ない');
    await closeBoard(page);
    check(mockedSaves === 0, `(c) 保存は一度も押していない（台本が受け止めた保存 ${mockedSaves}回）`);
    const keys = await page.evaluate(() => ['crossword_seen_first_cell', 'crossword_seen_tip_cross', 'crossword_seen_tip_move', 'crossword_seen_tip_saved'].map((k) => `${k}=${localStorage.getItem(k)}`).join(' '));
    console.log(`   この端末の印: ${keys}`);
    await ctx.close();
  }

  // ===== (d) 作る画面に「?」と11段の案内は無い（Hop 決定 2026-10-20。「パズルの作り方」と11段の案内は外した） =====
  {
    const { ctx, page } = await newCtx();
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(2000);
    const st = await page.evaluate(() => ({
      help: document.querySelectorAll('[title="パズルの作り方"], [aria-label="パズルの作り方"]').length,
      guide: [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === '案内を見る').length,
      layer: document.querySelectorAll('[data-coach-layer]').length,
    }));
    check(st.help === 0 && st.guide === 0 && st.layer === 0, `(d) 作る画面に「?」（パズルの作り方）も「案内を見る」も幕も無い（? ${st.help}・案内 ${st.guide}・幕 ${st.layer}）`);
    await ctx.close();
  }

  // ===== (e) 書き込み =====
  check(stumbles.length === 0, `画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）が無い${stumbles.length ? '：' + stumbles.slice(0, 3).join(' / ') : ''}`);
  check(writes.length === 0, `(e) 受付係・棚への書き込みは0回（${writes.length}回${writes.length ? ': ' + writes.join(' / ') : ''}）。保存は台本が ${mockedSaves} 回受け止めて外へ出していない`);
}

// --- 流す ---
try {
  if (BASE === LOCAL) await startServer();
  browser.b = await chromium.launch();
  if (IS_LOCAL) await warmUp();
  await run();
} catch (e) {
  console.log(`NG 台本が途中で止まった: ${e.stack || e.message}`);
  fail++;
} finally {
  await browser.b?.close().catch(() => {});
  stopServer();
}
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
