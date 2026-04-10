export interface ChapterQueueItem {
  /** キュー内での一意ID */
  id: string;
  /** YouTube 動画ID */
  videoId: string;
  /** 動画タイトル */
  videoTitle: string;
  /** チャンネル名 */
  channelName: string;
  /** サムネイルURL */
  thumbnailUrl: string;
  /** チャプター名（動画丸ごとの場合は動画タイトルと同じ） */
  chapterLabel: string;
  /** チャプター表示用タイムスタンプ（mm:ss 等） */
  chapterTimestamp: string;
  /** チャプター開始時間（秒）。動画丸ごとの場合は 0 */
  startSeconds: number;
  /** チャプター終了時間（秒）。動画丸ごとは Infinity、最後のチャプターは Number.MAX_SAFE_INTEGER */
  endSeconds: number;
  /** 動画丸ごと再生かどうか */
  isFullVideo: boolean;
}

export interface ChapterPlaylistState {
  queue: ChapterQueueItem[];
  currentIndex: number | null;
  isPlaying: boolean;
  isShuffled: boolean;
  originalQueue: ChapterQueueItem[];
  repeatMode: 'none' | 'all';
}

export type PlaylistAction =
  | { type: 'ADD_ITEM'; item: ChapterQueueItem }
  | { type: 'ADD_ITEMS'; items: ChapterQueueItem[] }
  | { type: 'START_PLAYLIST'; items: ChapterQueueItem[] }
  | { type: 'REMOVE_ITEM'; id: string }
  | { type: 'SET_CURRENT'; index: number }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'TOGGLE_SHUFFLE' }
  | { type: 'TOGGLE_REPEAT' }
  | { type: 'CLEAR' }
  | { type: 'SET_PLAYING'; isPlaying: boolean }
  | { type: 'REORDER'; fromIndex: number; toIndex: number };
