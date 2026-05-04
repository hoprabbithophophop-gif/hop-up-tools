import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChapterPlaylistProvider } from '../../features/videos/context/ChapterPlaylistContext';
import { useChapterPlaylistContext } from '../../features/videos/context/ChapterPlaylistContext';
import { BrowseView } from '../../features/youtube/components/BrowseView';
import { PlayView } from '../../features/youtube/components/PlayView';
import { Player } from '../../features/youtube/components/Player';
import { ExpiredView } from '../../features/youtube/components/ExpiredView';
import { getPlaylistShare, fromShareItem } from '../../features/videos/hooks/usePlaylistShare';
import type { ChapterQueueItem } from '../../features/videos/types/playlist';

type PageState = 'home' | 'play';
type RestoreStatus = 'idle' | 'loading' | 'done' | 'expired';

export interface SharedPlaylist {
  title: string;
  items: ChapterQueueItem[];
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <p className="text-xs text-outline uppercase tracking-widest">読み込み中...</p>
    </div>
  );
}

function ChapterPickupContent() {
  const [searchParams] = useSearchParams();
  const playlistId = searchParams.get('p');

  const [pageState, setPageState] = useState<PageState>('home');
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>(
    playlistId ? 'loading' : 'idle'
  );
  const [sharedPlaylist, setSharedPlaylist] = useState<SharedPlaylist | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [formatFilter, setFormatFilter] = useState<'all' | 'regular' | 'short'>('all');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLandscape, setIsLandscape] = useState(
    () => window.matchMedia('(orientation: landscape)').matches
  );

  const { state, startPlaylist, pause, resume, playNext, playPrev } = useChapterPlaylistContext();
  const hasQueue = state.queue.length > 0;
  const currentItem = state.currentIndex !== null ? state.queue[state.currentIndex] ?? null : null;

  const homeScrollRef = useRef(0);
  const fullscreenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'HELLO! VIDEO | hop-up-tools';
  }, []);

  useEffect(() => {
    const mql = window.matchMedia('(orientation: landscape)');
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const canNativeFullscreen = typeof document.documentElement.requestFullscreen === 'function';

  useEffect(() => {
    if (!canNativeFullscreen) return;
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, [canNativeFullscreen]);

  const toggleFullscreen = useCallback(() => {
    if (canNativeFullscreen) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        fullscreenRef.current?.requestFullscreen().catch(() => {});
      }
    } else {
      setIsFullscreen(prev => !prev);
    }
  }, [canNativeFullscreen]);

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
      setSharedPlaylist({ title: share.title, items });
      startPlaylist(items);
      setRestoreStatus('done');
      setPageState('play');
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  useEffect(() => {
    if (pageState === 'home') {
      const y = homeScrollRef.current;
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
    }
  }, [pageState]);

  const handleGoToHome = useCallback(() => {
    setPageState('home');
  }, []);

  if (restoreStatus === 'loading') return <LoadingScreen />;
  if (restoreStatus === 'expired') return <ExpiredView />;

  const isNotPlay = pageState !== 'play';
  const isPlayerActive = state.currentIndex !== null;
  const landscapeSplit = isLandscape && isPlayerActive && isNotPlay && !isFullscreen;
  const showPlayerAtTop = isNotPlay && isPlayerActive && !landscapeSplit;

  const playerWrapClass = isFullscreen
    ? 'fixed inset-0 z-[100] flex flex-col bg-black'
    : landscapeSplit
      ? 'fixed top-[60px] left-0 bottom-[68px] z-20 flex flex-col'
      : pageState === 'play' || isPlayerActive
        ? 'fixed top-[60px] left-0 right-0 z-20 flex flex-col'
        : 'hidden';

  const infoStripH = showPlayerAtTop && !isFullscreen ? 36 : 0;

  const playerStyle: React.CSSProperties | undefined = isFullscreen
    ? { height: '100dvh' }
    : landscapeSplit
      ? { width: '45vw' }
      : pageState === 'play'
        ? { height: '200px' }
        : isPlayerActive
        ? { height: `${200 + infoStripH}px` }
        : undefined;

  return (
    <div className="yt-page bg-white text-black" style={{ fontFamily: "'Inter', 'Noto Sans JP', sans-serif" }}>
      {/* 固定ヘッダー */}
      <header className={`fixed top-0 left-0 right-0 z-50 h-[60px] flex items-center gap-4 px-6 bg-white border-b border-outline-variant/20${isFullscreen ? ' hidden' : ''}`}>
        <a href="/" className="material-symbols-outlined text-black leading-none" style={{ fontSize: '20px' }}>arrow_back</a>
        <h1 className="text-xl font-black tracking-tighter uppercase flex-1">HELLO! VIDEO</h1>
        {pageState === 'home' && (
          <>
            <button
              onClick={() => setFormatFilter(prev => prev === 'all' ? 'regular' : prev === 'regular' ? 'short' : 'all')}
              className={`w-9 h-9 flex items-center justify-center cursor-pointer relative ${
                formatFilter === 'all' ? 'text-black/30' : 'text-black'
              }`}
              aria-label={formatFilter === 'all' ? 'すべての動画' : formatFilter === 'regular' ? '通常動画のみ' : 'ショートのみ'}
            >
              {formatFilter === 'all' && (
                <>
                  <span className="material-symbols-outlined leading-none absolute inset-0 flex items-center justify-center" style={{ fontSize: '22px', transform: 'translate(-5px, 9px)' }}>crop_16_9</span>
                  <span className="material-symbols-outlined leading-none absolute inset-0 flex items-center justify-center" style={{ fontSize: '22px', transform: 'translate(9px, 6px)' }}>crop_9_16</span>
                </>
              )}
              {formatFilter === 'regular' && (
                <span className="material-symbols-outlined leading-none" style={{ fontSize: '22px' }}>crop_16_9</span>
              )}
              {formatFilter === 'short' && (
                <span className="material-symbols-outlined leading-none" style={{ fontSize: '22px' }}>crop_9_16</span>
              )}
            </button>
            <button
              onClick={() => setSearchOpen(prev => !prev)}
              className={`w-9 h-9 flex items-center justify-center cursor-pointer ${
                searchOpen
                  ? 'text-black border-[2.4px] border-b-0 border-black/20'
                  : 'text-black/40'
              }`}
              aria-label="検索"
            >
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>search</span>
            </button>
          </>
        )}
      </header>

      {/* YouTube Player */}
      <div ref={fullscreenRef} className={playerWrapClass} style={playerStyle}>
        <div className="flex-1 min-h-0">
          <Player />
        </div>
        {showPlayerAtTop && !isFullscreen && (
          <div
            className="h-9 bg-black flex items-center shrink-0 cursor-pointer border-t border-white/10"
            onClick={() => setPageState('play')}
          >
            <div className="flex-1 min-w-0 px-3">
              <p className="text-white text-[0.65rem] font-thin truncate">
                {currentItem?.chapterLabel ?? ''}
              </p>
            </div>
            <button
              onClick={e => {
                e.stopPropagation();
                state.isPlaying ? pause() : resume();
              }}
              className="shrink-0 w-8 h-8 flex items-center justify-center text-white/70 cursor-pointer mr-1"
              aria-label={state.isPlaying ? '一時停止' : '再生'}
            >
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '18px' }}>
                {state.isPlaying ? 'pause' : 'play_arrow'}
              </span>
            </button>
          </div>
        )}
        {isFullscreen && (
          <div className="h-12 bg-black flex items-center px-4 shrink-0 border-t border-white/10">
            <button
              onClick={playPrev}
              className="shrink-0 w-10 h-10 flex items-center justify-center text-white/70 cursor-pointer"
              aria-label="前のチャプター"
            >
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '22px' }}>skip_previous</span>
            </button>
            <p className="flex-1 text-white text-[0.75rem] font-thin truncate text-center px-3">
              {currentItem?.chapterLabel ?? ''}
            </p>
            <button
              onClick={playNext}
              className="shrink-0 w-10 h-10 flex items-center justify-center text-white/70 cursor-pointer"
              aria-label="次のチャプター"
            >
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '22px' }}>skip_next</span>
            </button>
            <button
              onClick={toggleFullscreen}
              className="shrink-0 w-10 h-10 flex items-center justify-center text-white/70 cursor-pointer"
              aria-label="全画面を終了"
            >
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '22px' }}>fullscreen_exit</span>
            </button>
          </div>
        )}
      </div>

      {/* Home (Browse + Search 統合) */}
      <div
        className={pageState === 'home' ? `${showPlayerAtTop ? 'pt-[296px]' : 'pt-[60px]'} pb-[68px]` : 'hidden'}
        style={landscapeSplit ? { marginLeft: '45vw' } : undefined}
      >
        <BrowseView searchOpen={searchOpen} onSearchClose={() => setSearchOpen(false)} formatFilter={formatFilter} showPlayerAtTop={showPlayerAtTop} />
      </div>

      {/* PlayView */}
      <div data-testid="play-view" className={pageState === 'play' ? 'pt-[60px] pb-[68px]' : 'hidden'}>
        <PlayView sharedPlaylist={sharedPlaylist} onGoHome={handleGoToHome} onToggleFullscreen={toggleFullscreen} />
      </div>

      {/* タブバー */}
      <nav className={`fixed bottom-[20px] left-0 right-0 z-50 h-12 bg-white flex${isFullscreen ? ' hidden' : ''}`}>
        <button
          onClick={handleGoToHome}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            pageState === 'home' ? 'text-black' : 'text-black/30'
          }`}
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>home</span>
          <span className="text-[0.5rem] font-bold uppercase tracking-widest">Home</span>
        </button>
        <button
          onClick={() => setPageState('play')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 cursor-pointer relative ${
            pageState === 'play' ? 'text-black' : 'text-black/30'
          }`}
        >
          <span className="relative inline-block">
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>queue_music</span>
            {hasQueue && (
              <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-20 h-[6px] bg-black/10 overflow-hidden">
                <span
                  className="block h-full bg-black transition-all duration-300"
                  style={{ width: `${Math.min(state.queue.length / 10, 1) * 100}%` }}
                />
              </span>
            )}
          </span>
          <span className="text-[0.5rem] font-bold uppercase tracking-widest">Playlist</span>
        </button>
      </nav>

      {/* フッター */}
      <div className={`fixed bottom-0 left-0 right-0 z-50 h-[20px] bg-black flex items-center justify-center${isFullscreen ? ' hidden' : ''}`}>
        <span className="text-white text-[0.6rem] font-thin tracking-wide">
          ▶ YouTube · Unofficial Fan Tool · hop-up-tools.pages.dev
        </span>
      </div>
    </div>
  );
}

export default function YouTubePage() {
  return (
    <ChapterPlaylistProvider>
      <ChapterPickupContent />
    </ChapterPlaylistProvider>
  );
}
