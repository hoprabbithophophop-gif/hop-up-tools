import React, { createContext, useContext, useEffect, useRef, useCallback, useMemo } from 'react';
import { useChapterPlaylist, type UseChapterPlaylistReturn } from '../hooks/useChapterPlaylist';
import { useYouTubePlayer } from '../hooks/useYouTubePlayer';
import { useChapterSelection, type UseChapterSelectionReturn } from '../hooks/useChapterSelection';
import type { ChapterQueueItem } from '../types/playlist';
import { shuffleArray, type SearchResultItem } from '../utils/playlist-utils';

interface ChapterPlaylistContextValue extends UseChapterPlaylistReturn {
  playerReady: boolean;
  pause: () => void;
  resume: () => void;
  getCurrentTime: () => number;
  selection: UseChapterSelectionReturn;
  /** 選択した順番でキューを構築して再生開始 */
  startInSelectionOrder: () => void;
  /** シャッフル順でキューを構築して再生開始 */
  startShuffled: () => void;
}

const ChapterPlaylistContext = createContext<ChapterPlaylistContextValue | null>(null);

export function ChapterPlaylistProvider({
  children,
  initialQueue,
}: {
  children: React.ReactNode;
  initialQueue?: import('../types/playlist').ChapterQueueItem[];
}) {
  const playlist = useChapterPlaylist();
  const { state, playNext, setPlaying, startPlaylist } = playlist;
  const selection = useChapterSelection();

  const handleChapterEnd = () => {
    playNext();
  };

  const handleError = () => {
    playNext();
  };

  const { isReady, playChapter, pause, resume, getCurrentTime } = useYouTubePlayer({
    onChapterEnd: handleChapterEnd,
    onError: handleError,
    // キューにアイテムが入ったタイミングで #chapter-player div が DOM に存在する
    enabled: state.queue.length > 0,
  });

  // 共有URLから復元されたキューを初期ロード
  const initialQueueLoadedRef = useRef(false);
  useEffect(() => {
    if (initialQueue && initialQueue.length > 0 && !initialQueueLoadedRef.current) {
      initialQueueLoadedRef.current = true;
      playlist.startPlaylist(initialQueue);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prevIndexRef = useRef<number | null>(null);
  const prevQueueLengthRef = useRef<number>(0);
  const prevIsReadyRef = useRef<boolean>(false);
  const prevVideoIdRef = useRef<string | null>(null);

  useEffect(() => {
    const { currentIndex, queue, isPlaying } = state;

    const currentItem = currentIndex !== null ? queue[currentIndex] ?? null : null;
    const currentVideoId = currentItem?.videoId ?? null;

    const indexChanged = currentIndex !== prevIndexRef.current;
    const wasEmpty = prevQueueLengthRef.current === 0 && queue.length > 0;
    // isReady が false→true に変わった瞬間（プレイヤー初期化完了）
    const justBecameReady = isReady && !prevIsReadyRef.current;
    // START_PLAYLIST で同じ index(0→0) のまま別動画に差し替えられたケース
    const videoIdChanged = currentVideoId !== prevVideoIdRef.current;

    prevIndexRef.current = currentIndex;
    prevQueueLengthRef.current = queue.length;
    prevIsReadyRef.current = isReady;
    prevVideoIdRef.current = currentVideoId;

    if (!isReady) return;

    if (currentIndex !== null && (indexChanged || wasEmpty || justBecameReady || videoIdChanged) && isPlaying) {
      const item = queue[currentIndex];
      if (item) {
        playChapter(item.videoId, item.startSeconds, item.endSeconds);
      }
    }
  }, [state, isReady, playChapter]);

  const handlePause = useCallback(() => {
    pause();
    setPlaying(false);
  }, [pause, setPlaying]);

  const handleResume = useCallback(() => {
    resume();
    setPlaying(true);
  }, [resume, setPlaying]);

  const startInSelectionOrder = useCallback(() => {
    const items = selection.getSelectedItemsInOrder();
    if (items.length === 0) return;
    startPlaylist(items);
  }, [selection, startPlaylist]);

  const startShuffled = useCallback(() => {
    const items = shuffleArray(selection.getSelectedItemsInOrder());
    if (items.length === 0) return;
    startPlaylist(items);
  }, [selection, startPlaylist]);

  // キューをクリアするときは選択状態も合わせてリセット
  const handleClearQueue = useCallback(() => {
    playlist.clearQueue();
    selection.clearSelection();
  }, [playlist, selection]);

  // Context value をメモ化して不要な consumer 再レンダーを防ぐ
  const contextValue = useMemo<ChapterPlaylistContextValue>(() => ({
    ...playlist,
    clearQueue: handleClearQueue,
    playerReady: isReady,
    pause: handlePause,
    resume: handleResume,
    getCurrentTime,
    selection,
    startInSelectionOrder,
    startShuffled,
  }), [playlist, handleClearQueue, isReady, handlePause, handleResume, getCurrentTime, selection, startInSelectionOrder, startShuffled]);

  return (
    <ChapterPlaylistContext.Provider value={contextValue}>
      {children}
    </ChapterPlaylistContext.Provider>
  );
}

export function useChapterPlaylistContext(): ChapterPlaylistContextValue {
  const ctx = useContext(ChapterPlaylistContext);
  if (!ctx) throw new Error('useChapterPlaylistContext must be used within ChapterPlaylistProvider');
  return ctx;
}
