// 語の一覧から盤を組み、棚に入れる SQL を作る共通部品。generate.mjs（共通点）と crossword-rules/build.mjs（決まりのクイズ）が使う。
// 本編の部品 engine.ts は「語どうしがぴったり隣に並ぶ置き方」を許しているが、特大の盤ではカギの無い字の並びに見えて
// 騙された気分になる（Hop 2026-10-07）。ここでは隣に並ぶ置き方を断る判定を足して置く。作る画面の部品は変えない。
import { webcrypto as crypto } from 'node:crypto';
import { validatePlacement, buildGrid, isConnected, shuffleByLength } from '../../src/lib/crossword/engine.ts';

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

const bounds = (ps) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of ps) for (const [x, y] of cellsOf(p)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return (x1 - x0 + 1) * (y1 - y0 + 1); };

/**
 * 語の一覧 [{ id, question, answer: string[] }] を、隣に並べずに置く。
 * 置ける場所を全部集め、「盤の面積が増えにくく、盤の中心に近い所」に置く（隣接なしでも盤が疎になりにくい）。
 * attempts 回試し、置けた語が多く、面積が小さい盤を返す。
 */
export function placeAll(items, { attempts = 400, rand = Math.random } = {}) {
  let uuidN = 0;
  const findStrict = (item, placed) => {
    if (placed.length === 0) return { ...item, uuid: `u${uuidN++}`, direction: 'horizontal', startX: 0, startY: 0, length: item.answer.length };
    let best = null, bestScore = Infinity;
    const pc = placed.flatMap(cellsOf);
    const center = { x: pc.reduce((t, c) => t + c[0], 0) / pc.length, y: pc.reduce((t, c) => t + c[1], 0) / pc.length };
    for (const ex of placed) {
      const dir = ex.direction === 'horizontal' ? 'vertical' : 'horizontal';
      for (let i = 0; i < ex.answer.length; i++) {
        const ix = ex.direction === 'horizontal' ? ex.startX + i : ex.startX;
        const iy = ex.direction === 'horizontal' ? ex.startY : ex.startY + i;
        for (let j = 0; j < item.answer.length; j++) {
          if (ex.answer[i] !== item.answer[j]) continue;
          const cand = { ...item, uuid: `u${uuidN++}`, direction: dir, startX: dir === 'horizontal' ? ix - j : ix, startY: dir === 'vertical' ? iy - j : iy, length: item.answer.length };
          if (!validatePlacement(cand, placed) || !noAdjacency(cand, placed)) continue;
          const all = [...placed, cand];
          const cs = cellsOf(cand);
          const cx = (cs[0][0] + cs[cs.length - 1][0]) / 2, cy = (cs[0][1] + cs[cs.length - 1][1]) / 2;
          const score = bounds(all) * 0.2 + Math.abs(cx - center.x) + Math.abs(cy - center.y) + rand() * 0.9;
          if (score < bestScore) { best = cand; bestScore = score; }
        }
      }
    }
    return best;
  };
  const placeOnce = (queue) => {
    const placed = [];
    let rest = [];
    for (const it of queue) { const p = findStrict(it, placed); if (p) placed.push(p); else rest.push(it); }
    while (rest.length) { const next = []; for (const it of rest) { const p = findStrict(it, placed); if (p) placed.push(p); else next.push(it); } if (next.length === rest.length) break; rest = next; }
    return placed;
  };
  let placed = [];
  let bestArea = Infinity;
  for (let a = 0; a < attempts; a++) {
    const got = placeOnce(shuffleByLength(items));
    if (got.length < placed.length) continue;
    const area = bounds(got);
    if (got.length > placed.length || area < bestArea) { placed = got; bestArea = area; }
  }
  if (!isConnected(placed)) throw new Error('盤がつながっていない');
  return placed;
}

/** 置いた語から、棚の本文（答えは文字数だけ）・答え・グループの札を作る */
export function toPuzzle(placed, byId) {
  const grid = buildGrid(placed);
  const clues = grid.items.map((p) => ({
    clueIndex: p.clueIndex, direction: p.direction, startX: p.startX, startY: p.startY,
    clue: p.question, answer: p.answer, hint: byId.get(p.id).hint,
  }));
  const body = { version: 1, width: grid.width, height: grid.height, clues: clues.map(({ answer, ...c }) => ({ ...c, length: answer.length })) };
  return { grid, clues, body, answers: clues.map((c) => c.answer) };
}

/** 8字の問題番号。受付係と同じ64字の表から選ぶ */
export function makeId() {
  const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => ID_CHARS[b & 63]).join('');
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (xs) => `array[${xs.map(q).join(',')}]::text[]`;

/** 棚に入れる SQL。replaceId があれば前の版（ランキング・途中経過・回数込み）を消してから入れる */
export function toSql({ id, title, genre = 'hello', tags = [], body, answers, groupTags = [], replaceId = null, note = '' }) {
  return [
    `-- ${note || 'クロスワードを棚に入れる'}。1回だけ実行する`,
    'begin;',
    ...(replaceId ? [
      `delete from public.crossword_scores where puzzle_id = ${q(replaceId)};`,
      `delete from public.crossword_plays where puzzle_id = ${q(replaceId)};`,
      `delete from public.crossword_play_counts where puzzle_id = ${q(replaceId)};`,
      `delete from public.crossword_answers where puzzle_id = ${q(replaceId)};`,
      `delete from public.crossword_puzzles where id = ${q(replaceId)};`,
    ] : []),
    `insert into public.crossword_puzzles (id, title, genre, tags, body, is_beginner, group_tags) values (${q(id)}, ${q(title)}, ${q(genre)}, ${arr(tags)}, ${q(JSON.stringify(body))}::jsonb, false, ${arr(groupTags)});`,
    `insert into public.crossword_answers (puzzle_id, answers) values (${q(id)}, ${q(JSON.stringify(answers))}::jsonb);`,
    'commit;',
    '',
  ].join('\n');
}
