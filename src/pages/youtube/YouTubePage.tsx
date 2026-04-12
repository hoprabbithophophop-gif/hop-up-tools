import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChapterPlaylistProvider } from '../../features/videos/context/ChapterPlaylistContext';
import { useChapterPlaylistContext } from '../../features/videos/context/ChapterPlaylistContext';
import { PickupView } from '../../features/youtube/components/PickupView';
import { PlayView } from '../../features/youtube/components/PlayView';
import { ExpiredView } from '../../features/youtube/components/ExpiredView';
import { getPlaylistShare, fromShareItem } from '../../features/videos/hooks/usePlaylistShare';
import { shuffleArray } from '../../features/videos/utils/playlist-utils';
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

  const { state, startPlaylist } = useChapterPlaylistContext();
  const hasQueue = state.queue.length > 0;

  useEffect(() => {
    document.title = 'CHAPTER PICKUP | hop-up-tools';
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
    startPlaylist(items);
    setPageState('play');
  }, [startPlaylist]);

  const handleShuffle = useCallback((items: ChapterQueueItem[]) => {
    startPlaylist(shuffleArray(items));
    setPageState('play');
  }, [startPlaylist]);

  const handleBack = useCallback(() => {
    setPageState('pickup');
  }, []);

  const handleBackToPlay = useCallback(() => {
    setPageState('play');
  }, []);

  if (restoreStatus === 'loading') return <LoadingScreen />;
  if (restoreStatus === 'expired') return <ExpiredView />;

  return (
    <>
      {/* PickupView: play state のとき CSS hidden（アンマウントしない） */}
      <div className={pageState === 'play' ? 'hidden' : ''}>
        <PickupView
          onPlay={handlePlay}
          onShuffle={handleShuffle}
          onBackToPlay={hasQueue ? handleBackToPlay : undefined}
        />
      </div>

      {/* PlayView: 常時 DOM 保持（IFrame維持のため）、pickup state のとき CSS hidden */}
      <div className={pageState === 'pickup' ? 'hidden' : ''}>
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
