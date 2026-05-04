import React, { useState, useCallback, useEffect, useRef } from 'react';
import { getSupabase } from '../../../lib/supabase';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { VideoChapterSheet } from './VideoChapterSheet';
import { ZappingCard } from './ZappingCard';
import type { VideoRow } from './ZappingCard';
import { SearchBar } from './SearchBar';
import { FilterPanel } from './FilterPanel';
import type { FilterState } from './FilterPanel';
import { readPlayHistory, type PlayHistoryItem } from '../../videos/hooks/usePlayHistory';

const PAGE_SIZE = 24;
const MEMBERS_BY_GROUP: Record<string, string[]> = {
  'モーニング娘。': ['野中美希', '小田さくら', '牧野真莉愛', '岡村ほまれ', '山﨑愛生', '櫻井梨央', '井上春華', '弓桁朱琴'],
  'アンジュルム':   ['伊勢鈴蘭', '為永幸音', '橋迫鈴', '川名凜', '松本わかな', '平山遊季', '下井谷幸穂', '後藤花', '長野桃羽'],
  'Juice=Juice':    ['段原瑠々', '井上玲音', '工藤由愛', '松永里愛', '有澤一華', '入江里咲', '江端妃咲', '石山咲良', '遠藤彩加里', '川嶋美楓', '林仁愛'],
  'つばきファクトリー': ['谷本安美', '小野瑞歩', '小野田紗栞', '秋山眞緒', '河西結心', '福田真琳', '豫風瑠乃', '石井泉羽', '村田結生', '土居楓奏', '西村乙輝'],
  'BEYOOOOONDS':    ['西田汐里', '江口紗耶', '高瀬くるみ', '前田こころ', '岡村美波', '清野桃々姫', '平井美葉', '小林萌花', '里吉うたの'],
  'OCHA NORMA':     ['斉藤円香', '広本瑠璃', '米村姫良々', '窪田七海', '中山夏月姫', '西﨑美空', '北原もも', '筒井澪心'],
  'ロージークロニクル': ['橋田歩果', '吉田姫杷', '小野田華凜', '村越彩菜', '植村葉純', '松原ユリヤ', '島川波菜', '上村麗菜', '相馬優芽'],
};

const GROUP_NAMES = Object.keys(MEMBERS_BY_GROUP);
const ALL_SUGGESTION_CANDIDATES = [
  ...GROUP_NAMES,
  ...Object.values(MEMBERS_BY_GROUP).flat(),
];

interface Props {
  searchOpen: boolean;
  onSearchClose: () => void;
  formatFilter: 'all' | 'regular' | 'short';
  showPlayerAtTop: boolean;
}

