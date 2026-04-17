import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { getSupabase } from '../../../lib/supabase';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { ChapterCard } from './ChapterCard';
import { SearchBar } from './SearchBar';
import { FilterPanel } from './FilterPanel';
import { FloatingBar } from './FloatingBar';
import { VideoChapterSheet } from './VideoChapterSheet';
import { ZappingCard } from './ZappingCard';
import type { VideoRow } from './ZappingCard';
import { makeChapterId, makeVideoId, buildFullVideoQueueItem } from '../../videos/utils/playlist-utils';
import type { ChapterQueueItem } from '../../videos/types/playlist';
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

interface Chapter {
  seconds: number;
  label: string;
  timestamp: string;
}

function parseChapters(description: string): Chapter[] {
  if (!description) return [];
  const re = /^(\d{1,2}):(\d{2})(?::(\d{2}))?[～〜\s\-]+(.+)$/gm;
  const chapters: Chapter[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(description)) !== null) {
    const hasHours = m[3] !== undefined;
    const h = hasHours ? parseInt(m[1], 10) : 0;
    const min = hasHours ? parseInt(m[2], 10) : parseInt(m[1], 10);
    const sec = hasHours ? parseInt(m[3], 10) : parseInt(m[2], 10);
    chapters.push({
      seconds: h * 3600 + min * 60 + sec,
      label: m[4].trim(),
      timestamp: hasHours ? `${m[1]}:${m[2]}:${m[3]}` : `${m[1]}:${m[2]}`,
    });
  }
  return chapters;
}

interface SearchResultItem {
  id: string;
  item: ChapterQueueItem;
}

interface Props {
  onPlay: (items: ChapterQueueItem[]) => void;
  onBack: () => void;
}

export function SearchView({ onPlay, onBack }: Props) {
  const { selection, state, playChapter } = useChapterPlaylistContext();
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

  // 検索結果（クライアントサイドでチャプター展開）
  const searchResults = useMemo<SearchResultItem[]>(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return [];
    const results: SearchResultItem[] = [];
    const seenVideoIds = new Set<string>();

    for (const video of videos) {
      if (video.title.toLowerCase().includes(q) && !seenVideoIds.has(video.video_id)) {
        seenVideoIds.add(video.video_id);
        const id = makeVideoId(video.video_id);
        results.push({ id, item: buildFullVideoQueueItem(video) });
      }
      const chapters = parseChapters(video.description_short);
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        if (!ch.label.toLowerCase().includes(q)) continue;
        const endSeconds =
          i + 1 < chapters.length ? chapters[i + 1].seconds : Number.MAX_SAFE_INTEGER;
        const id = makeChapterId(video.video_id, ch.seconds);
        const item: ChapterQueueItem = {
          id,
          videoId: video.video_id,
          videoTitle: video.title,
          channelName: video.channel_name,
          thumbnailUrl: video.thumbnail_url,
          chapterLabel: ch.label,
          chapterTimestamp: ch.timestamp,
          startSeconds: ch.seconds,
          endSeconds,
          isFullVideo: false,
        };
        results.push({ id, item });
      }
    }
    return results;
  }, [searchQuery, videos]);

  const isSearchMode = searchQuery.trim().length > 0;
  const resultCount = isSearchMode ? searchResults.length : videos.length;

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
      <header className="sticky top-0 z-30 bg-surface border-b border-outline-variant/20 px-4 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center text-outline hover:text-primary transition-colors cursor-pointer"
          aria-label="ブラウズに戻る"
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: '22px' }}>arrow_back</span>
        </button>
        <h1 className="text-xl font-black tracking-tighter uppercase flex-1">SEARCH</h1>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-4">
        {/* 検索バー */}
        <div className="mb-4">
          <SearchBar
            value={searchInput}
            onChange={handleSearchChange}
            suggestions={suggestions}
            onSelectSuggestion={handleSelectSuggestion}
          />
        </div>

        {/* フィルター */}
        <div className="mb-4">
          <FilterPanel
            state={filter}
            onChange={handleFilterChange}
            membersByGroup={MEMBERS_BY_GROUP}
          />
        </div>

        {/* 選択中バナー */}
        {selection.selectionCount > 0 && (
          <div className="flex items-center gap-4 mb-3">
            <p className="text-[0.6875rem] font-bold uppercase tracking-widest">
              {selection.selectionCount}件選択中
            </p>
            <button
              onClick={selection.clearSelection}
              className="text-[0.625rem] uppercase tracking-widest text-outline hover:text-primary transition-colors cursor-pointer"
            >
              全解除
            </button>
          </div>
        )}

        {/* 結果数 */}
        {!loading && !fetchError && resultCount > 0 && (
          <p className="text-[0.6rem] text-outline uppercase tracking-widest mb-2">
            {isSearchMode ? `検索結果 ${resultCount}件` : `${resultCount}件`}
          </p>
        )}

        {/* エラー */}
        {fetchError && (
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <p className="text-xs text-outline">読み込みエラー。再度お試しください。</p>
            <button
              onClick={() => { setFetchError(false); fetchVideos(filter, searchQuery, 0, true); }}
              className="text-[0.6875rem] font-bold uppercase tracking-widest text-primary hover:opacity-70 transition-opacity cursor-pointer border border-primary px-3 py-1.5"
            >
              再試行
            </button>
          </div>
        )}

        {/* 検索モード: ChapterCardリスト */}
        {!fetchError && isSearchMode && (
          <div className="divide-y divide-outline-variant/10 border-t border-outline-variant/10">
            {searchResults.map(({ id, item }) => {
              const parentVideo = videos.find(v => v.video_id === item.videoId) ?? null;
              return (
                <ChapterCard
                  key={id}
                  item={item}
                  selectionNumber={selection.getSelectionNumber(id)}
                  onToggle={() => selection.toggleSelection(id, item)}
                  onPlay={() => handleShortTap([item])}
                  onCardClick={parentVideo ? () => setSheetVideo(parentVideo) : undefined}
                />
              );
            })}
          </div>
        )}

        {/* フィルターのみモード: ZappingCardグリッド */}
        {!fetchError && !isSearchMode && videos.length > 0 && (
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
        {!loading && !fetchError && resultCount === 0 && !isSearchMode && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-outline">
            <p className="text-xs uppercase tracking-widest">動画が見つかりませんでした</p>
          </div>
        )}
        {!loading && !fetchError && resultCount === 0 && isSearchMode && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-outline">
            <p className="text-xs uppercase tracking-widest">
              「{searchQuery}」に一致する動画・チャプターがありません
            </p>
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

      {/* フローティングバー */}
      <FloatingBar
        count={selection.selectionCount}
        onPlay={handlePlay}
        onClear={selection.clearSelection}
        bottomClass="bottom-12"
      />

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
