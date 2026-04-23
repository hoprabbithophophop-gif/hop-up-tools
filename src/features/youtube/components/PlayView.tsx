import React, { useState, useEffect, useCallback } from 'react';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { formatSeconds } from '../../videos/utils/playlist-utils';
import { getSupabase } from '../../../lib/supabase';
import { VideoChapterSheet } from './VideoChapterSheet';
import { PlayControls } from './PlayControls';
import { TrimPanel } from './TrimPanel';
import { QueueList } from './QueueList';
import { ShareModal } from './ShareModal';
import type { SharedPlaylist } from '../../../pages/youtube/YouTubePage';

interface VideoMeta {
  video_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  description_short: string;
}

interface Props {
  sharedPlaylist?: SharedPlaylist | null;
}

export function PlayView({ sharedPlaylist }: Props) {
  const { state, addItem, removeFromQueue, startPlaylist } = useChapterPlaylistContext();
  const { queue, currentIndex } = state;

  const [trimOpen, setTrimOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [chapterSheetOpen, setChapterSheetOpen] = useState(false);
  const [currentVideoMeta, setCurrentVideoMeta] = useState<VideoMeta | null>(null);

  const currentVideoId = currentIndex !== null ? queue[currentIndex]?.videoId : null;

  // 再生中の動画メタデータを取得（チャプター表示用）
  const fetchVideoMeta = useCallback(async (videoId: string) => {
    try {
      const supabase = getSupabase();
      const { data } = await supabase
        .from('youtube_videos')
        .select('video_id,title,channel_name,thumbnail_url,description_short')
        .eq('video_id', videoId)
        .single();
      if (data) setCurrentVideoMeta(data as VideoMeta);
    } catch {
      // 取得失敗は無視
    }
  }, []);

  useEffect(() => {
    if (!currentVideoId) {
      setCurrentVideoMeta(null);
      return;
    }
    // すでに同じ動画のメタがあればスキップ
    if (currentVideoMeta?.video_id === currentVideoId) return;
    setCurrentVideoMeta(null);
    fetchVideoMeta(currentVideoId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideoId]);

  const current = currentIndex !== null ? queue[currentIndex] : null;

  const isFullVideo = current?.isFullVideo ?? false;
  const tag = isFullVideo ? 'フル再生' : 'CLIP';

  const timeRange = current
    ? isFullVideo
      ? '全編再生'
      : `${formatSeconds(current.startSeconds)}${
          isFinite(current.endSeconds) && current.endSeconds !== Number.MAX_SAFE_INTEGER
            ? ` — ${formatSeconds(current.endSeconds)}`
            : ''
        }`
    : '';

  return (
    <div className="bg-white text-black flex flex-col" style={{ height: 'calc(100vh - 68px)' }}>
      {/* 共有プレイリストバナー */}
      {sharedPlaylist && (
        <div className="shrink-0 bg-black/5 px-4 py-2 flex items-center justify-between gap-3">
          <p className="text-[0.7rem] font-thin text-black/50 truncate">
            共有: <span className="text-black font-bold">{sharedPlaylist.title || '（タイトルなし）'}</span>
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => startPlaylist(sharedPlaylist.items)}
              className="text-[0.7rem] text-black/40 cursor-pointer"
              aria-label="元のリストに戻す"
            >
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '16px' }}>restart_alt</span>
            </button>
          </div>
        </div>
      )}

      {/* スクロール領域 */}
      <div className="flex-1 overflow-y-auto">
        {/* 画面見出し */}
        <div className="px-4 pt-6 pb-2">
          <h1 className="text-[1.4rem] font-bold uppercase">PLAYLIST</h1>
        </div>

        {/* YouTube プレイヤー: 実体は YouTubePage レベルで fixed 配置。高さ30%以下 */}
        <div className="w-full bg-black shrink-0" style={{ height: '28vh' }} />

        {/* 空キュー時の案内 */}
        {queue.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 px-4 text-center">
            <p className="text-[0.7rem] font-thin text-black/40 uppercase tracking-widest">キューが空です</p>
            <p className="text-[0.7rem] font-thin text-black/30">
              BROWSE画面で動画を長押ししてチャプターを追加してください
            </p>
          </div>
        )}

        {/* 再生コントロール */}
        <div className="py-3">
          <PlayControls />
        </div>

        {/* CUE セクション */}
        {queue.length > 0 && (
          <section className="px-4 mt-[2.4rem]">
            <h2 className="text-[1rem] font-bold uppercase mb-[0.8rem]">CUE</h2>

            {/* キュー一覧 */}
            <div className="flex flex-col gap-[0.8rem]">
              {queue.map((item, idx) => {
                const isCurrent = idx === currentIndex;
                const itemTimeRange = item.isFullVideo
                  ? '全編再生'
                  : `${formatSeconds(item.startSeconds)}${
                      isFinite(item.endSeconds) && item.endSeconds !== Number.MAX_SAFE_INTEGER
                        ? ` — ${formatSeconds(item.endSeconds)}`
                        : ''
                    }`;
                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-3 py-2 px-2 ${isCurrent ? 'bg-[#F0F0F0]' : ''}`}
                  >
                    <span className="text-[0.7rem] font-normal text-black/40 mt-0.5 w-5 shrink-0 text-right">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[0.8rem] font-bold leading-snug truncate">{item.chapterLabel}</p>
                      <p className="text-[0.7rem] font-thin text-black/40 truncate mt-[0.2rem]">{item.videoTitle}</p>
                      <p className="text-[0.7rem] font-thin text-black/40 mt-[0.2rem]">{itemTimeRange}</p>
                    </div>
                    <button
                      onClick={() => removeFromQueue(item.id)}
                      className="shrink-0 w-8 h-8 flex items-center justify-center text-black/30 cursor-pointer mt-0.5"
                      aria-label="キューから削除"
                    >
                      <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>close</span>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* 共有ボタン */}
            <div className="mt-[2.4rem] mb-8">
              <button
                onClick={() => setShareOpen(true)}
                className="text-[0.8rem] font-bold uppercase cursor-pointer px-4 py-2 bg-black text-white"
              >
                共有
              </button>
            </div>

            {/* この動画のチャプターを追加 */}
            {currentVideoMeta && (
              <div className="mb-8">
                <button
                  onClick={() => setChapterSheetOpen(true)}
                  className="text-[0.7rem] font-thin text-black/50 cursor-pointer"
                >
                  + この動画のチャプターを追加
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {/* シェアモーダル */}
      {shareOpen && (
        <ShareModal queue={queue} onClose={() => setShareOpen(false)} />
      )}

      {/* チャプター追加シート */}
      {chapterSheetOpen && currentVideoMeta && (
        <VideoChapterSheet
          video={currentVideoMeta}
          onClose={() => setChapterSheetOpen(false)}
          mode={{
            kind: 'add',
            onAdd: item => addItem(item),
            onRemove: id => removeFromQueue(id),
            isInQueue: id => queue.some(q => q.id === id),
          }}
        />
      )}
    </div>
  );
}
