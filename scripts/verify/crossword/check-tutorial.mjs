// 作る側と解く側のチュートリアル（Hop 決定 2026-10-05「止めない・読ませない・その場で1行」）を確かめる。
// 手元の開発サーバー（vite）をこの台本が立ち上げ、終わったら止める。本番の棚は読むだけで、何も書かない
// （解く側の練習問題は受付係を通さない。作る側の「共有する」は、人間確認と保存の受付係をブラウザの中で受け止めて、外へ出さない）。
//   (a) 記録が空の端末で問題を開く → 遊び方の窓は「始める！」だけ → 始めると最初のマスが脈打ち、盤の下に1行
//       → マスを押すと両方消える → 開き直しても出ない。幕は無い
//   (b) 「?」→「練習する」→ 案内は2段（×つき）→ 案内なしで解き切る → ハンコ → 「本番へ」。見出しの戻る矢印はいつも出ている
//   (c) 作る画面（4段の流れ・2026-10-21 に書き直し）: 初めて開いても案内（幕）は出ない → 1の段で答えが1つ → 札1 → × → 2語目 → 2の段で盤 → 札2 → ×
//       → 3の段 → 4の窓（共有する）に札3 → × → 二度目は出ない（保存は押さない）
//   (d) 作る画面に「?」（パズルの作り方）と11段の案内は無い（2026-10-20 Hop 決定で外した）
//   (e) 受付係・棚への書き込み（保存・更新・記録・通報・削除）は0回。本物の問題を開く時の回の開始は数えない
// 場面ごとに 390px の写真を残し、吹き出しと「×」が画面に収まっているか・横にはみ出したスクロールが無いかを見る。
// 使い方: node scripts/verify/crossword/check-tutorial.mjs [サイト（省略すると手元の開発サーバーを立てる）] [問題の番号]
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { arg, outDir, ROOT, ID_DEFAULT, leaveFirstVisitMarks, cellAt, watchStumbles } from './_lib.mjs';
import { writeLines, toBoard, toClues, hintAllInClues, openShare } from './_create.mjs';

// 「初めて」の印を立てずに流す（ほかの台本は _lib.mjs が印を立ててから開く）
leaveFirstVisitMarks();

