import React from 'react';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { formatSeconds } from '../../videos/utils/playlist-utils';

export function QueueList() {
  const { state, jumpTo, removeFromQueue } = useChapterPlaylistContext();
  const { queue, currentIndex } = state;

  if (queue.length === 0) {
    return (
      <div className="flex items-center justify-center h-20 text-[0.625rem] text-outline uppercase tracking-widest">
        キューが空です
      </div>
    );
  }

  return (
    <div className="overflow-y-auto max-h-64">
      {queue.map((item, idx) => {
        const isPlaying = idx === currentIndex;
        const duration =
          !item.isFullVideo &&
          isFinite(item.endSeconds) &&
          item.endSeconds !== Number.MAX_SAFE_INTEGER
            ? formatSeconds(item.endSeconds - item.startSeconds)
            : null;

        return (
          <div
            key={item.id}
            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors group ${
              isPlaying ? 'bg-black text-white' : 'hover:bg-surface-container-low text-on-surface'
            }`}
            onClick={() => jumpTo(idx)}
          >
            {/* 番号 / 再生中マーク */}
            <span
              className={`shrink-0 text-[0.6rem] font-mono w-5 text-right ${
                isPlaying ? 'text-white' : 'text-outline'
              }`}
            >
              {isPlaying ? (
                <span className="material-symbols-outlined leading-none" style={{ fontSize: '14px' }}>
                  play_arrow
                </span>
              ) : (
                String(idx + 1).padStart(2, '0')
              )}
            </span>

            {/* タイトル */}
            <div className="flex-1 min-w-0">
              <p className={`text-[0.75rem] font-bold truncate leading-snug ${
                isPlaying ? 'text-white' : ''
              }`}>
                {item.chapterLabel}
              </p>
              {!item.isFullVideo && (
                <p className={`text-[0.6rem] truncate ${
                  isPlaying ? 'text-white/60' : 'text-outline'
                }`}>
                  {item.videoTitle}
                </p>
              )}
            </div>

            {/* 再生時間 */}
            {duration && (
              <span className={`shrink-0 text-[0.6rem] font-mono ${
                isPlaying ? 'text-white/70' : 'text-outline'
              }`}>
                {duration}
              </span>
            )}

            {/* 削除ボタン（ホバー時のみ） */}
            <button
              onClick={e => { e.stopPropagation(); removeFromQueue(item.id); }}
              className={`shrink-0 w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${
                isPlaying ? 'text-white/70 hover:text-white' : 'text-outline hover:text-primary'
              }`}
              aria-label="削除"
            >
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '14px' }}>
                close
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
