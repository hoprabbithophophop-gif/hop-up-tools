// 公式プロフィールの表（data/members.json）から「共通点」型のカギを機械で作り、盤を組んで SQL に書き出す。
// 文の型はここに書いた物だけ。AI は値を見ないし、文も考えない。
// 使い方: node --experimental-strip-types scripts/crossword-profile/generate.mjs [語数の上限=70] [乱数の種=1]
// 出力: data/puzzle.json（盤の中身）・data/insert.sql（Hop が Supabase の SQL 画面に1回貼る）
// 画面に出すのは件数だけ。
import { readFile, writeFile } from 'node:fs/promises';
import { webcrypto as crypto } from 'node:crypto';
import { validatePlacement, buildGrid, isConnected, shuffleByLength } from '../../src/lib/crossword/engine.ts';
import { prefectureOf, PREFECTURES, dateOf, bloodOf, BLOOD, zodiacOf, etoOf, toAnswerKana, isAnswerKana } from './tables.mjs';

const MAX_WORDS = Number(process.argv[2] ?? 70);
let seed = Number(process.argv[3] ?? 1);
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

const SITE = 'https://www.helloproject.com';
const table = JSON.parse(await readFile(new URL('./data/members.json', import.meta.url), 'utf8'));
// 研修生は除く（Hop 決定 2026-10-07）。プロフィールは変わるので、表を集めた日を題名に入れる
const members = table.members.filter((m) => m.group !== 'ハロプロ研修生');
const asOf = new Date(new Date(table.fetchedAt).getTime() + 9 * 3600 * 1000);
const asOfText = `${asOf.getUTCFullYear()}年${asOf.getUTCMonth() + 1}月${asOf.getUTCDate()}日`;
console.log(`対象 ${members.length}人（研修生を除く）、表の日付 ${asOfText}`);

// 項目ごとに「値 → 答えのカナ」「1人型のカギの文」を決める。答えにできない項目（加入年）は共通点の重なり判定にだけ使う。
const ATTRS = {
  出身地: { value: (m) => prefectureOf(m.origin), kana: (v) => toAnswerKana(PREFECTURES[v]), single: (name) => `${name}の出身地` },
  血液型: { value: (m) => bloodOf(m.blood), kana: (v) => BLOOD[v], single: (name) => `${name}の血液型` },
  // 誕生月は答えにしない（「シガツ」が誕生月か加入月か読めない。Hop 決定 2026-10-07）。重なりの判定にだけ使う
  誕生月: { value: (m) => dateOf(m.birthday)?.m, kana: null, single: null },
  // 星座・干支は生年月日から変換しないと出ないので、カギに種類を書く（Hop 決定 2026-10-07 案B）
  星座: { value: (m) => { const d = dateOf(m.birthday); return d && d.d != null ? zodiacOf(d.m, d.d).kana : null; }, kana: (v) => v, single: (name) => `${name}の星座`, labeled: '星座' },
  干支: { value: (m) => { const d = dateOf(m.birthday); return d && etoOf(d.y).kana; }, kana: (v) => v, single: (name) => `${name}の干支`, labeled: '干支' },
  メンバーカラー: { value: (m) => (m.color ? toAnswerKana(m.color) : null), kana: (v) => v, single: (name) => `${name}のメンバーカラー` },
  加入年: { value: (m) => dateOf(m.joined)?.y, kana: null, single: null },
};
const KEYS = Object.keys(ATTRS);
const vals = members.map((m) => Object.fromEntries(KEYS.map((k) => [k, ATTRS[k].value(m) ?? null])));

// 共通点の候補（Hop 決定 2026-10-07）: 項目の値ごとに「その値を持つ全員」を挙げる。
//   1人だけ → 「Aの出身地」型。2〜MAX_NAMES 人 → 「A・B・…の共通点」型。挙げた人以外に同じ値の人はいない。
//   列挙した全員が別の項目でも同じ値だと答えが割れるので外す（種類を書く項目は割れないので外さない）。人数が多すぎる値も外す。
const MAX_NAMES = 8;
const candidates = new Map(); // 答えのカナ → { idx, key }
let tooBig = 0, ambiguous = 0;
for (const k of KEYS) {
  if (!ATTRS[k].kana) continue;
  const holders = new Map();
  vals.forEach((v, i) => { if (v[k] != null) { if (!holders.has(v[k])) holders.set(v[k], []); holders.get(v[k]).push(i); } });
  for (const [v, idx] of holders) {
    const kana = ATTRS[k].kana(v);
    if (!isAnswerKana(kana) || kana.length < 2 || candidates.has(kana)) continue;
    if (idx.length > MAX_NAMES) { tooBig++; continue; }
    if (idx.length >= 2 && !ATTRS[k].labeled) {
      const shared = KEYS.filter((kk) => idx.every((i) => vals[i][kk] != null && vals[i][kk] === vals[idx[0]][kk]));
      if (shared.length !== 1) { ambiguous++; continue; }
    }
    candidates.set(kana, { idx, key: k });
  }
}
const sizes = {};
for (const { idx } of candidates.values()) sizes[idx.length] = (sizes[idx.length] ?? 0) + 1;
console.log(`カギの候補 ${candidates.size}語（人数別 ${JSON.stringify(sizes)}）／人数が多すぎて外した値 ${tooBig}・別の項目も全員同じで外した値 ${ambiguous}`);

