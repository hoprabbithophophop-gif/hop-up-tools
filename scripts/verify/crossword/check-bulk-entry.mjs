// 「まとめて入れる」を確かめる。
// (a) 探す仕組み（src/lib/crossword/bulkSelect.ts）を、本物のファイルのまま node で動かす。
//     ts は check-build.mjs と同じく stripTypeScriptTypes で型だけ外し、一時置き場に .mjs として書いて読み込む（論理は写さない）。
// (b) 作る画面（/crossword/create）の1の段「まとめて入れる」を、手元に立てた開発サーバー（口 5197）と Playwright で動かす。棚と受付係への通信は受け止める。
//     書く｜ヒントを付ける・【 】｜→○ ボタン（○は 3 カギから移した。Hop 決定 2026-10-22）・欄で選ぶと帯「「語」を出す」・【語】の中にカーソルで「「語」の囲みを外す」・弾く理由・読みの帯（決める・外す）
//     ・下線の語でヒントの窓・行をなぞって帯・触った行だけ 16px（他は 10px）・凡例と ●○・交差できる字の黒い札（2026-10-21 に4段の流れに合わせて書き直した）。
//     2〜4の段・作りかけ・なぞる動きは check-create-flow.mjs が見る
// 使い方: node scripts/verify/crossword/check-bulk-entry.mjs（引数なし）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { performance } from 'node:perf_hooks';
import { ROOT, outDir, watchStumbles } from './_lib.mjs';

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


// 書く行。1行に2語・読み付き・半角の |・読み無しの漢字（武道館・本棚）・21字・重複（ダンス）・使えない字（ヰ）を含める。最後の行の「クマ」は画面でなぞって囲む
const LINES = [
  'ステージで【本気｜マジ】の【ダンス】を見せる',
  '【マスク】をつけて【独楽|コマ】を回す',
  '【コアラ】と【ラッコ】と【ネコ】',
  '【武道館】に立つ日',
  '【本棚】を買う',
  '【アイウエオカキクケコサシスセソタチツテトナ】は長すぎる',
  'もう一度【ダンス】',
  '【ヰド】の話',
  '森で クマ に会った',
];
const TEXT = LINES.join('\n');
const GUIDE = '出す語を【 】で囲む。読みは｜の後に（例: 【本気｜マジ】）。カタカナだけの語は読み不要。答えが問題文に無い時は、後ろに「→」で区切って書く（例: ニャーと鳴く動物→【ネコ】）。';

