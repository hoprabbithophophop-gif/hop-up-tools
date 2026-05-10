import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useChapterPlaylist, type UseChapterPlaylistReturn } from '../hooks/useChapterPlaylist';
import { useYouTubePlayer } from '../hooks/useYouTubePlayer';
import { useChapterSelection, type UseChapterSelectionReturn } from '../hooks/useChapterSelection';
import { saveToPlayHistory } from '../hooks/usePlayHistory';
import type { ChapterQueueItem } from '../types/playlist';
import { shuffleArray, type SearchResultItem } from '../utils/playlist-utils';
import { getSupabase } from '../../../lib/supabase';

interface ChapterPlaylistContextValue extends UseChapterPlaylistReturn {
  playerReady: boolean;
  isTransitioning: boolean;
  pause: () => void;
  resume: () => void;
  getCurrentTime: () => number;
  /** タップハンドラー内から直接呼ぶことでモバイルautoplay制限を回避する */
  playChapter: (videoId: string, startSeconds: number, endSeconds: number) => void;
  selection: UseChapterSelectionReturn;
  /** 選択した順番でキューを構築して再生開始 */
  startInSelectionOrder: () => void;
  /** シャッフル順でキューを構築して再生開始 */
  startShuffled: () => void;
  /** 再生中チャプターバーが展開状態か（HOME・PLAYLISTで共有） */
  chapterBarExpanded: boolean;
  toggleChapterBar: () => void;
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
  const { state, playNext, setPlaying, startPlaylist, backfillPublishedAt } = playlist;
  const selection = useChapterSelection();

  const handleChapterEnd = () => {
    playNext();
  };

  const handleError = () => {
    playNext();
  };

  const handlePlayStateChange = useCallback((isPlaying: boolean) => {
    setPlaying(isPlaying);
  }, [setPlaying]);

  const { isReady, isTransitioning, playChapter, pause, resume, getCurrentTime } = useYouTubePlayer({
    onChapterEnd: handleChapterEnd,
    onError: handleError,
    onPlayStateChange: handlePlayStateChange,
    enabled: true,
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
        saveToPlayHistory(item);
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

  // 投稿日が欠損しているキュー項目を Supabase から再取得して backfill する
  // (publishedAt 追加前に保存された古いキュー項目・古い共有プレイリスト向け)
  const backfillTriedRef = useRef<Set<string>>(new Set());
  const unmountedRef = useRef(false);
  useEffect(() => () => { unmountedRef.current = true; }, []);
  useEffect(() => {
    const missing = state.queue
      .filter(i => !i.publishedAt && !backfillTriedRef.current.has(i.videoId))
      .map(i => i.videoId);
    const unique = Array.from(new Set(missing));
    if (unique.length === 0) return;
    unique.forEach(id => backfillTriedRef.current.add(id));

    (async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('youtube_videos')
        .select('video_id, published_at')
        .in('video_id', unique);
      if (unmountedRef.current || error || !data) return;
      const map: Record<string, string> = {};
      for (const r of data as { video_id: string; published_at: string | null }[]) {
        if (r.published_at) map[r.video_id] = r.published_at;
      }
      if (Object.keys(map).length > 0) {
        backfillPublishedAt(map);
      }
    })();
  }, [state.queue, backfillPublishedAt]);

  // キュー終端でプレイヤーを停止（音だけ残る問題対策）
  // チャプターポーリングでendSecondsを越えるとplayNext→NEXT reducerが走り、
  // キュー末尾なら currentIndex=null になる。が、player.pauseVideo()は呼ばれないので
  // iframe内では動画が再生継続して音だけ残る → このeffectで明示的に停止する。
  const prevCurrentIndexForStopRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevCurrentIndexForStopRef.current;
    prevCurrentIndexForStopRef.current = state.currentIndex;
    if (prev !== null && state.currentIndex === null) {
      pause();
    }
  }, [state.currentIndex, pause]);

  // 再生中チャプターバーの展開状態 (HOME・PLAYLIST共有)
  const [chapterBarExpanded, setChapterBarExpanded] = useState(false);
  const toggleChapterBar = useCallback(() => setChapterBarExpanded(v => !v), []);
  const currentItemIdForBar = state.currentIndex !== null
    ? state.queue[state.currentIndex]?.id ?? null
    : null;
  useEffect(() => {
    setChapterBarExpanded(false);
  }, [currentItemIdForBar]);

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
    isTransitioning,
    pause: handlePause,
    resume: handleResume,
    getCurrentTime,
    playChapter,
    selection,
    startInSelectionOrder,
    startShuffled,
    chapterBarExpanded,
    toggleChapterBar,
  }), [playlist, handleClearQueue, isReady, isTransitioning, handlePause, handleResume, getCurrentTime, playChapter, selection, startInSelectionOrder, startShuffled, chapterBarExpanded, toggleChapterBar]);

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
