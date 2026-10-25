// 作る画面（/crossword/create・案A「作る｜試す」。Hop 決定 2026-10-22）の書く欄「まとめて入れる」と語の一覧を確かめる。
// なぜ: 出題する語は作る人が【 】で囲んで決め、カギの下書きとヒントの付け先（語の一覧）はそこから毎回作られるので、書く道具・弾く理由・下書きの形が崩れると作れなくなるため。
// (a) 探す仕組み（src/lib/crossword/bulkSelect.ts）を、本物のファイルのまま node で動かす。
//     ts は check-build.mjs と同じく stripTypeScriptTypes で型だけ外し、一時置き場に .mjs として書いて読み込む（論理は写さない）。
// (b) 作る画面を、手元に立てた開発サーバー（口 5197）と Playwright で動かす。棚と受付係への通信はブラウザの中で受け止め、手元の画面のほかへは出さない。
//     見本の3行で始まる（Hop 決定 2026-10-25）・語の一覧に足りない言葉（カギがまだ・ヒントがまだ）が出て、付けると消える・語の行で語の窓が開く・
//     道具の段の【 】｜→（○ボタンは 2026-10-25 にやめた）・欄で選ぶと帯「「語」を出す」・【語】の中にカーソルで帯「「語」の囲みを外す」・
//     弾く理由の行が語の一覧に出る（読みが未入力・答えは30字まで・同じ答え・使えない字）・カギの下書き（→ の後ろを消す・答えは○・同じ行のほかの答えは□・○だけの行は空で例の文）・
//     読み込み直すと作りかけが戻り見本は入らない。
// (c) 2026-10-25 に足した確かめ（作る画面・(b) と同じ開発サーバー）: 窓でカギを直すと書く欄の行が「カギ→【答え】」に書き換わり、その後に書く欄を書き換えると書く欄の方が使われる・
//     「次の足りない答えへ」・「直前の答えと同じヒントにする」・→ の後ろに答えを2つ並べた行の知らせ・グループ名の読みで「載るグループ」に出る。
// (d) 見本の答えには最初からヒントが付き（2026-10-25）、「見本を入れる」で戻すと、まだヒントの無い見本の答えに付く（付いている自分のヒントはそのまま）。
//     盤・試す・共有・なぞる動きは check-create-flow.mjs が見る
// 開発サーバーは口ごとのまとめ置き場で書き換えの見張りを止めて立て（_lib.mjs の isolatedViteConfig）、確かめの前に画面を一度開く下ごしらえをする。
// どちらも確かめの途中でページが読み込み直されて書いた中身が消えるのを防ぐため（2026-10-22）
// 2026-10-22 に案A に合わせて書き直した。消した確かめと理由（どれも案A で画面から外した物。Hop 決定 2026-10-22）:
//   - 「書く｜ヒントを付ける」の切り替えと、読み込み直すと前回の側で開く: 切り替えが無くなった
//   - 書いた行の一覧（下線の語・読みのルビ・読みの無い語の点線・触った行だけ16px で他は10px・小さい行の「…」）: 一覧が無くなった。弾く理由は語の一覧の理由の行で見る
//   - 凡例と ●○: 足りない物だけを言葉で出す形に替わった。語の一覧の「カギがまだ」「ヒントがまだ」で見る
//   - 交差できる字の黒い札: 一覧と一緒に無くなった
//   - 読みの帯（決める・外す）: 無くなった。読みの無い語は理由の行「読みが未入力」で見る
//   - 下線の語を押すとヒントの窓・窓の「「語」の囲みを外す」: 窓は語の一覧の行から開く語の窓になり、窓の囲みを外すボタンは無くなった。語の窓が開くことと、そのボタンが無いことを見る
//   - 並べた行をなぞって帯・なぞるのをやめると帯が消える: なぞる所が無くなった。欄で選ぶ帯の確かめは残す
//   - 「組み合わせを探す（N語）」の語数: ボタンが無くなり盤は書くそばで育つ。通った語の数は語の一覧の行で見る
//   - 「欄の真上に」4つのボタン: 道具の段は欄のすぐ下にあるので、文を直した（確かめの中身は同じ）
// 使い方: node scripts/verify/crossword/check-bulk-entry.mjs（引数なし）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { performance } from 'node:perf_hooks';
import { ROOT, outDir, watchStumbles, isolatedViteConfig } from './_lib.mjs';
import { CREATE_MARKS, SAMPLE, SAMPLE_WORDS, SAMPLE_HINT_HREFS, writeLines, waitBoard, toMode, openWordSheet, closeWordSheet, setClue, setLinkHint, exampleUrl, wordKeys, openShare, closeShare, readDraft } from './_create.mjs';

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


