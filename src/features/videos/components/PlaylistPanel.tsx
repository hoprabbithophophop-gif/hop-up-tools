import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useChapterPlaylistContext } from '../context/ChapterPlaylistContext';
import { ChapterPlayer } from './ChapterPlayer';
import { ChapterPlaylist } from './ChapterPlaylist';
import { SharePlaylistDialog } from './SharePlaylistDialog';

export function PlaylistPanel() {
  const { state, playNext, playPrev, jumpTo, toggleShuffle, toggleRepeat, clearQueue, pause, resume } =
    useChapterPlaylistContext();
  const { queue, currentIndex, isPlaying, isShuffled, repeatMode } = state;

  // 再生/一時停止/再起動ハンドラ
  const handlePlayPause = () => {
    if (isPlaying) {
      pause();
    } else if (currentIndex === null && queue.length > 0) {
      // キュー末尾まで再生済み → 先頭から再起動
      jumpTo(0);
    } else {
      resume();
    }
  };
  const [expanded, setExpanded] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // キューが空→非空になったとき自動展開（YouTube player を visible な状態で初期化するため）
  const prevQueueLengthRef = useRef(queue.length);
  useEffect(() => {
    if (prevQueueLengthRef.current === 0 && queue.length > 0) {
      setExpanded(true);
    }
    prevQueueLengthRef.current = queue.length;
  }, [queue.length]);

  if (queue.length === 0) return null;

  const current = currentIndex !== null ? queue[currentIndex] : null;

  return createPortal(
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-outline-variant/20 shadow-lg [transition:none]">
      {/* 展開コンテンツ: ChapterPlayer は常にDOMに保持（IFrame維持のため）、collapsed時は hidden */}
      <div className={`flex flex-col md:flex-row overflow-hidden border-b border-outline-variant/20 [transition:none] ${expanded ? 'max-h-[60vh] md:max-h-80' : 'hidden'}`}>
        {/* プレイヤー: always rendered */}
        <div className="md:w-96 shrink-0">
          <ChapterPlayer />
        </div>
        {/* キュー一覧: expanded のみ */}
        {expanded && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-outline-variant/10 flex items-center justify-between">
              <span className="text-[0.6rem] font-bold uppercase tracking-widest text-outline">
                再生キュー ({queue.length}件)
              </span>
            </div>
            <ChapterPlaylist />
          </div>
        )}
      </div>

      {/* コントロールバー */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* 展開トグル */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-[0.6rem] font-bold uppercase tracking-widest text-outline hover:text-primary transition-colors cursor-pointer shrink-0"
          title={expanded ? '折りたたむ' : '展開する'}
        >
          {expanded ? '▼' : '▲'}
        </button>

        {/* 現在再生中の情報（折りたたみ時のみ） */}
        {!expanded && (
          <div className="flex-1 min-w-0">
            {current ? (
              <>
                <p className="text-[0.65rem] font-bold text-on-surface truncate">
                  {current.chapterLabel}
                </p>
                <p className="text-[0.55rem] text-outline truncate">
                  {current.videoTitle}
                </p>
              </>
            ) : (
              <p className="text-[0.65rem] text-outline">
                {queue.length}件 キューに追加済み
              </p>
            )}
          </div>
        )}

        {expanded && <div className="flex-1" />}

        {/* 再生コントロール */}
        <div className="flex items-center gap-3 shrink-0">
          {/* 前へ */}
          <button
            onClick={playPrev}
            disabled={currentIndex === null || currentIndex === 0}
            className="text-xs text-outline hover:text-primary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title="前のチャプター"
          >
            ◄◄
          </button>

          {/* 再生/一時停止（queue終了後は先頭から再起動） */}
          <button
            onClick={handlePlayPause}
            className="w-8 h-8 flex items-center justify-center bg-primary text-on-primary-fixed text-xs font-bold cursor-pointer hover:bg-secondary transition-colors"
            title={isPlaying ? '一時停止' : (currentIndex === null ? '先頭から再生' : '再生')}
          >
            {isPlaying ? '❚❚' : '▶'}
          </button>

          {/* 次へ */}
          <button
            onClick={playNext}
            disabled={currentIndex === null || currentIndex >= queue.length - 1}
            className="text-xs text-outline hover:text-primary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title="次のチャプター"
          >
            ►►
          </button>

          {/* シャッフル */}
          <button
            onClick={toggleShuffle}
            className={`text-xs transition-colors cursor-pointer ${
              isShuffled ? 'text-primary' : 'text-outline hover:text-primary'
            }`}
            title={isShuffled ? 'シャッフルOFF' : 'シャッフルON'}
          >
            🔀
          </button>

          {/* リピート */}
          <button
            onClick={toggleRepeat}
            className={`text-xs transition-colors cursor-pointer ${
              repeatMode === 'all' ? 'text-primary' : 'text-outline hover:text-primary'
            }`}
            title={repeatMode === 'all' ? 'リピートOFF' : 'リピートON'}
          >
            🔁
          </button>

          {/* 共有 */}
          <button
            onClick={() => setShareOpen(true)}
            className="text-[0.6rem] font-bold uppercase tracking-widest text-outline hover:text-primary transition-colors cursor-pointer"
            title="プレイリストを共有"
          >
            📤
          </button>

          {/* クリア */}
          <button
            onClick={clearQueue}
            className="text-[0.6rem] font-bold uppercase tracking-widest text-outline hover:text-primary transition-colors cursor-pointer"
            title="キューをクリア"
          >
            ✕
          </button>
        </div>
      </div>

      {shareOpen && (
        <SharePlaylistDialog
          queue={queue}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>,
    document.body
  );
}
