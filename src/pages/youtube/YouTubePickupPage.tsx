import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ChapterPlaylistProvider } from '../../features/videos/context/ChapterPlaylistContext';
import { YouTubePageInner } from './YouTubePage';
import { getPlaylistShare, fromShareItem } from '../../features/videos/hooks/usePlaylistShare';
import type { ChapterQueueItem } from '../../features/videos/types/playlist';

type RestoreStatus = 'idle' | 'loading' | 'done' | 'expired';

function ExpiredScreen() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-4xl mb-4">⏰</p>
        <p className="text-sm font-bold text-on-surface mb-1">期限切れ</p>
        <p className="text-xs text-outline mb-6">
          このプレイリストは有効期限が切れました
        </p>
        <Link
          to="/youtube/pickup"
          className="inline-block px-6 py-2.5 text-xs font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:bg-secondary transition-colors"
        >
          🎵 新しいプレイリストを作る
        </Link>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <p className="text-xs text-outline uppercase tracking-widest">読み込み中...</p>
    </div>
  );
}

export default function YouTubePickupPage() {
  const [searchParams] = useSearchParams();
  const playlistId = searchParams.get('p');

  const [status, setStatus] = useState<RestoreStatus>(playlistId ? 'loading' : 'idle');
  const [restoredItems, setRestoredItems] = useState<ChapterQueueItem[]>([]);
  const [restoredTitle, setRestoredTitle] = useState('');

  useEffect(() => {
    // ?p= なしで /youtube/pickup に来たとき → 通常画面にリセット
    if (!playlistId) {
      setStatus('idle');
      setRestoredItems([]);
      setRestoredTitle('');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    getPlaylistShare(playlistId).then(share => {
      if (cancelled) return;
      if (!share) {
        setStatus('expired');
        return;
      }
      const items = share.items.map(fromShareItem);
      setRestoredItems(items);
      setRestoredTitle(share.title);
      setStatus('done');
    });

    return () => { cancelled = true; };
  }, [playlistId]);

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'expired') return <ExpiredScreen />;

  return (
    <ChapterPlaylistProvider initialQueue={status === 'done' ? restoredItems : undefined}>
      <YouTubePageInner
        pickupMode={true}
        restoredTitle={status === 'done' ? restoredTitle : undefined}
      />
    </ChapterPlaylistProvider>
  );
}
