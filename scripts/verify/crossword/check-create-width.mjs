// 作る画面の4段（1 答え・2 盤・3 カギ・4 共有の窓）とヒントの窓が、画面の幅ごとに画面に収まるかを測ってスクショを撮る。
// 2026-10-21 に4段の流れに合わせて書き直した（前は1語ずつの欄のまとまりだけを測っていた）。
// 行き先の画面を読むだけで、棚にも受付係にも書かない（組み合わせ探しはブラウザの中だけで動く。保存は押さない）。
// 使い方: node scripts/verify/crossword/check-create-width.mjs [サイト] [スクショの置き場]（省略時は targets.json と一時置き場）
import { chromium } from 'playwright';
import { arg, outDir, BASE_DEFAULT, guardWrites, watchStumbles } from './_lib.mjs';
import { writeLines, hintMode, openHintSheet, closeHintSheet, setLinkHint, toBoard, toClues, hintAllInClues, openShare } from './_create.mjs';

const BASE = arg(2, BASE_DEFAULT);
const OUT = outDir('check-create-width', process.argv[3]);
let fail = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}`);
  if (!ok) fail++;
};
// 640px の白い面（作る画面の本体）が画面に収まり、ページが横にはみ出していないか
const measure = (page) => page.evaluate(() => {
  const p = document.querySelector('[data-create-step]')?.closest('.max-w-\\[640px\\]');
  const r = p?.getBoundingClientRect();
  const sheet = document.querySelector('[data-hint-sheet], [data-share-sheet]')?.getBoundingClientRect();
  return {
    panel: r ? { left: Math.round(r.left), width: Math.round(r.width), right: Math.round(window.innerWidth - r.right) } : null,
    sheet: sheet ? { left: Math.round(sheet.left), right: Math.round(window.innerWidth - sheet.right) } : null,
    noSide: document.documentElement.scrollWidth <= window.innerWidth + 1,
  };
});
const fits = (m, withSheet) => !!m.panel && m.panel.left >= 0 && m.panel.right >= 0 && m.noSide && (!withSheet || (!!m.sheet && m.sheet.left >= 0 && m.sheet.right >= 0));

const browser = await chromium.launch();
// 行き先への書き込み（受け止め役が無いので、受付係・棚への書き込みは全部）を見張り役が断って控える（2026-10-21）
const writes = [];
// 画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）を控える（2026-10-21）
const stumbles = [];
for (const w of [390, 960, 1280]) {
  const wctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  await guardWrites(wctx, writes, BASE);
  const page = await wctx.newPage();
  await watchStumbles(page, stumbles, `幅 ${w}px`);
  await page.goto(`${BASE}/crossword/create`);
  await page.locator('[data-bulk-text]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const shot = async (name) => page.screenshot({ path: `${OUT}/create-width-${w}-${name}.png` });
  const at = async (name, withSheet = false) => {
    const m = await measure(page);
    check(fits(m, withSheet), `幅 ${w}px・${name}: 画面に収まり横にはみ出さない ${JSON.stringify(m)}`);
    await shot(name);
  };
  await at('1-empty');
  await writeLines(page, 'ニャーと鳴く動物→【ネコ】\n【コアラ】はユーカリを食べる\n【ラッコ】は貝を割って食べる');
  await at('1-write');
  await hintMode(page);
  await at('1-hint');
  await openHintSheet(page, 'ネコ');
  await at('hint-sheet', true);
  await page.locator('[data-hint-sheet] [data-hint-source="ameblo"]').click();
  await page.waitForTimeout(200);
  await at('hint-sheet-ameblo', true);
  await setLinkHint(page, 'https://example.com/neko');
  await closeHintSheet(page);
  await toBoard(page);
  await at('2-board');
  await toClues(page);
  await at('3-clues');
  await hintAllInClues(page);
  await openShare(page);
  await at('4-share', true);
  await page.context().close();
}
await browser.close();
check(stumbles.length === 0, `画面のつまずき（JS の例外・React の描画の誤り・エラー時の画面）が無い${stumbles.length ? '：' + stumbles.slice(0, 3).join(' / ') : ''}`);
check(writes.length === 0, `行き先への書き込みは0件（見張り役が断った通信: ${writes.length}件${writes.length ? ' ' + writes.join(' , ') : ''}）`);
console.log(fail ? `NG ${fail}件` : 'すべてOK', OUT);
process.exit(fail ? 1 : 0);