export function BrowseView({ searchOpen, onSearchClose, formatFilter, showPlayerAtTop }: Props) {
  const { state, addItem, insertNext, removeFromQueue } = useChapterPlaylistContext();
  const hasQueue = state.queue.length > 0;

  const [sheetVideo, setSheetVideo] = useState<VideoRow | null>(null);
  const [panelTab, setPanelTab] = useState<'discover' | 'history'>('discover');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);


  // ── 検索 ──
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [filter, setFilter] = useState<FilterState>({
    group: '', member: '', type: '', channel: '', year: 0, sort: 'desc', isShort: 'all' as const,
  });
  const handleFilterChange = useCallback((next: Partial<FilterState>) => {
    setFilter(prev => ({ ...prev, ...next, sort: 'desc' }));
  }, []);

  const handleSearchChange = useCallback((val: string) => {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearchQuery(val), 400);
    if (val.trim()) {
      const lower = val.toLowerCase();
      setSuggestions(
        ALL_SUGGESTION_CANDIDATES.filter(c => c.toLowerCase().includes(lower)).slice(0, 8)
      );
    } else {
      setSuggestions([]);
    }
  }, []);

  const handleSelectSuggestion = useCallback((s: string) => {
    setSearchInput(s);
    setSearchQuery(s);
    setSuggestions([]);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
    setSuggestions([]);
    setFilter({ group: '', member: '', type: '', channel: '', year: 0, sort: 'desc', isShort: 'all' });
    onSearchClose();
  }, [onSearchClose]);

  const isSearchActive = searchQuery.trim().length > 0 ||
    filter.group || filter.member || filter.type || filter.channel || filter.year > 0;

  // 再生履歴（localStorage）
  const [playHistory, setPlayHistory] = useState<PlayHistoryItem[]>(() => readPlayHistory());
  useEffect(() => {
    const handler = () => setPlayHistory(readPlayHistory());
    window.addEventListener('play-history-updated', handler);
    return () => window.removeEventListener('play-history-updated', handler);
  }, []);

  useEffect(() => {
    document.body.style.overflow = searchOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [searchOpen]);

  // ページTOPボタン
  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const GROUP_CHANNELS = [
    'モーニング娘。', 'アンジュルム', 'Juice=Juice', 'つばきファクトリー',
    'happyに過ごそうよ', 'BEYOOOOONDS', 'ビヨーンズの伸びしろ',
    'OCHA NORMA', 'ロージークロニクル', 'ハロプロ研修生',
  ];
  const threeYearsAgo = `${new Date().getFullYear() - 3}-01-01T00:00:00Z`;

  // DISCOVER（ランダム9本、グループ公式CH除外、直近3年）
  const [pickVideos, setPickVideos] = useState<VideoRow[]>([]);
  const fetchPickVideos = useCallback(async () => {
    const supabase = getSupabase();
    const { count } = await supabase
      .from('youtube_videos')
      .select('*', { count: 'exact', head: true })
      .eq('is_active_content', true)
      .not('channel_name', 'in', `(${GROUP_CHANNELS.join(',')})`)
      .gte('published_at', threeYearsAgo);
    if (!count) return;
    const offsets = new Set<number>();
    while (offsets.size < Math.min(9, count)) {
      offsets.add(Math.floor(Math.random() * count));
    }
    const results: VideoRow[] = [];
    for (const off of offsets) {
      const { data } = await supabase
        .from('youtube_videos')
        .select('video_id,title,channel_name,published_at,thumbnail_url,video_type,group_tags,description_short')
        .eq('is_active_content', true)
        .not('channel_name', 'in', `(${GROUP_CHANNELS.join(',')})`)
        .gte('published_at', threeYearsAgo)
        .range(off, off);
      if (data?.[0]) results.push(data[0] as VideoRow);
    }
    setPickVideos(results);
  }, []);
  useEffect(() => { fetchPickVideos(); }, [fetchPickVideos]);

  // ── ブラウズ用グリッド ──
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const isFetchingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchVideos = useCallback(async (group: string, currentOffset: number, replace: boolean, sort: 'desc' | 'asc', isShort: 'all' | 'regular' | 'short') => {
    if (!replace && isFetchingRef.current) return;
    isFetchingRef.current = true;
    setLoading(true);
    try {
      const supabase = getSupabase();
      let q = supabase
        .from('youtube_videos')
        .select('video_id,title,channel_name,published_at,thumbnail_url,video_type,group_tags,description_short')
        .eq('is_active_content', true)
        .order('published_at', { ascending: sort === 'asc' })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);
      if (group) q = q.contains('group_tags', [group]);
      if (isShort === 'short') q = q.eq('is_short', true);
      if (isShort === 'regular') q = q.or('is_short.eq.false,is_short.is.null');
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
    if (isSearchActive) return;
    setVideos([]);
    setOffset(0);
    setHasMore(true);
    setFetchError(false);
    fetchVideos('', 0, true, 'desc', formatFilter);
  }, ['', fetchVideos, isSearchActive, 'desc', formatFilter]);

  // ── 検索用グリッド ──
  const [searchVideos, setSearchVideos] = useState<VideoRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(true);
  const [searchOffset, setSearchOffset] = useState(0);
  const isSearchFetchingRef = useRef(false);
  const searchSentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchSearchVideos = useCallback(async (
    f: FilterState, query: string, currentOffset: number, replace: boolean, sort: 'desc' | 'asc'
  ) => {
    if (!replace && isSearchFetchingRef.current) return;
    isSearchFetchingRef.current = true;
    setSearchLoading(true);
    try {
      const supabase = getSupabase();
      let q = supabase
        .from('youtube_videos')
        .select('video_id,title,channel_name,published_at,thumbnail_url,video_type,group_tags,description_short')
        .eq('is_active_content', true)
        .order('published_at', { ascending: sort === 'asc' })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);

      if (f.group)   q = q.contains('group_tags', [f.group]);
      if (f.type)    q = q.eq('video_type', f.type);
      if (f.channel) q = q.eq('channel_name', f.channel);
      if (formatFilter === 'short')   q = q.eq('is_short', true);
      if (formatFilter === 'regular') q = q.or('is_short.eq.false,is_short.is.null');
      if (f.year > 0) {
        q = q
          .gte('published_at', `${f.year}-01-01T00:00:00Z`)
          .lt('published_at',  `${f.year + 1}-01-01T00:00:00Z`);
      }
      if (f.member) {
        q = q.or(`title.ilike.%${f.member}%,description_short.ilike.%${f.member}%`);
      }
      if (query) {
        const tokens = query.trim().split(/\s+/).filter(Boolean);
        for (const token of tokens) {
          q = q.or(`title.ilike.%${token}%,description_short.ilike.%${token}%`);
        }
      }

      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as VideoRow[];
      setSearchVideos(prev => replace ? rows : [...prev, ...rows]);
      setSearchHasMore(rows.length === PAGE_SIZE);
      setSearchOffset(currentOffset + rows.length);
    } catch {
      setSearchError(true);
    } finally {
      isSearchFetchingRef.current = false;
      setSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSearchActive) return;
    setSearchVideos([]);
    setSearchOffset(0);
    setSearchHasMore(true);
    setSearchError(false);
    fetchSearchVideos(filter, searchQuery, 0, true, 'desc');
  }, [filter, searchQuery, isSearchActive, fetchSearchVideos, 'desc']);

  // ブラウズ無限スクロール
  useEffect(() => {
    if (isSearchActive) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !isFetchingRef.current) {
          fetchVideos('', offset, false, 'desc', formatFilter);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, offset, '', fetchVideos, isSearchActive, 'desc']);

  // 検索無限スクロール
  useEffect(() => {
    if (!isSearchActive) return;
    const el = searchSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && searchHasMore && !isSearchFetchingRef.current) {
          fetchSearchVideos(filter, searchQuery, searchOffset, false, 'desc');
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchHasMore, searchOffset, filter, searchQuery, fetchSearchVideos, isSearchActive, 'desc']);

  useEffect(() => {
    if (!searchOpen) {
      setSearchInput('');
      setSearchQuery('');
      setSuggestions([]);
      setFilter({ group: '', member: '', type: '', channel: '', year: 0, sort: 'desc', isShort: 'all' });
    }
  }, [searchOpen]);

  // RECENT長押し
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

  return (
    <div className="bg-white text-black min-h-screen">
      {/* ── 🔍オーバーレイ ── */}
      {searchOpen && (
        <div
          className="fixed left-0 right-0 z-40 bg-white overflow-y-auto"
          style={{ overscrollBehavior: 'contain', top: showPlayerAtTop ? '296px' : '60px', bottom: '68px' } as React.CSSProperties}
        >
          <div className="max-w-3xl mx-auto px-4 pt-4 pb-4">
            {/* 検索バー */}
            <div className="mb-3">
              <SearchBar
                value={searchInput}
                onChange={handleSearchChange}
                suggestions={suggestions}
                onSelectSuggestion={handleSelectSuggestion}
                onFocusChange={setSearchFocused}
              />
            </div>

            {/* フィルター */}
            <div className="mb-3">
              <FilterPanel
                state={filter}
                onChange={handleFilterChange}
                membersByGroup={MEMBERS_BY_GROUP}
              />
            </div>

            {/* DISCOVER | HISTORY */}
            {!isSearchActive && !searchFocused && (
              <div>
                <div className="flex items-center gap-1 mb-3">
                  <button
                    onClick={() => setPanelTab('discover')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] uppercase tracking-wide cursor-pointer transition-colors ${
                      panelTab === 'discover' ? 'font-bold text-black bg-black/5' : 'font-normal text-black/30'
                    }`}
                  >
                    DISCOVER
                  </button>
                  {playHistory.length > 0 && (
                    <button
                      onClick={() => setPanelTab('history')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] uppercase tracking-wide cursor-pointer transition-colors ${
                        panelTab === 'history' ? 'font-bold text-black bg-black/5' : 'font-normal text-black/30'
                      }`}
                    >
                      HISTORY
                    </button>
                  )}
                  {panelTab === 'discover' && (
                    <button
                      onClick={() => fetchPickVideos()}
                      className="ml-auto flex items-center gap-1 px-2.5 py-1 text-[0.7rem] font-bold text-black/50 bg-black/5 cursor-pointer hover:bg-black/10 transition-colors"
                    >
                      <span className="material-symbols-outlined leading-none" style={{ fontSize: '14px' }}>refresh</span>
                      SHUFFLE
                    </button>
                  )}
                </div>

                {panelTab === 'discover' && (
                  <>
                    {pickVideos.length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        {pickVideos.map(v => (
                          <VideoCard
                            key={v.video_id}
                            video={v}
                            onChapters={() => setSheetVideo(v)}
                          />
                        ))}
                      </div>
                    )}
                    {pickVideos.length === 0 && (
                      <div className="flex items-center justify-center h-24">
                        <p className="text-[0.7rem] font-thin text-black/50 uppercase tracking-widest">読み込み中...</p>
                      </div>
                    )}
                  </>
                )}

                {panelTab === 'history' && (
                  <div className="grid grid-cols-3 gap-2">
                    {playHistory.slice(0, 9).map(h => (
                      <VideoCard
                        key={`${h.videoId}-${h.startSeconds}`}
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
                        onChapters={() => handleRecentLongPress(h.videoId)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── 検索結果 ── */}
            {isSearchActive && (
          <>
            {/* フィルターサマリー */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {searchQuery && (
                <FilterChip label={`「${searchQuery}」`} onRemove={() => { setSearchInput(''); setSearchQuery(''); }} />
              )}
              {filter.group && (
                <FilterChip label={filter.group} onRemove={() => handleFilterChange({ group: '', member: '' })} />
              )}
              {filter.member && (
                <FilterChip label={filter.member} onRemove={() => handleFilterChange({ member: '' })} />
              )}
              {filter.type && (
                <FilterChip label={filter.type.toUpperCase()} onRemove={() => handleFilterChange({ type: '' })} />
              )}
              {filter.channel && (
                <FilterChip label={filter.channel} onRemove={() => handleFilterChange({ channel: '' })} />
              )}
              {filter.year > 0 && (
                <FilterChip label={String(filter.year)} onRemove={() => handleFilterChange({ year: 0 })} />
              )}
            </div>

            {searchError && (
              <div className="flex flex-col items-center justify-center h-32 gap-3">
                <p className="text-[0.7rem] font-thin text-black/50">読み込みエラー。再度お試しください。</p>
                <button
                  onClick={() => { setSearchError(false); fetchSearchVideos(filter, searchQuery, 0, true, 'desc'); }}
                  className="text-[0.8rem] font-bold uppercase cursor-pointer px-4 py-2 bg-black text-white"
                >
                  再試行
                </button>
              </div>
            )}

            {!searchError && searchVideos.length > 0 && (
              <div className="grid gap-[0.8rem]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {searchVideos.map(v => (
                  <VideoCard
                    key={v.video_id}
                    video={v}
                    onChapters={() => setSheetVideo(v)}
                  />
                ))}
              </div>
            )}

            {!searchLoading && !searchError && searchVideos.length === 0 && (
              <div className="flex items-center justify-center h-40">
                <p className="text-[0.7rem] font-thin text-black/50 uppercase tracking-widest">
                  一致する動画がありません
                </p>
              </div>
            )}

            {searchLoading && (
              <div className="flex items-center justify-center h-16">
                <p className="text-[0.7rem] font-thin text-black/50 uppercase tracking-widest">読み込み中...</p>
              </div>
            )}

            <div ref={searchSentinelRef} className="h-1" />
          </>
        )}
          </div>
        </div>
      )}

      <main className="max-w-3xl mx-auto px-4 pt-4">
        {/* ── メインコンテンツ: 動画グリッド ── */}
        {!isSearchActive && (
          <>
            {fetchError && (
              <div className="flex flex-col items-center justify-center h-32 gap-3">
                <p className="text-[0.7rem] font-thin text-black/50">読み込みエラー。再度お試しください。</p>
                <button
                  onClick={() => { setFetchError(false); fetchVideos('', 0, true, 'desc', formatFilter); }}
                  className="text-[0.8rem] font-bold uppercase cursor-pointer px-4 py-2 bg-black text-white"
                >
                  再試行
                </button>
              </div>
            )}

            {!fetchError && videos.length > 0 && (
              <div className="grid gap-[0.8rem]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {videos.map(v => (
                  <VideoCard
                    key={v.video_id}
                    video={v}
                    onChapters={() => setSheetVideo(v)}
                  />
                ))}
              </div>
            )}

            {!loading && !fetchError && videos.length === 0 && (
              <div className="flex items-center justify-center h-40">
                <p className="text-[0.7rem] font-thin text-black/50 uppercase tracking-widest">動画が見つかりませんでした</p>
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center h-16">
                <p className="text-[0.7rem] font-thin text-black/50 uppercase tracking-widest">読み込み中...</p>
              </div>
            )}

            <div ref={sentinelRef} className="h-1" />
          </>
        )}
      </main>

      {/* ページTOPへ戻るボタン */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed right-4 bottom-[80px] z-30 w-10 h-10 bg-white shadow-md flex items-center justify-center text-black/30 cursor-pointer"
          aria-label="ページ上部に戻る"
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>keyboard_arrow_up</span>
        </button>
      )}

      {/* チャプターシート */}
      {sheetVideo && (
        <VideoChapterSheet
          video={sheetVideo}
          onClose={() => setSheetVideo(null)}
          mode={{
            kind: 'add',
            onAdd: item => addItem(item),
            onInsertNext: item => insertNext(item),
            onRemove: id => {
              const match = state.queue.find(q => q.id.startsWith(id));
              if (match) removeFromQueue(match.id);
            },
            isInQueue: id => state.queue.some(q => q.id.startsWith(id)),
          }}
        />
      )}

    </div>
  );
}

