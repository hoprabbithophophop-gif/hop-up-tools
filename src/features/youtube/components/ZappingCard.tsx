import React, { useRef } from 'react';

export interface VideoRow {
  video_id: string;
  title: string;
  channel_name: string;
  published_at: string;
  thumbnail_url: string;
  video_type: string;
  group_tags: string[];
  description_short: string;
}

const LONG_PRESS_DELAY = 400;

interface Props {
  video: VideoRow;
  onShortTap: () => void;
  onLongPress: () => void;
}

export function ZappingCard({ video, onShortTap, onLongPress }: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFiredRef = useRef(false);
  const movedRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    longFiredRef.current = false;
    movedRef.current = false;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    timerRef.current = setTimeout(() => {
      if (!movedRef.current) {
        longFiredRef.current = true;
        onLongPress();
      }
    }, LONG_PRESS_DELAY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (movedRef.current) return;
    const dx = Math.abs(e.clientX - startXRef.current);
    const dy = Math.abs(e.clientY - startYRef.current);
    if (dx > 8 || dy > 8) {
      movedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  };

  const handlePointerUp = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!longFiredRef.current && !movedRef.current) onShortTap();
    longFiredRef.current = false;
    movedRef.current = false;
  };

  const handlePointerCancel = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    longFiredRef.current = false;
    movedRef.current = false;
  };

  return (
    <button
      data-testid="zapping-card"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={e => e.preventDefault()}
      className="flex flex-col bg-surface hover:bg-surface-container-low transition-colors cursor-pointer text-left"
      style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
    >
      <div className="relative w-full overflow-hidden bg-surface-container">
        <img
          src={video.thumbnail_url}
          alt={video.title}
          className="w-full object-cover"
          style={{ aspectRatio: '16/9' }}
          loading="lazy"
          decoding="async"
        />
        <span className="absolute top-1 left-1 text-[7px] font-bold uppercase text-white bg-black/70 px-1 py-0.5 leading-none">
          {video.video_type?.toUpperCase() || 'VIDEO'}
        </span>
      </div>
      <div className="px-2 py-2 flex-1">
        <p className="text-[0.6875rem] font-bold leading-snug line-clamp-2 text-on-surface">
          {video.title}
        </p>
        <p className="text-[0.6rem] text-outline mt-0.5 truncate">{video.channel_name}</p>
      </div>
    </button>
  );
}
