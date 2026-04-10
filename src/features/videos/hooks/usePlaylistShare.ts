import { nanoid } from 'nanoid';
import { getSupabase } from '../../../lib/supabase';
import type { ChapterQueueItem } from '../types/playlist';

/** Supabase に保存する形式（JSON非表現の Infinity は null で保管） */
export interface PlaylistShareItem {
  videoId: string;
  videoTitle: string;
  chapterTitle: string;
  startSeconds: number;
  endSeconds: number | null; // null = Infinity
  isFullVideo: boolean;
}

export interface PlaylistShare {
  id: string;
  title: string;
  items: PlaylistShareItem[];
  created_at: string;
  expires_at: string;
  access_count: number;
}

/** ChapterQueueItem → PlaylistShareItem */
export function toShareItem(item: ChapterQueueItem): PlaylistShareItem {
  const isInfinite =
    item.endSeconds === Infinity || item.endSeconds === Number.MAX_SAFE_INTEGER;
  return {
    videoId: item.videoId,
    videoTitle: item.videoTitle,
    chapterTitle: item.chapterLabel,
    startSeconds: item.startSeconds,
    endSeconds: isInfinite ? null : item.endSeconds,
    isFullVideo: item.isFullVideo,
  };
}

/** PlaylistShareItem → ChapterQueueItem（サムネイルは YouTube CDN から取得） */
export function fromShareItem(item: PlaylistShareItem): ChapterQueueItem {
  return {
    id: `shared_${item.videoId}_${item.startSeconds}`,
    videoId: item.videoId,
    videoTitle: item.videoTitle,
    channelName: '',
    thumbnailUrl: `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`,
    chapterLabel: item.chapterTitle,
    chapterTimestamp: '',
    startSeconds: item.startSeconds,
    endSeconds: item.endSeconds === null ? Infinity : item.endSeconds,
    isFullVideo: item.isFullVideo,
  };
}

/** プレイリストを Supabase に保存して共有 URL を返す（最大10件） */
export async function createPlaylistShare(
  title: string,
  items: ChapterQueueItem[]
): Promise<string> {
  const supabase = getSupabase();
  const id = nanoid(8);
  const shareItems = items.slice(0, 10).map(toShareItem);

  const { error } = await supabase
    .from('playlist_shares')
    .insert({ id, title: title || '', items: shareItems });

  if (error) throw new Error('プレイリストの保存に失敗しました');

  return `${window.location.origin}/youtube/pickup?p=${id}`;
}

/** 共有プレイリストを取得（アクセス時に自動で期限延長） */
export async function getPlaylistShare(id: string): Promise<PlaylistShare | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .rpc('get_and_extend_playlist', { playlist_id: id });

  if (error || !data || (data as PlaylistShare[]).length === 0) return null;
  return (data as PlaylistShare[])[0];
}
