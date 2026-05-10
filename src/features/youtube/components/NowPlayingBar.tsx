import React from 'react';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import type { ChapterQueueItem } from '../../videos/types/playlist';

function formatPublishedDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

interface Props {
  currentItem: ChapterQueueItem | null;
  /**
   * inline (PLAYLIST): 展開時にバーが下方向に伸びる（自然レイアウト）
   * overlay (HOME): バーは h-9 固定。展開はabsoluteオーバーレイで動画は縮まない
   */
  variant?: 'inline' | 'overlay';
}

/**
 * 再生中チャプター情報の黒バー。
 * 展開状態は ChapterPlaylistContext で共有されるため、HOMEとPLAYLIST間で同期する。
 */
export function NowPlayingBar({ currentItem, variant = 'inline' }: Props) {
  const { chapterBarExpanded, toggleChapterBar } = useChapterPlaylistContext();

  if (!currentItem) return null;

  const dateText = formatPublishedDate(currentItem.publishedAt);
  const showTitle = !currentItem.isFullVideo;
  const hasSubtitle = showTitle || Boolean(dateText);
  const expanded = chapterBarExpanded;

  if (variant === 'overlay') {
    return (
      <div className="relative shrink-0">
        {/* バー本体（h-9 固定）- 通常時はこれが見える */}
        <div
          className="h-9 bg-black flex items-center px-4 border-t border-white/10 cursor-pointer"
          onClick={toggleChapterBar}
        >
          <p className="text-white text-[0.7rem] font-normal truncate">
            {currentItem.chapterLabel}
          </p>
        </div>
        {/* 展開時オーバーレイ - バー位置から下方向に重ねる（白ストリップやBrowseに被る） */}
        {expanded && (
          <div
            className="absolute left-0 right-0 top-0 bg-black px-4 py-2 z-30 border-t border-white/10 cursor-pointer"
            onClick={toggleChapterBar}
          >
            <p className="text-white text-[0.7rem] font-normal whitespace-normal break-words">
              {currentItem.chapterLabel}
            </p>
            {hasSubtitle && (
              <p className="whitespace-normal break-words text-[0.6rem] mt-0.5">
                {showTitle && (
                  <span className="text-white/40 font-thin">{currentItem.videoTitle}</span>
                )}
                {dateText && (
                  <span className={`text-white/70 font-medium tabular-nums ${showTitle ? 'ml-4' : ''}`}>
                    {dateText}
                  </span>
                )}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // inline variant (PLAYLIST default)
  return (
    <div className="shrink-0">
      <div
        className={`bg-black flex items-center px-4 border-t border-white/10 cursor-pointer ${expanded ? 'py-2' : 'h-9'}`}
        onClick={toggleChapterBar}
      >
        <p className={`text-white text-[0.7rem] font-normal ${expanded ? 'whitespace-normal break-words' : 'truncate'}`}>
          {currentItem.chapterLabel}
        </p>
      </div>
      {expanded && hasSubtitle && (
        <div className="bg-black px-4 pb-1.5 -mt-0.5 text-[0.6rem]">
          <p className="whitespace-normal break-words">
            {showTitle && (
              <span className="text-white/40 font-thin">{currentItem.videoTitle}</span>
            )}
            {dateText && (
              <span className={`text-white/70 font-medium tabular-nums ${showTitle ? 'ml-4' : ''}`}>
                {dateText}
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
