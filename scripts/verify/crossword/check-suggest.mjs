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
const { buildGrid, validatePlacement, findPlacement, generateMaximizedPuzzle, generateMonteCarloSteps } = engine;
const { suggestGuides, formatGuide, boardScore, currentBoardScore, listCandidates, fixedKey, suggestForBoard, guideTexts, formatWordLine, tentativeItem, NO_ENTER_TEXT } = sg;

let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};

const chars = (w) => Array.from(w);
const W = (w) => ({ id: w, question: '', answer: chars(w) });
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
check(formatGuide({ kind: 'multi', positions: [0, 2], alts: [['ア'], ['ン']], minLength: 3, maxLength: 8 }) === '1文字目がア・3文字目がンの3文字以上の語（8文字まで）',
  `文の形（2つ以上）: ${formatGuide({ kind: 'multi', positions: [0, 2], alts: [['ア'], ['ン']], minLength: 3, maxLength: 8 })}`);
check(formatGuide({ kind: 'single', positions: [0], alts: [['グ', 'チ', 'ハ']], minLength: 4, maxLength: 4 }) === '4文字・1文字目がグ／チ／ハ',
  `文の形（1つ・字だけ違う物をまとめる）: ${formatGuide({ kind: 'single', positions: [0], alts: [['グ', 'チ', 'ハ']], minLength: 4, maxLength: 4 })}`);
check(formatGuide({ kind: 'multi', positions: [0, 2], alts: [['ア'], ['ン', 'リ']], minLength: 3, maxLength: 3 }) === '1文字目がア・3文字目がン／リの3文字の語',
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
  // 段階2: 盤に載らなかった残りの語を「置けなかった語」として渡す
  const onBoard = new Set(board15.map((i) => i.answer.join('')));
  const rest = WORDS.filter((w) => !onBoard.has(w)).map(W);
  const t2 = [];
  let r15 = null;
  for (let r = 0; r < 11; r++) {
    const t0 = performance.now();
    r15 = suggestForBoard(board15, rest);
    t2.push(performance.now() - t0);
  }
  t2.sort((a, b) => a - b);
  check(t2[5] < 100, `(15語・段階2) 置けなかった語 ${rest.length}語で計算時間（Node）: 中央値 ${t2[5].toFixed(2)}ms（最大 ${t2.at(-1).toFixed(2)}・11回）目安 100ms`);
  checkEnter('(15語・段階2)', board15, rest.map((w) => w.answer.join('')), r15);
}

