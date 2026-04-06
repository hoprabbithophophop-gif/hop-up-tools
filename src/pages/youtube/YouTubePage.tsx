import React, { useEffect, useState, useCallback, useRef } from "react";
import { getSupabase } from "../../lib/supabase";

interface MemberRow {
  name: string;
  group_name: string;
}

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
  "M-line Music",
  "アプカミ",
  "ファミ通ゲーム実況",
  "THE FIRST TAKE",
  "ヤンマガch",
  "happyに過ごそうよ",
  "ビヨーンズの伸びしろ",
  "SATOYAMA&SATOUMI",
  "ハロー!アニソン部",
  "tiny tiny",
  "こぶしファクトリー",
  "Berryz工房",
  "℃-ute",
  "カントリー・ガールズ",
  "Buono!",
  "ハロプロちょっと面白い話",
];

// グループ別メンバー（公式サイト表示順）
const MEMBERS_BY_GROUP: Record<string, string[]> = {
  "モーニング娘。": ["野中美希", "小田さくら", "牧野真莉愛", "岡村ほまれ", "山﨑愛生", "櫻井梨央", "井上春華", "弓桁朱琴"],
  "アンジュルム":   ["伊勢鈴蘭", "為永幸音", "橋迫鈴", "川名凜", "松本わかな", "平山遊季", "下井谷幸穂", "後藤花", "長野桃羽"],
  "Juice=Juice":    ["段原瑠々", "井上玲音", "工藤由愛", "松永里愛", "有澤一華", "入江里咲", "江端妃咲", "石山咲良", "遠藤彩加里", "川嶋美楓", "林仁愛"],
  "つばきファクトリー": ["谷本安美", "小野瑞歩", "小野田紗栞", "秋山眞緒", "河西結心", "福田真琳", "豫風瑠乃", "石井泉羽", "村田結生", "土居楓奏", "西村乙輝"],
  "BEYOOOOONDS":    ["西田汐里", "江口紗耶", "高瀬くるみ", "前田こころ", "岡村美波", "清野桃々姫", "平井美葉", "小林萌花", "里吉うたの"],
  "OCHA NORMA":     ["斉藤円香", "広本瑠璃", "米村姫良々", "窪田七海", "中山夏月姫", "西﨑美空", "北原もも", "筒井澪心"],
  "ロージークロニクル": ["橋田歩果", "吉田姫杷", "小野田華凜", "村越彩菜", "植村葉純", "松原ユリヤ", "島川波菜", "上村麗菜", "相馬優芽"],
};

