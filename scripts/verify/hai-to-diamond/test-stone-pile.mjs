// 原石の版の「削りかすの山」と「光の粒」を、画面を使わずに単体で確かめる。
// stonePile.ts / stoneParticles.ts の純粋な部分を、そのまま import して動かす（document が無い node で落ちないことも確かめになる）。
// 使い方: どこからでも `node --experimental-strip-types scripts/verify/hai-to-diamond/test-stone-pile.mjs`
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STONE = path.join(ROOT, 'src/pages/hai-to-diamond/stone');
const pile = await import(pathToFileURL(path.join(STONE, 'stonePile.ts')).href);
const parts = await import(pathToFileURL(path.join(STONE, 'stoneParticles.ts')).href);
const tl = await import(pathToFileURL(path.join(STONE, 'stoneTimeline.ts')).href);

let ok = 0, ng = 0;
const check = (name, cond, detail) => { if (cond) ok++; else { ng++; console.log('✗', name, detail ?? ''); } };

// ── 山の高さの式
const H = 400;
const f = (n) => pile.pileHeightFor(n, H) / H;
check('n=0 で領域の 0.12（1人でも小さな山）', Math.abs(f(0) - 0.12) < 1e-9, f(0));
check('n=270,000 で領域の 0.64±0.01（約6割）', Math.abs(f(270000) - 0.64) <= 0.01, f(270000));
let mono = true, prev = -1, maxSeen = 0;
for (let e = 0; e <= 12; e += 0.05) {
  const n = Math.floor(Math.pow(10, e)) - 1;
  const v = f(n);
  if (v < prev) mono = false;
  prev = v; maxSeen = Math.max(maxSeen, v);
}
check('数が増えるほど高くなる（単調増加・0〜1兆）', mono);
check('どれだけ増えても 0.9 を越えない', maxSeen <= 0.9 && f(1e15) <= 0.9 && f(Infinity) <= 0.9, `${maxSeen} ${f(1e15)} ${f(Infinity)}`);
check('伸び方がゆるやかになる（飽和）', (f(540000) - f(270000)) < (f(270000) - f(0)), `${f(540000) - f(270000)} vs ${f(270000) - f(0)}`);
check('変な値（負・NaN）は 0 とみなす', f(-5) === f(0) && f(NaN) === f(0));

