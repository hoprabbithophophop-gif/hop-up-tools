import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { getSupabase } from '../../../lib/supabase';
import { useChapterPlaylistContext } from '../../videos/context/ChapterPlaylistContext';
import { ChapterCard } from './ChapterCard';
import { SearchBar } from './SearchBar';
import { FilterPanel } from './FilterPanel';
import { FloatingBar } from './FloatingBar';
import { VideoChapterSheet } from './VideoChapterSheet';
import { makeChapterId, makeVideoId, buildFullVideoQueueItem } from '../../videos/utils/playlist-utils';
import { readPlayHistory, historyItemToQueueItem, type PlayHistoryItem } from '../../videos/hooks/usePlayHistory';
import type { ChapterQueueItem } from '../../videos/types/playlist';
import type { FilterState } from './FilterPanel';

interface VideoRow {
  video_id: string;
  title: string;
  channel_name: string;
  published_at: string;
  thumbnail_url: string;
  video_type: string;
  group_tags: string[];
  description_short: string;
}

interface Chapter {
  seconds: number;
  label: string;
  timestamp: string;
}

interface SearchResultItem {
  id: string;
  item: ChapterQueueItem;
}

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

const TYPE_COLOR: Record<string, string> = {
  mv:      'text-[#E5457D]',
  live:    'text-blue-500',
  variety: 'text-amber-500',
  other:   'text-outline',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
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

const LONG_PRESS_DELAY = 400;

interface Props {
  onPlay: (items: ChapterQueueItem[]) => void;
}

export function PickupView({ onPlay }: Props) {
  const { selection, state, playChapter } = useChapterPlaylistContext();
  const hasQueue = state.queue.length > 0;

  // ザッピング: クリックした動画のシートを管理
  const [sheetVideo, setSheetVideo] = useState<VideoRow | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // --- 再生履歴（localStorage） ---
  const [playHistory, setPlayHistory] = useState<PlayHistoryItem[]>(() => readPlayHistory());

  useEffect(() => {
    const handler = () => setPlayHistory(readPlayHistory());
    window.addEventListener('play-history-updated', handler);
    return () => window.removeEventListener('play-history-updated', handler);
  }, []);

  // --- PICK（ランダム動画 3本） ---
  const [pickVideos, setPickVideos] = useState<VideoRow[]>([]);

  const fetchPickVideos = useCallback(async () => {
    const supabase = getSupabase();
    const { count } = await supabase
      .from('youtube_videos')
      .select('*', { count: 'exact', head: true })
      .eq('is_active_content', true);
    if (!count) return;
    // 重複しない3つのランダムオフセットを生成
    const offsets = new Set<number>();
    while (offsets.size < Math.min(3, count)) {
      offsets.add(Math.floor(Math.random() * count));
    }
    const results: VideoRow[] = [];
    for (const offset of offsets) {
      const { data } = await supabase
        .from('youtube_videos')
        .select('video_id,title,channel_name,published_at,thumbnail_url,video_type,group_tags,description_short')
        .eq('is_active_content', true)
        .range(offset, offset);
      if (data?.[0]) results.push(data[0] as VideoRow);
    }
    setPickVideos(results);
  }, []);

  useEffect(() => { fetchPickVideos(); }, [fetchPickVideos]);

  // --- フィルター状態 ---
  const [filter, setFilter] = useState<FilterState>({
    group: '',
    member: '',
    type: '',
    channel: '',
    year: 0,
    sort: 'desc',
  });
  const handleFilterChange = useCallback((next: Partial<FilterState>) => {
    setFilter(prev => ({ ...prev, ...next }));
  }, []);

  // --- 検索状態 ---
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

  // --- 動画データ取得 ---
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
        .order('published_at', { ascending: f.sort === 'asc' })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);

      if (f.group)   q = q.contains('group_tags', [f.group]);
      if (f.type)    q = q.eq('video_type', f.type);
      if (f.channel) q = q.eq('channel_name', f.channel);
      if (!f.channel && !f.group) q = q.filter('group_tags', 'neq', '{}');
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

  // フィルター/クエリ変更で再取得
  useEffect(() => {
    setVideos([]);
    setOffset(0);
    setHasMore(true);
    setFetchError(false);
    fetchVideos(filter, searchQuery, 0, true);
  }, [filter, searchQuery, fetchVideos]);

  // 無限スクロール
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

  // --- 検索結果（クライアントサイドでチャプター展開） ---
  const searchResults = useMemo<SearchResultItem[]>(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return [];

    const results: SearchResultItem[] = [];
    const seenVideoIds = new Set<string>();

    for (const video of videos) {
      // VIDEO カード: タイトルマッチ
      if (video.title.toLowerCase().includes(q) && !seenVideoIds.has(video.video_id)) {
        seenVideoIds.add(video.video_id);
        const id = makeVideoId(video.video_id);
        results.push({ id, item: buildFullVideoQueueItem(video) });
      }

      // CHAPTER カード: チャプターラベルマッチ
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

  const handlePlay = useCallback(() => {
    const items = selection.getSelectedItemsInOrder();
    if (items.length === 0) return;
    onPlay(items);
  }, [selection, onPlay]);

  // 短タップ再生: ユーザージェスチャーの中で playChapter を直接呼ぶことで
  // モバイルの autoplay ポリシー（初回再生ブロック）を回避する
  const handleShortTap = useCallback((items: ChapterQueueItem[]) => {
    const first = items[0];
    if (first) {
      playChapter(first.videoId, first.startSeconds, first.endSeconds);
    }
    onPlay(items);
  }, [playChapter, onPlay]);

  // isolate: スクロール時の表示崩れ対策として追加。実機では再現しないことが判明したが、
  // stacking context を明示する保険として残置（副作用なし）。
  return (
    <div className={`bg-surface text-on-surface min-h-screen ${hasQueue ? 'pb-[144px]' : 'pb-20'} isolate`}>
      {/* ヘッダー */}
      <header className="sticky top-0 z-30 bg-surface border-b border-outline-variant/20 px-4 py-3 flex items-center gap-3">
        <a href="/" className="material-symbols-outlined text-primary">arrow_back</a>
        <h1 className="text-xl font-black tracking-tighter uppercase flex-1">
          HELLO! VIDEO
        </h1>
        <button
          onClick={() => setHelpOpen(true)}
          className="w-8 h-8 flex items-center justify-center text-outline hover:text-primary transition-colors cursor-pointer"
          aria-label="使い方"
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: '20px' }}>help_outline</span>
        </button>
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

        {/* PICK（ランダム3枚・検索中は非表示） */}
        {pickVideos.length > 0 && !isSearchMode && (
          <div className="flex items-start gap-2 mb-4">
            <span className="shrink-0 text-[0.6875rem] font-bold uppercase tracking-widest text-outline mt-1">Pick</span>
            <div className="grid grid-cols-3 gap-2 flex-1 min-w-0">
              {Array.from({ length: 3 }, (_, i) => {
                const v = pickVideos[i];
                return v ? (
                  <PickThumbCard
                    key={v.video_id}
                    thumbnail={v.thumbnail_url}
                    label={v.title}
                    sub={v.channel_name}
                    onShortTap={() => handleShortTap([buildFullVideoQueueItem(v)])}
                    onLongPress={() => setSheetVideo(v)}
                  />
                ) : (
                  <PickThumbPlaceholder key={i} />
                );
              })}
            </div>
          </div>
        )}

        {/* RECENT（履歴3枚・検索中は非表示） */}
        {playHistory.length > 0 && !isSearchMode && (
          <div className="flex items-start gap-2 mb-4">
            <span className="shrink-0 text-[0.6875rem] font-bold uppercase tracking-widest text-outline mt-1">Recent</span>
            <div className="grid grid-cols-3 gap-2 flex-1 min-w-0">
              {Array.from({ length: 3 }, (_, i) => {
                const h = playHistory[i];
                return h ? (
                  <PickThumbCard
                    key={`${h.videoId}-${h.startSeconds}`}
                    thumbnail={h.thumbnailUrl}
                    label={h.chapterLabel}
                    sub={h.channelName}
                    onShortTap={() => handleShortTap([historyItemToQueueItem(h)])}
                  />
                ) : (
                  <PickThumbPlaceholder key={i} />
                );
              })}
            </div>
          </div>
        )}

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
            {searchQuery.trim() ? `検索結果 ${resultCount}件` : `${resultCount}件`}
          </p>
        )}

        {/* エラー */}
        {fetchError && (
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <p className="text-xs text-outline">読み込みエラー。再度お試しください。</p>
            <button
              onClick={() => {
                setFetchError(false);
                fetchVideos(filter, searchQuery, 0, true);
              }}
              className="text-[0.6875rem] font-bold uppercase tracking-widest text-primary hover:opacity-70 transition-opacity cursor-pointer border border-primary px-3 py-1.5"
            >
              再試行
            </button>
          </div>
        )}

        {/* 検索モード: チャプター/動画リスト */}
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

        {/* ザッピングモード: サムネイルグリッド */}
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

        {/* 無限スクロール センチネル */}
        <div ref={sentinelRef} className="h-1" />
      </main>


      {/* フローティングバー */}
      <FloatingBar
        count={selection.selectionCount}
        onPlay={handlePlay}
        onClear={selection.clearSelection}
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
              <button
                onClick={() => setHelpOpen(false)}
                className="text-outline hover:text-primary transition-colors cursor-pointer"
                aria-label="閉じる"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <div className="px-6 py-6 flex flex-col gap-6 text-[0.8125rem] text-on-surface-variant">
              {/* ザッピンググリッド */}
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

              {/* 検索モード */}
              <section>
                <p className="text-[0.6rem] font-bold uppercase tracking-widest text-outline mb-3">検索結果（チャプター一覧）</p>
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

      {/* ザッピングシート（動画チャプター一覧） */}
      {sheetVideo && (
        <VideoChapterSheet
          video={sheetVideo}
          onClose={() => setSheetVideo(null)}
          mode={{
            kind: 'selection',
            getSelectionNumber: id => selection.getSelectionNumber(id),
            onToggle: (id, item) => selection.toggleSelection(id, item),
            onSelectAll: items => items.forEach(item => {
              if (selection.getSelectionNumber(item.id) === 0) {
                selection.toggleSelection(item.id, item);
              }
            }),
          }}
        />
      )}
    </div>
  );
}

