import { useEffect, useState, useCallback, useRef } from "react";
import { getSupabase } from "../../lib/supabase";

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

const PAGE_SIZE = 24;

const GROUP_FILTERS = [
  "モーニング娘。",
  "アンジュルム",
  "Juice=Juice",
  "つばきファクトリー",
  "BEYOOOOONDS",
  "OCHA NORMA",
  "ロージークロニクル",
  "ハロプロ研修生",
];

const TYPE_FILTERS: { key: string; label: string }[] = [
  { key: "",        label: "ALL" },
  { key: "mv",      label: "MV" },
  { key: "live",    label: "LIVE" },
  { key: "variety", label: "VARIETY" },
  { key: "other",   label: "OTHER" },
];

const SORT_OPTIONS: { key: "desc" | "asc"; label: string }[] = [
  { key: "desc", label: "NEW" },
  { key: "asc",  label: "OLD" },
];

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_FILTERS: number[] = Array.from(
  { length: CURRENT_YEAR - 2011 },
  (_, i) => CURRENT_YEAR - i
);

const CHANNEL_FILTERS = [
  "ハロ！ステ",
  "アップフロントチャンネル",
  "モーニング娘。",
  "アンジュルム",
  "Juice=Juice",
  "つばきファクトリー",
  "BEYOOOOONDS",
  "OCHA NORMA",
  "ロージークロニクル",
  "ハロプロ研修生",
  "OMAKE CHANNEL",
  "UFfanclub",
  "UF Goods Land",
  "アプカミ",
];

const TYPE_COLOR: Record<string, string> = {
  mv:      "text-[#E5457D]",
  live:    "text-blue-500",
  variety: "text-amber-500",
  other:   "text-outline",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
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
    const seconds = h * 3600 + min * 60 + sec;
    const timestamp = hasHours
      ? `${m[1]}:${m[2]}:${m[3]}`
      : `${m[1]}:${m[2]}`;
    chapters.push({ seconds, label: m[4].trim(), timestamp });
  }
  return chapters;
}