const PORT = 5191;
const LOCAL = `http://localhost:${PORT}`;
const BASE = arg(2, LOCAL);
const ID = arg(3, ID_DEFAULT);
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
async function startServer() {
  server = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
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
    if (u.includes('/api/crossword-') || (u.includes('/rest/v1/') && m !== 'GET' && m !== 'HEAD')) writes.push(`${m} ${u.replace(/\?.*/, '')}`);
  });
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
    const skip = !!b && [...b.querySelectorAll('button')].some((e) => e.textContent === 'とばす');
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
async function run() {
  // ===== (a) 解く側: 初めての脈打ちと1行 =====
  let entryPath = `/crossword/${ID}`;
  let fromExpected = ID;
  const playCalls = [];
  {
    const { ctx, page } = await newCtx();
    let counting = false;
    ctx.on('request', (r) => {
      if (counting && r.url().includes('/api/crossword-play')) playCalls.push(`${r.method()} ${r.url()}`);
    });
    const notes = [];
    page.on('console', (m) => m.type() === 'error' && notes.push(m.text().slice(0, 160)));
    await page.goto(`${BASE}${entryPath}`);
    const waitStart = () => page.getByRole('button', { name: /始める！/ }).waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    let opened = await waitStart();
    if (!opened && notes.some((n) => n.includes('supabaseUrl is required'))) {
      console.log(`   手元の開発サーバーは棚の設定を持っていない（「supabaseUrl is required」）。本物の問題 ${ID} の代わりに見本の問題 /crossword/create?debug=true で確かめる`);
      entryPath = '/crossword/create?debug=true';
      fromExpected = null;
      await page.goto(`${BASE}${entryPath}`);
      opened = await waitStart();
    }
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
    check((await line.innerText().catch(() => '')) === 'マスを押すと字が入ります', '(a) 盤のすぐ下に1行「マスを押すと字が入ります」');
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
    counting = true; // 練習が終わるまで受付係への通信を数える
    await page.getByRole('button', { name: '練習する' }).click();
    await page.waitForURL((u) => u.pathname === '/crossword/tutorial', { timeout: 15000 });
    check(new URL(page.url()).searchParams.get('from') === fromExpected, `(b) 練習問題の住所へ移る（from=${fromExpected ?? 'なし（見本の問題には番号が無い）'}）`);
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
    check(playCalls.length === 0, `(b) 練習中に受付係（/api/crossword-play）への通信が無い（${playCalls.length}回）`);
    counting = false;
    await real.click();
    const backPath = fromExpected ? `/crossword/${fromExpected}` : '/crossword';
    check(await page.waitForURL((u) => u.pathname === backPath, { timeout: 15000 }).then(() => true).catch(() => false), `(b) 「本番へ」で ${backPath} へ移る`);
    if (!fromExpected) {
      await page.goto(`${BASE}/crossword/tutorial?from=${ID}`);
      await waitBubble(page, '左上のマスを押してみましょう', '(b) 番号つきの練習問題');
      await page.locator('[data-coach-close]').click();
      await page.locator('[data-coach="tutorial-done"]').getByRole('button', { name: '本番へ' }).click();
      check(await page.waitForURL((u) => u.pathname === `/crossword/${ID}`, { timeout: 15000 }).then(() => true).catch(() => false), `(b) /crossword/tutorial?from=${ID} の「本番へ」で元の問題 /crossword/${ID} へ移る`);
    }
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

  // ===== (c) 作る側: 場面ごとの札（4段の流れ・2026-10-21 に書き直し） =====
  // 1の段は「書く」の側だけで進める（「ヒントを付ける」の側は初めての端末でなぞる動きが出る。なぞる動きは check-create-flow が見る）
  {
    const { ctx, page } = await newCtx();
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500);
    check((await page.locator('[data-coach-layer]').count()) === 0, '(c) 作る画面を初めて開いても幕つきの案内は出ない');
    check((await page.locator('[data-tip]').count()) === 0, '(c) 答えが無い間は札も出ない');
    await page.screenshot({ path: path.join(OUT, 'c0-create.png') });
    await writeLines(page, 'ニャーと鳴く動物→【ネコ】');
    const tip1 = await page.locator('[data-tip="cross"]').waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    check(tip1, '(c) 1の段で答えが1つになると札1 が出る');
    check((await page.locator('[data-tip="cross"]').innerText().catch(() => '')).includes('もう1語足すと、同じ字で交差して組まれます'), '(c) 札1 の文「もう1語足すと、同じ字で交差して組まれます」');
    check((await page.locator('[data-tip]').count()) === 1 && (await page.locator('[data-coach-layer]').count()) === 0, '(c) 札は1つだけ・幕は無い');
    await page.locator('[data-tip="cross"]').scrollIntoViewIfNeeded();
    await shot(page, 'c1-tip-cross');
    await page.locator('[data-tip="cross"]').getByRole('button', { name: '閉じる' }).click();
    check((await page.locator('[data-tip]').count()) === 0, '(c) 札1 の × で消える');
    await writeLines(page, 'ニャーと鳴く動物→【ネコ】\n【コアラ】はユーカリを食べる');
    await toBoard(page);
    const tip2 = await page.locator('[data-tip="move"]').waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    check(tip2, '(c) 2の段で盤ができると札2 が出る');
    check((await page.locator('[data-tip="move"]').innerText().catch(() => '')).includes('盤の語は長押しで動かせます'), '(c) 札2 の文「盤の語は長押しで動かせます」');
    const below2 = await page.evaluate(() => {
      const b = document.querySelector('[data-create-board]')?.getBoundingClientRect();
      const t = document.querySelector('[data-tip="move"]')?.getBoundingClientRect();
      return !!b && !!t && t.top >= b.bottom - 1;
    });
    check(below2, '(c) 札2 は盤の下');
    check((await page.locator('[data-tip]').count()) === 1, '(c) 札は1つだけ');
    await page.locator('[data-tip="move"]').scrollIntoViewIfNeeded();
    await shot(page, 'c2-tip-move');
    await page.locator('[data-tip="move"]').getByRole('button', { name: '閉じる' }).click();
    check((await page.locator('[data-tip]').count()) === 0, '(c) 札2 の × で消える');
    await toClues(page);
    await hintAllInClues(page); // ヒントは https のリンク（棚を読まない）
    await openShare(page);
    const tip3 = page.locator('[data-share-sheet] [data-tip="saved"]');
    check((await tip3.innerText().catch(() => '')).includes('作りかけはこの端末に自動で残ります。作った問題は「自分が作った問題」にあり、遊ばれる前なら組み直せます'), '(c) 4の窓（共有する）の中に札3 が出る');
    const above = await page.evaluate(() => {
      const t = document.querySelector('[data-share-sheet] [data-tip="saved"]')?.getBoundingClientRect();
      const title = document.querySelector('#cw-title')?.getBoundingClientRect();
      return !!t && !!title && t.bottom <= title.top + 1;
    });
    check(above, '(c) 札3 は窓の上（題名の欄より上）');
    await shot(page, 'c3-tip-saved');
    await tip3.getByRole('button', { name: '閉じる' }).click();
    check((await page.locator('[data-tip]').count()) === 0, '(c) 札3 の × で消える');
    await page.locator('[data-share-sheet] [data-step-back="3"]').click();
    await openShare(page);
    check((await page.locator('[data-tip="saved"]').count()) === 0, '(c) 二度目の共有の窓には札3 は出ない');
    await page.locator('[data-share-sheet] [data-step-back="3"]').click();
    // 開き直して1語目から作り直しても、札1・札2 はもう出ない
    await page.evaluate(() => localStorage.removeItem('crossword_draft'));
    await page.reload();
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await writeLines(page, 'ニャーと鳴く動物→【ネコ】');
    await page.waitForTimeout(1000);
    check((await page.locator('[data-tip]').count()) === 0, '(c) 二度目は札1 が出ない');
    await writeLines(page, 'ニャーと鳴く動物→【ネコ】\n【コアラ】はユーカリを食べる');
    await toBoard(page);
    await page.waitForTimeout(1000);
    check((await page.locator('[data-tip]').count()) === 0, '(c) 二度目は札2 も出ない');
    const keys = await page.evaluate(() => ['crossword_seen_first_cell', 'crossword_seen_tip_cross', 'crossword_seen_tip_move', 'crossword_seen_tip_saved', 'crossword_seen_trace'].map((k) => `${k}=${localStorage.getItem(k)}`).join(' '));
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