const ALL_SUGGESTION_CANDIDATES: string[] = [
  ...GROUP_FILTERS,
  ...CHANNEL_FILTERS,
  ...Object.values(MEMBERS_BY_GROUP).flat(),
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

// FilterTab: タブ行の各ラベルボタン
function FilterTab({
  label, active, badge, onClick, demoid,
}: {
  label: string; active: boolean; badge?: string; onClick: () => void; demoid?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-demo-id={demoid}
      className={`flex items-center gap-1.5 shrink-0 py-2 cursor-pointer transition-colors group ${
        active ? "text-on-surface border-b-2 border-primary" : "text-outline hover:text-on-surface"
      }`}
    >
      <span className="text-[0.6875rem] font-bold uppercase tracking-widest">{label}</span>
      {badge && (
        <span className="text-[0.6rem] font-bold text-primary bg-primary/10 px-1 leading-4 rounded-none">
          {badge}
        </span>
      )}
    </button>
  );
}

function FilterChip({
  label, active, onClick, mono, demoid,
}: {
  label: string; active: boolean; onClick: () => void; mono?: boolean; demoid?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-demo-id={demoid}
      className={`text-[0.6875rem] font-bold transition-colors cursor-pointer pb-0.5 ${mono ? "tabular-nums" : ""} ${
        active ? "text-primary border-b-2 border-primary" : "text-outline hover:text-on-surface"
      }`}
    >
      {label}
    </button>
  );
}

function VideoModal({ video, onClose }: { video: VideoRow; onClose: () => void }) {
  const chapters = parseChapters(video.description_short);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSeconds, setShareSeconds] = useState<number | null>(null);
  const [timeInput, setTimeInput] = useState("");
  const [chapterLabel, setChapterLabel] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shareUrl = `https://www.youtube.com/watch?v=${video.video_id}${
    shareSeconds !== null ? `&t=${shareSeconds}` : ""
  }`;

  const shareText = (() => {
    if (shareSeconds === null) {
      return `${video.title}\n\n${shareUrl}`;
    }
    if (chapterLabel) {
      return `${video.title}\n${chapterLabel} [${timeInput}]\n\n${shareUrl}`;
    }
    return `${video.title} [${timeInput}]\n\n${shareUrl}`;
  })();
  const shareTitleSuffix = shareSeconds !== null
    ? (chapterLabel ? ` - ${chapterLabel}` : "") + ` [${timeInput}]`
    : "";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTimeInput = (val: string) => {
    setTimeInput(val);
    setChapterLabel(null);
    // mm:ss or hh:mm:ss → 秒に変換
    const parts = val.trim().split(":").map(Number);
    if (parts.every(n => !isNaN(n) && n >= 0)) {
      if (parts.length === 2 && parts[1] < 60) {
        setShareSeconds(parts[0] * 60 + parts[1]);
      } else if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) {
        setShareSeconds(parts[0] * 3600 + parts[1] * 60 + parts[2]);
      } else {
        setShareSeconds(null);
      }
    } else {
      setShareSeconds(null);
    }
  };

  const selectChapter = (sec: number, ts: string, label: string) => {
    setShareSeconds(sec);
    setTimeInput(ts);
    setChapterLabel(label);
  };

  const clearTime = () => {
    setShareSeconds(null);
    setTimeInput("");
    setChapterLabel(null);
  };

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

          {/* シェアパネル */}
          {shareOpen && (
            <div className="px-4 py-3 bg-surface-container-low border-b border-outline-variant/20 shrink-0 space-y-2.5">
              {/* タイムスタンプ入力 */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[0.6rem] font-bold uppercase tracking-widest text-outline">Time</span>
                <input
                  type="text"
                  value={timeInput}
                  onChange={e => handleTimeInput(e.target.value)}
                  placeholder="mm:ss"
                  className="w-20 bg-transparent border-b border-outline-variant/40 text-xs py-0.5 focus:outline-none focus:border-primary transition-colors placeholder:text-outline/40 tabular-nums"
                />
                {shareSeconds !== null && (
                  <button onClick={clearTime} className="text-[0.6rem] text-outline hover:text-primary transition-colors cursor-pointer uppercase tracking-widest">
                    clear
                  </button>
                )}
              </div>

              {/* チャプター早押し */}
              {chapters.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {chapters.map((ch, i) => (
                    <button
                      key={i}
                      onClick={() => selectChapter(ch.seconds, ch.timestamp, ch.label)}
                      {...(ch.label.includes('歌詞発表会') ? { 'data-demo-id': 'chapter-gyoshi-btn' } : {})}
                      className={`text-[0.6rem] font-mono px-1.5 py-0.5 border transition-colors cursor-pointer ${
                        shareSeconds === ch.seconds
                          ? "border-primary text-primary bg-primary/5"
                          : "border-outline-variant/40 text-outline hover:border-primary hover:text-primary"
                      }`}
                    >
                      {ch.timestamp}
                    </button>
                  ))}
                </div>
              )}

              {/* URL プレビュー + アクション */}
              <div className="flex items-start gap-2 flex-wrap">
                <div className="flex-1 min-w-0 font-mono space-y-1.5">
                  <p className="text-[0.6rem] text-on-surface/80 truncate">{video.title}{shareTitleSuffix}</p>
                  <p className="text-[0.6rem] text-outline/60 truncate">{shareUrl}</p>
                </div>
                <button
                  onClick={handleCopy}
                  data-demo-id="share-copy-btn"
                  className="text-[0.6rem] font-bold uppercase tracking-widest text-outline hover:text-primary transition-colors cursor-pointer shrink-0"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="text-[0.6rem] font-bold uppercase tracking-widest text-outline hover:text-primary transition-colors cursor-pointer shrink-0"
                >
                  Post on X
                </a>
              </div>
            </div>
          )}

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
                      {...(ch.label.includes('歌詞発表会') ? { 'data-demo-id': 'chapter-gyoshi' } : {})}
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

          {/* Watch + Share ボタン */}
          <div className="px-4 py-3 border-t border-outline-variant/20 shrink-0 flex gap-2">
            <a
              href={`https://www.youtube.com/watch?v=${video.video_id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex-1 bg-primary text-on-primary-fixed text-center text-xs font-bold uppercase tracking-[0.2em] py-3 hover:bg-secondary transition-colors cursor-pointer"
            >
              Watch on YouTube
            </a>
            <button
              onClick={() => setShareOpen(o => !o)}
              data-demo-id="share-btn"
              className={`px-4 text-xs font-bold uppercase tracking-widest border transition-colors cursor-pointer ${
                shareOpen
                  ? "bg-primary text-on-primary border-primary"
                  : "border-outline-variant text-outline hover:border-primary hover:text-primary"
              }`}
            >
              Share
            </button>
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
  const [pickHistory, setPickHistory] = useState<VideoRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [selectedMember, setSelectedMember] = useState("");
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const toggleTab = (key: string) => setActiveTab(prev => prev === key ? null : key);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { document.title = "YouTube チェック | hop-up-tools"; }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchPickVideo = useCallback(async (current: VideoRow | null) => {
    const supabase = getSupabase();
    const { count } = await supabase
      .from("youtube_videos")
      .select("*", { count: "exact", head: true })
      .eq("is_active_content", true);
    if (!count) return;
    const randomOffset = Math.floor(Math.random() * count);
    const { data } = await supabase
      .from("youtube_videos")
      .select("video_id,title,channel_name,published_at,thumbnail_url,video_type,group_tags,description_short")
      .eq("is_active_content", true)
      .range(randomOffset, randomOffset);
    if (data && data.length > 0) {
      if (current) setPickHistory(prev =>
        prev.some(v => v.video_id === current.video_id)
          ? prev
          : [current, ...prev].slice(0, 3)
      );
      setPickVideo(data[0] as VideoRow);
    }
  }, []);

  useEffect(() => { fetchPickVideo(null); }, [fetchPickVideo]);

  useEffect(() => {
    getSupabase()
      .from("hello_members")
      .select("name,group_name")
      .eq("active", true)
      .order("group_name")
      .order("name")
      .then(({ data }) => { if (data) setMembers(data as MemberRow[]); });
  }, []);

  const fetchVideos = useCallback(async (
    group: string, type: string, year: number, channel: string,
    query: string, member: string, sort: "desc" | "asc", currentOffset: number, replace: boolean
  ) => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      let q = supabase
        .from("youtube_videos")
        .select("video_id,title,channel_name,published_at,thumbnail_url,video_type,group_tags,description_short")
        .order("published_at", { ascending: sort === "asc" })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);

      if (group)    q = q.contains("group_tags", [group]);
      if (type)     q = q.eq("video_type", type);
      if (channel)  q = q.eq("channel_name", channel);
      // チャンネル・グループ未指定時: 混在チャンネルの非ハロプロ動画を除外
      if (!channel && !group) q = q.filter("group_tags", "neq", "{}");
      if (year) {
        q = q
          .gte("published_at", `${year}-01-01T00:00:00Z`)
          .lt("published_at",  `${year + 1}-01-01T00:00:00Z`);
      }
      if (member) {
        q = q.or(`title.ilike.%${member}%,description_short.ilike.%${member}%`);
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
    fetchVideos(selectedGroup, selectedType, selectedYear, selectedChannel, searchQuery, selectedMember, sortOrder, 0, true);
  }, [selectedGroup, selectedType, selectedYear, selectedChannel, searchQuery, selectedMember, sortOrder, fetchVideos]);

  // 無限スクロール: sentinel が viewport に入ったら次のページを取得
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          fetchVideos(selectedGroup, selectedType, selectedYear, selectedChannel, searchQuery, selectedMember, sortOrder, offset, false);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, offset, selectedGroup, selectedType, selectedYear, selectedChannel, searchQuery, selectedMember, sortOrder, fetchVideos]);

  const handleGroupChange = (g: string) => {
    const next = selectedGroup === g ? "" : g;
    setSelectedGroup(next);
    // 選択グループに属さないメンバーが選ばれていたらリセット
    if (selectedMember && next) {
      const groupMembers = MEMBERS_BY_GROUP[next] ?? members.filter(m => m.group_name === next).map(m => m.name);
      if (!groupMembers.includes(selectedMember)) setSelectedMember("");
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearchQuery(val), 500);
    if (val.trim()) {
      const lower = val.toLowerCase();
      const matched = ALL_SUGGESTION_CANDIDATES
        .filter(c => c.toLowerCase().includes(lower))
        .slice(0, 8);
      setSuggestions(matched);
      setShowSuggestions(matched.length > 0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const selectSuggestion = (s: string) => {
    setSearchInput(s);
    setSearchQuery(s);
    setSuggestions([]);
    setShowSuggestions(false);
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
        <div ref={searchContainerRef} className="relative flex items-center gap-2">
          <input
            type="text"
            data-demo-id="search-input"
            placeholder="search..."
            value={searchInput}
            onChange={handleSearchChange}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            className="w-48 md:w-64 bg-transparent border-b border-outline-variant/40 py-1 text-sm focus:outline-none focus:border-primary transition-colors placeholder:italic placeholder:text-outline/50"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(""); setSearchQuery(""); setSuggestions([]); setShowSuggestions(false); }}
              className="text-outline hover:text-primary text-xs uppercase tracking-widest transition-colors cursor-pointer"
            >
              clear
            </button>
          )}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full right-0 mt-2 w-64 bg-surface border border-outline-variant/40 shadow-lg z-50">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onMouseDown={() => selectSuggestion(s)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-surface-container transition-colors cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-8">

        {/* フィルターバー（タブ切り替え） */}
        {(() => {
          const memberList = selectedGroup
            ? (MEMBERS_BY_GROUP[selectedGroup] ?? members.filter(m => m.group_name === selectedGroup).map(m => m.name))
            : [];

          // タブ定義（MEMBER はタブなし・GROUP パネル内に展開）
          const tabs = [
            { key: "group",   label: "Group",  badge: selectedMember ? selectedMember : (selectedGroup || undefined) },
            { key: "type",    label: "Type",   badge: selectedType ? selectedType.toUpperCase() : undefined },
            { key: "channel", label: "Ch",     badge: selectedChannel ? "●" : undefined },
            { key: "year",    label: "Year",   badge: selectedYear > 0 ? String(selectedYear) : undefined },
            { key: "sort",    label: "Sort",   badge: sortOrder.toUpperCase() },
          ];

          // 展開パネルのコンテンツ
          const panelContent: Record<string, React.ReactNode> = {
            group: (
              <>
                <div className="flex flex-wrap gap-x-4 gap-y-2 w-full">
                  {GROUP_FILTERS.map(g => (
                    <FilterChip key={g} label={g} active={selectedGroup === g} onClick={() => handleGroupChange(g)}
                      demoid={g === "BEYOOOOONDS" ? "filter-chip-beyooooonds" : undefined} />
                  ))}
                </div>
                {memberList.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-2 w-full pt-2 mt-1 border-t border-outline-variant/20">
                    {memberList.map(name => (
                      <FilterChip key={name} label={name} active={selectedMember === name}
                        onClick={() => setSelectedMember(prev => prev === name ? "" : name)} />
                    ))}
                  </div>
                )}
              </>
            ),
            type: TYPE_FILTERS.map(t => (
              <FilterChip key={t.key} label={t.label} active={selectedType === t.key} onClick={() => setSelectedType(t.key)}
                demoid={t.key === "mv" ? "filter-chip-mv" : undefined} />
            )),
            channel: CHANNEL_FILTERS.map(c => (
              <FilterChip key={c} label={c} active={selectedChannel === c}
                onClick={() => setSelectedChannel(prev => prev === c ? "" : c)} />
            )),
            year: YEAR_FILTERS.map(y => (
              <FilterChip key={y} label={String(y)} active={selectedYear === y}
                onClick={() => setSelectedYear(prev => prev === y ? 0 : y)} mono />
            )),
            sort: SORT_OPTIONS.map(s => (
              <FilterChip key={s.key} label={s.label} active={sortOrder === s.key} onClick={() => setSortOrder(s.key)} />
            )),
          };

          return (
            <div className="mb-8">
              {/* タブ行 */}
              <div className="flex items-center gap-5 flex-wrap border-b border-outline-variant/20 px-0">
                {tabs.map(t => (
                  <FilterTab
                    key={t.key}
                    label={t.label}
                    active={activeTab === t.key}
                    badge={t.badge}
                    onClick={() => toggleTab(t.key)}
                    demoid={`filter-tab-${t.key}`}
                  />
                ))}
              </div>
              {/* 展開パネル */}
              {activeTab && panelContent[activeTab] && (
                <div className="flex flex-wrap gap-x-4 gap-y-2 pt-3 pb-4 border-b border-outline-variant/20">
                  {panelContent[activeTab]}
                </div>
              )}
            </div>
          );
        })()}

        {/* PICK */}
        {pickVideo && (
          <div className="mb-8">
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline">Pick</span>
              <button
                onClick={() => fetchPickVideo(pickVideo)}
                className="text-[0.6875rem] uppercase tracking-widest text-outline hover:text-primary transition-colors cursor-pointer"
              >
                ↻ shuffle
              </button>
            </div>
            {/* メインカード（key でアニメーション再生） */}
            <button
              key={pickVideo.video_id}
              onClick={() => setModalVideo(pickVideo)}
              data-demo-id="pick-card"
              className="pick-float-in w-full flex gap-4 bg-surface-container-low hover:bg-surface-container transition-colors group text-left cursor-pointer p-3"
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
            {/* 履歴サムネ（最大3件） */}
            {pickHistory.length > 0 && (
              <div className="flex gap-2 mt-2">
                {pickHistory.map(v => (
                  <button
                    key={v.video_id}
                    onClick={() => setModalVideo(v)}
                    title={v.title}
                    className="w-24 sm:w-32 aspect-video overflow-hidden bg-surface-container opacity-50 hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                  >
                    <img src={v.thumbnail_url} alt={v.title} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
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
            {videos.map((v, idx) => (
              <button
                key={v.video_id}
                onClick={() => setModalVideo(v)}
                {...(idx === 0 ? { 'data-demo-id': 'result-card' } : {})}
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

        {/* 無限スクロール sentinel */}
        <div ref={sentinelRef} className="h-1" />

        {loading && (
          <div className="flex items-center justify-center h-32 text-outline text-xs uppercase tracking-widest">
            Loading...
          </div>
        )}

        {/* 終端 */}
        {!hasMore && videos.length > 0 && !loading && (
          <div className="flex items-center justify-center h-24 text-outline/40 text-[0.6rem] uppercase tracking-widest">
            — end —
          </div>
        )}

      </main>
    </div>
  );
}
