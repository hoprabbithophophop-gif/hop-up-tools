import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChapterPlaylistProvider } from '../../features/videos/context/ChapterPlaylistContext';
import { useChapterPlaylistContext } from '../../features/videos/context/ChapterPlaylistContext';
import { PickupView } from '../../features/youtube/components/PickupView';
import { PlayView } from '../../features/youtube/components/PlayView';
import { Player } from '../../features/youtube/components/Player';
import { ExpiredView } from '../../features/youtube/components/ExpiredView';
import { getPlaylistShare, fromShareItem } from '../../features/videos/hooks/usePlaylistShare';
import type { ChapterQueueItem } from '../../features/videos/types/playlist';

type PageState = 'pickup' | 'play';
type RestoreStatus = 'idle' | 'loading' | 'done' | 'expired';

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <p className="text-xs text-outline uppercase tracking-widest">読み込み中...</p>
    </div>
  );
}

/** ChapterPlaylistProvider 内側のコンテンツ */
function ChapterPickupContent() {
  const [searchParams] = useSearchParams();
  const playlistId = searchParams.get('p');

  const [pageState, setPageState] = useState<PageState>('pickup');
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>(
    playlistId ? 'loading' : 'idle'
  );

  const { state, startPlaylist, selection, pause, resume } = useChapterPlaylistContext();
  const hasQueue = state.queue.length > 0;
  const currentItem = state.currentIndex !== null ? state.queue[state.currentIndex] ?? null : null;

  // 一覧 → 再生遷移時のスクロール位置を保存し、戻ったときに復元する
  const pickupScrollRef = useRef(0);

  // FloatingBar（h-14）が表示中はミニプレーヤーを1段上げる
  const miniBottom = selection.selectionCount > 0 ? 'bottom-14' : 'bottom-0';

  useEffect(() => {
    document.title = 'HELLO! VIDEO | hop-up-tools';
  }, []);

  // ?p= から共有プレイリスト復元
  useEffect(() => {
    if (!playlistId) {
      setRestoreStatus('idle');
      return;
    }
    let cancelled = false;
    setRestoreStatus('loading');

    getPlaylistShare(playlistId).then(share => {
      if (cancelled) return;
      if (!share) {
        setRestoreStatus('expired');
        return;
      }
      const items = share.items.map(fromShareItem);
      startPlaylist(items);
      setRestoreStatus('done');
      setPageState('play');
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  const handlePlay = useCallback((items: ChapterQueueItem[]) => {
    pickupScrollRef.current = window.scrollY;
    startPlaylist(items);
    setPageState('play');
  }, [startPlaylist]);

  const handleBack = useCallback(() => {
    setPageState('pickup');
  }, []);

  // pickup に戻ったらスクロール位置を復元（2フレーム待って PickupView が表示されてから）
  useEffect(() => {
    if (pageState === 'pickup') {
      const y = pickupScrollRef.current;
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
    }
  }, [pageState]);

  if (restoreStatus === 'loading') return <LoadingScreen />;
  if (restoreStatus === 'expired') return <ExpiredView />;

  // Player の表示位置:
  //   play mode    → PlayView のプレーヤーエリアに重なる固定配置（top-12 = PlayView header h-12 分）
  //   pickup + queue → ミニプレーヤー（左端 128px × 72px）
  //   pickup + no queue → 非表示
  const playerWrapClass =
    pageState === 'play'
      ? 'fixed top-12 left-0 right-0 aspect-video z-20'
      : hasQueue
      ? `fixed ${miniBottom} left-0 w-32 h-[72px] z-40`
      : 'hidden';

  return (
    <>
      {/* YouTube Player — DOM 上は常に1つ、位置だけ切り替え */}
      <div className={playerWrapClass}>
        <Player />
      </div>

      {/* ミニプレーヤー情報バー（動画の右隣、pickup + queue 時のみ） */}
      {pageState === 'pickup' && hasQueue && (
        <div
          data-testid="mini-player"
          className={`fixed ${miniBottom} left-32 right-0 h-[72px] z-40 bg-black flex items-center px-3 gap-2 cursor-pointer border-l border-white/10`}
          onClick={() => setPageState('play')}
        >
          <div className="flex-1 min-w-0">
            <p className="text-[0.6rem] uppercase tracking-widest text-white/50 leading-none mb-1">
              NOW PLAYING
            </p>
            <p className="text-white text-[0.75rem] font-bold truncate leading-tight">
              {currentItem?.chapterLabel ?? ''}
            </p>
            {currentItem?.channelName && (
              <p className="text-white/50 text-[0.625rem] truncate mt-0.5">
                {currentItem.channelName}
              </p>
            )}
          </div>
          <button
            onClick={e => {
              e.stopPropagation();
              state.isPlaying ? pause() : resume();
            }}
            className="shrink-0 w-9 h-9 flex items-center justify-center text-white hover:text-white/70 transition-colors cursor-pointer"
            aria-label={state.isPlaying ? '一時停止' : '再生'}
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '24px' }}>
              {state.isPlaying ? 'pause' : 'play_arrow'}
            </span>
          </button>
          <span className="material-symbols-outlined leading-none text-white/40 shrink-0" style={{ fontSize: '18px' }}>
            expand_less
          </span>
        </div>
      )}

      {/* PickupView: play state のとき CSS hidden（アンマウントしない） */}
      <div className={pageState === 'play' ? 'hidden' : ''}>
        <PickupView onPlay={handlePlay} />
      </div>

      {/* PlayView: 常時 DOM 保持（IFrame維持のため）、pickup state のとき CSS hidden */}
      <div data-testid="play-view" className={pageState === 'pickup' ? 'hidden' : ''}>
        <PlayView onBack={handleBack} />
      </div>
    </>
  );
}

export default function YouTubePage() {
  return (
    <ChapterPlaylistProvider>
      <ChapterPickupContent />
    </ChapterPlaylistProvider>
  );
}
