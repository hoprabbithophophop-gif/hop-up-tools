// 決まりのクイズ（カギの文と答えを人が書いた JSON）から盤を組み、棚に入れる SQL を書き出す。
// 使い方: node --experimental-strip-types scripts/crossword-rules/build.mjs <JSON の場所> [REPLACE_ID=前の版の番号]
// 出力: JSON と同じ場所に <名前>.puzzle.json と <名前>.insert.sql
import { readFile, writeFile } from 'node:fs/promises';
import { placeAll, toPuzzle, makeId, toSql } from '../crossword-profile/layout.mjs';
import { toAnswerKana, isAnswerKana } from '../crossword-profile/tables.mjs';

const src = process.argv[2];
if (!src) throw new Error('JSON の場所を指定する');
const spec = JSON.parse(await readFile(src, 'utf8'));
const items = spec.items.map((it, i) => {
  const kana = toAnswerKana(it.answer);
  if (!isAnswerKana(kana) || kana.length < 2) throw new Error(`答えがカナでない: ${i + 1}番目`);
  return { id: `w${i}`, question: it.clue, answer: Array.from(kana), hint: { kind: 'link', url: it.url ?? spec.source } };
});
const dup = new Set();
for (const it of items) { const k = it.answer.join(''); if (dup.has(k)) throw new Error(`同じ答えが2つ: ${k}`); dup.add(k); }

const placed = placeAll(items.map(({ id, question, answer }) => ({ id, question, answer })), { attempts: Number(process.env.ATTEMPTS ?? 800) });
const byId = new Map(items.map((i) => [i.id, i]));
const { grid, body, answers } = toPuzzle(placed, byId);
const dropped = items.filter((i) => !placed.some((p) => p.id === i.id)).map((i) => i.answer.join(''));
console.log(`語 ${items.length}、置けた ${placed.length}、盤 ${grid.width}×${grid.height}${dropped.length ? `、置けなかった: ${dropped.join('・')}` : ''}`);

const id = makeId();
const base = src.replace(/\.json$/, '');
await writeFile(`${base}.puzzle.json`, JSON.stringify({ id, title: spec.title, body, answers, groupTags: spec.groupTags ?? [] }, null, 2) + '\n');
await writeFile(`${base}.insert.sql`, toSql({ id, title: spec.title, genre: spec.genre ?? 'hello', tags: spec.tags ?? [], body, answers, groupTags: spec.groupTags ?? [], replaceId: process.env.REPLACE_ID ?? null, note: '決まりのクロスワードを棚に入れる' }));
console.log(`書き出し: ${base}.puzzle.json・${base}.insert.sql（番号 ${id}）`);
