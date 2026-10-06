// 入口と行き来・フッター・トップの一覧・解き終えた画面の「Xに投稿」を確かめる。
//  紙: 「玄関 /crossword はギャラリー…見出しの右端に作る画面への入口『作る』」「作る画面は /crossword/create。解く画面の戻る矢印はギャラリーへ」
//      「トップページのツール一覧にクロスワードは載せない」「ページのフッターに非公式の一文は無い」
//      「解き終えた画面のハンコとタイムの真下に『Xに投稿』があり、文は『解けた！　題名』＋その問題の URL」
// 回数を足す呼び出しとランキングへの送信は受け止める（本物の回数とランキングは変わらない）。解き終えるのに本物の回が1つ増える。
// 使い方: node scripts/verify/crossword/check-entry.mjs [サイト] [問題の番号]（省略時は targets.json）
import { chromium } from 'playwright';
import { interceptCount, arg, outDir, puzzleArgs, puzzleLayout, BASE_DEFAULT, ID_DEFAULT, cellAt } from './_lib.mjs';

const BASE = arg(2, BASE_DEFAULT);
const ID = arg(3, ID_DEFAULT);
const OUT = outDir('check-entry');
let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
const browser = await chromium.launch();
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await interceptCount(ctx);
  await ctx.route('**/api/crossword-score', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  return { ctx, page: await ctx.newPage() };
};
const text = (page) => page.evaluate(() => document.body.innerText);
const noUnofficial = async (page, where) => check(!(await text(page)).includes('非公式'), `${where}: 画面に「非公式」の一文が無い`);

// 1. 玄関 /crossword はギャラリーで、見出しの右端に「作る」→ /crossword/create
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/crossword`);
  const heading = page.getByRole('heading', { name: 'パズルギャラリー' });
  await heading.waitFor({ timeout: 20000 });
  await page.waitForTimeout(2000);
  const make = page.getByRole('link', { name: /^作る/ });
  check((await make.count()) === 1, '/crossword はギャラリーで「作る」の入口がある');
  const hb = await heading.boundingBox();
  const mb = await make.boundingBox();
  const row = await make.evaluate((el) => {
    const p = el.parentElement.getBoundingClientRect();
    return { parentRight: Math.round(p.right), right: Math.round(el.getBoundingClientRect().right) };
  });
  const sameRow = hb && mb && mb.y < hb.y + hb.height && mb.y + mb.height > hb.y;
  check(Boolean(sameRow) && mb.x > hb.x + hb.width && Math.abs(row.parentRight - row.right) <= 2, `「作る」は見出しと同じ行の右端: 見出し右 ${Math.round(hb.x + hb.width)} ／ 作る ${Math.round(mb.x)}〜${row.right} ／ 行の右端 ${row.parentRight}`);
  await noUnofficial(page, '/crossword');
  await page.screenshot({ path: `${OUT}/1-gallery.png` });
  await make.click();
  await page.waitForURL(/\/crossword\/create$/, { timeout: 10000 }).catch(() => {});
  check(/\/crossword\/create$/.test(page.url()), `「作る」で /crossword/create へ行く: ${page.url()}`);
  await ctx.close();
}

// 2. /crossword/create は作る画面で「パズルギャラリー →」→ /crossword
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/crossword/create`);
  await page.getByPlaceholder('例：ニャーと鳴く動物').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2000);
  check(true, '/crossword/create は作る画面（カギの欄がある）');
  await noUnofficial(page, '/crossword/create');
  // 矢印は読み上げから外してあるので、名前は「パズルギャラリー」で探し、見えている字に → があるかを見る
  const toList = page.getByRole('link', { name: 'パズルギャラリー', exact: true });
  const shownText = (await toList.count()) === 1 ? (await toList.innerText()).trim() : null;
  check(shownText !== null && /^パズルギャラリー\s*→$/.test(shownText), `作る画面に「パズルギャラリー →」がある: ${shownText}`);
  if (shownText !== null) await toList.click();
  await page.waitForURL((u) => u.pathname === '/crossword', { timeout: 10000 }).catch(() => {});
  check(new URL(page.url()).pathname === '/crossword', `「パズルギャラリー →」で /crossword へ行く: ${page.url()}`);
  await ctx.close();
}

