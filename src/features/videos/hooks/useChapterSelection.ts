import { useState, useCallback } from 'react';
import type { ChapterQueueItem } from '../types/playlist';

export interface UseChapterSelectionReturn {
  /** 選択中のIDの配列（選択した順番を保持） */
  selectedIds: string[];
  /** 選択/解除をトグル（選択時は末尾に追加、解除時は除去） */
  toggleSelection: (id: string, item?: ChapterQueueItem) => void;
  /** 全選択解除 */
  clearSelection: () => void;
  /** 選択件数 */
  selectionCount: number;
  /** 指定IDが選択中か判定 */
  isSelected: (id: string) => boolean;
  /** 指定IDの選択番号を取得（1始まり。未選択なら0） */
  getSelectionNumber: (id: string) => number;
  /** 選択順にChapterQueueItemの配列を返す（クロスサーチ対応） */
  getSelectedItemsInOrder: () => ChapterQueueItem[];
}

export function useChapterSelection(): UseChapterSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // クロスサーチ選択対応: IDだけでなくアイテム本体も保持
  const [selectedItems, setSelectedItems] = useState<Map<string, ChapterQueueItem>>(new Map());

  const toggleSelection = useCallback((id: string, item?: ChapterQueueItem) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      } else {
        return [...prev, id];
      }
    });
    if (item) {
      setSelectedItems((prev) => {
        const next = new Map(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.set(id, item);
        }
        return next;
      });
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    setSelectedItems(new Map());
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.includes(id),
    [selectedIds]
  );

  const getSelectionNumber = useCallback(
    (id: string) => {
      const index = selectedIds.indexOf(id);
      return index === -1 ? 0 : index + 1;
    },
    [selectedIds]
  );

  const getSelectedItemsInOrder = useCallback((): ChapterQueueItem[] => {
    return selectedIds
      .map((id) => selectedItems.get(id))
      .filter((item): item is ChapterQueueItem => item !== undefined);
  }, [selectedIds, selectedItems]);

  return {
    selectedIds,
    toggleSelection,
    clearSelection,
    selectionCount: selectedIds.length,
    isSelected,
    getSelectionNumber,
    getSelectedItemsInOrder,
  };
}
