import React, { useState, useCallback, useEffect, useRef } from 'react';
import { getSupabase } from '../../../lib/supabase';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { VideoChapterSheet } from './VideoChapterSheet';
import { ZappingCard } from './ZappingCard';
import type { VideoRow } from './ZappingCard';
import { buildFullVideoQueueItem } from '../../videos/utils/playlist-utils';
import { readPlayHistory, historyItemToQueueItem, type PlayHistoryItem } from '../../videos/hooks/usePlayHistory';
import type { ChapterQueueItem } from '../../videos/types/playlist';

const PAGE_SIZE = 24;
const LONG_PRESS_DELAY = 400;

const GROUP_CHIPS = [
  'モーニング娘。',
  'アンジュルム',
  'Juice=Juice',
  'つばきファクトリー',
  'BEYOOOOONDS',
  'OCHA NORMA',
  'ロージークロニクル',
  'ハロプロ研修生',
];

interface Props {
  onPlay: (items: ChapterQueueItem[]) => void;
}

export function BrowseView({ onPlay }: Props) {
  const { state, playChapter, addItem } = useChapterPlaylistContext();
  const hasQueue = state.queue.length > 0;

  const [browseGroup, setBrowseGroup] = useState('');
  const [sheetVideo, setSheetVideo] = useState<VideoRow | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [activePickTab, setActivePickTab] = useState<'pick' | 'recent'>('pick');
  const [showScrollTop, setShowScrollTop] = useState(false);

  // 再生履歴（localStorage）
  const [playHistory, setPlayHistory] = useState<PlayHistoryItem[]>(() => readPlayHistory());
  useEffect(() => {
    const handler = () => setPlayHistory(readPlayHistory());
    window.addEventListener('play-history-updated', handler);
    return () => window.removeEventListener('play-history-updated', handler);
  }, []);

  // ページTOPボタン
  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // PICK（ランダム3本）
  const [pickVideos, setPickVideos] = useState<VideoRow[]>([]);
  const fetchPickVideos = useCallback(async (group: string) => {
    const supabase = getSupabase();
    let countQ = supabase
      .from('youtube_videos')
      .select('*', { count: 'exact', head: true })
      .eq('is_active_content', true);
    if (group) countQ = countQ.contains('group_tags', [group]);
    const { count } = await countQ;
    if (!count) return;
    const offsets = new Set<number>();
    while (offsets.size < Math.min(3, count)) {
      offsets.add(Math.floor(Math.random() * count));
    }
    const results: VideoRow[] = [];
    for (const offset of offsets) {
      let q = supabase
        .from('youtube_videos')
        .select('video_id,title,channel_name,published_at,thumbnail_url,video_type,group_tags,description_short')
        .eq('is_active_content', true)
        .range(offset, offset);
      if (group) q = q.contains('group_tags', [group]);
      const { data } = await q;
      if (data?.[0]) results.push(data[0] as VideoRow);
    }
    setPickVideos(results);
  }, []);
  useEffect(() => { fetchPickVideos(browseGroup); }, [fetchPickVideos, browseGroup]);

  // ザッピンググリッド
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const isFetchingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchVideos = useCallback(async (group: string, currentOffset: number, replace: boolean) => {
    if (!replace && isFetchingRef.current) return;
    isFetchingRef.current = true;
    setLoading(true);
    try {
      const supabase = getSupabase();
      let q = supabase
        .from('youtube_videos')
        .select('video_id,title,channel_name,published_at,thumbnail_url,video_type,group_tags,description_short')
        .eq('is_active_content', true)
        .order('published_at', { ascending: false })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);
      if (group) q = q.contains('group_tags', [group]);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as VideoRow[];
      setVideos(prev => replace ? rows : [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
      setOffset(currentOffset + rows.length);
    } catch {
      setFetchError(true);
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setVideos([]);
    setOffset(0);
    setHasMore(true);
    setFetchError(false);
    fetchVideos(browseGroup, 0, true);
  }, [browseGroup, fetchVideos]);

  // 無限スクロール
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !isFetchingRef.current) {
          fetchVideos(browseGroup, offset, false);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, offset, browseGroup, fetchVideos]);

  // RECENT長押し: キャッシュ優先、なければSupabase取得
  const handleRecentLongPress = useCallback(async (videoId: string) => {
    const cached = videos.find(v => v.video_id === videoId);
    if (cached) { setSheetVideo(cached); return; }
    const supabase = getSupabase();
    const { data } = await supabase
      .from('youtube_videos')
      .select('video_id,title,channel_name,published_at,thumbnail_url,video_type,group_tags,description_short')
      .eq('video_id', videoId)
      .single();
    if (data) setSheetVideo(data as VideoRow);
  }, [videos]);

  // 短タップ: ユーザージェスチャー内で即再生 + PlayView遷移
  const handleShortTap = useCallback((items: ChapterQueueItem[]) => {
    const first = items[0];
    if (first) playChapter(first.videoId, first.startSeconds, first.endSeconds);
    onPlay(items);
  }, [playChapter, onPlay]);

  return (
    <div className="bg-white text-black min-h-screen">
      <main className="max-w-3xl mx-auto px-4 pt-6">
        {/* 画面見出し */}
        <div className="flex items-center justify-between mb-[2.4rem]">
          <h1 className="text-[1.4rem] font-bold uppercase">BROWSE</h1>
          <button
            onClick={() => setHelpOpen(true)}
            className="w-8 h-8 flex items-center justify-center text-black/30 cursor-pointer"
            aria-label="使い方"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>help_outline</span>
          </button>
        </div>

        {/* PICK / RECENT タブ */}
        {(pickVideos.length > 0 || playHistory.length > 0) && (
          <section className="mb-[2.4rem]">
            <div className="flex items-center gap-4 mb-[0.8rem]">
              {pickVideos.length > 0 && (
                <button
                  onClick={() => setActivePickTab('pick')}
                  className={`text-[1rem] uppercase cursor-pointer ${
                    activePickTab === 'pick' ? 'font-bold text-black' : 'font-normal text-black/30'
                  }`}
                >
                  PICK
                </button>
              )}
              {playHistory.length > 0 && (
                <button
                  onClick={() => setActivePickTab('recent')}
                  className={`text-[1rem] uppercase cursor-pointer ${
                    activePickTab === 'recent' ? 'font-bold text-black' : 'font-normal text-black/30'
                  }`}
                >
                  RECENT
                </button>
              )}
              {activePickTab === 'pick' && (
                <button
                  onClick={() => fetchPickVideos(browseGroup)}
                  className="text-[0.7rem] font-thin text-black/40 cursor-pointer"
                >
                  shuffle
                </button>
              )}
            </div>
            <div className="flex gap-[0.8rem] overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {activePickTab === 'pick' && pickVideos.map(v => (
                <div
                  key={v.video_id}
                  className="shrink-0 w-[80vw] max-w-[400px] cursor-pointer"
                  style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
                >
                  <PickCard
                    video={v}
                    onShortTap={() => handleShortTap([buildFullVideoQueueItem(v)])}
                    onLongPress={() => setSheetVideo(v)}
                  />
                </div>
              ))}
              {activePickTab === 'recent' && playHistory.slice(0, 6).map(h => (
                <div
                  key={`${h.videoId}-${h.startSeconds}`}
                  className="shrink-0 w-[80vw] max-w-[400px] cursor-pointer"
                  style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
                >
                  <PickCard
                    video={{
                      video_id: h.videoId,
                      title: h.chapterLabel,
                      channel_name: h.channelName || '',
                      published_at: '',
                      thumbnail_url: h.thumbnailUrl,
                      video_type: '',
                      group_tags: [],
                      description_short: '',
                    }}
                    onShortTap={() => handleShortTap([historyItemToQueueItem(h)])}
                    onLongPress={() => handleRecentLongPress(h.videoId)}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Group Filter */}
        <section className="mb-[2.4rem]">
          <div className="flex gap-4 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            <GroupChip label="ALL" active={!browseGroup} onClick={() => setBrowseGroup('')} />
            {GROUP_CHIPS.map(g => (
              <GroupChip
                key={g}
                label={g}
                active={browseGroup === g}
                onClick={() => setBrowseGroup(prev => prev === g ? '' : g)}
              />
            ))}
          </div>
        </section>

        {/* エラー */}
        {fetchError && (
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <p className="text-[0.7rem] font-thin text-black/50">読み込みエラー。再度お試しください。</p>
            <button
              onClick={() => { setFetchError(false); fetchVideos(browseGroup, 0, true); }}
              className="text-[0.8rem] font-bold uppercase cursor-pointer px-4 py-2 bg-black text-white"
            >
              再試行
            </button>
          </div>
        )}

        {/* 2カラム均一グリッド */}
        {!fetchError && videos.length > 0 && (
          <div className="grid grid-cols-2 gap-[0.8rem]">
            {videos.map(v => (
              <VideoCard
                key={v.video_id}
                video={v}
                onShortTap={() => handleShortTap([buildFullVideoQueueItem(v)])}
                onLongPress={() => setSheetVideo(v)}
              />
            ))}
          </div>
        )}

        {/* 空状態 */}
        {!loading && !fetchError && videos.length === 0 && (
          <div className="flex items-center justify-center h-40">
            <p className="text-[0.7rem] font-thin text-black/50 uppercase tracking-widest">動画が見つかりませんでした</p>
          </div>
        )}

        {/* ローディング */}
        {loading && (
          <div className="flex items-center justify-center h-16">
            <p className="text-[0.7rem] font-thin text-black/50 uppercase tracking-widest">読み込み中...</p>
          </div>
        )}

        <div ref={sentinelRef} className="h-1" />
      </main>

      {/* ページTOPへ戻るボタン */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed right-4 bottom-[80px] z-30 w-10 h-10 bg-white flex items-center justify-center text-black/30 cursor-pointer"
          aria-label="ページ上部に戻る"
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>keyboard_arrow_up</span>
        </button>
      )}

      {/* ヘルプモーダル */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4">
              <h2 className="text-[1rem] font-bold uppercase">使い方</h2>
              <button onClick={() => setHelpOpen(false)} className="text-black/30 cursor-pointer" aria-label="閉じる">
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>
            <div className="px-6 py-6 flex flex-col gap-6 text-[0.8rem]">
              <section>
                <p className="text-[0.7rem] font-bold uppercase tracking-widest text-black/40 mb-3">動画一覧（グリッド）</p>
                <ul className="flex flex-col gap-2">
                  <li className="flex items-start gap-3">
                    <span className="shrink-0 text-[0.7rem] font-bold uppercase bg-black text-white px-1.5 py-0.5 mt-0.5 leading-snug">短タップ</span>
                    <span>全編再生をすぐスタート</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="shrink-0 text-[0.7rem] font-bold uppercase bg-black/10 text-black/60 px-1.5 py-0.5 mt-0.5 leading-snug">長押し</span>
                    <span>チャプター一覧を開く。選んだチャプターはそのままキューに追加される</span>
                  </li>
                </ul>
              </section>
              <section>
                <p className="text-[0.7rem] font-bold uppercase tracking-widest text-black/40 mb-3">チャプタータイトルをタップ</p>
                <ul className="flex flex-col gap-2">
                  <li className="flex items-start gap-3">
                    <span className="shrink-0 text-[0.7rem] font-bold uppercase bg-black text-white px-1.5 py-0.5 mt-0.5 leading-snug">タイトル</span>
                    <span>ミニプレーヤーでシーンをプレビュー再生</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="shrink-0 text-[0.7rem] font-bold uppercase bg-black/10 text-black/60 px-1.5 py-0.5 mt-0.5 leading-snug">それ以外</span>
                    <span>キューに追加。PLAYLISTタブで確認・再生</span>
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* チャプターシート（addモード: 選択即キュー追加） */}
      {sheetVideo && (
        <VideoChapterSheet
          video={sheetVideo}
          onClose={() => setSheetVideo(null)}
          mode={{
            kind: 'add',
            onAdd: item => addItem(item),
            isInQueue: id => state.queue.some(q => q.id === id),
          }}
        />
      )}
    </div>
  );
}

