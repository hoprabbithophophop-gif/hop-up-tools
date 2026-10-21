// 作る画面の4段の流れ（紙 docs/definition-of-done.md v2.1「### 作る」）を、手元の開発サーバーで通しで確かめる。
// 本番にもプレビューにも通信しない（2026-10-19 Hop「本番環境から見える形で検収用パズル登録を二度とするな」）。
// 手元の vite をこの台本が立ち上げ（口 5194・Supabase の住所は使わない仮の住所）、棚（/rest/v1）・受付係（/api）・人間確認（Turnstile）・
// 埋め込みの読み込みはブラウザの中で受け止める。保存と組み直しの更新は作り物が受けて、送られた中身を台本が読む。
// YouTube の動画のことはどこにも問い合わせない（Hop 決定 2026-10-21「チャンネル名を出さない」）。台帳（youtube_videos）に無い動画は outside の印で通るので、
// YouTube の oEmbed（youtube.com/oembed）・googleapis.com（字の形の fonts.googleapis.com は外す）・/api/crossword-video-info への通信が無いことも見る
//   (1) 初めて開いた作る画面: 段の札4つ（今の段だけ黒い）・「?」・ジャンルの切り替え・「リストに追加」・1語ずつの欄が無い
//   (2) 1の段: 答えが2つ以上で「組み合わせを探す（N語）」が押せる
//   (3) 2の段: 案1〜3と「N語・Mマス・交差K」・選んだ案の盤（マスの数＝M）・「再シャッフル」・下書きに盤が残る
//   (4) 3の段: 盤に入った答えだけが並ぶ・カギの下書き（○・同じ行のほかの答えは□・「問題文→【答え】」は問題文だけ）・○ボタン
//       ・「ヒントが未選択の語が N 語あります」「カギが空の語が N 語あります」・そろうと「全部の答えにカギとヒントが付きました。」
//       ・3の段から開いたヒントの窓には「囲みを外す」が無い・台帳に無い YouTube は「公式チャンネルの動画か確かめて」の1文付きで選べ、作りかけに outside の印が残る
//       ・カギは30字まで（Hop 決定 2026-10-21）: 欄の下に「あと◯字」。30字ちょうど（絵文字は1字）は共有できる。31字は「1字多いです。…」が欄の下と共有のボタンの上に出て押せない
//   (5) 段の行き来: 3→2→1 と戻っても、盤・書いた行・ヒント・書き直したカギが消えない
//   (6) 作りかけ: 開き直すと同じ段・同じ盤に戻り、組み直さない（「組み立て中…」が出ない）
//   (7) 4の窓: 題名が空なら「題名を入力してください。」・「カギの段へ戻る」・人間確認を通って保存 → URL が出る・保存の中身のジャンルは hello・
//       台帳に無い YouTube のヒントに outside: true・作りかけが消える
//   (8) なぞる動き: 初めての端末で一度だけ（なぞる印・指・吹き出し・帯の「「語」を出す」）。開き直すと出ない。「動きを減らす」では止めた絵
//   (9) 組み直し（?edit=）: 2の段から始まり、書いた行は【語】の行・題名が戻る・「更新する」で送る中身のジャンルは hello・
//       保存してあった YouTube のヒントは、台帳に無くても保存してあった印（outside なし）を引き継ぐ・作りかけを書かない
//   (10) 固定を守る（Hop 決定 2026-10-21 案A）: 「2 盤」で2語を長押しで動かして固定 → 「1 答え」に戻って語を足す →「組み合わせを探す」→
//       固定した2語の向きと互いの位置（盤の左上が動くので2語の差で見る）が同じで、固定の印も残る。案2を選んでも残る。
//       そのあと固定した1語の【 】を外して探し直すと、その語の固定は外れ（戻しても固定の印は付かない）、もう1語の固定は残る
//   (11) 段の札を押して行き来する（Hop 決定 2026-10-22）: 札は4つとも押せて高さ 44px 以上・390×548 で折り返さない・
//       答え1つで「2 盤」を押しても 2 へ行かない・1 から札で 3・4 へ飛べる・盤が無い時の 3 は答え全部の欄・
//       盤が無い時の 4 は共有を押せず理由の先頭に「共有する前に、2 盤で盤を決めてください。」・札の「2 盤」で探す・答えが同じなら探し直さない・
//       札で 3 へ行ってから書いたカギとヒントは盤ができた後も残る・答えを変えると盤は古い扱い（開き直しても）・
//       組み立て中に札で 1 へ移っても組み立ては裏で終わる・3 の「← 盤へ戻る」も札の「2 盤」と同じ（答えを変えていれば探し直す・変えていなければ探し直さない）
// 使い方: node scripts/verify/crossword/check-create-flow.mjs（引数なし）
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';
import { outDir, ROOT, leaveFirstVisitMarks, watchStumbles } from './_lib.mjs';
import {
  CREATE_MARKS, stepTab, shownStep, currentStepLabel, writeLines, hintMode, openHintSheet, closeHintSheet, setLinkHint, hintAllInAnswers,
  toBoard, toClues, hintAllInClues, openShare, clueInput, clueKeys, boardCells, readDraft, exampleUrl,
} from './_create.mjs';

// 印は場面ごとに台本が立てる（なぞる動きを確かめるため）
leaveFirstVisitMarks();

const PORT = 5194;
const BASE = `http://localhost:${PORT}`;
const MOCK_SUPA = 'https://mock-supabase.invalid';
const OUT = outDir('check-create-flow');
const W = 390;

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

// ---- 組み直し（?edit=）の見本。棚には置かない（受付係の作り物が答える） ----
const EDIT_ID = 'LocalCF9';
const EDIT_KEY = 'e'.repeat(64);
const editPuzzle = {
  id: EDIT_ID, title: '組み直しの見本', genre: 'other', tags: ['見本'], is_beginner: true, group_tags: [], play_count: 0,
  body: { version: 1, width: 2, height: 3, creatorName: '台本', clues: [
    { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: 'ニャーと鳴く動物', length: 2, hint: { kind: 'link', url: 'https://example.com/neko' } },
    // 保存の時点では台帳にあった動画（outside なし）。今の台帳には無い＝台帳から消えた動画として、組み直しで印を引き継ぐかを見る
    { clueIndex: 2, direction: 'vertical', startX: 1, startY: 0, clue: 'ユーカリの葉を食べる動物', length: 3, hint: { kind: 'youtube', videoId: 'goneVideo01', startSec: 7 } },
  ] },
};
const editAnswers = [['ネ', 'コ'], ['コ', 'ア', 'ラ']];

const browser = await chromium.launch();
const pageErrors = [];
const sent = { saves: [], updates: [], outside: [] };
const asked = [];
const FORBIDDEN = /youtube\.com\/oembed|(?<!fonts\.)googleapis\.com|\/api\/crossword-video-info/;

async function newPage({ marks = CREATE_MARKS, reducedMotion, extra = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 1, ...(reducedMotion ? { reducedMotion } : {}) });
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
  await ctx.route('**/api/crossword-owner-get', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, puzzle: editPuzzle, answers: editAnswers }) }));
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
    if (FORBIDDEN.test(req.url())) asked.push(req.url());
  });
  return { ctx, page };
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);

