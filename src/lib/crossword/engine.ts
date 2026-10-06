import type { PuzzleItem, PlacedItem, GridCell, PuzzleData } from './types';

/**
 * Safe UUID generator with fallback for browsers that don't support crypto.randomUUID()
 */
const safeUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch {
      // fall through
    }
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const isMatch = (val1: string, val2: string): boolean => {
  if (!val1 || !val2) return false;
  return val1.toUpperCase() === val2.toUpperCase();
};

/**
 * Tries to find a valid placement for a newItem onto the existing grid.
 * Returns the PlacedItem with coordinates if successful, null otherwise.
 */
export const findPlacement = (
  newItem: PuzzleItem,
  placedItems: PlacedItem[]
): PlacedItem | null => {
  if (placedItems.length === 0) {
    // First item: Place at (0,0) horizontally
    return {
      ...newItem,
      uuid: safeUUID(),
      direction: 'horizontal',
      startX: 0,
      startY: 0,
      length: newItem.answer.length
    };
  }

  // Shuffle placed items to vary generation
  const shuffledPlaced = [...placedItems].sort(() => Math.random() - 0.5);

  for (const existingItem of shuffledPlaced) {
    // Determine orthogonal direction
    const newDirection = existingItem.direction === 'horizontal' ? 'vertical' : 'horizontal';

    // Try to intersect at every possible index pair
    for (let i = 0; i < existingItem.answer.length; i++) {
      const existingVal = existingItem.answer[i];
      const intersectX = existingItem.direction === 'horizontal'
        ? existingItem.startX + i
        : existingItem.startX;
      const intersectY = existingItem.direction === 'horizontal'
        ? existingItem.startY
        : existingItem.startY + i;

      for (let j = 0; j < newItem.answer.length; j++) {
        if (isMatch(existingVal, newItem.answer[j])) {
          const candidate = createCandidate(newItem, newDirection, intersectX, intersectY, j);
          if (validatePlacement(candidate, placedItems)) {
            return candidate;
          }
        }
      }
    }
  }

  return null;
};

const createCandidate = (
  item: PuzzleItem,
  direction: 'horizontal' | 'vertical',
  intersectX: number,
  intersectY: number,
  matchIndex: number
): PlacedItem => {
  return {
    ...item,
    uuid: safeUUID(),
    direction,
    startX: direction === 'horizontal' ? intersectX - matchIndex : intersectX,
    startY: direction === 'vertical' ? intersectY - matchIndex : intersectY,
    length: item.answer.length
  };
};

export const validatePlacement = (candidate: PlacedItem, placedItems: PlacedItem[]): boolean => {
  // Map of candidate cells: coordinate -> value
  const candidateCells = new Map<string, string>();
  for (let i = 0; i < candidate.length; i++) {
    const cx = candidate.direction === 'horizontal' ? candidate.startX + i : candidate.startX;
    const cy = candidate.direction === 'vertical' ? candidate.startY + i : candidate.startY;
    candidateCells.set(`${cx},${cy}`, candidate.answer[i]);
  }

  // Map of existing cells: coordinate -> value と、そのマスを通る語の向き
  const existingCells = new Map<string, { value: string; horizontal: boolean; vertical: boolean }>();
  for (const existing of placedItems) {
    for (let i = 0; i < existing.length; i++) {
      const ex = existing.direction === 'horizontal' ? existing.startX + i : existing.startX;
      const ey = existing.direction === 'vertical' ? existing.startY + i : existing.startY;
      const key = `${ex},${ey}`;
      const cell = existingCells.get(key) ?? { value: existing.answer[i], horizontal: false, vertical: false };
      cell[existing.direction] = true;
      existingCells.set(key, cell);
    }
  }

  // 交差する場所では文字が完全に一致しなければならない
  const intersectionPoints = new Set<string>();

  for (const [coord, candidateValue] of candidateCells) {
    const existing = existingCells.get(coord);
    if (existing) {
      if (candidateValue !== existing.value) return false;
      // 同じ向きの語がもう通っているマスには置かない（端で1字重なって2語が1本につながるのを防ぐ。2026-10-06 レビューの直し）
      if (existing[candidate.direction]) return false;
      intersectionPoints.add(coord);
    }
  }

  // Only SINGLE point intersections are allowed.
  // If 2+ consecutive cells of the candidate are intersections, it's a "merge" not a "cross"
  // Example: GRAPE (G-R-A-P-E) and PEAR (P-E-...) sharing P-E is INVALID
  if (intersectionPoints.size >= 2) {
    const intersectionIndices: number[] = [];

    for (let i = 0; i < candidate.length; i++) {
      const cx = candidate.direction === 'horizontal' ? candidate.startX + i : candidate.startX;
      const cy = candidate.direction === 'vertical' ? candidate.startY + i : candidate.startY;
      if (intersectionPoints.has(`${cx},${cy}`)) {
        intersectionIndices.push(i);
      }
    }

    for (let i = 0; i < intersectionIndices.length - 1; i++) {
      if (intersectionIndices[i + 1] - intersectionIndices[i] === 1) return false;
    }
  }

  // 隣接制約は意図的に外している（密な配置を許可し、UIでボーダースタイルを変えて区別する）

  return true;
};