// ─── GroupChip ────────────────────────────────────────────────────────────────

function GroupChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 text-[0.7rem] whitespace-nowrap cursor-pointer px-2 py-1 ${
        active ? 'bg-black text-white font-bold' : 'text-black/40 font-normal'
      }`}
    >
      {label}
    </button>
  );
}

// ─── PickCard（大カード、PICKセクション用）───────────────────────────────────

const LONG_PRESS_MS = 400;

function PickCard({ video, onShortTap, onLongPress }: { video: VideoRow; onShortTap: () => void; onLongPress: () => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const movedRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  const onPointerDown = (e: React.PointerEvent) => {
    firedRef.current = false;
    movedRef.current = false;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    timerRef.current = setTimeout(() => {
      if (!movedRef.current) { firedRef.current = true; onLongPress(); }
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (movedRef.current) return;
    if (Math.abs(e.clientX - startXRef.current) > 8 || Math.abs(e.clientY - startYRef.current) > 8) {
      movedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  };
  const onPointerUp = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!firedRef.current && !movedRef.current) onShortTap();
    firedRef.current = false;
    movedRef.current = false;
  };
  const onPointerCancel = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    firedRef.current = false;
    movedRef.current = false;
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="relative w-full overflow-hidden bg-black/5">
        <img
          src={`https://i.ytimg.com/vi/${video.video_id}/mqdefault.jpg`}
          alt={video.title}
          className="w-full object-cover"
          style={{ aspectRatio: '16/9' }}
          loading="lazy"
          draggable={false}
        />
        <span className="absolute top-0 left-0 text-[0.6rem] font-bold uppercase text-white bg-black px-1.5 py-0.5 leading-tight">
          {video.video_type?.toUpperCase() || 'VIDEO'}
        </span>
      </div>
      <div className="mt-[0.2rem]">
        <p className="text-[0.8rem] font-bold leading-snug line-clamp-2">{video.title}</p>
        <p className="text-[0.7rem] font-thin text-black/40 mt-[0.2rem]">{video.channel_name}</p>
      </div>
    </div>
  );
}

