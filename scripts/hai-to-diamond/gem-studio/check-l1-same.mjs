// 【使い捨て】型1が、型を足す前と同じ絵のままかを見る。
//  ・文字の箱が、前に記録した値と同じか
//  ・型を替えて戻したとき、同じ種で絵の差が0か
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
const DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
const req = createRequire(ROOT + '/package.json');
const pw = await import(pathToFileURL(req.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;
const SNAP = () => { const d = document.getElementById('gs-canvas').getContext('2d').getImageData(0,0,1200,630).data;
  const o = []; for (let i = 0; i < d.length; i += 4*31) o.push(d[i],d[i+1],d[i+2]); return o; };
const diff = (a,b) => { let s=0,m=0; for (let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]); s+=d; if(d>m)m=d;} return {mean:s/a.length,max:m}; };
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=default','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1480, height: 1000 } });
p.on('pageerror', (e) => console.log('[つまずき]', e.message));
await p.goto(pathToFileURL(DIR + '/out/gem-studio.bundle.html').href, { waitUntil: 'load' });
await p.waitForFunction(() => window.__studioReady === true);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);
const st0 = await p.evaluate(() => window.__studioState);
const boxes = await p.evaluate(() => window.__studioLayout.boxes());
const r = (v) => Math.round(v);
console.log('最初の型', st0.layout, '／ 石', st0.gem.sizePx + 'px', '中心(' + st0.gem.cx + ',' + st0.gem.cy + ')');
console.log('見出しの箱', r(boxes[0].x), r(boxes[0].y), r(boxes[0].w), r(boxes[0].h), '／ 副題の箱', r(boxes[1].x), r(boxes[1].y), r(boxes[1].w), r(boxes[1].h));
// 型を足す前に記録してあった値（源の覚え書き「文字の箱は横 80〜660・縦 233〜396」）と突き合わせる
const want = [80, 233, 580, 86, 80, 341, 421, 55];
const got = [r(boxes[0].x), r(boxes[0].y), r(boxes[0].w), r(boxes[0].h), r(boxes[1].x), r(boxes[1].y), r(boxes[1].w), r(boxes[1].h)];
console.log('前に記録した箱と一致', JSON.stringify(got) === JSON.stringify(want) ? 'した' : 'しない ' + JSON.stringify(got));
if (st0.layout !== 'l1' || st0.gem.sizePx !== 780 || st0.gem.cx !== 970 || st0.gem.cy !== 330) throw new Error('型1の既定が変わっている');

await p.evaluate(() => window.__studioShuffle.apply(123456));
await p.waitForTimeout(1000);
const a1 = await p.evaluate(SNAP);
const j1 = await p.evaluate(() => window.__studioExport());
await p.evaluate(() => window.__studioLayout.set('l2'));
await p.waitForTimeout(800);
await p.evaluate(() => window.__studioLayout.set('l3'));
await p.waitForTimeout(800);
await p.evaluate(() => window.__studioLayout.set('l1'));
await p.waitForTimeout(800);
await p.evaluate(() => window.__studioShuffle.apply(123456));
await p.waitForTimeout(1000);
const a2 = await p.evaluate(SNAP);
const j2 = await p.evaluate(() => window.__studioExport());
const d = diff(a1, a2);
console.log('型2・型3を通って型1へ戻したとき: 絵の差 平均', d.mean.toFixed(3), '最大', d.max, '／ 設定の文字が一致', j1 === j2 ? 'した' : 'しない');
if (d.max !== 0) throw new Error('型1へ戻しても同じ絵にならない 最大' + d.max);
if (j1 !== j2) throw new Error('型1へ戻しても設定が同じにならない');
// 前の版の設定（型の項目なし）は型1として読む
const old = JSON.parse(j1); delete old.layout;
await p.evaluate((t) => window.__studioImport(t), JSON.stringify(old));
await p.waitForTimeout(900);
const back = await p.evaluate(() => window.__studioState.layout);
const a3 = await p.evaluate(SNAP);
const d3 = diff(a1, a3);
console.log('型の項目が無い設定を読ませた: 型は', back, '／ 絵の差 平均', d3.mean.toFixed(3), '最大', d3.max);
if (back !== 'l1') throw new Error('前の版の設定が型1として読まれていない');
// 書き出しのときに濃さを小数4桁で丸めているので、読み戻すと1段ぶんずれることがある。
// 前からある確かめも同じ理由で少しの幅を見ている
if (d3.max > 1) throw new Error('前の版の設定で絵が戻らない 最大' + d3.max);
console.log('通った');
await b.close();
