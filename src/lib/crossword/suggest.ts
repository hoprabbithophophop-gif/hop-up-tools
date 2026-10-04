import type { PlacedItem } from './types';
import { validatePlacement } from './engine';

// 型の案内: 今の盤に足すと盤が整う語の「長さ」と「決まっている字の位置」を出す。単語は出さない
// 置ける条件は engine.ts の validatePlacement をそのまま使う。候補の作り方は findPlacement と同じ
// （新しい語は、自分と逆向きの語のマスを少なくとも1つ通る）

export interface ShapeFixed {
  index: number; // 0 始まり
  char: string;
}

export interface ShapeSuggestion {
  length: number;
  fixed: ShapeFixed[];
  direction: 'horizontal' | 'vertical';
  startX: number;
  startY: number;
  score: number;
}

export const SUGGEST_MIN_LEN = 3;
export const SUGGEST_MAX_LEN = 8;
export const SUGGEST_LIMIT = 3;
const EMPTY = '\u0000';

// 正方形らしさ + 詰まり（同じ重み）
export const boardScore = (width: number, height: number, filled: number): number => {
  if (width <= 0 || height <= 0) return 0;
  return Math.min(width, height) / Math.max(width, height) + filled / (width * height);
};

interface CellInfo {
  char: string;
  h: boolean;
  v: boolean;
}

const cellsOf = (items: PlacedItem[]) => {
  const map = new Map<string, CellInfo>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    for (let i = 0; i < it.length; i++) {
      const x = it.direction === 'horizontal' ? it.startX + i : it.startX;
      const y = it.direction === 'vertical' ? it.startY + i : it.startY;
      const key = `${x},${y}`;
      let c = map.get(key);
      if (!c) {
        c = { char: it.answer[i], h: false, v: false };
        map.set(key, c);
      }
      if (it.direction === 'horizontal') c.h = true;
      else c.v = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { map, minX, minY, maxX, maxY };
};

export const shapeKey = (s: Pick<ShapeSuggestion, 'length' | 'fixed'>): string =>
  `${s.length}:${s.fixed.map((f) => `${f.index}=${f.char}`).join(',')}`;

export const currentBoardScore = (items: PlacedItem[]): number => {
  if (items.length === 0) return 0;
  const { map, minX, minY, maxX, maxY } = cellsOf(items);
  return boardScore(maxX - minX + 1, maxY - minY + 1, map.size);
};

export const suggestShapes = (items: PlacedItem[], limit: number = SUGGEST_LIMIT): ShapeSuggestion[] => {
  if (items.length === 0) return [];
  const { map, minX, minY, maxX, maxY } = cellsOf(items);
  const baseScore = boardScore(maxX - minX + 1, maxY - minY + 1, map.size);

  const seenLine = new Set<string>();
  const best = new Map<string, ShapeSuggestion>();

  for (const [key, cell] of map) {
    const [ax, ay] = key.split(',').map(Number);
    // 横の語のマスからは縦の候補、縦の語のマスからは横の候補（findPlacement と同じ）
    const dirs: ('horizontal' | 'vertical')[] = [];
    if (cell.v) dirs.push('horizontal');
    if (cell.h) dirs.push('vertical');

    for (const dir of dirs) {
      for (let len = SUGGEST_MIN_LEN; len <= SUGGEST_MAX_LEN; len++) {
        for (let j = 0; j < len; j++) {
          const sx = dir === 'horizontal' ? ax - j : ax;
          const sy = dir === 'vertical' ? ay - j : ay;
          const lineKey = `${dir}:${sx},${sy}:${len}`;
          if (seenLine.has(lineKey)) continue;
          seenLine.add(lineKey);

          const answer: string[] = [];
          const fixed: ShapeFixed[] = [];
          let lx = minX, ly = minY, hx = maxX, hy = maxY;
          for (let i = 0; i < len; i++) {
            const x = dir === 'horizontal' ? sx + i : sx;
            const y = dir === 'vertical' ? sy + i : sy;
            const c = map.get(`${x},${y}`);
            if (c) {
              answer.push(c.char);
              fixed.push({ index: i, char: c.char });
            } else {
              answer.push(EMPTY);
            }
            if (x < lx) lx = x;
            if (y < ly) ly = y;
            if (x > hx) hx = x;
            if (y > hy) hy = y;
          }

          const candidate: PlacedItem = {
            id: '', question: '', uuid: '', answer, direction: dir, startX: sx, startY: sy, length: len,
          };
          if (!validatePlacement(candidate, items)) continue;

          const score = boardScore(hx - lx + 1, hy - ly + 1, map.size + (len - fixed.length));
          if (score <= baseScore + 1e-9) continue;

          const s: ShapeSuggestion = { length: len, fixed, direction: dir, startX: sx, startY: sy, score };
          const k = shapeKey(s);
          const prev = best.get(k);
          if (!prev || s.score > prev.score) best.set(k, s);
        }
      }
    }
  }

  return [...best.values()]
    .sort((a, b) =>
      b.score - a.score ||
      a.fixed.length - b.fixed.length ||
      a.length - b.length ||
      (shapeKey(a) < shapeKey(b) ? -1 : shapeKey(a) > shapeKey(b) ? 1 : 0))
    .slice(0, limit);
};

// 「4文字・3文字目がツ」「5文字・2文字目がア・4文字目がツ」
export const formatShape = (s: Pick<ShapeSuggestion, 'length' | 'fixed'>): string =>
  [`${s.length}文字`, ...s.fixed.map((f) => `${f.index + 1}文字目が${f.char}`)].join('・');
