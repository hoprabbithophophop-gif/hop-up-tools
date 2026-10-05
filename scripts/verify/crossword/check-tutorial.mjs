// 作る側と解く側のチュートリアル（Hop 決定 2026-10-05・案B「実物の上で案内する」）を確かめる。
// 手元の開発サーバー（vite）をこの台本が立ち上げ、終わったら止める。本番の棚は読むだけで、何も書かない
// （作る側は「共有する」を押さない。解く側の練習問題は受付係を通さない。手元の /api は本番へつながっていない）。
//   (a) 記録が空のブラウザで解く画面を開くと「練習してから始める」「このまま始める」が出る
//   (b) 練習を選ぶと /crossword/tutorial で段が順に出て、文字盤で解き切るとハンコが出て「本番へ」で元の問題に戻る
//   (c) 練習中に受付係（/api/crossword-play）への通信が1回も無い
//   (d) 作る画面を初めて開くと案内が出て、答え・カギ・ヒント・追加を実際にやると次の段へ進み、最後まで行くと印が付いて2回目は出ない
//   (e) 「?」から開き直せる（作る画面の「案内を見る」・解く画面の「練習する」）。練習問題で「とばす」を押しても「初めて」の印が付く
// 各段で 390px の写真を残し、吹き出しが画面の横幅に収まっているか・横にはみ出したスクロールが無いかを見る。
// 使い方: node scripts/verify/crossword/check-tutorial.mjs [サイト（省略すると手元の開発サーバーを立てる）] [問題の番号]
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { arg, outDir, ROOT, ID_DEFAULT } from './_lib.mjs';

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

