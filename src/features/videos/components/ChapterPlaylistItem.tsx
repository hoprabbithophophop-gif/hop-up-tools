import React from 'react';
import type { ChapterQueueItem } from '../types/playlist';

interface Props {
  item: ChapterQueueItem;
  index: number;
  isActive: boolean;
  onPlay: () => void;
  onRemove: () => void;
}

export function ChapterPlaylistItem({ item, index, isActive, onPlay, onRemove }: Props) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors group ${
        isActive
          ? 'bg-primary/10 border-l-2 border-primary'
          : 'border-l-2 border-transparent hover:bg-surface-container-low'
      }`}
      onClick={onPlay}
    >
      {/* サムネイル */}
      <div className="w-12 aspect-video shrink-0 overflow-hidden bg-surface-container">
        <img
          src={item.thumbnailUrl}
          alt={item.videoTitle}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          width={48}
          height={27}
        />
      </div>

      {/* テキスト情報 */}
      <div className="flex-1 min-w-0">
        <p className={`text-[0.7rem] font-medium leading-snug truncate ${
          isActive ? 'text-primary' : 'text-on-surface group-hover:text-primary transition-colors'
        }`}>
          {item.chapterLabel}
        </p>
        {!item.isFullVideo && (
          <p className="text-[0.6rem] text-outline truncate mt-0.5">
            {item.videoTitle}
          </p>
        )}
        {!item.isFullVideo && item.chapterTimestamp && (
          <p className="text-[0.55rem] text-outline/70 font-mono mt-0.5">
            {item.chapterTimestamp}
          </p>
        )}
      </div>

      {/* インデックスと削除ボタン */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        {isActive ? (
          <span className="text-[0.55rem] font-bold text-primary">▶</span>
        ) : (
          <span className="text-[0.55rem] text-outline/50 tabular-nums">{index + 1}</span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="text-[0.55rem] text-outline/50 hover:text-primary transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
          title="キューから削除"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
