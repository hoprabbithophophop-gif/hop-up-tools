// 「まとめて入れる」を確かめる。
// (a) 探す仕組み（src/lib/crossword/bulkSelect.ts）を、本物のファイルのまま node で動かす。
//     ts は check-build.mjs と同じく stripTypeScriptTypes で型だけ外し、一時置き場に .mjs として書いて読み込む（論理は写さない）。
// (b) 作る画面（/crossword/create）を、手元に立てた開発サーバー（口 5197）と Playwright で通しで動かす。棚と受付係への通信は受け止める。
// 使い方: node scripts/verify/crossword/check-bulk-entry.mjs（引数なし）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { performance } from 'node:perf_hooks';
import { ROOT, outDir } from './_lib.mjs';

let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
// 締めの1行は終わる時に出す。(a) の後ろに (b) が足されても、両方の NG を数えたうえで最後に1回だけ出すため
process.on('exit', (code) => {
  console.log(fail ? `NG ${fail}件` : code ? `NG 途中で止まった（終了コード ${code}）` : 'すべてOK');
  if (fail && !code) process.exitCode = 1;
});

async function runNodeChecks() {
  const dir = outDir('check-bulk-entry');
  for (const name of ['types', 'engine', 'bulkSelect']) {
    const src = readFileSync(path.join(ROOT, 'src', 'lib', 'crossword', `${name}.ts`), 'utf8');
    writeFileSync(path.join(dir, `${name}.mjs`), stripTypeScriptTypes(src).replace(/from '\.\/(types|engine)'/g, "from './$1.mjs'"));
  }
  const stamp = `?t=${Date.now()}`;
  const { createBulkSearch } = await import(pathToFileURL(path.join(dir, 'bulkSelect.mjs')).href + stamp);
  const { buildGrid } = await import(pathToFileURL(path.join(dir, 'engine.mjs')).href + stamp);

  const W = (w) => ({ id: w, question: '', answer: Array.from(w) });
  const run = (words, opts) => {
    const s = createBulkSearch(words.map(W), opts);
    const t0 = performance.now();
    while (!s.finished()) s.step(30);
    return { s, wall: performance.now() - t0, list: s.proposals() };
  };
  const key = (p) => `${p.placed.map((x) => x.id).sort().join(',')}|${p.width}x${p.height}|${p.crossings}`;
  const desc = (p) => `${p.placed.length}語・${p.cells}マス・交差${p.crossings}・${p.width}x${p.height}${p.leftOut.length ? `・入らない: ${p.leftOut.map((i) => i.id).join(', ')}` : ''}`;
  // 提案の数字が、置けた語から作り直した盤と合っているか（呼ぶ側の画面がこの数字をそのまま出すため）
  const numbersMatch = (p, pool) => {
    const g = buildGrid(p.placed);
    const on = new Set(p.placed.map((x) => x.id));
    return g.width === p.width && g.height === p.height && g.cells.length === p.cells
      && g.cells.filter((c) => (c.wordIds?.length ?? 0) >= 2).length === p.crossings
      && p.leftOut.length === pool.filter((w) => !on.has(w)).length
      && p.leftOut.every((i) => !on.has(i.id));
  };

  // 全部が互いに交われる5語
  const FIVE = ['コンサートホール', 'レコード', 'コーラス', 'センター', 'ステージ'];
  {
    const { s, wall, list } = run(FIVE);
    list.forEach((p, i) => console.log(`    5語 提案${i + 1}: ${desc(p)}`));
    check(list.length >= 1, `(a) 5語で提案が1つ以上: ${list.length}個（試行 ${s.attempts()}回・${wall.toFixed(0)}ms）`);
    check(list.length === 3, `(a) 5語で提案が上位3つそろう: ${list.length}個`);
    check(new Set(list.map(key)).size === list.length, '(a) 同じ提案（語の組・大きさ・交差数が同じ）が重複しない');
    let ordered = true;
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      const ok = a.placed.length > b.placed.length
        || (a.placed.length === b.placed.length && (a.crossings > b.crossings || (a.crossings === b.crossings && (a.cells < b.cells || (a.cells === b.cells && a.width * a.height <= b.width * b.height)))));
      if (!ok) ordered = false;
    }
    check(ordered, '(a) 順位が 入った語数↓ → 交差数↓ → マス数↑ → 面積↑ の順（全部入る語の組なので語の組の違いで順が入れ替わらない）');
    check(list.every((p) => numbersMatch(p, FIVE)), '(a) 提案の 大きさ・マス数・交差数・入らない語 が、置けた語から組み直した盤と一致');
    check(list.every((p) => p.placed.length === 5 && p.leftOut.length === 0), '(a) 全部入る語の組では、どの提案も5語入り・入らない語は無し');
    check(s.finished() && s.elapsedMs() < 2000, `(a) 全部入る盤が3つそろった時点で、時間の上限より早く終わる（${s.elapsedMs().toFixed(0)}ms）`);
  }

  // 交差できない語（どの字も他の4語と共有しない）を1つ混ぜた5語
  {
    const lone = 'ミディアム';
    const others = FIVE.slice(0, 4);
    const shared = [...new Set(Array.from(lone))].filter((c) => others.some((w) => w.includes(c)));
    check(shared.length === 0, `(a) ${lone} は ${others.join('・')} とどの字も共有しない（前提）`);
    const pool = [...others, lone];
    const { s, list } = run(pool, { timeLimitMs: 300 });
    list.forEach((p, i) => console.log(`    交差できない語入り 提案${i + 1}: ${desc(p)}`));
    check(list.length >= 1, `(a) 交差できない語入りでも提案が出る: ${list.length}個（試行 ${s.attempts()}回）`);
    check(list[0] && list[0].placed.length === 4 && list[0].leftOut.length === 1 && list[0].leftOut[0].id === lone,
      `(a) 1位の提案は ${lone} を外した4語の盤で、入らなかった語に ${lone} が返る`);
    check(list.every((p) => numbersMatch(p, pool)), '(a) 入らなかった語は、置けた語以外の語とちょうど一致');
    check(new Set(list.map(key)).size === list.length, '(a) 交差できない語入りでも同じ提案が重複しない');
    check(list.every((p, i) => i === 0 || list[i - 1].placed.length >= p.placed.length), '(a) 入った語数は上から順に減るか同じ');
    check(s.elapsedMs() >= 300 && s.elapsedMs() < 400, `(a) 全部入る盤が無い時は時間の上限で止まる（上限300ms・経過 ${s.elapsedMs().toFixed(0)}ms）`);
  }

  // 語の組が違う物を先に並べる（入った語の数が同じ物の中で）
  {
    // ライト と ヒライミヨ は互いに交われるが残り6語とは交われないので、6語の島と2語の島の両方ができる
    const HOP10 = ['オレンジ', 'ライト', 'ホット', 'ミディアム', 'コジマハナ', 'スギヤマ', 'コバヤシ', 'エグチサヤ', 'ヒライミヨ', 'マエダ'];
    const { list } = run(HOP10, { timeLimitMs: 300 });
    list.forEach((p, i) => console.log(`    Hop の10語 提案${i + 1}: ${desc(p)}`));
    const firstTier = list.filter((p) => p.placed.length === list[0].placed.length);
    const sets = new Set(firstTier.map((p) => p.placed.map((x) => x.id).sort().join(',')));
    check(list.length === 3 && list[0].placed.length === 6, `(a) Hop の10語: 1位は6語の盤（${list[0] ? list[0].placed.length : 0}語）`);
    console.log(`    1位と同じ語数の提案 ${firstTier.length}個のうち、語の組の種類 ${sets.size}`);
  }

  // 3語のうち2語しか同時に入らない組（どの2語も イ で交わるが、3語目が交われる イ はもう縦横とも埋まる）。
  // 2語の盤は語の組が3種類あるので、上位3つは大きさ違いの同じ組でなく、3種類の組が並ぶはず
  {
    const TRIO = ['アイ', 'イウ', 'イエ'];
    const { list } = run(TRIO, { timeLimitMs: 200 });
    list.forEach((p, i) => console.log(`    3語のうち2語 提案${i + 1}: ${desc(p)}`));
    const sets = new Set(list.map((p) => p.placed.map((x) => x.id).sort().join(',')));
    check(list.length === 3 && list.every((p) => p.placed.length === 2) && sets.size === 3,
      `(a) 入った語数が同じ物の中では、語の組が違う物を先に並べる（上位3つの語の組 ${sets.size}種類）`);
  }

  // 字を共有しない2つの島（アイウア・アカキ／サシスサ・サタチ）。どちらの島も2語の盤で、置く順により 4x3 と 3x4 の2通りができる。
  // 同じ語の組の大きさ違いが上位に2つ並ばず、1位と2位は別の島（語の組）になるはず
  {
    const ISLANDS = ['アイウア', 'アカキ', 'サシスサ', 'サタチ'];
    let ok = 0;
    const R = 20;
    for (let r = 0; r < R; r++) {
      const { list } = run(ISLANDS, { timeLimitMs: 50 });
      if (r === 0) list.forEach((p, i) => console.log(`    2つの島 提案${i + 1}: ${desc(p)}`));
      const setOf = (p) => p.placed.map((x) => x.id).sort().join(',');
      if (list.length === 3 && setOf(list[0]) !== setOf(list[1])) ok++;
    }
    check(ok === R, `(a) 同じ語の組の大きさ違いより、別の語の組を先に並べる: 1位と2位が別の組 ${ok}/${R}回`);
  }

  // 0語・1語
  {
    const s0 = createBulkSearch([]);
    check(s0.finished() && s0.proposals().length === 0, '(a) 0語: 始めから終わっていて、提案は0');
    s0.step(30);
    check(s0.attempts() === 0 && s0.proposals().length === 0, '(a) 0語: 回しても試行0・提案0');
    const s1 = createBulkSearch([W('ステージ')]);
    let n = 0;
    while (!s1.finished() && n < 100) { s1.step(30); n++; }
    const p1 = s1.proposals();
    check(s1.finished() && n === 1, `(a) 1語: 1回の刻みで終わる（${n}回）`);
    check(p1.length === 1 && p1[0].placed.length === 1 && p1[0].width === 4 && p1[0].height === 1 && p1[0].cells === 4 && p1[0].crossings === 0 && p1[0].leftOut.length === 0,
      `(a) 1語: 提案が1つ（${p1[0] ? desc(p1[0]) : '無し'}）`);
  }

  // 上位の数は opts.top で変えられる
  {
    const { list } = run(FIVE, { top: 1 });
    check(list.length === 1, `(a) top=1 なら提案は1つ: ${list.length}個`);
  }
}