// 書く行。1行に2語・読み付き・半角の |・読み無しの漢字（武道館・本棚）・31字（答えは30字まで。Hop 決定 2026-10-22）・重複（ダンス）・使えない字（ヰ）を含める
const LINES = [
  'ステージで【本気｜マジ】の【ダンス】を見せる',
  '【マスク】をつけて【独楽|コマ】を回す',
  '【コアラ】と【ラッコ】と【ネコ】',
  '【武道館】に立つ日',
  '【本棚】を買う',
  '【アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマ】は長すぎる',
  'もう一度【ダンス】',
  '【ヰド】の話',
  '森で クマ に会った',
];
const TEXT = LINES.join('\n');
// 通った答え。語の一覧の行の印は答えのマスの字の並び（小さい字は大きい字にそろえた物）なので、ラッコは「ラツコ」
const TEXT_WORDS = ['マジ', 'ダンス', 'マスク', 'コマ', 'コアラ', 'ラツコ', 'ネコ'];
const GUIDE = '1行に答えを1つ、【 】で囲んで書きます。';
// 見本の3行のカギの下書き（見本は 2026-10-25 に3行に替わった）
const SAMPLE_DRAFTS = {
  キララ: '米村○○○はOCHA NORMA兼DECA☆BEATのリーダー',
  アニマルランド: '「生きるってマジMy Life」の歌詞が印象的な研修生曲',
  ドイフウカ: 'つばきファクトリーの大阪出身でトマトが好きなメンバーは？',
};
// カギの下書きを見る行: →の書き方・読み付き・同じ行のほかの答えは□・○だけになる行（【タヌキ】だけ）は空
const DRAFT_TEXT = ['○○○はユーカリを食べる→【コアラ】', 'ニャーと鳴く動物→【ネコ】', '【本気｜マジ】で応援している', '【ラッコ】と【イヌ】が泳ぐ', '【タヌキ】'].join('\n');
const DRAFTS = { コアラ: '○○○はユーカリを食べる', ネコ: 'ニャーと鳴く動物', マジ: '○○で応援している', ラツコ: '○○○と□□が泳ぐ', イヌ: '□□□と○○が泳ぐ', タヌキ: '' };
const CLUE_PLACEHOLDER = '例：ニャーと鳴く動物';

const browser = await chromium.launch();
const pageErrors = [];
// 作る画面を開く入れ物（ブラウザの保存は入れ物ごとに別。下ごしらえと確かめで作りかけが混ざらないように分ける）
async function newCtx() {
  const ctx = await browser.newContext({ viewport: { width: VW, height: 844 }, deviceScaleFactor: 1 });
  // 作る画面の札は出さない（_lib.mjs の印と同じ物）
  await ctx.addInitScript((marks) => {
    try {
      for (const [k, v] of Object.entries(marks)) localStorage.setItem(k, v);
    } catch { /* 無視 */ }
  }, CREATE_MARKS);
  // 手元の画面のほかへは一切出さない（広告・字の形・解析など、下で個別に受け止めない外の宛先は中身の無い返事で止める）。
  // 後に登録した route が先に当たるので、いちばん先に置いて最後の受け皿にする
  await ctx.route((u) => u.hostname !== 'localhost', (r) => r.fulfill({ status: 204, body: '' }));
  // 棚は空で答える。受付係へは出さない
  await ctx.route(`${MOCK_SUPA}/**`, (route) => {
    const u = new URL(route.request().url());
    const body = u.pathname.endsWith('/rpc/crossword_is_hidden') ? false : [];
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: JSON.stringify(body) });
  });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  return ctx;
}
// 語の窓のカギの欄を読む（読むだけで打たない。1字でも打つとその語のカギは下書きから離れるため）
const readClue = async (page, key) => {
  await openWordSheet(page, key);
  const el = page.locator(`[data-word-sheet="${key}"] #cw-clue`);
  const r = { v: await el.inputValue(), ph: await el.getAttribute('placeholder') };
  await closeWordSheet(page);
  return r;
};
const missingOf = (page, key, kind) => page.locator(`[data-word-row="${key}"] [data-word-missing="${kind}"]`).count();