// 書く行。4語とも互いに交差できる字を持つ（ネコ・コアラ は コ、コアラ・ライブ・ラジオ は ラ）
const LINES = [
  'ニャーと鳴く動物→【ネコ】',
  '【ライブ】で【ラジオ】の話をした',
  '【コアラ】はユーカリを食べる',
];
const TEXT = LINES.join('\n');
const WORDS = ['ネコ', 'ライブ', 'ラジオ', 'コアラ'];
// カギの下書き（紙: 囲んだ所は○、同じ行のほかの答えは□、「問題文→【答え】」は問題文だけ）
const DRAFTS = {
  ネコ: 'ニャーと鳴く動物',
  ライブ: '○○○で□□□の話をした',
  ラジオ: '□□□で○○○の話をした',
  コアラ: '○○○はユーカリを食べる',
};

try {
  await startServer();

  // ===== (1)〜(7) 通し =====
  {
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);

    // (1) 初めて開いた作る画面
    const steps = await page.locator('nav li[data-step]').allTextContents();
    check(steps.join('/') === '1 答え/2 盤/3 カギ/4 共有', `(1) 段の札が4つ（${steps.join('/')}）`);
    check((await currentStepLabel(page)) === '1 答え' && (await page.locator('nav li[aria-current="step"]').count()) === 1, '(1) 今の段（1 答え）だけが黒い札');
    const stepBg = await page.locator('nav li[data-step] [data-step-tab]').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
    check(stepBg[0] !== stepBg[1] && stepBg[1] === stepBg[2], `(1) 黒い札と他の札の色が違う（${stepBg.join(' / ')}）`);
    const stuck = await page.locator('nav[aria-label="今の段"]').evaluate((e) => getComputedStyle(e).position);
    check(stuck === 'sticky', `(1) 段の札は画面の上に貼り付く（${stuck}）`);
    const gone = await page.evaluate(() => ({
      help: document.querySelectorAll('[title="パズルの作り方"], [aria-label="パズルの作り方"]').length,
      genre: [...document.querySelectorAll('[role="radio"], button')].filter((b) => ['ハロプロ', 'その他'].includes((b.getAttribute('aria-label') || b.textContent || '').trim())).length,
      add: [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'リストに追加').length,
      oneByOne: document.querySelectorAll('#cw-answer, #cw-clue').length,
    }));
    check(gone.help === 0, `(1) 作る画面に「?」（パズルの作り方）は無い（${gone.help}）`);
    check(gone.genre === 0, `(1) ジャンルの切り替え（ハロプロ｜その他）は無い（${gone.genre}）`);
    check(gone.add === 0 && gone.oneByOne === 0, `(1) 1語ずつの欄と「リストに追加」は無い（ボタン ${gone.add}・欄 ${gone.oneByOne}）`);
    check((await page.getByText('ハロプロにする').count()) === 0, '(1) メンバー名の知らせ（「ハロプロにする」）は無い');
    await page.screenshot({ path: path.join(OUT, '1-first-open-390.png'), fullPage: true });

    // (2) 1の段: 答えが1つでは探せない、2つ以上で探せる
    await writeLines(page, LINES[0]);
    const search = page.locator('[data-bulk-search]');
    check((await search.isDisabled()) && (await search.textContent()) === '組み合わせを探す（1語）', `(2) 答えが1つの間は「${await search.textContent()}」が押せない`);
    await writeLines(page, TEXT);
    check((await search.isEnabled()) && (await search.textContent()) === '組み合わせを探す（4語）', `(2) 答えが4つで「${await search.textContent()}」が押せる`);

    // ヒントは1の段で2語だけ付けておく（残りは3の段で付ける）
    await hintAllInAnswers(page, ['ネコ', 'コアラ']);
    const dots = await page.locator('[data-bulk-hint]').evaluateAll((els) => els.map((e) => e.getAttribute('data-bulk-hint')));
    check(dots.filter((d) => d === 'on').length === 2 && dots.filter((d) => d === 'off').length === 2, `(2) ヒントを付けた2語だけ ●（${dots.join(',')}）`);

    // (3) 2の段
    await toBoard(page);
    check((await currentStepLabel(page)) === '2 盤', `(3) 「組み合わせを探す」で2の段へ（${await currentStepLabel(page)}）`);
    const cards = page.locator('[data-bulk-proposal]');
    const nCards = await cards.count();
    const labels = await cards.evaluateAll((els) => els.map((e) => e.querySelector('span')?.textContent));
    const stats = await page.locator('[data-bulk-stats]').allTextContents();
    check(nCards >= 1 && nCards <= 3 && labels.every((l, i) => l === `案${i + 1}`), `(3) 案が「案1〜」で並ぶ（${labels.join('・')}）`);
    check(stats.length === nCards && stats.every((s) => /^\d+語・\d+マス・交差\d+$/.test(s)), `(3) 案ごとに「N語・Mマス・交差K」（${stats.join(' / ')}）`);
    check((await cards.first().getAttribute('aria-pressed')) === 'true', '(3) 初めは案1が選ばれている');
    const cellsN = async () => (await boardCells(page)).length;
    const statCells = (s) => Number(s.match(/(\d+)マス/)[1]);
    check((await cellsN()) === statCells(stats[0]), `(3) 盤のマスの数が案1の「Mマス」と同じ（盤 ${await cellsN()} ／ 案 ${statCells(stats[0])}）`);
    if (nCards >= 2) {
      await cards.nth(1).click();
      await page.waitForTimeout(300);
      check((await cards.nth(1).getAttribute('aria-pressed')) === 'true' && (await cellsN()) === statCells(stats[1]), `(3) 案2を選ぶと案2の盤になる（盤 ${await cellsN()} ／ 案 ${statCells(stats[1])}）`);
      await cards.first().click();
      await page.waitForTimeout(300);
    }
    check((await page.locator('[data-reshuffle]').count()) === 1 && (await page.locator('[data-step-back="1"]').textContent()) === '← 答えへ戻る', '(3) 「再シャッフル」と「← 答えへ戻る」がある');
    const d2 = await readDraft(page);
    check(d2?.version === 2 && d2.step === 2 && Array.isArray(d2.board) && d2.board.length > 0, `(3) 作りかけに段（${d2?.step}）と盤（${d2?.board?.length ?? 0}語）が残る`);
    await page.screenshot({ path: path.join(OUT, '3-board-390.png'), fullPage: true });
    const placedWords = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('crossword_draft') || '{}');
      return (d.board || []).map((i) => i.id);
    });
    const boardBefore = await boardCells(page);

    // (4) 3の段
    await toClues(page);
    check((await currentStepLabel(page)) === '3 カギ', `(4) 「この盤で進む」で3の段へ（${await currentStepLabel(page)}）`);
    const keys = await clueKeys(page);
    check(keys.length === placedWords.length && keys.every((k) => placedWords.includes(k)), `(4) 盤に入った答えだけが並ぶ（${keys.join('・')} ／ 盤 ${placedWords.join('・')}）`);
    check((await page.locator('[data-create-board]').count()) === 0, '(4) 3の段に盤は出ない');
    for (const k of keys) {
      const v = await clueInput(page, k).inputValue();
      check(v === DRAFTS[k], `(4) 「${k}」のカギの下書き: ${v}（見込み ${DRAFTS[k]}）`);
    }
    const missing = page.locator('[data-missing-hints]');
    const noHint = keys.filter((k) => !['ネコ', 'コアラ'].includes(k)).length;
    check((await missing.textContent()) === `ヒントが未選択の語が ${noHint} 語あります` && (await page.locator('[data-open-share]').isDisabled()), `(4) 「${await missing.textContent()}」で「共有する」は押せない`);
    check((await page.locator('[data-pick-hint]').count()) === noHint && (await page.locator('[data-pick-hint]').first().textContent()) === '未選択 → ヒントを選ぶ', '(4) ヒントの無い語に赤字の「未選択 → ヒントを選ぶ」');
    const state = await page.locator('[data-clue-row="ネコ"] [data-hint-state]').textContent().catch(() => null);
    check(state === `ヒント: リンク ${exampleUrl('ネコ')}`, `(4) 1の段で付けたヒントが「ヒント: 出どころ 名前」で出る（${state}）`);
    // カギを空にすると「カギが空の語が 1 語あります」
    const k0 = keys[0];
    await clueInput(page, k0).fill('');
    check((await missing.textContent()).includes('カギが空の語が 1 語あります'), `(4) カギを空にすると「${await missing.textContent()}」`);
    // ○ボタン: 欄を選んでいない時は末尾に足す
    await page.locator(`[data-clue-row="${k0}"] button[aria-label="○を入れる"]`).click();
    check((await clueInput(page, k0).inputValue()) === '○', `(4) ○ボタンでカギの欄に○が入る（${await clueInput(page, k0).inputValue()}）`);
    await clueInput(page, k0).fill(DRAFTS[k0]);
    // 3の段から開いたヒントの窓（題は「「語」のヒント」・「囲みを外す」は無い）。1語は台帳に無い YouTube にして、1文と作りかけの outside の印を見る
    const ytKey = keys.find((k) => !['ネコ', 'コアラ'].includes(k));
    if (ytKey) {
      await page.locator(`[data-clue-row="${ytKey}"] [data-pick-hint]`).click();
      const sheet = page.locator('[data-hint-sheet]');
      await sheet.waitFor();
      check((await sheet.locator('h2').first().textContent()) === `「${ytKey}」のヒント` && (await sheet.locator('[data-unmark-sheet]').count()) === 0, `(4) 3の段から開いた窓は「「${ytKey}」のヒント」で「囲みを外す」が無い`);
      // 1つの窓の中で出どころを切り替えても、探す言葉と年月が残る（1 答えから開いた窓は check-hints-edit の (5) で見る。2026-10-22 Hop の指摘を受けて 3 カギの窓でも見る）
      await sheet.locator('[data-hint-source="ameblo"]').click();
      await sheet.locator('[data-blog-search] input').fill('武道館');
      await sheet.locator('[data-blog-search] [data-helper-period] select').nth(0).selectOption('2020');
      await sheet.locator('[data-blog-search] [data-helper-period] select').nth(1).selectOption('10');
      await sheet.locator('[data-hint-source="x"]').click();
      await page.waitForTimeout(200);
      const kept = await sheet.locator('[data-x-search]').evaluate((el) => [el.querySelector('input')?.value, ...Array.from(el.querySelectorAll('[data-helper-period] select')).map((x) => x.value)].join(',')).catch(() => null);
      check(kept === '武道館,2020,10', `(4) 3の段から開いた窓でも、出どころを替えて探す言葉と年月が残る（${kept}）`);
      await sheet.locator('[data-hint-source="yt"]').click();
      await sheet.locator('#cw-hint').fill('https://youtu.be/dQw4w9WgXcQ?t=83');
      const note = await sheet.locator('[data-hint-outside]').textContent({ timeout: 10000 }).catch(() => null);
      check(note === 'ハロプロのグループや事務所の公式チャンネルの動画か、確かめてください。', `(4) 台帳に無い YouTube は問い合わせずに選べ、1文が出る（${note}）`);
      check((await sheet.getByText(/チャンネル:/).count()) === 0, '(4) チャンネル名は出ない');
      await closeHintSheet(page);
      await page.waitForTimeout(300);
      const d = await readDraft(page);
      const h = d?.hints?.[ytKey];
      check(h?.kind === 'youtube' && h.videoId === 'dQw4w9WgXcQ' && h.startSec === 83 && h.outside === true && !('channel' in h), `(4) 作りかけの YouTube のヒントは outside の印付きで、チャンネル名は無い（${JSON.stringify(h)}）`);
    }
    await hintAllInClues(page);
    check((await missing.textContent()) === '全部の答えにカギとヒントが付きました。' && (await page.locator('[data-open-share]').isEnabled()), `(4) そろうと「${await missing.textContent()}」で「共有する」が押せる`);
    // カギは30字まで（Hop 決定 2026-10-21）。数え方は見た目の字数（絵文字も1字）
    const leftOf = (k) => page.locator(`[data-clue-row="${k}"] [data-clue-left], [data-clue-row="${k}"] [data-clue-over]`).first().textContent();
    // 欄に入っている文で数える（同じ行のほかの答えは□で隠れるので、書いた下書きとは字数が違うことがある。盤によって先頭の語が変わる）
    const draftLeft = 30 - Array.from((await clueInput(page, k0).inputValue()).trim()).length;
    check((await leftOf(k0)) === `あと${draftLeft}字`, `(4) カギの欄の下に残り字数（${await leftOf(k0)}）`);
    const c30 = 'あ'.repeat(28) + '🐱😀';
    await clueInput(page, k0).fill(c30);
    check((await leftOf(k0)) === 'あと0字' && (await missing.textContent()) === '全部の答えにカギとヒントが付きました。' && (await page.locator('[data-open-share]').isEnabled()), `(4) 30字ちょうど（絵文字2つを含む）は「${await leftOf(k0)}」で共有できる`);
    await clueInput(page, k0).fill(c30 + 'い');
    const overLine = `${k0}：1字多いです。30字までにしてください。`;
    check((await leftOf(k0)) === '1字多いです。30字までにしてください。' && (await missing.textContent()) === overLine && (await page.locator('[data-open-share]').isDisabled()), `(4) 31字は欄の下に「${await leftOf(k0)}」、ボタンの上に「${await missing.textContent()}」で共有できない`);
    await page.screenshot({ path: path.join(OUT, '4-clue-over-390.png'), fullPage: true });
    await clueInput(page, k0).fill(DRAFTS[k0]);
    check((await page.locator('[data-open-share]').isEnabled()), '(4) 30字以内に戻すとまた共有できる');
    await page.screenshot({ path: path.join(OUT, '4-clues-390.png'), fullPage: true });

    // (5) 段の行き来で消えない
    const edited = keys.includes('コアラ') ? 'コアラ' : keys[0];
    await clueInput(page, edited).fill('書き直したカギ');
    await page.locator('[data-step-back="2"]').click();
    await page.locator('[data-create-step="2"]').waitFor();
    await page.waitForTimeout(300);
    check(JSON.stringify(await boardCells(page)) === JSON.stringify(boardBefore), '(5) 「← 盤へ戻る」で同じ盤が出る（組み直さない）');
    await page.locator('[data-step-back="1"]').click();
    await page.locator('[data-create-step="1"]').waitFor();
    await page.waitForTimeout(300);
    const marksBack = await page.locator('[data-bulk-mark]').evaluateAll((els) => els.map((e) => e.getAttribute('data-bulk-mark')));
    const dotsBack = await page.locator('[data-bulk-hint]').evaluateAll((els) => els.map((e) => e.getAttribute('data-bulk-hint')));
    check(WORDS.every((w) => marksBack.includes(w)), `(5) 「← 答えへ戻る」で書いた行が残る（${marksBack.join('・')}）`);
    check(dotsBack.filter((d) => d === 'on').length >= keys.length, `(5) 付けたヒントも残る（● ${dotsBack.filter((d) => d === 'on').length}）`);
    await page.locator('[data-bulk-mode-button="write"]').click();
    check((await page.locator('[data-bulk-text]').inputValue()) === TEXT, '(5) 書く欄の文字列もそのまま');
    await toBoard(page);
    // この4語は「ラ」を持つ語が3つで「ラ」のマスが足りず、盤に入るのはいつも3語。探し直すとどの3語になるかは毎回変わるので、
    // (7) で YouTube のヒントを確かめられるよう、YouTube のヒントを付けた語が入った案を選ぶ（2026-10-22 台本の直し。前は半分ほどの回で (7) が NG になっていた）
    if (ytKey) {
      const n = await page.locator('[data-bulk-proposal]').count();
      for (let i = 0; i < n; i++) {
        if ((await readDraft(page))?.board?.some((b) => b.id === ytKey)) break;
        await page.locator('[data-bulk-proposal]').nth(i).click();
        await page.waitForTimeout(300);
      }
      check(!!(await readDraft(page))?.board?.some((b) => b.id === ytKey), `(5) 探し直した案の中に「${ytKey}」の入った盤がある`);
    }
    await toClues(page);
    check((await clueInput(page, edited).inputValue()) === '書き直したカギ', `(5) 探し直して3の段に戻っても、書き直したカギは残る（${await clueInput(page, edited).inputValue()}）`);
    await hintAllInClues(page); // 探し直して盤に入った語が変わった時の分

    // (6) 作りかけ: 開き直すと3の段・同じ盤に戻る
    const dBefore = await readDraft(page);
    let sawBuilding = false;
    await page.reload();
    const t0 = Date.now();
    while (Date.now() - t0 < 2500) {
      if ((await page.getByText('組み立て中…').count()) > 0) sawBuilding = true;
      await page.waitForTimeout(100);
    }
    check((await page.locator('[data-create-step]').count()) === 1 && (await shownStep(page)) === 3, `(6) 開き直すと3の段に戻る（${await shownStep(page).catch(() => '?')}）`);
    check(!sawBuilding, '(6) 開き直しても組み立て（「組み立て中…」）は始まらない');
    check((await clueInput(page, edited).inputValue()) === '書き直したカギ', '(6) 書いたカギも戻る');
    const dAfter = await readDraft(page);
    const pos = (d) => JSON.stringify((d?.board || []).map(({ id, direction, startX, startY, pinned }) => [id, direction, startX, startY, pinned]).sort());
    check(pos(dBefore) === pos(dAfter) && pos(dAfter) !== '[]', '(6) 盤（語の位置と固定）が開き直す前と同じ');
    await page.locator('[data-step-back="2"]').click();
    await page.locator('[data-create-step="2"]').waitFor();
    const cellsAfter = await boardCells(page);
    check(cellsAfter.length > 0 && (await page.locator('[data-bulk-adopt]').isEnabled()), `(6) 2の段へ戻ると盤がそのまま出る（${cellsAfter.length}マス）`);
    await toClues(page);

    // (7) 4の窓
    await openShare(page);
    const sheet = page.locator('[data-share-sheet]');
    check((await sheet.locator('h2').first().textContent()) === '共有する', '(7) 「共有する」で下から窓が出る（題「共有する」）');
    await page.locator('#cw-title').fill('');
    await sheet.locator('[data-save]').click();
    check((await sheet.locator('[data-title-error]').textContent().catch(() => null)) === '題名を入力してください。', '(7) 題名が空なら「題名を入力してください。」');
    await sheet.locator('[data-step-back="3"]').click();
    await sheet.waitFor({ state: 'detached' });
    check((await shownStep(page)) === 3 && (await currentStepLabel(page)) === '3 カギ', '(7) 「カギの段へ戻る」で3の段へ');
    await openShare(page);
    check((await currentStepLabel(page)) === '4 共有', `(7) 窓が出ている間は段の札が「4 共有」（${await currentStepLabel(page)}）`);
    await page.locator('#cw-title').fill('流れの確かめ');
    await page.locator('#cw-creator').fill('台本');
    await page.locator('#cw-tag').fill('見本のタグ');
    await page.locator('#cw-tag').press('Enter');
    await sheet.getByRole('checkbox').check();
    await page.screenshot({ path: path.join(OUT, '7-share-sheet-390.png'), fullPage: true });
    await sheet.locator('[data-save]').click();
    const url = await page.locator('#cw-share-url').inputValue({ timeout: 20000 }).catch(() => '');
    check(/\/crossword\/LocalCF1$/.test(url), `(7) 人間確認を通って保存され、その問題の URL が出る（${url}）`);
    const saved = sent.saves[0]?.puzzle;
    check(saved?.genre === 'hello', `(7) 保存の中身のジャンルは hello（${saved?.genre}）`);
    check(saved?.title === '流れの確かめ' && saved?.body?.creatorName === '台本' && saved?.tags?.join() === '見本のタグ' && saved?.isBeginner === true, '(7) 題名・作った人・タグ・初めての人向けが保存の中身に入る');
    check(Array.isArray(saved?.body?.clues) && saved.body.clues.every((c) => c.hint && c.clue) && saved.body.clues.length === keys.length, `(7) 全部の語にカギとヒントが入る（${saved?.body?.clues?.length ?? 0}語）`);
    const ytSaved = (saved?.body?.clues ?? []).filter((c) => c.hint?.kind === 'youtube');
    check(ytSaved.length === 1 && ytSaved[0].hint.videoId === 'dQw4w9WgXcQ' && ytSaved[0].hint.outside === true && !('channel' in ytSaved[0].hint), `(7) 台帳に無い YouTube のヒントに outside: true が入り、チャンネル名は無い（${JSON.stringify(ytSaved.map((c) => c.hint))}）`);
    check((await readDraft(page)) === null, '(7) 保存に成功すると作りかけが消える');
    await page.screenshot({ path: path.join(OUT, '7-saved-390.png') });
    await ctx.close();
  }

  // ===== (8) なぞる動き =====
  {
    const noTrace = { ...CREATE_MARKS };
    delete noTrace.crossword_seen_trace;
    const { ctx, page } = await newPage({ marks: noTrace });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await writeLines(page, TEXT);
    check((await page.locator('[data-trace-tip]').count()) === 0, '(8) 書く側では動きは出ない');
    await hintMode(page);
    const tipShown = await page.locator('[data-trace-tip]').waitFor({ timeout: 3000 }).then(() => true, () => false);
    check(tipShown && (await page.locator('[data-trace-tip]').textContent()) === '字をなぞると答えにできます', '(8) 初めて「ヒントを付ける」を開くと吹き出し「字をなぞると答えにできます」');
    check((await page.locator('[data-trace-mark]').count()) === 1 && (await page.locator('[data-trace-finger]').count()) === 1, '(8) なぞる印と指が出る');
    await page.waitForTimeout(1200);
    const bar = await page.locator('[data-bulk-markbar] button').textContent().catch(() => null);
    check(bar === '「ニャー」を出す', `(8) 帯に「「語」を出す」が出る（${bar}）`);
    await page.screenshot({ path: path.join(OUT, '8-trace-390.png') });
    check((await page.evaluate(() => localStorage.getItem('crossword_seen_trace'))) === '1', '(8) 見せた印が端末に残る');
    await page.waitForTimeout(3800);
    check((await page.locator('[data-trace-tip]').count()) === 0 && (await page.locator('[data-bulk-markbar]').count()) === 0, '(8) 動きは約4.5秒で消える');
    await page.locator('[data-bulk-mode-button="write"]').click();
    await hintMode(page);
    await page.waitForTimeout(1500);
    check((await page.locator('[data-trace-tip]').count()) === 0, '(8) 1の段を切り替え直しても出直さない');
    await page.reload();
    await hintMode(page);
    await page.waitForTimeout(1500);
    check((await page.locator('[data-trace-tip]').count()) === 0, '(8) 開き直しても出ない（一度だけ）');
    await ctx.close();
  }
  {
    const noTrace = { ...CREATE_MARKS };
    delete noTrace.crossword_seen_trace;
    const { ctx, page } = await newPage({ marks: noTrace, reducedMotion: 'reduce' });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await writeLines(page, TEXT);
    await hintMode(page);
    await page.locator('[data-trace-mark]').waitFor({ timeout: 3000 }).catch(() => {});
    const still = await page.evaluate(() => {
      const m = document.querySelector('[data-trace-mark]');
      const f = document.querySelector('[data-trace-finger]');
      return m && f ? { mt: getComputedStyle(m).transitionDuration, ft: getComputedStyle(f).transitionDuration, w: m.getBoundingClientRect().width } : null;
    });
    check(!!still && still.w > 0 && /^0s(, 0s)*$/.test(still.mt) && /^0s(, 0s)*$/.test(still.ft), `(8) 「動きを減らす」では動かさず止めた絵（${JSON.stringify(still)}）`);
    const bar = await page.locator('[data-bulk-markbar] button').textContent().catch(() => null);
    check(bar === '「ニャー」を出す', `(8) 止めた絵でも帯が出る（${bar}）`);
    await page.waitForTimeout(3300);
    check((await page.locator('[data-trace-tip]').count()) === 0, '(8) 止めた絵は約3秒で消える');
    await ctx.close();
  }

  // ===== (10) 動かして固定した語の位置を、探し直しても守る（Hop 決定 2026-10-21 案A） =====
  {
    // 動かせる先は画面と同じ engine.ts の canMoveTo で決める（型だけ外して読み込む。論理は写さない。check-pin.mjs と同じやり方）
    const engDir = path.join(OUT, 'engine');
    mkdirSync(engDir, { recursive: true });
    for (const name of ['types', 'engine']) {
      const src = readFileSync(path.join(ROOT, 'src', 'lib', 'crossword', `${name}.ts`), 'utf8');
      writeFileSync(path.join(engDir, `${name}.mjs`), stripTypeScriptTypes(src).replace(/from '\.\/(types)'/g, "from './$1.mjs'"));
    }
    const { canMoveTo, moveItem, tryPlaceAll, shuffleByLength, buildGrid } = await import(pathToFileURL(path.join(engDir, 'engine.mjs')).href + `?t=${Date.now()}`);
    const cellsOf = (it) => Array.from({ length: it.length }, (_, i) => (it.direction === 'horizontal' ? [it.startX + i, it.startY] : [it.startX, it.startY + i]));
    // 盤の上の語を長押しで持ち上げて (dx, dy) マスずらして離す。置ける印（data-placeable="yes"）を見てから離す
    const dragWord = async (page, board, it, dx, dy) => {
      const owners = new Map();
      for (const o of board) for (const [x, y] of cellsOf(o)) owners.set(`${x},${y}`, [...(owners.get(`${x},${y}`) || []), o.id]);
      // つまむマス: この語だけが通るマス。無ければ語の先頭のマス（交わるマスではそのマスから始まる語をつまむ作り）
      const own = cellsOf(it).find(([x, y]) => owners.get(`${x},${y}`).length === 1) || [it.startX, it.startY];
      const minX = Math.min(...board.map((o) => o.startX));
      const minY = Math.min(...board.map((o) => o.startY));
      const w = Math.max(...board.map((o) => (o.direction === 'horizontal' ? o.startX + o.length : o.startX + 1))) - minX;
      const rect = await page.locator('[data-move-layer]').boundingBox();
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
    };
    // 今の盤で、まだ固定していない語の動かせる先を1つ探す（近い順）
    const findMove = (board, skip) => {
      const tries = [];
      for (let r = 1; r <= 4; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) tries.push([dx, dy]);
      for (const it of board) {
        if (skip.includes(it.id)) continue;
        for (const [dx, dy] of tries) if (canMoveTo(board, it.uuid, it.startX + dx, it.startY + dy)) return { it, dx, dy };
      }
      return null;
    };
    const pinsOf = (d) => (d?.board || []).filter((i) => i.pinned);
    const rel = (d, a, b) => {
      const A = (d?.board || []).find((i) => i.id === a);
      const B = (d?.board || []).find((i) => i.id === b);
      return A && B ? { dx: B.startX - A.startX, dy: B.startY - A.startY, da: A.direction, db: B.direction, pa: !!A.pinned, pb: !!B.pinned } : null;
    };
    // 組み立て（「組み立て中…」）が始まって終わるまで待つ（始まる前の盤を読まないように）
    const waitBuilt = async (page) => {
      await page.locator('[data-create-step="2"]').waitFor({ timeout: 10000 });
      await page.locator('[data-create-board] [role="status"]').waitFor({ timeout: 3000 }).catch(() => {});
      await page.locator('[data-create-board] [role="status"]').waitFor({ state: 'detached', timeout: 45000 });
      await page.locator('[data-reshuffle]:enabled').waitFor({ timeout: 45000 });
      await page.waitForTimeout(300);
    };
    const search = async (page) => {
      await page.locator('[data-bulk-search]').click();
      await waitBuilt(page);
    };

    const PIN_WORDS = ['スイカ', 'イカスミ', 'カラス', 'アイス', 'スミレ'];
    const pinLines = (words) => words.map((w) => `【${w}】`).join('\n');
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await writeLines(page, pinLines(PIN_WORDS));
    await search(page);
    // 探して出た盤は語どうしがよく絡んだ小さな盤なので、2語とも動かせる先が無いことが多い。その時は、同じ engine で組んだ
    // 2語続けて動かせる盤を作りかけとして端末に置いて開き直す（作りかけから戻った盤は組み直さずにそのまま出る作り）
    const d0 = await readDraft(page);
    const twoMoves = (board) => {
      const m1 = findMove(board, []);
      if (!m1) return false;
      const b2 = buildGrid(moveItem(board, m1.it.uuid, m1.it.startX + m1.dx, m1.it.startY + m1.dy)).items;
      return !!findMove(b2, [m1.it.id]);
    };
    if (!twoMoves(d0.board)) {
      const items = PIN_WORDS.map((w) => ({ id: w, question: '', answer: Array.from(w) }));
      let loose = null;
      for (let t = 0; t < 500 && !loose; t++) {
        const b = buildGrid(tryPlaceAll(shuffleByLength(items))).items;
        if (b.length === PIN_WORDS.length && twoMoves(b)) loose = b;
      }
      const board = loose.map(({ id, uuid, answer, direction, startX, startY, length }) => ({ id, uuid, question: '', answer, direction, startX, startY, length, pinned: false }));
      await page.evaluate((d) => localStorage.setItem('crossword_draft', JSON.stringify(d)), { ...d0, board, proposals: null, picked: null });
      await page.reload();
      await page.locator('[data-create-step="2"] [data-move-layer]').waitFor({ timeout: 30000 });
      await page.waitForTimeout(500);
      console.log('    探して出た盤では2語続けて動かせないので、同じ engine で組んだ盤を作りかけから出した');
    }
    // 2語を動かして固定する
    const pinned = [];
    for (let round = 0; round < 4 && pinned.length < 2; round++) {
      const d = await readDraft(page);
      const mv = findMove(d.board, pinned);
      if (!mv) break;
      const placeable = await dragWord(page, d.board, mv.it, mv.dx, mv.dy);
      const moved = (await readDraft(page)).board.find((i) => i.id === mv.it.id);
      if (placeable && moved?.pinned) pinned.push(mv.it.id);
      console.log(`    動かした: ${mv.it.id} を (${mv.dx}, ${mv.dy}) マス → ${moved ? `(${moved.startX}, ${moved.startY}) ${moved.direction} 固定=${!!moved.pinned}` : '?'}`);
    }
    check(pinned.length === 2, `(10) 「2 盤」で2語を長押しで動かして固定できた（${pinned.join('・')}）`);
    const [pa, pb] = pinned;
    const dPinned = await readDraft(page);
    const before = rel(dPinned, pa, pb);
    check((await page.locator('[data-pin]').count()) === 2, `(10) 固定の印が2つ出る（${await page.locator('[data-pin]').count()}）`);
    await page.screenshot({ path: path.join(OUT, '10-1-pinned-390.png'), fullPage: true });
    console.log(`    固定した2語: ${JSON.stringify(pinsOf(dPinned).map(({ id, direction, startX, startY }) => [id, direction, startX, startY]))}`);

    // 1 答えに戻って語を1つ足し、組み合わせを探す
    await page.locator('[data-step-back="1"]').click();
    await page.locator('[data-create-step="1"]').waitFor();
    await writeLines(page, pinLines([...PIN_WORDS, 'ミカン']));
    await search(page);
    const dAgain = await readDraft(page);
    const after = rel(dAgain, pa, pb);
    console.log(`    探し直した後: ${JSON.stringify(pinsOf(dAgain).map(({ id, direction, startX, startY }) => [id, direction, startX, startY]))}・盤の語 ${dAgain.board.length}`);
    check(!!before && !!after && after.dx === before.dx && after.dy === before.dy && after.da === before.da && after.db === before.db,
      `(10) 語を足して探し直しても、固定した2語の向きと互いの位置が同じ（前 ${JSON.stringify(before)} ／ 後 ${JSON.stringify(after)}）`);
    check(!!after?.pa && !!after?.pb && (await page.locator('[data-pin]').count()) === 2, `(10) 探し直した後も2語に固定の印が残る（印 ${await page.locator('[data-pin]').count()}）`);
    check(dAgain.board.some((i) => i.id === 'ミカン') || (await page.locator('[data-unplaced]').count()) === 1, '(10) 足した語は盤に入るか、入らない語として出る');
    check((await page.locator('[data-bulk-proposal]').count()) >= 1, `(10) 案が並ぶ（${await page.locator('[data-bulk-proposal]').count()}）`);
    // 固定した2語は動かした時につながっていたので、つながる組み方がある。案1はつながった盤で「この盤で進む」が押せる
    check((await page.locator('[data-not-connected]').count()) === 0 && (await page.locator('[data-bulk-adopt]').isEnabled()), '(10) 案1は盤がつながっていて「この盤で進む」が押せる');
    await page.screenshot({ path: path.join(OUT, '10-2-research-390.png'), fullPage: true });
    if ((await page.locator('[data-bulk-proposal]').count()) >= 2) {
      await page.locator('[data-bulk-proposal]').nth(1).click();
      await page.waitForTimeout(400);
      const r2 = rel(await readDraft(page), pa, pb);
      check(!!r2 && r2.dx === before.dx && r2.dy === before.dy && r2.pa && r2.pb, `(10) 案2を選んでも固定した2語の位置と固定の印が同じ（${JSON.stringify(r2)}）`);
      await page.locator('[data-bulk-proposal]').first().click();
      await page.waitForTimeout(400);
    }

    // 固定した1語（pb）の【 】を外して探し直す → その語の固定は外れ、もう1語（pa）の固定は残る
    await page.locator('[data-step-back="1"]').click();
    await page.locator('[data-create-step="1"]').waitFor();
    const without = [...PIN_WORDS, 'ミカン'].filter((w) => w !== pb);
    await writeLines(page, `${pinLines(without)}\n${pb}`);
    await search(page);
    const dRemoved = await readDraft(page);
    const keptA = dRemoved.board.find((i) => i.id === pa);
    const was = dPinned.board.find((i) => i.id === pa);
    check(!dRemoved.board.some((i) => i.id === pb), `(10) 【 】を外した「${pb}」は盤から消える`);
    check(keptA?.pinned === true && keptA.direction === was.direction && pinsOf(dRemoved).length === 1, `(10) もう1語「${pa}」の固定は残る（固定 ${pinsOf(dRemoved).map((i) => i.id).join('・')}）`);
    await page.screenshot({ path: path.join(OUT, '10-3-unmarked-390.png'), fullPage: true });
    // 【 】を戻して探し直しても、外れた固定は戻らない
    await page.locator('[data-step-back="1"]').click();
    await page.locator('[data-create-step="1"]').waitFor();
    await writeLines(page, pinLines([...without, pb]));
    await search(page);
    const dBack = await readDraft(page);
    const backB = dBack.board.find((i) => i.id === pb);
    check(!backB || backB.pinned === false, `(10) 戻した「${pb}」には固定の印が付かない（${backB ? `固定=${backB.pinned}` : '盤に入らず'}）`);
    check(dBack.board.find((i) => i.id === pa)?.pinned === true, `(10) 「${pa}」の固定はそのまま`);
    await ctx.close();
  }

  // ===== (11) 段の札を押して行き来する（Hop 決定 2026-10-22） =====
  {
    const { ctx, page } = await newPage();
    await page.setViewportSize({ width: W, height: 548 });
    await page.goto(`${BASE}/crossword/create`);
    await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    const NEED = '共有する前に、2 盤で盤を決めてください。';
    const tabs = await page.locator('[data-step-tab]').evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return { tag: e.tagName, h: r.height, right: r.right, fits: e.scrollWidth <= e.clientWidth };
    }));
    check(tabs.length === 4 && tabs.every((t) => t.tag === 'BUTTON'), `(11) 札は4つとも押せるボタン（${tabs.map((t) => t.tag).join('/')}）`);
    check(tabs.every((t) => t.h >= 44 && t.h < 60), `(11) 札の高さは 44px 以上で1行（${tabs.map((t) => t.h).join('/')}）`);
    check(tabs.every((t) => t.fits && t.right <= W), `(11) 390px で札の字がはみ出さない（右端 ${tabs.map((t) => Math.round(t.right)).join('/')}）`);
    const navH = await page.locator('nav[aria-label="今の段"]').evaluate((e) => e.getBoundingClientRect().height);
    console.log(`    段の札の帯の高さ ${navH}px（画面の高さ 548px）`);

    // 答え1つで「2 盤」→ 2 へ行かない（1 の段のまま）
    await writeLines(page, LINES[0]);
    await stepTab(page, 2);
    await page.waitForTimeout(400);
    check((await shownStep(page)) === 1 && (await page.locator('[data-bulk-search]').isDisabled()), `(11) 答え1つで「2 盤」を押しても 2 へ行かない（今の段 ${await shownStep(page)}）`);
    // 3 からでも、答え1つなら 2 へ行かず 1 へ
    await stepTab(page, 3);
    await page.locator('[data-create-step="3"]').waitFor({ timeout: 5000 });
    await stepTab(page, 2);
    await page.waitForTimeout(400);
    check((await shownStep(page)) === 1, `(11) 3 の段で答え1つのまま「2 盤」を押すと 1 の段へ（今の段 ${await shownStep(page)}）`);

    // 1 から札で 3 へ: 盤が無いので答え全部の欄
    await writeLines(page, TEXT);
    await page.screenshot({ path: path.join(OUT, '11-0-steps-390.png') });
    await stepTab(page, 3);
    await page.locator('[data-create-step="3"] [data-clue-row]').first().waitFor({ timeout: 5000 });
    check((await currentStepLabel(page)) === '3 カギ', '(11) 1 から札で 3 へ飛べる');
    const rows0 = (await clueKeys(page)).sort();
    check(rows0.join('/') === [...WORDS].sort().join('/'), `(11) 盤が無い時の 3 は答え全部の欄が出る（${rows0.join('・')}）`);
    const line0 = await page.locator('[data-missing-hints]').textContent();
    check(line0.startsWith(NEED) && (await page.locator('[data-open-share]').isDisabled()), `(11) 盤が無い時の 3 は理由の先頭に盤の1行・共有を押せない（${line0}）`);
    // 盤が無いうちにカギを書き直し、ヒントを1つ付ける
    await clueInput(page, 'ネコ').fill('札で書いたカギ');
    await page.locator('[data-clue-row="ライブ"] [data-pick-hint]').click();
    await page.locator('[data-hint-sheet]').waitFor({ timeout: 10000 });
    await setLinkHint(page, exampleUrl('ライブ'));
    await closeHintSheet(page);

    // 1 から札で 4 へ: 共有を押せず、理由の先頭に盤の1行。ヒントが足りない理由も並ぶ
    await stepTab(page, 1);
    await page.locator('[data-create-step="1"]').waitFor({ timeout: 5000 });
    await stepTab(page, 4);
    await page.locator('[data-share-sheet]').waitFor({ timeout: 5000 });
    const blocks0 = await page.locator('[data-share-sheet] [data-share-blocks]').textContent();
    check((await page.locator('[data-share-sheet] [data-save]').isDisabled()) && blocks0.startsWith(NEED) && blocks0.includes('ヒントが未選択の語が'),
      `(11) 1 から札で 4 へ。盤が無いので共有を押せず、理由の先頭に盤の1行（${blocks0}）`);
    await page.screenshot({ path: path.join(OUT, '11-1-share-no-board-390.png') });
    await page.locator('[data-share-sheet] [data-step-back="3"]').click();
    await page.locator('[data-share-sheet]').waitFor({ state: 'detached', timeout: 5000 });

    // 札の「2 盤」で探す
    await stepTab(page, 2);
    await page.locator('[data-create-step="2"]').waitFor({ timeout: 5000 });
    await page.locator('[data-bulk-adopt]:enabled').waitFor({ timeout: 45000 });
    check((await page.locator('[data-bulk-proposal]').count()) >= 1, '(11) 札の「2 盤」で組み合わせを探す（案が並ぶ）');
    const cellsA = await boardCells(page);
    // 答えが同じなら探し直さない
    await stepTab(page, 1);
    await page.locator('[data-create-step="1"]').waitFor({ timeout: 5000 });
    await stepTab(page, 2);
    await page.locator('[data-create-step="2"]').waitFor({ timeout: 5000 });
    const building = await page.locator('[data-create-board] [role="status"]').count();
    const cellsB = await boardCells(page);
    check(building === 0 && cellsA.length > 0 && cellsA.join() === cellsB.join(), `(11) 答えが同じなら札の「2 盤」で探し直さない（組み立て中 ${building}・盤 ${cellsA.join() === cellsB.join() ? '同じ' : '違う'}）`);

    // 盤ができた後の 3: 盤に入った答えだけ。札で書いたカギとヒントが残る
    await stepTab(page, 3);
    await page.locator('[data-create-step="3"] [data-clue-row]').first().waitFor({ timeout: 5000 });
    const rows1 = await clueKeys(page);
    const placed = (await readDraft(page)).board.map((i) => i.id);
    check(rows1.length === placed.length && rows1.every((k) => placed.includes(k)), `(11) 盤ができた後の 3 は盤に入った答えだけ（${rows1.join('・')}）`);
    if (rows1.includes('ネコ')) check((await clueInput(page, 'ネコ').inputValue()) === '札で書いたカギ', '(11) 盤が無い時に書いたカギが、盤ができた後も残る');
    if (rows1.includes('ライブ')) check((await page.locator('[data-clue-row="ライブ"] [data-hint-state]').count()) === 1, '(11) 盤が無い時に付けたヒントが、盤ができた後も残る');
    check(!(await page.locator('[data-missing-hints]').textContent()).includes(NEED), '(11) 盤があれば盤の1行は出ない');
    // カギとヒントが揃うまでは 4 でも押せない（盤の1行は無し）
    if ((await page.locator('[data-pick-hint]').count()) > 0) {
      await stepTab(page, 4);
      await page.locator('[data-share-sheet]').waitFor({ timeout: 5000 });
      const blocks1 = await page.locator('[data-share-sheet] [data-share-blocks]').textContent();
      check((await page.locator('[data-share-sheet] [data-save]').isDisabled()) && !blocks1.includes(NEED) && blocks1.includes('ヒントが未選択の語が'), `(11) 盤があってもヒントが足りなければ 4 で押せず、今の理由が並ぶ（${blocks1}）`);
      await page.locator('[data-share-sheet] [data-step-back="3"]').click();
      await page.locator('[data-share-sheet]').waitFor({ state: 'detached', timeout: 5000 });
    }
    await hintAllInClues(page);
    await stepTab(page, 4);
    await page.locator('[data-share-sheet]').waitFor({ timeout: 5000 });
    check((await page.locator('[data-share-sheet] [data-save]').isEnabled()) && (await page.locator('[data-share-sheet] [data-share-blocks]').count()) === 0, '(11) 揃えば札の 4 から共有を押せる（理由の行は出ない）');
    await page.locator('[data-share-sheet] [data-step-back="3"]').click();
    await page.locator('[data-share-sheet]').waitFor({ state: 'detached', timeout: 5000 });

    // 答えを変えると、盤は古い扱い（3 は答え全部・盤の1行）。開き直しても同じ
    await stepTab(page, 1);
    await page.locator('[data-create-step="1"]').waitFor({ timeout: 5000 });
    await writeLines(page, `${TEXT}\n【ネコジャラシ】`);
    await stepTab(page, 3);
    await page.locator('[data-create-step="3"] [data-clue-row]').first().waitFor({ timeout: 5000 });
    check((await clueKeys(page)).length === WORDS.length + 1 && (await page.locator('[data-missing-hints]').textContent()).startsWith(NEED), `(11) 答えを変えた後の 3 は古い盤を使わず、答え全部の欄と盤の1行（${(await clueKeys(page)).length} 行）`);
    await page.waitForTimeout(300);
    await page.reload();
    await page.locator('[data-create-step="3"] [data-clue-row]').first().waitFor({ timeout: 30000 });
    check((await page.locator('[data-missing-hints]').textContent()).startsWith(NEED) && (await clueKeys(page)).length === WORDS.length + 1, '(11) 開き直しても 3 の段・古い盤は使わないまま');

    // 札の「2 盤」で探し直し、組み立て中に札で 1 へ移る → 組み立ては裏で終わり、3 では盤が使える
    await stepTab(page, 2);
    await page.locator('[data-create-step="2"]').waitFor({ timeout: 5000 });
    const started = await page.locator('[data-create-board] [role="status"]').count();
    await stepTab(page, 1);
    await page.locator('[data-create-step="1"]').waitFor({ timeout: 5000 });
    check(started === 1, `(11) 答えを変えた後の札の「2 盤」は探し直す（組み立て中 ${started}）`);
    await page.waitForFunction(() => {
      try { const d = JSON.parse(localStorage.getItem('crossword_draft') || 'null'); return !!d && d.step === 1 && Array.isArray(d.board) && d.board.length > 0 && d.boardSig === d.searchedSig && String(d.boardSig).includes('ネコジャラシ'); } catch { return false; }
    }, null, { timeout: 45000 }).catch(() => {});
    await stepTab(page, 3);
    await page.locator('[data-create-step="3"] [data-clue-row]').first().waitFor({ timeout: 5000 });
    check(!(await page.locator('[data-missing-hints]').textContent()).includes(NEED), '(11) 組み立て中に 1 へ移っても組み立ては裏で終わり、3 では盤が使える');
    await page.screenshot({ path: path.join(OUT, '11-2-after-background-390.png'), fullPage: true });

    // 3 カギの「← 盤へ戻る」も札の「2 盤」と同じ（Hop 決定 2026-10-22）: 答えが同じなら探し直さず今の盤のまま、変えていれば探し直す
    const boardPos = (d) => JSON.stringify((d?.board ?? []).map(({ id, direction, startX, startY }) => [id, direction, startX, startY]));
    const posBefore = boardPos(await readDraft(page));
    await page.locator('[data-create-step="3"] [data-step-back="2"]').click();
    await page.locator('[data-create-step="2"]').waitFor({ timeout: 5000 });
    const buildingBack = await page.locator('[data-create-board] [role="status"]').count();
    await page.waitForTimeout(300);
    check(buildingBack === 0 && posBefore !== '[]' && boardPos(await readDraft(page)) === posBefore, `(11) 答えが同じなら 3 の「← 盤へ戻る」で探し直さず今の盤のまま（組み立て中 ${buildingBack}）`);
    await stepTab(page, 1);
    await page.locator('[data-create-step="1"]').waitFor({ timeout: 5000 });
    await writeLines(page, TEXT); // ネコジャラシを外す
    await stepTab(page, 3);
    await page.locator('[data-create-step="3"] [data-clue-row]').first().waitFor({ timeout: 5000 });
    await page.locator('[data-create-step="3"] [data-step-back="2"]').click();
    await page.locator('[data-create-step="2"]').waitFor({ timeout: 5000 });
    const startedBack = await page.locator('[data-create-board] [role="status"]').count();
    await page.locator('[data-bulk-adopt]:enabled').waitFor({ timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(300);
    const dBack = await readDraft(page);
    check(startedBack === 1 && !!dBack?.boardSig && dBack.boardSig === dBack.searchedSig && !String(dBack.boardSig).includes('ネコジャラシ') && (await page.locator('[data-bulk-adopt]').isEnabled()),
      `(11) 答えを変えて 3 の「← 盤へ戻る」を押すと探し直し、今の答えの盤で「この盤で進む」が押せる（組み立て中 ${startedBack}）`);
    await page.locator('[data-bulk-adopt]').click();
    await page.locator('[data-create-step="3"] [data-clue-row]').first().waitFor({ timeout: 5000 });
    check(!(await page.locator('[data-missing-hints]').textContent()).includes(NEED), '(11) 探し直した盤で 3 へ進むと「盤を決めてください」は出ない（堂々巡りにならない）');
    await ctx.close();
  }

  // ===== (9) 組み直し（?edit=） =====
  {
    const mine = JSON.stringify([{ id: EDIT_ID, key: EDIT_KEY, title: '組み直しの見本', createdAt: Date.now() }]);
    const { ctx, page } = await newPage({ extra: { crossword_my_puzzles: mine } });
    await page.goto(`${BASE}/crossword/create?edit=${EDIT_ID}`);
    await page.locator('[data-create-step="2"]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    check((await page.locator('h1').first().textContent()) === 'クロスワードパズルの組み直し', '(9) 組み直しの画面になる');
    check((await boardCells(page)).length === 4 && (await currentStepLabel(page)) === '2 盤', `(9) 保存した時の盤で2の段から始まる（${(await boardCells(page)).length}マス）`);
    await page.locator('[data-step-back="1"]').click();
    await page.locator('[data-create-step="1"]').waitFor();
    await page.locator('[data-bulk-mode-button="write"]').click();
    check((await page.locator('[data-bulk-text]').inputValue()) === '【ネコ】\n【コアラ】', `(9) 語は1の段の【語】の行として戻る（${JSON.stringify(await page.locator('[data-bulk-text]').inputValue())}）`);
    await toBoard(page);
    await toClues(page);
    check((await clueInput(page, 'コアラ').inputValue()) === 'ユーカリの葉を食べる動物', '(9) カギが戻る');
    check((await page.locator('[data-clue-row="ネコ"] [data-hint-state]').textContent()) === 'ヒント: リンク https://example.com/neko', '(9) ヒントが戻る');
    await openShare(page);
    check((await page.locator('#cw-title').inputValue()) === '組み直しの見本' && (await page.locator('#cw-creator').inputValue()) === '台本', '(9) 題名・作った人が戻る');
    const btn = page.locator('[data-share-sheet] [data-save]');
    check((await btn.textContent()) === '更新する', `(9) 保存のボタンは「${await btn.textContent()}」`);
    await btn.click();
    await page.getByText('この問題を更新しました。URL は変わりません。').waitFor({ timeout: 20000 }).catch(() => {});
    check((await bodyText(page)).includes('この問題を更新しました。URL は変わりません。'), '(9) 「この問題を更新しました。URL は変わりません。」');
    const up = sent.updates[0];
    check(up?.id === EDIT_ID && up?.key === EDIT_KEY && up?.puzzle?.genre === 'hello', `(9) 更新で送る中身のジャンルは hello（元の問題は other。送った ${up?.puzzle?.genre}）`);
    const koara = (up?.puzzle?.body?.clues ?? []).find((c) => c.hint?.kind === 'youtube' && c.hint.videoId === 'goneVideo01')?.hint;
    check(koara && koara.startSec === 7 && !('outside' in koara), `(9) 保存してあった YouTube のヒントは、今の台帳に無くても保存してあった印（outside なし）のまま送る（${JSON.stringify(koara)}）`);
    check(sent.saves.length === 1, '(9) 組み直しは新しい問題として保存しない');
    check((await readDraft(page)) === null, '(9) 組み直しの間は作りかけを書かない');
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
