import React, { useMemo } from 'react';
import { useChapterPlaylistContext } from '../context/ChapterPlaylistContext';
import { ChapterSearchResultCard } from './ChapterSearchResultCard';
import type { ChapterQueueItem } from '../types/playlist';

interface VideoRow {
  video_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  description_short: string;
}

interface Chapter {
  seconds: number;
  label: string;
  timestamp: string;
}

export interface ChapterSearchResult {
  id: string;
  item: ChapterQueueItem;
}

interface Props {
  query: string;
  videos: VideoRow[];
  parseChapters: (description: string) => Chapter[];
}

export function ChapterSearchResults({ query, videos, parseChapters }: Props) {
  const { selection, startInSelectionOrder, startShuffled, state } =
    useChapterPlaylistContext();

  const isPlaylistOpen = state.queue.length > 0;

  const searchResults: ChapterSearchResult[] = useMemo(() => {
    if (!query.trim()) return [];
    const lower = query.toLowerCase();
    const results: ChapterSearchResult[] = [];

    for (const video of videos) {
      const chapters = parseChapters(video.description_short);
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        if (!ch.label.toLowerCase().includes(lower)) continue;
        const endSeconds = i + 1 < chapters.length
          ? chapters[i + 1].seconds
          : Number.MAX_SAFE_INTEGER;
        const id = `${video.video_id}_${i}`;
        results.push({
          id,
          item: {
            id,
            videoId: video.video_id,
            videoTitle: video.title,
            channelName: video.channel_name,
            thumbnailUrl: video.thumbnail_url,
            chapterLabel: ch.label,
            chapterTimestamp: ch.timestamp,
            startSeconds: ch.seconds,
            endSeconds,
            isFullVideo: false,
          },
        });
      }
    }
    return results;
  }, [query, videos, parseChapters]);

  if (searchResults.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-outline">
        <p className="text-xs uppercase tracking-widest">チャプターが見つかりませんでした</p>
        <p className="text-[0.65rem] text-outline/60">
          動画タイトルの検索は通常モードをご利用ください
        </p>
      </div>
    );
  }

  const showFloatingBar = selection.selectionCount > 0 && !isPlaylistOpen;

  return (
    <div className={showFloatingBar ? 'pb-20' : ''}>
      {/* ヘッダー */}
      <div className="flex items-center gap-4 mb-4">
        <p className="text-[0.6875rem] uppercase tracking-widest text-outline">
          {searchResults.length} chapters
          {selection.selectionCount > 0 && (
            <span className="ml-2 text-primary font-bold">
              / {selection.selectionCount}件選択中
            </span>
          )}
        </p>
        {selection.selectionCount > 0 && (
          <button
            onClick={selection.clearSelection}
            className="text-[0.6rem] uppercase tracking-widest text-outline hover:text-primary transition-colors cursor-pointer"
          >
            全解除
          </button>
        )}
      </div>

      {/* カード一覧 */}
      <div className="divide-y divide-outline-variant/10 border-t border-outline-variant/10">
        {searchResults.map((result) => (
          <ChapterSearchResultCard
            key={result.id}
            id={result.id}
            item={result.item}
            selectionNumber={selection.getSelectionNumber(result.id)}
            onToggle={() => selection.toggleSelection(result.id, result.item)}
          />
        ))}
      </div>

      {/* フローティングバー（選択中 かつ PlaylistPanel非表示時のみ） */}
      {showFloatingBar && (
        <SelectionFloatingBar
          count={selection.selectionCount}
          onPlay={() => startInSelectionOrder()}
          onShuffle={() => startShuffled()}
          onClear={selection.clearSelection}
        />
      )}
    </div>
  );
}

function SelectionFloatingBar({
  count,
  onPlay,
  onShuffle,
  onClear,
}: {
  count: number;
  onPlay: () => void;
  onShuffle: () => void;
  onClear: () => void;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center gap-2 px-4 py-3 bg-surface border-t border-outline-variant/20 shadow-lg">
      <button
        onClick={onPlay}
        className="flex-1 bg-primary text-on-primary-fixed text-sm font-bold uppercase tracking-[0.15em] py-3 hover:bg-secondary transition-colors cursor-pointer"
      >
        ▶ {count}件を再生
      </button>
      <button
        onClick={onShuffle}
        className="px-4 py-3 text-xs font-bold uppercase tracking-widest border border-outline-variant text-outline hover:border-primary hover:text-primary transition-colors cursor-pointer shrink-0"
      >
        🔀 シャッフル
      </button>
      <button
        onClick={onClear}
        className="px-3 py-3 text-xs font-bold uppercase tracking-widest border border-outline-variant text-outline hover:border-primary hover:text-primary transition-colors cursor-pointer shrink-0"
      >
        ✕
      </button>
    </div>
  );
}
