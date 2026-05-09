import React, { useState, useEffect, useRef } from 'react';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { PlayControls } from './PlayControls';
import { TrimPanel } from './TrimPanel';
import { ShareModal } from './ShareModal';
import type { SharedPlaylist } from '../../../pages/youtube/YouTubePage';

function formatPublishedDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

const SWIPE_REVEAL_WIDTH = 72;
const SWIPE_OPEN_THRESHOLD = 36;
const SWIPE_AXIS_DECISION = 6;

interface Props {
  sharedPlaylist?: SharedPlaylist | null;
  onGoHome?: () => void;
  onToggleFullscreen?: () => void;
  isLandscapePlay?: boolean;
}

export function PlayView({ sharedPlaylist, onGoHome, onToggleFullscreen, isLandscapePlay }: Props) {
  const { state, removeFromQueue, clearQueue, jumpTo, playChapter } = useChapterPlaylistContext();
  const { queue, currentIndex } = state;
  const currentItem = currentIndex !== null ? queue[currentIndex] ?? null : null;

  const [shareOpen, setShareOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [titleBarExpanded, setTitleBarExpanded] = useState(false);

  useEffect(() => {
    setTitleBarExpanded(false);
  }, [currentItem?.id]);

  // スワイプ削除
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<{ id: string; x: number } | null>(null);
  const dragRef = useRef<{ id: string; x: number } | null>(null);
  const touchRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    axis: 'unknown' | 'horizontal' | 'vertical';
    startedOpen: boolean;
  } | null>(null);

  useEffect(() => {
    if (swipeOpenId && !queue.some(i => i.id === swipeOpenId)) {
      setSwipeOpenId(null);
    }
  }, [queue, swipeOpenId]);

  const handleRowTouchStart = (id: string, e: React.TouchEvent) => {
    if (swipeOpenId && swipeOpenId !== id) {
      setSwipeOpenId(null);
    }
    const t = e.touches[0];
    touchRef.current = {
      id,
      startX: t.clientX,
      startY: t.clientY,
      axis: 'unknown',
      startedOpen: swipeOpenId === id,
    };
    dragRef.current = null;
  };

  const handleRowTouchMove = (e: React.TouchEvent) => {
    const ts = touchRef.current;
    if (!ts) return;
    const t = e.touches[0];
    const dx = t.clientX - ts.startX;
    const dy = t.clientY - ts.startY;
    if (ts.axis === 'unknown') {
      if (Math.abs(dx) > SWIPE_AXIS_DECISION || Math.abs(dy) > SWIPE_AXIS_DECISION) {
        ts.axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }
    }
    if (ts.axis === 'horizontal') {
      const baseX = ts.startedOpen ? -SWIPE_REVEAL_WIDTH : 0;
      let newX = baseX + dx;
      newX = Math.max(-SWIPE_REVEAL_WIDTH * 1.2, Math.min(0, newX));
      const drag = { id: ts.id, x: newX };
      dragRef.current = drag;
      setActiveDrag(drag);
    }
  };

  const handleRowTouchEnd = () => {
    const ts = touchRef.current;
    touchRef.current = null;
    if (!ts) {
      setActiveDrag(null);
      return;
    }
    if (ts.axis !== 'horizontal') {
      setActiveDrag(null);
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && drag.id === ts.id && drag.x <= -SWIPE_OPEN_THRESHOLD) {
      setSwipeOpenId(ts.id);
    } else {
      setSwipeOpenId(null);
    }
    setActiveDrag(null);
  };

  return (
    <div className="bg-white text-black flex flex-col" style={{ height: queue.length > 0 ? 'calc(100svh - 68px)' : '100svh' }}>
      {/* ── 固定領域（プレイヤー位置確保 + 再生中セクション） ── */}
      {sharedPlaylist && (
        <div className="shrink-0 bg-black/5 px-4 py-2">
          <p className="text-[0.7rem] font-thin text-black/50 truncate">
            共有: <span className="text-black font-bold">{sharedPlaylist.title || '（タイトルなし）'}</span>
          </p>
        </div>
      )}

      {!isLandscapePlay && (
        <div
          className="w-full bg-black shrink-0 overflow-hidden"
          style={{ height: currentIndex !== null ? 'calc(100vw * 9 / 16)' : '0px' }}
        />
      )}

      {currentItem && (
        <section className="shrink-0">
          {/* チャプター名 + 出典（動画タイトル · 投稿日）の黒バー。タップで全文展開 */}
          <div
            className="bg-black px-4 py-2 border-t border-white/10 cursor-pointer"
            onClick={() => setTitleBarExpanded(v => !v)}
          >
            <p className={`text-white text-[0.7rem] font-normal ${titleBarExpanded ? 'whitespace-normal break-words' : 'truncate'}`}>
              {currentItem.chapterLabel}
            </p>
            {(() => {
              const dateText = formatPublishedDate(currentItem.publishedAt);
              const showTitle = !currentItem.isFullVideo;
              if (!showTitle && !dateText) return null;
              return (
                <p className={`text-white/40 text-[0.6rem] font-thin mt-0.5 ${titleBarExpanded ? 'whitespace-normal break-words' : 'truncate'}`}>
                  {showTitle && currentItem.videoTitle}
                  {showTitle && dateText && ' · '}
                  {dateText}
                </p>
              );
            })()}
          </div>
          {/* PlayControls + フルスクリーン */}
          <div className="flex items-center px-4 pt-2">
            <div className="w-9 h-9 shrink-0" />
            <div className="flex-1 flex justify-center">
              <PlayControls />
            </div>
            {onToggleFullscreen ? (
              <button
                onClick={onToggleFullscreen}
                className="w-9 h-9 shrink-0 flex items-center justify-center text-black/30 hover:text-black/60 cursor-pointer transition-colors"
                aria-label="全画面"
              >
                <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>fullscreen</span>
              </button>
            ) : (
              <div className="w-9 h-9 shrink-0" />
            )}
          </div>
          <TrimPanel />
        </section>
      )}

      {/* ── スクロール領域（リスト + フッター操作） ── */}
      <div className="flex-1 overflow-y-auto">
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
          <section className="mt-4">
            {/* 未再生時: 再生開始ボタン */}
            {!currentItem && (
              <div className="flex items-center justify-center px-4 mb-4">
                <button
                  onClick={() => {
                    const item = queue[0];
                    if (item) {
                      jumpTo(0);
                      playChapter(item.videoId, item.startSeconds, item.endSeconds);
                    }
                  }}
                  className="flex items-center gap-1.5 px-5 py-2.5 bg-black text-white text-[0.8rem] font-bold cursor-pointer"
                >
                  <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>play_arrow</span>
                  すべて再生
                </button>
              </div>
            )}
            <div className="px-4">
              <div className="flex flex-col">
                {queue.map((item, idx) => {
                  const isCurrent = idx === currentIndex;
                  const isOpen = swipeOpenId === item.id;
                  const isDragging = activeDrag?.id === item.id;
                  const xOffset = isDragging ? activeDrag!.x : isOpen ? -SWIPE_REVEAL_WIDTH : 0;
                  return (
                    <div key={item.id} className="relative overflow-hidden group">
                      {/* スワイプで現れる削除ボタン */}
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setSwipeOpenId(null);
                          removeFromQueue(item.id);
                        }}
                        className="absolute right-0 top-0 bottom-0 bg-black text-white text-[0.7rem] font-bold flex items-center justify-center cursor-pointer"
                        style={{ width: `${SWIPE_REVEAL_WIDTH}px` }}
                        aria-label="キューから削除"
                        tabIndex={isOpen ? 0 : -1}
                      >
                        削除
                      </button>
                      {/* スライドする本体 */}
                      <div
                        onClick={() => {
                          if (isOpen) {
                            setSwipeOpenId(null);
                            return;
                          }
                          jumpTo(idx);
                        }}
                        onTouchStart={(e) => handleRowTouchStart(item.id, e)}
                        onTouchMove={handleRowTouchMove}
                        onTouchEnd={handleRowTouchEnd}
                        onTouchCancel={handleRowTouchEnd}
                        style={{
                          transform: `translateX(${xOffset}px)`,
                          transition: isDragging ? 'none' : 'transform 0.2s ease',
                        }}
                        className={`flex items-center gap-3 cursor-pointer bg-white relative ${
                          isCurrent
                            ? 'py-2.5 px-2 border-l-2 border-black'
                            : 'py-1.5 px-2 border-l-2 border-transparent hover:bg-black/[0.03] active:bg-black/[0.06]'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className={`leading-snug line-clamp-1 ${
                            isCurrent
                              ? 'text-[0.8rem] font-bold'
                              : 'text-[0.75rem] font-normal text-black/60'
                          }`}>{item.chapterLabel}</p>
                        </div>
                        {/* PC（hoverデバイス）のみ右端に×が出る */}
                        <button
                          onClick={e => { e.stopPropagation(); removeFromQueue(item.id); }}
                          className={`shrink-0 flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity ${
                            isCurrent ? 'w-7 h-7 text-black/40 hover:text-black/70' : 'w-6 h-6 text-black/40 hover:text-black/70'
                          }`}
                          aria-label="キューから削除"
                          tabIndex={-1}
                        >
                          <span className="material-symbols-outlined leading-none" style={{ fontSize: isCurrent ? 16 : 14 }}>close</span>
                        </button>
                      </div>
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
