// 【使い捨て】「強い光の演出」が、束ねた実物にちゃんと繋がっているかを見る。
//  ① 画面に入り切り3つと 弱・中・強 が出ていて、既定が「3つとも入・中」か
//  ② 3つとも切ると、演出を足す前とまったく同じ絵か（同じ石の絵を使い回して比べる）
//  ③ つまみを押すと絵が変わるか（本当に繋がっているか）
//  ④ 書き出し→読み戻し→書き出しで文字が一致するか。項目の無い設定は3つとも切で読むか
//  ⑤ シャッフルの採点が、演出を入れても動かないか
//  ⑥ 3層の入り切りとの関係
//  ⑦ 1枚描く時間の増えと、色の処理の時間
//  ⑧ 幅400で新しい項目が画面の中に収まっているか
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
const DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
const SHOT = DIR + '/out/check-fire-wire';
mkdirSync(SHOT, { recursive: true });
const req = createRequire(ROOT + '/package.json');
const pw = await import(pathToFileURL(req.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;

const SNAP = () => Array.from(document.getElementById('gs-canvas').getContext('2d').getImageData(0, 0, 1200, 630).data);
const diff = (a, b) => { let s = 0, m = 0, n = 0; for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++) { const d = Math.abs(a[i+k] - b[i+k]); s += d; if (d > m) m = d; if (d) n++; } return { mean: s / (a.length / 4 * 3), max: m, n }; };

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=default', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1480, height: 1000 } });
p.on('pageerror', (e) => { console.log('[つまずき]', e.message); process.exitCode = 1; });
await p.goto(pathToFileURL(DIR + '/out/gem-studio.bundle.html').href, { waitUntil: 'load' });
await p.waitForFunction(() => window.__studioReady === true);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1400);
const bad = [];
const ok = (cond, msg) => { console.log((cond ? '合 ' : '✗ ') + msg); if (!cond) bad.push(msg); };

/* ① 画面に出ているか・既定 */
await p.locator('#gs-tab-shine').click();
await p.waitForTimeout(300);
const ui = await p.evaluate(() => {
  const boxes = Array.from(document.querySelectorAll('input[data-fire]')).map((i) => ({ key: i.dataset.fire, on: i.checked, label: i.closest('label').textContent.trim(), shown: i.offsetParent !== null }));
  const lv = Array.from(document.querySelectorAll('input[name="gs-fire-level"]')).map((i) => ({ v: i.value, on: i.checked, label: i.closest('label').textContent.trim(), dis: i.disabled }));
  const sec = Array.from(document.querySelectorAll('.gs-sec h2, .gs-sec h3')).map((h) => h.textContent);
  const note = Array.from(document.querySelectorAll('.gs-note')).map((n) => n.textContent).filter((t) => t.includes('作り物'));
  return { boxes, lv, sec, note };
});
console.log('  入り切り:', JSON.stringify(ui.boxes.map((x) => x.label + (x.on ? '=入' : '=切'))));
console.log('  強さ:', JSON.stringify(ui.lv.map((x) => x.label + (x.on ? '=選' : ''))));
console.log('  説明文:', JSON.stringify(ui.note));
ok(ui.boxes.length === 3 && ui.boxes.every((x) => x.on && x.shown), '入り切り3つが画面に出ていて、既定が3つとも入');
ok(ui.lv.length === 3 && ui.lv.find((x) => x.v === 'mid').on, '弱・中・強があり、既定が中');
ok(ui.lv.every((x) => !x.dis), '光の点が入なので、弱・中・強が選べる');

/* ② 3つとも切ると、足す前とまったく同じ絵か。
      同じ石の絵のまま切り替える（描き直すと描き手そのものの揺れが混ざる） */
await p.evaluate(() => window.__studioShuffle.apply(123456));
await p.waitForTimeout(1200);
const onSnap = await p.evaluate(SNAP);
await p.evaluate(() => window.__studioFire.off());
await p.waitForTimeout(700);
const offA = await p.evaluate(SNAP);
// いったん全部入れてから、また切る
await p.evaluate(() => window.__studioFire.set({ glints: true, facet: true, bloom: true, level: 'strong' }));
await p.waitForTimeout(700);
const strongSnap = await p.evaluate(SNAP);
await p.evaluate(() => window.__studioFire.off());
await p.waitForTimeout(700);
const offB = await p.evaluate(SNAP);
const dOff = diff(offA, offB);
console.log('  3つとも切った絵どうしの差 最大', dOff.max, '／ 違う点', dOff.n);
ok(dOff.max === 0, '入れてから切ると、足す前とまったく同じ絵（全点一致）');

