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
const sg = await import(pathToFileURL(load('suggest')).href + stamp);
const { buildGrid, validatePlacement, findPlacement, generateMaximizedPuzzle } = engine;
const { suggestGuides, formatGuide, boardScore, currentBoardScore, listCandidates, fixedKey } = sg;

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
// 線を、空きに「ヲ」を入れた実際の語にした形
const asItem = (s, fill = 'ヲ') => {
  const answer = Array.from({ length: s.length }, (_, i) => s.fixed.find((f) => f.index === i)?.char ?? fill);
  return { id: 'cand', question: '', uuid: 'cand', answer, direction: s.direction, startX: s.startX, startY: s.startY, length: s.length };
};

// 置ける長さを、盤の上で1本ずつ総当たりで数え直す（suggest.ts の数え方を使わない）
const SIZES = [3, 4, 5, 6, 7, 8];
function bruteLengths(items, key) {
  const cells = cellMap(items);
  const xs = [...cells.keys()].map((k) => +k.split(',')[0]);
  const ys = [...cells.keys()].map((k) => +k.split(',')[1]);
  const found = new Set();
  for (const dir of ['horizontal', 'vertical']) {
    for (let sx = Math.min(...xs) - 8; sx <= Math.max(...xs) + 1; sx++) for (let sy = Math.min(...ys) - 8; sy <= Math.max(...ys) + 1; sy++) {
      for (const L of SIZES) {
        const fixed = [];
        let cross = false;
        for (let i = 0; i < L; i++) {
          const x = dir === 'horizontal' ? sx + i : sx;
          const y = dir === 'vertical' ? sy + i : sy;
          const ch = cells.get(`${x},${y}`);
          if (ch) {
            fixed.push({ index: i, char: ch });
            if (items.some((it) => it.direction !== dir && cellMap([it]).has(`${x},${y}`))) cross = true;
          }
        }
        if (!cross || fixedKey(fixed) !== key) continue;
        const cand = asItem({ length: L, fixed, direction: dir, startX: sx, startY: sy });
        if (validatePlacement(cand, items)) found.add(L);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

function checkGuides(label, items, guides) {
  const base = currentBoardScore(items);
  const cells = cellMap(items);
  const members = guides.flatMap((g) => g.members);
  let place = 0, finds = 0, up = 0, charOk = 0, grid = 0;
  for (const s of members) {
    const cand = asItem(s);
    if (validatePlacement(cand, items)) place++;
    if (findPlacement({ id: 'w', question: '', answer: cand.answer }, items)) finds++;
    if (s.score > base) up++;
    if (s.fixed.every((f) => cells.get(`${s.direction === 'horizontal' ? s.startX + f.index : s.startX},${s.direction === 'vertical' ? s.startY + f.index : s.startY}`) === f.char)) charOk++;
    const g = buildGrid([...items, cand]);
    if (Math.abs(boardScore(g.width, g.height, g.cells.length) - s.score) < 1e-9) grid++;
  }
  const n = members.length;
  check(n > 0 && place === n, `${label}: どの型の線も置ける条件（engine の validatePlacement）を通る ${place}/${n}`);
  check(n > 0 && finds === n, `${label}: 型どおりの語（空きをヲで埋めた語）を engine の findPlacement に渡すと置き場所が見つかる ${finds}/${n}`);
  check(n > 0 && up === n, `${label}: 点数が今の盤（${base.toFixed(3)}）より高い ${up}/${n}`);
  check(n > 0 && charOk === n, `${label}: 決まっている字が盤のその位置の字と一致する ${charOk}/${n}`);
  check(n > 0 && grid === n, `${label}: buildGrid で組んだ盤から出した点数（詰まり×2＋正方形らしさ）と一致する ${grid}/${n}`);
  // 長さの下限と最大が、総当たりで数えた置ける長さと一致する
  let lenOk = 0, lenN = 0;
  for (const g of guides) for (const [key, ls] of Object.entries(g.lengthsByKey)) {
    lenN++;
    const brute = bruteLengths(items, key);
    const okRange = g.kind === 'single'
      ? brute.includes(g.minLength)
      : brute.length > 0 && brute[0] === g.minLength && brute.at(-1) === g.maxLength && ls.join(',') === brute.join(',');
    if (okRange) lenOk++;
    else console.log(`    ずれ: ${formatGuide(g)} の ${key} 案内 ${ls.join(',')} 総当たり ${brute.join(',')}`);
  }
  check(lenN > 0 && lenOk === lenN, `${label}: 長さの下限と最大が、総当たりで数えた置ける長さと一致する ${lenOk}/${lenN}`);
  // 下限は「最後に決まっている字の位置」か3の大きい方
  check(guides.every((g) => g.kind === 'single' || g.minLength === Math.max(3, g.positions.at(-1) + 1)),
    `${label}: 下限は「最後に決まっている字の位置」（3未満なら3）`);
}

const show = (label, items, guides) => {
  console.log(`${label} 盤 ${JSON.stringify(bbox(items))} 点数 ${currentBoardScore(items).toFixed(3)}`);
  for (const g of guides) console.log(`    「${formatGuide(g)}」 点数 ${g.score.toFixed(3)}`);
};

// 2語の盤では出ない
const board2 = [item('ハマグチ', 'horizontal', 0, 0), item('マツリ', 'vertical', 1, 0)];
check(suggestGuides(board2).length === 0, `2語の盤では出さない: ${suggestGuides(board2).length}件（2語の盤の置ける線は ${listCandidates(board2).length}本）`);
check(suggestGuides([]).length === 0, '語が無い盤では出さない');

// 3語の盤（ハマグチ・マツリ・リズム）
const board3 = [...board2, item('リズム', 'horizontal', 1, 2)];
const g3 = suggestGuides(board3);
show('(3語)', board3, g3);
check(g3.length >= 1 && g3.length <= 3, `3語の盤で出る: ${g3.length}件`);
const has2 = listCandidates(board3).some((c) => c.fixed.length >= 2 && c.score > currentBoardScore(board3));
check(has2 && g3.every((g) => g.kind === 'multi' && g.positions.length >= 2), `決まっている字が2つ以上の型が先: ${g3.map((g) => g.positions.length).join(',')}`);
checkGuides('(3語)', board3, g3);

// 2つ以上の型が無い3語の盤では、1つの型を「N文字・M文字目がX」で出す
const boardS = [item('アイウ', 'horizontal', 0, 0), item('アカサタナハマヤ', 'vertical', 0, 0), item('ラリヤ', 'horizontal', -2, 7)];
const gS = suggestGuides(boardS);
show('(2つ以上の型が無い盤)', boardS, gS);
const multiS = listCandidates(boardS).filter((c) => c.fixed.length >= 2 && c.score > currentBoardScore(boardS));
console.log(`    この盤の、点数が上がる2つ以上の型の線: ${multiS.length}本`);
if (multiS.length === 0) {
  check(gS.length === 1 && gS[0].kind === 'single', `2つ以上の型が無い時は1つだけ「N文字・M文字目がX」: ${gS.map(formatGuide).join(' ／ ')}`);
  check(/^\d+文字・\d+文字目が[^・]+$/.test(formatGuide(gS[0] ?? { kind: 'single', positions: [], alts: [], minLength: 0 })), `その文の形: ${gS[0] ? formatGuide(gS[0]) : '(無し)'}`);
  checkGuides('(2つ以上の型が無い盤)', boardS, gS);
} else {
  check(false, '2つ以上の型が無い盤を作れなかった（台本の盤を直す）');
}

// まとめの形
check(formatGuide({ kind: 'multi', positions: [0, 2], alts: [['ア'], ['ン']], minLength: 3, maxLength: 8 }) === '1文字目がア・3文字目がンの3文字以上の言葉（8文字まで）',
  `文の形（2つ以上）: ${formatGuide({ kind: 'multi', positions: [0, 2], alts: [['ア'], ['ン']], minLength: 3, maxLength: 8 })}`);
check(formatGuide({ kind: 'single', positions: [0], alts: [['グ', 'チ', 'ハ']], minLength: 4, maxLength: 4 }) === '4文字・1文字目がグ／チ／ハ',
  `文の形（1つ・字だけ違う物をまとめる）: ${formatGuide({ kind: 'single', positions: [0], alts: [['グ', 'チ', 'ハ']], minLength: 4, maxLength: 4 })}`);
check(formatGuide({ kind: 'multi', positions: [0, 2], alts: [['ア'], ['ン', 'リ']], minLength: 3, maxLength: 3 }) === '1文字目がア・3文字目がン／リの3文字の言葉',
  `文の形（下限と最大が同じ・1か所だけ字が違う）: ${formatGuide({ kind: 'multi', positions: [0, 2], alts: [['ア'], ['ン', 'リ']], minLength: 3, maxLength: 3 })}`);
// 案内の中で「字の位置・長さの幅が同じで1か所だけ字が違う」物が、別の行に残っていない
const noSplit = (guides) => guides.every((a, i) => guides.every((b, j) => {
  if (i >= j || a.kind !== b.kind || a.positions.join() !== b.positions.join() || a.minLength !== b.minLength || a.maxLength !== b.maxLength) return true;
  const diff = a.alts.filter((x, k) => x.join() !== b.alts[k].join()).length;
  return diff !== 1 || a.alts.some((x, k) => x.length > 1 && x.join() !== b.alts[k].join());
}));
// 2つ以上の型で、1か所だけ字が違う線が並ぶ盤（2行目は カ?キ、3行目は カ?シ）
const boardM = [item('アイウ', 'horizontal', 0, 0), item('アカカ', 'vertical', 0, 0), item('ウキシ', 'vertical', 2, 0)];
const gM = suggestGuides(boardM);
show('(字だけ違う線が並ぶ盤)', boardM, gM);
check(noSplit(gM) && noSplit(g3) && noSplit(gS), '字の位置が同じで1か所だけ字が違う型は、別の行に分かれていない');
check(gM.some((g) => g.kind === 'multi' && formatGuide(g).startsWith('1文字目がカ・3文字目がキ／シ')), `2つ以上の型で1か所だけ字が違う物を「／」で1行に: ${gM.map(formatGuide).join(' ／ ')}`);
const merged = [...g3, ...gS, ...gM].filter((g) => g.alts.some((a) => a.length > 1));
check(merged.every((g) => g.alts.filter((a) => a.length > 1).length === 1), `まとめた行は、字が違うのが1か所だけ: ${merged.map(formatGuide).join(' ／ ') || '(まとめた行なし)'}`);
if (gM.length) checkGuides('(字だけ違う線が並ぶ盤)', boardM, gM);

// 15語の盤
const WORDS = ['コンサートホール', 'ペンライト', 'アンコール', 'センター', 'ステージ', 'アイドル', 'ライブ', 'ダンス', 'メロディ', 'ハーモニー',
  'コーラス', 'チケット', 'タオル', 'サイン', 'ハマグチ', 'マツリ', 'レコード', 'グッズ', 'ファンクラブ', 'リズム'];
let board15 = [];
for (let t = 0; t < 200 && board15.length < 15; t++) {
  const placed = generateMaximizedPuzzle(WORDS.map((w, i) => ({ id: `w${i}`, question: '', answer: chars(w) })), 50);
  if (placed.length >= 15) board15 = buildGrid(placed.slice(0, 15)).items;
}
check(board15.length === 15, `15語の盤を組めた: ${board15.length}語 ${JSON.stringify(bbox(board15))}`);
if (board15.length === 15) {
  const times = [];
  let out = [];
  for (let r = 0; r < 21; r++) {
    const t0 = performance.now();
    out = suggestGuides(board15);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  check(times[10] < 100, `15語の盤の計算時間（Node）: 中央値 ${times[10].toFixed(2)}ms（最小 ${times[0].toFixed(2)}・最大 ${times.at(-1).toFixed(2)}・21回）目安 100ms`);
  show('(15語)', board15, out);
  checkGuides('(15語)', board15, out);
  check(noSplit(out), '(15語) 字の位置が同じで1か所だけ字が違う型は、別の行に分かれていない');
}

console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
