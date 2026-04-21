import React, { useState, useCallback, useEffect, useRef } from 'react';
import { getSupabase } from '../../../lib/supabase';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { SearchBar } from './SearchBar';
import { FilterPanel } from './FilterPanel';
import { VideoChapterSheet } from './VideoChapterSheet';
import type { VideoRow } from './ZappingCard';
import type { FilterState } from './FilterPanel';

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
  onBack: () => void;
}

export function SearchView({ onBack }: Props) {
  const { state, addItem } = useChapterPlaylistContext();
  const hasQueue = state.queue.length > 0;

  const [sheetVideo, setSheetVideo] = useState<VideoRow | null>(null);

  // フィルター
  const [filter, setFilter] = useState<FilterState>({
    group: '', member: '', type: '', channel: '', year: 0, sort: 'desc',
  });
  const handleFilterChange = useCallback((next: Partial<FilterState>) => {
    setFilter(prev => ({ ...prev, ...next }));
  }, []);

  // 検索
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // 動画データ取得
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const isFetchingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchVideos = useCallback(async (
    f: FilterState, query: string, currentOffset: number, replace: boolean
  ) => {
    if (!replace && isFetchingRef.current) return;
    isFetchingRef.current = true;
    setLoading(true);
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
    fetchVideos(filter, searchQuery, 0, true);
  }, [filter, searchQuery, fetchVideos]);

  // 無限スクロール（フィルターのみモード）
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !isFetchingRef.current) {
          fetchVideos(filter, searchQuery, offset, false);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, offset, filter, searchQuery, fetchVideos]);

  const isSearchMode = searchQuery.trim().length > 0;

  return (
    <div className="bg-white text-black min-h-screen">
      <main className="max-w-3xl mx-auto px-4 pt-6">
        {/* 画面見出し */}
        <h1 className="text-[1.4rem] font-bold uppercase mb-[2.4rem]">SEARCH</h1>

        {/* 検索バー */}
        <div className="mb-[0.8rem]">
          <SearchBar
            value={searchInput}
            onChange={handleSearchChange}
            suggestions={suggestions}
            onSelectSuggestion={handleSelectSuggestion}
          />
        </div>

        {/* フィルター */}
        <div className="mb-[2.4rem]">
          <FilterPanel
            state={filter}
            onChange={handleFilterChange}
            membersByGroup={MEMBERS_BY_GROUP}
          />
        </div>

        {/* 結果数 */}
        {!loading && !fetchError && videos.length > 0 && (
          <p className="text-[0.7rem] font-thin text-black/40 uppercase tracking-widest mb-[0.8rem]">
            {isSearchMode ? `${videos.length} results` : `${videos.length} videos`}
          </p>
        )}

        {/* エラー */}
        {fetchError && (
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <p className="text-[0.7rem] font-thin text-black/50">読み込みエラー。再度お試しください。</p>
            <button
              onClick={() => { setFetchError(false); fetchVideos(filter, searchQuery, 0, true); }}
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
              <SearchResultCard
                key={v.video_id}
                video={v}
                onTap={() => setSheetVideo(v)}
              />
            ))}
          </div>
        )}

        {/* 空状態 */}
        {!loading && !fetchError && videos.length === 0 && (
          <div className="flex items-center justify-center h-40">
            <p className="text-[0.7rem] font-thin text-black/50 uppercase tracking-widest">
              {isSearchMode ? `「${searchQuery}」に一致する動画がありません` : '動画が見つかりませんでした'}
            </p>
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

// ─── SearchResultGrid ────────────────────────────────────────────────────────

const LONG_PRESS_MS = 400;

function SearchResultCard({ video, onTap }: { video: VideoRow; onTap: () => void }) {
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = React.useRef(false);
  const movedRef = React.useRef(false);
  const startXRef = React.useRef(0);
  const startYRef = React.useRef(0);

  const onPointerDown = (e: React.PointerEvent) => {
    firedRef.current = false;
    movedRef.current = false;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    timerRef.current = setTimeout(() => {
      if (!movedRef.current) { firedRef.current = true; onTap(); }
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
    if (!firedRef.current && !movedRef.current) onTap();
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

