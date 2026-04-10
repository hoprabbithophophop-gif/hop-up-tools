import React from 'react';
import type { ChapterQueueItem } from '../types/playlist';

interface VideoRow {
  video_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  video_type: string;
  published_at: string;
}

interface Props {
  id: string;
  video: VideoRow;
  item: ChapterQueueItem;
  selectionNumber: number; // 0 = 未選択、1以上 = 選択番号
  onToggle: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

const TYPE_COLOR: Record<string, string> = {
  mv:      'text-[#E5457D]',
  live:    'text-blue-500',
  variety: 'text-amber-500',
  other:   'text-outline',
};

export function VideoSearchResultCard({ id, video, item, selectionNumber, onToggle }: Props) {
  const isSelected = selectionNumber > 0;

  return (
    <div
      onClick={onToggle}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors group ${
        isSelected
          ? 'bg-primary/10 border-l-2 border-primary'
          : 'border-l-2 border-transparent hover:bg-surface-container-low'
      }`}
      data-video-id={id}
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
      <div className="w-16 aspect-video shrink-0 overflow-hidden bg-surface-container">
        <img
          src={item.thumbnailUrl}
          alt={item.videoTitle}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          width={64}
          height={36}
        />
      </div>

      {/* テキスト情報 */}
      <div className="flex-1 min-w-0">
        <p className={`text-[0.8rem] font-bold leading-snug line-clamp-2 transition-colors ${
          isSelected ? 'text-primary' : 'text-on-surface group-hover:text-primary'
        }`}>
          {video.title}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
          <span className="text-[0.6rem] text-outline truncate">{video.channel_name}</span>
          <span className={`text-[0.6rem] font-bold uppercase shrink-0 ${TYPE_COLOR[video.video_type] ?? 'text-outline'}`}>
            {video.video_type}
          </span>
          <span className="text-[0.6rem] text-outline/70 shrink-0">{formatDate(video.published_at)}</span>
        </div>
      </div>
    </div>
  );
}
