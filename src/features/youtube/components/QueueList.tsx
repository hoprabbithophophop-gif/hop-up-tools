import React, { useState, useRef } from 'react';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { formatSeconds } from '../../videos/utils/playlist-utils';
import type { ChapterQueueItem } from '../../videos/types/playlist';

const SWIPE_THRESHOLD = 70;

interface QueueItemProps {
  item: ChapterQueueItem;
  idx: number;
  isPlaying: boolean;
  onJump: () => void;
  onRemove: () => void;
}

function QueueItem({ item, idx, isPlaying, onJump, onRemove }: QueueItemProps) {
  const [swipeX, setSwipeX] = useState(0);
  const [removing, setRemoving] = useState(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const isScrollRef = useRef(false);

  const duration =
    !item.isFullVideo &&
    isFinite(item.endSeconds) &&
    item.endSeconds !== Number.MAX_SAFE_INTEGER
      ? formatSeconds(item.endSeconds - item.startSeconds)
      : null;

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    isScrollRef.current = false;
    setSwipeX(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - startXRef.current;
    const dy = Math.abs(e.touches[0].clientY - startYRef.current);
    // 縦方向の動きが大きければスクロールと判定
    if (!isScrollRef.current && dy > Math.abs(dx) * 1.5) {
      isScrollRef.current = true;
      setSwipeX(0);
      return;
    }
    if (isScrollRef.current) return;
    if (dx < 0) setSwipeX(Math.max(dx, -100));
  };

  const handleTouchEnd = () => {
    if (isScrollRef.current) return;
    if (swipeX < -SWIPE_THRESHOLD) {
      // 件数を即時反映するためcontextは即削除、視覚アニメだけ残す
      onRemove();
      setRemoving(true);
    } else {
      setSwipeX(0);
    }
  };

  return (
    <div className="relative overflow-hidden">
      {/* 削除背景（左スワイプで露出） */}
      <div className="absolute inset-y-0 right-0 left-0 bg-red-500/90 flex items-center justify-end px-4">
        <span className="material-symbols-outlined text-white leading-none" style={{ fontSize: '20px' }}>
          delete
        </span>
      </div>

      {/* 行本体 */}
      <div
        style={{
          transform: `translateX(${removing ? '-100%' : swipeX + 'px'})`,
          transition: swipeX === 0 || removing ? 'transform 0.2s ease' : 'none',
          willChange: 'transform',
        }}
        className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer group ${
          isPlaying ? 'bg-black text-white' : 'bg-surface hover:bg-surface-container-low text-on-surface'
        }`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={onJump}
      >
        {/* 番号 / 再生中マーク */}
        <span className={`shrink-0 text-[0.6rem] font-mono w-5 text-right ${isPlaying ? 'text-white' : 'text-outline'}`}>
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
          <p className={`text-[0.75rem] font-bold truncate leading-snug ${isPlaying ? 'text-white' : ''}`}>
            {item.chapterLabel}
          </p>
          {!item.isFullVideo && (
            <p className={`text-[0.6rem] truncate ${isPlaying ? 'text-white/60' : 'text-outline'}`}>
              {item.videoTitle}
            </p>
          )}
        </div>

        {/* 再生時間 */}
        {duration && (
          <span className={`shrink-0 text-[0.6rem] font-mono ${isPlaying ? 'text-white/70' : 'text-outline'}`}>
            {duration}
          </span>
        )}

        {/* 削除ボタン（デスクトップ用 hover） */}
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          onTouchStart={e => e.stopPropagation()}
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
    </div>
  );
}

interface QueueListProps {
  onShare?: () => void;
}

export function QueueList({ onShare }: QueueListProps) {
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
    <div>
      {/* シェア・件数バー */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-outline-variant/10">
        <p className="text-[0.6rem] text-outline uppercase tracking-widest">{queue.length}件</p>
        {onShare && (
          <button
            onClick={onShare}
            className="flex items-center gap-1 text-[0.6rem] font-bold uppercase tracking-widest text-outline hover:text-primary transition-colors cursor-pointer"
            aria-label="シェア"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '16px' }}>share</span>
            Share
          </button>
        )}
      </div>
      <div className="overflow-y-auto max-h-64">
        {queue.map((item, idx) => (
          <QueueItem
            key={item.id}
            item={item}
            idx={idx}
            isPlaying={idx === currentIndex}
            onJump={() => jumpTo(idx)}
            onRemove={() => removeFromQueue(item.id)}
          />
        ))}
      </div>
    </div>
  );
}