/**
 * Generates a puzzle data object from a list of placed items.
 * Normalizes coordinates to (0,0).
 */
export const buildGrid = (placedItems: PlacedItem[]): PuzzleData => {
  if (placedItems.length === 0) return createEmptyPuzzle();

  // Find bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  placedItems.forEach(item => {
    minX = Math.min(minX, item.startX);
    minY = Math.min(minY, item.startY);
    // 右端・下端はどちらの向きでも「最後のマス+1」（横1語の盤が高さ0にならないように。2026-10-06 レビューの直し）
    maxX = Math.max(maxX, (item.direction === 'horizontal' ? item.startX + item.length : item.startX + 1));
    maxY = Math.max(maxY, (item.direction === 'vertical' ? item.startY + item.length : item.startY + 1));
  });

  // Normalize
  const normalizedItems = placedItems.map(item => ({
    ...item,
    startX: item.startX - minX,
    startY: item.startY - minY
  }));

  // --- Numbering Logic ---
  // 1. Identify all unique start positions
  const startPositions = new Set<string>();
  normalizedItems.forEach(item => {
    startPositions.add(`${item.startX},${item.startY}`);
  });

  // 2. Sort positions (Reading order: Top->Bottom, Left->Right)
  const sortedPositions = Array.from(startPositions).sort((a, b) => {
    const [x1, y1] = a.split(',').map(Number);
    const [x2, y2] = b.split(',').map(Number);
    if (y1 !== y2) return y1 - y2;
    return x1 - x2;
  });

  // 3. Map position -> Clue Number
  const posToNumber = new Map<string, number>();
  sortedPositions.forEach((pos, index) => {
    posToNumber.set(pos, index + 1);
  });

  // 4. Assign numbers to items
  normalizedItems.forEach(item => {
    const key = `${item.startX},${item.startY}`;
    if (posToNumber.has(key)) {
      item.clueIndex = posToNumber.get(key);
    }
  });
  // ----------------------

  const width = maxX - minX;
  const height = maxY - minY;

  // Build cells
  const cells: GridCell[] = [];
  const cellsMap = new Map<string, GridCell>();

  normalizedItems.forEach(item => {
    for (let i = 0; i < item.length; i++) {
      const x = item.direction === 'horizontal' ? item.startX + i : item.startX;
      const y = item.direction === 'vertical' ? item.startY + i : item.startY;
      const key = `${x},${y}`;

      if (!cellsMap.has(key)) {
        const cell: GridCell = { x, y, value: item.answer[i], wordIds: [] };
        cellsMap.set(key, cell);
        cells.push(cell);
      }

      const cell = cellsMap.get(key)!;
      if (item.direction === 'horizontal') cell.horizontalItemId = item.uuid;
      else cell.verticalItemId = item.uuid;

      // Track all word IDs passing through this cell (for border styling)
      if (!cell.wordIds) cell.wordIds = [];
      if (!cell.wordIds.includes(item.uuid)) {
        cell.wordIds.push(item.uuid);
      }

      // If this is the start of the item, mark the cell with the number
      if (i === 0) {
        cell.clueNumber = item.clueIndex;
      }
    }
  });

  return {
    id: safeUUID(),
    title: 'Generated Puzzle',
    width,
    height,
    items: normalizedItems,
    cells
  };
};

