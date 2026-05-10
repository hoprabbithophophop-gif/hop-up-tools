import type { ChapterQueueItem } from '../types/playlist';

const HISTORY_KEY = 'hello_video_play_history';
const MAX_HISTORY = 3;

export interface PlayHistoryItem {
  videoId: string;
  videoTitle: string;
  thumbnailUrl: string;
  chapterLabel: string;
  chapterTimestamp: string;
  channelName: string;
  startSeconds: number;
  endSeconds: number;
  isFullVideo: boolean;
  playedAt: number;
}

export function readPlayHistory(): PlayHistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveToPlayHistory(item: ChapterQueueItem): void {
  try {
    const history = readPlayHistory();
    const entry: PlayHistoryItem = {
      videoId: item.videoId,
      videoTitle: item.videoTitle,
      thumbnailUrl: item.thumbnailUrl,
      chapterLabel: item.chapterLabel,
      chapterTimestamp: item.chapterTimestamp,
      channelName: item.channelName,
      startSeconds: item.startSeconds,
      endSeconds: item.endSeconds,
      isFullVideo: item.isFullVideo,
      playedAt: Date.now(),
    };
    // 同じチャプターの重複を除去してから先頭に追加
    const filtered = history.filter(
      h => !(h.videoId === entry.videoId && h.startSeconds === entry.startSeconds)
    );
    const updated = [entry, ...filtered].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('play-history-updated'));
  } catch {
    // localStorage 利用不可の場合は無視
  }
}

/** PlayHistoryItem を ChapterQueueItem に変換 */
export function historyItemToQueueItem(h: PlayHistoryItem): ChapterQueueItem {
  return {
    id: `hist-${h.videoId}-${h.startSeconds}`,
    videoId: h.videoId,
    videoTitle: h.videoTitle,
    thumbnailUrl: h.thumbnailUrl,
    chapterLabel: h.chapterLabel,
    chapterTimestamp: h.chapterTimestamp,
    channelName: h.channelName,
    startSeconds: h.startSeconds,
    endSeconds: h.endSeconds,
    isFullVideo: h.isFullVideo,
  };
}
