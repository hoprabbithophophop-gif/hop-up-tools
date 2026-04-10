import React, { useMemo } from 'react';
import { useChapterPlaylistContext } from '../context/ChapterPlaylistContext';
import { ChapterSearchResultCard } from './ChapterSearchResultCard';
import { VideoSearchResultCard } from './VideoSearchResultCard';
import { makeChapterId, makeVideoId, buildFullVideoQueueItem, type SearchResultItem } from '../utils/playlist-utils';
import { formatSeconds } from '../utils/playlist-utils';
import type { ChapterQueueItem } from '../types/playlist';

interface VideoRow {
  video_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  video_type: string;
  published_at: string;
  description_short: string;
}

interface Chapter {
  seconds: number;
  label: string;
  timestamp: string;
}

interface Props {
  query: string;
  videos: VideoRow[];
  parseChapters: (description: string) => Chapter[];
}

interface VideoHit {
  id: string;
  video: VideoRow;
  item: ChapterQueueItem;
}

interface ChapterHit {
  id: string;
  video: VideoRow;
  item: ChapterQueueItem;
}

interface SearchResults {
  videoHits: VideoHit[];
  chapterHits: ChapterHit[];
  allResults: SearchResultItem[];
}

function useSearchResults(videos: VideoRow[], query: string, parseChapters: (d: string) => Chapter[]): SearchResults {
  return useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return { videoHits: [], chapterHits: [], allResults: [] };

    const videoHits: VideoHit[] = [];
    const chapterHits: ChapterHit[] = [];
    const allResults: SearchResultItem[] = [];
    const seenVideoIds = new Set<string>();

    for (const video of videos) {
      // 動画タイトル検索
      if (video.title.toLowerCase().includes(q) && !seenVideoIds.has(video.video_id)) {
        seenVideoIds.add(video.video_id);
        const item = buildFullVideoQueueItem(video);
        const id = makeVideoId(video.video_id);
        videoHits.push({ id, video, item });
        allResults.push({ id, item });
      }

      // チャプター検索
      const chapters = parseChapters(video.description_short);
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        if (!ch.label.toLowerCase().includes(q)) continue;
        const endSeconds = i + 1 < chapters.length
          ? chapters[i + 1].seconds
          : Number.MAX_SAFE_INTEGER;
        const id = makeChapterId(video.video_id, ch.seconds);
        const item: ChapterQueueItem = {
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
        };
        chapterHits.push({ id, video, item });
        allResults.push({ id, item });
      }
    }

    return { videoHits, chapterHits, allResults };
  }, [query, videos, parseChapters]);
}

export function VideoSearchResults({ query, videos, parseChapters }: Props) {
  const { selection, startInSelectionOrder, startShuffled, state } =
    useChapterPlaylistContext();

  const { videoHits, chapterHits, allResults } = useSearchResults(videos, query, parseChapters);
  const isPlaylistOpen = state.queue.length > 0;
  // PlaylistPanel 表示中は FloatingBar を非表示（重複回避）
  const showFloatingBar = selection.selectionCount > 0 && !isPlaylistOpen;
  const hasNoResults = videoHits.length === 0 && chapterHits.length === 0;

  if (hasNoResults) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-outline">
        <p className="text-xs uppercase tracking-widest">動画・チャプターが見つかりませんでした</p>
      </div>
    );
  }

  // FloatingBar + PlaylistPanel の両方が出る場合はより大きなpadding
  return (
    <div className={showFloatingBar ? (isPlaylistOpen ? 'pb-36' : 'pb-20') : ''}>
      {/* 選択件数ヘッダー */}
      {selection.selectionCount > 0 && (
        <div className="flex items-center gap-4 mb-4">
          <p className="text-[0.6875rem] uppercase tracking-widest text-primary font-bold">
            {selection.selectionCount}件選択中
          </p>
          <button
            onClick={selection.clearSelection}
            className="text-[0.6rem] uppercase tracking-widest text-outline hover:text-primary transition-colors cursor-pointer"
          >
            全解除
          </button>
        </div>
      )}

      {/* 動画セクション */}
      {videoHits.length > 0 && (
        <section className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[0.6rem] font-bold uppercase tracking-widest text-outline">
              動画 ({videoHits.length}件)
            </span>
            <div className="flex-1 border-t border-outline-variant/20" />
          </div>
          <div className="divide-y divide-outline-variant/10 border-t border-outline-variant/10">
            {videoHits.map((hit) => (
              <VideoSearchResultCard
                key={hit.id}
                id={hit.id}
                video={hit.video}
                item={hit.item}
                selectionNumber={selection.getSelectionNumber(hit.id)}
                onToggle={() => selection.toggleSelection(hit.id, hit.item)}
              />
            ))}
          </div>
        </section>
      )}

      {/* チャプターセクション */}
      {chapterHits.length > 0 && (
        <section>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[0.6rem] font-bold uppercase tracking-widest text-outline">
              チャプター ({chapterHits.length}件)
            </span>
            <div className="flex-1 border-t border-outline-variant/20" />
          </div>
          <div className="divide-y divide-outline-variant/10 border-t border-outline-variant/10">
            {chapterHits.map((hit) => (
              <ChapterSearchResultCard
                key={hit.id}
                id={hit.id}
                item={hit.item}
                selectionNumber={selection.getSelectionNumber(hit.id)}
                onToggle={() => selection.toggleSelection(hit.id, hit.item)}
              />
            ))}
          </div>
        </section>
      )}

      {/* フローティングバー（選択中は常に表示。PlaylistPanel表示中はその上に浮かせる） */}
      {showFloatingBar && (
        <SelectionFloatingBar
          count={selection.selectionCount}
          onPlay={() => startInSelectionOrder()}
          onShuffle={() => startShuffled()}
          onClear={selection.clearSelection}
          abovePanel={isPlaylistOpen}
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
  abovePanel = false,
}: {
  count: number;
  onPlay: () => void;
  onShuffle: () => void;
  onClear: () => void;
  /** PlaylistPanel が表示中のとき true にすると、その上に浮かせる */
  abovePanel?: boolean;
}) {
  return (
    <div className={`fixed ${abovePanel ? 'bottom-[52px]' : 'bottom-0'} left-0 right-0 z-50 flex items-center gap-2 px-4 py-3 bg-surface border-t border-outline-variant/20 shadow-lg`}>
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