/* ③ 本当に繋がっているか */
const dOn = diff(offA, onSnap);
const dStrong = diff(offA, strongSnap);
console.log('  切 → 既定(中) の差 平均', dOn.mean.toFixed(3), '最大', dOn.max, '／ 切 → 強 の差 平均', dStrong.mean.toFixed(3));
ok(dOn.mean > 0.5, '既定の「3つとも入」が、実物の絵に効いている');
ok(dStrong.mean > dOn.mean, '強は中より絵が変わる');
// 1つずつ
const each = {};
for (const k of ['glints', 'facet', 'bloom']) {
  await p.evaluate((k) => { window.__studioFire.off(); window.__studioFire.set({ [k]: true }); }, k);
  await p.waitForTimeout(700);
  const s = await p.evaluate(SNAP);
  each[k] = diff(offA, s);
  console.log('  ', k, 'だけ入 → 差 平均', each[k].mean.toFixed(3), '最大', each[k].max);
}
ok(['glints', 'facet', 'bloom'].every((k) => each[k].max > 2 && each[k].n > 2000), '3つとも1つずつで絵が変わる');

/* ④ 設定の受け渡し */
await p.evaluate(() => window.__studioFire.set({ glints: true, facet: true, bloom: true, level: 'weak' }));
await p.waitForTimeout(700);
const j1 = await p.evaluate(() => window.__studioExport());
await p.evaluate((t) => window.__studioImport(t), j1);
await p.waitForTimeout(900);
const j2 = await p.evaluate(() => window.__studioExport());
const lineDiff = (x, y) => { const a1 = x.split('\n'), a2 = y.split('\n'); const o = []; for (let i = 0; i < Math.max(a1.length, a2.length); i++) if (a1[i] !== a2[i]) o.push(i + ': ' + (a1[i] || '').trim() + ' → ' + (a2[i] || '').trim()); return o; };
const dj = lineDiff(j1, j2);
console.log('  シャッフルの向きからの往復で違った行（' + dj.length + '）:', JSON.stringify(dj.slice(0, 6)));
ok(JSON.stringify(JSON.parse(j1).fire) === JSON.stringify(JSON.parse(j2).fire), '演出の項目が往復で一致');
ok(JSON.parse(j1).fire && JSON.parse(j1).fire.level === 'weak', '設定の文字に演出の項目が入っている');
ok(dj.every((l) => /^(1[0-9]|2[0-9]):/.test(l)) && dj.length <= 2, '往復で動くのは石の向きの行だけ（演出は動かさない）');

// 最初の状態からの往復。ここで文字がそろうことが「往復で一致」の確かめ
await p.evaluate(() => { window.__studioImport(JSON.stringify({})); });
await p.waitForTimeout(1300);
await p.evaluate(() => window.__studioFire.set({ glints: true, facet: true, bloom: true, level: 'strong' }));
await p.waitForTimeout(900);
const k1 = await p.evaluate(() => window.__studioExport());
await p.evaluate((t) => window.__studioImport(t), k1);
await p.waitForTimeout(1100);
const k2 = await p.evaluate(() => window.__studioExport());
await p.evaluate((t) => window.__studioImport(t), k2);
await p.waitForTimeout(1100);
const k3 = await p.evaluate(() => window.__studioExport());
console.log('  最初の状態からの往復で違った行:', JSON.stringify(lineDiff(k1, k2).slice(0, 4)));
ok(k1 === k2 && k2 === k3, '書き出し→読み戻し→書き出しで文字が一致');
ok(JSON.parse(k1).fire.level === 'strong' && JSON.parse(k2).fire.level === 'strong', '強さの選びも往復で残る');
// このあとの確かめのために、もう一度さっきの絵へ戻す
await p.evaluate((t) => window.__studioImport(t), j1);
await p.waitForTimeout(1100);

