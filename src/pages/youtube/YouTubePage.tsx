import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChapterPlaylistProvider } from '../../features/videos/context/ChapterPlaylistContext';
import { useChapterPlaylistContext } from '../../features/videos/context/ChapterPlaylistContext';
import { BrowseView } from '../../features/youtube/components/BrowseView';
import { SearchView } from '../../features/youtube/components/SearchView';
import { PlayView } from '../../features/youtube/components/PlayView';
import { Player } from '../../features/youtube/components/Player';
import { ExpiredView } from '../../features/youtube/components/ExpiredView';
import { getPlaylistShare, fromShareItem } from '../../features/videos/hooks/usePlaylistShare';
import type { ChapterQueueItem } from '../../features/videos/types/playlist';

type PageState = 'browse' | 'search' | 'play';
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

  const [pageState, setPageState] = useState<PageState>('browse');
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>(
    playlistId ? 'loading' : 'idle'
  );
  const [sharedPlaylist, setSharedPlaylist] = useState<SharedPlaylist | null>(null);
  // SearchViewは初回遷移時に初めてマウントする（初期ロードを避けるため）
  const [searchMounted, setSearchMounted] = useState(false);

  const { state, startPlaylist, pause, resume } = useChapterPlaylistContext();
  const hasQueue = state.queue.length > 0;
  const currentItem = state.currentIndex !== null ? state.queue[state.currentIndex] ?? null : null;

  // play遷移元の画面を記憶してonBack時に戻れるようにする
  const prevStateRef = useRef<'browse' | 'search'>('browse');
  // browse / search それぞれのスクロール位置
  const browseScrollRef = useRef(0);
  const searchScrollRef = useRef(0);

  // ボトムナビ(h-12=48px)分上にずらす（FloatingBar廃止により常時この値）
  const miniBottom = 'bottom-12';

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
      setSharedPlaylist({ title: share.title, items });
      startPlaylist(items);
      setRestoreStatus('done');
      setPageState('play');
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  // スクロール位置復元
  useEffect(() => {
    if (pageState === 'browse') {
      const y = browseScrollRef.current;
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
    } else if (pageState === 'search') {
      const y = searchScrollRef.current;
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
    }
  }, [pageState]);

  const handlePlay = useCallback((items: ChapterQueueItem[]) => {
    if (pageState === 'browse') browseScrollRef.current = window.scrollY;
    if (pageState === 'search') searchScrollRef.current = window.scrollY;
    prevStateRef.current = pageState as 'browse' | 'search';
    startPlaylist(items);
    setPageState('play');
  }, [pageState, startPlaylist]);

  const handleGoToSearch = useCallback(() => {
    browseScrollRef.current = window.scrollY;
    setSearchMounted(true);
    setPageState('search');
  }, []);

  const handleGoToBrowse = useCallback(() => {
    searchScrollRef.current = window.scrollY;
    setPageState('browse');
  }, []);

  if (restoreStatus === 'loading') return <LoadingScreen />;
  if (restoreStatus === 'expired') return <ExpiredView />;

  const isNotPlay = pageState !== 'play';

  const playerWrapClass =
    pageState === 'play'
      ? 'fixed top-12 left-0 right-0 aspect-video z-20'
      : hasQueue
      ? `fixed ${miniBottom} left-0 w-32 h-[72px] z-40`
      : 'hidden';

  return (
    <>
      {/* YouTube Player — 常時マウント、位置のみ切替 */}
      <div className={playerWrapClass}>
        <Player />
      </div>

      {/* ミニプレーヤー情報バー（browse/search + queue 時） */}
      {isNotPlay && hasQueue && (
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

      {/* BrowseView */}
      <div className={pageState === 'browse' ? '' : 'hidden'}>
        <BrowseView onPlay={handlePlay} />
      </div>

      {/* SearchView: 初回遷移後にマウント */}
      {searchMounted && (
        <div className={pageState === 'search' ? '' : 'hidden'}>
          <SearchView onBack={handleGoToBrowse} />
        </div>
      )}

      {/* PlayView: 常時 DOM 保持（IFrame維持のため） */}
      <div data-testid="play-view" className={pageState === 'play' ? '' : 'hidden'}>
        <PlayView sharedPlaylist={sharedPlaylist} />
      </div>

      {/* ボトムナビ（常時表示） */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 h-12 bg-surface border-t border-outline-variant/20 flex">
        <button
          onClick={handleGoToBrowse}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
            pageState === 'browse' ? 'text-primary' : 'text-outline hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>home</span>
          <span className="text-[0.5rem] font-bold uppercase tracking-widest">Browse</span>
        </button>
        <button
          onClick={handleGoToSearch}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
            pageState === 'search' ? 'text-primary' : 'text-outline hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>search</span>
          <span className="text-[0.5rem] font-bold uppercase tracking-widest">Search</span>
        </button>
        <button
          onClick={() => {
            prevStateRef.current = pageState !== 'play' ? pageState : prevStateRef.current;
            setPageState('play');
          }}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors relative ${
            pageState === 'play' ? 'text-primary' : 'text-outline hover:text-on-surface'
          }`}
        >
          <span className="relative inline-block">
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>queue_music</span>
            {hasQueue && pageState !== 'play' && (
              <span className="absolute -top-1 -right-2 min-w-[14px] h-[14px] bg-primary text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                {state.queue.length}
              </span>
            )}
          </span>
          <span className="text-[0.5rem] font-bold uppercase tracking-widest">Playlist</span>
        </button>
      </nav>
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
