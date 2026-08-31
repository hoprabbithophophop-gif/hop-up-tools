import React, { useState, useEffect, useRef } from 'react';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { PlayControls } from './PlayControls';
import { TrimPanel } from './TrimPanel';
import { ShareModal } from './ShareModal';
import { NowPlayingBar } from './NowPlayingBar';
import type { SharedPlaylist } from '../../../pages/youtube/YouTubePage';

const SWIPE_DELETE_WIDTH = 72;
const SWIPE_REORDER_WIDTH = 96;
const SWIPE_OPEN_THRESHOLD = 36;
const SWIPE_AXIS_DECISION = 6;

type SwipeDir = 'left' | 'right';

interface Props {
  sharedPlaylist?: SharedPlaylist | null;
  onGoHome?: () => void;
  isLandscapePlay?: boolean;
}

export function PlayView({ sharedPlaylist, onGoHome, isLandscapePlay }: Props) {
  const { state, removeFromQueue, clearQueue, jumpTo, playChapter, reorder } = useChapterPlaylistContext();
  const { queue, currentIndex } = state;
  const currentItem = currentIndex !== null ? queue[currentIndex] ?? null : null;

  const [shareOpen, setShareOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  // スワイプ（左=削除 / 右=並び替え）
  const [swipeOpen, setSwipeOpen] = useState<{ id: string; dir: SwipeDir } | null>(null);
  const [activeDrag, setActiveDrag] = useState<{ id: string; x: number; dir: SwipeDir } | null>(null);
  const dragRef = useRef<{ id: string; x: number; dir: SwipeDir } | null>(null);
  const touchRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    axis: 'unknown' | 'horizontal' | 'vertical';
    dir: SwipeDir | null;
    startedOpenDir: SwipeDir | null;
  } | null>(null);

  useEffect(() => {
    if (swipeOpen && !queue.some(i => i.id === swipeOpen.id)) {
      setSwipeOpen(null);
    }
  }, [queue, swipeOpen]);

  const handleRowTouchStart = (id: string, e: React.TouchEvent) => {
    if (swipeOpen && swipeOpen.id !== id) {
      setSwipeOpen(null);
    }
    const t = e.touches[0];
    touchRef.current = {
      id,
      startX: t.clientX,
      startY: t.clientY,
      axis: 'unknown',
      dir: null,
      startedOpenDir: swipeOpen?.id === id ? swipeOpen.dir : null,
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
        if (ts.axis === 'horizontal') {
          ts.dir = ts.startedOpenDir ?? (dx > 0 ? 'right' : 'left');
        }
      }
    }
    if (ts.axis === 'horizontal' && ts.dir) {
      let baseX = 0;
      if (ts.startedOpenDir === 'left') baseX = -SWIPE_DELETE_WIDTH;
      if (ts.startedOpenDir === 'right') baseX = SWIPE_REORDER_WIDTH;
      let newX = baseX + dx;
      if (ts.dir === 'left') {
        newX = Math.max(-SWIPE_DELETE_WIDTH * 1.2, Math.min(0, newX));
      } else {
        newX = Math.max(0, Math.min(SWIPE_REORDER_WIDTH * 1.2, newX));
      }
      const drag = { id: ts.id, x: newX, dir: ts.dir };
      dragRef.current = drag;
      setActiveDrag(drag);
    }
  };

  const handleRowTouchEnd = () => {
    const ts = touchRef.current;
    touchRef.current = null;
    if (!ts || ts.axis !== 'horizontal') {
      setActiveDrag(null);
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && drag.id === ts.id) {
      if (drag.dir === 'left' && drag.x <= -SWIPE_OPEN_THRESHOLD) {
        setSwipeOpen({ id: ts.id, dir: 'left' });
      } else if (drag.dir === 'right' && drag.x >= SWIPE_OPEN_THRESHOLD) {
        setSwipeOpen({ id: ts.id, dir: 'right' });
      } else {
        setSwipeOpen(null);
      }
    } else {
      setSwipeOpen(null);
    }
    setActiveDrag(null);
  };

  const moveItem = (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= queue.length) return;
    reorder(idx, target);
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
        // プレイヤー枠は未再生でも常時確保する（YouTubePage側のplayerStyleと対応。2026-09-01 過去判断の移植）
        <div
          className="w-full bg-black shrink-0 overflow-hidden"
          style={{ height: 'calc(100vw * 9 / 16)' }}
        />
      )}

      {currentItem && (
        <section className="shrink-0">
          <NowPlayingBar currentItem={currentItem} />
          {/* PlayControls + フルスクリーン */}
          <div className="flex items-center px-4 pt-2">
            <div className="w-9 h-9 shrink-0" />
            <div className="flex-1 flex justify-center">
              <PlayControls />
            </div>
            <div className="w-9 h-9 shrink-0" />
          </div>
          <TrimPanel />
        </section>
      )}

      {/* ── スクロール領域（リスト + フッター操作） ── */}
      <div className="flex-1 overflow-y-auto">
        {queue.length === 0 ? (
          /* 空状態: 追加手順の2ステップ図解（2026-09-01 pick採用案B。文言はHome=タップでシートが開く実装に合わせる） */
          <div className="flex flex-col items-center gap-5 px-6 pt-10 text-center">
            <p className="text-[0.7rem] font-thin text-black/40 uppercase tracking-widest">キューが空です</p>
            <div className="w-full max-w-[260px] flex flex-col gap-3">
              <div className="flex items-center gap-3 border border-black/10 p-3 text-left">
                <span className="material-symbols-outlined text-black/60">touch_app</span>
                <p className="text-[0.72rem] text-black/60 leading-relaxed">
                  <span className="font-bold text-black">1. HOMEの動画をタップ</span>
                  <br />チャプター一覧が開きます
                </p>
              </div>
              <div className="flex items-center gap-3 border border-black/10 p-3 text-left">
                <span className="material-symbols-outlined text-black/60">playlist_add</span>
                <p className="text-[0.72rem] text-black/60 leading-relaxed">
                  <span className="font-bold text-black">2. ＋ でキューに追加</span>
                  <br />ここに順番に並びます
                </p>
              </div>
            </div>
            {onGoHome && (
              <button
                onClick={onGoHome}
                className="mt-1 px-6 py-2.5 bg-black text-white text-[0.8rem] font-bold uppercase cursor-pointer"
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
                  className="flex items-center justify-center gap-1.5 w-40 py-2.5 bg-black text-white text-[0.8rem] font-bold cursor-pointer"
                >
                  <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>play_arrow</span>
                  すべて再生
                </button>
              </div>
            )}
            <div className="px-4">
              {/* 行をカード状に分離（2026-09-01 Hop指示「行の区切りデザインもつけて、影とか」） */}
              <div className="flex flex-col gap-1.5">
                {queue.map((item, idx) => {
                  const isCurrent = idx === currentIndex;
                  const isFirst = idx === 0;
                  const isLast = idx === queue.length - 1;
                  const openDir = swipeOpen?.id === item.id ? swipeOpen.dir : null;
                  const isDragging = activeDrag?.id === item.id;
                  const xOffset = isDragging
                    ? activeDrag!.x
                    : openDir === 'left'
                      ? -SWIPE_DELETE_WIDTH
                      : openDir === 'right'
                        ? SWIPE_REORDER_WIDTH
                        : 0;
                  return (
                    <div key={item.id} className="relative overflow-hidden group bg-white border border-black/5 shadow-[0_1px_3px_rgba(0,0,0,0.10)]">
                      {/* 左スワイプで右側に現れる削除ボタン */}
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setSwipeOpen(null);
                          removeFromQueue(item.id);
                        }}
                        className="absolute right-0 top-0 bottom-0 bg-red-700 text-white text-[0.7rem] font-bold flex items-center justify-center cursor-pointer"
                        style={{ width: `${SWIPE_DELETE_WIDTH}px` }}
                        aria-label="キューから削除"
                        tabIndex={openDir === 'left' ? 0 : -1}
                      >
                        削除
                      </button>
                      {/* 右スワイプで左側に現れる ↑ / ↓ ボタン */}
                      <div
                        className="absolute left-0 top-0 bottom-0 flex"
                        style={{ width: `${SWIPE_REORDER_WIDTH}px` }}
                      >
                        <button
                          onClick={e => { e.stopPropagation(); moveItem(idx, -1); }}
                          disabled={isFirst}
                          className="flex-1 bg-black text-white flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="1つ上に移動"
                          tabIndex={openDir === 'right' ? 0 : -1}
                        >
                          <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>arrow_upward</span>
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); moveItem(idx, 1); }}
                          disabled={isLast}
                          className="flex-1 bg-black/80 text-white flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-l border-white/15"
                          aria-label="1つ下に移動"
                          tabIndex={openDir === 'right' ? 0 : -1}
                        >
                          <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>arrow_downward</span>
                        </button>
                      </div>
                      {/* スライドする本体 */}
                      <div
                        onClick={() => {
                          if (openDir) {
                            setSwipeOpen(null);
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
                            : 'py-1.5 px-2 border-l-2 border-transparent hover:bg-neutral-50 active:bg-neutral-100'
                        }`}
                      >
                        {/* 行の情報量: サムネ＋時間・所属動画名（2026-09-01 pick採用案B） */}
                        <div className="shrink-0 w-16">
                          <img src={item.thumbnailUrl} alt="" className="w-full aspect-video object-cover" loading="lazy" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`leading-snug line-clamp-3 ${
                            isCurrent
                              ? 'text-[0.65rem] font-normal first-line:text-[0.8rem] first-line:font-bold'
                              : 'text-[0.62rem] font-normal text-black/40 first-line:text-[0.75rem] first-line:text-black/60'
                          }`}>{item.chapterLabel}</p>
                          <p className="text-[0.58rem] text-black/35 truncate mt-0.5">
                            {item.isFullVideo
                              ? item.channelName
                              : `${item.chapterTimestamp}・${item.videoTitle}`}
                          </p>
                        </div>
                      </div>
                      {/* PC（hoverデバイス）のみ右端に絶対配置で ↑ / ↓ / × が出る */}
                      <div
                        className={`absolute right-0 top-0 bottom-0 flex items-center pl-4 pr-1 bg-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 group-hover:delay-200 pointer-events-none group-hover:pointer-events-auto ${
                          openDir ? 'hidden' : ''
                        }`}
                        style={{ transform: `translateX(${xOffset}px)` }}
                      >
                        <button
                          onClick={e => { e.stopPropagation(); moveItem(idx, -1); }}
                          disabled={isFirst}
                          className="w-6 h-6 flex items-center justify-center cursor-pointer text-black/40 hover:text-black/70 disabled:opacity-20 disabled:cursor-not-allowed"
                          aria-label="1つ上に移動"
                          tabIndex={-1}
                        >
                          <span className="material-symbols-outlined leading-none" style={{ fontSize: 16 }}>arrow_upward</span>
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); moveItem(idx, 1); }}
                          disabled={isLast}
                          className="w-6 h-6 flex items-center justify-center cursor-pointer text-black/40 hover:text-black/70 disabled:opacity-20 disabled:cursor-not-allowed"
                          aria-label="1つ下に移動"
                          tabIndex={-1}
                        >
                          <span className="material-symbols-outlined leading-none" style={{ fontSize: 16 }}>arrow_downward</span>
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); removeFromQueue(item.id); }}
                          className={`flex items-center justify-center cursor-pointer text-black/40 hover:text-black/70 ${isCurrent ? 'w-7 h-7' : 'w-6 h-6'}`}
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

              <div className="mt-6 mb-20 flex flex-col items-center">
                <button
                  onClick={() => setShareOpen(true)}
                  className="flex items-center justify-center w-40 py-2.5 bg-black text-white text-[0.8rem] font-bold cursor-pointer"
                >
                  共有
                </button>
                <div className="h-10" />
                <button
                  onClick={() => setClearConfirmOpen(true)}
                  className="flex items-center justify-center w-40 py-2.5 bg-white border border-black/20 text-red-700 text-[0.8rem] font-normal cursor-pointer"
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
                className="text-[0.8rem] font-bold cursor-pointer px-4 py-2 bg-red-700 text-white"
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