// ─── VideoCard（グリッド用）──────────────────────────────────────────────────

function VideoCard({ video, onShortTap, onLongPress }: {
  video: VideoRow;
  onShortTap: () => void;
  onLongPress: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const movedRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  const onPointerDown = (e: React.PointerEvent) => {
    firedRef.current = false;
    movedRef.current = false;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    timerRef.current = setTimeout(() => {
      if (!movedRef.current) { firedRef.current = true; onLongPress(); }
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (movedRef.current) return;
    if (Math.abs(e.clientX - startXRef.current) > 8 || Math.abs(e.clientY - startYRef.current) > 8) {
      movedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  };
  const onPointerUp = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!firedRef.current && !movedRef.current) onShortTap();
    firedRef.current = false;
    movedRef.current = false;
  };
  const onPointerCancel = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    firedRef.current = false;
    movedRef.current = false;
  };

  return (
    <div
      className="cursor-pointer"
      style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="relative w-full overflow-hidden bg-black/5">
        <img
          src={`https://i.ytimg.com/vi/${video.video_id}/mqdefault.jpg`}
          alt={video.title}
          className="w-full object-cover"
          style={{ aspectRatio: '16/9' }}
          loading="lazy"
          decoding="async"
        />
        <span className="absolute top-0 left-0 text-[0.6rem] font-bold uppercase text-white bg-black px-1.5 py-0.5 leading-tight">
          {video.video_type?.toUpperCase() || 'VIDEO'}
        </span>
      </div>
      <div className="mt-[0.2rem]">
        <p className="text-[0.8rem] font-bold leading-snug line-clamp-2">
          {video.title}
        </p>
        <p className="text-[0.7rem] font-thin text-black/40 mt-[0.2rem]">{video.channel_name}</p>
      </div>
    </div>
  );
}