// 項目の無い設定を読ませる。比べる相手は「同じ道を通って fire を切で読んだ絵」。
// 石の絵を作り直す道では描き手そのものに揺れがあるので、道をそろえて比べる
const offSt = JSON.parse(j1); offSt.fire = { glints: false, level: 'mid', facet: false, bloom: false };
await p.evaluate((t) => window.__studioImport(t), JSON.stringify(offSt));
await p.waitForTimeout(1100);
const snapOffPath = await p.evaluate(SNAP);
const oldSt = JSON.parse(j1); delete oldSt.fire;
await p.evaluate((t) => window.__studioImport(t), JSON.stringify(oldSt));
await p.waitForTimeout(1100);
const readBack = await p.evaluate(() => window.__studioFire.now());
console.log('  項目の無い設定を読んだあと:', JSON.stringify(readBack));
ok(!readBack.glints && !readBack.facet && !readBack.bloom, '項目の無い前の版の設定は、3つとも切で読む');
const uiAfter = await p.evaluate(() => Array.from(document.querySelectorAll('input[data-fire]')).map((i) => i.checked));
ok(uiAfter.every((v) => v === false), '読み戻したあと、画面のつまみも切になっている');
const lvDis = await p.evaluate(() => Array.from(document.querySelectorAll('input[name="gs-fire-level"]')).every((i) => i.disabled));
ok(lvDis, '光の点が切のとき、弱・中・強は選べない');
const snapOld = await p.evaluate(SNAP);
const dOld = diff(snapOffPath, snapOld);
console.log('  項目の無い設定を読んだ絵と、演出を切で読んだ絵の差 最大', dOld.max, '／ 違う点', dOld.n);
ok(dOld.max === 0, '項目の無い設定で、足す前の絵が戻る');

/* ⑤ シャッフルの採点が動かないか */
await p.evaluate(() => window.__studioFire.off());
await p.waitForTimeout(600);
const scOff = await p.evaluate(() => { const s = JSON.parse(window.__studioExport()); return { score: s.shuffle.score, seed: s.shuffle.seed }; });
const passOff = await p.evaluate(() => window.__studioShuffle.pass ? window.__studioShuffle.pass() : null);
await p.evaluate(() => window.__studioFire.set({ glints: true, facet: true, bloom: true, level: 'strong' }));
await p.waitForTimeout(800);
const scOn = await p.evaluate(() => { const s = JSON.parse(window.__studioExport()); return { score: s.shuffle.score, seed: s.shuffle.seed }; });
console.log('  採点 切', scOff.score, '入', scOn.score, '／ 合格の線', JSON.stringify(passOff));
ok(scOff.score === scOn.score && scOff.seed === scOn.seed, '演出を入れても、シャッフルの点数と種は動かない');
// 同じ種を引き直しても同じ点か
const reScore = await p.evaluate((seed) => { window.__studioShuffle.apply(seed); const s = JSON.parse(window.__studioExport()); return s.shuffle.score; }, scOff.seed);
await p.waitForTimeout(900);
ok(Math.abs(reScore - scOff.score) < 1e-9, '演出を入れたまま引き直しても、同じ種は同じ点');

/* ⑥ 3層との関係 */
const layerTest = {};
for (const [k, want] of [['light', false], ['gem', true]]) {
  await p.evaluate((k) => { const s = JSON.parse(window.__studioExport()); s.layers = { bg: true, gem: true, light: true }; s.layers[k] = false; window.__studioImport(JSON.stringify(s)); }, k);
  await p.waitForTimeout(900);
  const s1 = await p.evaluate(SNAP);
  await p.evaluate(() => window.__studioFire.set({ glints: false, bloom: false }));
  await p.waitForTimeout(700);
  const s2 = await p.evaluate(SNAP);
  layerTest[k] = diff(s1, s2);
  console.log('  ', k, 'を切ったとき、光の点とあふれを消すと絵が変わるか → 最大', layerTest[k].max);
  await p.evaluate(() => window.__studioFire.set({ glints: true, bloom: true }));
  await p.waitForTimeout(500);
}
ok(layerTest.light.max === 0, '「光」の層を切ると、光の点とあふれも消える');
ok(layerTest.gem.max > 0, '「石」の層を切っても、光の点とあふれは残る（光の層に寄せている）');

