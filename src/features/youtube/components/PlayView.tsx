import React, { useState } from 'react';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { formatSeconds } from '../../videos/utils/playlist-utils';
import { PlayControls } from './PlayControls';
import { TrimPanel } from './TrimPanel';
import { ShareModal } from './ShareModal';
import type { SharedPlaylist } from '../../../pages/youtube/YouTubePage';

interface Props {
  sharedPlaylist?: SharedPlaylist | null;
  onGoHome?: () => void;
  onToggleFullscreen?: () => void;
}

export function PlayView({ sharedPlaylist, onGoHome, onToggleFullscreen }: Props) {
  const { state, removeFromQueue, clearQueue, startPlaylist, jumpTo } = useChapterPlaylistContext();
  const { queue, currentIndex } = state;
  const currentItem = currentIndex !== null ? queue[currentIndex] ?? null : null;

  const [trimOpen, setTrimOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

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
        <div className="w-full bg-black shrink-0" style={{ height: '28vh', minHeight: '200px' }} />

        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 px-4 text-center">
            <p className="text-[0.7rem] font-thin text-black/40 uppercase tracking-widest">キューが空です</p>
            <p className="text-[0.7rem] font-thin text-black/30">
              HOME画面で動画を長押ししてチャプターを追加してください
            </p>
            {onGoHome && (
              <button
                onClick={onGoHome}
                className="mt-2 px-6 py-2.5 bg-black text-white text-[0.8rem] font-bold uppercase cursor-pointer"
              >
                動画を探す
              </button>
            )}
          </div>
        ) : (
          <>
            {/* ── コントロール ── */}
            <section className="mt-3">
              <p className="text-[0.7rem] font-bold uppercase tracking-widest text-black/40 px-4 mb-1">コントロール</p>
              {currentItem && (
                <p className="text-[0.8rem] font-bold px-4 mb-2 truncate">{currentItem.chapterLabel}</p>
              )}
              <PlayControls />
              <div className="px-4 mt-3 flex items-center gap-4">
                <button
                  onClick={() => setTrimOpen(v => !v)}
                  className="flex items-center gap-1 text-[0.7rem] font-bold text-black/40 uppercase tracking-widest cursor-pointer"
                >
                  調整
                  <span className="material-symbols-outlined leading-none" style={{ fontSize: '14px' }}>
                    {trimOpen ? 'expand_less' : 'expand_more'}
                  </span>
                </button>
                {onToggleFullscreen && (
                  <button
                    onClick={onToggleFullscreen}
                    className="flex items-center gap-1 text-[0.7rem] font-bold text-black/40 uppercase tracking-widest cursor-pointer"
                  >
                    <span className="material-symbols-outlined leading-none" style={{ fontSize: '16px' }}>fullscreen</span>
                    全画面
                  </button>
                )}
              </div>
              {trimOpen && <TrimPanel />}
            </section>

            {/* ── リスト ── */}
            <section className="mt-[2.4rem]">
              <div className="flex items-center justify-between px-4 mb-[0.8rem]">
                <p className="text-[0.7rem] font-bold uppercase tracking-widest text-black/40">リスト</p>
                <button
                  onClick={() => setShareOpen(true)}
                  className="flex items-center gap-1 text-[0.7rem] font-bold text-black/40 cursor-pointer"
                >
                  <span className="material-symbols-outlined leading-none" style={{ fontSize: '16px' }}>share</span>
                  共有
                </button>
              </div>
              <div className="px-4">
                <div className="flex flex-col">
                  {queue.map((item, idx) => {
                    const isCurrent = idx === currentIndex;
                    const prevItem = idx > 0 ? queue[idx - 1] : null;
                    const sameVideoAsPrev = prevItem?.videoId === item.videoId;
                    const itemTimeRange = item.isFullVideo
                      ? '全編'
                      : `${formatSeconds(item.startSeconds)}${
                          isFinite(item.endSeconds) && item.endSeconds !== Number.MAX_SAFE_INTEGER
                            ? `–${formatSeconds(item.endSeconds)}`
                            : ''
                        }`;
                    return (
                      <div
                        key={item.id}
                        onClick={() => jumpTo(idx)}
                        className={`flex items-center gap-3 cursor-pointer transition-colors ${
                          isCurrent
                            ? 'py-2.5 px-2'
                            : 'py-1.5 px-2 hover:bg-black/[0.03] active:bg-black/[0.06]'
                        }`}
                      >
                        <span className={`font-normal w-5 shrink-0 text-right tabular-nums ${
                          isCurrent ? 'text-[0.7rem] text-black' : 'text-[0.65rem] text-black/30'
                        }`}>
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className={`leading-snug line-clamp-2 ${
                              isCurrent ? 'text-[0.8rem] font-bold' : 'text-[0.75rem] font-normal text-black/60'
                            }`}>{item.chapterLabel}</p>
                            <span className={`font-thin shrink-0 tabular-nums ${
                              isCurrent ? 'text-[0.65rem] text-black/30' : 'text-[0.6rem] text-black/20'
                            }`}>{itemTimeRange}</span>
                          </div>
                          {!sameVideoAsPrev && (
                            <p className={`font-thin mt-0.5 truncate ${
                              isCurrent ? 'text-[0.65rem] text-black/30' : 'text-[0.6rem] text-black/20'
                            }`}>{item.videoTitle}</p>
                          )}
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); removeFromQueue(item.id); }}
                          className={`shrink-0 flex items-center justify-center cursor-pointer transition-colors ${
                            isCurrent ? 'w-7 h-7 text-black/20 hover:text-black/50' : 'w-6 h-6 text-black/15 hover:text-black/40'
                          }`}
                          aria-label="キューから削除"
                        >
                          <span className="material-symbols-outlined leading-none" style={{ fontSize: isCurrent ? 16 : 14 }}>close</span>
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 mb-20 flex justify-center">
                  <button
                    onClick={() => setClearConfirmOpen(true)}
                    className="text-[0.7rem] font-thin text-black/30 cursor-pointer"
                  >
                    全消去
                  </button>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      {/* シェアモーダル */}
      {shareOpen && (
        <ShareModal queue={queue} onClose={() => setShareOpen(false)} />
      )}

      {/* 全消去確認モーダル */}
      {clearConfirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setClearConfirmOpen(false)} />
          <div className="relative bg-white p-6 max-w-xs w-full mx-4">
            <p className="text-[0.85rem] font-bold mb-1">キューを全て削除しますか？</p>
            <p className="text-[0.7rem] font-thin text-black/50 mb-6">{queue.length}件のアイテムが削除されます</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setClearConfirmOpen(false)}
                className="text-[0.8rem] font-thin text-black/50 cursor-pointer px-4 py-2"
              >
                キャンセル
              </button>
              <button
                onClick={() => { clearQueue(); setClearConfirmOpen(false); }}
                className="text-[0.8rem] font-bold cursor-pointer px-4 py-2 bg-black text-white"
              >
                全消去
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