// ---- 段階2: 置けなかった語ごとに、その語が入る型を1行（1つの型に入れる語は1つ） ----
function checkEnter(label, items, unplacedWords, res) {
  check(res.mode === 'enter', `${label}: 置けなかった語ごとの行になる: ${res.mode}`);
  check(res.lines.length === unplacedWords.length && res.lines.every((l, i) => l.word === unplacedWords[i]),
    `${label}: 語ごとに1行・入力順: ${res.lines.map((l) => l.word).join('、')}`);
  const texts = guideTexts(res);
  for (const t of texts) console.log(`    「${t}」`);
  check(texts.every((t, i) => t.startsWith(`${unplacedWords[i]}：`)), `${label}: 行の頭に入る語の名前`);
  check(texts.every((t) => !t.includes('→') && !t.includes('が入る')), `${label}: 末尾の「→ …が入る」が無い`);
  check(res.lines.every((l) => !l.guide || (l.guide.needs.length === 1 && l.guide.entered.length === 1 && l.guide.entered[0] === l.word && l.guide.needs[0].word === l.word)),
    `${label}: 1つの型に入れる置けなかった語は1つ（その行の語だけ）`);
  let ok = 0, n = 0, lenOk = 0, lenN = 0;
  const cells = cellMap(items);
  for (const l of res.lines) {
    if (!l.guide) continue;
    for (const m of l.guide.members) {
      n++;
      // 型の線（空きにその語の字を1つ入れた物）を足した盤で、その語が engine の findPlacement で置ける
      const t = { ...tentativeItem(m, m.assign), id: 't', uuid: 't' };
      if (validatePlacement(t, items) && findPlacement(W(l.word), [...items, t])) ok++;
      // 長さの幅: 下限から最大まで伸ばしても置けて、決まっている字が変わらず、空きの位置が線の中にある
      for (let L = l.guide.minLength; L <= l.guide.maxLength; L++) {
        lenN++;
        const fixed = [];
        for (let i = 0; i < L; i++) {
          const ch = cells.get(`${m.direction === 'horizontal' ? m.startX + i : m.startX},${m.direction === 'vertical' ? m.startY + i : m.startY}`);
          if (ch) fixed.push({ index: i, char: ch });
        }
        const line = { ...m, length: L, fixed };
        if (fixedKey(fixed) === fixedKey(m.fixed) && validatePlacement(tentativeItem(line), items) && l.guide.needs[0].index < L) lenOk++;
      }
    }
  }
  check(n > 0 && ok === n, `${label}: 型の語を足した盤で、行の語が engine の findPlacement で本当に置ける ${ok}/${n}`);
  check(lenN > 0 && lenOk === lenN, `${label}: 長さの下限から最大まで、どの長さでも置けて空きの位置が線の中にある ${lenOk}/${lenN}`);
  // その語が入る型の中で一番良い（詰まり → 正方形らしさ）物を選んでいる
  let bestOk = 0, bestN = 0;
  for (const l of res.lines) {
    if (!l.guide) continue;
    bestN++;
    let bestD = -1, bestS = -1;
    for (const c of listCandidates(items)) {
      const d = c.filled / (c.width * c.height), s = Math.min(c.width, c.height) / Math.max(c.width, c.height);
      if (d < bestD - 1e-12 || (Math.abs(d - bestD) < 1e-12 && s <= bestS + 1e-12)) continue;
      // この線のどこかの空きにこの語の字を入れると入るか
      let enters = false;
      for (let b = 0; b < c.length && !enters; b++) {
        if (c.fixed.some((f) => f.index === b)) continue;
        // 空き b に語の k 文字目を交わらせ、逆向きに置く形を engine の判定で1つずつ試す（suggest.ts の近道は使わない）
        const bx = c.direction === 'horizontal' ? c.startX + b : c.startX;
        const by = c.direction === 'vertical' ? c.startY + b : c.startY;
        const ud = c.direction === 'horizontal' ? 'vertical' : 'horizontal';
        const word = chars(l.word);
        for (let k = 0; k < word.length && !enters; k++) {
          const t = { ...tentativeItem(c, [{ index: b, char: word[k] }]), id: 't', uuid: 't' };
          const u = { id: 'u', question: '', uuid: 'u', answer: word, direction: ud, startX: ud === 'horizontal' ? bx - k : bx, startY: ud === 'vertical' ? by - k : by, length: word.length };
          if (validatePlacement(u, [...items, t])) enters = true;
        }
      }
      if (enters) { bestD = d; bestS = s; }
    }
    if (Math.abs(l.guide.density - bestD) < 1e-12 && Math.abs(l.guide.square - bestS) < 1e-12) bestOk++;
    else console.log(`    ずれ: ${l.word} 案内 詰まり${l.guide.density.toFixed(3)}・正方形${l.guide.square.toFixed(3)} ／ 総当たり 詰まり${bestD.toFixed(3)}・正方形${bestS.toFixed(3)}`);
  }
  check(bestOk === bestN, `${label}: 各行は、その語が入る型の中で詰まり → 正方形らしさが一番良い物 ${bestOk}/${bestN}`);
}

// 置けなかった語が1つ（オレンジ: 盤のどの字とも重ならない）
const r1 = suggestForBoard(board3, [W('オレンジ')]);
check(r1.placeableNow.length === 0, `(段階2・オレンジ) 今の盤にはそのまま置けない: ${JSON.stringify(r1.placeableNow)}`);
checkEnter('(段階2・オレンジ)', board3, ['オレンジ'], r1);
// 置けなかった語が2つ: 2行・入力順
const r2 = suggestForBoard(board3, [W('ホット'), W('オレンジ')]);
checkEnter('(段階2・ホットとオレンジ)', board3, ['ホット', 'オレンジ'], r2);
check(formatWordLine({ word: 'エグチサヤ', guide: { kind: 'enter', positions: [2], alts: [['エ']], minLength: 5, maxLength: 8, needs: [{ index: 4, word: 'エグチサヤ', letters: chars('エグチサヤ') }], entered: ['エグチサヤ'] } })
  === 'エグチサヤ：3文字目がエ・5文字目にエグチサヤの字の5文字以上の語（8文字まで）',
  `(段階2) 文の形の見本: ${formatWordLine({ word: 'エグチサヤ', guide: { kind: 'enter', positions: [2], alts: [['エ']], minLength: 5, maxLength: 8, needs: [{ index: 4, word: 'エグチサヤ', letters: chars('エグチサヤ') }], entered: ['エグチサヤ'] } })}`);
