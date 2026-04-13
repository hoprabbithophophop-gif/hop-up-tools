import React, { useRef } from 'react';
import type { ChapterQueueItem } from '../../videos/types/playlist';
import { formatSeconds } from '../../videos/utils/playlist-utils';

interface Props {
  item: ChapterQueueItem;
  selectionNumber: number; // 0=未選択, 1以上=選択番号
  onToggle: () => void;
  /** 指定時: 短タップ = onPlay、長押し = onCardClick に分離 */
  onPlay?: () => void;
  /** onPlay なし時: カード本体クリック = onCardClick、+ボタン = onToggle に分離 */
  onCardClick?: () => void;
}

const LONG_PRESS_DELAY = 400;

export function ChapterCard({ item, selectionNumber, onToggle, onPlay, onCardClick }: Props) {
  const isSelected = selectionNumber > 0;
  const isFullVideo = item.isFullVideo;

  const duration =
    !isFullVideo &&
    isFinite(item.endSeconds) &&
    item.endSeconds !== Number.MAX_SAFE_INTEGER
      ? formatSeconds(item.endSeconds - item.startSeconds)
      : null;

  const timeRange = !isFullVideo
    ? `${formatSeconds(item.startSeconds)}${
        isFinite(item.endSeconds) && item.endSeconds !== Number.MAX_SAFE_INTEGER
          ? ` — ${formatSeconds(item.endSeconds)}`
          : ''
      }`
    : '全編再生';

  // long press ロジック（onPlay がある場合のみ）
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFiredRef = useRef(false);

  const handlePointerDown = onPlay
    ? () => {
        longFiredRef.current = false;
        timerRef.current = setTimeout(() => {
          longFiredRef.current = true;
          // 長押し → シート表示（従来の onCardClick 動作）
          (onCardClick ?? onToggle)();
        }, LONG_PRESS_DELAY);
      }
    : undefined;

  const handlePointerUp = onPlay
    ? () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (!longFiredRef.current) {
          // 短タップ → 即再生
          onPlay();
        }
        longFiredRef.current = false;
      }
    : undefined;

  const handlePointerCancel = onPlay
    ? () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        longFiredRef.current = false;
      }
    : undefined;

  // onPlay なし時の従来クリック
  const handleCardClick = onPlay ? undefined : (onCardClick ?? onToggle);

  return (
    <div
      onClick={handleCardClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && (onPlay ?? onCardClick ?? onToggle)()}
      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
        isSelected ? 'bg-black/5' : 'hover:bg-surface-container-low'
      }`}
    >
      {/* サムネイル */}
      <div
        className="relative shrink-0 w-20 overflow-hidden bg-surface-container"
        style={{ height: '45px' }}
      >
        <img
          src={item.thumbnailUrl}
          alt={item.videoTitle}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          width={80}
          height={45}
          style={{ aspectRatio: '16/9' }}
        />
        {/* タイプタグ */}
        <span
          className={`absolute top-0.5 left-0.5 text-[8px] font-bold uppercase leading-none px-1 py-0.5 text-white ${
            isFullVideo ? 'bg-[#666]' : 'bg-black'
          }`}
        >
          {isFullVideo ? 'VIDEO' : 'CHAPTER'}
        </span>
        {/* 再生時間 */}
        {duration && (
          <span className="absolute bottom-0 right-0 text-[8px] font-mono text-white bg-black/80 px-1 py-0.5 leading-none">
            {duration}
          </span>
        )}
      </div>

      {/* テキスト */}
      <div className="flex-1 min-w-0">
        <p className="text-[0.8125rem] font-bold leading-snug truncate text-on-surface">
          {item.chapterLabel}
        </p>
        {!isFullVideo && (
          <p className="text-[0.625rem] text-outline truncate mt-0.5">
            {item.videoTitle}
          </p>
        )}
        <p className="text-[0.625rem] text-outline/70 font-mono mt-0.5">{timeRange}</p>
      </div>

      {/* 選択ボタン（タッチターゲット最小44px） */}
      <div
        className="shrink-0 w-11 h-11 flex items-center justify-center"
        onClick={onCardClick ? e => { e.stopPropagation(); onToggle(); } : undefined}
        onPointerDown={e => e.stopPropagation()}
        onPointerUp={e => { e.stopPropagation(); onToggle(); }}
        onPointerCancel={e => e.stopPropagation()}
      >
        {isSelected ? (
          <span className="w-6 h-6 bg-black text-white flex items-center justify-center text-[0.625rem] font-bold leading-none">
            {selectionNumber}
          </span>
        ) : (
          <span className="w-6 h-6 border border-outline/40 text-outline flex items-center justify-center transition-colors group-hover:border-on-surface">
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '16px' }}>
              add
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