const createEmptyPuzzle = (): PuzzleData => ({
  id: '', title: '', width: 0, height: 0, items: [], cells: []
});

/**
 * Live Generation: Retry/Flood Fill Algorithm with Generator
 *
 * Yields intermediate states of puzzle construction,
 * allowing the UI to animate the "live" building process.
 *
 * 1. Sort items by length (descending) for better initial placement
 * 2. Attempt to place all items in multiple passes
 * 3. Continue retrying until no progress is made
 * 4. Yield the placed items array after each successful placement
 */
export function* generatePuzzleSteps(
  items: PuzzleItem[]
): Generator<PlacedItem[], void, unknown> {
  if (items.length === 0) return;

  // Sort items by length (descending) - greedy heuristic
  const sortedItems = [...items].sort((a, b) => b.answer.length - a.answer.length);

  const placed: PlacedItem[] = [];
  const remaining = new Set(sortedItems.map(item => item.id));

  const first = sortedItems[0];
  const placedFirst = findPlacement(first, []);
  if (!placedFirst) return;
  placed.push(placedFirst);
  remaining.delete(first.id);
  yield [...placed];

  // Retry loop: Continue until no progress is made
  let madeProgress = true;
  const maxIterations = 100; // Safety limit to prevent infinite loops
  let iterations = 0;

  while (madeProgress && remaining.size > 0 && iterations < maxIterations) {
    madeProgress = false;
    iterations++;

    for (const item of sortedItems) {
      if (!remaining.has(item.id)) continue;

      const placement = findPlacement(item, placed);
      if (placement) {
        placed.push(placement);
        remaining.delete(item.id);
        madeProgress = true;
        yield [...placed];
      }
    }
  }

  // Final yield with all successfully placed items
  if (placed.length > 0) {
    yield [...placed];
  }
}

const shuffleByLength = (items: PuzzleItem[]): PuzzleItem[] =>
  [...items].sort((a, b) => {
    // 長さの差が大きい場合は長い方を優先、同じくらいならランダム
    const lengthDiff = b.answer.length - a.answer.length;
    if (Math.abs(lengthDiff) > 1) return lengthDiff;
    return Math.random() - 0.5;
  });

// 1回の試行。語を順に1度ずつ試したあと、置けなかった語を、置ける語が増えなくなるまで試し直す
// （先に試した時に交わる相手がまだ盤に無くて置けなかった語を拾う。Hop 決定 2026-10-05）。
// retry=false は試し直さない元の形（確かめの台本で比べるため）
// pinned は作る人が固定した語。先にその座標のまま置いてから残りを組む（つながらなくても固定は固定として置く）
export const tryPlaceAll = (shuffled: PuzzleItem[], retry: boolean = true, pinned: PlacedItem[] = []): PlacedItem[] => {
  const placed: PlacedItem[] = pinned.map((p) => ({ ...p, pinned: true }));
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const queue = shuffled.filter((i) => !pinnedIds.has(i.id));
  let from = 0;
  if (placed.length === 0) {
    if (queue.length === 0) return placed;
    const firstPlacement = findPlacement(queue[0], []);
    if (!firstPlacement) return placed;
    placed.push(firstPlacement);
    from = 1;
  }

  let rest: PuzzleItem[] = [];
  for (let i = from; i < queue.length; i++) {
    const placement = findPlacement(queue[i], placed);
    if (placement) placed.push(placement);
    else rest.push(queue[i]);
  }
  while (retry && rest.length > 0) {
    const next: PuzzleItem[] = [];
    for (const item of rest) {
      const placement = findPlacement(item, placed);
      if (placement) placed.push(placement);
      else next.push(item);
    }
    if (next.length === rest.length) break;
    rest = next;
  }
  return placed;
};

export { shuffleByLength };