// ── 降り注ぎと山の状態（document に触らない部分）
const st = pile.createPileState();
const region = { x: 20, y: 500, w: 350, h: 260 };
pile.setPileTarget(st, 270000, region);
check('始まる前は山を描かない（進み 0・表示なし）', pile.pileGrowth(st, 1000) === 0 && pile.pileLabel(st, region, 1000) === null && !pile.pileStarted(st));
const T0 = 10000;
pile.startRain(st, T0, false);
check('降り注ぎの長さは RAIN_SEC 秒', st.rainMs === tl.RAIN_SEC * 1000, st.rainMs);
check('始まった瞬間の表示は 0個', pile.pileShownCount(st, T0) === 0 && pile.pileLabel(st, region, T0).text === '0個', pile.pileLabel(st, region, T0)?.text);
const mid = pile.pileShownCount(st, T0 + tl.RAIN_SEC * 500);
check('途中は 0 と目標の間を数え上げる', mid > 0 && mid < 270000, mid);
check('終わると目標の個数', pile.pileShownCount(st, T0 + tl.RAIN_SEC * 1000) === 270000);
check('文言は「N個」だけ（3桁区切り）', /^\d{1,3}(,\d{3})*個$/.test(pile.pileLabel(st, region, T0 + tl.RAIN_SEC * 1000).text), pile.pileLabel(st, region, T0 + tl.RAIN_SEC * 1000).text);
// 山を進めて、降っている削りかすが出る・着地する
let now = T0;
let maxRain = 0;
for (let i = 0; i < 60 * (tl.RAIN_SEC + 2); i++) {
  now += 1000 / 60;
  pile.stepPile(st, now, 1 / 60);
  maxRain = Math.max(maxRain, st.rain.items.filter((c) => c.alive).length);
}
check('降り注ぎの間に削りかすが降る', maxRain > 50, maxRain);
check('降っている削りかすは上限 700 を越えない', st.rain.items.length <= 700);
check('降り注ぎが終わると全部着地している', st.rain.items.every((c) => !c.alive));
// 表面と文字がどんな個数・領域でも領域に収まる
let inside = true, labelInside = true, detail = '';
for (const n of [0, 1, 50, 270000, 5e6, 1e12]) {
  for (const r of [region, { x: 0, y: 600, w: 390, h: 120 }, { x: 900, y: 700, w: 1400, h: 300 }, { x: 10, y: 10, w: 180, h: 60 }]) {
    const s = pile.createPileState();
    pile.setPileTarget(s, n, r);
    pile.startRain(s, 0, false);
    for (const t of [0, 1500, 3000, 6000, 9000]) {
      for (let k = 0; k <= 200; k++) {
        const x = r.x + (r.w * k) / 200;
        const y = pile.pileSurfaceY(s, r, x, t);
        if (!(y >= r.y && y <= r.y + r.h)) { inside = false; detail = `n=${n} r=${JSON.stringify(r)} t=${t} y=${y}`; }
      }
      const lab = pile.pileLabel(s, r, t);
      if (!lab || lab.y - lab.fontPx < r.y - 0.5 || lab.y > r.y + r.h || lab.fontPx < 14) { labelInside = false; detail = `label ${JSON.stringify(lab)} r=${JSON.stringify(r)}`; }
    }
  }
}
check('山の表面はどの個数・どの領域でも領域の中（てっぺん〜すそ）', inside, detail);
check('「N個」の文字は領域の中・14px以上', labelInside, detail);
const s2 = pile.createPileState();
pile.setPileTarget(s2, 0, region);
pile.startRain(s2, 0, false);
const peak = Math.min(...Array.from({ length: 101 }, (_, k) => pile.pileSurfaceY(s2, region, region.x + region.w * k / 100, 99999)));
check('n=0 でも山ができる（高さ 0.12±0.01）', Math.abs((region.y + region.h - peak) / region.h - 0.12) < 0.011, (region.y + region.h - peak) / region.h);
check('すそは床に着く（両端の高さ 0）', pile.pileSurfaceY(s2, region, region.x, 99999) === region.y + region.h && pile.pileSurfaceY(s2, region, region.x + region.w, 99999) === region.y + region.h);
// 動きを減らす設定: 粒は降らず、短時間で出来上がる。山と個数は出る
const s3 = pile.createPileState();
pile.setPileTarget(s3, 270000, region);
pile.startRain(s3, 0, true);
let t3 = 0;
for (let i = 0; i < 120; i++) { t3 += 1000 / 60; pile.stepPile(s3, t3, 1 / 60); }
check('動きを減らす設定では降る粒を出さない', s3.rain.items.length === 0);
check('動きを減らす設定では表面のきらめきを止める', s3.glints.items.length === 0);
check('動きを減らす設定でも2秒以内に山と個数が出来上がる', pile.pileGrowth(s3, 2000) === 1 && pile.pileShownCount(s3, 2000) === 270000);
pile.resetPile(s3);
check('resetPile で降り注ぎの前へ戻る', !pile.pileStarted(s3) && pile.pileLabel(s3, region, 5000) === null);

