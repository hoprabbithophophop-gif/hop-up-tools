// 作る画面の組み立て（src/lib/crossword/engine.ts）を、本物のファイルのまま動かして確かめる。
// (a) 1回の試行の中で置けなかった語を試し直すので、「出来上がった盤にそのまま置けるのに置けなかった」見落としが無い
// (b) 置けた語の数が増える（Hop の10語・全部置ける15語）
// (c) 本気の探索は時間の上限で止まる・全部置けたらすぐ止まる
// ts は Node の node:module の stripTypeScriptTypes で型だけ外し、一時置き場に .mjs として書いて読み込む（論理は写さない）。
// 使い方: node scripts/verify/crossword/check-build.mjs（引数なし。通信しない・保存しない）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { performance } from 'node:perf_hooks';
import { ROOT, outDir } from './_lib.mjs';

const dir = outDir('check-build');
for (const name of ['types', 'engine']) {
  const src = readFileSync(path.join(ROOT, 'src', 'lib', 'crossword', `${name}.ts`), 'utf8');
  writeFileSync(path.join(dir, `${name}.mjs`), stripTypeScriptTypes(src).replace(/from '\.\/(types)'/g, "from './$1.mjs'"));
}
const e = await import(pathToFileURL(path.join(dir, 'engine.mjs')).href + `?t=${Date.now()}`);
const { tryPlaceAll, shuffleByLength, findPlacement, buildGrid, generateMonteCarloSteps, createPuzzleSearch, SEARCH_TIME_LIMIT_MS } = e;

let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
const W = (w) => ({ id: w, question: '', answer: Array.from(w) });
const HOP10 = ['オレンジ', 'ライト', 'ホット', 'ミディアム', 'コジマハナ', 'スギヤマ', 'コバヤシ', 'エグチサヤ', 'ヒライミヨ', 'マエダ'];
// 全部置ける15語（20語から組んだ盤に載った15語）
const OK15 = ['コンサートホール', 'ファンクラブ', 'レコード', 'ハーモニー', 'チケット', 'アンコール', 'ライブ', 'センター', 'ステージ', 'コーラス', 'ダンス', 'タオル', 'サイン', 'ハマグチ', 'マツリ'];

// 盤に置けなかった語のうち、出来上がった盤にそのまま置ける（見落とし）語の数
const missedButFits = (items, placed) => {
  const on = new Set(placed.map((p) => p.id));
  return items.filter((i) => !on.has(i.id) && findPlacement(i, placed)).length;
};

// 作る画面の演出と同じ選び方: 50回組んで、置けた語が最多・同じなら面積が最小
const bestOf50 = (items, retry) => {
  let best = [], bestArea = Infinity;
  for (let a = 0; a < 50; a++) {
    const p = tryPlaceAll(shuffleByLength(items), retry);
    if (!p.length) continue;
    const g = buildGrid(p);
    const area = g.width * g.height;
    if (p.length > best.length || (p.length === best.length && area < bestArea)) { best = p; bestArea = area; }
  }
  return best;
};

// ---- (a) 見落とし ----
for (const [name, words] of [['Hop の10語', HOP10], ['全部置ける15語', OK15]]) {
  const items = words.map(W);
  const N = 3000;
  let oldMiss = 0, newMiss = 0, sameOrderFixed = 0, sameOrderN = 0;
  for (let t = 0; t < N; t++) {
    const order = shuffleByLength(items);
    const o = tryPlaceAll(order, false);
    if (missedButFits(items, o) > 0) {
      oldMiss++;
      // 見落としが起きた並びと同じ並びで、新しい作りを試す
      sameOrderN++;
      if (missedButFits(items, tryPlaceAll(order, true)) === 0) sameOrderFixed++;
    }
    if (missedButFits(items, tryPlaceAll(shuffleByLength(items), true)) > 0) newMiss++;
  }
  console.log(`(a) ${name}: 1回の試行 ${N}回のうち、置けなかった語が出来上がった盤にそのまま置けた回 旧 ${oldMiss}回 → 新 ${newMiss}回`);
  check(newMiss === 0, `(a) ${name}: 新しい作りでは、1回の試行の見落としが 0（${N}回中 ${newMiss}回）`);
  check(sameOrderN === 0 || sameOrderFixed === sameOrderN, `(a) ${name}: 旧で見落とした並びと同じ並びを新しい作りで組むと、見落としが無くなる ${sameOrderFixed}/${sameOrderN}`);
  // 作る画面と同じ「50回組んで一番良い物」で、前に見つけた 300回中1回 の形を数え直す
  const R = 300;
  let oldBestMiss = 0, newBestMiss = 0;
  for (let r = 0; r < R; r++) {
    const ob = bestOf50(items, false);
    if (missedButFits(items, ob) > 0) oldBestMiss++;
    const nb = bestOf50(items, true);
    if (missedButFits(items, nb) > 0) newBestMiss++;
  }
  console.log(`(a) ${name}: 50回組んで一番良い盤を${R}回: 見落としがあった回 旧 ${oldBestMiss}回 → 新 ${newBestMiss}回`);
  check(newBestMiss === 0, `(a) ${name}: 50回組んで一番良い盤でも、新しい作りでは見落とし 0（${R}回中 ${newBestMiss}回）`);
}

