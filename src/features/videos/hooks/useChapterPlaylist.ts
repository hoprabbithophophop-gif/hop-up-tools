import { useReducer, useCallback, useEffect } from 'react';
import type { ChapterQueueItem, ChapterPlaylistState, PlaylistAction } from '../types/playlist';
import {
  buildChapterQueueItems,
  buildSingleChapterQueueItem,
  shuffleArray,
} from '../utils/playlist-utils';

interface VideoRow {
  video_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  duration_seconds?: number | null;
}

interface Chapter {
  seconds: number;
  label: string;
  timestamp: string;
}

const QUEUE_STORAGE_KEY = 'hop-yt-queue';

function loadSavedQueue(): ChapterQueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: ChapterQueueItem) => ({
      ...item,
      endSeconds:
        item.endSeconds == null || item.endSeconds <= 0
          ? Number.MAX_SAFE_INTEGER
          : item.endSeconds,
    }));
  } catch {
    return [];
  }
}

function saveQueue(queue: ChapterQueueItem[]) {
  try {
    if (queue.length === 0) {
      localStorage.removeItem(QUEUE_STORAGE_KEY);
    } else {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    }
  } catch {}
}

const initialState: ChapterPlaylistState = {
  queue: [],
  currentIndex: null,
  isPlaying: false,
  isShuffled: false,
  originalQueue: [],
  repeatMode: 'none',
};

function playlistReducer(
  state: ChapterPlaylistState,
  action: PlaylistAction
): ChapterPlaylistState {
  switch (action.type) {
    case 'ADD_ITEM': {
      return { ...state, queue: [...state.queue, action.item] };
    }
    case 'ADD_ITEMS': {
      if (action.items.length === 0) return state;
      return { ...state, queue: [...state.queue, ...action.items] };
    }
    case 'START_PLAYLIST': {
      if (action.items.length === 0) return state;
      return {
        ...initialState,
        queue: action.items,
        currentIndex: 0,
        isPlaying: true,
      };
    }
    case 'REMOVE_ITEM': {
      const idx = state.queue.findIndex(i => i.id === action.id);
      if (idx === -1) return state;
      const newQueue = [...state.queue];
      newQueue.splice(idx, 1);
      let newCurrentIndex = state.currentIndex;
      if (newCurrentIndex !== null) {
        if (idx === newCurrentIndex) {
          // 再生中のアイテムを削除: 同位置のアイテムへ（存在すれば）
          newCurrentIndex = newQueue.length > 0
            ? Math.min(newCurrentIndex, newQueue.length - 1)
            : null;
        } else if (idx < newCurrentIndex) {
          newCurrentIndex = newCurrentIndex - 1;
        }
      }
      return { ...state, queue: newQueue, currentIndex: newCurrentIndex };
    }
    case 'SET_CURRENT': {
      if (action.index < 0 || action.index >= state.queue.length) return state;
      return { ...state, currentIndex: action.index, isPlaying: true };
    }
    case 'NEXT': {
      if (state.queue.length === 0) return state;
      const nextIndex = state.currentIndex === null
        ? 0
        : state.currentIndex + 1;
      if (nextIndex >= state.queue.length) {
        // リピートONなら先頭に戻る
        if (state.repeatMode === 'all') {
          return { ...state, currentIndex: 0, isPlaying: true };
        }
        return { ...state, currentIndex: null, isPlaying: false };
      }
      return { ...state, currentIndex: nextIndex, isPlaying: true };
    }
    case 'PREV': {
      if (state.queue.length === 0) return state;
      const prevIndex = state.currentIndex === null
        ? 0
        : Math.max(0, state.currentIndex - 1);
      return { ...state, currentIndex: prevIndex, isPlaying: true };
    }
    case 'TOGGLE_REPEAT': {
      return { ...state, repeatMode: state.repeatMode === 'none' ? 'all' : 'none' };
    }
    case 'TOGGLE_SHUFFLE': {
      if (!state.isShuffled) {
        const shuffled = shuffleArray(state.queue);
        const currentItem = state.currentIndex !== null
          ? state.queue[state.currentIndex]
          : null;
        const newCurrentIndex = currentItem
          ? shuffled.findIndex(i => i.id === currentItem.id)
          : null;
        return {
          ...state,
          isShuffled: true,
          originalQueue: state.queue,
          queue: shuffled,
          currentIndex: newCurrentIndex,
        };
      } else {
        const currentItem = state.currentIndex !== null
          ? state.queue[state.currentIndex]
          : null;
        const restored = state.originalQueue.length > 0
          ? state.originalQueue
          : state.queue;
        const newCurrentIndex = currentItem
          ? restored.findIndex(i => i.id === currentItem.id)
          : null;
        return {
          ...state,
          isShuffled: false,
          originalQueue: [],
          queue: restored,
          currentIndex: newCurrentIndex,
        };
      }
    }
    case 'CLEAR': {
      return initialState;
    }
    case 'SET_PLAYING': {
      return { ...state, isPlaying: action.isPlaying };
    }
    case 'REORDER': {
      const { fromIndex, toIndex } = action;
      if (fromIndex === toIndex) return state;
      const newQueue = [...state.queue];
      const [moved] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, moved);
      let newCurrentIndex = state.currentIndex;
      if (newCurrentIndex !== null) {
        if (newCurrentIndex === fromIndex) {
          newCurrentIndex = toIndex;
        } else if (fromIndex < newCurrentIndex && toIndex >= newCurrentIndex) {
          newCurrentIndex--;
        } else if (fromIndex > newCurrentIndex && toIndex <= newCurrentIndex) {
          newCurrentIndex++;
        }
      }
      return { ...state, queue: newQueue, currentIndex: newCurrentIndex };
    }
    case 'INSERT_NEXT': {
      const insertAt = state.currentIndex !== null ? state.currentIndex + 1 : 0;
      const newQueue = [...state.queue];
      newQueue.splice(insertAt, 0, action.item);
      return { ...state, queue: newQueue };
    }
    case 'TRIM_ITEM': {
      return {
        ...state,
        queue: state.queue.map(item =>
          item.id === action.id
            ? { ...item, startSeconds: action.startSeconds, endSeconds: action.endSeconds }
            : item
        ),
      };
    }
    default:
      return state;
  }
}

