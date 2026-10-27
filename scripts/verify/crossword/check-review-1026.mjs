// 2回目のレビュー（2026-10-26）で CC が直すと決めた画面の側の直しを確かめる。
// 何を（番号は直しの指示書の番号）:
//   1  記号入りのカギ・1行に答え2つの行のカギ: 窓の欄の下に理由が出る・再読み込みの後も「書く欄の行を直したら書く欄が勝つ」・行を分けたら窓のカギを書き戻す
//      ・組み直しで → 入りのカギは窓の側に置き、書く欄にカギを書いて更新すると書く欄のカギが送られる
//   2  端末の置き場がいっぱいの時: 作りかけを残せない知らせが1回だけ出る・公開しましたの窓に合言葉を残せなかった知らせが出る
//   3  作りかけは crossword_draft_v3 にしまう。古い名前 crossword_draft は読み替えに使うだけで、消さない・上書きしない
//   4  棚が返事をしない時、解く画面に「読み込み中…」→10秒で「いま読み込めません。…」。保存は20秒で「保存中…」をやめ、押し直しても2つ目を送らない（遅れて返事が来ても1つだけ）
//   5  棚が止まった時の「自分が作った問題」は「いま読み込めません。」（非表示と区別）
//   6  合言葉の注意・引き継ぎ0件・作りかけは移らない・合言葉の無い端末の文・消す確認の文
//   7  「スーパー>マーケット」は書き換えない。「->」「－＞」は → にそろえる
//   8  【土居楓奏｜ドイフウカ】の囲みを外しても読みが残る・選び直して囲み直せる
//   9  「直前の答えと同じヒントにする」は、元の答えを消した後と次の問題の後に出ない・375 幅で右端が切れない
//   10 375×548 で答えの窓のカギ・ヒントの欄を選んでいる間は「次の足りない答えへ」の帯が隠れる・字 200% でも欄が押せる
//   11 解く画面のヒントのリンクの小さい行は、ブラウザが整えた形（xn-- ・%E2%80%AE）
// 2026-10-27 の直し（「作った人・解く人の時間を大事にする」直しのうち画面の側。番号は指示の番号に 27- を付けた）:
//   27-1 見本の2行目が「パンダ、フラミンゴ、ミーアキャットが登場する研修生曲のタイトルは？→【アニマルランド】」
//   27-3 作った人の名前に「公式」「運営」「hop-up-tools」「HOP-UP TOOLS」「スタッフ」を含む時・メンバーのフルネームとぴったり同じ時は、打っている時点で欄の下に知らせ、押せない理由に並べる。受付係の bad_name の知らせ
//   27-4 窓で書いた → 入りのカギを、書く欄の行を直した後も取っておき「前に窓で書いたカギに戻す」で戻せる（再読み込みの後も）
//   27-6 置けなかった答えがある時、公開の窓から「マス目をいじる」を開ける
// 手元だけで流す: この台本が手元の vite を口 5186 で立ち上げ（Supabase の住所は使わない仮の住所）、棚と受付係はブラウザの中の作り物で答える。
//   行き先（プレビュー・本番）・本物の棚には何も送らない。
// 使い方: node scripts/verify/crossword/check-review-1026.mjs [写真の置き場]（省略時は一時置き場）
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { outDir, ROOT, watchStumbles, isolatedViteConfig } from './_lib.mjs';
import { CREATE_MARKS, SAMPLE, waitBoard, openWordSheet, closeWordSheet, setLinkHint, setClue, fillWords, wordKeys, openShare, closeShare, readDraft, exampleUrl } from './_create.mjs';

const PORT = 5186;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-review-1026', process.argv[2]);

let fail = 0;
let okCount = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
  if (ok) okCount++;
  else fail++;
};

// ---- 開発サーバー ----
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

// ---- 作り物 ----
// 解く画面で開く問題（ネコ・コアラ）。ネコのヒントはキリル文字の а を使った住所と右から左の字（U+202E）
const EVIL_URL = 'https://exаmple.com/‮abc';
const SOLVE_ID = 'LocalRv1';
const solveRow = {
  id: SOLVE_ID, title: '見本の問題', genre: 'hello', tags: [], is_beginner: false, group_tags: [], play_count: 0, created_at: new Date().toISOString(),
  body: { version: 1, width: 2, height: 3, clues: [
    { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: 'ニャーと鳴く動物', length: 2, hint: { kind: 'link', url: EVIL_URL } },
    { clueIndex: 2, direction: 'vertical', startX: 1, startY: 0, clue: 'ユーカリの葉を食べる動物', length: 3, hint: { kind: 'link', url: 'https://example.com/koala' } },
  ] },
};
// 組み直しの見本（コアラのカギに → が入る）
const EDIT_ID = 'LocalRv2';
const EDIT_KEY = 'f'.repeat(64);
const editRow = {
  id: EDIT_ID, title: '組み直しの見本', genre: 'hello', tags: [], is_beginner: false, group_tags: [], play_count: 0,
  body: { version: 1, width: 2, height: 3, clues: [
    { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: 'ニャーと鳴く動物', length: 2, hint: { kind: 'link', url: 'https://example.com/neko' } },
    { clueIndex: 2, direction: 'vertical', startX: 1, startY: 0, clue: 'ユーカリ→葉を食べる', length: 3, hint: { kind: 'link', url: 'https://example.com/koala' } },
  ] },
};
const editAnswers = [['ネ', 'コ'], ['コ', 'ア', 'ラ']];