// ── 光の粒（document に触らない部分）
const view = { cx: 195, cy: 420, r: 90, rotY: 0, rotX: 0.3, bulge: 1 };
const run = (key, sec, rm = false, from = null) => {
  const p = from ?? parts.createParticleState();
  let t = 0;
  let maxStreaks = 0, maxOrb = 0, maxChips = 0;
  for (let i = 0; i < sec * 60; i++) {
    t += 1000 / 60;
    parts.updateAmbient(p, key, Math.min(1, i / (sec * 60)), view, t, 1 / 60, rm);
    parts.stepParticles(p, t, 1 / 60, rm);
    const c = parts.countParticles(p);
    maxStreaks = Math.max(maxStreaks, c.streaks); maxOrb = Math.max(maxOrb, c.orbiters); maxChips = Math.max(maxChips, c.chips);
  }
  return { p, maxStreaks, maxOrb, maxChips };
};
const a1 = run('verseA', 12), a2 = run('verseA2', 12);
check('Aメロで光の筋が出る（2本1組）', a1.maxStreaks >= 2 && a1.maxStreaks % 2 === 0, a1.maxStreaks);
const nA1 = a1.p.streaks.items.length, nA2 = a2.p.streaks.items.length;
check('2番のAメロは筋が一段多い', nA2 > nA1, `${nA1} → ${nA2}`);
const b1 = run('verseB', 12), b2 = run('verseB2', 12), ch = run('chorus', 30);
check('Bメロで回る粒が出る', b1.maxOrb === 8, b1.maxOrb);
check('2番のBメロは粒が一段多い', b2.maxOrb > b1.maxOrb, `${b1.maxOrb} → ${b2.maxOrb}`);
check('Bメロで粒が石に当たって削りかすが出る', b1.maxChips > 0, b1.maxChips);
check('サビでは粒が揃う（揃い具合 1）', ch.p.sync === 1, ch.p.sync);
check('サビでは揃って当たる（削りかすが多く出る）', ch.maxChips > b1.maxChips, `${b1.maxChips} vs ${ch.maxChips}`);
const rmA = run('verseA', 12, true), rmB = run('verseB', 12, true);
check('動きを減らす設定では筋を出さない', rmA.maxStreaks === 0);
check('動きを減らす設定では粒は止まり、当たらない', rmB.maxChips === 0 && rmB.maxOrb === 8);
const iv = run('interlude', 3, false, run('verseB', 5).p);
check('間奏に入ると回る粒は消える', parts.countParticles(iv.p).orbiters === 0);
// 削りかすの上限と古い物から捨てる
const p = parts.createParticleState();
for (let i = 0; i < 400; i++) parts.emitChips(p, 100, 100, [218, 24, 132], 5, i, 800);
check('削りかすは上限 900 を越えない', p.chips.items.length === 900 && parts.countParticles(p).chips === 900, p.chips.items.length);
check('満杯なら一番古い物から上書き（一番新しい時刻が残る）', Math.min(...p.chips.items.map((c) => c.t0)) >= 400 - 900 / 5 - 1, Math.min(...p.chips.items.map((c) => c.t0)));
const colored = p.chips.items.filter((c) => c.rgb.join(',') === '218,24,132').length;
check('当たった色と灰色がおよそ半分ずつ（奇数個の時は色が1つ多い）', colored >= 360 && colored <= 560, colored);
let tt = 400;
for (let i = 0; i < 300; i++) { tt += 1000 / 60; parts.stepParticles(p, tt, 1 / 60, false); }
check('削りかすは床に着いて全部消える', parts.countParticles(p).chips === 0);
const pr = parts.createParticleState();
parts.stepParticles(pr, 0, 0, true);
parts.emitChips(pr, 100, 100, [218, 24, 132], 5, 0, 800);
parts.emitScatter(pr, view, 40, 0, 800);
check('動きを減らす設定では削りかすを飛ばさない（一瞬のキラッだけ）', parts.countParticles(pr).chips === 0 && parts.countParticles(pr).sparks > 0);
// 放つ光
const pb = parts.createParticleState();
parts.updateAmbient(pb, 'finalChorus', 0.1, view, 0, 0, false);
parts.emitBurst(pb, [
  { x: 195, y: 380, rgb: [218, 24, 132], white: false },
  { x: 230, y: 420, rgb: null, white: true },
  { x: 160, y: 420, rgb: null, white: false },
  { x: 195, y: 420, rgb: [0, 160, 230], white: false },
], 0, false);
check('放つ光: rgb の面は帯・白は✦・どちらでもない面は出さない', parts.countParticles(pb).beams === 3 && pb.beams.items.filter((b) => b.rgb === null).length === 1);
const up = pb.beams.items.find((b) => b.x === 195 && b.y === 380);
check('帯は石の中心から外向き', up && up.uy < -0.9, up && [up.ux, up.uy]);
parts.stepParticles(pb, 3000, 0.016, false);
check('放つ光は時間で消える', parts.countParticles(pb).beams === 0);
// 光の柱
const pc = parts.createParticleState();
parts.updateRays(pc, view, 212, 0, true);
let hs = [];
for (let i = 1; i <= 240; i++) { parts.updateRays(pc, view, 212 + i / 60, i * 1000 / 60, true); hs.push(pc.rays.h); }
check('光の柱が現れる', pc.rays.alpha > 0.99, pc.rays.alpha);
check('光の柱は4秒で伸び縮みする', Math.max(...hs) - Math.min(...hs) > view.r * 1.0, `${Math.min(...hs)}..${Math.max(...hs)}`);
parts.clearParticles(pc);
check('clearParticles で全部消える', Object.values(parts.countParticles(pc)).every((v) => v === 0) && pc.rays.alpha === 0);

console.log(`確かめ ${ok + ng}件 ／ 合 ${ok} ／ 否 ${ng}`);
process.exit(ng ? 1 : 0);