await runNodeChecks(); // (b) はここに続く

// ---- (b) 作る画面（手元の開発サーバー・本番にもプレビューにも通信しない） ----
// 手元の vite をこの台本が立ち上げ（Supabase の住所は使わない仮の住所）、棚（/rest/v1）と受付係（/api）への通信は
// ブラウザの中で受け止める。終わったら開発サーバーを止める（check-review-fixes.mjs と同じ立て方・止め方）。
const { spawn, spawnSync } = await import('node:child_process');
const { chromium } = await import('playwright');

const PORT = 5197;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-bulk-entry');
const VW = 390;

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

// 貼る行。1行に2語・読み付き・読み無しの漢字（武道館）・21字・重複（ダンス）を含める。最後の行の「クマ」は画面でなぞって囲む
const LINES = [
  'ステージで【本気｜マジ】の【ダンス】を見せる',
  '【マスク】をつけて【独楽|コマ】を回す',
  '【コアラ】と【ラッコ】と【ネコ】',
  '【武道館】に立つ日',
  '【アイウエオカキクケコサシスセソタチツテトナ】は長すぎる',
  'もう一度【ダンス】',
  '森で クマ に会った',
];
const TEXT = LINES.join('\n');

const browser = await chromium.launch();
const pageErrors = [];
try {
  await startServer();
  const ctx = await browser.newContext({ viewport: { width: VW, height: 844 }, deviceScaleFactor: 1 });
  // 作る画面の札と案内は出さない（_lib.mjs の印に加えて、ここでも立てる）
  await ctx.addInitScript(() => {
    try {
      for (const k of ['crossword_seen_tip_cross', 'crossword_seen_tip_move', 'crossword_seen_tip_saved', 'crossword_seen_create_guide']) localStorage.setItem(k, '1');
    } catch { /* 無視 */ }
  });
  // 棚は空で答える。受付係と外のサイトへは出さない
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const u = new URL(route.request().url());
    const body = u.pathname.endsWith('/rpc/crossword_is_hidden') ? false : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com)\//, (r) => r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(`${BASE}/crossword/create`);
  const area = page.locator('[data-bulk-text]');
  await area.waitFor({ timeout: 30000 });
  await page.getByText('その他', { exact: true }).first().click();
  await area.fill(TEXT);
  await page.waitForTimeout(300);

  // 候補の数と弾かれた理由3種
  const okCount = () => page.locator('[data-bulk-candidate="ok"]').count();
  const reasons = await page.locator('[data-bulk-reason]').allTextContents();
  const ok1 = await okCount();
  check(ok1 === 7, `(b) 通った候補は7語（マジ・ダンス・マスク・コマ・コアラ・ラッコ・ネコ）: ${ok1}語`);
  check(reasons.includes('読みが未入力'), `(b) 読み無しの漢字（武道館）は「読みが未入力」: ${reasons.join(' / ')}`);
  check(reasons.includes('20字まで'), '(b) 21字は「20字まで」');
  check(reasons.includes('同じ答えがあります'), '(b) 2回目の「ダンス」は「同じ答えがあります」');
  check(reasons.length === 3, `(b) 弾かれたのは3つだけ: ${reasons.length}`);
  // 薄く（半透明）は使わず、字色を secondary にして残す（Webデザイナー観点の直し。コントラスト 4.5:1 以上）
  const ngColors = await page.locator('[data-bulk-candidate="ng"]').evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  check(ngColors.length === 3 && ngColors.every((c) => c === 'rgb(88, 95, 108)'), `(b) 弾かれた候補は灰色の字で残る（半透明でない）: ${ngColors.join(' / ')}`);
  check((await page.locator('[data-bulk-candidates]').getByText('（本気）').count()) === 1, '(b) 読み付きの候補に「（本気）」が添えてある');
  await page.screenshot({ path: path.join(OUT, 'b1-candidates-390.png'), fullPage: true });

  // なぞる前の帯のボタンは「ここを出す」で押せない
  const markBtn0 = page.locator('[data-bulk-markbar] button');
  check((await markBtn0.textContent()) === 'ここを出す' && (await markBtn0.isDisabled()), '(b) なぞる前の帯のボタンは「ここを出す」で押せない');

  // 印を入れるボタン: 欄の末尾にカーソル→「｜」でその位置に入る→「【 】」で【】が入りカーソルは間
  await area.evaluate((el) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  await page.locator('[data-bulk-insert="bar"]').click();
  await page.waitForTimeout(100);
  const afterBar = await area.inputValue();
  check(afterBar.endsWith('｜'), '(b) 「｜」ボタンでカーソルの位置に ｜ が入る');
  await page.locator('[data-bulk-insert="brackets"]').click();
  await page.waitForTimeout(100);
  const afterBr = await area.evaluate((el) => ({ v: el.value, s: el.selectionStart, e: el.selectionEnd, focused: document.activeElement === el }));
  check(afterBr.v.endsWith('｜【】') && afterBr.s === afterBr.v.length - 1 && afterBr.s === afterBr.e && afterBr.focused, `(b) 「【 】」ボタンで【】が入りカーソルは間・欄は選ばれたまま（位置 ${afterBr.s} / ${afterBr.v.length}）`);
  // 欄で文字を選んで「【 】」→その文字を囲む
  await area.evaluate((el) => { const i = el.value.indexOf('会った'); el.focus(); el.setSelectionRange(i, i + 3); });
  await page.locator('[data-bulk-insert="brackets"]').click();
  await page.waitForTimeout(100);
  check((await area.inputValue()).includes('【会った】'), '(b) 欄で選んだ文字を「【 】」ボタンで囲める');
  // 元の文字列に戻してから続ける
  await area.fill(TEXT);
  await page.waitForTimeout(200);
  await area.evaluate((el) => el.blur());

  // 並べた行で「クマ」をなぞって「ここを出す」
  const selected = await page.evaluate(() => {
    const seg = [...document.querySelectorAll('[data-bulk-lines] [data-seg-start]')].find((e) => e.textContent.includes('クマ'));
    if (!seg) return false;
    const node = seg.firstChild;
    const i = node.textContent.indexOf('クマ');
    const r = document.createRange();
    r.setStart(node, i);
    r.setEnd(node, i + 2);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    return sel.toString();
  });
  check(selected === 'クマ', `(b) 並べた行で「クマ」をなぞれた（${selected}）`);
  // 画面の下の帯のボタンは、なぞった文字入りの「「クマ」を出す」になり、なぞる前は「ここを出す」で押せない
  const markBtn = page.locator('[data-bulk-markbar] button');
  await page.waitForTimeout(100);
  check((await markBtn.textContent()) === '「クマ」を出す' && (await markBtn.isEnabled()), `(b) 帯のボタンが「「クマ」を出す」になり押せる（${await markBtn.textContent()}）`);
  const barPos = await markBtn.evaluate((el) => ({ sticky: getComputedStyle(el.parentElement).position, bottom: Math.round(el.parentElement.getBoundingClientRect().bottom), vh: window.innerHeight }));
  check(barPos.sticky === 'sticky' && barPos.bottom <= barPos.vh, `(b) 帯は画面の下に貼り付く（${barPos.sticky} / 下端 ${barPos.bottom} ≤ ${barPos.vh}）`);
  await markBtn.click();
  await page.waitForTimeout(300);
  const ok2 = await okCount();
  const text2 = await area.inputValue();
  check(ok2 === ok1 + 1 && text2.includes('森で 【クマ】 に会った'), `(b) 「ここを出す」で文字列が【クマ】で囲まれ、候補が1つ増える（${ok1}→${ok2}）`);
  check(text2.includes('【独楽｜コマ】'), '(b) 半角の | は全角の ｜ にそろう');

  // 組み合わせを探す
  const searchBtn = page.locator('[data-bulk-search]');
  check(/^組み合わせを探す（8語）$/.test((await searchBtn.textContent()) ?? ''), `(b) ボタンは「${await searchBtn.textContent()}」`);
  await searchBtn.click();
  // 全部入る盤が数msでそろうと進み具合の行は出ないまま提案が出る。どちらかが出れば探す処理は動いている
  const sawProgress = await page.locator('[data-bulk-progress], [data-bulk-proposal]').first().waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
  check(sawProgress, '(b) 探している間の「探しています… 試行 N 回」か、提案が出る');
  await page.locator('[data-bulk-proposal]').first().waitFor({ timeout: 20000 });
  const cards = page.locator('[data-bulk-proposal]');
  const nCards = await cards.count();
  check(nCards === 3, `(b) 提案が3つ: ${nCards}`);
  const stats = await page.locator('[data-bulk-stats]').allTextContents();
  check(stats.length === nCards && stats.every((s) => /^\d+語・\d+マス・交差\d+$/.test(s)), `(b) それぞれに「語・マス・交差」の数字: ${stats.join(' / ')}`);
  const ids = await page.evaluate(() => [...document.querySelectorAll('[data-bulk-proposal] [id]')].length);
  check(ids === 0, `(b) 提案の小さな盤にはマスの id が無い（右の盤と重ならない）: ${ids}`);
  await page.waitForTimeout(400); // FitGrid が幅を測って縮める 0.2 秒の動きが終わってから測る
  const wide = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    over: [...document.querySelectorAll('[data-bulk] *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5).slice(0, 3).map((e) => `${e.tagName}${e.className ? '.' + String(e.className).split(' ')[0] : ''}`),
  }));
  check(wide.sw <= VW && wide.over.length === 0, `(b) 390px で横にはみ出さない（提案が出た状態。ページ幅 ${wide.sw}px${wide.over.length ? `・はみ出し ${wide.over.join(', ')}` : ''}）`);
  await page.screenshot({ path: path.join(OUT, 'b2-proposals-390.png'), fullPage: true });

  // 2番目を選んで「この盤で進む」
  const second = cards.nth(1);
  const want = { w: Number(await second.getAttribute('data-width')), h: Number(await second.getAttribute('data-height')) };
  const wantWords = Number(((await second.locator('[data-bulk-stats]').textContent()) ?? '').match(/^(\d+)語/)?.[1]);
  await second.getByRole('button').click();
  check((await second.getByRole('button').getAttribute('aria-pressed')) === 'true', '(b) 2番目を選べた');
  await page.locator('[data-bulk-adopt]').click();
  // 組み立ての演出が終わるのを待つ（保存の押せない理由の1行が出るまで）
  await page.locator('[data-missing-hints]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(300);
  const board = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#puzzle-preview-area [id^="cell-"]')].map((e) => e.id.split('-').slice(1).map(Number));
    return { w: Math.max(...cells.map((c) => c[0])) + 1, h: Math.max(...cells.map((c) => c[1])) + 1, n: cells.length };
  });
  check(board.w === want.w && board.h === want.h, `(b) 右の盤の大きさが選んだ提案と同じ（盤 ${board.w}x${board.h} ／ 提案 ${want.w}x${want.h}）`);
  check((await page.locator('[data-bulk-proposal]').count()) === 0, '(b) 進んだ後は提案が消える');

  // 一覧: 語が入り、カギ欄に○の下書き（○の数＝字数）・「未選択 → ヒントを選ぶ」
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('[data-pick-hint]')].map((b) => {
      const box = b.parentElement;
      return { answer: box.querySelector('.font-mono span').textContent.replace(/\s/g, ''), clue: box.children[1].textContent, pick: b.textContent, extra: box.querySelector('.font-mono').textContent };
    })
  );
  check(rows.length === wantWords, `(b) 一覧に選んだ盤の語が入った: ${rows.length}語（提案 ${wantWords}語）`);
  check(rows.every((r) => r.pick === '未選択 → ヒントを選ぶ'), '(b) どの行にも「未選択 → ヒントを選ぶ」');
  const maruOk = rows.every((r) => (r.clue.match(/○/g) ?? []).length === r.answer.length && !/[【】｜]/.test(r.clue));
  check(maruOk, `(b) カギ欄は○の下書き（○の数＝字数・印は残らない）: ${rows.map((r) => `${r.answer}=${r.clue}`).join(' / ')}`);
  const maji = rows.find((r) => r.answer === 'マジ');
  if (maji) {
    check(maji.clue === 'ステージで○○のダンスを見せる', `(b) 「マジ」のカギは「ステージで○○のダンスを見せる」: ${maji.clue}`);
    check(maji.extra.includes('（本気）'), '(b) 読み付きの語は一覧に「（本気）」を添える');
  }
  const kuma = rows.find((r) => r.answer === 'クマ');
  if (kuma) check(kuma.clue === '森で ○○ に会った', `(b) なぞって囲んだ「クマ」のカギ: ${kuma.clue}`);
  check(!!maji || !!kuma, '(b) 下書きの中身を確かめる語（マジ・クマ）のどちらかが盤に入った');

  // 保存ボタンが押せず、理由に語数
  const share = page.getByRole('button', { name: /共有する/ });
  const reason = (await page.locator('[data-missing-hints]').textContent()) ?? '';
  check((await share.isDisabled()) && reason === `ヒントが未選択の語が ${rows.length} 語あります`, `(b) 「共有する」は押せず、理由「${reason}」`);
  await page.screenshot({ path: path.join(OUT, 'b3-adopted-390.png'), fullPage: true });

  // 「未選択 → ヒントを選ぶ」で入力欄に戻る（既存の鉛筆と同じ道）
  await page.locator('[data-pick-hint]').first().click();
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => ({ a: document.querySelector('#cw-answer')?.value, q: document.querySelector('#cw-clue')?.value }));
  check(back.a === rows[0].answer && back.q === rows[0].clue && (await page.getByRole('button', { name: '更新する', exact: true }).count()) === 1, `(b) 「未選択 → ヒントを選ぶ」で入力欄に戻り「更新する」になる（${back.a} ／ ${back.q}）`);
  await page.getByRole('button', { name: 'やめる', exact: true }).click();

  // 読み込み直すと textarea と候補が戻る（下書き）
  const before = { text: await area.inputValue(), cands: await page.locator('[data-bulk-candidate]').count() };
  await page.waitForTimeout(500);
  await page.reload();
  await area.waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  const after = { text: await area.inputValue(), cands: await page.locator('[data-bulk-candidate]').count() };
  check(after.text === before.text && after.cands === before.cands && after.cands > 0, `(b) 読み込み直しても文字列と候補が戻る（候補 ${before.cands}→${after.cands}）`);
  const inList = await page.locator('[data-bulk-reason]').allTextContents();
  // 2回目の「ダンス」も一覧に入った答えなので「一覧に入っています」になる（ダンスが盤に入った時だけ1つ多い）
  const dupInList = rows.some((r) => r.answer === 'ダンス') ? 1 : 0;
  const nInList = inList.filter((r) => r === '一覧に入っています').length;
  check(nInList === rows.length + dupInList, `(b) 一覧に入った語の候補は「一覧に入っています」: ${nInList}（一覧 ${rows.length}語＋2回目のダンス ${dupInList}）`);
  await page.screenshot({ path: path.join(OUT, 'b4-reloaded-390.png'), fullPage: true });
  await ctx.close();
} catch (e) {
  check(false, `(b) 台本が途中で止まった: ${e.message}`);
} finally {
  await browser.close();
  stopServer();
}
check(pageErrors.length === 0, `(b) 画面のつまずき（JS の例外）が無い${pageErrors.length ? `: ${pageErrors.slice(0, 3).join(' / ')}` : ''}`);
console.log(`写真: ${OUT}`);
process.exit(fail ? 1 : 0);
