// 公式プロフィールの表（data/members.json）から「共通点」型のカギを機械で作り、盤を組んで SQL に書き出す。
// 文の型はここに書いた物だけ。AI は値を見ないし、文も考えない。
// 使い方: node --experimental-strip-types scripts/crossword-profile/generate.mjs [語数の上限=70] [乱数の種=1]
// 出力: data/puzzle.json（盤の中身）・data/insert.sql（Hop が Supabase の SQL 画面に1回貼る）
// 画面に出すのは件数だけ。
import { readFile, writeFile } from 'node:fs/promises';
import { webcrypto as crypto } from 'node:crypto';
import { generateMaximizedPuzzle, buildGrid, isConnected } from '../../src/lib/crossword/engine.ts';
import { prefectureOf, PREFECTURES, dateOf, bloodOf, BLOOD, zodiacOf, etoOf, MONTHS, toAnswerKana, isAnswerKana } from './tables.mjs';

const MAX_WORDS = Number(process.argv[2] ?? 70);
let seed = Number(process.argv[3] ?? 1);
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const SITE = 'https://www.helloproject.com';
const { members } = JSON.parse(await readFile(new URL('./data/members.json', import.meta.url), 'utf8'));

// 項目ごとに「値 → 答えのカナ」「1人型のカギの文」を決める。答えにできない項目（加入年）は共通点の重なり判定にだけ使う。
const ATTRS = {
  出身地: { value: (m) => prefectureOf(m.origin), kana: (v) => toAnswerKana(PREFECTURES[v]), single: (name) => `${name}の出身地` },
  血液型: { value: (m) => bloodOf(m.blood), kana: (v) => BLOOD[v], single: (name) => `${name}の血液型` },
  誕生月: { value: (m) => dateOf(m.birthday)?.m, kana: (v) => MONTHS[v - 1], single: (name) => `${name}の誕生月` },
  星座: { value: (m) => { const d = dateOf(m.birthday); return d && d.d != null ? zodiacOf(d.m, d.d).kana : null; }, kana: (v) => v, single: (name) => `${name}の星座` },
  干支: { value: (m) => { const d = dateOf(m.birthday); return d && etoOf(d.y).kana; }, kana: (v) => v, single: (name) => `${name}の干支` },
  メンバーカラー: { value: (m) => (m.color ? toAnswerKana(m.color) : null), kana: (v) => v, single: (name) => `${name}のメンバーカラー` },
  加入年: { value: (m) => dateOf(m.joined)?.y, kana: null, single: null },
};
const KEYS = Object.keys(ATTRS);
const vals = members.map((m) => Object.fromEntries(KEYS.map((k) => [k, ATTRS[k].value(m) ?? null])));

// 共通点の候補: 3人組で、7項目のうち「ちょうど1つだけ」同じ値を持ち、その項目が答えにできる物
const trios = new Map(); // 答えのカナ → [{ idx: [a,b,c], key }]
const n = members.length;
for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) {
  const shared = KEYS.filter((k) => vals[a][k] != null && vals[a][k] === vals[b][k] && vals[b][k] === vals[c][k]);
  if (shared.length !== 1 || !ATTRS[shared[0]].kana) continue;
  const k = shared[0];
  const kana = ATTRS[k].kana(vals[a][k]);
  if (!isAnswerKana(kana) || kana.length < 2) continue;
  if (!trios.has(kana)) trios.set(kana, []);
  trios.get(kana).push({ idx: [a, b, c], key: k });
}
// 1人型の候補: 答えが共通点の候補に無い値だけ（答えは問題の中で1回ずつ）
const singles = new Map();
for (let i = 0; i < n; i++) for (const k of KEYS) {
  if (!ATTRS[k].kana || vals[i][k] == null) continue;
  const kana = ATTRS[k].kana(vals[i][k]);
  if (!isAnswerKana(kana) || kana.length < 2 || trios.has(kana)) continue;
  if (!singles.has(kana)) singles.set(kana, []);
  singles.get(kana).push({ idx: [i], key: k });
}
console.log(`共通点の答え ${trios.size}種 ／ 1人型だけの答え ${singles.size}種`);

