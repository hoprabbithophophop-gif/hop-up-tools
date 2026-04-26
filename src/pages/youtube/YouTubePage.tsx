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

  const { state, startPlaylist, pause, resume } = useChapterPlaylistContext();
  const hasQueue = state.queue.length > 0;
  const currentItem = state.currentIndex !== null ? state.queue[state.currentIndex] ?? null : null;

  const homeScrollRef = useRef(0);

  const miniBottom = 'bottom-[68px]';

  useEffect(() => {
    document.title = 'HELLO! VIDEO | hop-up-tools';
  }, []);

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

  const handlePlay = useCallback((items: ChapterQueueItem[]) => {
    if (pageState === 'home') homeScrollRef.current = window.scrollY;
    startPlaylist(items);
    setPageState('play');
  }, [pageState, startPlaylist]);

  const handleGoToHome = useCallback(() => {
    setPageState('home');
  }, []);

  if (restoreStatus === 'loading') return <LoadingScreen />;
  if (restoreStatus === 'expired') return <ExpiredView />;

  const isNotPlay = pageState !== 'play';

  const playerWrapClass =
    pageState === 'play'
      ? 'fixed top-[60px] left-0 right-0 z-20'
      : hasQueue
      ? 'fixed -left-[250px] top-0 w-[200px] h-[200px]'
      : 'hidden';

  const playerStyle = pageState === 'play' ? { height: '28vh', minHeight: '200px' } : undefined;

  return (
    <div className="yt-page bg-white text-black" style={{ fontFamily: "'Inter', 'Noto Sans JP', sans-serif" }}>
      {/* 固定ヘッダー */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center gap-4 px-6 py-4 bg-white border-b border-outline-variant/20">
        <a href="/" className="material-symbols-outlined text-black leading-none" style={{ fontSize: '20px' }}>arrow_back</a>
        <h1 className="text-xl font-black tracking-tighter uppercase">HELLO! VIDEO</h1>
      </header>

      {/* YouTube Player */}
      <div className={playerWrapClass} style={playerStyle}>
        <Player />
      </div>

      {/* NOW PLAYING ミニバー */}
      {isNotPlay && hasQueue && (
        <div
          data-testid="mini-player"
          className={`fixed ${miniBottom} left-0 right-0 h-[72px] z-40 bg-black flex items-center cursor-pointer`}
          onClick={() => setPageState('play')}
        >
          {currentItem && (
            <img
              src={`https://i.ytimg.com/vi/${currentItem.videoId}/mqdefault.jpg`}
              alt=""
              className="h-full w-auto shrink-0 object-cover"
            />
          )}
          <div className="flex-1 min-w-0 px-3">
            <p className="text-[0.7rem] font-thin uppercase tracking-widest text-white/50 leading-none mb-1">
              NOW PLAYING
            </p>
            <p className="text-white text-[0.7rem] font-thin truncate leading-tight">
              {currentItem?.chapterLabel ?? ''}
            </p>
          </div>
          <button
            onClick={e => {
              e.stopPropagation();
              state.isPlaying ? pause() : resume();
            }}
            className="shrink-0 w-9 h-9 flex items-center justify-center text-white cursor-pointer mr-2"
            aria-label={state.isPlaying ? '一時停止' : '再生'}
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '24px' }}>
              {state.isPlaying ? 'pause' : 'play_arrow'}
            </span>
          </button>
        </div>
      )}

      {/* Home (Browse + Search 統合) */}
      <div className={pageState === 'home' ? 'pt-[60px] pb-[68px]' : 'hidden'}>
        <BrowseView onPlay={handlePlay} />
      </div>

      {/* PlayView */}
      <div data-testid="play-view" className={pageState === 'play' ? 'pt-[60px] pb-[68px]' : 'hidden'}>
        <PlayView sharedPlaylist={sharedPlaylist} onGoHome={handleGoToHome} />
      </div>

      {/* タブバー: Home / Playlist */}
      <nav className="fixed bottom-[20px] left-0 right-0 z-50 h-12 bg-white flex">
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
              <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-5 h-[3px] bg-black/10 overflow-hidden">
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
      <div className="fixed bottom-0 left-0 right-0 z-50 h-[20px] bg-black flex items-center justify-center">
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
