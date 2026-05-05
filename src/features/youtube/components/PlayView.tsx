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
  isLandscapePlay?: boolean;
}

export function PlayView({ sharedPlaylist, onGoHome, onToggleFullscreen, isLandscapePlay }: Props) {
  const { state, removeFromQueue, clearQueue, startPlaylist, jumpTo, toggleShuffle } = useChapterPlaylistContext();
  const { queue, currentIndex } = state;
  const currentItem = currentIndex !== null ? queue[currentIndex] ?? null : null;

  const [trimOpen, setTrimOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  return (
    <div className="bg-white text-black flex flex-col" style={{ height: 'calc(100svh - 68px)' }}>
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
        {!isLandscapePlay && (
          <div
            className="w-full bg-black shrink-0 transition-[height] duration-300 ease-in-out overflow-hidden"
            style={{ height: currentIndex !== null ? '200px' : '0px' }}
          />
        )}

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
            {/* ── コントロール（再生中のみ表示） ── */}
            {currentItem && (
              <section className="mt-3">
                {(() => {
                  const endKnown = isFinite(currentItem.endSeconds) && currentItem.endSeconds !== Number.MAX_SAFE_INTEGER;
                  return (
                    <div className="px-4 mb-2">
                      <p className="text-[0.95rem] font-bold leading-snug line-clamp-2">{currentItem.chapterLabel}</p>
                      <button
                        onClick={() => setTrimOpen(v => !v)}
                        className="flex items-center gap-1 mt-0.5 cursor-pointer group"
                      >
                        <span className="text-[0.65rem] font-thin text-black/40 tabular-nums">
                          {formatSeconds(currentItem.startSeconds)} – {endKnown ? formatSeconds(currentItem.endSeconds) : '--:--'}
                        </span>
                        <span className="material-symbols-outlined leading-none text-black/20 group-hover:text-black/50 transition-colors" style={{ fontSize: '14px' }}>tune</span>
                      </button>
                    </div>
                  );
                })()}
                <div className="flex items-center justify-center px-4">
                  <PlayControls />
                  {onToggleFullscreen && (
                    <button
                      onClick={onToggleFullscreen}
                      className="w-9 h-9 flex items-center justify-center text-black/30 hover:text-black/60 cursor-pointer transition-colors ml-auto"
                      aria-label="全画面"
                    >
                      <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>fullscreen</span>
                    </button>
                  )}
                </div>
                {trimOpen && <TrimPanel />}
              </section>
            )}

            {/* ── リスト ── */}
            <section className="mt-4">
              {/* 未再生時: 再生開始ボタン */}
              {!currentItem && (
                <div className="flex items-center justify-center gap-4 px-4 mb-4">
                  <button
                    onClick={() => jumpTo(0)}
                    className="flex items-center gap-1.5 px-5 py-2.5 bg-black text-white text-[0.8rem] font-bold cursor-pointer"
                  >
                    <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>play_arrow</span>
                    すべて再生
                  </button>
                  <button
                    onClick={() => { toggleShuffle(); jumpTo(0); }}
                    className="flex items-center gap-1.5 px-5 py-2.5 border border-black/20 text-black text-[0.8rem] font-bold cursor-pointer"
                  >
                    <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>shuffle</span>
                    シャッフル
                  </button>
                </div>
              )}
              <div className="px-4">
                <div className="flex flex-col">
                  {queue.map((item, idx) => {
                    const isCurrent = idx === currentIndex;
                    const isFirst = !currentItem && idx === 0;
                    return (
                      <div
                        key={item.id}
                        onClick={() => jumpTo(idx)}
                        className={`flex items-center gap-3 cursor-pointer transition-colors ${
                          isCurrent
                            ? 'py-2.5 px-2 border-l-2 border-black'
                            : isFirst
                              ? 'py-1.5 px-2 border-l-2 border-black/20 bg-black/[0.02]'
                              : 'py-1.5 px-2 border-l-2 border-transparent hover:bg-black/[0.03] active:bg-black/[0.06]'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className={`leading-snug line-clamp-1 ${
                            isCurrent ? 'text-[0.8rem] font-bold'
                              : isFirst ? 'text-[0.75rem] font-bold text-black/80'
                              : 'text-[0.75rem] font-normal text-black/60'
                          }`}>{item.chapterLabel}</p>
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

                <div className="mt-6 mb-20 flex justify-center gap-8">
                  <button
                    onClick={() => setShareOpen(true)}
                    className="text-[0.7rem] font-thin text-black/30 cursor-pointer"
                  >
                    共有
                  </button>
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