// 同じ人が何度も出ないように、出番の少ない人の組から選ぶ
const appear = new Array(n).fill(0);
const chooseFor = (cands) => {
  const scored = cands.map((c) => ({ c, s: c.idx.reduce((t, i) => t + appear[i], 0) + rand() * 0.5 }));
  scored.sort((x, y) => x.s - y.s);
  return scored[0].c;
};
const items = [];
// 共通点型を先に全部、足りない分だけ1人型。それぞれ長い答えから（盤の骨になる）、同じ長さは乱数
const byLen = (keys) => [...keys].sort((x, y) => y.length - x.length || rand() - 0.5);
const allKana = [...byLen(trios.keys()), ...byLen(singles.keys())];
for (const kana of allKana.slice(0, MAX_WORDS)) {
  const cands = trios.get(kana) ?? singles.get(kana);
  const c = chooseFor(cands);
  for (const i of c.idx) appear[i]++;
  const names = c.idx.map((i) => members[i].name);
  const question = c.idx.length === 3 ? `${names.join('・')}の共通点` : ATTRS[c.key].single(names[0]);
  items.push({ id: `w${items.length}`, question, answer: Array.from(kana), hint: { kind: 'link', url: SITE + members[c.idx[0]].path }, groups: c.idx.map((i) => members[i].group) });
}
console.log(`カギの候補 ${items.length}語（共通点 ${items.filter((i) => i.question.endsWith('の共通点')).length}・1人型 ${items.filter((i) => !i.question.endsWith('の共通点')).length}）`);
console.log(`出番の分布: 0回 ${appear.filter((a) => a === 0).length}人・最多 ${Math.max(...appear)}回`);

// 盤を組む。全部置けるまで試し、置けなかった語は落とす
let placed = generateMaximizedPuzzle(items.map(({ id, question, answer }) => ({ id, question, answer })), 400);
console.log(`盤に置けた語 ${placed.length} / ${items.length}`);
if (!isConnected(placed)) throw new Error('盤がつながっていない');
const grid = buildGrid(placed);
const byId = new Map(items.map((i) => [i.id, i]));
const clues = grid.items.map((p) => ({
  clueIndex: p.clueIndex, direction: p.direction, startX: p.startX, startY: p.startY,
  clue: p.question, answer: p.answer, hint: byId.get(p.id).hint,
}));
console.log(`盤 ${grid.width}×${grid.height}、カギ ${clues.length}`);

// 番号は受付係と同じ作り（64字の表から8字）
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const bytes = crypto.getRandomValues(new Uint8Array(8));
const id = [...bytes].map((b) => ID_CHARS[b & 63]).join('');
const groupTags = [...new Set(grid.items.flatMap((p) => byId.get(p.id).groups))];
const title = process.env.PUZZLE_TITLE ?? '【仮】ハロプロ全員プロフィール 特大';
const body = { version: 1, width: grid.width, height: grid.height, clues: clues.map(({ answer, ...c }) => ({ ...c, length: answer.length })) };
const answers = clues.map((c) => c.answer);
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (xs) => `array[${xs.map(q).join(',')}]::text[]`;
const sql = [
  '-- クロスワード 名物（公式プロフィールの共通点）を棚に入れる。1回だけ実行する',
  'begin;',
  `insert into public.crossword_puzzles (id, title, genre, tags, body, is_beginner, group_tags) values (${q(id)}, ${q(title)}, 'hello', ${arr([])}, ${q(JSON.stringify(body))}::jsonb, false, ${arr(groupTags)});`,
  `insert into public.crossword_answers (puzzle_id, answers) values (${q(id)}, ${q(JSON.stringify(answers))}::jsonb);`,
  'commit;',
  '',
].join('\n');
await writeFile(new URL('./data/puzzle.json', import.meta.url), JSON.stringify({ id, title, body, answers, groupTags }, null, 2) + '\n');
await writeFile(new URL('./data/insert.sql', import.meta.url), sql);
console.log(`書き出し: data/puzzle.json・data/insert.sql（番号 ${id}、グループ ${groupTags.length}）`);