function VideoModal({ video, onClose }: { video: VideoRow; onClose: () => void }) {
  const chapters = parseChapters(video.description_short);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-surface w-full sm:max-w-2xl max-h-[85vh] sm:max-h-[80vh] flex flex-col sm:flex-row overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* サムネイル列 (mobile: 上部 / PC: 左カラム) */}
        <div className="relative sm:w-2/5 shrink-0 bg-surface-container">
          <div className="aspect-video sm:aspect-auto sm:absolute sm:inset-0">
            <img
              src={video.thumbnail_url}
              alt={video.title}
              className="w-full h-full object-cover"
            />
          </div>
          <button
            onClick={onClose}
            className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 uppercase tracking-widest hover:bg-black transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* コンテンツ列 (mobile: 下部 / PC: 右カラム) */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* タイトル・メタ */}
          <div className="px-4 pt-3 pb-2 border-b border-outline-variant/20 shrink-0">
            <p className="text-sm font-bold leading-snug mb-1">{video.title}</p>
            <div className="flex items-center gap-3 text-[0.65rem] text-outline">
              <span>{video.channel_name}</span>
              <span className={`font-bold uppercase ${TYPE_COLOR[video.video_type] ?? "text-outline"}`}>
                {video.video_type}
              </span>
              <span>{formatDate(video.published_at)}</span>
            </div>
          </div>

          {/* チャプターリスト */}
          <div className="overflow-y-auto flex-1">
            {chapters.length > 0 ? (
              <ul className="divide-y divide-outline-variant/10">
                {chapters.map((ch, i) => (
                  <li key={i}>
                    <a
                      href={`https://www.youtube.com/watch?v=${video.video_id}&t=${ch.seconds}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-baseline gap-3 px-4 py-2.5 hover:bg-surface-container-low transition-colors group cursor-pointer"
                    >
                      <span className="text-[0.65rem] font-mono text-primary shrink-0 tabular-nums">
                        {ch.timestamp}
                      </span>
                      <span className="text-[0.75rem] leading-snug group-hover:text-primary transition-colors">
                        {ch.label}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-6 text-[0.7rem] text-outline">
                チャプター情報なし
              </div>
            )}
          </div>

          {/* YouTube で開く */}
          <div className="px-4 py-3 border-t border-outline-variant/20 shrink-0">
            <a
              href={`https://www.youtube.com/watch?v=${video.video_id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="block w-full bg-primary text-on-primary-fixed text-center text-xs font-bold uppercase tracking-[0.2em] py-3 hover:bg-secondary transition-colors cursor-pointer"
            >
              Watch on YouTube
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function YouTubePage() {
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [selectedYear, setSelectedYear] = useState(0);
  const [selectedChannel, setSelectedChannel] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [modalVideo, setModalVideo] = useState<VideoRow | null>(null);
  const [pickVideo, setPickVideo] = useState<VideoRow | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { document.title = "ハロプロ YouTube | hop-up-tools"; }, []);

  const fetchPickVideo = useCallback(async () => {
    const supabase = getSupabase();
    const { count } = await supabase
      .from("youtube_videos")
      .select("*", { count: "exact", head: true });
    if (!count) return;
    const randomOffset = Math.floor(Math.random() * count);
    const { data } = await supabase
      .from("youtube_videos")
      .select("video_id,title,channel_name,published_at,thumbnail_url,video_type,group_tags,description_short")
      .range(randomOffset, randomOffset);
    if (data && data.length > 0) setPickVideo(data[0] as VideoRow);
  }, []);

  useEffect(() => { fetchPickVideo(); }, [fetchPickVideo]);

  const fetchVideos = useCallback(async (
    group: string, type: string, year: number, channel: string,
    query: string, sort: "desc" | "asc", currentOffset: number, replace: boolean
  ) => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      let q = supabase
        .from("youtube_videos")
        .select("video_id,title,channel_name,published_at,thumbnail_url,video_type,group_tags,description_short")
        .order("published_at", { ascending: sort === "asc" })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);

      if (group)   q = q.contains("group_tags", [group]);
      if (type)    q = q.eq("video_type", type);
      if (channel) q = q.eq("channel_name", channel);
      if (year) {
        q = q
          .gte("published_at", `${year}-01-01T00:00:00Z`)
          .lt("published_at",  `${year + 1}-01-01T00:00:00Z`);
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
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setVideos([]);
    setOffset(0);
    setHasMore(true);
    fetchVideos(selectedGroup, selectedType, selectedYear, selectedChannel, searchQuery, sortOrder, 0, true);
  }, [selectedGroup, selectedType, selectedYear, selectedChannel, searchQuery, sortOrder, fetchVideos]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearchQuery(val), 500);
  };

  return (
    <div className="bg-surface text-on-surface min-h-screen pb-24">

      {modalVideo && (
        <VideoModal video={modalVideo} onClose={() => setModalVideo(null)} />
      )}

      {/* ヘッダー */}
      <header className="sticky top-0 z-40 bg-surface border-b border-outline-variant/20 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="text-outline hover:text-primary transition-colors text-sm">←</a>
          <h1 className="text-2xl font-black tracking-tighter uppercase">HELLO! VIDEOS</h1>
        </div>
        {/* 検索 */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="search..."
            value={searchInput}
            onChange={handleSearchChange}
            className="w-48 md:w-64 bg-transparent border-b border-outline-variant/40 py-1 text-sm focus:outline-none focus:border-primary transition-colors placeholder:italic placeholder:text-outline/50"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(""); setSearchQuery(""); }}
              className="text-outline hover:text-primary text-xs uppercase tracking-widest transition-colors cursor-pointer"
            >
              clear
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-8">

        {/* フィルターバー */}
        <div className="flex flex-col gap-4 mb-8 border-b border-outline-variant/20 pb-6">

          {/* グループ */}
          <div className="flex items-baseline gap-6 flex-wrap">
            <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline shrink-0">Group</span>
            {GROUP_FILTERS.map(g => (
              <button
                key={g}
                onClick={() => setSelectedGroup(prev => prev === g ? "" : g)}
                className={`text-xs font-bold transition-colors cursor-pointer pb-0.5 ${
                  selectedGroup === g
                    ? "text-primary border-b-2 border-primary"
                    : "text-outline hover:text-on-surface"
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          {/* 種別 */}
          <div className="flex items-baseline gap-6 flex-wrap">
            <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline shrink-0">Type</span>
            {TYPE_FILTERS.map(t => (
              <button
                key={t.key}
                onClick={() => setSelectedType(t.key)}
                className={`text-[0.6875rem] font-bold uppercase tracking-widest transition-colors cursor-pointer pb-0.5 ${
                  selectedType === t.key
                    ? "text-primary border-b-2 border-primary"
                    : "text-outline hover:text-on-surface"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* チャンネル */}
          <div className="flex items-baseline gap-4 flex-wrap">
            <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline shrink-0">Ch</span>
            {CHANNEL_FILTERS.map(c => (
              <button
                key={c}
                onClick={() => setSelectedChannel(prev => prev === c ? "" : c)}
                className={`text-[0.6875rem] font-bold transition-colors cursor-pointer pb-0.5 ${
                  selectedChannel === c
                    ? "text-primary border-b-2 border-primary"
                    : "text-outline hover:text-on-surface"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* 年 */}
          <div className="flex items-baseline gap-4 flex-wrap">
            <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline shrink-0">Year</span>
            {YEAR_FILTERS.map(y => (
              <button
                key={y}
                onClick={() => setSelectedYear(prev => prev === y ? 0 : y)}
                className={`text-[0.6875rem] font-bold tabular-nums transition-colors cursor-pointer pb-0.5 ${
                  selectedYear === y
                    ? "text-primary border-b-2 border-primary"
                    : "text-outline hover:text-on-surface"
                }`}
              >
                {y}
              </button>
            ))}
          </div>

          {/* ソート */}
          <div className="flex items-baseline gap-6 flex-wrap">
            <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline shrink-0">Sort</span>
            {SORT_OPTIONS.map(s => (
              <button
                key={s.key}
                onClick={() => setSortOrder(s.key)}
                className={`text-[0.6875rem] font-bold uppercase tracking-widest transition-colors cursor-pointer pb-0.5 ${
                  sortOrder === s.key
                    ? "text-primary border-b-2 border-primary"
                    : "text-outline hover:text-on-surface"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* PICK */}
        {pickVideo && (
          <div className="mb-8">
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline">Pick</span>
              <button
                onClick={fetchPickVideo}
                className="text-[0.6875rem] uppercase tracking-widest text-outline hover:text-primary transition-colors cursor-pointer"
              >
                ↻ shuffle
              </button>
            </div>
            <button
              onClick={() => setModalVideo(pickVideo)}
              className="w-full flex gap-4 bg-surface-container-low hover:bg-surface-container transition-colors group text-left cursor-pointer p-3"
            >
              <div className="w-40 sm:w-56 shrink-0 aspect-video overflow-hidden bg-surface-container">
                <img
                  src={pickVideo.thumbnail_url}
                  alt={pickVideo.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
              <div className="flex flex-col justify-center gap-1.5 min-w-0">
                <p className="text-sm font-bold leading-snug group-hover:text-primary transition-colors">
                  {pickVideo.title}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.65rem] text-outline">
                  <span>{pickVideo.channel_name}</span>
                  <span className={`font-bold uppercase ${TYPE_COLOR[pickVideo.video_type] ?? "text-outline"}`}>
                    {pickVideo.video_type}
                  </span>
                  <span>{formatDate(pickVideo.published_at)}</span>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* 件数表示 */}
        {!loading && (
          <p className="text-[0.6875rem] uppercase tracking-widest text-outline mb-6">
            {videos.length} videos{hasMore ? "+" : ""}
            {selectedGroup   && <span className="ml-3">{selectedGroup}</span>}
            {selectedChannel && <span className="ml-3">{selectedChannel}</span>}
            {selectedYear    && <span className="ml-3">{selectedYear}</span>}
            {searchQuery     && <span className="ml-3">"{searchQuery}"</span>}
          </p>
        )}

        {/* グリッド */}
        {videos.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-64 text-outline text-xs uppercase tracking-widest">
            No videos found.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-px bg-outline-variant/20">
            {videos.map(v => (
              <button
                key={v.video_id}
                onClick={() => setModalVideo(v)}
                className="bg-surface group block text-left hover:bg-surface-container-low transition-colors w-full cursor-pointer"
              >
                <div className="aspect-video overflow-hidden bg-surface-container">
                  <img
                    src={v.thumbnail_url}
                    alt={v.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                </div>
                <div className="p-2.5">
                  <p className="text-[0.7rem] font-medium leading-snug line-clamp-2 mb-1.5 group-hover:text-primary transition-colors">
                    {v.title}
                  </p>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[0.6rem] text-outline truncate">{v.channel_name}</span>
                    <span className={`text-[0.6rem] font-bold uppercase shrink-0 ${TYPE_COLOR[v.video_type] ?? "text-outline"}`}>
                      {v.video_type}
                    </span>
                  </div>
                  <p className="text-[0.6rem] text-outline/60 mt-0.5">{formatDate(v.published_at)}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* もっと見る */}
        {hasMore && !loading && videos.length > 0 && (
          <div className="mt-12 text-center">
            <button
              onClick={() => fetchVideos(selectedGroup, selectedType, selectedYear, selectedChannel, searchQuery, sortOrder, offset, false)}
              className="bg-primary text-on-primary-fixed px-12 py-4 text-xs font-bold uppercase tracking-[0.2em] hover:bg-secondary transition-colors cursor-pointer"
            >
              Load More
            </button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center h-32 text-outline text-xs uppercase tracking-widest">
            Loading...
          </div>
        )}

      </main>
    </div>
  );
}
