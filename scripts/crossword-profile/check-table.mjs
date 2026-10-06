// 集めた表（data/members.json）が、変換表で機械的に読めるかを件数だけで確かめる。値は出さない。
// 使い方: node scripts/crossword-profile/check-table.mjs
import { readFile } from 'node:fs/promises';
import { prefectureOf, dateOf, bloodOf, zodiacOf, etoOf, toAnswerKana, isAnswerKana } from './tables.mjs';

const { members } = JSON.parse(await readFile(new URL('./data/members.json', import.meta.url), 'utf8'));
const n = members.length;
const count = (f) => members.filter(f).length;

console.log(`人数 ${n}`);
console.log(`生年月日が日付として読めた: ${count((m) => dateOf(m.birthday))} / ${n}`);
console.log(`加入日が日付として読めた: ${count((m) => dateOf(m.joined))} / ${n}`);
console.log(`血液型が A/B/O/AB で読めた: ${count((m) => bloodOf(m.blood))} / ${n}`);
console.log(`出身地が都道府県で読めた: ${count((m) => prefectureOf(m.origin))} / ${n}`);
console.log(`メンバーカラーあり: ${count((m) => m.color)} / ${n}、うち値がカナだけ（答えに使える）: ${count((m) => m.color && isAnswerKana(toAnswerKana(m.color)))}`);
console.log(`好きなスポーツあり: ${count((m) => m.sport)} / ${n}、うち値がカナだけ: ${count((m) => m.sport && isAnswerKana(toAnswerKana(m.sport)))}`);
console.log(`英語表記あり: ${count((m) => m.nameEn)} / ${n}`);

// 共通点さがしの見込み: 項目ごとに「同じ値を持つ人数」の分布（値は出さず、山の大きさだけ）
const dist = (key, f) => {
  const map = new Map();
  for (const m of members) { const v = f(m); if (v == null) continue; map.set(v, (map.get(v) ?? 0) + 1); }
  const sizes = [...map.values()].sort((a, b) => b - a);
  const distinct = map.size;
  const trios = sizes.filter((s) => s >= 3).length;
  console.log(`${key}: 種類 ${distinct}、3人以上で同じ値 ${trios}種、最大 ${sizes[0] ?? 0}人`);
};
dist('出身地', (m) => prefectureOf(m.origin));
dist('血液型', (m) => bloodOf(m.blood));
dist('誕生月', (m) => dateOf(m.birthday)?.m);
dist('星座', (m) => { const d = dateOf(m.birthday); return d && zodiacOf(d.m, d.d).kana; });
dist('干支', (m) => { const d = dateOf(m.birthday); return d && etoOf(d.y).kana; });
dist('生まれ年', (m) => dateOf(m.birthday)?.y);
dist('加入年', (m) => dateOf(m.joined)?.y);
dist('メンバーカラー', (m) => m.color && toAnswerKana(m.color));
dist('好きなスポーツ', (m) => m.sport && toAnswerKana(m.sport));

// 読めなかった値の「形」だけ出す（数字→#、カナ→カ、漢字→漢、他→○）
const shape = (v) => (v ?? '').replace(/\d/g, '#').replace(/[ァ-ヶー]/g, 'カ').replace(/[぀-ゟ]/g, 'か').replace(/[一-鿿]/g, '漢').replace(/[^#カか漢]/g, '○');
const shapes = new Map();
for (const m of members) if (!dateOf(m.joined)) { const s = shape(m.joined); shapes.set(s, (shapes.get(s) ?? 0) + 1); }
console.log('加入日が読めなかった値の形:', [...shapes].map(([s, n]) => `${s}×${n}`).join(' / ') || '無し');
const bshapes = new Map();
for (const m of members) if (!bloodOf(m.blood)) { const s = shape(m.blood); bshapes.set(s, (bshapes.get(s) ?? 0) + 1); }
console.log('血液型が読めなかった値の形:', [...bshapes].map(([s, n]) => `${s}×${n}`).join(' / ') || '無し');

// 共通点さがしの実数: 3人組のうち「6項目のうちちょうど1つだけ同じ値」の組を数える
const attrs = {
  出身地: (m) => prefectureOf(m.origin),
  血液型: (m) => bloodOf(m.blood),
  誕生月: (m) => dateOf(m.birthday)?.m,
  星座: (m) => { const d = dateOf(m.birthday); return d && d.d != null ? zodiacOf(d.m, d.d).kana : null; },
  干支: (m) => { const d = dateOf(m.birthday); return d && etoOf(d.y).kana; },
  加入年: (m) => dateOf(m.joined)?.y,
  メンバーカラー: (m) => m.color && toAnswerKana(m.color),
};
const vals = members.map((m) => Object.fromEntries(Object.entries(attrs).map(([k, f]) => [k, f(m) ?? null])));
const perAttr = Object.fromEntries(Object.keys(attrs).map((k) => [k, { trios: 0, answers: new Set() }]));
let trios = 0;
for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) {
  const shared = Object.keys(attrs).filter((k) => vals[a][k] != null && vals[a][k] === vals[b][k] && vals[b][k] === vals[c][k]);
  if (shared.length !== 1) continue;
  trios++;
  perAttr[shared[0]].trios++;
  perAttr[shared[0]].answers.add(vals[a][shared[0]]);
}
console.log(`3人組で「ちょうど1項目だけ共通」: ${trios}組`);
for (const [k, v] of Object.entries(perAttr)) console.log(`  ${k}: ${v.trios}組、答えの種類 ${v.answers.size}`);
const allAnswers = new Set(Object.values(perAttr).flatMap((v) => [...v.answers]));
console.log(`答えの種類の合計（重なりを除く）: ${allAnswers.size}`);
