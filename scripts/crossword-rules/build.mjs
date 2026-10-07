// 決まりのクイズ（カギの文と答えを人が書いた JSON）から盤を組み、棚に入れる SQL を書き出す。
// 使い方: node --experimental-strip-types scripts/crossword-rules/build.mjs <JSON の場所> [REPLACE_ID=前の版の番号]
// 出力: JSON と同じ場所に <名前>.puzzle.json と <名前>.insert.sql
// JSON に dates があれば日程ごとに1問ずつ作る（出力は <名前>-<n>.puzzle.json / .insert.sql）。
//   各日程の問題 = 共通の items ＋ その日の会場のカギ ＋ その日の組み合わせ（メンバー1人につき1語。答えは名字のカナ）
import { readFile, writeFile } from 'node:fs/promises';
import { placeAll, toPuzzle, makeId, toSql } from '../crossword-profile/layout.mjs';
import { toAnswerKana, isAnswerKana } from '../crossword-profile/tables.mjs';

const src = process.argv[2];
if (!src) throw new Error('JSON の場所を指定する');
const spec = JSON.parse(await readFile(src, 'utf8'));

const toItems = (list) => list.map((it, i) => {
  const kana = toAnswerKana(it.answer);
  if (!isAnswerKana(kana) || kana.length < 2) throw new Error(`答えがカナでない: ${i + 1}番目 ${it.clue}`);
  return { id: `w${i}`, question: it.clue, answer: Array.from(kana), hint: { kind: 'link', url: it.url ?? spec.source } };
});

// 日程の組み合わせから、メンバー1人につき1語を作る。3ショット・グループお話し会・個別お話し会の販売グループを順番に回して、
// 出題が1種類に偏らないようにする（Hop 2026-10-07）。個別お話し会の組は全日程で同じなので spec.soloTalk から取る
const KINDS = ['threeShot', 'groupTalk', 'soloTalk'];
const comboItems = (d) => {
  const names = Object.keys(spec.members);
  return names.map((name, i) => {
    const kind = KINDS[i % KINDS.length];
    const groups = kind === 'soloTalk' ? spec.soloTalk : d[kind];
    const group = groups.find((g) => g.includes(name));
    if (!group) throw new Error(`${d.date} の ${kind} に ${name} がいない`);
    const partners = group.filter((n) => n !== name).join('・');
    return { answer: spec.members[name], clue: spec.comboClue[kind].replace('{partners}', partners) };
  });
};

const buildOne = async (list, title, outBase, label) => {
  // 棚の決まり: 題名は60字まで（crossword_puzzles の check）
  if ([...title].length > 60) throw new Error(`題名が60字を超えている（${[...title].length}字）: ${title}`);
  const items = toItems(list);
  const dup = new Set();
  for (const it of items) { const k = it.answer.join(''); if (dup.has(k)) throw new Error(`同じ答えが2つ: ${k}`); dup.add(k); }
  const placed = placeAll(items.map(({ id, question, answer }) => ({ id, question, answer })), { attempts: Number(process.env.ATTEMPTS ?? 800) });
  const byId = new Map(items.map((i) => [i.id, i]));
  const { grid, body, answers } = toPuzzle(placed, byId, { creatorName: process.env.CREATOR_NAME ?? spec.creatorName ?? null });
  const dropped = items.filter((i) => !placed.some((p) => p.id === i.id)).map((i) => i.answer.join(''));
  console.log(`${label}: 語 ${items.length}、置けた ${placed.length}、盤 ${grid.width}×${grid.height}${dropped.length ? `、置けなかった: ${dropped.join('・')}` : ''}`);
  const id = makeId();
  await writeFile(`${outBase}.puzzle.json`, JSON.stringify({ id, title, body, answers, groupTags: spec.groupTags ?? [] }, null, 2) + '\n');
  await writeFile(`${outBase}.insert.sql`, toSql({ id, title, genre: spec.genre ?? 'hello', tags: spec.tags ?? [], body, answers, groupTags: spec.groupTags ?? [], replaceId: process.env.REPLACE_ID ?? null, note: '決まりのクロスワードを棚に入れる' }));
  console.log(`  書き出し: ${outBase}.puzzle.json・${outBase}.insert.sql（番号 ${id}）`);
};

const base = src.replace(/\.json$/, '');
if (Array.isArray(spec.dates)) {
  // 全日程で会場が同じ日が複数ある場合も、各問題の中では会場の答えは1つなので重ならない
  for (let n = 0; n < spec.dates.length; n++) {
    const d = spec.dates[n];
    const title = spec.titleTemplate.replace('{date}', d.date).replace('{venue}', d.venueName ?? '');
    await buildOne([...spec.items, d.venueClue, ...comboItems(d)], title, `${base}-${n + 1}`, d.date);
  }
} else {
  await buildOne(spec.items, spec.title, base, '1問');
}
