// iPhone の大きさと Safari と同じ仕組み（WebKit）で、クロスワードを通しで遊ぶ（2026-10-04 洗い出しの D）。
// 実機のキーボードの出方・ホーム画面に置いた時の動きは分からない。
// 回数を数える呼び出しとランキングへの送信は受け止める。丸付けと1文字見るは本物の受付係（回の記録が増える）。
// 使い方: node scripts/verify/crossword/check-iphone.mjs [サイト] [問題の番号] ['<答えの配置 JSON>'] [残すマス1 x,y] [残すマス2 x,y]
// （省略した引数は targets.json の問題から決める。答えの配置は受付係に聞いて一時置き場に控える）
import { webkit, devices } from 'playwright';
import { interceptCount, humanWaitMs, arg, outDir, puzzleArgs, BASE_DEFAULT, ID_DEFAULT } from './_lib.mjs';

const BASE = arg(2, BASE_DEFAULT);
const ID = arg(3, ID_DEFAULT);
const P = await puzzleArgs(BASE, ID, { cluesJson: arg(4), cell1: arg(5), cell2: arg(6) });
const [CELL1, CELL2] = [P.cell1, P.cell2];
const OUT = outDir('check-iphone');
const full = {};
for (const c of P.cluesJson) c.a.forEach((ch, i) => {
  full[`${c.d === 'horizontal' ? c.x + i : c.x},${c.d === 'vertical' ? c.y + i : c.y}`] = ch;
});
const almost = { ...full };
delete almost[CELL1];
delete almost[CELL2];
const label = (k) => { const [x, y] = k.split(',').map(Number); return `${y + 1}行${x + 1}列`; };