// ---- (b) 置けた語の数 ----
const letters = (ws) => new Set(ws.flatMap((w) => Array.from(w)));
{
  const items = HOP10.map(W);
  const R = 10; // 本気の探索は全部置けない組だと毎回上限まで回るので、回数を絞る
  const oldUn = [], newUn = [];
  for (let r = 0; r < R; r++) {
    oldUn.push(items.length - bestOf50(items, false).length);
    const s = createPuzzleSearch(items);
    while (!s.finished()) s.step(30);
    newUn.push(items.length - s.best().length);
  }
  const dist = (a) => JSON.stringify(a.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {}));
  console.log(`(b) Hop の10語: 置けなかった語の数（回数） 旧（演出の50回） ${dist(oldUn)} → 新（本気の探索 ${SEARCH_TIME_LIMIT_MS}ms） ${dist(newUn)}`);
  // 毎回置けない4語は、残り6語とどの字も共有しない（交差する相手が無い）
  const four = ['ライト', 'ホット', 'ミディアム', 'ヒライミヨ'];
  const six = HOP10.filter((w) => !four.includes(w));
  const shared = [...letters(four)].filter((c) => letters(six).has(c));
  console.log(`    ライト・ホット・ミディアム・ヒライミヨ の字 ${[...letters(four)].join('')} と、残り6語の字 ${[...letters(six)].join('')} で共通する字: ${shared.length ? shared.join('') : '無し'}`);
  check(shared.length === 0, '(b) Hop の10語の4語は、残り6語と共通の字が無い（どう並べても1つの盤につながらない）');
  check(Math.max(...newUn) <= Math.min(...oldUn), `(b) Hop の10語: 新しい作りの置けなかった語は、旧より多くならない（新の最大 ${Math.max(...newUn)} ／ 旧の最小 ${Math.min(...oldUn)}）`);
}
{
  const items = OK15.map(W);
  const R = 100;
  let oldAll = 0, newAll = 0;
  for (let r = 0; r < R; r++) {
    if (bestOf50(items, false).length === items.length) oldAll++;
    const s = createPuzzleSearch(items);
    while (!s.finished()) s.step(30);
    if (s.allPlaced()) newAll++;
  }
  console.log(`(b) 全部置ける15語: 全部置けた回 旧（演出の50回） ${oldAll}/${R} → 新（本気の探索） ${newAll}/${R}`);
  check(newAll === R && newAll >= oldAll, `(b) 全部置ける15語: 新しい作りは毎回全部置ける ${newAll}/${R}`);
  // 全部置けるまでに要った試行回数と時間（上限を決めた分布）
  const trials = [], times = [];
  for (let r = 0; r < 200; r++) {
    const t0 = performance.now();
    for (let a = 1; a <= 3000; a++) if (tryPlaceAll(shuffleByLength(items)).length === items.length) { trials.push(a); times.push(performance.now() - t0); break; }
  }
  const q = (a) => { const s = [...a].sort((x, y) => x - y); return `中央値 ${s[Math.floor(s.length / 2)].toFixed(1)}・90% ${s[Math.floor(s.length * 0.9)].toFixed(1)}・最大 ${s.at(-1).toFixed(1)}`; };
  console.log(`    全部置けるまでの試行回数（200回・Node）: ${q(trials)} ／ 時間ms: ${q(times)}`);
  check(trials.length === 200, `(b) 全部置ける15語: 200回とも3000試行以内に全部置けた ${trials.length}/200`);
}

