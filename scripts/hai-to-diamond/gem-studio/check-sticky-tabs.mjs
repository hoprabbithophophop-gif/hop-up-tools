// 【使い捨て】画面の作りの直しの確かめ。
//  1. 幅400×高さ844 で、留める部分の高さ（カード＋シャッフル＋状態＋タブの列）
//  2. 下へ送ってもカードが画面に見えたままか
//  3. ページ全体は横に動かないか／タブの列だけ横に送れるか
//  4. 各タブの中身
//  5. 留めた状態でカードをなぞると石が回るか
//  6. 左右のキーでタブを移れるか／aria-selected が付くか
//  7. 開いていないタブの中身も、読み戻しで正しく更新されているか
//  8. 最後に開いたタブを覚えているか
//  9. 広い画面
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, mkdirSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
const DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
const SHOT = DIR + '/out/check-sticky-tabs';
mkdirSync(SHOT, { recursive: true });
const req = createRequire(ROOT + '/package.json');
const pw = await import(pathToFileURL(req.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;
const FILE = pathToFileURL(DIR + '/out/gem-studio.bundle.html').href;
const GL = ['--use-gl=angle', '--use-angle=default', '--ignore-gpu-blocklist'];
const TABS = [
  ['place', '配置'], ['color', '石の色'], ['rot', '石の向き'], ['light', '光の当て方'],
  ['size', '大きさと置き場所'], ['glow', '背景のにじみ'], ['shine', 'きらめきと層'], ['io', '設定の受け渡し'],
];
const b = await chromium.launch({ args: GL });
const ctx = await b.newContext({ viewport: { width: 400, height: 844 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[つまずき]', e.message));
await p.goto(FILE, { waitUntil: 'load' });
await p.waitForFunction(() => window.__studioReady === true || window.__studioError, null, { timeout: 60000 });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1500);

/* ---- 1. 留める部分の高さ ---- */
const sizes = await p.evaluate(() => {
  const r = (id) => { const e = document.getElementById(id); const x = e.getBoundingClientRect(); return { h: Math.round(x.height), top: Math.round(x.top) }; };
  const cs = getComputedStyle(document.getElementById('gs-left'));
  return {
    left: r('gs-left'), tabs: r('gs-tabs'), card: r('gs-cardbox'),
    shuffle: Math.round(document.querySelector('.gs-shuffle').getBoundingClientRect().height),
    status: Math.round(document.querySelector('.gs-statusline').getBoundingClientRect().height),
    leftPos: cs.position, leftBg: cs.backgroundColor,
    tabsPos: getComputedStyle(document.getElementById('gs-tabs')).position,
    screen: window.innerHeight,
  };
});
const stickyH = sizes.left.h + sizes.tabs.h;
console.log('1. 留める部分の高さ', stickyH, 'px（カード', sizes.card.h, '＋シャッフル', sizes.shuffle, '＋状態', sizes.status, '＋タブの列', sizes.tabs.h, '）');
console.log('   画面の高さ', sizes.screen, 'px ／ その半分', Math.round(sizes.screen / 2), 'px ／ 留め方', sizes.leftPos, '/', sizes.tabsPos, '／ 留める部分の下地', sizes.leftBg);
if (stickyH > sizes.screen / 2) throw new Error('留める部分が画面の半分を超えている ' + stickyH);
if (sizes.shuffle < 56) throw new Error('シャッフルの列が 56px を切っている');
if (sizes.leftPos !== 'sticky' || sizes.tabsPos !== 'sticky') throw new Error('留まっていない');
if (sizes.leftBg === 'rgba(0, 0, 0, 0)') throw new Error('留める部分の下地が透けている');
await p.screenshot({ path: `${SHOT}/studio_31_phone_top.png` });

/* ---- 2. 下へ送ってもカードが見えるか ---- */
// 中身の長い項目（背景のにじみ）を開いてから送る。
// 短い項目だとページが画面に収まってしまい、送る余地がない
await p.locator('.gs-tab[data-tab="glow"]').click();
await p.waitForTimeout(400);
const room = await p.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
console.log('   （送れる余地', room, 'px）');
if (room < 200) throw new Error('送る余地が足りず、留まるかを確かめられない');
await p.evaluate(() => window.scrollTo(0, 99999));
await p.waitForTimeout(500);
const after = await p.evaluate(() => {
  const c = document.getElementById('gs-cardbox').getBoundingClientRect();
  const t = document.getElementById('gs-tabs').getBoundingClientRect();
  return { cardTop: Math.round(c.top), cardBottom: Math.round(c.bottom), tabTop: Math.round(t.top), scrolled: Math.round(window.scrollY) };
});
console.log('2.', after.scrolled, 'px 送ったあと: カードの上端', after.cardTop, '／ 下端', after.cardBottom, '／ タブの列の上端', after.tabTop);
if (after.cardTop < -2 || after.cardBottom > 844) throw new Error('送るとカードが画面から出てしまう');
if (Math.abs(after.tabTop - after.cardBottom) > 120) throw new Error('タブの列がカードのすぐ下に留まっていない');
await p.screenshot({ path: `${SHOT}/studio_32_phone_scrolled.png` });

/* ---- 3. 横の動き ---- */
const wide = await p.evaluate(() => ({
  page: document.documentElement.scrollWidth, screen: document.documentElement.clientWidth,
  tabScroll: document.getElementById('gs-tabs').scrollWidth, tabSeen: document.getElementById('gs-tabs').clientWidth,
}));
console.log('3. ページの中身の幅', wide.page, '／ 画面の幅', wide.screen, '／ タブの列は', wide.tabScroll, 'px を', wide.tabSeen, 'px の窓で見ている');
if (wide.page > wide.screen + 1) throw new Error('ページ全体が横に動く');
if (wide.tabScroll <= wide.tabSeen) throw new Error('タブの列が横に送れる状態になっていない');
// 実際に送ってみる
const moved = await p.evaluate(() => {
  const t = document.getElementById('gs-tabs');
  t.scrollLeft = 9999;
  const got = t.scrollLeft;
  t.scrollLeft = 0;
  return got;
});
console.log('   タブの列を右端まで送ったときの送り量', moved, 'px');
if (moved < 10) throw new Error('タブの列が実際には動かない');

/* ---- 4. 各タブ ---- */
await p.evaluate(() => window.scrollTo(0, 0));
await p.waitForTimeout(300);
const tabShots = [];
for (const [key, label] of TABS) {
  await p.locator(`.gs-tab[data-tab="${key}"]`).click();
  await p.waitForTimeout(350);
  const st = await p.evaluate((k) => {
    const b = document.querySelector(`.gs-tab[data-tab="${k}"]`);
    const body = document.getElementById('gs-body-' + k);
    const heads = [...body.querySelectorAll('.gs-sec h2')].map((h) => h.textContent);
    const shown = [...document.querySelectorAll('.gs-body')].filter((d) => !d.hidden).map((d) => d.id);
    const r = b.getBoundingClientRect();
    const t = document.getElementById('gs-tabs').getBoundingClientRect();
    return { sel: b.getAttribute('aria-selected'), tabIndex: b.tabIndex, heads, shown,
      seen: r.left >= t.left - 1 && r.right <= t.right + 1, btnH: Math.round(r.height) };
  }, key);
  console.log('4.', label.padEnd(9), '選択', st.sel, '／ 出ている中身', st.shown.join(','), '／ 見出し', JSON.stringify(st.heads), '／ 札の高さ', st.btnH, '／ 札が見えている', st.seen ? 'はい' : 'いいえ');
  if (st.sel !== 'true') throw new Error(label + ' の aria-selected が付いていない');
  if (st.shown.length !== 1 || st.shown[0] !== 'gs-body-' + key) throw new Error(label + ' 以外の中身も出ている');
  if (st.btnH < 40) throw new Error(label + ' の札が 40px を切っている');
  if (!st.seen) throw new Error(label + ' の札が見える位置に来ていない');
  const path = `${SHOT}/tab_${key}.png`;
  await p.screenshot({ path });
  tabShots.push({ path, label: `${label} ／ ${st.heads.join('・')}` });
}

/* ---- 5. 留めた状態でなぞって回す ---- */
await p.locator('.gs-tab[data-tab="rot"]').click();
await p.evaluate(() => window.scrollTo(0, 900));
await p.waitForTimeout(600);
const rot0 = await p.evaluate(() => JSON.stringify(window.__studioState.rotation.rows));
const box = await p.locator('#gs-card').boundingBox();
await p.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
await p.mouse.down();
await p.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.34, { steps: 12 });
await p.mouse.up();
await p.waitForTimeout(900);
const rot1 = await p.evaluate(() => JSON.stringify(window.__studioState.rotation.rows));
const scrolledStill = await p.evaluate(() => Math.round(window.scrollY));
console.log('5. 留めた状態でなぞった:', rot0 === rot1 ? '向きが変わらなかった' : '向きが変わった', '／ なぞったあとの送り位置', scrolledStill);
if (rot0 === rot1) throw new Error('留めた状態でなぞっても石が回らない');
await p.screenshot({ path: `${SHOT}/studio_33_phone_drag.png` });

/* ---- 6. 左右のキー ---- */
await p.evaluate(() => window.scrollTo(0, 0));
await p.locator('.gs-tab[data-tab="place"]').click();
await p.waitForTimeout(300);
await p.locator('.gs-tab[data-tab="place"]').focus();
await p.keyboard.press('ArrowRight');
await p.waitForTimeout(300);
const k1 = await p.evaluate(() => document.querySelector('.gs-tab[aria-selected="true"]').dataset.tab);
await p.keyboard.press('ArrowLeft');
await p.keyboard.press('ArrowLeft');
await p.waitForTimeout(300);
const k2 = await p.evaluate(() => document.querySelector('.gs-tab[aria-selected="true"]').dataset.tab);
console.log('6. 左端から右キー →', k1, '／ そこから左キー2回（端をまたぐ） →', k2);
if (k1 !== 'color') throw new Error('右キーで隣へ移れない');
if (k2 !== 'io') throw new Error('左キーで端から回り込めない');

/* ---- 7. 開いていないタブの中身も更新されるか ---- */
await p.locator('.gs-tab[data-tab="size"]').click();
await p.waitForTimeout(300);
// 大きさのつまみを見ながら、設定を読み戻す
const before7 = await p.evaluate(() => {
  const s = document.getElementById('gs-body-size').querySelectorAll('input[type=range]');
  return [...s].map((i) => i.value);
});
const changed = await p.evaluate(() => {
  const st = JSON.parse(window.__studioExport());
  st.gem.sizePx = 620; st.gem.cx = 700; st.gem.cy = 250;
  st.member = { id: 'kobayashi', hex: '#007749' };
  st.roll2dDeg = -35;
  window.__studioImport(JSON.stringify(st));
  return true;
});
await p.waitForTimeout(900);
const after7 = await p.evaluate(() => {
  const size = [...document.getElementById('gs-body-size').querySelectorAll('input[type=range]')].map((i) => i.value);
  // 「石の向き」の先頭3つのつまみは、離すと真ん中に戻る作りなので常に0。
  // 値を持っているのは「絵ごと回す」のつまみなので、札の文字で選ぶ
  const rows = [...document.getElementById('gs-body-rot').querySelectorAll('.gs-row')];
  const rollRow = rows.find((r) => (r.querySelector('label span') || {}).textContent?.includes('絵ごと回す'));
  const roll = rollRow.querySelector('input[type=range]').value;
  const sw = [...document.getElementById('gs-body-color').querySelectorAll('.gs-sw.on')].map((e) => e.textContent.trim());
  const st = window.__studioState;
  return { size, roll, sw, real: [st.gem.sizePx, st.gem.cx, st.gem.cy], realRoll: st.roll2dDeg, id: st.member.id };
});
console.log('7. 読み戻し前の大きさのつまみ', JSON.stringify(before7), '→ あと', JSON.stringify(after7.size), '（中身は', JSON.stringify(after7.real), '）');
console.log('   開いていない「石の向き」のつまみ', after7.roll, '（中身は', after7.realRoll, '）／ 開いていない「石の色」で選ばれているのは', JSON.stringify(after7.sw), '（中身は', after7.id, '）');
if (after7.size.join(',') !== after7.real.join(',')) throw new Error('大きさのつまみが中身と合っていない');
if (Number(after7.roll) !== after7.realRoll) throw new Error('開いていないタブの向きのつまみが更新されていない');
if (after7.sw.join(',') !== after7.id) throw new Error('開いていないタブの色えらびが更新されていない');

/* ---- 8. 最後に開いたタブを覚えているか ---- */
await p.locator('.gs-tab[data-tab="glow"]').click();
await p.waitForTimeout(400);
await p.reload({ waitUntil: 'load' });
await p.waitForFunction(() => window.__studioReady === true || window.__studioError, null, { timeout: 60000 });
await p.waitForTimeout(1200);
const remembered = await p.evaluate(() => document.querySelector('.gs-tab[aria-selected="true"]').dataset.tab);
console.log('8. 開き直したときに開いていたタブ', remembered);
if (remembered !== 'glow') throw new Error('最後に開いたタブを覚えていない');
await ctx.close();

/* ---- 9. 広い画面 ---- */
const wideCtx = await b.newContext({ viewport: { width: 1480, height: 1000 }, deviceScaleFactor: 1 });
const wp = await wideCtx.newPage();
await wp.goto(FILE, { waitUntil: 'load' });
await wp.waitForFunction(() => window.__studioReady === true || window.__studioError, null, { timeout: 60000 });
await wp.evaluate(() => document.fonts.ready);
await wp.waitForTimeout(1500);
const wideInfo = await wp.evaluate(() => {
  const l = document.getElementById('gs-left').getBoundingClientRect();
  const r = document.getElementById('gs-panel').getBoundingClientRect();
  return { leftLeft: Math.round(l.left), leftRight: Math.round(l.right), panelLeft: Math.round(r.left),
    leftPos: getComputedStyle(document.getElementById('gs-left')).position,
    tabs: document.querySelectorAll('.gs-tab').length,
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
console.log('9. 広い画面: カードの欄', wideInfo.leftLeft, '〜', wideInfo.leftRight, '／ 操作盤の左端', wideInfo.panelLeft, '／ 留め方', wideInfo.leftPos, '／ タブ', wideInfo.tabs, '枚 ／ 横のはみ出し', wideInfo.over);
if (wideInfo.panelLeft < wideInfo.leftRight) throw new Error('広い画面で2列になっていない');
if (wideInfo.over > 0) throw new Error('広い画面で横にはみ出している');
await wp.screenshot({ path: `${SHOT}/studio_34_wide.png` });
await wideCtx.close();

/* ---- 見くらべの1枚 ---- */
const sheet = await b.newPage({ viewport: { width: 1200, height: 700 } });
await sheet.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#15171c;font-family:system-ui,sans-serif}
.col{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:14px}.lab{color:#9aa0a6;font-size:11px;margin:0 0 4px;font-weight:600}img{width:100%;display:block}</style>
<div class="col">${tabShots.map(s=>`<div><p class="lab">${s.label}</p><img src="data:image/png;base64,${readFileSync(s.path).toString('base64')}"></div>`).join('')}</div>`);
await sheet.waitForTimeout(400);
await sheet.screenshot({ path: `${SHOT}/studio_35_tabs.png`, fullPage: true });
console.log('ぜんぶ通った');
await b.close();
