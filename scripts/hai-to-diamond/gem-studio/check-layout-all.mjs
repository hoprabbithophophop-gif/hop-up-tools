// 【使い捨て】配置の型を組み込んだあとの確かめ。
//  1. 「配置」タブが左端にあり、見本の図で選べること
//  2. 型ごとにシャッフル200回（文字に被る0・尖りが上0・線を下回る0）
//  3. 型ごとの14色の見本
//  4. 型を替えたときの連動（石・文字・にじみ・筋・採点）
//  5. JSON への型の書き出しと読み戻し
//  6. 型2・型3のにじみが、色を3〜4色置いたときに散らばるか
//  7. 幅400で「配置」タブが使えること
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, mkdirSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
const DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
const SHOT = DIR + '/out/check-layout-all';
mkdirSync(SHOT, { recursive: true });
const req = createRequire(ROOT + '/package.json');
const pw = await import(pathToFileURL(req.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;
const FILE = pathToFileURL(DIR + '/out/gem-studio.bundle.html').href;
const GL = ['--use-gl=angle', '--use-angle=default', '--ignore-gpu-blocklist'];
const NAME = { l1: '型1 左に文字・右に石', l2: '型2 中央そろえ', l3: '型3 対角' };
const IDS = [['nishida','#da1884'],['eguchi','#fdda24'],['otsubo','#d0df00'],['sugiyama','#e70033'],
 ['maeda','#59cbe8'],['okamura','#F57EB6'],['kiyono','#fc4c02'],['kojima','#ffffff'],
 ['hirai','#582c83'],['kobayashi','#007749'],['satoyoshi','#005eb8'],['shimakura','#A05EB5'],
 ['takase','#00c7b1'],['yamazaki','#e70033']];
const b = await chromium.launch({ args: GL });
const p = await b.newPage({ viewport: { width: 1480, height: 1000 } });
p.on('pageerror', (e) => console.log('[つまずき]', e.message));
await p.goto(FILE, { waitUntil: 'load' });
await p.waitForFunction(() => window.__studioReady === true);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1300);
const clip = async () => { const r = await p.locator('#gs-cardbox').boundingBox(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; };
const sheet = async (list, file, cols) => {
  const pg = await b.newPage({ viewport: { width: 1200, height: 700 } });
  await pg.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#15171c;font-family:system-ui,sans-serif}
.col{display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;padding:14px}.lab{color:#9aa0a6;font-size:11px;margin:0 0 4px;font-weight:600}img{width:100%;display:block}</style>
<div class="col">${list.map(s=>`<div><p class="lab">${s.label}</p><img src="data:image/png;base64,${readFileSync(s.path).toString('base64')}"></div>`).join('')}</div>`);
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: `${SHOT}/${file}`, fullPage: true });
  await pg.close();
};

/* ---- 1. 「配置」タブ ---- */
const tabs = await p.evaluate(() => [...document.querySelectorAll('.gs-tab')].map((t) => t.dataset.tab));
console.log('1. タブの並び', tabs.join(' / '));
if (tabs[0] !== 'place') throw new Error('「配置」タブが左端にない');
await p.locator('.gs-tab[data-tab="place"]').click();
await p.waitForTimeout(400);
const places = await p.evaluate(() => [...document.querySelectorAll('.gs-place')].map((e) => {
  const r = e.getBoundingClientRect();
  return { key: e.dataset.layout, pressed: e.getAttribute('aria-pressed'), w: Math.round(r.width), h: Math.round(r.height),
    text: e.textContent.trim(), gem: !!e.querySelector('.gs-mgem'), bars: e.querySelectorAll('.gs-mbar').length };
}));
console.log('   見本', JSON.stringify(places));
if (places.length !== 3) throw new Error('見本が3つない');
if (places.some((x) => x.text !== '')) throw new Error('見本に説明文が入っている');
if (places.some((x) => !x.gem || x.bars !== 2)) throw new Error('見本の図に石の丸か文字の帯が無い');
await p.screenshot({ path: `${SHOT}/studio_38_place_tab.png` });

/* ---- 2〜4. 型ごと ---- */
const colorSheets = {};
for (const key of ['l1', 'l2', 'l3']) {
  await p.locator(`.gs-place[data-layout="${key}"]`).click();
  await p.waitForTimeout(1000);
  const st = await p.evaluate(() => window.__studioState);
  const mk = await p.evaluate(() => window.__studioShuffle.marks());
  const boxes = await p.evaluate(() => window.__studioLayout.boxes());
  console.log(`--- ${NAME[key]} ---`);
  console.log('   石', st.gem.sizePx + 'px', '中心(' + st.gem.cx + ',' + st.gem.cy + ')',
    '／ 見出しの箱 横', Math.round(boxes[0].x), '〜', Math.round(boxes[0].x + boxes[0].w),
    '縦', Math.round(boxes[0].y), '〜', Math.round(boxes[0].y + boxes[0].h));
  console.log('   合格の線', mk.pass, '／ 尖りの下向きの重み', mk.weights.culetDown);
  if (st.layout !== key) throw new Error('型が切り替わっていない');

  // シャッフル200回
  const res = await p.evaluate(async (mark) => {
    const bad = { hits: 0, low: 0, upside: 0 }; const seeds = []; let downSum = 0;
    for (let i = 0; i < 200; i++) {
      window.__studioShuffle.once();
      const s = window.__studioState;
      const chk = window.__studioShuffle.trial(s.shuffle.seed, s.member.hex);
      if (!chk) { bad.low++; continue; }
      if (chk.hits) bad.hits++;
      if (chk.upside) bad.upside++;
      if (chk.score < mark) bad.low++;
      downSum += chk.raw.culetDown;
      seeds.push(s.shuffle.seed);
      if (i % 20 === 0) await new Promise((k) => setTimeout(k, 0));
    }
    return { bad, uniq: new Set(seeds).size, down: downSum / (seeds.length || 1) };
  }, mk.pass);
  console.log('   200回: 文字に被る', res.bad.hits, '／ 尖りが上', res.bad.upside, '／ 線を下回る', res.bad.low,
    '／ 種の重なりなし', res.uniq, '／ 出た姿の尖りの下向きの平均', res.down.toFixed(3));
  if (res.bad.hits || res.bad.low || res.bad.upside) throw new Error(NAME[key] + ' で出してはいけない結果が出た');

  // 14色の見本
  const shots = [];
  for (const [id, hex] of IDS) {
    await p.evaluate(({ id, hex }) => { const s = JSON.parse(window.__studioExport()); s.member = { id, hex }; window.__studioImport(JSON.stringify(s)); }, { id, hex });
    await p.waitForTimeout(450);
    await p.evaluate(() => window.__studioShuffle.once());
    await p.waitForTimeout(900);
    const s2 = await p.evaluate(() => window.__studioState);
    const path = `${SHOT}/colors_${key}_${id}.png`;
    await p.screenshot({ path, clip: await clip() });
    shots.push({ path, label: `${id} ／ 種 ${s2.shuffle.seed} ／ 点 ${s2.shuffle.score.toFixed(3)}` });
  }
  await sheet(shots, `studio_39_colors_${key}.png`, 3);
  colorSheets[key] = `${SHOT}/studio_39_colors_${key}.png`;
  console.log('   14色の見本', colorSheets[key]);
}

/* ---- 5. JSON の往復 ---- */
await p.locator('.gs-place[data-layout="l3"]').click();
await p.waitForTimeout(900);
const j1 = await p.evaluate(() => window.__studioExport());
await p.locator('.gs-place[data-layout="l1"]').click();
await p.waitForTimeout(700);
await p.evaluate((t) => window.__studioImport(t), j1);
await p.waitForTimeout(900);
const j2 = await p.evaluate(() => window.__studioExport());
const back = JSON.parse(j2);
console.log('5. 書き出しに型が入っている', JSON.parse(j1).layout, '／ 読み戻して同じ文字', j1 === j2 ? 'した' : 'しない',
  '／ 読み戻した型', back.layout, '／ 見本の押され方', await p.evaluate(() => document.querySelector('.gs-place.on').dataset.layout));
if (JSON.parse(j1).layout !== 'l3' || back.layout !== 'l3') throw new Error('型が書き出し・読み戻しできていない');
if (j1 !== j2) {
  const a = JSON.parse(j1), c = JSON.parse(j2);
  const walk = (x, y, path='') => {
    if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) {
      if (JSON.stringify(x) !== JSON.stringify(y)) console.log('   ちがう所', path, JSON.stringify(x), '→', JSON.stringify(y));
      return;
    }
    for (const k of new Set([...Object.keys(x||{}), ...Object.keys(y||{})])) walk(x?.[k], y?.[k], path + '/' + k);
  };
  walk(a, c);
  throw new Error('往復で設定が変わる');
}

/* ---- 6. にじみの散らばり ---- */
const glowShots = [];
for (const [key, id, hex, setKey] of [['l2','yamazaki','#e70033','o5'], ['l2','nishida','#da1884','b1'],
                                      ['l3','yamazaki','#e70033','o5'], ['l3','nishida','#da1884','b1']]) {
  // 型は見本のボタンで替える。JSON の型だけを書き換えると、石の位置は
  // 書いてある値のまま残る（保存した構図をそのまま戻すための作り）ので、
  // 人が使う道すじと同じくボタンで替える
  await p.locator(`.gs-place[data-layout="${key}"]`).click();
  await p.waitForTimeout(900);
  await p.evaluate(({ id, hex, setKey }) => {
    const s = JSON.parse(window.__studioExport());
    s.member = { id, hex };
    s.glow.set = { kind: 'group', key: setKey, ids: [], pickedIds: [], alpha: 0.22, radius: 480, seed: 1, lift: 0, mul: 1 };
    window.__studioImport(JSON.stringify(s));
  }, { id, hex, setKey });
  // 型を替えても石の向きはそのまま（決めごと）なので、人と同じくシャッフルしてから見る
  await p.evaluate(() => window.__studioShuffle.once());
  await p.waitForTimeout(1100);
  const st = await p.evaluate(() => window.__studioState);
  const am = await p.evaluate(() => window.__studioLayout.amount(1, true));
  const blobs = st.glow.blobs.filter((x) => !x.shard).slice(1);
  // にじみどうしが離れているか。いちばん近い2つの間の長さ
  let near = Infinity;
  for (let i = 0; i < blobs.length; i++) for (let j = i + 1; j < blobs.length; j++) {
    const d = Math.hypot(blobs[i].x - blobs[j].x, blobs[i].y - blobs[j].y);
    if (d < near) near = d;
  }
  const path = `${SHOT}/glow_${key}_${id}_${setKey}.png`;
  await p.screenshot({ path, clip: await clip() });
  const lab = `${NAME[key]} ／ 石 ${id} ／ にじみ ${blobs.length}色 ${blobs.map((x) => x.id).join('・')} ／ いちばん近い2つの間 ${Math.round(near)}px ／ 量 C+${am.maxDC.toFixed(4)} L+${am.maxDL.toFixed(4)} ／ 比 ${st.auto.minContrastAfter.toFixed(2)}`;
  glowShots.push({ path, label: lab });
  console.log('6.', lab);
  if (st.auto.minContrastAfter < 4.5) throw new Error('文字が読める明るさを割っている');
  const onText = await p.evaluate(() => window.__studioLayout.gemOnText());
  if (onText) throw new Error('石が文字に被っている');
}
await sheet(glowShots, 'studio_40_glow_sets.png', 2);

/* ---- 7. 幅400 ---- */
const phone = await b.newPage({ viewport: { width: 400, height: 844 }, deviceScaleFactor: 1 });
await phone.goto(FILE, { waitUntil: 'load' });
await phone.waitForFunction(() => window.__studioReady === true);
await phone.evaluate(() => document.fonts.ready);
await phone.waitForTimeout(1500);
await phone.locator('.gs-tab[data-tab="place"]').click();
await phone.waitForTimeout(400);
const ph = await phone.evaluate(() => {
  const t = document.querySelector('.gs-tab[data-tab="place"]').getBoundingClientRect();
  const ps = [...document.querySelectorAll('.gs-place')].map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), inView: r.left >= 0 && r.right <= 400 }; });
  return { tabH: Math.round(t.height), ps, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
console.log('7. 幅400: タブの高さ', ph.tabH, '／ 見本', JSON.stringify(ph.ps), '／ 横のはみ出し', ph.over);
await phone.locator('.gs-place[data-layout="l2"]').click();
await phone.waitForTimeout(1000);
const phKey = await phone.evaluate(() => window.__studioState.layout);
console.log('   幅400で型2を押したあとの型', phKey);
await phone.screenshot({ path: `${SHOT}/studio_41_place_phone.png` });
if (ph.over > 0) throw new Error('幅400で横にはみ出している');
if (phKey !== 'l2') throw new Error('幅400で型を選べない');
if (ph.ps.some((x) => !x.inView)) throw new Error('幅400で見本が画面からはみ出している');
await phone.close();
console.log('ぜんぶ通った');
await b.close();
