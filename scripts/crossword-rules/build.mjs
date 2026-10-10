// 決まりのクイズ（カギの文と答えを人が書いた JSON）から盤を組み、棚に入れる SQL を書き出す。
// 使い方: node --experimental-strip-types scripts/crossword-rules/build.mjs <JSON の場所>
// JSON の形は3つ。共通の先頭項目は source, asOf, creatorName, groupTags, tags, wordCount（目標語数。無ければ 20）。
//   themes 形: 主題ごとに1問。題名は titleTemplate の {theme} を置き換える。各主題に replaceId（前の版の番号）を持てる
//   dates 形 : 日程ごとに1問。共通の items ＋ その日の会場のカギ ＋ その日の組み合わせ（メンバー1人につき1語。答えは名字のカナ）。
//              各日程に replaceId を持てる。comboClue は {partners}（組む相手）と {blank}（答えの字数ぶんの○）を置き換える
//   単独形   : title ＋ items で1問。前の版の番号は spec.replaceId
// 出力: 問題ごとに <名前>-<n>.puzzle.json（単独形は <名前>.puzzle.json）、SQL は全問題をまとめた <名前>.insert.sql 1本
import { readFile, writeFile } from 'node:fs/promises';
import { placeAll, placeExact, toPuzzle, makeId, toSql } from '../crossword-profile/layout.mjs';
import { toAnswerKana, isAnswerKana } from '../crossword-profile/tables.mjs';

const src = process.argv[2];
if (!src) throw new Error('JSON の場所を指定する');
const spec = JSON.parse(await readFile(src, 'utf8'));
const wordCount = spec.wordCount ?? 20;

// 穴の印。作る画面の○ボタンは U+25CB を入れるので、出力はそちらにそろえる
const BLANK = '○';
const BLANK_RE = /[○〇]+/g;
const fill = (tpl, map) => Object.entries(map).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), tpl);

// 答えとカギを検査して、盤に置ける形にする。説明文の形（穴の無いカギ）は数えて返す
const toItems = (list) => {
  const plain = [];
  const items = list.map((it, i) => {
    const kana = toAnswerKana(it.answer);
    const len = Array.from(kana).length;
    if (!isAnswerKana(kana) || len < 2) throw new Error(`答えがカナでない: ${i + 1}番目 ${it.clue}`);
    const clue = it.clue.replace(/〇/g, BLANK);
    const runs = clue.match(BLANK_RE) ?? [];
    if (runs.length >= 2) throw new Error(`穴（○の並び）が${runs.length}か所ある: 答え ${kana}（${len}字） カギ ${clue}`);
    if (runs.length === 1 && runs[0].length !== len) throw new Error(`○の数が答えの字数と合わない: 答え ${kana}（${len}字）・○ ${runs[0].length}個 カギ ${clue}`);
    if (runs.length === 0) plain.push({ answer: kana, clue });
    return { id: `w${i}`, question: clue, answer: Array.from(kana), hint: { kind: 'link', url: it.url ?? spec.source } };
  });
  return { items, plain };
};

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
    const answer = spec.members[name];
    const blank = BLANK.repeat(Array.from(toAnswerKana(answer)).length);
    return { answer, clue: fill(spec.comboClue[kind], { partners, blank }) };
  });
};

