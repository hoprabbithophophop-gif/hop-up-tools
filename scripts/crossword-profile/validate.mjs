// 作った盤（data/puzzle.json）が壊れていないかを機械で確かめる。出すのは OK/NG と件数だけ。
// 使い方: node scripts/crossword-profile/validate.mjs
import { readFile } from 'node:fs/promises';

const { body, answers, title, groupTags } = JSON.parse(await readFile(new URL('./data/puzzle.json', import.meta.url), 'utf8'));
let ng = 0;
const check = (ok, label) => { console.log(`${ok ? 'OK ' : 'NG '} ${label}`); if (!ok) ng++; };

const clues = body.clues;
check(clues.length === answers.length, `カギと答えの数が同じ（${clues.length}）`);
check(clues.every((c, i) => c.length === answers[i].length), '各カギの文字数が答えと同じ');
check(answers.every((a) => a.length >= 2 && a.length <= 20), '答えは2〜20字');
check(answers.every((a) => /^[ア-ンヴー]+$/.test(a.join(''))), '答えは大きなカナと「ー」だけ');
check(new Set(answers.map((a) => a.join(''))).size === answers.length, '同じ答えが2回出ない');
check(clues.every((c) => c.hint && c.hint.kind === 'link' && /^https:\/\/www\.helloproject\.com\//.test(c.hint.url)), 'ヒントは全部、公式サイトへのリンク');
check(clues.every((c) => typeof c.clue === 'string' && c.clue.length > 0 && c.clue.length <= 200), 'カギの文が空でなく200字以内');
check(new Set(clues.map((c) => c.clue)).size === clues.length, '同じ文のカギが2つ無い');

// 交わるマスの字が食い違わない・盤の大きさが合う
const cells = new Map();
let conflict = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
clues.forEach((c, i) => {
  answers[i].forEach((ch, k) => {
    const x = c.startX + (c.direction === 'horizontal' ? k : 0);
    const y = c.startY + (c.direction === 'vertical' ? k : 0);
    const key = `${x},${y}`;
    if (cells.has(key) && cells.get(key) !== ch) conflict++;
    cells.set(key, ch);
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  });
});
check(conflict === 0, `交わるマスの字が食い違わない（食い違い ${conflict}）`);
check(minX === 0 && minY === 0 && maxX + 1 === body.width && maxY + 1 === body.height, `盤の大きさが合う（${body.width}×${body.height}）`);

// 全部つながっている（マスの隣接で辿る）
const seen = new Set();
const stack = [[...cells.keys()][0]];
while (stack.length) {
  const k = stack.pop();
  if (seen.has(k)) continue;
  seen.add(k);
  const [x, y] = k.split(',').map(Number);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nk = `${x + dx},${y + dy}`; if (cells.has(nk) && !seen.has(nk)) stack.push(nk); }
}
check(seen.size === cells.size, `盤が1つにつながっている（マス ${cells.size}）`);

// カギの無い字の並びが無い（横・縦とも、2マス以上つながる並びはどれかのカギと一致する）
const runs = new Set(clues.map((c) => `${c.direction}:${c.startX},${c.startY}:${c.length}`));
let stray = 0;
for (const dir of ['horizontal', 'vertical']) {
  const [dx, dy] = dir === 'horizontal' ? [1, 0] : [0, 1];
  for (const k of cells.keys()) {
    const [x, y] = k.split(',').map(Number);
    if (cells.has(`${x - dx},${y - dy}`)) continue; // 並びの先頭だけ見る
    let len = 1;
    while (cells.has(`${x + dx * len},${y + dy * len}`)) len++;
    if (len >= 2 && !runs.has(`${dir}:${x},${y}:${len}`)) stray++;
  }
}
check(stray === 0, `カギの無い字の並びが無い（${stray}）`);

// 番号が重ならない（同じ番号は同じ始点の横・縦だけ）
const byIndex = new Map();
for (const c of clues) { const s = `${c.startX},${c.startY}`; if (byIndex.has(c.clueIndex) && byIndex.get(c.clueIndex) !== s) ng++; byIndex.set(c.clueIndex, s); }
check(true, `カギ番号は始点ごとに1つ（番号 ${byIndex.size}種）`);

// 棚の決まりと同じ上限（受付係 crossword-save.ts）。超えていても棚には入るが、知っておく
console.log(`参考: 題名 ${title.length}字、グループ ${groupTags.length}、本文 ${new TextEncoder().encode(JSON.stringify(body)).length} バイト、受付係の上限はカギ60・本文51200バイト`);
console.log(ng === 0 ? 'すべてOK' : `NG ${ng}件`);
process.exit(ng === 0 ? 0 : 1);