// opts.shelf: 'ok' | 'hang' | 'error'（crossword_puzzles を読む時の答え方）
async function mockAll(ctx, sent, opts = {}) {
  const shelf = opts.shelf ?? 'ok';
  // opts.saveReason: 保存の受付係が断る理由（2026-10-27。bad_name など）
  await ctx.route(`${MOCK_SUPA}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: JSON.stringify(body) });
    if (u.pathname.endsWith('/rpc/crossword_is_hidden')) return json(false);
    const table = u.pathname.split('/').pop();
    if (table === 'crossword_puzzles') {
      if (shelf === 'hang') return; // 返事をしない
      if (shelf === 'error') return json({ message: 'unavailable' }, 503);
      const idEq = u.searchParams.get('id');
      const rows = idEq === `eq.${SOLVE_ID}` ? [solveRow] : [];
      if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) return json(rows[0] ?? null);
      return json(rows);
    }
    return json([]);
  });
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await ctx.route('**/api/crossword-save', async (route) => {
    const n = sent.saves.length + 1;
    sent.saves.push(route.request().postDataJSON());
    if (opts.saveReason) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, reason: opts.saveReason }) });
    const plan = opts.saveDelay?.[n - 1] ?? { ms: 0, ok: true };
    if (plan.ms) await new Promise((r) => setTimeout(r, plan.ms));
    if (!plan.ok) return route.abort('failed').catch(() => {});
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: `LocalSv${String(n).padStart(2, '0')}` }) }).catch(() => {});
  });
  await ctx.route('**/api/crossword-owner-get', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, puzzle: editRow, answers: editAnswers }) }));
  await ctx.route('**/api/crossword-update', (r) => {
    sent.updates.push(r.request().postDataJSON());
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await ctx.route('**/api/crossword-play', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const reply = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...o }) });
    if (body.action === 'start') return reply({ token: 'tok-rv', startedAt: Date.now() });
    if (body.action === 'touch') return reply({ counted: true });
    return reply({ activeMs: 0, open: true, correct: false });
  });
  await ctx.route(/^https:\/\/(i\.ytimg\.com|www\.youtube\.com|www\.youtube-nocookie\.com|challenges\.cloudflare\.com|[a-z.]*cloudflareinsights\.com|pagead2\.googlesyndication\.com)\//, (r) => r.fulfill({ status: 204, body: '' }));
  await ctx.route('https://challenges.cloudflare.com/turnstile/**', (r) =>
    r.fulfill({ contentType: 'application/javascript', body: 'window.turnstile={render:function(el,o){setTimeout(function(){o.callback("check-review-1026")},50);return "w"},remove:function(){},reset:function(){}};' }),
  );
}

const browser = await chromium.launch();
const stumbles = [];
const S375 = { width: 375, height: 548 };
const S390 = { width: 390, height: 844 };
async function newPage({ size = S390, marks = CREATE_MARKS, init = null, shelf = 'ok', saveDelay = null, saveReason = null } = {}) {
  const sent = { saves: [], updates: [] };
  const ctx = await browser.newContext({ viewport: size });
  await ctx.addInitScript((m) => {
    try { if (!sessionStorage.getItem('rv_marked')) { for (const [k, v] of Object.entries(m)) localStorage.setItem(k, v); sessionStorage.setItem('rv_marked', '1'); } } catch { /* 無視 */ }
  }, marks);
  if (init) await ctx.addInitScript(init);
  await mockAll(ctx, sent, { shelf, saveDelay, saveReason });
  const page = await ctx.newPage();
  await watchStumbles(page, stumbles);
  return { ctx, page, sent };
}
const areaValue = (page) => page.locator('[data-bulk-text]').inputValue();
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
// 書く欄の中身を、人が打つ時と同じ入力の合図つきで丸ごと入れ替える
const fillArea = async (page, text) => {
  await page.locator('[data-bulk-text]').fill(text);
  await page.locator('[data-bulk-text]').evaluate((el) => el.blur());
  await page.waitForTimeout(500);
};
const clueValue = (page) => page.locator('[data-word-sheet] #cw-clue').inputValue();

try {
  await startServer();
  // 下ごしらえ（vite が部品をまとめ直して読み込み直すのを、確かめの前に済ませる）
  {
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 60000 });
    await waitBoard(page).catch(() => {});
    await page.goto(`${BASE}/crossword/mine`);
    await page.waitForTimeout(1500);
    await page.goto(`${BASE}/crossword/${SOLVE_ID}`);
    await page.waitForTimeout(3000);
    await ctx.close();
  }

  // ===== 7. 「->」をそろえる形 =====
  {
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await fillArea(page, 'スーパー>マーケット−>売り場→【ネコ】\nA->B→【コアラ】\nC－＞D→【ラクダ】');
    const v = await areaValue(page);
    check(v.startsWith('スーパー>マーケット−>売り場→【ネコ】'), `7 「スーパー>マーケット」「−>」は → にしない（${v.split('\n')[0]}）`);
    check(v.split('\n')[1] === 'A→B→【コアラ】' && v.split('\n')[2] === 'C→D→【ラクダ】', `7 「->」「－＞」は → にそろえる（${v.split('\n').slice(1).join(' / ')}）`);
    await ctx.close();
  }

  // ===== 8. 囲みを外しても読みが残る =====
  {
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await fillArea(page, 'メンバー【土居楓奏｜ドイフウカ】は大阪出身\n大阪出身→【土居楓奏｜ドイフウカ】');
    const area = page.locator('[data-bulk-text]');
    // 1行目の【 】の中にカーソルを置く
    await area.focus();
    await area.evaluate((el) => { const i = el.value.indexOf('土居'); el.setSelectionRange(i + 1, i + 1); });
    await page.locator('[data-bulk-unmarkbar]').waitFor({ timeout: 5000 });
    await page.locator('[data-bulk-unmarkbar]').click();
    await page.waitForTimeout(300);
    const v1 = await areaValue(page);
    check(v1.split('\n')[0] === 'メンバー土居楓奏｜ドイフウカは大阪出身', `8 囲みを外すと「土居楓奏｜ドイフウカ」の形で読みが残る（${v1.split('\n')[0]}）`);
    // 外した後は「土居楓奏｜ドイフウカ」が選ばれた状態で、帯「…を答えにする」で囲み直せる
    const bar = page.locator('[data-bulk-markbar] button');
    await bar.waitFor({ timeout: 5000 });
    await bar.click();
    await page.waitForTimeout(300);
    check((await areaValue(page)).split('\n')[0] === 'メンバー【土居楓奏｜ドイフウカ】は大阪出身', '8 外した直後の帯で、読みごと囲み直せる');
    // 2行目（→ の後ろ）の囲みを外すと「カギ→答え｜読み」の書き方になり、答えのまま残る
    await area.focus();
    await area.evaluate((el) => { const i = el.value.lastIndexOf('土居'); el.setSelectionRange(i + 1, i + 1); });
    await page.locator('[data-bulk-unmarkbar]').waitFor({ timeout: 5000 });
    await page.locator('[data-bulk-unmarkbar]').click();
    await area.evaluate((el) => el.blur());
    await page.waitForTimeout(700);
    const v2 = await areaValue(page);
    const reasons = await page.locator('[data-bulk-reason]').allTextContents();
    check(v2.split('\n')[1] === '大阪出身→土居楓奏｜ドイフウカ' && (await page.locator('[data-word-row="ドイフウカ"]').count()) === 1 && !reasons.some((r) => r.includes('読み')),
      `8 → の後ろの囲みを外しても答え「ドイフウカ」のまま・読みの理由は出ない（${v2.split('\n')[1]}／理由 ${reasons.join(' ')}）`);
    await ctx.close();
  }

  // ===== 1. 記号入りのカギ・1行に答え2つ =====
  {
    const { ctx, page } = await newPage({ size: S375 });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await fillArea(page, '鳴く→【ネコ】\n葉を食べる→【コアラ】');
    await openWordSheet(page, 'ネコ');
    await setClue(page, 'イヌ→ネコの順に鳴く');
    await page.waitForTimeout(300);
    const stuck = page.locator('[data-word-sheet] [data-clue-stuck]');
    check((await stuck.getAttribute('data-clue-stuck').catch(() => null)) === 'marks' && (await stuck.textContent()).includes('→・｜・【 】が入っているため'),
      `1 → 入りのカギは、窓の欄の下に理由が出る（${await stuck.textContent().catch(() => '出ない')}）`);
    await page.locator('[data-word-sheet] #cw-clue').evaluate((el) => el.blur());
    await page.waitForTimeout(500);
    await shot(page, '1-stuck-375');
    await closeWordSheet(page);
    check((await areaValue(page)).split('\n')[0] === '鳴く→【ネコ】', '1 書く欄の行はそのまま（書き戻せない）');
    // 再読み込みの後も窓のカギが効き、書く欄の行を直したら書く欄が勝つ
    await page.waitForTimeout(600);
    await page.reload();
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await openWordSheet(page, 'ネコ');
    check((await clueValue(page)) === 'イヌ→ネコの順に鳴く', `1 再読み込みの後も窓のカギが出る（${await clueValue(page)}）`);
    await closeWordSheet(page);
    await fillArea(page, 'ニャーと鳴く→【ネコ】\n葉を食べる→【コアラ】');
    await openWordSheet(page, 'ネコ');
    check((await clueValue(page)) === 'ニャーと鳴く' && (await page.locator('[data-word-sheet] [data-clue-stuck]').count()) === 0,
      `1 再読み込みの後でも、書く欄の行を直すと書く欄のカギが使われ、理由は消える（${await clueValue(page)}）`);
    await closeWordSheet(page);
    await page.waitForTimeout(600);
    await page.reload();
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await openWordSheet(page, 'ネコ');
    check((await clueValue(page)) === 'ニャーと鳴く', `1 もう一度開き直しても書く欄のカギのまま（窓の古いカギは戻らない）（${await clueValue(page)}）`);
    await closeWordSheet(page);

    // 1行に答え2つの行
    await fillArea(page, '【ネコ】と【イヌ】\n葉を食べる→【コアラ】');
    await openWordSheet(page, 'ネコ');
    await setClue(page, 'ニャーと鳴く動物');
    await page.waitForTimeout(300);
    check((await page.locator('[data-word-sheet] [data-clue-stuck]').getAttribute('data-clue-stuck').catch(() => null)) === 'twoInLine', '1 1行に答え2つの行は、窓の欄の下に「答えが2つ」の理由が出る');
    await closeWordSheet(page);
    await openWordSheet(page, 'イヌ');
    await setClue(page, 'ワンと鳴く動物');
    await closeWordSheet(page);
    // 「と」の後ろで改行して行を分ける（人が打つのと同じく Enter で）
    const area = page.locator('[data-bulk-text]');
    await area.focus();
    await area.evaluate((el) => { const i = el.value.indexOf('と【イヌ'); el.setSelectionRange(i + 1, i + 1); });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const lines = (await areaValue(page)).split('\n');
    check(lines[0] === 'ニャーと鳴く動物→【ネコ】' && lines[1] === 'ワンと鳴く動物→【イヌ】', `1 行を分けて答えが1つの行になると、窓のカギがその行に書き戻る（${lines.slice(0, 2).join(' / ')}）`);
    const caret = await area.evaluate((el) => [el.selectionStart, el.value.indexOf('\n') + 1]);
    check(caret[0] === caret[1], `1 書き戻した後、カーソルは分けた2行目の頭にある（${caret[0]}・頭 ${caret[1]}）`);
    await area.evaluate((el) => el.blur());
    await page.waitForTimeout(500);
    await openWordSheet(page, 'イヌ');
    check((await clueValue(page)) === 'ワンと鳴く動物', '1 分けた後の窓のカギも同じ');
    await closeWordSheet(page);
    // ほかの答えの 】 を消している途中では書き戻さない（書く欄の直しが勝つ）
    await fillArea(page, '【ネコ】と【イヌ】\n葉を食べる→【コアラ】');
    await openWordSheet(page, 'ネコ');
    await setClue(page, 'ニャーと鳴く動物');
    await closeWordSheet(page);
    await fillArea(page, '【ネコ】と【イヌ\n葉を食べる→【コアラ】');
    check((await areaValue(page)).split('\n')[0] === '【ネコ】と【イヌ', '1 ほかの答えの 】 を消しただけでは書き戻さない（書く欄の直しを上書きしない）');
    await ctx.close();
  }

  // ===== 1. 組み直しで → 入りのカギ =====
  {
    const init = (a) => { try { if (!sessionStorage.getItem('rv_mine')) { localStorage.setItem('crossword_my_puzzles', JSON.stringify([{ id: a.id, title: '組み直しの見本', key: a.key, createdAt: 1 }])); sessionStorage.setItem('rv_mine', '1'); } } catch { /* 無視 */ } };
    const { ctx, page, sent } = await newPage({ size: S390 });
    await ctx.addInitScript(init, { id: EDIT_ID, key: EDIT_KEY });
    await page.goto(`${BASE}/crossword/create?edit=${EDIT_ID}`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    const v = await areaValue(page);
    check(v === 'ニャーと鳴く動物→【ネコ】\n【コアラ】', `1 組み直し: → 入りのカギは書く欄に移さない（${v.replace('\n', ' / ')}）`);
    await openWordSheet(page, 'コアラ');
    check((await clueValue(page)) === 'ユーカリ→葉を食べる' && (await page.locator('[data-word-sheet] [data-clue-stuck="marks"]').count()) === 1, '1 組み直し: 窓には保存してあったカギと理由が出る');
    await closeWordSheet(page);
    await fillArea(page, 'ニャーと鳴く動物→【ネコ】\n葉っぱを食べる→【コアラ】');
    await openShare(page);
    await page.locator('[data-share-sheet] [data-save]').click();
    await page.locator('#cw-share-title').waitFor({ timeout: 20000 }).catch(() => {});
    const sentClue = sent.updates[0]?.puzzle?.body?.clues?.find((c) => c.answer.join('') === 'コアラ')?.clue;
    check(sent.updates.length === 1 && sentClue === '葉っぱを食べる', `1 組み直し: 書く欄にカギを書いて更新すると、書く欄のカギが送られる（${sentClue}）`);
    await ctx.close();
  }

  // ===== 3. 作りかけの新しい名前と古い名前 =====
  {
    const old = JSON.stringify({ version: 3, bulkText: '古いカギ→【ネコ】\n古いカギ2→【コアラ】', hints: {}, hintLabels: {}, clues: {}, board: null, proposals: null, picked: null, title: '', creatorName: '', tags: [], isBeginner: false, boardSig: null, searchedSig: null });
    const { ctx, page } = await newPage({ marks: { ...CREATE_MARKS, crossword_draft: old } });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    check((await areaValue(page)) === '古いカギ→【ネコ】\n古いカギ2→【コアラ】', '3 新しい名前が無い時は、古い名前の作りかけを読み替えて開く');
    await fillArea(page, '新しいカギ→【ネコ】\n古いカギ2→【コアラ】');
    await page.waitForTimeout(600);
    const st = await page.evaluate(() => ({ now: localStorage.getItem('crossword_draft_v3'), old: localStorage.getItem('crossword_draft') }));
    check(!!st.now && JSON.parse(st.now).bulkText.startsWith('新しいカギ') && st.old === old, '3 書き足した作りかけは新しい名前にしまい、古い名前は書き換えない');
    await fillArea(page, '');
    await page.waitForTimeout(600);
    const st2 = await page.evaluate(() => ({ now: localStorage.getItem('crossword_draft_v3'), old: localStorage.getItem('crossword_draft') }));
    check(st2.old === old && !!st2.now && JSON.parse(st2.now).cleared === true, '3 書く欄を空にしても古い名前は消さない（新しい名前に空の印を置く）');
    await page.reload();
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    check((await areaValue(page)) === SAMPLE, '3 空にした後に開き直すと、古い名前の作りかけは戻らず見本で始まる');
    await ctx.close();
  }

  // ===== 2・4・9. 公開まで（置き場がいっぱい・保存の返事が遅い・次の問題の後の同じヒント） =====
  // 置き場がいっぱいの端末の作り物: 作りかけと自分が作った問題の書き込みだけ断る
  const fullInit = () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (this === window.localStorage && (k === 'crossword_draft_v3' || k === 'crossword_my_puzzles')) throw new DOMException('full', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
    // 知らせが何回出たかを数える
    window.__rvToasts = [];
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('[role="status"] > div span:last-child')) {
        if (!el.__rvSeen) { el.__rvSeen = true; window.__rvToasts.push(el.textContent); }
      }
    }).observe(document, { childList: true, subtree: true });
  };
  const fillToPublish = async (page) => {
    // 見本の1行目を書き換えて、全部の答えにカギとヒントを付ける
    await fillArea(page, SAMPLE.replace('米村【キララ】は', '米村【キララ】はいま'));
    await waitBoard(page);
    await fillWords(page, await wordKeys(page));
    await openShare(page);
    await page.locator('#cw-title').fill('台本の問題');
  };
  {
    const { ctx, page, sent } = await newPage({ size: S390, init: fullInit });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await fillToPublish(page);
    await page.waitForTimeout(500);
    const told = await page.evaluate(() => window.__rvToasts.filter((t) => t === 'この端末に作りかけを残せませんでした。閉じると消えます。').length);
    check(told === 1, `2 作りかけを残せない時の知らせは1回だけ（${told}回）`);
    await page.locator('[data-share-sheet] [data-save]').click();
    await page.locator('#cw-share-title').waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    const note = await page.locator('[data-key-not-kept]').textContent().catch(() => null);
    check(sent.saves.length === 1 && !!note && note.startsWith('この問題の合言葉をこの端末に残せませんでした。'), `2 合言葉を残せなかった時は、公開しましたの窓の中で知らせる（${note}）`);
    await shot(page, '2-key-not-kept-390');
    // 9. 次の問題を作った後は「直前の答えと同じヒントにする」が出ない
    await page.locator('[data-next-puzzle]').click();
    await page.waitForTimeout(500);
    await fillArea(page, '鳴く→【ネコ】\n葉を食べる→【コアラ】');
    await openWordSheet(page, 'コアラ');
    check((await page.locator('[data-word-sheet] [data-same-hint]').count()) === 0, '9 次の問題を作った後は、前の問題のヒントで「直前の答えと同じヒントにする」が出ない');
    await closeWordSheet(page);
    await ctx.close();
  }
  {
    // 4. 保存の返事が25秒来ない → 20秒で「保存中…」をやめる → 押し直しても新しく送らない → 遅れて返事が来たら1つだけ公開
    const { ctx, page, sent } = await newPage({ size: S375, saveDelay: [{ ms: 27000, ok: true }] });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await fillToPublish(page);
    const save = page.locator('[data-share-sheet] [data-save]');
    await save.click();
    await page.waitForTimeout(3000);
    check((await save.textContent()) === '保存中…' && (await page.locator('[data-share-close]').isDisabled()), '4 返事を待つ間は「保存中…」');
    await page.waitForTimeout(18500);
    check((await save.textContent()) === '公開する' && (await save.isEnabled()) && (await page.locator('[data-share-close]').isEnabled()), '4 20秒で「保存中…」をやめ、押し直す・閉じるができる');
    check(await page.getByText('保存の返事が来ません。少し待ってから、もう一度押してください。').count() > 0, '4 20秒で「保存の返事が来ません。…」の知らせが出る');
    await shot(page, '4-save-slow-375');
    await save.click();
    await page.waitForTimeout(1000);
    check(sent.saves.length === 1 && (await page.locator('[data-save-check], iframe[src*="turnstile"]').count()) === 0, `4 押し直しても保存を新しく送らない（送った数 ${sent.saves.length}）`);
    await page.locator('#cw-share-title').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const mine = await page.evaluate(() => JSON.parse(localStorage.getItem('crossword_my_puzzles') || '[]').length);
    check(sent.saves.length === 1 && mine === 1, `4 遅れて返事が来たら「公開しました」が出て、問題は1つだけ（送った数 ${sent.saves.length}・自分の問題 ${mine}）`);
    await ctx.close();
  }
  {
    // 4. 遅れた保存が失敗した時だけ、押し直すと新しく送る（2回目で1つだけできる）
    const { ctx, page, sent } = await newPage({ size: S390, saveDelay: [{ ms: 22000, ok: false }, { ms: 0, ok: true }] });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await fillToPublish(page);
    const save = page.locator('[data-share-sheet] [data-save]');
    await save.click();
    await page.waitForTimeout(21000);
    await save.click(); // まだ返事が無いので、続きを待つだけ
    await page.waitForTimeout(3000);
    check(sent.saves.length === 1, `4 失敗の返事が来る前の押し直しは送らない（送った数 ${sent.saves.length}）`);
    await save.click(); // 失敗した後は、新しく送る（人間確認から）
    await page.locator('#cw-share-title').waitFor({ timeout: 20000 });
    const mine = await page.evaluate(() => JSON.parse(localStorage.getItem('crossword_my_puzzles') || '[]').length);
    check(sent.saves.length === 2 && mine === 1, `4 失敗した後の押し直しは新しく送り、問題は1つだけ（送った数 ${sent.saves.length}・自分の問題 ${mine}）`);
    await ctx.close();
  }

  // ===== 9. 元の答えを消した後・ボタンの幅 =====
  {
    const { ctx, page } = await newPage({ size: S375 });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await fillArea(page, '鳴く→【ネコ】\n葉を食べる→【コアラ】\nこぶ→【ラクダ】');
    await openWordSheet(page, 'ネコ');
    await setLinkHint(page, `https://example.com/${'very-long-path-'.repeat(8)}end`);
    await closeWordSheet(page);
    await openWordSheet(page, 'コアラ');
    const same = page.locator('[data-word-sheet] [data-same-hint]');
    const fits = await same.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= window.innerWidth).catch(() => false);
    check((await same.count()) === 1 && fits, '9 「直前の答えと同じヒントにする（長い住所）」が 375 幅で右端まで収まる（折り返す）');
    await same.scrollIntoViewIfNeeded().catch(() => {});
    await shot(page, '9-same-hint-375');
    await closeWordSheet(page);
    await fillArea(page, '葉を食べる→【コアラ】\nこぶ→【ラクダ】');
    await page.waitForTimeout(500);
    await openWordSheet(page, 'コアラ');
    check((await page.locator('[data-word-sheet] [data-same-hint]').count()) === 0, '9 元の答え（ネコ）を書く欄から消すと「直前の答えと同じヒントにする」は出ない');
    await closeWordSheet(page);
    await ctx.close();
  }

  // ===== 10. 375×548 で欄を選んでいる間は帯を隠す・字 200% =====
  for (const big of [false, true]) {
    const tag = big ? '200%' : '100%';
    const { ctx, page } = await newPage({ size: S375 });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    if (big) await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await fillArea(page, '鳴く→【ネコ】\n葉を食べる→【コアラ】\nこぶ→【ラクダ】');
    await openWordSheet(page, 'ネコ');
    await page.waitForTimeout(300);
    const bar = page.locator('[data-word-sheet] [data-next-missing]');
    check((await bar.count()) === 1, `10 ${tag} 欄を選ぶ前は「次の足りない答えへ」の帯が出ている`);
    // 欄が見える所まで窓の中を送り、真ん中を押すとその欄が選ばれるか（帯や見出しに隠れていないか）
    const pressable = async (sel) => {
      const el = page.locator(`[data-word-sheet] ${sel}`).first();
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const box = await el.boundingBox();
      if (!box) return false;
      const hit = await page.evaluate(([x, y, s]) => { const t = document.elementFromPoint(x, y); return !!t && !!t.closest(s); }, [box.x + box.width / 2, box.y + Math.min(box.height / 2, 20), `[data-word-sheet] ${sel}`]);
      if (!hit) return false;
      await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 20));
      await page.waitForTimeout(200);
      return page.evaluate((s) => !!document.activeElement?.closest(s), `[data-word-sheet] ${sel}`);
    };
    check(await pressable('#cw-clue'), `10 ${tag} 375×548 でカギの欄を押せる`);
    await page.waitForTimeout(100);
    check((await bar.count()) === 0, `10 ${tag} カギの欄を選んでいる間は帯が隠れる`);
    await shot(page, `10-clue-focus-375x548-${tag}`);
    const hintOk = await pressable('#cw-hint');
    check(hintOk, `10 ${tag} 375×548 でヒントの欄を押せる`);
    check((await bar.count()) === 0, `10 ${tag} ヒントの欄を選んでいる間も帯は隠れたまま`);
    // ヒントの欄が帯に隠れていない（帯が出ていないので重ならない）
    await shot(page, `10-hint-focus-375x548-${tag}`);
    await page.locator('[data-word-sheet] #cw-hint').evaluate((el) => el.blur());
    await page.waitForTimeout(600);
    check((await bar.count()) === 1, `10 ${tag} 欄を離れると少し後に帯が戻る`);
    await ctx.close();
  }

  // ===== 11・4. 解く画面 =====
  {
    const { ctx, page } = await newPage({ size: S390 });
    await page.goto(`${BASE}/crossword/${SOLVE_ID}`);
    await page.getByText('ニャーと鳴く動物').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /このまま始める|始める！|はじめる|閉じる/ }).first().click().catch(() => {});
    await page.getByText('ニャーと鳴く動物').first().click();
    await page.locator('[data-coach="keypad"]').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'ヒント', exact: false }).first().click();
    const small = await page.locator('[data-hint-url]').first().textContent({ timeout: 10000 }).catch(() => null);
    check(!!small && small.startsWith('https://xn--') && small.includes('%E2%80%AE') && !small.includes('‮') && !small.includes('а'),
      `11 ヒントのリンクの小さい行はブラウザが整えた形（${small}）`);
    await shot(page, '11-hint-url-390');
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage({ size: S375, shelf: 'hang' });
    await page.goto(`${BASE}/crossword/${SOLVE_ID}`, { waitUntil: 'domcontentloaded' });
    const loading = page.locator('[data-solve-loading]');
    await loading.waitFor({ timeout: 10000 });
    check((await loading.textContent()).includes('読み込み中…'), '4 棚が返事をしない間、解く画面に「読み込み中…」が出る（真っ白にしない）');
    await shot(page, '4-solve-loading-375');
    await page.waitForTimeout(10500);
    check((await page.locator('[data-solve-loading="slow"]').textContent().catch(() => '')).includes('いま読み込めません。少し待って開き直してください。'), '4 10秒待っても来ない時は「いま読み込めません。少し待って開き直してください。」');
    await shot(page, '4-solve-slow-375');
    await ctx.close();
  }

  // ===== 5・6. 自分が作った問題・ヒントを直す・組み直し =====
  {
    const mineList = JSON.stringify([{ id: 'LocalMn1', title: '棚が止まった時の問題', key: 'a'.repeat(64), createdAt: 2 }]);
    const { ctx, page } = await newPage({ size: S375, shelf: 'error', marks: { ...CREATE_MARKS, crossword_my_puzzles: mineList } });
    await page.goto(`${BASE}/crossword/mine`);
    await page.getByText('棚が止まった時の問題').waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    const body = await page.locator('main').innerText();
    check(body.includes('いま読み込めません。') && !body.includes('非表示になっています。') && !body.includes('組み直す') && !body.includes('ヒントを直す'),
      '5 棚が止まった時は「いま読み込めません。」（非表示と言わない・組み直す／ヒントを直すも出さない）');
    await shot(page, '5-mine-failed-375');
    // 6. 消す確認
    await page.getByRole('button', { name: '消す', exact: true }).first().click();
    check((await page.locator('[data-delete-note]').textContent().catch(() => '')) === '消すと元に戻せません。この URL で遊べなくなります。', '6 消す確認に「消すと元に戻せません。この URL で遊べなくなります。」');
    await shot(page, '6-delete-confirm-375');
    await page.getByRole('button', { name: 'やめる' }).click();
    // 6. 合言葉の注意・引き継ぎの説明・0件
    check((await page.locator('main').innerText()).includes('作った問題と、ランキングでの自分の記録を、別の端末へ移せます。作りかけ（公開前の問題）は移りません。'), '6 引き継ぎの説明に「作りかけ（公開前の問題）は移りません。」');
    await page.getByRole('button', { name: '合言葉を出す' }).click();
    check(await page.getByText('この合言葉を知っている人は、あなたの問題を消したり、組み直したり、ヒントを直したりできます。人に見せないでください。').count() === 1, '6 合言葉の注意にヒントを直すことが入っている');
    const code = await page.locator('#transfer-code').inputValue();
    await page.locator('#transfer-input').fill(code);
    await page.getByRole('button', { name: '引き継ぐ' }).click();
    await page.waitForTimeout(300);
    check(await page.getByText('移せる問題がありませんでした。').count() === 1 && (await page.getByText(/引き継ぎました/).count()) === 0, '6 引き継げた問題が0件の時は「移せる問題がありませんでした。」（成功の文にしない）');
    await shot(page, '6-transfer-none-375');
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage({ size: S375 });
    await page.goto(`${BASE}/crossword/hints/LocalNk1`);
    await page.getByText('この端末には、この問題を直すための合言葉がありません。').waitFor({ timeout: 30000 });
    const link = page.locator('[data-hints-to-mine]');
    check((await link.getAttribute('href')) === '/crossword/mine', '6 ヒントを直す画面で合言葉が無い時、次にすることの文と「自分が作った問題」へのリンクが出る');
    await shot(page, '6-hints-nokey-375');
    await page.goto(`${BASE}/crossword/create?edit=LocalNk1`);
    check(await page.getByText('この端末には、この問題を直すための合言葉がありません。作った端末の「自分が作った問題」で合言葉を出し、ここで引き継いでください。').first().waitFor({ timeout: 20000 }).then(() => true, () => false),
      '6 組み直しで合言葉が無い時も、同じ次にすることの文が出る');
    await shot(page, '6-edit-nokey-375');
    await ctx.close();
  }
  // ===== 27-1. 見本の2行目 =====
  {
    const { ctx, page } = await newPage({ marks: { ...CREATE_MARKS } });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    const line2 = (await areaValue(page)).split('\n')[1];
    check(line2 === 'パンダ、フラミンゴ、ミーアキャットが登場する研修生曲のタイトルは？→【アニマルランド】', `27-1 見本の2行目が Hop の決めた文（${line2}）`);
    await ctx.close();
  }

  // ===== 27-3. 作った人の名前 =====
  const BAD_NAME = 'この名前は使えません。公式やメンバー本人と間違われる名前は避けてください。';
  const BAD_NAME_BLOCK = '作った人の名前が使えません。公式やメンバー本人と間違われる名前は避けてください。';
  {
    const { ctx, page } = await newPage({ size: S375 });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await fillToPublish(page);
    const creator = page.locator('#cw-creator');
    const save = page.locator('[data-share-sheet] [data-save]');
    const state = async () => ({
      note: await page.locator('[data-creator-bad]').textContent().catch(() => null),
      blocks: await page.locator('[data-share-blocks]').textContent(),
      disabled: await save.isDisabled(),
    });
    check(!(await state()).disabled, '27-3 名前が空の時は公開できる（確かめの前提）');
    const bad = ['ハロプロ公式', 'クロスワード運営', 'hop-up-tools', 'ＨＯＰ－ＵＰ　ＴＯＯＬＳ', 'スタッフA', '山﨑愛生', '櫻井 梨央'];
    for (const name of bad) {
      // 1字ずつ打つ（打っている時点で出るかを見る）
      await creator.fill('');
      await creator.pressSequentially(name, { delay: 10 });
      await page.waitForTimeout(150);
      const st = await state();
      check(st.note === BAD_NAME && st.blocks.includes(BAD_NAME_BLOCK) && st.disabled, `27-3 「${name}」は打った時点で欄の下に知らせが出て、押せない理由に並び、公開を押せない`);
    }
    for (const name of ['山﨑愛生推し', '台本の人', 'りおちゃん']) {
      await creator.fill(name);
      await page.waitForTimeout(150);
      const st = await state();
      check(st.note === null && !st.blocks.includes(BAD_NAME_BLOCK) && !st.disabled, `27-3 「${name}」は使える（知らせが出ない・公開できる）`);
    }
    await creator.fill('ハロプロ公式');
    await page.waitForTimeout(150);
    const described = await creator.evaluate((el) => [el.getAttribute('aria-invalid'), el.getAttribute('aria-describedby')]);
    check(described[0] === 'true' && described[1] === 'cw-creator-bad', `27-3 読み上げでも欄と知らせがつながる（${described.join('・')}）`);
    await ctx.close();
  }
  {
    // 受付係が bad_name で断った時（画面では通る名前でも、受付係の表が違えば断られうる）
    const { ctx, page, sent } = await newPage({ size: S390, saveReason: 'bad_name' });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await fillToPublish(page);
    await page.locator('#cw-creator').fill('台本の人');
    await page.locator('[data-share-sheet] [data-save]').click();
    const told = await page.getByText(BAD_NAME_BLOCK).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
    check(told && sent.saves.length === 1, `27-3 受付係が bad_name を返した時は「${BAD_NAME_BLOCK}」と知らせる（送った ${sent.saves.length}回）`);
    await ctx.close();
  }

  // ===== 27-4. 窓で書いたカギを取っておく =====
  {
    const { ctx, page } = await newPage({ size: S375 });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await fillArea(page, '鳴く→【ネコ】\n葉を食べる→【コアラ】');
    await openWordSheet(page, 'ネコ');
    await setClue(page, 'イヌ→ネコの順に鳴く');
    await page.waitForTimeout(200);
    check((await page.locator('[data-word-sheet] [data-clue-restore]').count()) === 0, '27-4 窓のカギが使われている間は「前に窓で書いたカギに戻す」は出ない');
    await closeWordSheet(page);
    await fillArea(page, 'ニャーと鳴く→【ネコ】\n葉を食べる→【コアラ】');
    await openWordSheet(page, 'ネコ');
    const restore = page.locator('[data-word-sheet] [data-clue-restore]');
    check((await clueValue(page)) === 'ニャーと鳴く' && (await restore.textContent().catch(() => null)) === '前に窓で書いたカギに戻す',
      `27-4 書く欄の行を直すと書く欄のカギが使われ、「前に窓で書いたカギに戻す」が出る（${await clueValue(page)}）`);
    await closeWordSheet(page);
    await page.waitForTimeout(600);
    const draft = await readDraft(page);
    check(draft?.shelvedClues?.['ネコ'] === 'イヌ→ネコの順に鳴く', `27-4 取っておいたカギは作りかけにも残る（${JSON.stringify(draft?.shelvedClues)}）`);
    await page.reload();
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await openWordSheet(page, 'ネコ');
    check((await clueValue(page)) === 'ニャーと鳴く' && (await restore.count()) === 1, '27-4 再読み込みの後も書く欄のカギのままで、戻すボタンが出る');
    await restore.click();
    await page.waitForTimeout(300);
    check((await clueValue(page)) === 'イヌ→ネコの順に鳴く' && (await restore.count()) === 0 && (await page.locator('[data-word-sheet] [data-clue-stuck]').getAttribute('data-clue-stuck').catch(() => null)) === 'marks',
      `27-4 押すと窓のカギに戻り、ボタンは消え、書く欄に移せない理由がまた出る（${await clueValue(page)}）`);
    await closeWordSheet(page);
    await page.waitForTimeout(600);
    await page.reload();
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await openWordSheet(page, 'ネコ');
    check((await clueValue(page)) === 'イヌ→ネコの順に鳴く' && (await restore.count()) === 0, `27-4 戻した後に開き直しても窓のカギのまま（${await clueValue(page)}）`);
    await closeWordSheet(page);
    // 窓で書いたカギを書く欄に移せた時（→ などが無い）は、書く欄の行を直しても取っておかない（書く欄にそのカギが入っていたので、直したのは本人）
    await fillArea(page, '鳴く→【ネコ】\n葉を食べる→【コアラ】');
    await openWordSheet(page, 'コアラ');
    await setClue(page, 'ユーカリを食べる');
    await closeWordSheet(page);
    await fillArea(page, '鳴く→【ネコ】\nユーカリの葉を食べる→【コアラ】');
    await openWordSheet(page, 'コアラ');
    check((await page.locator('[data-word-sheet] [data-clue-restore]').count()) === 0, '27-4 書く欄に移せたカギは、書く欄の行を直しても戻すボタンを出さない');
    await closeWordSheet(page);
    await ctx.close();
  }

  // ===== 27-6. 置けなかった答えがある時の公開の窓 =====
  const UNPLACED_TEXT = 'ニャーと鳴く→【ネコ】\nユーカリを食べる→【コアラ】\nすっきりした香り→【ミント】';
  {
    const { ctx, page } = await newPage({ size: S375 });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await fillArea(page, UNPLACED_TEXT);
    await waitBoard(page).catch(() => {});
    await page.waitForTimeout(1500);
    await openShare(page);
    const entry = page.locator('[data-share-unplaced] [data-share-open-board]');
    const ok = await entry.waitFor({ timeout: 15000 }).then(() => true, () => false);
    check(ok && (await entry.textContent()) === 'マス目をいじる' && (await page.locator('[data-share-unplaced]').textContent()).includes('この答えは問題に入りません。'),
      '27-6 置けなかった答えの知らせの近くに「マス目をいじる」の入口が出る');
    if (ok) {
      await entry.click();
      const opened = await page.locator('[data-board-sheet]').waitFor({ timeout: 10000 }).then(() => true, () => false);
      const shareGone = await page.locator('[data-share-sheet]').waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false);
      check(opened && shareGone, `27-6 押すと公開の窓が閉じて「マス目をいじる」が開く（開いた ${opened}・公開の窓が閉じた ${shareGone}）`);
      await shot(page, '27-6-board-opened-375');
    }
    await ctx.close();
  }

  // ===== 写真: 直した所を 375×548 と 390×844 の両方で撮る（はみ出し・重なりを目で見るため。確かめの行は出さない） =====
  for (const [size, tag] of [[S375, '375x548'], [S390, '390x844']]) {
    {
      // 27-3 名前の知らせ・27-6 置けなかった答えの入口（公開の窓）
      const { ctx, page } = await newPage({ size });
      await page.goto(`${BASE}/crossword/create`);
      await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
      await fillToPublish(page);
      await page.locator('#cw-creator').fill('ハロプロ公式スタッフの名前をとても長く書いた時');
      await page.locator('[data-creator-bad]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await shot(page, `p27-creator-bad-${tag}`);
      await closeShare(page);
      await fillArea(page, UNPLACED_TEXT);
      await waitBoard(page).catch(() => {});
      await page.waitForTimeout(1500);
      await openShare(page);
      await page.locator('#cw-creator').fill('');
      // 下の貼り付き（押せない理由・公開する）に隠れない所まで、公開の窓を一番下まで送る
      await page.locator('[data-share-open-board]').evaluate((el) => {
        let p = el.parentElement;
        while (p && !(p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
        if (p) p.scrollTop = p.scrollHeight;
      });
      await page.waitForTimeout(300);
      await shot(page, `p27-unplaced-board-${tag}`);
      await ctx.close();
    }
    {
      // 27-4 戻すボタン（答えの窓）。欄を選んでいない時と、カギの欄を選んでいる時
      const { ctx, page } = await newPage({ size });
      await page.goto(`${BASE}/crossword/create`);
      await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
      await fillArea(page, '鳴く→【ネコ】\n葉を食べる→【コアラ】');
      await openWordSheet(page, 'ネコ');
      await setClue(page, 'イヌ→ネコの順に鳴く');
      await closeWordSheet(page);
      await fillArea(page, 'ニャーと鳴く→【ネコ】\n葉を食べる→【コアラ】');
      await openWordSheet(page, 'ネコ');
      await page.locator('[data-word-sheet] [data-clue-restore]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await shot(page, `p27-clue-restore-${tag}`);
      await page.locator('[data-word-sheet] #cw-clue').focus();
      await page.waitForTimeout(500);
      await shot(page, `p27-clue-restore-focus-${tag}`);
      await ctx.close();
    }
    {
      const { ctx, page } = await newPage({ size });
      await page.goto(`${BASE}/crossword/create`);
      await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
      await fillArea(page, '【ネコ】と【イヌ】\n葉を食べる→【コアラ】');
      await openWordSheet(page, 'ネコ');
      await setLinkHint(page, `https://example.com/${'very-long-path-'.repeat(8)}end`);
      await setClue(page, 'ニャーと鳴く動物');
      await page.locator('[data-word-sheet] [data-clue-stuck]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await shot(page, `p-clue-stuck-two-${tag}`);
      await closeWordSheet(page);
      await openWordSheet(page, 'コアラ');
      const same = page.locator('[data-word-sheet] [data-same-hint]');
      await same.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await shot(page, `p-same-hint-${tag}`);
      await ctx.close();
    }
    {
      const { ctx, page } = await newPage({ size, init: fullInit });
      await page.goto(`${BASE}/crossword/create`);
      await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
      await fillToPublish(page);
      await page.waitForTimeout(300);
      await shot(page, `p-draft-not-kept-${tag}`);
      await page.locator('[data-share-sheet] [data-save]').click();
      await page.locator('#cw-share-title').waitFor({ timeout: 20000 });
      await page.waitForTimeout(500);
      await shot(page, `p-key-not-kept-${tag}`);
      await ctx.close();
    }
    {
      const mineList = JSON.stringify([{ id: 'LocalMn1', title: '棚が止まった時の問題', key: 'a'.repeat(64), createdAt: 2 }]);
      const { ctx, page } = await newPage({ size, shelf: 'error', marks: { ...CREATE_MARKS, crossword_my_puzzles: mineList } });
      await page.goto(`${BASE}/crossword/mine`);
      await page.getByText('棚が止まった時の問題').waitFor({ timeout: 30000 });
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: '消す', exact: true }).first().click();
      await page.getByRole('button', { name: '合言葉を出す' }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `p-mine-${tag}.png`), fullPage: true });
      await page.goto(`${BASE}/crossword/hints/LocalNk1`);
      await page.locator('[data-hints-to-mine]').waitFor({ timeout: 30000 });
      await shot(page, `p-hints-nokey-${tag}`);
      await ctx.close();
    }
    {
      const { ctx, page } = await newPage({ size, shelf: 'hang' });
      await page.goto(`${BASE}/crossword/${SOLVE_ID}`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-solve-loading]').waitFor({ timeout: 10000 });
      await shot(page, `p-solve-loading-${tag}`);
      await page.locator('[data-solve-loading="slow"]').waitFor({ timeout: 15000 });
      await shot(page, `p-solve-slow-${tag}`);
      await ctx.close();
    }
  }
} catch (e) {
  console.log(`NG 台本が途中で止まった: ${String(e?.stack || e).split('\n').slice(0, 3).join(' ')}`);
  fail++;
} finally {
  await browser.close().catch(() => {});
  stopServer();
}
check(stumbles.length === 0, `画面のつまずき（例外・描画の誤り）0件${stumbles.length ? '：' + stumbles.slice(0, 3).join(' / ') : ''}`);
console.log(`写真: ${OUT}`);
console.log(fail ? `NG ${fail}件（OK ${okCount}）` : `ALL OK（${okCount}）`);
process.exit(fail ? 1 : 0);
