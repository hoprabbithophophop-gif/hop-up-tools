import type { ChapterQueueItem } from '../types/playlist';

interface VideoRow {
  video_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  duration_seconds?: number | null;
}

interface Chapter {
  seconds: number;
  label: string;
  timestamp: string;
}

/** チャプターIDを生成（動画ID + 開始秒数で一意化） */
export function makeChapterId(videoId: string, startSeconds: number): string {
  return `chapter_${videoId}_${startSeconds}`;
}

/** 動画丸ごとIDを生成 */
export function makeVideoId(videoId: string): string {
  return `video_${videoId}`;
}

/** 動画の全チャプターを ChapterQueueItem[] に変換する */
export function buildChapterQueueItems(
  video: VideoRow,
  chapters: Chapter[]
): ChapterQueueItem[] {
  return chapters.map((ch, i) => ({
    id: makeChapterId(video.video_id, ch.seconds),
    videoId: video.video_id,
    videoTitle: video.title,
    channelName: video.channel_name,
    thumbnailUrl: video.thumbnail_url,
    chapterLabel: ch.label,
    chapterTimestamp: ch.timestamp,
    startSeconds: ch.seconds,
    endSeconds: i + 1 < chapters.length
      ? chapters[i + 1].seconds
      : (video.duration_seconds && video.duration_seconds > 0 ? video.duration_seconds : Number.MAX_SAFE_INTEGER),
    isFullVideo: false,
  }));
}

/** 特定インデックスのチャプター1件を ChapterQueueItem に変換する */
export function buildSingleChapterQueueItem(
  video: VideoRow,
  chapters: Chapter[],
  index: number
): ChapterQueueItem {
  const ch = chapters[index];
  return {
    id: makeChapterId(video.video_id, ch.seconds),
    videoId: video.video_id,
    videoTitle: video.title,
    channelName: video.channel_name,
    thumbnailUrl: video.thumbnail_url,
    chapterLabel: ch.label,
    chapterTimestamp: ch.timestamp,
    startSeconds: ch.seconds,
    endSeconds: index + 1 < chapters.length
      ? chapters[index + 1].seconds
      : (video.duration_seconds && video.duration_seconds > 0 ? video.duration_seconds : Number.MAX_SAFE_INTEGER),
    isFullVideo: false,
  };
}

/** 動画丸ごとの ChapterQueueItem を生成する */
export function buildFullVideoQueueItem(video: VideoRow): ChapterQueueItem {
  return {
    id: makeVideoId(video.video_id),
    videoId: video.video_id,
    videoTitle: video.title,
    channelName: video.channel_name,
    thumbnailUrl: video.thumbnail_url,
    chapterLabel: video.title,
    chapterTimestamp: '',
    startSeconds: 0,
    endSeconds: video.duration_seconds && video.duration_seconds > 0
      ? video.duration_seconds
      : Number.MAX_SAFE_INTEGER,
    isFullVideo: true,
  };
}

/** 秒数を mm:ss または hh:mm:ss フォーマットに変換 */
export function formatSeconds(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds === Number.MAX_SAFE_INTEGER) return '--:--';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Fisher-Yates シャッフル */
export function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// --- 選択→キュー変換 ---

export interface SearchResultItem {
  id: string;
  item: ChapterQueueItem;
}

/**
 * 選択した順番（selectedIds の配列順）でキューを構築する
 * 動画ヒット・チャプターヒット横断で対応
 */
export function buildQueueInSelectionOrder(
  allResults: SearchResultItem[],
  selectedIds: string[]
): ChapterQueueItem[] {
  const map = new Map<string, ChapterQueueItem>(allResults.map((r) => [r.id, r.item]));
  return selectedIds
    .map((id) => map.get(id))
    .filter((item): item is ChapterQueueItem => item !== undefined);
}

/**
 * 選択した順番からランダムに並び替えてキューを構築する
 */
export function buildQueueShuffled(
  allResults: SearchResultItem[],
  selectedIds: string[]
): ChapterQueueItem[] {
  const items = buildQueueInSelectionOrder(allResults, selectedIds);
  return shuffleArray(items);
}
