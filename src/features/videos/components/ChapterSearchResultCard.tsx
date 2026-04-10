import React from 'react';
import { formatSeconds } from '../utils/playlist-utils';
import type { ChapterQueueItem } from '../types/playlist';

interface Props {
  id: string;
  item: ChapterQueueItem;
  selectionNumber: number; // 0 = 未選択、1以上 = 選択番号
  onToggle: () => void;
}

export function ChapterSearchResultCard({ id, item, selectionNumber, onToggle }: Props) {
  const isSelected = selectionNumber > 0;
  const endLabel = item.endSeconds === Number.MAX_SAFE_INTEGER
    ? '—'
    : formatSeconds(item.endSeconds);

  return (
    <div
      onClick={onToggle}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors group ${
        isSelected
          ? 'bg-primary/10 border-l-2 border-primary'
          : 'border-l-2 border-transparent hover:bg-surface-container-low'
      }`}
      data-chapter-id={id}
    >
      {/* チェックマーク / 選択番号 */}
      <div className={`shrink-0 w-5 h-5 flex items-center justify-center border transition-colors ${
        isSelected
          ? 'border-primary bg-primary text-on-primary-fixed'
          : 'border-outline-variant/40 text-transparent group-hover:border-outline'
      }`}>
        {isSelected ? (
          <span className="text-[0.55rem] font-bold leading-none">{selectionNumber}</span>
        ) : (
          <span className="text-[0.6rem] leading-none">✓</span>
        )}
      </div>

      {/* サムネイル */}
      <div className="w-[120px] h-[68px] shrink-0 overflow-hidden bg-surface-container">
        <img
          src={item.thumbnailUrl}
          alt={item.videoTitle}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          width={120}
          height={68}
          style={{ aspectRatio: '16/9' }}
        />
      </div>

      {/* テキスト情報 */}
      <div className="flex-1 min-w-0">
        <p className={`text-[0.8rem] font-bold leading-snug truncate transition-colors ${
          isSelected ? 'text-primary' : 'text-on-surface group-hover:text-primary'
        }`}>
          {item.chapterLabel}
        </p>
        <p className="text-[0.65rem] text-outline truncate mt-0.5">
          {item.videoTitle}
        </p>
        <p className="text-[0.6rem] text-outline/70 font-mono mt-0.5">
          {formatSeconds(item.startSeconds)} — {endLabel}
        </p>
      </div>
    </div>
  );
}
