// 作る画面の「型の案内」（src/lib/crossword/suggest.ts）を、本物のファイルのまま動かして確かめる。
// ts は Node の node:module の stripTypeScriptTypes で型だけ外し、一時置き場に .mjs として書いて読み込む（論理は写さない）。
// 使い方: node scripts/verify/crossword/check-suggest.mjs（引数なし。通信しない・保存しない）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { performance } from 'node:perf_hooks';
import { ROOT, outDir } from './_lib.mjs';

const dir = outDir('check-suggest');
const load = (name) => {
  const src = readFileSync(path.join(ROOT, 'src', 'lib', 'crossword', `${name}.ts`), 'utf8');
  const js = stripTypeScriptTypes(src).replace(/from '\.\/(engine|types)'/g, "from './$1.mjs'");
  const file = path.join(dir, `${name}.mjs`);
  writeFileSync(file, js);
  return file;
};
load('types');
load('engine');
const stamp = `?t=${Date.now()}`;
const engine = await import(pathToFileURL(path.join(dir, 'engine.mjs')).href + stamp);
const suggestFile = load('suggest');
const sg = await import(pathToFileURL(suggestFile).href + stamp);
const { buildGrid, validatePlacement, findPlacement, generateMaximizedPuzzle } = engine;
const { suggestShapes, formatShape, boardScore, currentBoardScore, shapeKey } = sg;

let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};

const chars = (w) => Array.from(w);
const item = (word, direction, startX, startY, id = word) => ({
  id, question: '', uuid: id, answer: chars(word), direction, startX, startY, length: chars(word).length,
});
const cellMap = (items) => {
  const m = new Map();
  for (const it of items) for (let i = 0; i < it.length; i++) {
    const x = it.direction === 'horizontal' ? it.startX + i : it.startX;
    const y = it.direction === 'vertical' ? it.startY + i : it.startY;
    m.set(`${x},${y}`, it.answer[i]);
  }
  return m;
};
const bbox = (items) => {
  const m = cellMap(items);
  const xs = [...m.keys()].map((k) => +k.split(',')[0]);
  const ys = [...m.keys()].map((k) => +k.split(',')[1]);
  return { w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1, filled: m.size };
};
// 案内の型を、空きに「ヲ」を入れた実際の語にして盤に足した形
const asItem = (s, fill = 'ヲ') => {
  const answer = Array.from({ length: s.length }, (_, i) => s.fixed.find((f) => f.index === i)?.char ?? fill);
  return { id: 'cand', question: '', uuid: 'cand', answer, direction: s.direction, startX: s.startX, startY: s.startY, length: s.length };
};

// 全候補に共通の確かめ（置ける・点数が上がる・決まっている字が盤と一致する・buildGrid で組んでも同じ点数）
function checkAll(label, items, list) {
  const base = currentBoardScore(items);
  const cells = cellMap(items);
  let place = 0, up = 0, chars = 0, grid = 0, engineFinds = 0;
  for (const s of list) {
    const cand = asItem(s);
    if (validatePlacement(cand, items)) place++;
    if (s.score > base) up++;
    if (s.fixed.every((f) => {
      const x = s.direction === 'horizontal' ? s.startX + f.index : s.startX;
      const y = s.direction === 'vertical' ? s.startY + f.index : s.startY;
      return cells.get(`${x},${y}`) === f.char;
    }) && s.fixed.length >= 1) chars++;
    const g = buildGrid([...items, cand]);
    if (Math.abs(boardScore(g.width, g.height, g.cells.length) - s.score) < 1e-9) grid++;
    if (findPlacement({ id: 'w', question: '', answer: cand.answer }, items)) engineFinds++;
  }
  const n = list.length;
  check(n > 0 && place === n, `${label}: どの候補も置ける条件（engine の validatePlacement）を通る ${place}/${n}`);
  check(n > 0 && engineFinds === n, `${label}: 型どおりの語（空きをヲで埋めた語）を engine の findPlacement に渡すと、どれも置き場所が見つかる ${engineFinds}/${n}`);
  check(n > 0 && up === n, `${label}: どの候補も点数が今の盤（${base.toFixed(3)}）より高い ${up}/${n}`);
  check(n > 0 && chars === n, `${label}: 決まっている字が、盤のその位置の字と一致する ${chars}/${n}`);
  check(n > 0 && grid === n, `${label}: buildGrid で組んだ盤の幅・高さ・マス数から出した点数と一致する ${grid}/${n}`);
  const keys = list.map(shapeKey);
  check(new Set(keys).size === keys.length, `${label}: 同じ型が重ならない（${keys.length}件）`);
  let sorted = true;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    if (a.score < b.score - 1e-12) sorted = false;
    else if (Math.abs(a.score - b.score) < 1e-12 && (a.fixed.length > b.fixed.length || (a.fixed.length === b.fixed.length && a.length > b.length))) sorted = false;
  }
  check(sorted, `${label}: 点数の高い順・同点は決まっている字が少ない順・短い順`);
}

// 長さ・決まっている字の位置を、全候補（上限なし）で確かめる
const allOf = (items) => suggestShapes(items, Infinity);