export interface UseChapterPlaylistReturn {
  state: ChapterPlaylistState;
  addItem: (item: ChapterQueueItem) => void;
  insertNext: (item: ChapterQueueItem) => void;
  addToQueue: (video: VideoRow, chapters: Chapter[], chapterIndex: number) => void;
  addAllToQueue: (video: VideoRow, chapters: Chapter[]) => void;
  startPlaylist: (items: ChapterQueueItem[]) => void;
  appendItems: (items: ChapterQueueItem[]) => void;
  removeFromQueue: (id: string) => void;
  jumpTo: (index: number) => void;
  playNext: () => void;
  playPrev: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  clearQueue: () => void;
  setPlaying: (isPlaying: boolean) => void;
  reorder: (fromIndex: number, toIndex: number) => void;
  trimItem: (id: string, startSeconds: number, endSeconds: number) => void;
}

export function useChapterPlaylist(): UseChapterPlaylistReturn {
  const [state, dispatch] = useReducer(playlistReducer, null, (): ChapterPlaylistState => ({
    ...initialState,
    queue: loadSavedQueue(),
  }));

  useEffect(() => {
    saveQueue(state.queue);
  }, [state.queue]);

  const addItem = useCallback((item: ChapterQueueItem) => {
    const uid = `${item.id}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    dispatch({ type: 'ADD_ITEM', item: { ...item, id: uid } });
  }, []);

  const insertNext = useCallback((item: ChapterQueueItem) => {
    const uid = `${item.id}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    dispatch({ type: 'INSERT_NEXT', item: { ...item, id: uid } });
  }, []);

  const addToQueue = useCallback((video: VideoRow, chapters: Chapter[], chapterIndex: number) => {
    const item = buildSingleChapterQueueItem(video, chapters, chapterIndex);
    const uid = `${item.id}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    dispatch({ type: 'ADD_ITEM', item: { ...item, id: uid } });
  }, []);

  const addAllToQueue = useCallback((video: VideoRow, chapters: Chapter[]) => {
    const items = buildChapterQueueItems(video, chapters).map(item => ({
      ...item,
      id: `${item.id}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    }));
    dispatch({ type: 'ADD_ITEMS', items });
  }, []);

  const startPlaylist = useCallback((items: ChapterQueueItem[]) => {
    dispatch({ type: 'START_PLAYLIST', items });
  }, []);

  const appendItems = useCallback((items: ChapterQueueItem[]) => {
    const withUids = items.map(item => ({
      ...item,
      id: `${item.id}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    }));
    dispatch({ type: 'ADD_ITEMS', items: withUids });
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_ITEM', id });
  }, []);

  const jumpTo = useCallback((index: number) => {
    dispatch({ type: 'SET_CURRENT', index });
  }, []);

  const playNext = useCallback(() => {
    dispatch({ type: 'NEXT' });
  }, []);

  const playPrev = useCallback(() => {
    dispatch({ type: 'PREV' });
  }, []);

  const toggleShuffle = useCallback(() => {
    dispatch({ type: 'TOGGLE_SHUFFLE' });
  }, []);

  const toggleRepeat = useCallback(() => {
    dispatch({ type: 'TOGGLE_REPEAT' });
  }, []);

  const clearQueue = useCallback(() => {
    dispatch({ type: 'CLEAR' });
  }, []);

  const setPlaying = useCallback((isPlaying: boolean) => {
    dispatch({ type: 'SET_PLAYING', isPlaying });
  }, []);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    dispatch({ type: 'REORDER', fromIndex, toIndex });
  }, []);

  const trimItem = useCallback((id: string, startSeconds: number, endSeconds: number) => {
    dispatch({ type: 'TRIM_ITEM', id, startSeconds, endSeconds });
  }, []);

  return {
    state,
    addItem,
    insertNext,
    addToQueue,
    addAllToQueue,
    startPlaylist,
    appendItems,
    removeFromQueue,
    jumpTo,
    playNext,
    playPrev,
    toggleShuffle,
    toggleRepeat,
    clearQueue,
    setPlaying,
    reorder,
    trimItem,
  };
}