// ─── PickThumbCard（PICK / RECENT 共通サムネカード） ─────────────────────────

interface PickThumbCardProps {
  thumbnail: string;
  label: string;
  sub: string;
  onShortTap: () => void;
  onLongPress?: () => void;
}

function PickThumbCard({ thumbnail, label, sub, onShortTap, onLongPress }: PickThumbCardProps) {
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
      className="w-full min-w-0 text-left cursor-pointer group"
      style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
      onPointerDown={onLongPress ? onPointerDown : undefined}
      onPointerMove={onLongPress ? onPointerMove : undefined}
      onPointerUp={onLongPress ? onPointerUp : undefined}
      onPointerCancel={onLongPress ? onPointerCancel : undefined}
      onContextMenu={onLongPress ? e => e.preventDefault() : undefined}
      onClick={onLongPress ? undefined : onShortTap}
    >
      <div className="aspect-video overflow-hidden mb-1 bg-surface-container">
        <img
          src={thumbnail}
          alt={label}
          className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
        />
      </div>
      <p className="text-[0.6rem] font-medium truncate leading-tight">{label}</p>
      <p className="text-[0.55rem] text-outline truncate">{sub}</p>
    </button>
  );
}

function PickThumbPlaceholder() {
  return (
    <div>
      <div className="aspect-video border border-dashed border-outline-variant/25 bg-surface-container/20" />
      <p className="text-[0.6rem] leading-tight mt-1 invisible">-</p>
      <p className="text-[0.55rem] invisible">-</p>
    </div>
  );
}

