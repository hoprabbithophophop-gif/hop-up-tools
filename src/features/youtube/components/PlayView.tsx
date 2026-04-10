import React, { useState } from 'react';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { formatSeconds } from '../../videos/utils/playlist-utils';
import { Player } from './Player';
import { PlayControls } from './PlayControls';
import { TrimPanel } from './TrimPanel';
import { QueueList } from './QueueList';
import { ShareModal } from './ShareModal';

interface Props {
  onBack: () => void;
}

export function PlayView({ onBack }: Props) {
  const { state } = useChapterPlaylistContext();
  const { queue, currentIndex } = state;

  const [trimOpen, setTrimOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const current = currentIndex !== null ? queue[currentIndex] : null;

  const isFullVideo = current?.isFullVideo ?? false;
  const tag = isFullVideo ? 'FULL' : 'CLIP';

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
    <div className="bg-surface text-on-surface min-h-screen flex flex-col">
      {/* ヘッダー */}
      <header className="sticky top-0 z-30 bg-surface border-b border-outline-variant/20 px-4 h-12 flex items-center justify-between shrink-0">
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

        {/* 再生コントロール */}
        <div className="py-3 border-b border-outline-variant/20">
          <PlayControls />
        </div>

        {/* TRIM ↔ QUEUE 排他トグル */}
        <div className="border-b border-outline-variant/20">
          {/* トグルヘッダー行 */}
          <div className="flex items-center justify-between px-4 h-10">
            <button
              onClick={() => setTrimOpen(v => !v)}
              className="flex items-center gap-1 text-[0.6875rem] font-bold uppercase tracking-widest text-outline hover:text-on-surface transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '16px' }}>
                {trimOpen ? 'expand_less' : 'expand_more'}
              </span>
              TRIM
            </button>

            {/* QUEUE セクションヘッダー（TRIM閉時に表示） */}
            {!trimOpen && (
              <div className="flex items-center gap-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface">
                  QUEUE ({queue.length})
                </span>
              </div>
            )}
          </div>

          {/* TRIMパネル（展開時） */}
          {trimOpen && (
            <div className="border-t border-outline-variant/10">
              <TrimPanel />
            </div>
          )}
        </div>

        {/* QUEUE リスト（TRIM閉時に表示） */}
        {!trimOpen && (
          <div>
            <QueueList />
          </div>
        )}

        {/* ピックアップに戻るボタン */}
        <div className="px-4 py-4 border-t border-outline-variant/20 mt-2">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-[0.6875rem] text-outline hover:text-primary transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>
              arrow_back
            </span>
            ピックアップに戻る
          </button>
        </div>
      </div>

      {/* シェアモーダル */}
      {shareOpen && (
        <ShareModal queue={queue} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}