// --- 小物 ---
async function newCtx() {
  const ctx = await browser.b.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  return { ctx, page };
}
const bubble = (page) => page.locator('[data-coach-bubble]');
async function bubbleText(page, timeout = 15000) {
  await bubble(page).waitFor({ state: 'visible', timeout });
  return (await bubble(page).innerText()).replace(/\s+/g, ' ');
}
async function waitBubble(page, text, label, timeout = 15000) {
  const ok = await page
    .waitForFunction((t) => document.querySelector('[data-coach-bubble]')?.textContent?.includes(t), text, { timeout })
    .then(() => true)
    .catch(() => false);
  check(ok, `${label}: 吹き出し「${text}」が出る`);
  return ok;
}
// 吹き出しが画面の横幅に収まり、ページが横にはみ出していないか。写真も撮る
async function shot(page, name) {
  await page.waitForTimeout(500); // スクロールが落ち着くのを待つ
  const m = await page.evaluate(() => {
    const b = document.querySelector('[data-coach-bubble]');
    const r = b ? b.getBoundingClientRect() : null;
    const d = document.documentElement;
    return { r: r && { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, sw: d.scrollWidth, vw: d.clientWidth, vh: d.clientHeight };
  });
  if (m.r) check(m.r.left >= 0 && m.r.right <= m.vw && m.r.top >= 0 && m.r.bottom <= m.vh, `${name}: 吹き出しが画面に収まる（左${Math.round(m.r.left)} 右${Math.round(m.r.right)} 上${Math.round(m.r.top)} 下${Math.round(m.r.bottom)} ／ 画面 ${m.vw}×${m.vh}）`);
  check(m.sw <= m.vw, `${name}: 横にはみ出したスクロールが無い（${m.sw}px）`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}
const nextBtn = (page) => bubble(page).getByRole('button', { name: '次へ' });
const key = (page, ch) => page.locator('[data-coach="keypad"]').getByRole('button', { name: ch, exact: true }).first();

async function run() {
  // ===== (a)(b)(c) 解く側 =====
  {
    const { ctx, page } = await newCtx();
    const playCalls = [];
    let counting = false;
    ctx.on('request', (r) => {
      if (r.url().includes('/api/crossword-play') && counting) playCalls.push(`${r.method()} ${r.url()}`);
    });
    // 問題が読めなかった時に理由を出すため、棚の返事と画面の失敗の知らせを控える（中身は出さない）
    const notes = [];
    page.on('console', (m) => m.type() === 'error' && notes.push(`console: ${m.text().slice(0, 160)}`));
    page.on('response', (r) => r.url().includes('/rest/v1/crossword_puzzles') && notes.push(`棚 ${r.status()}`));
    // 本物の問題で確かめる。手元の開発サーバーが棚の設定を持っていない時は、解く画面の見本の問題（?debug=true。棚を読まない）で入口を確かめる
    let entryPath = `/crossword/${ID}`;
    let fromExpected = ID;
    await page.goto(`${BASE}${entryPath}`);
    const waitEntrance = () => page.getByRole('button', { name: '練習してから始める' }).waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    let entrance = await waitEntrance();
    if (!entrance && notes.some((n) => n.includes('supabaseUrl is required'))) {
      console.log(`   手元の開発サーバーは棚の設定を持っていない（「supabaseUrl is required」）。本物の問題 ${ID} の代わりに見本の問題 /crossword/create?debug=true で入口を確かめる`);
      entryPath = '/crossword/create?debug=true';
      fromExpected = null;
      await page.goto(`${BASE}${entryPath}`);
      entrance = await waitEntrance();
    }
    check(entrance, `(a) 記録が空のブラウザで解く画面（${entryPath}）を開くと「練習してから始める」が出る`);
    if (!entrance) {
      console.log(`   手がかり: ${notes.join(' ／ ') || '無し'}`);
      throw new Error('解く画面が開けないので続きを確かめられない');
    }
    check((await page.getByRole('button', { name: 'このまま始める' }).count()) > 0, '(a) 「このまま始める」も出る');
    check((await page.getByRole('button', { name: '始める！' }).count()) === 0, '(a) 初めての時は「始める！」の代わりに2つの入口');
    await page.waitForTimeout(2500); // ページ移動の波が引くのを待つ
    await page.screenshot({ path: path.join(OUT, 'a-entrance.png') });

    counting = true; // ここから練習が終わるまで受付係への通信を数える
    await page.getByRole('button', { name: '練習してから始める' }).click();
    await page.waitForURL((u) => u.pathname === '/crossword/tutorial', { timeout: 15000 });
    check(new URL(page.url()).searchParams.get('from') === fromExpected, `(b) 練習問題の住所 /crossword/tutorial${fromExpected ? `?from=${fromExpected}` : '（見本の問題には番号が無いので from なし）'} へ移る`);

    // 段1 マスを押す
    await waitBubble(page, 'マスを押すと', '(b) 段1');
    check((await nextBtn(page).count()) === 0, '(b) 段1 は「次へ」が無く、マスを押して進む');
    check(!(await page.evaluate(() => /\d\d:\d\d/.test(document.querySelector('header')?.innerText || ''))), '(b) 練習問題ではタイマーを出さない');
    await shot(page, 'b1-cell');
    await page.locator('#cell-0-0').click();

    // 段2 文字盤
    await waitBubble(page, '文字盤で字を入れると', '(b) 段2');
    check(await nextBtn(page).isDisabled(), '(b) 段2 は字を入れるまで「次へ」を押せない');
    await shot(page, 'b2-keypad');
    await key(page, 'ネ').click();
    await page.waitForTimeout(300);
    check(await nextBtn(page).isEnabled(), '(b) 段2 字を入れると「次へ」を押せる');
    check((await page.getByRole('button', { name: '1行1列: ネ' }).count()) > 0, '(b) 文字盤の字が盤のマスに入る');
    await nextBtn(page).click();

    // 段3 カギとヒント
    await waitBubble(page, 'ここにカギが出ます', '(b) 段3');
    await shot(page, 'b3-head');
    await page.locator('[data-coach="closeup-head"]').getByRole('button', { name: 'ヒント' }).click();
    check(await page.getByText('2文字目は「コ」').isVisible().catch(() => false), '(b) 段3 「ヒント」を押すと1行の文のヒントが文字盤の場所に出る');
    await shot(page, 'b3-hint');
    await page.locator('[data-coach="closeup-head"]').getByRole('button', { name: 'ヒント' }).click();
    await nextBtn(page).click();

    // 段4 1文字見る
    await waitBubble(page, '1文字見る', '(b) 段4');
    await shot(page, 'b4-reveal');
    await page.locator('[data-coach="reveal"]').click();
    await page.getByRole('button', { name: '見る', exact: true }).click();
    await page.waitForTimeout(300);
    check((await page.getByRole('button', { name: '1行2列: コ' }).count()) > 0, '(b) 段4 「1文字見る」でマスに字が入る（ブラウザの中だけで）');
    await nextBtn(page).click();

    // 段5 残りを埋める
    await waitBubble(page, '残りのマスも埋めてみましょう', '(b) 段5');
    await shot(page, 'b5-free');
    await nextBtn(page).click();
    await page.waitForTimeout(300);
    check((await bubble(page).count()) === 0, '(b) 段5 の後は案内を消して自由に解ける');

    // 文字盤で解き切る（コアラの ア・ラ、ラムネの ム・ネ）
    await page.getByRole('button', { name: '閉じる' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('#cell-1-1').click();
    await key(page, 'ア').click();
    await key(page, 'ラ').click();
    await page.getByRole('button', { name: '閉じる' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('#cell-2-2').click();
    await key(page, 'ム').click();
    await key(page, 'ネ').click();
    const stamped = await page.waitForFunction(() => document.body.innerText.includes('CLEARED!'), null, { timeout: 10000 }).then(() => true).catch(() => false);
    check(stamped, '(b) 最後のマスを埋めると自動で答え合わせして、ハンコが出る');
    await waitBubble(page, '全部合うと、ハンコが押されます', '(b) 段6');
    const text = await page.evaluate(() => document.body.innerText);
    check(!text.includes('Xに投稿') && !text.includes('通報') && !text.includes('載せない') && !text.includes('ランキング'), '(b) 練習問題では X 投稿・通報・名前を入れる窓・ランキングを出さない');
    await shot(page, 'b6-done');

    check(playCalls.length === 0, `(c) 練習中に受付係（/api/crossword-play）への通信が無い（${playCalls.length}回${playCalls.length ? ': ' + playCalls.join(' / ') : ''}）`);
    counting = false; // 本番へ戻ると、その問題の回を始める通信が出るのは正しい
    await page.locator('[data-coach="tutorial-done"]').getByRole('button', { name: '本番へ' }).click();
    const backPath = fromExpected ? `/crossword/${fromExpected}` : '/crossword';
    const back = await page.waitForURL((u) => u.pathname === backPath, { timeout: 15000 }).then(() => true).catch(() => false);
    check(back, `(b) 「本番へ」で ${fromExpected ? '元の問題' : '問題の一覧'} ${backPath} へ移る`);
    if (!fromExpected) {
      // 番号つきで来た時の戻り道は、住所に from を付けて開いて確かめる（解き切らずに「本番へ」を押す）
      await page.goto(`${BASE}/crossword/tutorial?from=${ID}`);
      await bubbleText(page);
      await bubble(page).getByRole('button', { name: 'とばす' }).click();
      await page.locator('[data-coach="tutorial-done"]').getByRole('button', { name: '本番へ' }).click();
      const back2 = await page.waitForURL((u) => u.pathname === `/crossword/${ID}`, { timeout: 15000 }).then(() => true).catch(() => false);
      check(back2, `(b) /crossword/tutorial?from=${ID} の「本番へ」で元の問題 /crossword/${ID} へ移る（解く前でも押せる）`);
    }
    await page.goto(`${BASE}${entryPath}`);
    await page.waitForTimeout(4000);
    check((await page.getByRole('button', { name: '練習してから始める' }).count()) === 0, '(b) 練習の後に問題を開いても入口の窓をもう出さない');
    await page.screenshot({ path: path.join(OUT, 'b7-back.png') });

    // (e) 解く画面の「?」から「練習する」で開き直せる
    await page.getByTitle('遊び方').first().click();
    await page.getByRole('button', { name: '練習する' }).waitFor();
    await page.screenshot({ path: path.join(OUT, 'e1-help-modal.png') });
    await page.getByRole('button', { name: '練習する' }).click();
    await page.waitForURL((u) => u.pathname === '/crossword/tutorial', { timeout: 15000 });
    await waitBubble(page, 'マスを押すと', '(e) 解く画面の「?」→「練習する」で練習問題が開き直せる');
    await page.screenshot({ path: path.join(OUT, 'e1-practice-again.png') });
    await ctx.close();
  }

  // (e) 練習問題で「とばす」を押しても「初めて」の印が付く
  {
    const { ctx, page } = await newCtx();
    await page.goto(`${BASE}/crossword/tutorial`);
    await bubbleText(page);
    await bubble(page).getByRole('button', { name: 'とばす' }).click();
    await page.waitForTimeout(300);
    check((await bubble(page).count()) === 0, '(e) 練習問題の「とばす」で案内が消える');
    check((await page.evaluate(() => localStorage.getItem('crossword_seen_help'))) === 'true', '(e) 「とばす」で終えても「初めて」の印が付く');
    await ctx.close();
  }

  // ===== (d)(e) 作る側 =====
  {
    const { ctx, page } = await newCtx();
    const writes = [];
    ctx.on('request', (r) => {
      const u = r.url();
      if ((u.includes('/api/crossword-save') || u.includes('/api/crossword-play') || (u.includes('/rest/v1/') && r.method() !== 'GET' && r.method() !== 'HEAD'))) writes.push(`${r.method()} ${u}`);
    });
    await page.goto(`${BASE}/crossword/create`);
    await waitBubble(page, '答えをカタカナで', '(d) 作る画面を初めて開くと案内が出る（段1 答え）', 30000);
    check(await nextBtn(page).isDisabled(), '(d) 段1 答えを打つまで「次へ」を押せない');
    await shot(page, 'd01-answer');
    const answer = page.locator('[data-coach="create-answer"] input');
    await answer.fill('猫');
    await page.waitForTimeout(200);
    check(await nextBtn(page).isDisabled(), '(d) 段1 漢字の答えでは「次へ」を押せない');
    await answer.fill('ねこ');
    await page.waitForTimeout(200);
    check(await nextBtn(page).isEnabled(), '(d) 段1 ひらがなの答えで「次へ」を押せる');
    await nextBtn(page).click();

    await waitBubble(page, 'カギは、答えを当てるための問題文です', '(d) 段2 カギ');
    check(await nextBtn(page).isDisabled(), '(d) 段2 カギを打つまで「次へ」を押せない');
    await shot(page, 'd02-clue');
    await page.locator('[data-coach="create-clue"] input').fill('ニャーと鳴く動物');
    await nextBtn(page).click();

    await waitBubble(page, 'ヒントは答えの根拠です', '(d) 段3 ヒント');
    check(await nextBtn(page).isDisabled(), '(d) 段3 ヒントを入れるまで「次へ」を押せない');
    await shot(page, 'd03-hint');
    await page.locator('[data-coach="create-hint"] input').first().fill('https://example.com/');
    await page.waitForTimeout(300);
    await nextBtn(page).click();

    await waitBubble(page, '「リストに追加」を押します', '(d) 段4 追加');
    await shot(page, 'd04-add');
    await page.getByRole('button', { name: 'リストに追加' }).click();
    await waitBubble(page, 'ここに盤が組み上がります', '(d) 段4 の後、追加を押すと盤の段へ進む');
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('[data-coach-bubble] button')].find((x) => x.textContent === '次へ');
      return b && !b.disabled;
    }, null, { timeout: 30000 });
    await shot(page, 'd05-board');
    await nextBtn(page).click();

    await waitBubble(page, 'もう1語足してみましょう', '(d) 段5 2語目');
    await shot(page, 'd06-second');
    await page.locator('[data-coach="create-answer"] input').fill('コアラ');
    await page.locator('[data-coach="create-clue"] input').fill('ユーカリの葉を食べる動物');
    await page.locator('[data-coach="create-hint"] input').first().fill('https://example.com/');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'リストに追加' }).click();
    await waitBubble(page, '型の案内', '(d) 段5 の後、2語目を足すと次の段へ進む');
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('[data-coach-bubble] button')].find((x) => x.textContent === '次へ');
      return b && !b.disabled;
    }, null, { timeout: 30000 });
    const crossed = await page.evaluate(() => document.querySelectorAll('[data-coach="create-board"] .puzzle-cell').length);
    check(crossed === 4, `(d) 2語が交差して組まれる（マス ${crossed}。ネコ＋コアラで4）`);
    await shot(page, 'd07-shape');
    await nextBtn(page).click();

    await waitBubble(page, '長押しで動かせます', '(d) 段7 動かす・固定');
    await shot(page, 'd08-move');
    await nextBtn(page).click();
    await waitBubble(page, '題名を入れます', '(d) 段8 題名');
    await shot(page, 'd09-title');
    await nextBtn(page).click();
    await waitBubble(page, '「共有する」で保存すると公開され', '(d) 段9 共有する');
    await shot(page, 'd10-share');
    await nextBtn(page).click();
    await waitBubble(page, '作りかけは、この端末に自動で残ります', '(d) 段10 作りかけ・自分が作った問題');
    await shot(page, 'd11-mine');
    await bubble(page).getByRole('button', { name: '閉じる' }).click();
    await page.waitForTimeout(300);
    check((await bubble(page).count()) === 0, '(d) 最後の段の「閉じる」で案内が消える');
    check((await page.evaluate(() => localStorage.getItem('crossword_seen_create_guide'))) === '1', '(d) 最後まで行くと印が付く');
    check(await page.evaluate(() => (localStorage.getItem('crossword_draft') || '').includes('ユーカリの葉を食べる動物')), '(d) 案内で入れた語は作りかけとして残っている');

    await page.reload();
    await page.waitForTimeout(4000);
    check((await bubble(page).count()) === 0, '(d) 2回目に開いた時は案内が出ない');

    // (e) 「?」の窓の「案内を見る」で開き直せる。とばすで消える
    await page.getByTitle('遊び方').first().click();
    await page.getByRole('button', { name: '案内を見る' }).waitFor();
    check(await page.getByText('ほかにできること').isVisible(), '(e) 「パズルの作り方」の窓に、足した物の説明が出る');
    await page.getByRole('button', { name: '案内を見る' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, 'e2-help-modal.png') });
    await page.getByRole('button', { name: '案内を見る' }).click();
    await waitBubble(page, '答えをカタカナで', '(e) 作る画面の「?」→「案内を見る」で案内が開き直せる');
    await page.screenshot({ path: path.join(OUT, 'e3-guide-again.png') });
    await bubble(page).getByRole('button', { name: 'とばす' }).click();
    await page.waitForTimeout(300);
    check((await bubble(page).count()) === 0, '(e) 作る画面の「とばす」で案内が消える');
    check(writes.length === 0, `(d) 作る側の案内の間に保存・書き込みの通信が無い（${writes.length}回${writes.length ? ': ' + writes.join(' / ') : ''}）`);
    await ctx.close();
  }

  // (d) YouTube のヒントを選ぶと欄の中にプレーヤーが出る。プレーヤーが穴の中にあれば幕と吹き出しは出たまま（幕を動画の上に重ねない）
  {
    const { ctx, page } = await newCtx();
    await page.goto(`${BASE}/crossword/create`);
    // ジャンルを「その他」にした作りかけから始める（その他は YouTube の URL をそのまま受け付け、棚を読まない）
    await page.evaluate(() => localStorage.setItem('crossword_draft', JSON.stringify({ title: '', creatorName: '', genre: 'other', tags: [], isBeginner: false, items: [], hints: {}, input: { q: 'ニャーと鳴く動物', a: 'ネコ' } })));
    await page.reload();
    await waitBubble(page, '答えをカタカナで', '(d) YouTube の段 段1', 30000);
    await nextBtn(page).click();
    await waitBubble(page, 'カギは、答えを当てるための問題文です', '(d) YouTube の段 段2');
    await nextBtn(page).click();
    await waitBubble(page, 'ヒントは答えの根拠です', '(d) YouTube の段 段3');
    await page.locator('[data-coach="create-hint"] input').first().fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=83');
    const iframe = await page.locator('[data-coach="create-hint"] iframe').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    check(iframe, '(d) YouTube のヒントを選ぶと、ヒント欄の中にプレーヤーが出る');
    await page.waitForTimeout(1500);
    check(await bubble(page).isVisible().catch(() => false), '(d) 段3 プレーヤーは穴の中なので吹き出しは出たまま');
    await shot(page, 'd13-youtube-hint');
    await nextBtn(page).click();
    await page.waitForTimeout(1500);
    const addVisible = await page.waitForFunction(() => document.querySelector('[data-coach-bubble]')?.textContent?.includes('「リストに追加」を押します'), null, { timeout: 5000 }).then(() => true).catch(() => false);
    check(addVisible, '(d) 段4 プレーヤーが出ている時も「リストに追加」の吹き出しが消えない');
    const covered = await page.evaluate(() => {
      const f = document.querySelector('[data-coach="create-hint"] iframe')?.getBoundingClientRect();
      const b = document.querySelector('[data-coach-bubble]')?.getBoundingClientRect();
      if (!f || !b) return null;
      return b.left < f.right && f.left < b.right && b.top < f.bottom && f.top < b.bottom;
    });
    check(covered === false, '(d) 段4 吹き出しがプレーヤーに重ならない');
    await shot(page, 'd14-youtube-add');
    await bubble(page).getByRole('button', { name: 'とばす' }).click();
    await ctx.close();
  }

  // (d) 「とばす」で終えても印が付き、2回目は出ない
  {
    const { ctx, page } = await newCtx();
    await page.goto(`${BASE}/crossword/create`);
    await bubbleText(page, 30000);
    await bubble(page).getByRole('button', { name: 'とばす' }).click();
    check((await page.evaluate(() => localStorage.getItem('crossword_seen_create_guide'))) === '1', '(d) 作る画面の「とばす」でも印が付く');
    await page.reload();
    await page.waitForTimeout(4000);
    check((await bubble(page).count()) === 0, '(d) とばした後に開き直しても案内は出ない');
    await ctx.close();
  }
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