// ─── Pick カード（横並びレイアウト、短タップ=即再生 / 長押し=シート） ──────────

interface PickCardProps {
  video: VideoRow;
  onShortTap: () => void;
  onLongPress: () => void;
}

function PickCard({ video, onShortTap, onLongPress }: PickCardProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFiredRef = useRef(false);
  const movedRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    longFiredRef.current = false;
    movedRef.current = false;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    timerRef.current = setTimeout(() => {
      if (!movedRef.current) {
        longFiredRef.current = true;
        onLongPress();
      }
    }, LONG_PRESS_DELAY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (movedRef.current) return;
    const dx = Math.abs(e.clientX - startXRef.current);
    const dy = Math.abs(e.clientY - startYRef.current);
    if (dx > 8 || dy > 8) {
      movedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  };

  const handlePointerUp = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!longFiredRef.current && !movedRef.current) onShortTap();
    longFiredRef.current = false;
    movedRef.current = false;
  };

  const handlePointerCancel = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    longFiredRef.current = false;
    movedRef.current = false;
  };

  return (
    <button
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={e => e.preventDefault()}
      className="pick-float-in w-full flex gap-3 bg-surface-container-low hover:bg-surface-container transition-colors group text-left cursor-pointer p-3"
      style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
    >
      <div className="w-36 sm:w-48 shrink-0 aspect-video overflow-hidden bg-surface-container">
        <img
          src={video.thumbnail_url}
          alt={video.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      </div>
      <div className="flex flex-col justify-center gap-1 min-w-0">
        <p className="text-sm font-bold leading-snug group-hover:text-primary transition-colors line-clamp-2">
          {video.title}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.65rem] text-outline">
          <span>{video.channel_name}</span>
          <span className={`font-bold uppercase ${TYPE_COLOR[video.video_type] ?? 'text-outline'}`}>
            {video.video_type}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Zapping カード（2カラムグリッド用、短タップ=即再生 / 長押し=シート） ──────

interface ZappingCardProps {
  video: VideoRow;
  onShortTap: () => void;
  onLongPress: () => void;
}

function ZappingCard({ video, onShortTap, onLongPress }: ZappingCardProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFiredRef = useRef(false);
  const movedRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    longFiredRef.current = false;
    movedRef.current = false;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    timerRef.current = setTimeout(() => {
      if (!movedRef.current) {
        longFiredRef.current = true;
        onLongPress();
      }
    }, LONG_PRESS_DELAY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (movedRef.current) return;
    const dx = Math.abs(e.clientX - startXRef.current);
    const dy = Math.abs(e.clientY - startYRef.current);
    if (dx > 8 || dy > 8) {
      movedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  };

  const handlePointerUp = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!longFiredRef.current && !movedRef.current) onShortTap();
    longFiredRef.current = false;
    movedRef.current = false;
  };

  const handlePointerCancel = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    longFiredRef.current = false;
    movedRef.current = false;
  };

  return (
    <button
      data-testid="zapping-card"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={e => e.preventDefault()}
      className="flex flex-col bg-surface hover:bg-surface-container-low transition-colors cursor-pointer text-left"
      style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
    >
      <div className="relative w-full overflow-hidden bg-surface-container">
        <img
          src={video.thumbnail_url}
          alt={video.title}
          className="w-full object-cover"
          style={{ aspectRatio: '16/9' }}
          loading="lazy"
          decoding="async"
        />
        <span className="absolute top-1 left-1 text-[7px] font-bold uppercase text-white bg-black/70 px-1 py-0.5 leading-none">
          {video.video_type?.toUpperCase() || 'VIDEO'}
        </span>
      </div>
      <div className="px-2 py-2 flex-1">
        <p className="text-[0.6875rem] font-bold leading-snug line-clamp-2 text-on-surface">
          {video.title}
        </p>
        <p className="text-[0.6rem] text-outline mt-0.5 truncate">{video.channel_name}</p>
      </div>
    </button>
  );
}