// 置けなかった語が無い盤では段階1と同じ
const r0 = suggestForBoard(board3, []);
check(r0.mode === 'shape' && guideTexts(r0).join('|') === suggestGuides(board3).map(formatGuide).join('|'), `(段階2) 置けなかった語が無い盤は段階1と同じ: ${guideTexts(r0).join(' ／ ')}`);
check(guideTexts(suggestForBoard(board2, [W('オレンジ')])).length === 0, '(段階2) 2語の盤では出さない');
// 入る型が無い語は、その語の行として理由を出す（空の語で道筋だけ確かめる。実際の語ではほぼ起きない）
const rn = suggestForBoard(board3, [W('オレンジ'), { answer: [] }]);
const tn = guideTexts(rn);
check(tn.length === 2 && tn[0].startsWith('オレンジ：') && tn[1] === `：${NO_ENTER_TEXT}`, `(段階2) 入る型が無い語は、その語の行に理由: 「${tn[1]}」`);
check(formatWordLine({ word: 'エグチサヤ', guide: null }) === 'エグチサヤ：今の盤に交差できる字が無く、入る型がありません', `(段階2) 理由の行の形: ${formatWordLine({ word: 'エグチサヤ', guide: null })}`);
// 今の盤にそのまま置ける語（組み立ての見落とし）は数えて返す
const rp = suggestForBoard(board3, [W('ウチワ')]);
check(rp.placeableNow.includes('ウチワ'), `(段階2) 今の盤にそのまま置ける語を見分ける: ${JSON.stringify(rp.placeableNow)}`);
// Hop の盤に近い10語で組んだ盤（画面の確かめと同じ語）
const HOP10 = ['オレンジ', 'ライト', 'ホット', 'ミディアム', 'コジマハナ', 'スギヤマ', 'コバヤシ', 'エグチサヤ', 'ヒライミヨ', 'マエダ'];
{
  const placed = generateMaximizedPuzzle(HOP10.map(W), 50);
  const bd = buildGrid(placed).items;
  const names = new Set(bd.map((i) => i.answer.join('')));
  const miss = HOP10.filter((w) => !names.has(w));
  console.log(`(Hop の10語) 盤 ${bd.length}語 ${JSON.stringify(bbox(bd))} 置けなかった語 ${miss.join('、')}`);
  if (bd.length >= 3 && miss.length) checkEnter('(Hop の10語)', bd, miss, suggestForBoard(bd, miss.map(W)));
}

// ---- 組み立て側の疑い: コジマハナ の コ から下に コバヤシ ----
const kj = [item('コジマハナ', 'horizontal', 0, 0)];
const pk = findPlacement(W('コバヤシ'), kj);
check(Boolean(pk), `横コジマハナだけの盤に、engine の findPlacement で コバヤシ が置ける: ${pk ? `${pk.direction === 'vertical' ? '縦' : '横'}・(${pk.startX},${pk.startY})` : '置けない'}`);
const HOP = ['オレンジ', 'ライト', 'ホット', 'ミディアム', 'コジマハナ', 'スギヤマ', 'コバヤシ', 'エグチサヤ', 'ヒライミヨ', 'マエダ'];
const RUNS = 300;
let kbIn = 0, allIn = 0, kbMissButFits = 0, kbMiss = 0;
const missCount = {};
const missButFits = {};
for (let r = 0; r < RUNS; r++) {
  // 作る画面と同じ選び方: 50回組んで、置けた語が一番多い物、同じなら面積が小さい物
  let best = null, bestCount = 0, bestArea = Infinity;
  for (const step of generateMonteCarloSteps(HOP.map(W), 50)) {
    if (!step.placed.length) continue;
    const pz = buildGrid(step.placed);
    const area = pz.width * pz.height;
    if (step.placed.length > bestCount || (step.placed.length === bestCount && area < bestArea)) { best = pz; bestCount = step.placed.length; bestArea = area; }
  }
  const names = new Set(best.items.map((i) => i.answer.join('')));
  if (names.size === HOP.length) allIn++;
  for (const w of HOP) if (!names.has(w)) {
    missCount[w] = (missCount[w] || 0) + 1;
    if (findPlacement(W(w), best.items)) missButFits[w] = (missButFits[w] || 0) + 1;
  }
  if (names.has('コバヤシ')) kbIn++;
  else {
    kbMiss++;
    if (findPlacement(W('コバヤシ'), best.items)) kbMissButFits++;
  }
}
console.log(`    Hop の盤に近い10語で、作る画面と同じ組み立て（50回組んで一番良い物）を${RUNS}回: 全部置けた ${allIn}回・コバヤシが置けた ${kbIn}回・置けなかった ${kbMiss}回`);
console.log(`    コバヤシが置けなかった${kbMiss}回のうち、出来上がった盤にそのまま置けた（組み立てが見落とした）回: ${kbMissButFits}回`);
console.log(`    語ごとの置けなかった回数: ${JSON.stringify(missCount)}`);
console.log(`    そのうち出来上がった盤にそのまま置けた（組み立てが見落とした）回数: ${JSON.stringify(missButFits)}`);
check(kbIn + kbMiss === RUNS, `組み立ての試し ${RUNS}回を数えた`);

