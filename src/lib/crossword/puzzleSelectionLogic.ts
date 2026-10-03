import type { PuzzleData, PlacedItem } from './types';

interface SelectionInput {
  puzzle: PuzzleData;
  clickedX: number;
  clickedY: number;
  currentActiveCell: { x: number; y: number } | null;
  currentDirection: 'horizontal' | 'vertical';
}

interface SelectionResult {
  item: PlacedItem;
  direction: 'horizontal' | 'vertical';
}

/**
 * Determines the next word item and direction based on user click.
 * Implements toggle logic on same-cell click and direction persistence.
 */
export function determineNextSelection({
  puzzle,
  clickedX,
  clickedY,
  currentActiveCell,
  currentDirection
}: SelectionInput): SelectionResult | null {

  // Helper to find items at cell
  const getItemsAt = (x: number, y: number) => {
    const hItem = puzzle.items.find(item =>
      item.direction === 'horizontal' &&
      y === item.startY &&
      x >= item.startX &&
      x < item.startX + item.length
    );
    const vItem = puzzle.items.find(item =>
      item.direction === 'vertical' &&
      x === item.startX &&
      y >= item.startY &&
      y < item.startY + item.length
    );
    return { hItem, vItem };
  };

  const { hItem, vItem } = getItemsAt(clickedX, clickedY);

  if (!hItem && !vItem) return null;

  // Check if same cell clicked
  const isSameCell = currentActiveCell?.x === clickedX && currentActiveCell?.y === clickedY;

  if (isSameCell) {
    // Toggle logic
    if (currentDirection === 'horizontal') {
        // If currently Horizontal, prefer Vertical if available
        if (vItem) return { item: vItem, direction: 'vertical' };
        if (hItem) return { item: hItem, direction: 'horizontal' };
    } else {
        // If currently Vertical, prefer Horizontal if available
        if (hItem) return { item: hItem, direction: 'horizontal' };
        if (vItem) return { item: vItem, direction: 'vertical' };
    }
  }

  // Different cell or direction not applicable: Prioritize current direction
  if (currentDirection === 'horizontal') {
      if (hItem) return { item: hItem, direction: 'horizontal' };
      if (vItem) return { item: vItem, direction: 'vertical' };
  } else {
      if (vItem) return { item: vItem, direction: 'vertical' };
      if (hItem) return { item: hItem, direction: 'horizontal' };
  }

  // Fallback (should be covered above)
  const fallback = (hItem || vItem) as PlacedItem | undefined; // 型の絞り込みで never になるのを避ける（動きは同じ）
  if(fallback) return { item: fallback, direction: fallback.direction };

  return null;
}