// 置けた語が最多、同じなら面積（作る画面と同じ buildGrid の幅×高さ）が最小の方が良い
export const isBetterPlacement = (a: PlacedItem[], aArea: number, b: PlacedItem[] | null, bArea: number): boolean =>
  !b || a.length > b.length || (a.length === b.length && aArea < bArea);

// 本気の探索の時間の上限（ミリ秒・始めてからの経過）【仮】。実測（Chromium で200回ずつ・2026-10-05）で、全部置ける15語が
// 全部置けるまでに要った試行は最大19回・18ms。作る画面は100msごとに30msだけ探索するので、2000ms で約600ms ぶん回せる。
// これで約30倍遅い端末でも最大の例に届く。演出の5秒の中に収まるので待ち時間は増えない
export const SEARCH_TIME_LIMIT_MS = 2000;

export interface PuzzleSearch {
  /** budgetMs のあいだ試行を回す（画面が固まらないよう、呼ぶ側が刻んで呼ぶ） */
  step: (budgetMs: number) => void;
  attempts: () => number;
  best: () => PlacedItem[];
  bestArea: () => number;
  /** 全部の語が置けた盤が見つかった、または最初の step から時間の上限が過ぎた */
  finished: () => boolean;
  allPlaced: () => boolean;
  elapsedMs: () => number;
}

/**
 * 裏で走らせる本気の探索。全部の語が置けた盤が見つかるか、時間の上限に達するまで試行を続け、
 * 置けた語が最多・同じなら面積が最小の盤を持つ。演出の50回（generateMonteCarloSteps）とは別に回す
 */
export const createPuzzleSearch = (
  items: PuzzleItem[],
  timeLimitMs: number = SEARCH_TIME_LIMIT_MS,
  now: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  pinned: PlacedItem[] = []
): PuzzleSearch => {
  let attempts = 0;
  let best: PlacedItem[] = [];
  let bestArea = Infinity;
  let startedAt: number | null = null;
  const spent = () => (startedAt === null ? 0 : now() - startedAt);
  const all = () => items.length > 0 && best.length === items.length;
  const finished = () => items.length === 0 || all() || spent() >= timeLimitMs;
  return {
    step: (budgetMs: number) => {
      const t0 = now();
      if (startedAt === null) startedAt = t0;
      while (!finished() && now() - t0 < budgetMs) {
        const placed = tryPlaceAll(shuffleByLength(items), true, pinned);
        attempts++;
        if (placed.length > 0) {
          const g = buildGrid(placed);
          const area = g.width * g.height;
          if (isBetterPlacement(placed, area, best.length ? best : null, bestArea)) {
            best = placed;
            bestArea = area;
          }
        }
      }
    },
    attempts: () => attempts,
    best: () => best,
    bestArea: () => bestArea,
    finished,
    allPlaced: all,
    elapsedMs: spent,
  };
};

/**
 * モンテカルロ法を使用してパズル生成率を向上させる
 * 複数回試行して、最も多くの単語を配置できた結果を返す
 */
export const generateMaximizedPuzzle = (
  items: PuzzleItem[],
  attempts: number = 50,
  pinned: PlacedItem[] = []
): PlacedItem[] => {
  if (items.length === 0) return [];
  if (items.length === 1 && pinned.length === 0) {
    const placed = findPlacement(items[0], []);
    return placed ? [placed] : [];
  }

  let bestResult: PlacedItem[] = [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    const placed = tryPlaceAll(shuffleByLength(items), true, pinned);
    if (placed.length > bestResult.length) {
      bestResult = placed;
      // 全て配置できたら早期終了
      if (bestResult.length === items.length) break;
    }
  }

  return bestResult;
};

export interface MonteCarloStep {
  attempt: number;      // 現在の試行番号 (1-indexed)
  total: number;        // 総試行回数
  placed: PlacedItem[]; // 今回の試行で配置されたアイテム
  bestSoFar: PlacedItem[]; // これまでのベスト
  isLast: boolean;      // 最終結果かどうか
}

/**
 * モンテカルロ法 + 可視化アニメーション用ジェネレーター
 * 全ての試行結果を yield し、最後にベスト結果を返す
 */
