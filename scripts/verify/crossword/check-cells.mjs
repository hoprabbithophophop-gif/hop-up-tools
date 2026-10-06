// 答えの字そろえを、本物のファイルのまま node で動かして確かめる（Hop 決定 2026-10-05「小文字は大きい字と同じ扱いに統一」）。
// 紙: 作る「ひらがなはカタカナに、小さい字は大きい字にそろえてマスに出す」／解く「小さい字（ッ・ィ等）は大きい字（ツ・イ）に統一。濁点・半濁点は区別する」
//  1. 作る画面の toCells（src/lib/crossword/cells.ts）
//  2. 保存の受付係の本文の確かめ（functions/api/crossword-save.ts の validateSavePayload）が、小さい字を大きい字にして棚へ渡す形にする
//  3. 答えからのグループ判定（functions/_shared/crosswordGroups.ts）が、大きい字にそろえた答えでも拾う
// ts は Node の stripTypeScriptTypes で型だけ外し、一時置き場に .mjs として書いて読み込む（論理は写さない。読み込み先の名前だけ書き換える）。
// 使い方: node scripts/verify/crossword/check-cells.mjs（引数なし。通信しない）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { ROOT, outDir } from './_lib.mjs';

const dir = outDir('check-cells');
const stamp = Date.now();
// 読み込む ts を一時置き場へ .mjs で写す。相対の読み込みは同じ置き場の <名前>.mjs に向ける
const files = [
  'functions/_shared/crosswordKana.ts',
  'src/lib/crossword/cells.ts',
  'functions/_shared/crosswordGroups.ts',
  'functions/_shared/crosswordMembers.ts',
  'functions/_shared/crosswordOgp.ts',
  'functions/_shared/bodyLimit.ts',
  'functions/_shared/background.ts',
  'functions/api/crossword-save.ts',
];
for (const f of files) {
  const js = stripTypeScriptTypes(readFileSync(path.join(ROOT, f), 'utf8')).replace(
    /from\s+(["'])(\.{1,2}\/[^"']+)\1/g,
    (_, q, spec) => `from ${q}./${path.basename(spec).replace(/\.ts$/, '')}.mjs${q}`,
  );
  writeFileSync(path.join(dir, `${path.basename(f, '.ts')}.mjs`), js);
}
const load = (name) => import(pathToFileURL(path.join(dir, `${name}.mjs`)).href + `?t=${stamp}`);
const { toCells } = await load('cells');
const { validateSavePayload } = await load('crossword-save');
const { detectGroups } = await load('crosswordGroups');

let fail = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. toCells
const cases = [
  ['ミディアム', ['ミ', 'デ', 'イ', 'ア', 'ム']],
  ['ホット', ['ホ', 'ツ', 'ト']],
  ['ぁ', ['ア']],
  ['かぼちゃ', ['カ', 'ボ', 'チ', 'ヤ']],
  ['ちゃーはん', ['チ', 'ヤ', 'ー', 'ハ', 'ン']],
  ['ぁぃぅぇぉゃゅょっゎゕゖ', ['ア', 'イ', 'ウ', 'エ', 'オ', 'ヤ', 'ユ', 'ヨ', 'ツ', 'ワ', 'カ', 'ケ']],
  ['ァィゥェォャュョッヮヵヶ', ['ア', 'イ', 'ウ', 'エ', 'オ', 'ヤ', 'ユ', 'ヨ', 'ツ', 'ワ', 'カ', 'ケ']],
  ['パピプペポ', ['パ', 'ピ', 'プ', 'ペ', 'ポ']],
  ['ガバ', ['ガ', 'バ']],
  ['ヴ', ['ヴ']],
  ['ハロー', ['ハ', 'ロ', 'ー']],
];
for (const [input, want] of cases) {
  const got = toCells(input);
  check(same(got, want), `toCells「${input}」→ ${got.join('・')}（期待 ${want.join('・')}）`);
}
check(toCells('ハ')[0] !== toCells('バ')[0] && toCells('バ')[0] !== toCells('パ')[0], '濁点・半濁点は区別したまま（ハ・バ・パは別の字）');

// 2. 保存の受付係の本文の確かめ
const hint = { kind: 'link', url: 'https://example.com/' };
const p = validateSavePayload({
  title: '確かめ',
  genre: 'other',
  tags: [],
  key: 'a'.repeat(64),
  body: {
    version: 1, width: 3, height: 3,
    clues: [
      { clueIndex: 1, direction: 'horizontal', startX: 0, startY: 0, clue: 'x', answer: ['ホ', 'ッ', 'ト'], hint },
      { clueIndex: 2, direction: 'vertical', startX: 1, startY: 0, clue: 'y', answer: ['ッ', 'ァ'], hint },
    ],
  },
});
check(p !== null, '受付係: 小さい字の入った答えは断らずに受け付ける');
check(p && same(p.body.clues.map((c) => c.answer), [['ホ', 'ツ', 'ト'], ['ツ', 'ア']]), `受付係: 棚へ渡す答えは大きい字 → ${p ? JSON.stringify(p.body.clues.map((c) => c.answer)) : 'null'}`);

// 3. 答えからのグループ判定（公式表記がかなのグループ名に小さい字が入っている）
const roster = { members: [], groups: ['アンジュルム', 'つばきファクトリー', 'ロージークロニクル'] };
const g = detectGroups({ title: '', clues: [], answers: [toCells('アンジュルム').join(''), toCells('つばきふぁくとりー').join('')] }, roster);
check(same(g, ['アンジュルム', 'つばきファクトリー']), `グループ判定: 大きい字にそろえた答え「${toCells('アンジュルム').join('')}」「${toCells('つばきふぁくとりー').join('')}」からも拾う → ${g.join('、')}`);

console.log(fail ? `NG ${fail}件` : 'すべてOK');
process.exit(fail ? 1 : 0);