let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await interceptCount(ctx);
await ctx.route('**/api/crossword-score', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const text = () => page.evaluate(() => document.body.innerText);
const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// 1. 作る画面
await page.goto(`${BASE}/crossword/create`);
const clue = page.getByPlaceholder('例: 猫の鳴き声');
await clue.waitFor({ timeout: 20000 });
await page.waitForTimeout(2500);
check(await noSideScroll(), '作る画面: 横にはみ出さない');
await clue.tap();
await clue.fill('音大卒の伝道師');
await clue.evaluate((el) => el.setSelectionRange(3, 3));
await page.getByRole('button', { name: '○を入れる' }).tap();
check((await clue.inputValue()) === '音大卒○の伝道師' && (await clue.evaluate((el) => document.activeElement === el)), '作る画面: ○ボタンで欄が選ばれたまま位置に入る');
check((await page.getByRole('link', { name: /自分が作った問題/ }).count()) === 1, '作る画面: 自分が作った問題の入口がある');
await page.screenshot({ path: `${OUT}/iphone-1-create.png` });

// 2. 解く画面
await page.evaluate(({ id, answers }) => {
  localStorage.setItem('crossword_seen_help', 'true');
  localStorage.setItem(`crossword_progress_${id}`, JSON.stringify({ userAnswers: answers, elapsedSeconds: 0, savedAt: Date.now() }));
}, { id: ID, answers: almost });
await page.goto(`${BASE}/crossword/${ID}`);
await page.getByRole('button', { name: /1行|2行|3行/ }).first().waitFor({ timeout: 20000 });
await page.waitForTimeout(2500);
check(await noSideScroll(), '解く画面: 横にはみ出さない');
await page.screenshot({ path: `${OUT}/iphone-2-board.png` });
await page.getByRole('button', { name: `${label(CELL1)}: 空` }).tap();
await page.waitForTimeout(800);
check((await page.getByRole('button', { name: /決定/ }).count()) > 0, '解く画面: マスを押すと入力カードが出る');
await page.getByRole('button', { name: 'ヒント', exact: true }).first().tap();
await page.waitForTimeout(4000);
check((await page.locator('iframe[src*="youtube"]').count()) >= 1, '解く画面: ヒントの動画のプレイヤーが出る');
await page.screenshot({ path: `${OUT}/iphone-3-hint.png` });
await page.getByRole('button', { name: 'ヒント', exact: true }).first().tap();
await page.getByRole('button', { name: '1文字見る' }).tap();
check((await text()).includes('1文字見る？'), '解く画面: 1文字見るの確かめが出る');
await page.getByRole('button', { name: '見る', exact: true }).tap();
await page.getByRole('button', { name: `${label(CELL1)}: ${full[CELL1]}` }).waitFor({ timeout: 8000 }).catch(() => {});
check((await page.getByRole('button', { name: `${label(CELL1)}: ${full[CELL1]}` }).count()) === 1, '解く画面: 1文字見るで字が入る');
await page.getByRole('button', { name: '閉じる' }).first().tap().catch(() => {});
await page.waitForTimeout(humanWaitMs(Object.keys(full).length));
await page.getByRole('button', { name: `${label(CELL2)}: 空` }).tap();
await page.getByRole('button', { name: full[CELL2], exact: true }).last().tap();
await page.getByRole('button', { name: '載せる' }).waitFor({ timeout: 10000 }).catch(() => {});
const t = await text();
check(t.includes('CLEARED!'), '解く画面: 最後の1字で自動の答え合わせが走り、ハンコが出る');
check((await page.getByRole('button', { name: '載せる' }).count()) === 1, '解く画面: 名前を入れる窓が出る');
await page.screenshot({ path: `${OUT}/iphone-4-clear.png` });
await page.getByRole('button', { name: '載せない' }).tap();
await page.getByText('ランキング', { exact: true }).first().waitFor({ timeout: 10000 }).catch(() => {}); // 読み込みを待つ
await page.screenshot({ path: `${OUT}/iphone-4b-after.png`, fullPage: true });
const after = await text();
// 記録が0件のときは見出しを出さず「まだ記録がありません」と今回のタイムだけを出す（HarmonyPalette と同じ）
const rankShown = after.includes('ランキング') || after.includes('まだ記録がありません');
check(rankShown, `解く画面: ランキング（または「まだ記録がありません」）が出る${rankShown ? '' : ': ' + after.slice(-300).split('\n').join(' / ')}`);
check(await noSideScroll(), '終わりの画面: 横にはみ出さない');

// 3. 自分が作った問題と引き継ぎ
await page.goto(`${BASE}/crossword/mine`);
await page.getByRole('heading', { name: '自分が作った問題' }).waitFor({ timeout: 15000 });
await page.getByRole('button', { name: '合言葉を出す' }).tap();
const code = await page.locator('#transfer-code').inputValue();
check(code.startsWith('CW1-'), '引き継ぎ: 合言葉が出る');
check(await noSideScroll(), '引き継ぎ: 横にはみ出さない');
await page.screenshot({ path: `${OUT}/iphone-5-transfer.png`, fullPage: true });

// 4. 別の端末で引き継ぐ
const ctx2 = await browser.newContext({ ...devices['iPhone 13'] });
const p2 = await ctx2.newPage();
await p2.goto(`${BASE}/crossword/mine`);
await p2.getByRole('heading', { name: '自分が作った問題' }).waitFor({ timeout: 15000 });
await p2.locator('#transfer-input').fill(code);
await p2.getByRole('button', { name: '引き継ぐ' }).tap();
await p2.waitForTimeout(1000);
check((await p2.evaluate(() => document.body.innerText)).includes('引き継ぎました'), '引き継ぎ: 別の端末で読み込める');
const sameKey = (await p2.evaluate(() => localStorage.getItem('crossword_player_key'))) === (await page.evaluate(() => localStorage.getItem('crossword_player_key')));
check(sameKey, '引き継ぎ: ランキング用の番号が同じになる');
await ctx2.close();

// 5. プライバシーポリシー
await page.goto(`${BASE}/privacy`);
await page.waitForTimeout(2000);
check((await text()).includes('クロスワードで問題を作って共有した場合'), 'プライバシーポリシー: クロスワードの段落が出る');
check(errors.length === 0, `画面のエラーが無い: ${JSON.stringify(errors.slice(0, 3))}`);

await browser.close();
console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
