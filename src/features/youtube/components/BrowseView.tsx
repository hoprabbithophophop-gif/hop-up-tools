import React, { useState, useCallback, useEffect, useRef } from 'react';
import { getSupabase } from '../../../lib/supabase';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { VideoChapterSheet } from './VideoChapterSheet';
import { ZappingCard } from './ZappingCard';
import type { VideoRow } from './ZappingCard';
import { SearchBar } from './SearchBar';
import { FilterPanel } from './FilterPanel';
import type { FilterState } from './FilterPanel';
import { buildFullVideoQueueItem } from '../../videos/utils/playlist-utils';
import { readPlayHistory, historyItemToQueueItem, type PlayHistoryItem } from '../../videos/hooks/usePlayHistory';
import type { ChapterQueueItem } from '../../videos/types/playlist';

const PAGE_SIZE = 24;
const LONG_PRESS_DELAY = 400;

const CARD_ANIMATION_CSS = `
@keyframes card-bounce {
  0% { transform: scale(0.97); }
  50% { transform: scale(1.02); }
  100% { transform: scale(1); }
}
.card-bounce { animation: card-bounce 0.3s ease-out; }
.card-swell { transform: scale(1.02); transition: transform 0.3s ease-out; }
`;

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
  onPlay: (items: ChapterQueueItem[]) => void;
}