// 同じ向きの語が端で1字重なる型は出さない（2026-10-06 レビューの直し）
{
  // 型の線が、同じ向きの語が通るマスを通るか
  const overlapsSameDir = (cand, items) => {
    const mine = new Set(Array.from({ length: cand.length }, (_, i) => (cand.direction === 'horizontal' ? `${cand.startX + i},${cand.startY}` : `${cand.startX},${cand.startY + i}`)));
    return items.some((it) => it.direction === cand.direction && Array.from({ length: it.length }, (_, i) => (it.direction === 'horizontal' ? `${it.startX + i},${it.startY}` : `${it.startX},${it.startY + i}`)).some((k) => mine.has(k)));
  };
  // 見本: アイウ 横(0,0)・ウエオ 縦(2,0)・オカキ 横(2,2)。旧は「アイウ の端の ウ から右へ伸びる横の線」を型に出せた
  const sample = [item('アイウ', 'horizontal', 0, 0), item('ウエオ', 'vertical', 2, 0), item('オカキ', 'horizontal', 2, 2)];
  const sc = listCandidates(sample);
  check(sc.length > 0 && sc.every((c) => !overlapsSameDir(c, sample)), `型の線（${sc.length}本）は、どれも同じ向きの語が通るマスを通らない`);
  // 少ない字の語で組んだ盤を200枚。型の線・置けなかった語の行の両方で
  const ALPHA = Array.from('アイウエオカ');
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const word = () => Array.from({ length: 2 + Math.floor(rnd() * 4) }, () => ALPHA[Math.floor(rnd() * ALPHA.length)]).join('');
  let boards = 0, lines = 0, bad = 0, enterBad = 0;
  for (let r = 0; r < 200; r++) {
    const ws = [...new Set(Array.from({ length: 7 }, word))].map(W);
    const placed = generateMaximizedPuzzle(ws, 10);
    if (placed.length < 3) continue;
    boards++;
    for (const c of listCandidates(placed)) {
      lines++;
      if (overlapsSameDir(c, placed)) bad++;
    }
    // 置けなかった語の行: 型の語を足した盤に、その語が同じ向きの重なり無しで置ける
    const unplaced = ws.filter((w) => !placed.some((p) => p.id === w.id));
    const g = suggestForBoard(placed, unplaced);
    for (const l of g.lines ?? []) for (const m of l.guide?.members ?? []) {
      lines++;
      const t = { ...tentativeItem(m, m.assign), id: 'cand', uuid: 'cand' };
      if (overlapsSameDir(t, placed)) enterBad++;
      // 型の語を足した盤に、その行の語を置いた形も重ならない
      const u = ws.find((w) => w.id === l.word);
      const put = u && findPlacement(u, [...placed, t]);
      if (put && overlapsSameDir(put, [...placed, t])) enterBad++;
    }
  }
  check(boards > 50 && bad === 0, `6字だけの語で組んだ盤 ${boards}枚・型の線 ${lines}本で、同じ向きの語が通るマスを通る線 ${bad}本`);
  check(enterBad === 0, `置けなかった語の行の型でも、同じ向きの語に重なる物 ${enterBad}本`);
}

console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
