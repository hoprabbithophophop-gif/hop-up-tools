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
  onBack: () => void;
  sharedPlaylist?: SharedPlaylist | null;
}

export function PlayView({ onBack, sharedPlaylist }: Props) {
  const { state, addItem, startPlaylist } = useChapterPlaylistContext();
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
    <div className="bg-surface text-on-surface flex flex-col" style={{ height: 'calc(100vh - 3rem)' }}>
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
        <div className="flex items-center">
          {sharedPlaylist && (
            <button
              onClick={() => startPlaylist(sharedPlaylist.items)}
              className="w-10 h-10 flex items-center justify-center text-outline hover:text-primary transition-colors cursor-pointer"
              aria-label="元のリストに戻す"
              title="元のリストに戻す"
            >
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>restart_alt</span>
            </button>
          )}
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
        </div>
      </header>

      {/* 共有プレイリストバナー */}
      {sharedPlaylist && (
        <div className="shrink-0 bg-surface-container-low border-b border-outline-variant/20 px-4 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined leading-none text-primary shrink-0" style={{ fontSize: '14px' }}>share</span>
            <p className="text-[0.625rem] text-outline truncate">
              共有リスト: <span className="text-on-surface font-bold">{sharedPlaylist.title || '（タイトルなし）'}</span>
            </p>
          </div>
          <a
            href="/youtube"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[0.6rem] font-bold uppercase tracking-widest text-outline hover:text-primary transition-colors cursor-pointer whitespace-nowrap"
          >
            自分でも作る →
          </a>
        </div>
      )}

      {/* スクロール領域 */}
      <div className="flex-1 overflow-y-auto">
        {/* 空キュー時の案内 */}
        {queue.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-outline px-4 text-center">
            <span className="material-symbols-outlined text-4xl">queue_music</span>
            <p className="text-xs uppercase tracking-widest">キューが空です</p>
            <p className="text-[0.625rem] text-outline/60">
              ピックアップ画面でチャプターや動画を選んで追加してください
            </p>
          </div>
        )}

        {/* YouTube プレイヤー: 実体は YouTubePage レベルで fixed 配置 */}
        <div className="w-full aspect-video bg-black shrink-0" />

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
              チャプター一覧を開く
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