export function BrowseView({ onPlay }: Props) {
  const { state, playChapter, addItem, insertNext, removeFromQueue } = useChapterPlaylistContext();
  const hasQueue = state.queue.length > 0;

  const [browseGroup, setBrowseGroup] = useState('');
  const [sheetVideo, setSheetVideo] = useState<VideoRow | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [activePickTab, setActivePickTab] = useState<'pick' | 'recent'>('pick');
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const id = 'card-animation-styles';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = CARD_ANIMATION_CSS;
    document.head.appendChild(style);
  }, []);

  // ── 検索 ──
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const browseScrollBeforeSearch = useRef(0);

  const [filter, setFilter] = useState<FilterState>({
    group: '', member: '', type: '', channel: '', year: 0, sort: 'desc',
  });
  const handleFilterChange = useCallback((next: Partial<FilterState>) => {
    setFilter(prev => ({ ...prev, ...next }));
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
    setFilter({ group: '', member: '', type: '', channel: '', year: 0, sort: 'desc' });
    requestAnimationFrame(() => window.scrollTo(0, browseScrollBeforeSearch.current));
  }, []);

  const isSearchActive = searchQuery.trim().length > 0 ||
    filter.group || filter.member || filter.type || filter.channel || filter.year > 0;

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

  // ── ブラウズ用グリッド ──
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
    if (isSearchActive) return;
    setVideos([]);
    setOffset(0);
    setHasMore(true);
    setFetchError(false);
    fetchVideos(browseGroup, 0, true);
  }, [browseGroup, fetchVideos, isSearchActive]);

  // ── 検索用グリッド ──
  const [searchVideos, setSearchVideos] = useState<VideoRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(true);
  const [searchOffset, setSearchOffset] = useState(0);
  const isSearchFetchingRef = useRef(false);
  const searchSentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchSearchVideos = useCallback(async (
    f: FilterState, query: string, currentOffset: number, replace: boolean
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
        .order('published_at', { ascending: f.sort === 'asc' })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);

      if (f.group)   q = q.contains('group_tags', [f.group]);
      if (f.type)    q = q.eq('video_type', f.type);
      if (f.channel) q = q.eq('channel_name', f.channel);
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
    fetchSearchVideos(filter, searchQuery, 0, true);
  }, [filter, searchQuery, isSearchActive, fetchSearchVideos]);

  // ブラウズ無限スクロール
  useEffect(() => {
    if (isSearchActive) return;
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
  }, [hasMore, offset, browseGroup, fetchVideos, isSearchActive]);

  // 検索無限スクロール
  useEffect(() => {
    if (!isSearchActive) return;
    const el = searchSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && searchHasMore && !isSearchFetchingRef.current) {
          fetchSearchVideos(filter, searchQuery, searchOffset, false);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchHasMore, searchOffset, filter, searchQuery, fetchSearchVideos, isSearchActive]);

  // 検索モードに入ったらスクロール位置を保存
  useEffect(() => {
    if (isSearchActive) {
      browseScrollBeforeSearch.current = window.scrollY;
      window.scrollTo(0, 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearchActive]);

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

  const handleShortTap = useCallback((items: ChapterQueueItem[]) => {
    const first = items[0];
    if (first) playChapter(first.videoId, first.startSeconds, first.endSeconds);
    onPlay(items);
  }, [playChapter, onPlay]);

  return (
    <div className="bg-white text-black min-h-screen">
      <main className="max-w-3xl mx-auto px-4 pt-6">
        {/* 検索バー + ヘルプ */}
        <div className="flex items-start gap-2 mb-[0.8rem]">
          <div className="flex-1">
            <SearchBar
              value={searchInput}
              onChange={handleSearchChange}
              suggestions={suggestions}
              onSelectSuggestion={handleSelectSuggestion}
            />
          </div>
          <button
            onClick={() => setHelpOpen(true)}
            className="shrink-0 w-10 h-10 flex items-center justify-center text-black/30 cursor-pointer mt-0.5"
            aria-label="使い方"
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>help_outline</span>
          </button>
        </div>

        {/* フィルター */}
        <div className="mb-[2.4rem]">
          <FilterPanel
            state={filter}
            onChange={handleFilterChange}
            membersByGroup={MEMBERS_BY_GROUP}
          />
        </div>

        {/* ── 検索モード ── */}
        {isSearchActive && (
          <>
            <div className="flex items-center justify-between mb-[0.8rem]">
              <p className="text-[0.7rem] font-thin text-black/40 uppercase tracking-widest">
                {searchVideos.length} results
              </p>
              <button
                onClick={handleClearSearch}
                className="text-[0.7rem] font-bold text-black/40 cursor-pointer uppercase tracking-widest"
              >
                ✕ クリア
              </button>
            </div>

            {searchError && (
              <div className="flex flex-col items-center justify-center h-32 gap-3">
                <p className="text-[0.7rem] font-thin text-black/50">読み込みエラー。再度お試しください。</p>
                <button
                  onClick={() => { setSearchError(false); fetchSearchVideos(filter, searchQuery, 0, true); }}
                  className="text-[0.8rem] font-bold uppercase cursor-pointer px-4 py-2 bg-black text-white"
                >
                  再試行
                </button>
              </div>
            )}

            {!searchError && searchVideos.length > 0 && (
              <div className="grid grid-cols-2 gap-[0.8rem]">
                {searchVideos.map(v => (
                  <VideoCard
                    key={v.video_id}
                    video={v}
                    onShortTap={() => handleShortTap([buildFullVideoQueueItem(v)])}
                    onLongPress={() => setSheetVideo(v)}
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

        {/* ── ブラウズモード ── */}
        {!isSearchActive && (
          <>
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
          </>
        )}
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

function PickCard({ video, onShortTap, onLongPress }: { video: VideoRow; onShortTap: () => void; onLongPress: () => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const movedRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const [pressed, setPressed] = useState(false);
  const [bouncing, setBouncing] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    firedRef.current = false;
    movedRef.current = false;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    setPressed(true);
    timerRef.current = setTimeout(() => {
      if (!movedRef.current) { firedRef.current = true; setPressed(false); onLongPress(); }
    }, LONG_PRESS_DELAY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (movedRef.current) return;
    if (Math.abs(e.clientX - startXRef.current) > 8 || Math.abs(e.clientY - startYRef.current) > 8) {
      movedRef.current = true;
      setPressed(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  };
  const onPointerUp = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPressed(false);
    if (!firedRef.current && !movedRef.current) { setBouncing(true); onShortTap(); }
    firedRef.current = false;
    movedRef.current = false;
  };
  const onPointerCancel = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPressed(false);
    firedRef.current = false;
    movedRef.current = false;
  };

  return (
    <div
      className={bouncing ? 'card-bounce' : pressed ? 'card-swell' : ''}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={e => e.preventDefault()}
      onAnimationEnd={() => setBouncing(false)}
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
  const [pressed, setPressed] = useState(false);
  const [bouncing, setBouncing] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    firedRef.current = false;
    movedRef.current = false;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    setPressed(true);
    timerRef.current = setTimeout(() => {
      if (!movedRef.current) { firedRef.current = true; setPressed(false); onLongPress(); }
    }, LONG_PRESS_DELAY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (movedRef.current) return;
    if (Math.abs(e.clientX - startXRef.current) > 8 || Math.abs(e.clientY - startYRef.current) > 8) {
      movedRef.current = true;
      setPressed(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  };
  const onPointerUp = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPressed(false);
    if (!firedRef.current && !movedRef.current) { setBouncing(true); onShortTap(); }
    firedRef.current = false;
    movedRef.current = false;
  };
  const onPointerCancel = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPressed(false);
    firedRef.current = false;
    movedRef.current = false;
  };

  return (
    <div
      className={`cursor-pointer ${bouncing ? 'card-bounce' : pressed ? 'card-swell' : ''}`}
      style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={e => e.preventDefault()}
      onAnimationEnd={() => setBouncing(false)}
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