try {
  await startServer();
  // 下ごしらえ: 手元の開発サーバーは、画面が初めて読み込んだ部品をその場でまとめ直し、まとめ直すとページを読み込み直す。
  // 確かめの途中で読み込み直されると書いた中身が消えて落ちるので、作る画面・語の窓・試すを先に別の入れ物で開いて部品をまとめ終えてから確かめる（check-create-flow と同じ考え。2026-10-22）
  {
    const wctx = await newCtx();
    const w = await wctx.newPage();
    await w.goto(`${BASE}/crossword/create`);
    await waitBoard(w);
    await openWordSheet(w, 'キララ');
    await closeWordSheet(w);
    await toMode(w, 'try');
    await w.locator('[data-trial] [id^="cell-"]').first().click({ timeout: 30000 });
    await w.waitForTimeout(3000);
    await wctx.close();
  }

  const ctx = await newCtx();
  const page = await ctx.newPage();
  await watchStumbles(page, pageErrors);

  // ---- 見本の3行で始まる ----
  await page.goto(`${BASE}/crossword/create`);
  const area = page.locator('[data-bulk-text]');
  await area.waitFor({ timeout: 30000 });
  await page.locator('[data-word-row]').first().waitFor({ timeout: 30000 });
  check((await area.inputValue()) === SAMPLE, '(b) 作りかけが無いブラウザで開くと、書く欄に見本の3行が入っている');
  check(JSON.stringify(await wordKeys(page)) === JSON.stringify(SAMPLE_WORDS), `(b) 語の一覧は見本の答え3つ（${(await wordKeys(page)).join('・')}）`);
  check((await page.locator('#cw-bulk-guide').textContent()) === GUIDE, '(b) 欄の上のいつも見せる1文（2026-10-24）');
  // 見本の行のままの時は欄のすぐ上に「見本」の札。空にすると札が消えて「見本を入れる」が出て、押すと見本の行が戻る（Hop 決定 2026-10-23）
  check((await page.locator('[data-bulk-sample-tag]').textContent().catch(() => null)) === '見本' && (await page.locator('[data-bulk-insert-sample]').count()) === 0, '(b) 見本の行のままの時は欄のすぐ上に「見本」の札が出て、「見本を入れる」は出ない');
  await area.fill('');
  await page.waitForTimeout(100);
  check((await page.locator('[data-bulk-sample-tag]').count()) === 0 && (await page.locator('[data-bulk-insert-sample]').textContent().catch(() => null)) === '見本を入れる', '(b) 欄を空にすると札が消え、欄の下に「見本を入れる」が出る');
  await page.locator('[data-bulk-insert-sample]').click();
  await page.waitForTimeout(100);
  check((await area.inputValue()) === SAMPLE && (await page.locator('[data-bulk-sample-tag]').count()) === 1, '(b) 「見本を入れる」を押すと見本の行が入り、札が戻る');
  await page.waitForTimeout(300);
  check((await page.locator('[data-bulk-mode], [data-bulk-lines], [data-bulk-search], [data-bulk-legend], [data-bulk-readingbar]').count()) === 0,
    '(b) 案A で外した物（「書く｜ヒントを付ける」の切り替え・書いた行の一覧・凡例・読みの帯・「組み合わせを探す」）は出ない');
  check((await page.locator('[data-bulk-markbar]').count()) === 0, '(b) 何も選んでいない間は画面の下の帯は出ない');
  // 語の一覧には足りない言葉だけが出る: 見本はカギの下書きがあり、ヒントも最初から付いている（2026-10-25）ので、どちらも出ない
  const miss0 = [];
  for (const k of SAMPLE_WORDS) miss0.push(`${k}:${await missingOf(page, k, 'clue')}${await missingOf(page, k, 'hint')}`);
  check(miss0.every((m) => m.endsWith(':00')), `(b) 見本の語の行には「カギがまだ」も「ヒントがまだ」も出ない（語:カギ ヒント ＝ ${miss0.join(' ')}）`);
  // 見本の答えに最初から付いているヒント（YouTube 2つと公式サイトのリンク）。語の窓ではヒントの欄は出ず、付いたヒントの行き先が出る
  for (const k of SAMPLE_WORDS) {
    await openWordSheet(page, k);
    const href = await page.locator(`[data-word-sheet="${k}"] a[data-hint-state]`).getAttribute('href').catch(() => null);
    const kind = (await page.locator(`[data-word-sheet="${k}"] [data-hint-kind]`).textContent().catch(() => ''))?.trim();
    const noBox = (await page.locator(`[data-word-sheet="${k}"] #cw-hint`).count()) === 0;
    check(href === SAMPLE_HINT_HREFS[k] && noBox && kind === (k === 'ドイフウカ' ? 'リンク' : 'YouTube'), `(b) 見本の「${k}」には最初からヒントが付いていて、窓はヒントの欄でなく付いたヒント（${kind}・${href}）を出す`);
    await closeWordSheet(page);
  }
  // 見本のカギの下書き（→ の後ろを消す・答えの所を○にする）
  for (const [k, want] of Object.entries(SAMPLE_DRAFTS)) {
    const { v } = await readClue(page, k);
    check(v === want, `(b) 見本の「${k}」のカギの下書きは「${want}」（${v}）`);
  }
  await page.screenshot({ path: path.join(OUT, 'b1-sample-390.png'), fullPage: true });

  // ---- 語の行で語の窓が開く（ヒントの無い答えの窓を見るので、見本の後ろに1行足す） ----
  await writeLines(page, `${SAMPLE}\n【ネコ】が鳴く`);
  check((await page.locator('[data-word-row="ネコ"] [data-word-missing="hint"]').textContent()) === 'ヒントがまだありません', '(b) 足りない言葉の文は「ヒントがまだ」');
  await openWordSheet(page, 'ネコ');
  const sheet = page.locator('[data-word-sheet="ネコ"]');
  check((await sheet.getAttribute('role')) === 'dialog' && (await sheet.locator('h2').first().textContent()) === '「ネコ」のカギとヒント', `(b) 語の一覧の「ネコ」の行を押すと「「ネコ」のカギとヒント」の窓が出る（${await sheet.locator('h2').first().textContent()}）`);
  check((await sheet.locator('#cw-clue').count()) === 1 && (await sheet.locator('#cw-hint').count()) === 1 && (await sheet.locator('[data-hint-guide]').count()) === 1 && (await sheet.locator('[data-hint-label]').textContent()) === 'ヒント',
    '(b) 語の窓にカギの欄・ヒントの見出し・公式の発信の案内・ヒントの欄がある');
  check((await sheet.locator('[data-hint-state]').count()) === 0, '(b) ヒントがまだの語の窓には、ヒントの行き先のリンクは出ない');
  check((await sheet.locator('[data-unmark-sheet]').count()) === 0 && (await sheet.getByText(/の囲みを外す$/).count()) === 0, '(b) 語の窓に「囲みを外す」ボタンは無い');
  check((await page.locator('[data-bulk-markbar]').count()) === 0, '(b) 窓が出ている間は画面の下の帯を出さない');
  await sheet.screenshot({ path: path.join(OUT, 'b2-word-sheet-390.png') });
  await closeWordSheet(page);

  // ---- 道具の段: 【 】｜→（○ボタンと説明の○の行は 2026-10-25 にやめた） ----
  await area.fill(TEXT);
  await area.evaluate((el) => el.blur());
  await page.waitForTimeout(450);
  const btnLabels = await page.locator('[data-bulk-insert]').evaluateAll((els) => els.map((e) => e.textContent));
  check(btnLabels.join(' ') === '【 】 ｜ →', `(b) 欄のすぐ下の道具の段は「【 】」「｜」「→」の3つ（${btnLabels.join(' ')}）`);
  check((await page.locator('[data-bulk-insert="maru"]').count()) === 0 && (await page.getByRole('button', { name: '○を入れる' }).count()) === 0, '(b) ○ボタンは無い');
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
  check((await area.inputValue()).endsWith('｜【→】'), '(b) 【 】の中で「→」ボタンを押すと → だけが入る');
  // 欄を選んでいない時: 欄が覚えている最後のカーソルの所に入れ、欄を選んだ状態にする（前は○ボタンで見ていた。○ボタンをやめたので｜ボタンで見る）
  await area.evaluate((el) => el.blur());
  await page.waitForTimeout(450);
  await page.locator('[data-bulk-insert="bar"]').click();
  await page.waitForTimeout(100);
  const afterBar2 = await area.evaluate((el) => ({ v: el.value, s: el.selectionStart, focused: document.activeElement === el }));
  check(afterBar2.v.endsWith('｜【→｜】') && afterBar2.s === afterBar2.v.length - 1 && afterBar2.focused, `(b) 欄を選ばずに「｜」を押すと、最後のカーソルの所に ｜ が入り欄が選ばれる（${afterBar2.v.slice(-6)}）`);
  // 欄で文字を選んで「【 】」→その文字を囲む
  await area.fill(TEXT);
  await area.evaluate((el) => { const i = el.value.indexOf('会った'); el.focus(); el.setSelectionRange(i, i + 3); });
  await page.locator('[data-bulk-insert="brackets"]').click();
  await page.waitForTimeout(100);
  check((await area.inputValue()).includes('【会った】'), '(b) 欄で選んだ文字を「【 】」ボタンで囲める');

  // ---- 欄で選ぶと帯「「語」を出す」・【語】の中にカーソルで「「語」の囲みを外す」 ----
  // 欄で文字を選ぶと、画面の下の帯「「語」を出す」が出て、押すとその文字を囲む（Hop 決定 2026-10-20 案C）
  await area.fill(TEXT);
  await area.evaluate((el) => { const i = el.value.indexOf('立つ日'); el.focus(); el.setSelectionRange(i, i + 3); });
  await page.waitForTimeout(200);
  const selBar = page.locator('[data-bulk-markbar] button');
  check((await selBar.textContent().catch(() => null)) === '「立つ日」を答えにする', `(b) 欄で文字を選ぶと下の帯が「「立つ日」を出す」（${await selBar.textContent().catch(() => '帯なし')}）`);
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
  // 欄を離れると半角の | は全角にそろう
  await area.fill(TEXT);
  await area.evaluate((el) => el.blur());
  await page.waitForTimeout(450);
  check((await area.inputValue()).includes('【独楽｜コマ】'), '(b) 欄を離れると半角の | は全角の ｜ にそろう');
  check((await page.locator('[data-bulk-markbar]').count()) === 0, '(b) 欄を離れると画面の下の帯は消える');

  // ---- 弾く理由の行が、書く欄の道具の段のすぐ下に出る（2026-10-23 に語の一覧から移した。下の段に隠れないように） ----
  check(JSON.stringify(await wordKeys(page)) === JSON.stringify(TEXT_WORDS), `(b) 語の一覧は通った答え7語（${(await wordKeys(page)).join('・')}）`);
  const reasons = await page.locator('[data-bulk-reasons] [data-bulk-reason]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-bulk-reason')}=${e.textContent}`));
  check(reasons.includes('noReading=武道館：読みは｜の後ろに書いてください。') && reasons.includes('noReading=本棚：読みは｜の後ろに書いてください。'), `(b) 読み無しの漢字は語の一覧に「読みが未入力」の行（${reasons.join(' / ')}）`);
  check(reasons.includes('tooLong=アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマ：答えは30字までです。'), '(b) 31字の答えは弾かれ、語の一覧に「答えは30字までです。」の行');
  check(reasons.includes('duplicate=ダンス：同じ答えがあります'), '(b) 2回目の「ダンス」は「同じ答えがあります」の行');
  check(reasons.includes('unusable=ヰド：使えない字（ヰ・ヱ）'), '(b) ヰ の入った答えは「使えない字（ヰ・ヱ）」の行');
  check(reasons.filter((r) => !r.startsWith('twoInLine=')).length === 5, `(b) 弾かれたのは5つだけ（1行に答えが2つの知らせは別に数える）: ${reasons.length}`);
  const hintMiss = await page.locator('[data-word-missing="hint"]').count();
  const clueMiss = await page.locator('[data-word-missing="clue"]').count();
  check(hintMiss === 7 && clueMiss === 0, `(b) 7語とも「ヒントがまだ」・カギは下書きがあるので「カギがまだ」は無い（ヒント ${hintMiss}・カギ ${clueMiss}）`);
  await page.screenshot({ path: path.join(OUT, 'b3-reasons-390.png'), fullPage: true });
  // 答えのマス目は30字まで（Hop 決定 2026-10-22）: 30字ちょうどは答えになる
  await area.fill('【アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ】\n【アイ】');
  await page.waitForTimeout(100);
  const k30 = await wordKeys(page);
  const r30 = await page.locator('[data-bulk-reason]').count();
  check(k30.length === 2 && r30 === 0, `(b) 30字ちょうどの答えは通る（語の一覧 ${k30.length}語・弾いた行 ${r30}）`);
  // 答えにならず黙って外れていた行にも理由が出る（Hop 決定 2026-10-23）。「→」も【 】も無い行はメモとして黙って通す
  await area.fill(['ニャーと鳴く動物→', '【】が空', '【 】も空', '【コアラ', 'ラッパ】', 'メモの行', '【ネコ】と【コアラ】'].join(String.fromCharCode(10)));
  await page.waitForTimeout(150);
  const lineReasons = await page.locator('[data-bulk-reasons] [data-bulk-reason]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-bulk-reason')}=${e.textContent}`));
  const wantLines = ['needBrackets=ニャーと鳴く動物→：→ の後ろに答えを書いてください。', 'emptyMark=【】が空：【 】の中が空です', 'emptyMark=【 】も空：【 】の中が空です', 'unpaired=【コアラ：【 と 】の組が合いません', 'unpaired=ラッパ】：【 と 】の組が合いません', 'twoInLine=【ネコ】と【コアラ】：1行に答えは1つにしてください。'];
  check(JSON.stringify(lineReasons) === JSON.stringify(wantLines), `(b) 「→」に【 】が無い行・中が空・閉じ忘れ・】だけの行に、書いた順に理由の行が出て、メモの行には出ない（${lineReasons.join(' / ')}）`);
  check(JSON.stringify(await wordKeys(page)) === JSON.stringify(['ネコ', 'コアラ']), `(b) 理由の行が出ても、通った答えはそのまま（${(await wordKeys(page)).join('・')}）`);
  // → の後ろは【 】なしでも答えになる（Hop 決定 2026-10-24）。読みは｜の後ろ。理由の行は出ない
  await area.fill(['ニャーと鳴く動物→ネコ', '気持ちが入っている様子→本気｜マジ'].join(String.fromCharCode(10)));
  await page.waitForTimeout(150);
  check(JSON.stringify(await wordKeys(page)) === JSON.stringify(['ネコ', 'マジ']) && (await page.locator('[data-bulk-reasons] [data-bulk-reason]').count()) === 0,
    `(b) 「カギ→答え」は【 】なしで答えになり、読みも付けられる（${(await wordKeys(page)).join('・')}）`);
  // 「→」ボタン: 行の終わりで押すと「→【】」が入りカーソルは【】の中。後ろに字がある所で押すと、その字を【 】で囲む（Hop 決定 2026-10-24）
  await area.fill('ニャーと鳴く動物');
  await area.evaluate((el) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  await page.locator('[data-bulk-insert="arrow"]').click();
  await page.waitForTimeout(100);
  const ar1 = await area.evaluate((el) => ({ v: el.value, s: el.selectionStart }));
  check(ar1.v === 'ニャーと鳴く動物→【】' && ar1.s === ar1.v.length - 1, `(b) 行の終わりで「→」ボタンを押すと「→【】」が入りカーソルは【】の中（${ar1.v}・${ar1.s}）`);
  await area.fill('子猫の鳴き声ネコ');
  await area.evaluate((el) => { el.focus(); el.setSelectionRange(6, 6); });
  await page.locator('[data-bulk-insert="arrow"]').click();
  await page.waitForTimeout(100);
  check((await area.inputValue()) === '子猫の鳴き声→【ネコ】', `(b) 後ろに字がある所で「→」ボタンを押すと、その字を【 】で囲む（${await area.inputValue()}）`);
  // → より前の答えのカギに、→ と後ろの答えが漏れない（2026-10-25。前は「○○が鳴く→□□」になっていた）
  await area.fill('【ネコ】が鳴く→イヌ');
  await page.waitForTimeout(300);
  await openWordSheet(page, 'ネコ');
  const leak = await page.locator('[data-word-sheet] #cw-clue').inputValue();
  check(leak === '○○が鳴く', `(b) → より前の答えのカギに → と後ろの答えが入らない（${leak}）`);
  // カギの欄を離れても、下のヒントの見出しの位置が動かない（2026-10-25。動くと、カギを打った直後に押した「ヒントを外す」が押せていなかった）
  await page.locator('[data-word-sheet] #cw-clue').focus();
  await page.waitForTimeout(150);
  const yFocused = (await page.locator('[data-word-sheet] [data-hint-label]').boundingBox())?.y;
  await page.locator('[data-word-sheet] h2').first().click();
  await page.waitForTimeout(150);
  const yBlurred = (await page.locator('[data-word-sheet] [data-hint-label]').boundingBox())?.y;
  check(yFocused !== undefined && yFocused === yBlurred, `(b) カギの欄を離れてもヒントの見出しの位置が動かない（${yFocused} → ${yBlurred}）`);
  // 「【ネコ】が鳴く→イヌ」は1行に答えが2つなので知らせが出る（2026-10-25）
  check((await page.locator('[data-bulk-reasons] [data-bulk-reason="twoInLine"]').count()) === 1, '(b) 「【ネコ】が鳴く→イヌ」にも「1行に答えは1つにしてください。」の知らせが出る');
  await page.locator('[data-word-close]').click();
  await page.waitForTimeout(300);

  // ---- カギの下書き ----
  await writeLines(page, DRAFT_TEXT);
  for (const [k, want] of Object.entries(DRAFTS)) {
    const { v, ph } = await readClue(page, k);
    if (want === '') check(v === '' && ph === CLUE_PLACEHOLDER, `(b) ○だけになる行（【${k}】だけ）はカギが空で、欄に例の文「${CLUE_PLACEHOLDER}」が見える（「${v}」／${ph}）`);
    else check(v === want, `(b) 「${k}」のカギの下書きは「${want}」（${v}）`);
  }
  const clueMissRows = await page.locator('[data-word-row]:has([data-word-missing="clue"])').evaluateAll((els) => els.map((e) => e.getAttribute('data-word-row')));
  check(clueMissRows.join(',') === 'タヌキ', `(b) 「カギがまだ」はカギが空の語（タヌキ）の行だけに出る（${clueMissRows.join(',') || '無し'}）`);
  check((await page.locator('[data-word-row="タヌキ"] [data-word-missing="clue"]').textContent()) === 'カギがまだありません', '(b) 足りない言葉の文は「カギがまだ」');
  // 語の窓でカギとヒントを付けると、足りない言葉が消える（0.2 秒かけて消えるので消え終わるのを待つ）
  await openWordSheet(page, 'タヌキ');
  await setClue(page, '森にすむ動物');
  await setLinkHint(page, exampleUrl('タヌキ'));
  check((await page.locator('[data-word-sheet="タヌキ"] [data-hint-state]').count()) === 1, '(b) ヒントを付けると語の窓にヒントの行き先のリンクが出る');
  await closeWordSheet(page);
  const goneClue = await page.locator('[data-word-row="タヌキ"] [data-word-missing="clue"]').waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false);
  const goneHint = await page.locator('[data-word-row="タヌキ"] [data-word-missing="hint"]').waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false);
  check(goneClue && goneHint, `(b) 語の窓でカギとヒントを付けると、タヌキの行の「カギがまだ」「ヒントがまだ」が消える（カギ=${goneClue}・ヒント=${goneHint}）`);
  check((await missingOf(page, 'コアラ', 'hint')) === 1, '(b) ほかの語の「ヒントがまだ」は残る');

  const wide = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    over: [...document.querySelectorAll('[data-bulk] *, [data-word-list] *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5).slice(0, 3).map((e) => e.tagName),
  }));
  check(wide.sw <= VW && wide.over.length === 0, `(b) 390px で横にはみ出さない（ページ幅 ${wide.sw}px${wide.over.length ? `・はみ出し ${wide.over.join(', ')}` : ''}）`);

  // ---- 読み込み直すと、書いた文字列（作りかけ）が戻り、見本は入らない ----
  const before = await area.inputValue();
  await page.waitForTimeout(500);
  await page.reload();
  await area.waitFor({ timeout: 30000 });
  await page.locator('[data-word-row]').first().waitFor({ timeout: 30000 });
  const after = await area.inputValue();
  check(after === before && after !== SAMPLE, '(b) 読み込み直すと書いた文字列が戻り、見本の3行は入らない');
  check((await page.locator('[data-word-row="タヌキ"]').count()) === 1 && (await missingOf(page, 'タヌキ', 'clue')) === 0 && (await missingOf(page, 'タヌキ', 'hint')) === 0, '(b) 読み込み直しても、付けたカギとヒントが戻る（タヌキの行に足りない言葉が出ない）');
  await page.screenshot({ path: path.join(OUT, 'b4-reloaded-390.png'), fullPage: true });

  // ---- 窓でカギを直すと、書く欄の行に書き戻る（Hop 決定 2026-10-25） ----
  const NEW_LINES = ['【ウサギ】がはねる', '【サクラ】が咲く', '【ラクダ】が歩く'];
  await writeLines(page, NEW_LINES.join('\n'));
  await waitBoard(page);
  await openWordSheet(page, 'ウサギ');
  await setClue(page, '耳の長い動物');
  await page.waitForTimeout(150);
  const wb1 = (await area.inputValue()).split('\n');
  check(wb1[0] === '耳の長い動物→【ウサギ】' && wb1[1] === NEW_LINES[1], `(c) 窓でカギを直すと、書く欄のその答えの行が「直したカギ→【答え】」になり、ほかの行はそのまま（${wb1.join(' ／ ')}）`);
  await closeWordSheet(page);
  // その後に書く欄の行を別のカギに書き換えると、窓を開き直した時のカギも書く欄の方になる
  await writeLines(page, ['白くて跳ねる動物→【ウサギ】', ...NEW_LINES.slice(1)].join('\n'));
  await openWordSheet(page, 'ウサギ');
  const wb2 = await page.locator('[data-word-sheet="ウサギ"] #cw-clue').inputValue();
  check(wb2 === '白くて跳ねる動物', `(c) 窓で直した後に書く欄の行を書き換えると、窓を開き直した時のカギは書く欄の方になる（${wb2}）`);
  await closeWordSheet(page);
  // 読みの付いた答え: 窓で直すと「カギ→【答え｜読み】」になる
  await writeLines(page, ['【本気｜マジ】で応援する', ...NEW_LINES.slice(1)].join('\n'));
  await openWordSheet(page, 'マジ');
  await setClue(page, '本当の気持ち');
  await page.waitForTimeout(150);
  const wb3 = (await area.inputValue()).split('\n')[0];
  check(wb3 === '本当の気持ち→【本気｜マジ】', `(c) 読みの付いた答えは「カギ→【答え｜読み】」の形に書き戻る（${wb3}）`);
  await closeWordSheet(page);
  // マジの行の盤が組み上がるのを待ってから戻す（組んでいる途中に元の3語へ戻すと盤が組み上がらないままになる不具合があった。2026-10-25 に画面の側で直った。待ちは残しても害が無いので残す）
  await waitBoard(page);

  // ---- 「次の足りない答えへ」（Hop 決定 2026-10-25） ----
  await writeLines(page, NEW_LINES.join('\n'));
  const stats3 = await waitBoard(page);
  // 作りかけの控えは少し遅れて書かれるので、3語の盤になるまで待つ
  let placed3 = [];
  for (let i = 0; i < 40; i++) {
    placed3 = (await readDraft(page))?.board?.map((x) => x.id) ?? [];
    if (['ウサギ', 'サクラ', 'ラクダ'].every((k) => placed3.includes(k))) break;
    await page.waitForTimeout(250);
  }
  const unplaced3 = await page.locator('[data-word-unplaced]').count();
  check(['ウサギ', 'サクラ', 'ラクダ'].every((k) => placed3.includes(k)) && unplaced3 === 0, `(c) 下ごしらえ: 3語とも盤に入った（${placed3.join('・')}・置けなかった語 ${unplaced3}・${stats3}）`);
  await openWordSheet(page, 'ウサギ');
  const nextBtn = page.locator('[data-word-sheet] [data-next-missing]');
  const nextKey = await nextBtn.getAttribute('data-next-missing').catch(() => null);
  const nextText = await nextBtn.textContent().catch(() => null);
  check(!!nextKey && nextKey !== 'ウサギ' && ['サクラ', 'ラクダ'].includes(nextKey) && nextText === '次の足りない答えへ（あと2つ）', `(c) 足りない答えがほかにある時は「次の足りない答えへ（あと2つ）」が出る（${nextKey}・${nextText}）`);
  await nextBtn.click();
  const nextOpened = await page.locator(`[data-word-sheet="${nextKey}"]`).waitFor({ timeout: 5000 }).then(() => true, () => false);
  // 前の答えの窓が消え終わるのを待つ（消える動きの間は窓が2つある）
  await page.waitForFunction(() => document.querySelectorAll('[data-word-sheet]').length === 1, null, { timeout: 5000 }).catch(() => {});
  const sheetsNow = await page.locator('[data-word-sheet]').evaluateAll((els) => els.map((e) => e.getAttribute('data-word-sheet')));
  check(nextOpened && sheetsNow.join() === nextKey, `(c) 押すと次の足りない答え（${nextKey}）の窓が開く（開いている窓 ${sheetsNow.join('・')}）`);

  // ---- 「直前の答えと同じヒントにする」（Hop 決定 2026-10-25） ----
  const SHARED = exampleUrl('同じ動画');
  check((await page.locator('[data-word-sheet] [data-same-hint]').count()) === 0, '(c) まだどの答えにもヒントを付けていない間は「直前の答えと同じヒントにする」は出ない');
  await setLinkHint(page, SHARED);
  await page.waitForTimeout(150);
  check((await page.locator('[data-word-sheet] [data-same-hint]').count()) === 0, '(c) ヒントを付けたその答えの窓には「直前の答えと同じヒントにする」は出ない');
  await closeWordSheet(page);
  const third = ['サクラ', 'ラクダ'].find((k) => k !== nextKey);
  await openWordSheet(page, 'ウサギ');
  const same = page.locator('[data-word-sheet="ウサギ"] [data-same-hint]');
  const sameText = await same.textContent().catch(() => null);
  check(!!sameText && sameText.startsWith('直前の答えと同じヒントにする（'), `(c) 別の答えの窓に「直前の答えと同じヒントにする（…）」が出る（${sameText}）`);
  await same.click();
  await page.waitForTimeout(200);
  const usagiHint = (await readDraft(page))?.hints?.['ウサギ'];
  check(usagiHint?.url === SHARED && (await page.locator('[data-word-sheet="ウサギ"] [data-hint-state]').count()) === 1, `(c) 押すとその答えに同じヒントが付く（${JSON.stringify(usagiHint)}）`);
  check((await page.locator('[data-word-sheet="ウサギ"] [data-same-hint]').count()) === 0, '(c) 同じヒントを付けた後は、そのボタンは消える');
  // 足りない答えが自分だけの時は「次の足りない答えへ」が出ない
  await closeWordSheet(page);
  await openWordSheet(page, third);
  check((await page.locator(`[data-word-sheet="${third}"] [data-next-missing]`).count()) === 0, `(c) 足りない答えが自分（${third}）だけの時は「次の足りない答えへ」が出ない`);
  await closeWordSheet(page);

  // ---- → の後ろに答えを2つ並べた行の知らせ（2026-10-25） ----
  await writeLines(page, 'ペット→【ウサギ】【タヌキ】');
  const two = await page.locator('[data-bulk-reasons] [data-bulk-reason="twoInLine"]').evaluateAll((els) => els.map((e) => e.textContent));
  check(two.length === 1 && two[0].endsWith('1行に答えは1つにしてください。'), `(c) 「ペット→【ウサギ】【タヌキ】」で「1行に答えは1つにしてください。」の知らせが出る（${two.join(' / ') || '無し'}）`);

  // ---- 載るグループは、グループ名の読みでも見る（functions/_shared/crosswordGroups.ts の GROUP_READINGS。2026-10-25） ----
  await writeLines(page, ['果物の飲み物が2つ→【Juice=Juice｜ジュースジュース】', '【スイス】は国の名前'].join('\n'));
  await waitBoard(page);
  const placedJ = (await readDraft(page))?.board?.map((i) => i.id) ?? [];
  await openShare(page);
  const groups = await page.locator('[data-share-groups]').getAttribute('data-share-groups');
  check(groups.split('・').includes('Juice=Juice'), `(c) 【Juice=Juice｜ジュースジュース】を答えにすると、公開の窓の「載るグループ」に Juice=Juice が出る（${groups || '無し'}・盤 ${placedJ.join('・')}）`);
  await page.locator('[data-share-sheet]').screenshot({ path: path.join(OUT, 'c1-share-groups-390.png') });
  await closeShare(page);

  // ---- 「見本を入れる」で見本に戻すと、まだヒントの無い見本の答えにヒントが付く（2026-10-25）。もう付いているヒントはそのまま ----
  // 書く欄が空で、キララにだけ自分のヒントが付いている作りかけを、別の入れ物で開く（作りかけは今の画面が書いた物を元にする）
  await area.fill('');
  await page.waitForTimeout(800);
  const emptyDraft = await readDraft(page);
  const OWN = exampleUrl('自分のヒント');
  const ctx2 = await newCtx();
  await ctx2.addInitScript((d) => { try { if (!sessionStorage.getItem('cw_seeded')) { localStorage.setItem('crossword_draft', JSON.stringify(d)); sessionStorage.setItem('cw_seeded', '1'); } } catch { /* 無視 */ } },
    { ...(emptyDraft ?? {}), version: 3, bulkText: '', hints: { キララ: { kind: 'link', url: OWN } }, hintLabels: {}, clues: {} });
  const p2 = await ctx2.newPage();
  await watchStumbles(p2, pageErrors);
  await p2.goto(`${BASE}/crossword/create`);
  await p2.locator('[data-bulk-insert-sample]').waitFor({ timeout: 30000 });
  // 作りかけが本当に入ったかは、下の「キララのヒントが自分の物のまま」で分かる（入っていなければ見本のヒントに替わる）
  check((await p2.locator('[data-bulk-text]').inputValue()) === '', '(d) 下ごしらえ: 書く欄が空の作りかけで開いた');
  await p2.locator('[data-bulk-insert-sample]').click();
  await p2.locator('[data-word-row]').first().waitFor({ timeout: 10000 });
  await p2.waitForTimeout(800);
  const miss2 = [];
  for (const k of SAMPLE_WORDS) miss2.push(`${k}:${await missingOf(p2, k, 'hint')}`);
  check(miss2.every((m) => m.endsWith(':0')), `(d) 「見本を入れる」で戻した見本の答えに「ヒントがまだ」が出ない（${miss2.join(' ')}）`);
  const hints2 = (await readDraft(p2))?.hints ?? {};
  check(hints2['キララ']?.url === OWN, `(d) もう自分のヒントが付いていた答え（キララ）は、見本のヒントに替わらない（${JSON.stringify(hints2['キララ'])}）`);
  check(hints2['アニマルランド']?.videoId === 'KWU4Lbsdo5Q' && hints2['ドイフウカ']?.url === SAMPLE_HINT_HREFS['ドイフウカ'], `(d) まだヒントの無かった答え（アニマルランド・ドイフウカ）に見本のヒントが付く（${JSON.stringify([hints2['アニマルランド'], hints2['ドイフウカ']])}）`);
  await ctx2.close();
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