const n = members.length;
const appear = new Array(n).fill(0);
const items = [];
// 長い答えから優先（盤の骨になる）、同じ長さは乱数
const allKana = [...candidates.keys()].sort((x, y) => y.length - x.length || rand() - 0.5);
for (const kana of allKana.slice(0, MAX_WORDS)) {
  const c = candidates.get(kana);
  for (const i of c.idx) appear[i]++;
  // 名前の並びは公式の掲載順（グループ順→グループ内の順）
  const idx = [...c.idx].sort((a, b) => a - b);
  const names = idx.map((i) => members[i].name);
  const label = ATTRS[c.key].labeled;
  const question = idx.length >= 2 ? `${names.join('・')}${label ? `に共通する${label}` : 'の共通点'}` : ATTRS[c.key].single(names[0]);
  items.push({ id: `w${items.length}`, question, answer: Array.from(kana), hint: { kind: 'link', url: SITE + members[idx[0]].path }, groups: idx.map((i) => members[i].group) });
}
console.log(`使う語 ${items.length}（共通点 ${items.filter((i) => i.question.endsWith('の共通点')).length}・種類つき ${items.filter((i) => /に共通する/.test(i.question)).length}・1人型 ${items.filter((i) => !/共通/.test(i.question)).length}）`);
console.log(`出番の分布: 0回 ${appear.filter((a) => a === 0).length}人・最多 ${Math.max(...appear)}回`);