// 1問ぶんの検査と盤組み。書き出しは全問題の検査が通ってから行う
const buildOne = ({ list, title, outBase, label, replaceId }) => {
  // 棚の決まり: 題名は60字まで（crossword_puzzles の check）
  if ([...title].length > 60) throw new Error(`題名が60字を超えている（${[...title].length}字）: ${title}`);
  const { items, plain } = toItems(list);
  const dup = new Set();
  for (const it of items) { const k = it.answer.join(''); if (dup.has(k)) throw new Error(`同じ答えが2つ: ${k}（${label}）`); dup.add(k); }
  // 盤組みは乱数なので、置けない語が残ったら ROUNDS 回まで組み直し、全部置けた盤か、いちばん多く置けた盤を採る
  const words = items.map(({ id, question, answer }) => ({ id, question, answer }));
  let placed = [];
  for (let r = 0; r < Number(process.env.ROUNDS ?? 10); r++) {
    const got = placeAll(words, { attempts: Number(process.env.ATTEMPTS ?? 800), eager: r % 2 === 0 }); // 相手の少ない語を先に試す回と、試さない回を交互に
    if (got.length > placed.length) placed = got;
    if (placed.length === words.length) break;
  }
  // それでも残ったら、全部置ける並びを順に探す（EXACT_NODES 回まで。見つからなければ乱数の盤のまま）
  if (placed.length < words.length) {
    console.log(`${label}: 乱数では ${placed.length}/${words.length} 語。全部置ける並びを探す…`);
    const exact = placeExact(words, { nodeLimit: Number(process.env.EXACT_NODES ?? 300000), runs: 1 });
    if (exact) placed = exact;
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const { grid, body, answers } = toPuzzle(placed, byId, { creatorName: process.env.CREATOR_NAME ?? spec.creatorName ?? null });
  const dropped = items.filter((i) => !placed.some((p) => p.id === i.id)).map((i) => i.answer.join(''));
  console.log(`${label}: 語 ${items.length}（目標 ${wordCount}）、置けた ${placed.length}、盤 ${grid.width}×${grid.height}、説明文の形 ${plain.length} 語`);
  if (items.length !== wordCount) console.log(`  ※ 語数が目標と違う: ${items.length} 語（目標 ${wordCount}）`);
  if (dropped.length) console.log(`  置けなかった: ${dropped.join('・')}`);
  for (const p of plain) console.log(`  〔説明文の形〕${p.answer}: ${p.clue}`);
  return { id: makeId(), title, outBase, label, replaceId: replaceId ?? null, body, answers };
};

const base = src.replace(/\.json$/, '');
const jobs = [];
if (Array.isArray(spec.themes)) {
  if (spec.items) console.log('※ themes 形では先頭の items は使わない（主題ごとの items だけで問題を作る）');
  spec.themes.forEach((t, n) => jobs.push({ list: t.items, title: fill(spec.titleTemplate, { theme: t.theme }), outBase: `${base}-${n + 1}`, label: t.theme, replaceId: t.replaceId }));
} else if (Array.isArray(spec.dates)) {
  // 全日程で会場が同じ日が複数ある場合も、各問題の中では会場の答えは1つなので重ならない
  spec.dates.forEach((d, n) => jobs.push({
    list: [...(spec.items ?? []), d.venueClue, ...comboItems(d)],
    title: fill(spec.titleTemplate, { date: d.date, venue: d.venueName ?? '' }),
    outBase: `${base}-${n + 1}`, label: d.date, replaceId: d.replaceId,
  }));
} else {
  jobs.push({ list: spec.items, title: spec.title, outBase: base, label: '1問', replaceId: spec.replaceId });
}

const built = jobs.map(buildOne);

// toSql は1問ごとに begin/commit を付けるので、本体の文だけ取り出して1つの begin/commit に包む
const sqlBody = (b) => toSql({ id: b.id, title: b.title, genre: spec.genre ?? 'hello', tags: spec.tags ?? [], body: b.body, answers: b.answers, groupTags: spec.groupTags ?? [], replaceId: b.replaceId })
  .split('\n').filter((line, i) => !(i === 0 && line.startsWith('--')) && line !== 'begin;' && line !== 'commit;' && line !== '');
const replaced = built.filter((b) => b.replaceId);
const sql = [
  '-- 決まりのクロスワードを棚に入れる。1回だけ実行する',
  `-- 入れ替える前の番号: ${replaced.length ? replaced.map((b) => `${b.replaceId}（${b.label}）`).join('、') : 'なし'}`,
  'begin;',
  ...built.flatMap((b) => [`-- ${b.label}: 新しい番号 ${b.id}${b.replaceId ? `（${b.replaceId} と入れ替え）` : '（新規）'}`, ...sqlBody(b)]),
  'commit;',
  '',
].join('\n');

for (const b of built) await writeFile(`${b.outBase}.puzzle.json`, JSON.stringify({ id: b.id, title: b.title, body: b.body, answers: b.answers, groupTags: spec.groupTags ?? [] }, null, 2) + '\n');
await writeFile(`${base}.insert.sql`, sql);
console.log('書き出し:');
for (const b of built) console.log(`  ${b.outBase}.puzzle.json（${b.label}・番号 ${b.id}）`);
console.log(`  ${base}.insert.sql（${built.length} 問・入れ替え ${replaced.length} 問）`);
