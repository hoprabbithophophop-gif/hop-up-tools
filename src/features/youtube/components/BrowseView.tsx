import React, { useState, useCallback, useEffect, useRef } from 'react';
import { getSupabase } from '../../../lib/supabase';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { FloatingBar } from './FloatingBar';
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
  const { selection, state, playChapter } = useChapterPlaylistContext();
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

  const handleShortTap = useCallback((items: ChapterQueueItem[]) => {
    const first = items[0];
    if (first) playChapter(first.videoId, first.startSeconds, first.endSeconds);
    onPlay(items);
  }, [playChapter, onPlay]);

  const handlePlay = useCallback(() => {
    const items = selection.getSelectedItemsInOrder();
    if (items.length > 0) onPlay(items);
  }, [selection, onPlay]);

  return (
    <div className={`bg-surface text-on-surface min-h-screen ${hasQueue ? 'pb-[210px]' : 'pb-32'} isolate`}>
      {/* ヘッダー */}
      <header className="sticky top-0 z-30 bg-surface border-b border-outline-variant/20">
        <div className="px-4 py-3 flex items-center gap-3">
          <a href="/" className="material-symbols-outlined text-primary leading-none">arrow_back</a>
          <h1 className="text-xl font-black tracking-tighter uppercase flex-1">HELLO! VIDEO</h1>
          <button
            onClick={() => setHelpOpen(true)}
            className="w-8 h-8 flex items-center justify-center text-outline hover:text-primary transition-colors cursor-pointer"
            aria-label="使い方"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>help_outline</span>
          </button>
        </div>
        {/* GROUPチップ（横スクロール） */}
        <div className="px-4 pb-2 flex gap-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
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
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-4">
        {/* PICK / RECENT フォルダータブ */}
        {(pickVideos.length > 0 || playHistory.length > 0) && (
          <div className="mb-4">
            <div className="flex items-end">
              {pickVideos.length > 0 && (
                <button
                  onClick={() => setActivePickTab('pick')}
                  className={`px-4 h-8 text-[0.6rem] font-bold uppercase tracking-widest border border-b-0 transition-colors cursor-pointer relative z-10 -mb-px ${
                    activePickTab === 'pick'
                      ? 'border-outline-variant/40 bg-surface-container text-on-surface'
                      : 'border-transparent text-outline hover:text-on-surface'
                  }`}
                >
                  Pick
                </button>
              )}
              {playHistory.length > 0 && (
                <button
                  onClick={() => setActivePickTab('recent')}
                  className={`px-4 h-8 text-[0.6rem] font-bold uppercase tracking-widest border border-b-0 transition-colors cursor-pointer relative z-10 -mb-px ${
                    activePickTab === 'recent'
                      ? 'border-outline-variant/40 bg-surface-container text-on-surface'
                      : 'border-transparent text-outline hover:text-on-surface'
                  }`}
                >
                  Recent
                </button>
              )}
              <div className="flex-1 border-b border-outline-variant/40" />
            </div>
            <div className="border border-outline-variant/40 bg-surface-container p-3">
              <div className="grid grid-cols-3 gap-2">
                {activePickTab === 'pick' && (
                  <>
                    {pickVideos.map(v => (
                      <PickFolderCard
                        key={v.video_id}
                        thumbnail={v.thumbnail_url}
                        label={v.title}
                        onShortTap={() => handleShortTap([buildFullVideoQueueItem(v)])}
                        onLongPress={() => setSheetVideo(v)}
                      />
                    ))}
                    {Array.from({ length: Math.max(0, 3 - pickVideos.length) }, (_, i) => (
                      <div key={i} className="aspect-video bg-surface-container-high border border-dashed border-outline-variant/20" />
                    ))}
                  </>
                )}
                {activePickTab === 'recent' && (
                  <>
                    {playHistory.slice(0, 3).map(h => (
                      <PickFolderCard
                        key={`${h.videoId}-${h.startSeconds}`}
                        thumbnail={h.thumbnailUrl}
                        label={h.chapterLabel}
                        onShortTap={() => handleShortTap([historyItemToQueueItem(h)])}
                        onLongPress={() => handleRecentLongPress(h.videoId)}
                      />
                    ))}
                    {Array.from({ length: Math.max(0, 3 - Math.min(playHistory.length, 3)) }, (_, i) => (
                      <div key={i} className="aspect-video bg-surface-container-high border border-dashed border-outline-variant/20" />
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* エラー */}
        {fetchError && (
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <p className="text-xs text-outline">読み込みエラー。再度お試しください。</p>
            <button
              onClick={() => { setFetchError(false); fetchVideos(browseGroup, 0, true); }}
              className="text-[0.6875rem] font-bold uppercase tracking-widest text-primary hover:opacity-70 transition-opacity cursor-pointer border border-primary px-3 py-1.5"
            >
              再試行
            </button>
          </div>
        )}

        {/* ザッピンググリッド */}
        {!fetchError && videos.length > 0 && (
          <div className="grid grid-cols-2 gap-px bg-outline-variant/10 border-t border-outline-variant/10">
            {videos.map(v => (
              <ZappingCard
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
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-outline">
            <p className="text-xs uppercase tracking-widest">動画が見つかりませんでした</p>
          </div>
        )}

        {/* ローディング */}
        {loading && (
          <div className="flex items-center justify-center h-16">
            <p className="text-[0.6rem] text-outline uppercase tracking-widest">読み込み中...</p>
          </div>
        )}

        <div ref={sentinelRef} className="h-1" />
      </main>

      {/* ページTOPへ戻るボタン */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className={`fixed right-4 z-30 w-10 h-10 bg-surface-container border border-outline-variant/30 flex items-center justify-center text-outline hover:text-primary shadow-md transition-colors cursor-pointer ${
            hasQueue && selection.selectionCount > 0 ? 'bottom-[200px]' : hasQueue ? 'bottom-[140px]' : 'bottom-[64px]'
          }`}
          aria-label="ページ上部に戻る"
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>keyboard_arrow_up</span>
        </button>
      )}

      {/* フローティングバー */}
      <FloatingBar
        count={selection.selectionCount}
        onPlay={handlePlay}
        onClear={selection.clearSelection}
        bottomClass="bottom-12"
      />

      {/* ヘルプモーダル */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="bg-surface-container-lowest w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-sm shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
              <h2 className="text-sm font-bold uppercase tracking-widest">使い方</h2>
              <button onClick={() => setHelpOpen(false)} className="text-outline hover:text-primary transition-colors cursor-pointer" aria-label="閉じる">
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>
            <div className="px-6 py-6 flex flex-col gap-6 text-[0.8125rem] text-on-surface-variant">
              <section>
                <p className="text-[0.6rem] font-bold uppercase tracking-widest text-outline mb-3">動画一覧（グリッド）</p>
                <ul className="flex flex-col gap-2">
                  <li className="flex items-start gap-3">
                    <span className="shrink-0 text-[0.6rem] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 mt-0.5 leading-snug">短タップ</span>
                    <span>全編再生をすぐスタート</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="shrink-0 text-[0.6rem] font-bold uppercase tracking-wider text-outline bg-surface-container px-1.5 py-0.5 mt-0.5 leading-snug">長押し</span>
                    <span>チャプター選択シートを開く</span>
                  </li>
                </ul>
              </section>
              <div className="border-t border-outline-variant/20" />
              <section>
                <p className="text-[0.6rem] font-bold uppercase tracking-widest text-outline mb-3">検索モード（右上の虫眼鏡アイコン）</p>
                <ul className="flex flex-col gap-2">
                  <li className="flex items-start gap-3">
                    <span className="shrink-0 text-[0.6rem] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 mt-0.5 leading-snug">短タップ</span>
                    <span>そのチャプターをすぐ再生</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="shrink-0 text-[0.6rem] font-bold uppercase tracking-wider text-outline bg-surface-container px-1.5 py-0.5 mt-0.5 leading-snug">長押し</span>
                    <span>親動画のチャプターシートを開く</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="shrink-0 text-[0.6rem] font-bold uppercase tracking-wider text-outline bg-surface-container px-1.5 py-0.5 mt-0.5 leading-snug">＋ ボタン</span>
                    <span>キューに追加してまとめて再生</span>
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* チャプターシート */}
      {sheetVideo && (
        <VideoChapterSheet
          video={sheetVideo}
          onClose={() => setSheetVideo(null)}
          mode={{
            kind: 'selection',
            getSelectionNumber: id => selection.getSelectionNumber(id),
            onToggle: (id, item) => selection.toggleSelection(id, item),
            onSelectAll: items => items.forEach(item => {
              if (selection.getSelectionNumber(item.id) === 0) selection.toggleSelection(item.id, item);
            }),
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
      className={`shrink-0 text-[0.6rem] font-bold pb-0.5 transition-colors cursor-pointer whitespace-nowrap ${
        active ? 'text-primary border-b-2 border-primary' : 'text-outline hover:text-on-surface'
      }`}
    >
      {label}
    </button>
  );
}

// ─── PickFolderCard ───────────────────────────────────────────────────────────

interface PickFolderCardProps {
  thumbnail: string;
  label: string;
  onShortTap: () => void;
  onLongPress?: () => void;
}

function PickFolderCard({ thumbnail, label, onShortTap, onLongPress }: PickFolderCardProps) {
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
      if (!movedRef.current) {
        firedRef.current = true;
        onLongPress?.();
      }
    }, LONG_PRESS_DELAY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (movedRef.current) return;
    const dx = Math.abs(e.clientX - startXRef.current);
    const dy = Math.abs(e.clientY - startYRef.current);
    if (dx > 8 || dy > 8) {
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
    <button
      className="flex flex-col text-left cursor-pointer group w-full"
      style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
      onPointerDown={onLongPress ? onPointerDown : undefined}
      onPointerMove={onLongPress ? onPointerMove : undefined}
      onPointerUp={onLongPress ? onPointerUp : undefined}
      onPointerCancel={onLongPress ? onPointerCancel : undefined}
      onContextMenu={e => e.preventDefault()}
      onClick={onLongPress ? undefined : onShortTap}
    >
      <div className="w-full aspect-video overflow-hidden bg-surface-container-high">
        <img
          src={thumbnail}
          alt={label}
          className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
          draggable={false}
          style={{ WebkitTouchCallout: 'none' } as React.CSSProperties}
        />
      </div>
      <p className="text-[0.55rem] leading-tight truncate mt-0.5 w-full text-on-surface/80">{label}</p>
    </button>
  );
}
