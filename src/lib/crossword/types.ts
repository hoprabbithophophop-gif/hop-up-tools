export interface PuzzleItem {
  id: string;
  question: string; // The "clue" text
  answer: string[]; // One character per cell
}

export interface PlacedItem extends PuzzleItem {
  uuid: string; // Unique instance ID in the grid
  direction: 'horizontal' | 'vertical';
  startX: number;
  startY: number;
  length: number;
  clueIndex?: number;
  pinned?: boolean; // 作る人が動かして固定した語（作る画面だけ。保存の本文には入れない）
}

export interface GridCell {
  x: number;
  y: number;
  value: string;

  // References to the items passing through this cell
  horizontalItemId?: string;
  verticalItemId?: string;
  wordIds?: string[]; // All word UUIDs passing through this cell (for border styling)

  // State for gameplay
  isClue?: boolean; // If true, this cell might be pre-filled or hint
  clueNumber?: number;
  userValue?: string;
  isCorrect?: boolean;
  isMystery?: boolean; // Mystery Keyword cell (Double frame)
}

export interface PuzzleData {
  id: string;
  title: string;
  creatorName?: string;
  mysteryWord?: string; // Optional mystery keyword answer
  isHidden?: boolean; // For moderation (hide inappropriate puzzles)
  width: number;
  height: number;
  items: PlacedItem[];
  cells: GridCell[]; // Flattened grid for easy rendering
}