export function* generateMonteCarloSteps(
  items: PuzzleItem[],
  attempts: number = 50,
  pinned: PlacedItem[] = []
): Generator<MonteCarloStep, void, unknown> {
  if (items.length === 0) {
    yield { attempt: 1, total: 1, placed: [], bestSoFar: [], isLast: true };
    return;
  }

  if (items.length === 1 && pinned.length === 0) {
    const placed = findPlacement(items[0], []);
    const result = placed ? [placed] : [];
    yield { attempt: 1, total: 1, placed: result, bestSoFar: result, isLast: true };
    return;
  }

  let bestResult: PlacedItem[] = [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    const placed = tryPlaceAll(shuffleByLength(items), true, pinned);
    if (placed.length > bestResult.length) {
      bestResult = [...placed];
    }

    yield {
      attempt: attempt + 1,
      total: attempts,
      placed,
      bestSoFar: bestResult,
      isLast: false
    };
  }

  yield {
    attempt: attempts,
    total: attempts,
    placed: bestResult,
    bestSoFar: bestResult,
    isLast: true
  };
}

// ---- 作る人が語を動かす（Hop 決定 2026-10-05・案A「つまんで動かす」） ----

/** 盤の語が全部1つにつながっているか（字を共有するマスでつながる） */
export const isConnected = (items: PlacedItem[]): boolean => {
  if (items.length <= 1) return true;
  const owner = new Map<string, number[]>();
  items.forEach((it, idx) => {
    for (let i = 0; i < it.length; i++) {
      const key = it.direction === 'horizontal' ? `${it.startX + i},${it.startY}` : `${it.startX},${it.startY + i}`;
      const list = owner.get(key);
      if (list) list.push(idx);
      else owner.set(key, [idx]);
    }
  });
  const seen = new Set<number>([0]);
  const stack = [0];
  while (stack.length) {
    const idx = stack.pop()!;
    const it = items[idx];
    for (let i = 0; i < it.length; i++) {
      const key = it.direction === 'horizontal' ? `${it.startX + i},${it.startY}` : `${it.startX},${it.startY + i}`;
      for (const o of owner.get(key) ?? []) if (!seen.has(o)) { seen.add(o); stack.push(o); }
    }
  }
  return seen.size === items.length;
};

/**
 * 盤の語（uuid）を (startX, startY) に動かせるか。向きは変えない。
 * 置ける条件は組み立てと同じ validatePlacement を、その語自身を除いた盤に対して確かめる。
 * 今の盤の枠の外へも動かせる（Hop 決定 2026-10-05。置いた後に buildGrid で座標をそろえ直すと盤が広がる）。
 * さらに島を作らない（Hop 決定 2026-10-05）: 動かした語は自分と逆向きの語と少なくとも1マス交わり（組み立ての findPlacement と同じ交わり方）、
 * 動かした後の盤が1つにつながっている（橋になっていた語を動かして、ほかの語が離れる時も断る）
 */
export const canMoveTo = (items: PlacedItem[], uuid: string, startX: number, startY: number): boolean => {
  const item = items.find((i) => i.uuid === uuid);
  if (!item) return false;
  const others = items.filter((i) => i.uuid !== uuid);
  const cand = { ...item, startX, startY };
  if (!validatePlacement(cand, others)) return false;
  const mine = new Set(Array.from({ length: cand.length }, (_, i) => (cand.direction === 'horizontal' ? `${startX + i},${startY}` : `${startX},${startY + i}`)));
  const crosses = others.some((o) => o.direction !== cand.direction && Array.from({ length: o.length }, (_, i) => (o.direction === 'horizontal' ? `${o.startX + i},${o.startY}` : `${o.startX},${o.startY + i}`)).some((k) => mine.has(k)));
  if (others.length > 0 && !crosses) return false;
  return isConnected([...others, cand]);
};

/** 動かして固定した盤の語の並び（動かせない時は null） */
export const moveItem = (items: PlacedItem[], uuid: string, startX: number, startY: number): PlacedItem[] | null =>
  canMoveTo(items, uuid, startX, startY)
    ? items.map((i) => (i.uuid === uuid ? { ...i, startX, startY, pinned: true } : i))
    : null;
