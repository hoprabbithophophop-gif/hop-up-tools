import React, { useState, useEffect, useCallback } from 'react';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { formatSeconds } from '../../videos/utils/playlist-utils';
import { getSupabase } from '../../../lib/supabase';
import { VideoChapterSheet } from './VideoChapterSheet';
import { Player } from './Player';
import { PlayControls } from './PlayControls';
import { TrimPanel } from './TrimPanel';
import { QueueList } from './QueueList';
import { ShareModal } from './ShareModal';

interface VideoMeta {
  video_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  description_short: string;
}

interface Props {
  onBack: () => void;
}

export function PlayView({ onBack }: Props) {
  const { state, addItem } = useChapterPlaylistContext();
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
      ? '動画全体'
      : `${formatSeconds(current.startSeconds)}${
          isFinite(current.endSeconds) && current.endSeconds !== Number.MAX_SAFE_INTEGER
            ? ` — ${formatSeconds(current.endSeconds)}`
            : ''
        }`
    : '';

  return (
    <div className="bg-surface text-on-surface h-screen flex flex-col">
      {/* ヘッダー */}
      <header className="shrink-0 bg-surface border-b border-outline-variant/20 px-4 h-12 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[0.6875rem] text-outline hover:text-primary transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>
            expand_more
          </span>
          <span className="font-bold uppercase tracking-widest">NOW PLAYING</span>
        </button>
        <button
          onClick={() => setShareOpen(true)}
          className="w-10 h-10 flex items-center justify-center text-outline hover:text-primary transition-colors cursor-pointer"
          aria-label="シェア"
          disabled={queue.length === 0}
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>
            share
          </span>
        </button>
      </header>

      {/* スクロール領域 */}
      <div className="flex-1 overflow-y-auto">
        {/* YouTube プレイヤー */}
        <Player />

        {/* 再生中情報 */}
        {current ? (
          <div className="px-4 py-3 border-b border-outline-variant/20">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[0.5rem] font-bold uppercase px-1 py-0.5 bg-black text-white leading-none">
                    {tag}
                  </span>
                  {currentIndex !== null && (
                    <span className="text-[0.6rem] text-outline font-mono">
                      {String(currentIndex + 1).padStart(2, '0')} / {queue.length}
                    </span>
                  )}
                </div>
                <p className="text-[0.9rem] font-bold leading-snug truncate">
                  {current.chapterLabel}
                </p>
                {!isFullVideo && (
                  <p className="text-[0.625rem] text-outline truncate mt-0.5">
                    {current.videoTitle}
                  </p>
                )}
                <p className="text-[0.625rem] font-mono text-outline/70 mt-0.5">
                  {timeRange}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-4 border-b border-outline-variant/20 text-[0.625rem] text-outline uppercase tracking-widest">
            再生待機中
          </div>
        )}

        {/* TRIM ↔ QUEUE タブ */}
        <div>
          {/* タブヘッダー */}
          <div className="flex border-b border-outline-variant/20">
            <button
              onClick={() => setTrimOpen(true)}
              className={`flex-1 h-10 text-[0.6875rem] font-bold uppercase tracking-widest transition-colors cursor-pointer border-b-2 ${
                trimOpen
                  ? 'border-primary text-primary'
                  : 'border-transparent text-outline hover:text-on-surface'
              }`}
            >
              TRIM
            </button>
            <button
              onClick={() => setTrimOpen(false)}
              className={`flex-1 h-10 text-[0.6875rem] font-bold uppercase tracking-widest transition-colors cursor-pointer border-b-2 ${
                !trimOpen
                  ? 'border-primary text-primary'
                  : 'border-transparent text-outline hover:text-on-surface'
              }`}
            >
              QUEUE ({queue.length})
            </button>
          </div>

          {/* タブコンテンツ */}
          {trimOpen ? (
            <TrimPanel />
          ) : (
            <QueueList />
          )}
        </div>

        {/* この動画のチャプターを追加 */}
        {currentVideoMeta && (
          <div className="border-t border-outline-variant/20 px-4 py-3">
            <button
              onClick={() => setChapterSheetOpen(true)}
              className="flex items-center gap-2 w-full text-left text-[0.6875rem] font-bold uppercase tracking-widest text-outline hover:text-on-surface transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>
                playlist_add
              </span>
              この動画のチャプターを追加
            </button>
          </div>
        )}
      </div>

      {/* 再生コントロール（常時表示） */}
      <div className="shrink-0 py-3 border-t border-outline-variant/20 bg-surface">
        <PlayControls />
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
            isInQueue: id => queue.some(q => q.id === id),
          }}
        />
      )}
    </div>
  );
}
