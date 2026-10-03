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

const validatePlacement = (candidate: PlacedItem, placedItems: PlacedItem[]): boolean => {
  // Map of candidate cells: coordinate -> value
  const candidateCells = new Map<string, string>();
  for (let i = 0; i < candidate.length; i++) {
    const cx = candidate.direction === 'horizontal' ? candidate.startX + i : candidate.startX;
    const cy = candidate.direction === 'vertical' ? candidate.startY + i : candidate.startY;
    candidateCells.set(`${cx},${cy}`, candidate.answer[i]);
  }

  // Map of existing cells: coordinate -> value
  const existingCells = new Map<string, string>();
  for (const existing of placedItems) {
    for (let i = 0; i < existing.length; i++) {
      const ex = existing.direction === 'horizontal' ? existing.startX + i : existing.startX;
      const ey = existing.direction === 'vertical' ? existing.startY + i : existing.startY;
      existingCells.set(`${ex},${ey}`, existing.answer[i]);
    }
  }

  // 交差する場所では文字が完全に一致しなければならない
  const intersectionPoints = new Set<string>();

  for (const [coord, candidateValue] of candidateCells) {
    if (existingCells.has(coord)) {
      if (candidateValue !== existingCells.get(coord)) return false;
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
    maxX = Math.max(maxX, (item.direction === 'horizontal' ? item.startX + item.length : item.startX));
    maxY = Math.max(maxY, (item.direction === 'vertical' ? item.startY + item.length : item.startY));
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

const tryPlaceAll = (shuffled: PuzzleItem[]): PlacedItem[] => {
  const placed: PlacedItem[] = [];
  const firstPlacement = findPlacement(shuffled[0], []);
  if (!firstPlacement) return placed;
  placed.push(firstPlacement);

  for (let i = 1; i < shuffled.length; i++) {
    const placement = findPlacement(shuffled[i], placed);
    if (placement) placed.push(placement);
  }
  return placed;
};

/**
 * モンテカルロ法を使用してパズル生成率を向上させる
 * 複数回試行して、最も多くの単語を配置できた結果を返す
 */
export const generateMaximizedPuzzle = (
  items: PuzzleItem[],
  attempts: number = 50
): PlacedItem[] => {
  if (items.length === 0) return [];
  if (items.length === 1) {
    const placed = findPlacement(items[0], []);
    return placed ? [placed] : [];
  }

  let bestResult: PlacedItem[] = [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    const placed = tryPlaceAll(shuffleByLength(items));
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
  attempts: number = 50
): Generator<MonteCarloStep, void, unknown> {
  if (items.length === 0) {
    yield { attempt: 1, total: 1, placed: [], bestSoFar: [], isLast: true };
    return;
  }

  if (items.length === 1) {
    const placed = findPlacement(items[0], []);
    const result = placed ? [placed] : [];
    yield { attempt: 1, total: 1, placed: result, bestSoFar: result, isLast: true };
    return;
  }

  let bestResult: PlacedItem[] = [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    const placed = tryPlaceAll(shuffleByLength(items));
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