// ---- (c) 時間の上限 ----
{
  const LIMIT = 300;
  const s = createPuzzleSearch(HOP10.map(W), LIMIT);
  const t0 = performance.now();
  let steps = 0;
  while (!s.finished()) { s.step(30); steps++; }
  const wall = performance.now() - t0;
  check(!s.allPlaced() && s.elapsedMs() >= LIMIT && wall < LIMIT + 60, `(c) 全部は置けない語の組: 上限 ${LIMIT}ms で止まる（経過 ${wall.toFixed(0)}ms・刻み ${steps}回・試行 ${s.attempts()}回）`);
  check(s.best().length === 6, `(c) 止まった時は置けた語が最多の盤を持つ: ${s.best().length}語`);
  const s2 = createPuzzleSearch(OK15.map(W), 10000);
  const t1 = performance.now();
  while (!s2.finished()) s2.step(30);
  check(s2.allPlaced() && performance.now() - t1 < 1000, `(c) 全部置ける語の組: 全部置けた時点で止まる（${(performance.now() - t1).toFixed(0)}ms・試行 ${s2.attempts()}回）`);
  const s3 = createPuzzleSearch([], 1000);
  check(s3.finished(), '(c) 語が無い時は始めから終わっている');
  check(SEARCH_TIME_LIMIT_MS === 2000, `(c) 作る画面の上限: ${SEARCH_TIME_LIMIT_MS}ms`);
}

// ---- (d) 同じ向きの語が端で1字重なる置き方は出ない（2026-10-06 レビューの直し） ----
// 同じ向きの語が2つ通るマスがあるか
const sameDirOverlap = (placed) => {
  const seen = new Set();
  for (const it of placed) for (let i = 0; i < it.length; i++) {
    const k = `${it.direction}:${it.direction === 'horizontal' ? it.startX + i : it.startX},${it.direction === 'vertical' ? it.startY + i : it.startY}`;
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
};
{
  const P = (w, direction, startX, startY) => ({ ...W(w), uuid: `u-${w}`, direction, startX, startY, length: Array.from(w).length });
  // 盤 アイウ 横(0,0)・ウオ 縦(2,0)。ウキ を横 (2,0) に置くと、ウ のマスで ウオ と交わりつつ アイウ の端に重なり「アイウキ」の1本になる
  const board = [P('アイウ', 'horizontal', 0, 0), P('ウオ', 'vertical', 2, 0)];
  check(!e.validatePlacement(P('ウキ', 'horizontal', 2, 0), board), '(d) 横の語の端に、同じ横の語を1字重ねる置き方は断る（ウキ を (2,0) へ）');
  check(!e.validatePlacement(P('オク', 'vertical', 2, 1), board.concat([P('キオ', 'horizontal', 1, 1)])), '(d) 縦の語の端に、同じ縦の語を1字重ねる置き方は断る（オク を (2,1) へ）');
  check(e.validatePlacement(P('イカ', 'vertical', 1, 0), board), '(d) 逆の向きで1マス交わる普通の置き方は通る（イカ を縦 (1,0) へ）');
  check(findPlacement(W('ウキ'), board) === null, '(d) findPlacement も同じ判定を通る: ウキ はこの盤のどこにも置けない（旧は アイウ の端に重ねて置けた）');
  // 少ない字で作った語の組で、組み立て・本気の探索のどれでも重なりが出ない
  const ALPHA = Array.from('アイウエオカ');
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const word = () => Array.from({ length: 2 + Math.floor(rnd() * 4) }, () => ALPHA[Math.floor(rnd() * ALPHA.length)]).join('');
  let runs = 0, bad = 0, searchBad = 0;
  for (let r = 0; r < 300; r++) {
    const ws = [...new Set(Array.from({ length: 8 }, word))].map(W);
    for (let t = 0; t < 10; t++) {
      runs++;
      if (sameDirOverlap(tryPlaceAll(shuffleByLength(ws)))) bad++;
    }
    if (r % 30 === 0) {
      const s = createPuzzleSearch(ws, 100);
      while (!s.finished()) s.step(30);
      if (sameDirOverlap(s.best())) searchBad++;
    }
  }
  check(bad === 0 && searchBad === 0, `(d) 6字だけで作った語の組を ${runs}回組んで、同じ向きの語が重なるマスのある盤は ${bad}回・本気の探索 ${searchBad}回`);
}

// 演出の50回はそのまま
{
  let n = 0;
  for (const st of generateMonteCarloSteps(OK15.map(W), 50)) if (!st.isLast) n++;
  check(n === 50, `演出の描き変えは50回のまま: ${n}回`);
}

console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
