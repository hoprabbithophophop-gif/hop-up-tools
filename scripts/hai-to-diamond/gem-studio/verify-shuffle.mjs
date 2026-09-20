// 【使い捨て】シャッフルの確かめ
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, mkdirSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
const DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
const SHOT = DIR + '/out/verify-shuffle';
mkdirSync(SHOT, { recursive: true });
const req = createRequire(ROOT + '/package.json');
const pw = await import(pathToFileURL(req.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;
const IDS = [['nishida','#da1884'],['eguchi','#fdda24'],['otsubo','#d0df00'],['sugiyama','#e70033'],
 ['maeda','#59cbe8'],['okamura','#F57EB6'],['kiyono','#fc4c02'],['kojima','#ffffff'],
 ['hirai','#582c83'],['kobayashi','#007749'],['satoyoshi','#005eb8'],['shimakura','#A05EB5'],
 ['takase','#00c7b1'],['yamazaki','#e70033']];
const SNAP = () => { const d = document.getElementById('gs-canvas').getContext('2d').getImageData(0,0,1200,630).data;
  const o = []; for (let i = 0; i < d.length; i += 4*97) o.push(d[i],d[i+1],d[i+2]); return o; };
const diff = (a,b) => { let s=0,m=0; for (let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]); s+=d; if(d>m)m=d;} return {mean:s/a.length,max:m}; };
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=default','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1480, height: 1000 } });
p.on('pageerror', (e) => console.log('[つまずき]', e.message));
await p.goto(pathToFileURL(DIR + '/out/gem-studio.bundle.html').href, { waitUntil: 'load' });
await p.waitForFunction(() => window.__studioReady === true);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1000);
const mark = await p.evaluate(() => window.__studioShuffle.marks().pass);
console.log('合格の線', mark);

// 1. 同じ種で同じ絵になるか
await p.evaluate(() => window.__studioShuffle.apply(123456));
await p.waitForTimeout(900);
const s1 = await p.evaluate(SNAP);
const j1 = await p.evaluate(() => window.__studioExport());
await p.evaluate(() => window.__studioShuffle.apply(999999));
await p.waitForTimeout(900);
await p.evaluate(() => window.__studioShuffle.apply(123456));
await p.waitForTimeout(900);
const s2 = await p.evaluate(SNAP);
const j2 = await p.evaluate(() => window.__studioExport());
const d1 = diff(s1, s2);
console.log('1. 同じ種で戻したとき 絵の差 平均', d1.mean.toFixed(3), '最大', d1.max, '／ 設定の文字が一致', j1 === j2 ? 'した' : 'しない');
if (d1.max !== 0) throw new Error('同じ種なのに絵が違う');
if (j1 !== j2) throw new Error('同じ種なのに設定が違う');

// 2. シャッフル200回。文字に掛かるもの・線を下回るものが出ないか
const res = await p.evaluate(async (mark) => {
  const bad = { hits: 0, low: 0, upside: 0, culetOut: 0 }; const times = []; const tries = [];
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    window.__studioShuffle.once();
    times.push(performance.now() - t0);
    const st = window.__studioState;
    const chk = window.__studioShuffle.trial(st.shuffle.seed, st.member.hex);
    if (!chk) { bad.low++; continue; }
    if (chk.hits) bad.hits++;
    if (chk.upside) bad.upside++;
    if (chk.culetOut) bad.culetOut++;
    if (chk.score < mark) bad.low++;
    tries.push(st.shuffle.seed);
    if (i % 20 === 0) await new Promise((k) => setTimeout(k, 0));
  }
  times.sort((a, c) => a - c);
  return { bad, med: times[100], p90: times[180], max: times[199], uniq: new Set(tries).size };
}, mark);
console.log('2. 200回: 文字に掛かった', res.bad.hits, '件 ／ 尖りが水平より上', res.bad.upside, '件 ／ 尖りがカードの外', res.bad.culetOut, '件 ／ 線を下回った', res.bad.low, '件 ／ 種の重なりなし', res.uniq);
console.log('   1回にかかった時間 中央', res.med.toFixed(0), 'ミリ秒 ／ 上位1割', res.p90.toFixed(0), '／ 最長', res.max.toFixed(0));
if (res.bad.hits || res.bad.low || res.bad.upside || res.bad.culetOut) throw new Error('出してはいけない結果が混ざった');

// 3. 1つ前に戻る
await p.evaluate(() => window.__studioShuffle.apply(555));
await p.waitForTimeout(800);
const before = await p.evaluate(SNAP);
await p.evaluate(() => window.__studioShuffle.once());
await p.waitForTimeout(800);
await p.evaluate(() => window.__studioShuffle.back());
await p.waitForTimeout(900);
const back = await p.evaluate(SNAP);
const d3 = diff(before, back);
console.log('3. 1つ前に戻る: 絵の差 平均', d3.mean.toFixed(3), '最大', d3.max);
if (d3.max > 2) throw new Error('1つ前に戻れていない');

// 4. 14色ぶんの見本
const shots = [];
for (const [id, hex] of IDS) {
  await p.evaluate(({ id, hex }) => { const s = JSON.parse(window.__studioExport()); s.member = { id, hex }; window.__studioImport(JSON.stringify(s)); }, { id, hex });
  await p.waitForTimeout(500);
  await p.evaluate(() => window.__studioShuffle.once());
  await p.waitForTimeout(900);
  const st = await p.evaluate(() => window.__studioState);
  const r = await p.locator('#gs-cardbox').boundingBox();
  const path = `${SHOT}/shuffle_${id}.png`;
  await p.screenshot({ path, clip: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } });
  shots.push({ path, label: `${id} ／ 種 ${st.shuffle.seed} ／ 点 ${st.shuffle.score.toFixed(3)}` });
}
const pg = await b.newPage({ viewport: { width: 1200, height: 700 } });
await pg.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#15171c;font-family:system-ui,sans-serif}
.col{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:14px}.lab{color:#9aa0a6;font-size:11px;margin:0 0 4px;font-weight:600}img{width:100%;display:block}</style>
<div class="col">${shots.map(s=>`<div><p class="lab">${s.label}</p><img src="data:image/png;base64,${readFileSync(s.path).toString('base64')}"></div>`).join('')}</div>`);
await pg.waitForTimeout(400);
await pg.screenshot({ path: `${SHOT}/studio_19_shuffle_colors.png`, fullPage: true });
await pg.close();

// 5. 細い画面でボタンが押しやすいか
const phone = await b.newPage({ viewport: { width: 400, height: 900 } });
await phone.goto(pathToFileURL(DIR + '/out/gem-studio.bundle.html').href, { waitUntil: 'load' });
await phone.waitForFunction(() => window.__studioReady === true);
await phone.waitForTimeout(1200);
const sz = await phone.evaluate(() => {
  const a = document.getElementById('gs-shuffle').getBoundingClientRect();
  const c = document.getElementById('gs-back').getBoundingClientRect();
  return { シャッフル: [Math.round(a.width), Math.round(a.height)], 戻る: [Math.round(c.width), Math.round(c.height)],
    横はみ出し: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
console.log('5. 細い画面のボタン', JSON.stringify(sz));
await phone.screenshot({ path: `${SHOT}/studio_20_shuffle_phone.png` });
await phone.close();
if (sz.シャッフル[1] < 44 || sz.戻る[1] < 44) throw new Error('ボタンが小さすぎる');
if (sz.横はみ出し > 0) throw new Error('細い画面で横にはみ出している');
console.log('ぜんぶ通った');
await b.close();