// (a) 横ハマグチ ＋ 2文字目を通る縦マツリ
const boardA = [item('ハマグチ', 'horizontal', 0, 0), item('マツリ', 'vertical', 1, 0)];
const topA = suggestShapes(boardA);
console.log(`(a) 盤: ${JSON.stringify(bbox(boardA))} 点数 ${currentBoardScore(boardA).toFixed(3)}`);
for (const s of topA) console.log(`    上位: ${formatShape(s)}（${s.direction === 'horizontal' ? '横' : '縦'}・(${s.startX},${s.startY})・点数 ${s.score.toFixed(3)}・盤 ${JSON.stringify(bbox([...boardA, asItem(s)]))}）`);
check(topA.length >= 1 && topA.length <= 3, `(a) 候補が1つ以上・上位3つまで: ${topA.length}件`);
checkAll('(a) 上位', boardA, topA);
const fullA = allOf(boardA);
console.log(`    (a) 全候補 ${fullA.length}件`);
checkAll('(a) 全候補', boardA, fullA);

// (b) 横長の盤では、上位は幅と高さの差を縮める
const boardB = [item('コンサートホール', 'horizontal', 0, 0), item('サイン', 'vertical', 2, 0)];
const bB = bbox(boardB);
const topB = suggestShapes(boardB);
console.log(`(b) 横長の盤: ${JSON.stringify(bB)}`);
for (const s of topB) console.log(`    上位: ${formatShape(s)}（${s.direction === 'horizontal' ? '横' : '縦'}・盤 ${JSON.stringify(bbox([...boardB, asItem(s)]))}）`);
check(topB.length > 0 && topB.every((s) => { const b = bbox([...boardB, asItem(s)]); return Math.abs(b.w - b.h) < Math.abs(bB.w - bB.h); }),
  `(b) 横長（幅${bB.w}×高さ${bB.h}）: 上位がすべて幅と高さの差を縮める`);
checkAll('(b) 上位', boardB, topB);
// 縦長の盤（横長を縦に回した物）
const boardB2 = [item('コンサートホール', 'vertical', 0, 0), item('サイン', 'horizontal', 0, 2)];
const bB2 = bbox(boardB2);
const topB2 = suggestShapes(boardB2);
check(topB2.length > 0 && topB2.every((s) => { const b = bbox([...boardB2, asItem(s)]); return Math.abs(b.w - b.h) < Math.abs(bB2.w - bB2.h); }),
  `(b) 縦長（幅${bB2.w}×高さ${bB2.h}）: 上位がすべて幅と高さの差を縮める ${topB2.map(formatShape).join(' ／ ')}`);
checkAll('(b) 縦長 上位', boardB2, topB2);

// 文言の形と、語が無い盤
check(formatShape({ length: 4, fixed: [{ index: 2, char: 'ツ' }] }) === '4文字・3文字目がツ', `文言の形: ${formatShape({ length: 4, fixed: [{ index: 2, char: 'ツ' }] })}`);
check(formatShape({ length: 5, fixed: [{ index: 1, char: 'ア' }, { index: 3, char: 'ツ' }] }) === '5文字・2文字目がア・4文字目がツ', `文言の形（2つ）: ${formatShape({ length: 5, fixed: [{ index: 1, char: 'ア' }, { index: 3, char: 'ツ' }] })}`);
check(suggestShapes([]).length === 0, '語が無い盤では何も出さない');

// (d) 15語の盤
const WORDS = ['コンサートホール', 'ペンライト', 'アンコール', 'センター', 'ステージ', 'アイドル', 'ライブ', 'ダンス', 'メロディ', 'ハーモニー',
  'コーラス', 'チケット', 'タオル', 'サイン', 'ハマグチ', 'マツリ', 'レコード', 'グッズ', 'ファンクラブ', 'リズム'];
let board15 = [];
for (let t = 0; t < 200 && board15.length < 15; t++) {
  const placed = generateMaximizedPuzzle(WORDS.map((w, i) => ({ id: `w${i}`, question: '', answer: chars(w) })), 50);
  if (placed.length >= 15) board15 = buildGrid(placed.slice(0, 15)).items;
}
check(board15.length === 15, `(d) 15語の盤を組めた: ${board15.length}語 ${JSON.stringify(bbox(board15))}`);
if (board15.length === 15) {
  const times = [];
  let out = [];
  for (let r = 0; r < 21; r++) {
    const t0 = performance.now();
    out = suggestShapes(board15);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[10];
  check(median < 100, `(d) 15語の盤の計算時間: 中央値 ${median.toFixed(2)}ms（最小 ${times[0].toFixed(2)}・最大 ${times.at(-1).toFixed(2)}・21回）目安 100ms`);
  for (const s of out) console.log(`    15語の盤の上位: ${formatShape(s)}`);
  checkAll('(d) 15語 上位', board15, out);
  const full = allOf(board15);
  console.log(`    15語の盤の全候補 ${full.length}件`);
  checkAll('(d) 15語 全候補', board15, full);
}

console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