// 盤を組む。本編の部品は「語どうしがぴったり隣に並ぶ置き方」を許しているが、特大ではカギの無い字の並びに見えて
// 騙された気分になる（Hop 2026-10-07）。この台本だけ、隣に並ぶ置き方を断る判定を足して置く。作る画面の部品は変えない。
const cellsOf = (it) => Array.from({ length: it.length }, (_, i) => [it.direction === 'horizontal' ? it.startX + i : it.startX, it.direction === 'vertical' ? it.startY + i : it.startY]);
const noAdjacency = (cand, placed) => {
  const occupied = new Set(placed.flatMap((p) => cellsOf(p).map(([x, y]) => `${x},${y}`)));
  const mine = new Set(cellsOf(cand).map(([x, y]) => `${x},${y}`));
  const cross = new Set([...mine].filter((k) => occupied.has(k)));
  const [dx, dy] = cand.direction === 'horizontal' ? [0, 1] : [1, 0]; // 語と直角の方向
  const [ax, ay] = cand.direction === 'horizontal' ? [1, 0] : [0, 1]; // 語と同じ方向
  for (const [x, y] of cellsOf(cand)) {
    const k = `${x},${y}`;
    if (cross.has(k)) continue; // 交差のマスの上下左右は交差相手の語なので構わない
    if (occupied.has(`${x + dx},${y + dy}`) || occupied.has(`${x - dx},${y - dy}`)) return false; // 横に並んで隣接
  }
  // 語の前後のマスが埋まっていると、語がつながって見える
  const [sx, sy] = cellsOf(cand)[0];
  const [ex, ey] = cellsOf(cand)[cand.length - 1];
  if (occupied.has(`${sx - ax},${sy - ay}`) || occupied.has(`${ex + ax},${ey + ay}`)) return false;
  return true;
};
let uuidN = 0;
// 置ける場所を全部集め、盤の面積がいちばん増えない所に置く（隣接なしでも盤が疎になりにくい）
const bounds = (ps) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of ps) for (const [x, y] of cellsOf(p)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return (x1 - x0 + 1) * (y1 - y0 + 1); };
const SCORING = process.env.SCORING ?? 'mix';
const findStrict = (item, placed) => {
  if (placed.length === 0) return { ...item, uuid: `u${uuidN++}`, direction: 'horizontal', startX: 0, startY: 0, length: item.answer.length };
  let best = null, bestScore = Infinity;
  const pc = placed.flatMap(cellsOf); const center = { x: pc.reduce((t, c) => t + c[0], 0) / pc.length, y: pc.reduce((t, c) => t + c[1], 0) / pc.length };
  for (const ex of placed) {
    const dir = ex.direction === 'horizontal' ? 'vertical' : 'horizontal';
    for (let i = 0; i < ex.answer.length; i++) {
      const ix = ex.direction === 'horizontal' ? ex.startX + i : ex.startX;
      const iy = ex.direction === 'horizontal' ? ex.startY : ex.startY + i;
      for (let j = 0; j < item.answer.length; j++) {
        if (ex.answer[i] !== item.answer[j]) continue;
        const cand = { ...item, uuid: `u${uuidN++}`, direction: dir, startX: dir === 'horizontal' ? ix - j : ix, startY: dir === 'vertical' ? iy - j : iy, length: item.answer.length };
        if (!validatePlacement(cand, placed) || !noAdjacency(cand, placed)) continue;
        // 面積の増え方に、盤の中心からの遠さを少し足す（外周に貼り付いて後の語が置けなくなるのを防ぐ）
        const all = [...placed, cand];
        const b = bounds(all);
        const cs = cellsOf(cand); const cx = (cs[0][0] + cs[cs.length - 1][0]) / 2, cy = (cs[0][1] + cs[cs.length - 1][1]) / 2;
        const score = SCORING === 'area' ? b + rand() * 0.9 : SCORING === 'center' ? Math.abs(cx - center.x) + Math.abs(cy - center.y) + rand() * 0.9 : b * 0.2 + Math.abs(cx - center.x) + Math.abs(cy - center.y) + rand() * 0.9;
        if (score < bestScore) { best = cand; bestScore = score; }
      }
    }
  }
  return best;
};
const placeAllStrict = (queue) => {
  const placed = [];
  let rest = [];
  for (const it of queue) { const p = findStrict(it, placed); if (p) placed.push(p); else rest.push(it); }
  while (rest.length) { const next = []; for (const it of rest) { const p = findStrict(it, placed); if (p) placed.push(p); else next.push(it); } if (next.length === rest.length) break; rest = next; }
  return placed;
};
const pure = items.map(({ id, question, answer }) => ({ id, question, answer }));
// 全部置けた中で盤の面積が小さい物を選ぶ（隣接なしだと盤が疎になりやすい）
const areaOf = (ps) => { const g = buildGrid(ps); return g.width * g.height; };
let placed = [];
let bestArea = Infinity;
const ATTEMPTS = Number(process.env.ATTEMPTS ?? 1500);
for (let a = 0; a < ATTEMPTS; a++) {
  const got = placeAllStrict(shuffleByLength(pure));
  if (got.length < placed.length) continue;
  const area = areaOf(got);
  if (got.length > placed.length || area < bestArea) { placed = got; bestArea = area; }
}
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
const title = process.env.PUZZLE_TITLE ?? `ハロメンの共通点 ${asOfText}時点`;
const body = { version: 1, width: grid.width, height: grid.height, clues: clues.map(({ answer, ...c }) => ({ ...c, length: answer.length })) };
const answers = clues.map((c) => c.answer);
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (xs) => `array[${xs.map(q).join(',')}]::text[]`;
const replaceId = process.env.REPLACE_ID ?? null; // 前の版の番号。あれば消してから入れる（ランキング・遊んだ回数も消える）
const sql = [
  '-- クロスワード 名物（公式プロフィールの共通点）を棚に入れる。1回だけ実行する',
  'begin;',
  ...(replaceId ? [
    `delete from public.crossword_scores where puzzle_id = ${q(replaceId)};`,
    `delete from public.crossword_plays where puzzle_id = ${q(replaceId)};`,
    `delete from public.crossword_play_counts where puzzle_id = ${q(replaceId)};`,
    `delete from public.crossword_answers where puzzle_id = ${q(replaceId)};`,
    `delete from public.crossword_puzzles where id = ${q(replaceId)};`,
  ] : []),
  `insert into public.crossword_puzzles (id, title, genre, tags, body, is_beginner, group_tags) values (${q(id)}, ${q(title)}, 'hello', ${arr([])}, ${q(JSON.stringify(body))}::jsonb, false, ${arr(groupTags)});`,
  `insert into public.crossword_answers (puzzle_id, answers) values (${q(id)}, ${q(JSON.stringify(answers))}::jsonb);`,
  'commit;',
  '',
].join('\n');
await writeFile(new URL('./data/puzzle.json', import.meta.url), JSON.stringify({ id, title, body, answers, groupTags }, null, 2) + '\n');
await writeFile(new URL('./data/insert.sql', import.meta.url), sql);
console.log(`書き出し: data/puzzle.json・data/insert.sql（番号 ${id}、グループ ${groupTags.length}）`);