// 3. /crossword/mine のフッター
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/crossword/mine`);
  await page.getByRole('heading', { name: '自分が作った問題' }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await noUnofficial(page, '/crossword/mine');
  await ctx.close();
}

// 4. トップページのツール一覧に /crossword へのリンクが無い
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
  const links = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  const cross = links.filter((h) => /\/crossword/.test(h || ''));
  check(links.length > 0 && cross.length === 0, `トップページにクロスワードへのリンクが無い（リンク ${links.length} 本・クロスワード行き ${cross.length} 本）`);
  await ctx.close();
}

// 5. 解く画面: 戻る矢印は /crossword、フッターに非公式なし。解き終えたら「Xに投稿」の文と URL
{
  const P = await puzzleArgs(BASE, ID);
  const { title } = await puzzleLayout(BASE, ID);
  const almost = { ...P.full };
  delete almost[P.last];
  const [lx, ly] = P.last.split(',').map(Number);
  // 戻る矢印は解いている最中（playing）は隠れる作り。記録の無い端末で開いた直後（始める前）に見る
  {
    const { ctx, page } = await newPage();
    await page.goto(`${BASE}/crossword/${ID}`);
    const back = page.locator('a[title="ギャラリーへ戻る"]');
    await back.waitFor({ timeout: 20000 }).catch(() => {});
    const h = (await back.count()) === 1 ? await back.getAttribute('href') : null;
    check(h === '/crossword', `解く画面（始める前）の戻る矢印は /crossword: ${h}`);
    await ctx.close();
  }
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/crossword/mine`);
  await page.evaluate(({ id, answers }) => {
    localStorage.setItem('crossword_seen_help', 'true');
    localStorage.setItem(`crossword_progress_${id}`, JSON.stringify({ userAnswers: answers, elapsedSeconds: 0, savedAt: Date.now() }));
  }, { id: ID, answers: almost });
  await page.goto(`${BASE}/crossword/${ID}`);
  await page.locator('[id^="cell-"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  await noUnofficial(page, `/crossword/${ID}`);
  await cellAt(page, lx, ly, '空').click();
  await page.getByRole('button', { name: P.lastChar, exact: true }).last().click();
  await page.getByText('CLEARED!').first().waitFor({ timeout: 10000 }).catch(() => {});
  // 名前の窓が出ていれば閉じる（速く解いた回は窓が出ない）
  await page.getByRole('button', { name: '載せない' }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const back = page.locator('a[title="ギャラリーへ戻る"]');
  const hb = (await back.count()) === 1 ? await back.getAttribute('href') : null;
  check(hb === '/crossword', `解き終えた画面の戻る矢印は /crossword: ${hb}`);
  const tweet = page.locator('a[href*="twitter.com/intent/tweet"], a[href*="x.com/intent"]').first();
  const href = (await tweet.count()) ? await tweet.getAttribute('href') : null;
  check(Boolean(href), `解き終えた画面に「Xに投稿」がある: ${href}`);
  if (href) {
    const u = new URL(href);
    const want = `解けた！　${title}`;
    check(u.searchParams.get('text') === want, `投稿文は「${want}」: ${u.searchParams.get('text')}`);
    check(u.searchParams.get('url') === `${new URL(BASE).origin}/crossword/${ID}`, `投稿の URL は問題の URL: ${u.searchParams.get('url')}`);
    check(!/#|%23|hashtags=/.test(href), 'ハッシュタグが入っていない');
  }
  await page.screenshot({ path: `${OUT}/5-cleared.png` });
  await ctx.close();
}

await browser.close();
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