/* ⑦ 時間 */
await p.evaluate(() => { const s = JSON.parse(window.__studioExport()); s.layers = { bg: true, gem: true, light: true }; s.gem.sizePx = 780; window.__studioImport(JSON.stringify(s)); });
await p.waitForTimeout(1200);
const T = async (set) => {
  await p.evaluate((s) => { window.__studioFire.off(); if (s) window.__studioFire.set(s); }, set);
  await p.waitForTimeout(800);
  const dm = await p.evaluate(() => window.__studioFire.drawMs(11));
  const fm = await p.evaluate(() => window.__studioFire.fullMs(9));
  return { draw: dm.total, full: fm.total, px: fm.px };
};
const tOff = await T(null);
const tMid = await T({ glints: true, facet: true, bloom: true, level: 'mid' });
const tStrong = await T({ glints: true, facet: true, bloom: true, level: 'strong' });
await p.evaluate(() => window.__studioFire.set({ glints: true, facet: true, bloom: true, level: 'mid' }));
await p.waitForTimeout(600);
const tb = await p.evaluate(async () => { const o = []; for (let i = 0; i < 9; i++) { o.push(window.__studioFire.timeBoost()); await new Promise((r) => setTimeout(r, 80)); } return o.sort((a, b) => a - b); });
console.log('  石の絵はそのままで1枚描く時間  切', tOff.draw.toFixed(1), '→ 中', tMid.draw.toFixed(1), '（+' + (tMid.draw - tOff.draw).toFixed(1) + '）／ 強', tStrong.draw.toFixed(1), '（+' + (tStrong.draw - tOff.draw).toFixed(1) + '）');
console.log('  石から描き直して1枚できるまで  切', tOff.full.toFixed(1), '→ 中', tMid.full.toFixed(1), '（+' + (tMid.full - tOff.full).toFixed(1) + '）／ 強', tStrong.full.toFixed(1), '（+' + (tStrong.full - tOff.full).toFixed(1) + '）／ 石', tOff.px + 'px');
console.log('  色の処理 中央', tb[4].toFixed(1), 'ミリ秒 ／', tb.map((v) => v.toFixed(0)).join(','));
ok(tMid.draw - tOff.draw <= 20, '1枚描く時間の増えが +20ミリ秒以内（中）');
ok(tStrong.draw - tOff.draw <= 20, '1枚描く時間の増えが +20ミリ秒以内（強）');
ok(tb[4] <= 80, '向きを変えた時の色の処理が 80ミリ秒以内');

/* ⑧ 幅400 */
const narrow = await b.newPage({ viewport: { width: 400, height: 900 } });
await narrow.goto(pathToFileURL(DIR + '/out/gem-studio.bundle.html').href, { waitUntil: 'load' });
await narrow.waitForFunction(() => window.__studioReady === true);
await narrow.waitForTimeout(1500);
await narrow.locator('#gs-tab-shine').click();
await narrow.waitForTimeout(500);
const over = await narrow.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('input[data-fire], input[name="gs-fire-level"]')) {
    const r = el.closest('label').getBoundingClientRect();
    out.push({ t: el.closest('label').textContent.trim(), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), vis: r.width > 0 && r.height > 0 });
  }
  return { items: out, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
});
console.log('  幅400:', JSON.stringify(over.items.map((i) => i.t + '@' + i.right)), '／ 横の広がり', over.scrollW, '/', over.clientW);
ok(over.items.length === 6 && over.items.every((i) => i.vis && i.right <= 400), '幅400で、新しい項目がぜんぶ画面の中');
ok(over.scrollW <= over.clientW + 1, '幅400で横にはみ出していない');
await narrow.screenshot({ path: SHOT + '/studio_52_fire_panel_400.png', fullPage: true });
await narrow.close();

console.log('---');
if (bad.length) { console.log('通らなかった:', bad.length, '件'); bad.forEach((m) => console.log(' ✗', m)); process.exitCode = 1; }
else console.log('ぜんぶ通った');
await b.close();
