import React from 'react';
import { useChapterPlaylistContext } from '../context/ChapterPlaylistContext';

export function ChapterPlayer() {
  const { state, playerReady, pause, resume } = useChapterPlaylistContext();
  const { queue, currentIndex, isPlaying } = state;
  const current = currentIndex !== null ? queue[currentIndex] : null;

  return (
    <div className="flex flex-col">
      {/* YouTube IFrame コンテナ */}
      <div className="w-full aspect-video bg-black relative [transition:none]">
        <div id="chapter-player" className="w-full h-full [transition:none]" />
        {!playerReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <span className="text-[0.65rem] text-white/50 uppercase tracking-widest">Loading player...</span>
          </div>
        )}
      </div>

      {/* 現在再生中の情報 */}
      <div className="px-3 py-2 bg-surface-container-low flex items-center gap-3">
        {current ? (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-[0.7rem] font-bold text-on-surface truncate">
                {current.chapterLabel}
              </p>
              {!current.isFullVideo && (
                <p className="text-[0.6rem] text-outline truncate">
                  {current.videoTitle}
                </p>
              )}
            </div>
            <button
              onClick={isPlaying ? pause : resume}
              className="shrink-0 w-7 h-7 flex items-center justify-center bg-primary text-on-primary-fixed text-xs cursor-pointer hover:bg-secondary transition-colors"
              title={isPlaying ? '一時停止' : '再生'}
            >
              {isPlaying ? '❚❚' : '▶'}
            </button>
          </>
        ) : (
          <p className="text-[0.65rem] text-outline uppercase tracking-widest">
            アイテムを選択して再生
          </p>
        )}
      </div>
    </div>
  );
}