// ─── FilterChip ──────────────────────────────────────────────────────────────

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      onClick={onRemove}
      className="flex items-center gap-1 text-[0.7rem] font-bold bg-black/5 px-2 py-1 cursor-pointer hover:bg-black/10 transition-colors"
    >
      {label}
      <span className="material-symbols-outlined leading-none" style={{ fontSize: '14px' }}>close</span>
    </button>
  );
}

// ─── VideoCard（グリッド用）──────────────────────────────────────────────────

const CHAPTER_LINE_RE = /^\d{1,2}:\d{2}/gm;

function countChapters(desc: string): number {
  if (!desc) return 0;
  const matches = desc.match(CHAPTER_LINE_RE);
  return matches ? matches.length : 0;
}

function VideoCard({ video, onChapters }: {
  video: VideoRow;
  onChapters: () => void;
}) {
  const chapterCount = countChapters(video.description_short || '');
  const displayCount = chapterCount > 0 ? chapterCount : 1;

  return (
    <div
      className="cursor-pointer"
      style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
      onClick={onChapters}
    >
      <div className="w-full overflow-hidden bg-black/5">
        <img
          src={`https://i.ytimg.com/vi/${video.video_id}/mqdefault.jpg`}
          alt={video.title}
          className="w-full object-cover"
          style={{ aspectRatio: '16/9' }}
          loading="lazy"
          decoding="async"
        />
      </div>
      <p className={`text-[0.75rem] mt-0.5 ${displayCount > 1 ? 'font-bold text-black' : 'font-normal text-black/30'}`}>
        {displayCount} {displayCount === 1 ? 'chapter' : 'chapters'}
      </p>
      <p className="text-[0.75rem] leading-snug line-clamp-2 mt-1">
        {video.title}
      </p>
      <p className="text-[0.6rem] font-thin text-black/30 truncate mt-0.5">{video.channel_name}</p>
    </div>
  );
}