const browser = await chromium.launch();
const pageErrors = [];
try {
  await startServer();
  const ctx = await browser.newContext({ viewport: { width: VW, height: 844 }, deviceScaleFactor: 1 });
  // 作る画面の札となぞる動きは出さない（_lib.mjs の印に加えて、ここでも立てる。なぞる動きは check-create-flow が見る）
  await ctx.addInitScript(() => {
    try {
      for (const k of ['crossword_seen_tip_cross', 'crossword_seen_tip_move', 'crossword_seen_tip_saved', 'crossword_seen_trace']) localStorage.setItem(k, '1');
    } catch { /* 無視 */ }
  });
  // 棚は空で答える。受付係と外のサイトへは出さない
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const u = new URL(route.request().url());
    const body = u.pathname.endsWith('/rpc/crossword_is_hidden') ? false : [];
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: JSON.stringify(body) });
  });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com)\//, (r) => r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  await watchStumbles(page, pageErrors);

  await page.goto(`${BASE}/crossword/create`);
  const area = page.locator('[data-bulk-text]');
  await area.waitFor({ timeout: 30000 });
  check((await page.locator('[data-bulk-mode]').count()) === 0, '(b) 何も書いていない間は「書く｜ヒントを付ける」の切り替えは出ない');
  check((await page.locator('#cw-bulk-guide').textContent()) === GUIDE, '(b) 欄の上の説明は本番の文＋「→」の書き方の文');
  await area.fill(TEXT);
  await area.evaluate((el) => el.blur());
  await page.waitForTimeout(450);
  const modeBtns = await page.locator('[data-bulk-mode-button]').evaluateAll((els) => els.map((e) => `${e.textContent}:${e.getAttribute('aria-pressed')}`));
  check(modeBtns.join(',') === '書く:true,ヒントを付ける:false', `(b) 書くと切り替え「書く｜ヒントを付ける」が出て、今は「書く」（${modeBtns.join(',')}）`);
  check((await page.locator('[data-bulk-lines]').count()) === 0, '(b) 「書く」の側では書いた行の一覧は出ない（同じ文が2か所に並ばない）');
  const searchBtn = page.locator('[data-bulk-search]');
  check((await searchBtn.textContent()) === '組み合わせを探す（7語）' && (await searchBtn.isEnabled()), `(b) 通った答えは7語（マジ・ダンス・マスク・コマ・コアラ・ラッコ・ネコ）で「${await searchBtn.textContent()}」`);
  check((await page.locator('[data-bulk-markbar]').count()) === 0, '(b) 何も選んでいない間は画面の下の帯は出ない');

  // 印を入れるボタン: 欄の末尾にカーソル→「｜」でその位置に入る→「【 】」で【】が入りカーソルは間→「→」で → が入る
  const btnLabels = await page.locator('[data-bulk-insert]').evaluateAll((els) => els.map((e) => e.textContent));
  check(btnLabels.join(' ') === '【 】 ｜ → ○', `(b) 欄の真上に「【 】」「｜」「→」「○」のボタン（${btnLabels.join(' ')}）`);
  // ○は ｜・→ と同じ見た目・同じ大きさ（Hop 決定 2026-10-22）
  const btnBoxes = await page.locator('[data-bulk-insert]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { kind: e.dataset.bulkInsert, w: r.width, h: r.height, top: r.top, bg: cs.backgroundColor, fw: cs.fontWeight, fs: cs.fontSize }; }));
  const bar = btnBoxes.find((b) => b.kind === 'bar');
  const maruBox = btnBoxes.find((b) => b.kind === 'maru');
  check(!!bar && !!maruBox && maruBox.h === bar.h && maruBox.top === bar.top && maruBox.bg === bar.bg && maruBox.fw === bar.fw && maruBox.fs === bar.fs && Math.abs(maruBox.w - bar.w) <= 2, `(b) ○ボタンは ｜ボタンと同じ見た目・大きさ・同じ段（○ ${maruBox?.w}×${maruBox?.h} ／ ｜ ${bar?.w}×${bar?.h}）`);
  await area.evaluate((el) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  await page.locator('[data-bulk-insert="bar"]').click();
  await page.waitForTimeout(100);
  check((await area.inputValue()).endsWith('｜'), '(b) 「｜」ボタンでカーソルの位置に ｜ が入る');
  await page.locator('[data-bulk-insert="brackets"]').click();
  await page.waitForTimeout(100);
  const afterBr = await area.evaluate((el) => ({ v: el.value, s: el.selectionStart, e: el.selectionEnd, focused: document.activeElement === el }));
  check(afterBr.v.endsWith('｜【】') && afterBr.s === afterBr.v.length - 1 && afterBr.s === afterBr.e && afterBr.focused, `(b) 「【 】」ボタンで【】が入りカーソルは間・欄は選ばれたまま（位置 ${afterBr.s} / ${afterBr.v.length}）`);
  await page.locator('[data-bulk-insert="arrow"]').click();
  await page.waitForTimeout(100);
  check((await area.inputValue()).endsWith('｜【→】'), '(b) 「→」ボタンでカーソルの位置に → が入る');
  await page.locator('[data-bulk-insert="maru"]').click();
  await page.waitForTimeout(100);
  const afterMaru = await area.evaluate((el) => ({ v: el.value, s: el.selectionStart, focused: document.activeElement === el }));
  check(afterMaru.v.endsWith('｜【→○】') && afterMaru.s === afterMaru.v.length - 1 && afterMaru.focused, `(b) 「○」ボタンでカーソルの位置に ○ が入り、カーソルは ○ の後ろ（${afterMaru.v.slice(-6)}・位置 ${afterMaru.s}）`);
  // 欄を選んでいない時: 欄が覚えている最後のカーソルの所に入れ、欄を選んだ状態にする（｜・→ と同じ）
  await area.evaluate((el) => el.blur());
  await page.waitForTimeout(450);
  await page.locator('[data-bulk-insert="maru"]').click();
  await page.waitForTimeout(100);
  const afterMaru2 = await area.evaluate((el) => ({ v: el.value, s: el.selectionStart, focused: document.activeElement === el }));
  check(afterMaru2.v.endsWith('｜【→○○】') && afterMaru2.s === afterMaru2.v.length - 1 && afterMaru2.focused, `(b) 欄を選ばずに「○」を押すと、最後のカーソルの所に ○ が入り欄が選ばれる（${afterMaru2.v.slice(-6)}）`);
  // 欄で文字を選んで「【 】」→その文字を囲む
  await area.fill(TEXT);
  await area.evaluate((el) => { const i = el.value.indexOf('会った'); el.focus(); el.setSelectionRange(i, i + 3); });
  await page.locator('[data-bulk-insert="brackets"]').click();
  await page.waitForTimeout(100);
  check((await area.inputValue()).includes('【会った】'), '(b) 欄で選んだ文字を「【 】」ボタンで囲める');
  // 欄で文字を選ぶと、画面の下の帯「「語」を出す」が出て、押すとその文字を囲む（Hop 決定 2026-10-20 案C）
  await area.fill(TEXT);
  await area.evaluate((el) => { const i = el.value.indexOf('立つ日'); el.focus(); el.setSelectionRange(i, i + 3); });
  await page.waitForTimeout(200);
  const selBar = page.locator('[data-bulk-markbar] button');
  check((await selBar.textContent().catch(() => null)) === '「立つ日」を出す', `(b) 欄で文字を選ぶと下の帯が「「立つ日」を出す」（${await selBar.textContent().catch(() => '帯なし')}）`);
  await selBar.click();
  await page.waitForTimeout(200);
  check((await area.inputValue()).includes('【武道館】に【立つ日】'), '(b) 帯を押すと選んだ文字が囲まれる');
  // 欄で【語】の中にカーソルを置く（何も選ばない）と、帯が「「語」の囲みを外す」になり、押すと囲みが外れる（Hop 決定 2026-10-20）
  await area.fill(TEXT);
  await area.evaluate((el) => { const i = el.value.indexOf('【マスク】') + 2; el.focus(); el.setSelectionRange(i, i); });
  await page.waitForTimeout(200);
  const unBar = page.locator('[data-bulk-unmarkbar]');
  check((await unBar.textContent().catch(() => null)) === '「マスク」の囲みを外す', `(b) 【マスク】の中にカーソルを置くと帯が「「マスク」の囲みを外す」（${await unBar.textContent().catch(() => '帯なし')}）`);
  await unBar.click();
  await page.waitForTimeout(200);
  check((await area.inputValue()).includes('\nマスクをつけて【独楽'), '(b) 帯を押すと【マスク】の囲みが外れる');
  // 元の文字列に戻してから続ける（欄を離れると半角の | は全角にそろう）
  await area.fill(TEXT);
  await area.evaluate((el) => el.blur());
  await page.waitForTimeout(450);
  check((await area.inputValue()).includes('【独楽｜コマ】'), '(b) 欄を離れると半角の | は全角の ｜ にそろう');

  // 「ヒントを付ける」側: 書いた行の一覧と凡例だけ
  await page.locator('[data-bulk-mode-button="hint"]').click();
  await page.locator('[data-bulk-lines]').waitFor();
  check((await page.locator('[data-bulk-text]').count()) === 0 && (await page.getByText('書いた行（下線が答え。押すとヒントを付けられます）').count()) === 1, '(b) 「ヒントを付ける」では欄が消え、「書いた行（下線が答え。…）」の一覧が出る');
  check((await page.locator('[data-bulk-legend]').textContent()) === '黒い字＝ほかの答えと交差できる字　● ヒント済み　○ まだ', '(b) 一覧の下に凡例');
  const answers = await page.locator('[data-bulk-answer]').evaluateAll((els) => els.map((e) => e.getAttribute('data-bulk-answer')));
  // 印の名前は答えのマスの字の並び（小さい字は大きい字にそろえた物。BulkEntry の key）なので、ラッコは「ラツコ」
  check(answers.join(',') === 'マジ,ダンス,マスク,コマ,コアラ,ラツコ,ネコ', `(b) 行の下に答えごとの印（${answers.join(',')}）`);
  const reasons = await page.locator('[data-bulk-reason]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-bulk-reason')}=${e.textContent}`));
  check(reasons.includes('noReading=武道館：読みが未入力') && reasons.includes('noReading=本棚：読みが未入力'), `(b) 読み無しの漢字は「読みが未入力」（${reasons.join(' / ')}）`);
  check(reasons.some((r) => r.startsWith('tooLong=') && r.endsWith('20字まで')), '(b) 21字は「20字まで」');
  check(reasons.includes('duplicate=ダンス：同じ答えがあります'), '(b) 2回目の「ダンス」は「同じ答えがあります」');
  check(reasons.includes('unusable=ヰド：使えない字（ヰ・ヱ）'), '(b) ヰ の入った答えは「使えない字（ヰ・ヱ）」');
  check(reasons.length === 5, `(b) 弾かれたのは5つだけ: ${reasons.length}`);
  const majiCross = await page.locator('[data-bulk-answer="マジ"] span[title]').allTextContents();
  check(majiCross.includes('マ'), `(b) ほかの答えと交差できる字に黒い札（マジ: ${majiCross.join('')}）`);
  const dots = await page.locator('[data-bulk-hint]').evaluateAll((els) => els.map((e) => `${e.textContent}${e.getAttribute('aria-label')}`));
  check(dots.length === 7 && dots.every((d) => d === '○まだ'), `(b) ヒントの印は全部「○ まだ」（${dots.length}個）`);
  const styles = await page.evaluate(() => [...document.querySelectorAll('[data-bulk-mark]')].map((e) => ({ w: e.dataset.bulkMark, deco: getComputedStyle(e).textDecorationLine, style: getComputedStyle(e).textDecorationStyle, bg: getComputedStyle(e).backgroundColor })));
  check(styles.every((s) => s.deco.includes('underline') && s.bg === 'rgba(0, 0, 0, 0)'), '(b) 囲んだ語は箱でなく下線');
  const dashed = styles.filter((s) => s.style === 'dashed').map((s) => s.w);
  check(dashed.join(',') === '武道館,本棚', `(b) 読みが要るのに無い語だけ点線（${dashed.join(',')}）`);
  // 何も触っていなければ全部 16px
  const sizes0 = await page.locator('[data-bulk-line] > div:first-child').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  check(sizes0.every((v) => v === 16), `(b) 何も触っていない間は全部の行が 16px（${[...new Set(sizes0)].join(',')}）`);
  const ruby = await page.locator('[data-bulk-mark="本気"] rt').textContent().catch(() => null);
  check(ruby === 'マジ', `(b) 読みは語の上にルビで出る（本気: ${ruby}）`);
  await page.screenshot({ path: path.join(OUT, 'b1-lines-390.png'), fullPage: true });

  // 読みが要るのに無い語を押すと、下の帯が「語・読みの欄・決める・外す・×」になる
  await page.locator('[data-bulk-mark="武道館"]').click();
  await page.waitForTimeout(200);
  const rbar = page.locator('[data-bulk-readingbar]');
  const rb = await rbar.evaluate((el) => {
    const inp = el.querySelector('input');
    const bar = el.parentElement.getBoundingClientRect();
    return {
      word: el.querySelector('label')?.textContent, ph: inp.placeholder, inputPx: parseFloat(getComputedStyle(inp).fontSize), focused: document.activeElement === inp,
      btns: [...el.querySelectorAll('button')].map((b) => b.textContent), pos: getComputedStyle(el.parentElement).position, bottom: Math.round(bar.bottom), vh: window.innerHeight,
    };
  }).catch(() => null);
  check(rb && rb.word === '武道館' && rb.ph === '読み' && rb.btns.join(',') === '決める,外す,×', `(b) 「武道館」を押すと帯に 語・読みの欄・決める・外す・×（${rb && `${rb.word} / ${rb.ph} / ${rb.btns.join(',')}`}）`);
  check(rb && rb.inputPx === 16 && rb.focused, `(b) 帯の読みの欄は 16px で、押した直後に入れる状態（${rb && rb.inputPx}px / 入力中=${rb && rb.focused}）`);
  check(rb && rb.pos === 'fixed' && rb.bottom <= rb.vh, `(b) 帯は画面の下に貼り付く（${rb && `${rb.pos} / 下端 ${rb.bottom} ≤ ${rb.vh}`}）`);
  check((await page.locator('[data-hint-sheet]').count()) === 0, '(b) 読みの要る語を押してもヒントの窓は出ない');
  await rbar.locator('input').fill('ブドウカン');
  await rbar.locator('[data-bulk-decide]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-bulk-mode-button="write"]').click();
  check((await area.inputValue()).includes('【武道館｜ブドウカン】'), '(b) 「決める」で読みが文字列【武道館｜ブドウカン】に入る');
  await page.locator('[data-bulk-mode-button="hint"]').click();
  await page.locator('[data-bulk-mark="武道館"]').waitFor();
  const deco = await page.locator('[data-bulk-mark="武道館"]').evaluate((e) => getComputedStyle(e).textDecorationStyle);
  check(deco === 'solid', `(b) 読みが入ると点線が実線になる（${deco}）`);
  check((await page.locator('[data-bulk-answer="ブドウカン"]').count()) === 1, '(b) 読みの入った武道館が答え（ブドウカン）になる');
  // 「外す」で囲みが外れる
  await page.locator('[data-bulk-mark="本棚"]').click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '本棚 の囲みを外す' }).click();
  await page.waitForTimeout(200);
  check((await page.locator('[data-bulk-mark="本棚"]').count()) === 0 && (await page.locator('[data-bulk-readingbar]').count()) === 0, '(b) 帯の「外す」で【本棚】の囲みが外れ、帯が消える');
  // 下線の語（答え）を押すとヒントの窓。窓の一番下の「「語」の囲みを外す」で囲みが外れる
  await page.locator('[data-bulk-mark="ネコ"]').click();
  const sheet = page.locator('[data-hint-sheet]');
  await sheet.waitFor({ timeout: 5000 });
  check((await sheet.locator('h2').first().textContent()) === '「ネコ」のヒント', '(b) 答えの下線の語を押すと「「ネコ」のヒント」の窓が下から出る');
  check((await page.locator('[data-bulk-markbar]').count()) === 0, '(b) 窓が出ている間は画面の下の帯を出さない');
  await sheet.locator('[data-unmark-sheet]').click();
  await page.waitForTimeout(300);
  check((await sheet.count()) === 0 && (await page.locator('[data-bulk-mark="ネコ"]').count()) === 0, '(b) 窓の「「ネコ」の囲みを外す」で囲みが外れ、窓が閉じる');

  // 並べた行で「クマ」をなぞって「「クマ」を出す」
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
  await page.waitForTimeout(200);
  // なぞった行だけ 16px の黒字、他の行は 10px の薄い字・1行で「…」に切る（Hop 決定 2026-10-19・10-20）
  const sizes = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-bulk-line]')];
    const on = rows.filter((e) => e.hasAttribute('data-bulk-active'));
    const off = rows.filter((e) => !e.hasAttribute('data-bulk-active'));
    const txt = (e) => e.firstElementChild;
    const px = (e) => parseFloat(getComputedStyle(txt(e)).fontSize);
    return {
      on: on.map(px), off: off.map(px), onHasKuma: on.some((e) => e.textContent.includes('クマ')),
      offColor: off.map((e) => getComputedStyle(txt(e)).color), onColor: on.map((e) => getComputedStyle(txt(e)).color),
      offCut: off.every((e) => getComputedStyle(txt(e)).textOverflow === 'ellipsis' && getComputedStyle(txt(e)).whiteSpace === 'nowrap'),
      offRt: off.flatMap((e) => [...e.querySelectorAll('rt')]).length,
    };
  });
  check(sizes.on.length === 1 && sizes.onHasKuma && sizes.on[0] === 16, `(b) なぞった行だけが 16px（${sizes.on.join(',')} / クマ=${sizes.onHasKuma}）`);
  check(sizes.off.length >= 1 && sizes.off.every((v) => v === 10), `(b) 他の行は 10px（${[...new Set(sizes.off)].join(',')}）`);
  check(sizes.off.length >= 1 && sizes.offColor.every((c) => c !== sizes.onColor[0]), `(b) 他の行は薄い色（${sizes.offColor[0]} ≠ ${sizes.onColor[0]}）`);
  check(sizes.offCut && sizes.offRt === 0, `(b) 小さい行は1行で「…」に切り、ルビを出さない（ルビ ${sizes.offRt}）`);
  await page.screenshot({ path: path.join(OUT, 'b2-traced-390.png'), fullPage: true });
  const markBtn = page.locator('[data-bulk-markbar] button');
  check((await markBtn.textContent().catch(() => null)) === '「クマ」を出す', `(b) なぞっている間、下の帯は「「クマ」を出す」（${await markBtn.textContent().catch(() => '帯なし')}）`);
  await markBtn.click();
  await page.waitForTimeout(300);
  check((await page.locator('[data-bulk-mark="クマ"]').count()) === 1 && (await page.locator('[data-bulk-answer="クマ"]').count()) === 1, '(b) 帯を押すと「クマ」が囲まれて答えになる');
  // なぞるのをやめると帯は消える
  await page.evaluate(() => {
    const seg = [...document.querySelectorAll('[data-bulk-lines] [data-seg-start]')].find((e) => e.textContent.includes('会った'));
    const r = document.createRange();
    r.setStart(seg.firstChild, 0);
    r.setEnd(seg.firstChild, 2);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(r);
  });
  await page.waitForTimeout(200);
  const had = (await page.locator('[data-bulk-markbar]').count()) === 1;
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.waitForTimeout(600);
  check(had && (await page.locator('[data-bulk-markbar]').count()) === 0, '(b) 帯はなぞっている間だけ出る（なぞるのをやめると消える）');
  // 答えの数: マジ・ダンス・マスク・コマ・コアラ・ラッコ・ブドウカン・クマ（ネコは外した）
  check((await searchBtn.textContent()) === '組み合わせを探す（8語）', `(b) ボタンは「${await searchBtn.textContent()}」`);
  const wide = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    over: [...document.querySelectorAll('[data-bulk] *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5 && !e.closest('[data-bulk-line]:not([data-bulk-active])')).slice(0, 3).map((e) => e.tagName),
  }));
  check(wide.sw <= VW && wide.over.length === 0, `(b) 390px で横にはみ出さない（ページ幅 ${wide.sw}px${wide.over.length ? `・はみ出し ${wide.over.join(', ')}` : ''}）`);

  // 読み込み直すと、書いた文字列と「ヒントを付ける」側（前回の側）が戻る
  await page.locator('[data-bulk-mode-button="write"]').click();
  const before = await area.inputValue();
  await page.locator('[data-bulk-mode-button="hint"]').click();
  await page.waitForTimeout(500);
  await page.reload();
  await page.locator('[data-bulk-lines]').waitFor({ timeout: 30000 }).catch(() => {});
  check((await page.locator('[data-bulk-mode-button="hint"]').getAttribute('aria-pressed').catch(() => null)) === 'true', '(b) 読み込み直すと前回の側（ヒントを付ける）で開く');
  await page.locator('[data-bulk-mode-button="write"]').click();
  check((await area.inputValue()) === before, '(b) 読み込み直しても書いた文字列が戻る');
  await page.screenshot({ path: path.join(OUT, 'b3-reloaded-390.png'), fullPage: true });
  await ctx.close();
} catch (e) {
  check(false, `(b) 台本が途中で止まった: ${e.message}`);
} finally {
  await browser.close();
  stopServer();
}
check(pageErrors.length === 0, `(b) 画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）が無い${pageErrors.length ? `: ${pageErrors.slice(0, 3).join(' / ')}` : ''}`);
console.log(`写真: ${OUT}`);
process.exit(fail ? 1 : 0);
