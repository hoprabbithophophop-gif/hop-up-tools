// 【使い捨て】OGPの3構図 × 色 の絵を、1200x630 の実寸で焼く。
//
// やっていること
//   1. 構図（c1/c2/c3）に切り替える。採点の目盛りも構図ごとに切り替わる
//   2. 石の色を入れ替える
//   3. 種をたくさん引いて、出してよい姿（文字に被らない・尖りが上を向かない・
//      尖りがカードから出ない）で、かつ合格の線を越えたものだけを集める
//   4. 集めた中でいちばん点の高い種を当てて、実寸のまま撮る
//   5. 同じ絵を JPEG 品質85で2通り書き出す（本番の目安になる実寸ぶんと、見る用の幅600）
//
// 42枚を焼くときは、下の IDS を14色ぶんに差し替えて同じ台本を回す。
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
const DIR = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '');
// 前回(4色)の置き場を上書きしないよう、環境変数 OGP_COMP_OUT があればそちらへ出す。
// 省略時は道具フォルダの中の out/ogp-comp に出す。
const OUT = process.env.OGP_COMP_OUT || DIR + '/out/ogp-comp';
mkdirSync(OUT, { recursive: true });

const req = createRequire(ROOT + '/package.json');
const pw = await import(pathToFileURL(req.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;
const GL = ['--use-gl=angle', '--use-angle=default', '--ignore-gpu-blocklist'];

// 色は現役とtakaseがsrc/pages/hi-tension/data.ts、shimakuraとyamazakiは
// src/pages/hai-to-diamond/members.ts の GRADUATED_MEMBERS の値。
// 並びは src/pages/hai-to-diamond/members.ts の DIAMOND_COLOR_ORDER の14人ぶん。
// 人の名前は出さず合言葉(id)で書く
const IDS = [
  ['nishida', '#da1884'],
  ['eguchi', '#fdda24'],
  ['otsubo', '#d0df00'],
  ['sugiyama', '#e70033'],
  ['maeda', '#59cbe8'],
  ['okamura', '#F57EB6'],
  // 看板の絵だけ、名簿の #fc4c02 を黄色の側へ 16度 振った色で焼く（Hop決定 2026-09-20。赤と見分けにくいため）。
  // 名簿の色とページの中で降る石には触れない
  ['kiyono', '#df6f00'],
  ['kojima', '#ffffff'],
  ['hirai', '#582c83'],
  ['kobayashi', '#007749'],
  ['satoyoshi', '#005eb8'],
  ['shimakura', '#A05EB5'],
  ['takase', '#00c7b1'],
  ['yamazaki', '#e70033'],
];
const LAYOUTS = [['c1', '1'], ['c2', '2'], ['c3', '3']];
const SEED_BUDGET = Number(process.argv[2] ?? 4000);
const WANT_PASS = Number(process.argv[3] ?? 30);
/** 石の軸と見る向きの角度の下限（度）。実物12枚を見て、円盤に見えたのは 49〜56度、
 *  尖った形が出ていたのは 70〜85度だったので 65度で切る */
const MIN_THETA = Number(process.argv[4] ?? 65);

const pngSize = (p) => { const b = readFileSync(p); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

const browser = await chromium.launch({ args: GL });
const page = await browser.newPage({ viewport: { width: 2200, height: 1100 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(pathToFileURL(DIR + '/out/ogp-comp.bundle.html').href, { waitUntil: 'load' });
await page.waitForFunction(() => window.__studioReady === true);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1300);

const geo = await page.evaluate(() => {
  const r = document.getElementById('gs-card').getBoundingClientRect();
  return { w: r.width, h: r.height };
});
console.log('カードの実寸', geo.w + 'x' + geo.h);
if (Math.round(geo.w) !== 1200 || Math.round(geo.h) !== 630) throw new Error('実寸になっていない');

const texts = await page.evaluate(() => ({
  h1: document.querySelector('#gs-cardbox h1').textContent,
  sub: document.querySelector('#gs-cardbox p').textContent,
}));
console.log('カードの文字: 見出し', JSON.stringify(texts.h1), '／ 副題', JSON.stringify(texts.sub));

const hiNow = () => page.evaluate(() => window.__compHiDraws ?? 0);
async function waitHi(before) {
  await page.waitForFunction((b) => (window.__compHiDraws ?? 0) > b, before, { timeout: 120000 });
  await page.waitForTimeout(800);
}

async function thumb(pngPath, jpgPath, width) {
  const dim = pngSize(pngPath);
  const h = Math.round((dim.h / dim.w) * width);
  const tp = await browser.newPage({ viewport: { width: width + 40, height: h + 40 }, deviceScaleFactor: 1 });
  const b64 = readFileSync(pngPath).toString('base64');
  await tp.setContent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}img{display:block;width:${width}px;height:${h}px}</style>` +
    `<img id="t" src="data:image/png;base64,${b64}">`
  );
  await tp.waitForFunction(() => { const i = document.getElementById('t'); return i && i.complete && i.naturalWidth > 0; });
  await tp.waitForTimeout(120);
  await tp.locator('#t').screenshot({ path: jpgPath, type: 'jpeg', quality: 85 });
  await tp.close();
  return readFileSync(jpgPath).length;
}

const records = [];
// 小分け用。長く走らせると環境に落とされるので、構図と色を絞って10分以内で回す
const ONLY_L = (process.env.OGP_ONLY_LAYOUT || '').split(',').filter(Boolean);
const ONLY_I = (process.env.OGP_ONLY_IDS || '').split(',').filter(Boolean);
for (const [key, num] of LAYOUTS) {
  if (ONLY_L.length && !ONLY_L.includes(key)) continue;
  await page.evaluate((k) => window.__studioLayout.set(k), key);
  await page.waitForTimeout(900);
  if (await page.evaluate(() => window.__studioState.layout) !== key) throw new Error('構図が切り替わっていない: ' + key);
  const mark = await page.evaluate(() => window.__studioShuffle.marks().pass);
  const def = await page.evaluate(() => window.__compTune.def());
  console.log(`\n--- 構図${num}(${key}) 合格の線 ${mark} ／ 石 ${def.gem.sizePx}px 中心(${def.gem.cx},${def.gem.cy}) ／ 見出し ${def.text.h1Px ?? 72}px ---`);

  for (const [id, hex] of IDS) {
    if (ONLY_I.length && !ONLY_I.includes(id)) continue;
    await page.evaluate(({ id, hex }) => {
      const s = JSON.parse(window.__studioExport());
      s.member = { id, hex };
      window.__studioImport(JSON.stringify(s));
    }, { id, hex });
    await page.waitForTimeout(500);

    // 種を引いて、合格の線を越えたものだけ集める。
    // 構図ごとに数え始めをずらして、同じ色でも構図ごとに違う姿が出るようにする
    // 【目利き役の足し算】石の軸と見る向きの角度が MIN_THETA 度より小さい姿は外す。
    // 真上・真下から見ると、尖りの項目は通るのに絵は「面を上にした円盤」になり、
    // 一枚絵の主役としては弱い（緑と黄と白で実際に起きた）
    const salt = [...id].reduce((a, c) => a + c.charCodeAt(0), 0) * 104729 + Number(num) * 2654435761;
    const found = await page.evaluate(async ({ hex, salt, budget, want, mark, minTheta }) => {
      const d = window.__compTune.def();
      const hits = [];
      let drawn = 0, flatDropped = 0;
      for (let i = 0; i < budget; i++) {
        drawn++;
        const seed = (1 + i * 7919 + salt) >>> 0;
        // まず絵を描かずに見分ける。石の軸と見る向きの角度(theta)が小さい姿は、
        // 真上・真下から見た円盤になって尖った形が出ないので、ここで外す
        const pr = window.__studioShuffle.probe(d.gem.cx, d.gem.cy, d.gem.sizePx, seed, hex, false);
        if (!pr || pr.hits) continue;
        if (pr.theta < minTheta) { flatDropped++; continue; }
        const t = window.__studioShuffle.trial(seed, hex);
        if (!t || t.hits || t.upside || t.culetOut) continue;
        if (t.score < mark) continue;
        hits.push({ seed, score: t.score, culet: t.raw.culet, culetDown: t.raw.culetDown, theta: pr.theta, visible: pr.visible });
        if (hits.length >= want) break;
        if (i % 300 === 0) await new Promise((k) => setTimeout(k, 0));
      }
      hits.sort((a, b) => b.score - a.score);
      return { drawn, hits, flatDropped };
    }, { hex, salt, budget: SEED_BUDGET, want: WANT_PASS * 2, mark, minTheta: MIN_THETA });

    if (!found.hits.length) { console.log(`C${num}_${id}: 合格する姿が見つからなかった（${found.drawn}回引いた）`); continue; }
    // 【目利き役の足し算】採点を通った中から、底の尖りがまったく見えない姿（culet=0）も外す
    const withCulet = found.hits.filter((h) => h.culet > 0);
    const best = (withCulet.length ? withCulet : found.hits)[0];
    const culetDropped = found.hits.length - withCulet.length;

    const b0 = await hiNow();
    await page.evaluate((seed) => window.__studioShuffle.apply(seed), best.seed);
    await waitHi(b0);

    const info = await page.evaluate(() => ({
      layout: window.__studioState.layout,
      memberId: window.__studioState.member.id,
      memberHex: window.__studioState.member.hex,
      seed: window.__studioState.shuffle.seed,
      score: window.__studioState.shuffle.score,
      contrast: window.__studioState.auto.minContrastAfter,
      sideFit: window.__studioState.auto.sideFit,
      capped: window.__studioState.auto.capped,
      shielded: window.__studioState.auto.shielded,
      spritePx: window.__compTune.lastPx(),
      status: document.getElementById('gs-status').textContent,
    }));
    if (info.memberId !== id || info.seed !== best.seed) throw new Error('当てた種か色が入っていない: ' + JSON.stringify(info));

    const pngPath = `${OUT}/C${num}_${id}.png`;
    await page.locator('#gs-cardbox').screenshot({ path: pngPath });
    const dim = pngSize(pngPath);
    // 実寸のままの JPEG（本番の重さの目安）
    const fullJpg = `${OUT}/C${num}_${id}.full.jpg`;
    await page.locator('#gs-cardbox').screenshot({ path: fullJpg, type: 'jpeg', quality: 85 });
    const fullBytes = readFileSync(fullJpg).length;
    // 見る用の幅600
    const smallBytes = await thumb(pngPath, `${OUT}/C${num}_${id}.jpg`, 600);

    const rec = {
      file: `C${num}_${id}.png`, layout: key, comp: Number(num), id, hex,
      seed: best.seed, score: +best.score.toFixed(3), passMark: mark,
      drawn: found.drawn, passed: found.hits.length,
      culetZeroDropped: culetDropped, culet: +best.culet.toFixed(3), culetDown: +best.culetDown.toFixed(3),
      theta: +best.theta.toFixed(1), visible: +(best.visible * 100).toFixed(1), flatDropped: found.flatDropped,
      topScoreAll: +found.hits[0].score.toFixed(3),
      pngW: dim.w, pngH: dim.h, spritePx: info.spritePx,
      jpgFullBytes: fullBytes, jpg600Bytes: smallBytes,
      contrast: +info.contrast.toFixed(2), sideFit: +info.sideFit.toFixed(2),
      capped: info.capped, shielded: info.shielded,
    };
    records.push(rec);
    console.log(
      `C${num}_${id}: 種${rec.seed} 点${rec.score}(線${mark}) ${rec.drawn}回引いて${rec.passed}件合格` +
      `(円盤の姿${rec.flatDropped}件・尖りが見えない${rec.culetZeroDropped}件を外した／見る向き${rec.theta}度・見えている面積${rec.visible}%) ` +
      `／ ${rec.pngW}x${rec.pngH} 石の絵${rec.spritePx}px ／ JPEG実寸${(fullBytes / 1024).toFixed(0)}KB 幅600は${(smallBytes / 1024).toFixed(0)}KB ` +
      `／ 文字と背景の明るさの比 ${rec.contrast} 脇役の濃さ×${rec.sideFit}${rec.capped ? ' 頭打ち' : ''}${rec.shielded ? ' 文字まわり弱め' : ''}`
    );
  }
}

if (pageErrors.length) console.log('[ページのつまずき]', pageErrors);
const SHOTS = OUT + '/shots.' + (process.env.OGP_TAG || 'all') + '.json';
writeFileSync(SHOTS, JSON.stringify(records, null, 1));
console.log('\n記録', SHOTS, '／ 枚数', records.length);
await browser.close();
