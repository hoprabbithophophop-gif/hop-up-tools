// 起こりうる困った場面（2026-10-04 洗い出しの 1〜5）で、詰まらず正しい知らせが出るかを確かめる。
// 台帳・受付係の答えは途中で差し替えて場面を作る。4 だけは本物の受付係で、無い回の番号から始め直せるかを見る。
// 回数を足す呼び出しとランキングへの送信は受け止めるので、本物の回数とランキングは変わらない。
// 使い方: node scripts/verify/crossword/check-edge.mjs [サイト] [ハロプロの問題の番号] ['<答えの配置 JSON>'] [残すマス x,y]
// （省略した引数は targets.json の問題から決める。答えの配置は受付係に聞いて一時置き場に控える）
import { chromium } from 'playwright';
import { interceptCount, humanWaitMs, arg, outDir, puzzleArgs, BASE_DEFAULT, ID_DEFAULT } from './_lib.mjs';

const BASE = arg(2, BASE_DEFAULT);
const ID = arg(3, ID_DEFAULT);
const P = await puzzleArgs(BASE, ID, { cluesJson: arg(4), last: arg(5) });
const LAST = P.last;
const OUT = outDir('check-edge');
const full = {};
for (const c of P.cluesJson) c.a.forEach((ch, i) => {
  full[`${c.d === 'horizontal' ? c.x + i : c.x},${c.d === 'vertical' ? c.y + i : c.y}`] = ch;
});
const almost = { ...full };
delete almost[LAST];
const [lx, ly] = LAST.split(',').map(Number);

let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
const browser = await chromium.launch();

async function open(path, { answers = null, play = undefined, routes = [], mine = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await interceptCount(ctx);
  await ctx.route('**/api/crossword-score', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  for (const [pattern, handler] of routes) await ctx.route(pattern, handler);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/crossword/mine`);
  await page.evaluate(({ id, answers, play, mine }) => {
    localStorage.setItem('crossword_seen_help', 'true');
    if (answers) localStorage.setItem(`crossword_progress_${id}`, JSON.stringify({ userAnswers: answers, elapsedSeconds: 0, play, savedAt: Date.now() }));
    if (mine) localStorage.setItem('crossword_my_puzzles', JSON.stringify([{ id, title: 't', key: 'x'.repeat(64), createdAt: 1 }]));
  }, { id: ID, answers, play, mine });
  await page.goto(`${BASE}${path}`);
  return { ctx, page };
}
const text = (page) => page.evaluate(() => document.body.innerText);
const waitBoard = async (page) => {
  await page.getByRole('button', { name: /1行|2行|3行/ }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
};
const fillLast = async (page) => {
  await page.getByRole('button', { name: `${ly + 1}行${lx + 1}列：空` }).click();
  await page.getByRole('button', { name: full[LAST], exact: true }).last().click();
};
const noCatalog = ['**/rest/v1/youtube_videos*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })];

// 1a. ハロプロのジャンル: 台帳から消えた動画のヒントは「見られなくなりました」
{
  const { ctx, page } = await open(`/crossword/${ID}`, { routes: [noCatalog] });
  await waitBoard(page);
  await page.getByRole('button', { name: /1行|2行|3行/ }).first().click();
  await page.getByRole('button', { name: 'ヒント', exact: true }).first().click();
  await page.waitForTimeout(1500);
  const t = await text(page);
  check(t.includes('このヒントの動画は見られなくなりました'), '1 台帳から消えた動画のヒントは「見られなくなりました」');
  check((await page.locator('iframe[src*="youtube"]').count()) === 0, '1 その時はプレイヤーを置かない');
  await page.screenshot({ path: `${OUT}/edge-1-gone.png` });
  await ctx.close();
}
// 1b. 台帳にあれば今まで通りプレイヤー
{
  const { ctx, page } = await open(`/crossword/${ID}`);
  await waitBoard(page);
  await page.getByRole('button', { name: /1行|2行|3行/ }).first().click();
  await page.getByRole('button', { name: 'ヒント', exact: true }).first().click();
  await page.waitForTimeout(4000);
  check((await page.locator('iframe[src*="youtube"]').count()) >= 1, '1 台帳にある動画は今まで通りプレイヤーが出る');
  await ctx.close();
}
// 1c. 自分が作った問題: 見られなくなったヒントがあると知らせる
{
  const { ctx, page } = await open('/crossword/mine', { routes: [noCatalog], mine: true });
  await page.getByRole('heading', { name: '自分が作った問題' }).waitFor();
  await page.waitForTimeout(3000);
  check((await text(page)).includes('見られなくなったヒントがあります'), '1 自分が作った問題に「見られなくなったヒントがあります」');
  await ctx.close();
}
// 2. 作る画面: 再生できない動画（存在しない番号）は選べない
{
  const { ctx, page } = await open('/crossword/create');
  await page.getByPlaceholder('例：ニャーと鳴く動物').waitFor();
  await page.waitForTimeout(2500);
  await page.getByRole('radio', { name: 'その他' }).click();
  await page.getByPlaceholder(/URL/).first().fill('https://youtu.be/aaaaaaaaaa0');
  await page.waitForTimeout(8000);
  const t = await text(page);
  check(t.includes('この動画はヒントに使えません。'), '2 再生できない動画は「この動画はヒントに使えません。」で選べない');
  await page.screenshot({ path: `${OUT}/edge-2-unusable.png` });
  await ctx.close();
}
// 3. 解いている途中に問題が隠された・消された
{
  const gone = ['**/api/crossword-play', (r) => {
    const body = JSON.parse(r.request().postData() || '{}');
    if (body.action === 'check') return r.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false,"reason":"not_found"}' });
    return r.fallback();
  }];
  const { ctx, page } = await open(`/crossword/${ID}`, { answers: almost, routes: [gone] });
  await waitBoard(page);
  await fillLast(page);
  await page.waitForTimeout(1500);
  check((await text(page)).includes('この問題は非表示になったか、消されました。'), '3 「この問題は非表示になったか、消されました。」');
  await ctx.close();
}
// 4. 回の記録が無くなっていた（30 日で片付いた）→ 新しい回として始め直して解き終える（本物の受付係）
{
  const { ctx, page } = await open(`/crossword/${ID}`, { answers: almost, play: { token: '00000000-0000-4000-8000-000000000000', localStart: Date.now() - 40 * 86400 * 1000 } });
  // NG の時に原因を切り分けられるよう、受付係とのやり取り（動作・返事の番号・返事の頭）を控える
  const talk = [];
  page.on('response', async (r) => {
    if (!r.url().includes('/api/crossword-play')) return;
    const action = (() => { try { return JSON.parse(r.request().postData() || '{}').action; } catch { return '?'; } })();
    talk.push(`${action}:${r.status()}:${(await r.text().catch(() => '')).slice(0, 40)}`);
  });
  await waitBoard(page);
  await fillLast(page);
  // 無い回 → 始め直し → 丸付け と受付係を3往復するので、決め打ちの4秒ではなく最大15秒まで待つ（2026-10-05 run-all の中で4秒では足りず NG になった）
  await page.getByText('CLEARED!').first().waitFor({ timeout: 15000 }).catch(() => {});
  const t = await text(page);
  const ok4 = t.includes('CLEARED!') && !t.includes('通信できませんでした');
  if (!ok4) await page.screenshot({ path: `${OUT}/edge-4-restart.png` });
  check(ok4, `4 古い回の番号でも始め直して解き終えられる${ok4 ? '' : '（受付係とのやり取り: ' + talk.join(' , ') + '）'}`);
  // 解けた後は端末の途中経過が消える（2026-10-06 の直し）。新しい回で解き終えられたこと自体は上の CLEARED! で見ている
  const progress = await page.evaluate((id) => localStorage.getItem(`crossword_progress_${id}`), ID);
  check(progress === null, `4 解けた後は端末の途中経過が消える: ${progress === null ? '消えている' : '残っている'}`);
  await ctx.close();
}
// 5. 回を始める人が多すぎる
{
  const busy = ['**/api/crossword-play', (r) => {
    const body = JSON.parse(r.request().postData() || '{}');
    if (body.action === 'start') return r.fulfill({ status: 429, contentType: 'application/json', body: '{"ok":false,"reason":"too_many"}' });
    return r.fallback();
  }];
  const { ctx, page } = await open(`/crossword/${ID}`, { answers: almost, routes: [busy] });
  await waitBoard(page);
  await fillLast(page);
  await page.waitForTimeout(1500);
  check((await text(page)).includes('混み合っています。少し待ってからもう一度お試しください。'), '5 「混み合っています。少し待ってからもう一度お試しください。」');
  await ctx.close();
}

// 6. リンクのヒントの決まり（https だけ・IP アドレスだけの住所は不可。2026-10-04 洗い出しの G）
{
  const { ctx, page } = await open('/crossword/create');
  await page.getByPlaceholder('例：ニャーと鳴く動物').waitFor();
  await page.waitForTimeout(2500);
  await page.getByRole('radio', { name: 'その他' }).click();
  const box = page.getByPlaceholder(/URL/).first();
  for (const bad of ['http://example.com/', 'https://192.168.0.1/']) {
    await box.fill(bad);
    await page.waitForTimeout(600);
    check((await text(page)).includes('リンクは https から始まるサイトの住所だけ使えます。'), `6 ${bad} は使えないと出る`);
  }
  await box.fill('https://example.com/page');
  await page.waitForTimeout(600);
  check((await text(page)).includes('LINK') && !(await text(page)).includes('リンクは https から'), '6 https のサイトは選べる');
  await ctx.close();
}

await browser.close();
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
