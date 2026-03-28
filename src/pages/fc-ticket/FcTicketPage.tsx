import { useEffect, useRef, useState } from "react";
import { getSupabase } from "../../lib/supabase";
import { generateIcs, downloadIcs, generateGoogleCalendarUrl, generateYahooCalendarUrl, type IcsEvent } from "../../lib/ics";
import {
  parseUpfcText,
  matchApplications,
  type ParsedApplication,
  type FcNewsRow,
  type MatchResult,
} from "../../lib/parseUpfcText";

// ─── 型定義 ───────────────────────────────────────────────

interface Deadline {
  id: string;
  news_uid: string;
  type: string;
  label: string;
  deadline_at: string;
  fc_news: { title: string; detail_url: string; category: string };
}

type Tab = "input" | "result" | "calendar";

interface GanttPeriod {
  newsUid: string;
  start: Date;
  end: Date;
  type: "apply" | "payment" | "sale";
  color: string;
  kind: "applied" | "watchlist" | "other";
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

// BEYOOOOONDS のサブユニット込みグループ定義
const GROUP_KEYS: { key: string; label: string; subKeys?: string[] }[] = [
  { key: "モーニング娘", label: "モーニング娘。'26" },
  { key: "アンジュルム", label: "アンジュルム" },
  { key: "Juice=Juice", label: "Juice=Juice" },
  { key: "つばきファクトリー", label: "つばきファクトリー" },
  // BEYOOOOONDS を選ぶとサブユニット記事も一緒に表示
  { key: "BEYOOOOONDS", label: "BEYOOOOONDS", subKeys: ["CHICA#TETSU", "雨ノ森 川海", "SeasoningS"] },
  { key: "CHICA#TETSU", label: "CHICA#TETSU" },
  { key: "雨ノ森 川海", label: "雨ノ森 川海" },
  { key: "SeasoningS", label: "SeasoningS" },
  { key: "OCHA NORMA", label: "OCHA NORMA" },
  { key: "ロージークロニクル", label: "ロージークロニクル" },
  { key: "ハロプロ研修生", label: "ハロプロ研修生" },
];

function titleMatchesGroup(title: string, g: { key: string; subKeys?: string[] }): boolean {
  return title.includes(g.key) || (g.subKeys ?? []).some((sk) => title.includes(sk));
}

const MONTH_EN = [
  "JAN.", "FEB.", "MAR.", "APR.", "MAY.", "JUN.",
  "JUL.", "AUG.", "SEP.", "OCT.", "NOV.", "DEC.",
];

const TYPE_LABEL_EN: Record<string, string> = {
  apply_start: "Entry Start",
  apply_end:   "Entry Deadline",
  result:      "Lottery Result",
  payment:     "Payment Due",
  sale_start:  "Sale Start",
  sale_end:    "Sale End",
  other:       "Other",
};

// ─── メインコンポーネント ──────────────────────────────────

export default function FcTicketPage() {
  useEffect(() => { document.title = "FC 締切リマインダー | hop-up-tools"; }, []);

  const [tab, setTab] = useState<Tab>("input");
  const [pasteText, setPasteText] = useState("");
  const [allNews, setAllNews] = useState<FcNewsRow[]>([]);
  const [allDeadlines, setAllDeadlines] = useState<Deadline[]>([]);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [watchlist, setWatchlistState] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("fc-watchlist") ?? "[]"); }
    catch { return []; }
  });

  const matchedUids = new Set(matchResults.flatMap((r) => r.matched.map((m) => m.uid)));

  function setWatchlist(uids: string[]) {
    setWatchlistState(uids);
    localStorage.setItem("fc-watchlist", JSON.stringify(uids));
  }

  // Supabase から全データを取得
  useEffect(() => {
    const sb = getSupabase();
    Promise.all([
      sb.from("fc_news").select("uid, title, category, detail_url"),
      sb
        .from("fc_deadlines")
        .select("*, fc_news(title, detail_url, category)")
        .gte("deadline_at", new Date(Date.now() - 60 * 86400000).toISOString())
        .order("deadline_at", { ascending: true })
        .limit(500),
    ]).then(([newsRes, dlRes]) => {
      if (newsRes.data) setAllNews(newsRes.data as FcNewsRow[]);
      if (dlRes.data) setAllDeadlines(dlRes.data as Deadline[]);
      setLoading(false);
    });
  }, []);

  function handleAnalyze() {
    if (!pasteText.trim()) return;
    const parsed = parseUpfcText(pasteText);
    const results = matchApplications(parsed, allNews);
    setMatchResults(results);
    setTab("result");
  }

  return (
    <div className="bg-surface text-on-surface min-h-screen font-[Inter,sans-serif] pb-20">
      <Header tab={tab} setTab={setTab} />

      {loading ? (
        <div className="flex items-center justify-center h-64 text-outline text-xs uppercase tracking-widest">
          Loading...
        </div>
      ) : (
        <>
          {tab === "input" && (
            <InputScreen
              pasteText={pasteText}
              setPasteText={setPasteText}
              onAnalyze={handleAnalyze}
              onCalendar={() => setTab("calendar")}
            />
          )}
          {tab === "result" && (
            <ResultScreen
              matchResults={matchResults}
              allDeadlines={allDeadlines}
              onBack={() => setTab("input")}
            />
          )}
          {tab === "calendar" && (
            <CalendarScreen
              allDeadlines={allDeadlines}
              allNews={allNews}
              watchlist={watchlist}
              onWatchlistChange={setWatchlist}
              matchedUids={matchedUids}
            />
          )}
        </>
      )}

      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

// ─── 共通ヘッダー ─────────────────────────────────────────

function Header({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <header className="flex items-center justify-between w-full px-6 py-4 bg-surface sticky top-0 z-40 border-b border-outline-variant/20">
      <div className="flex items-center gap-4">
        <a href="/" className="material-symbols-outlined text-primary">arrow_back</a>
        <h1 className="text-2xl font-black tracking-tighter text-primary uppercase">DEADLINES</h1>
      </div>
      <nav className="hidden md:flex gap-8">
        {(["input", "result", "calendar"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-[0.6875rem] font-bold uppercase tracking-widest px-2 py-1 transition-colors cursor-pointer ${
              tab === t
                ? "text-primary underline decoration-2 underline-offset-4"
                : "text-outline hover:text-primary"
            }`}
          >
            {t === "input" ? "Input" : t === "result" ? "Result" : "Calendar"}
          </button>
        ))}
      </nav>
    </header>
  );
}

// ─── 画面A: 入力 ──────────────────────────────────────────

function InputScreen({
  pasteText,
  setPasteText,
  onAnalyze,
  onCalendar,
}: {
  pasteText: string;
  setPasteText: (v: string) => void;
  onAnalyze: () => void;
  onCalendar: () => void;
}) {
  return (
    <main className="flex-grow flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-12 gap-0 border border-outline-variant/20 bg-surface-container-lowest">
        {/* 左カラム（デスクトップのみ） */}
        <div className="hidden md:flex md:col-span-3 bg-surface-container-low p-8 flex-col justify-between border-r border-outline-variant/20">
          <div>
            <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline mb-8 block">
              Information
            </span>
            <p className="text-[3.5rem] font-black leading-none text-primary mb-4">01</p>
            <p className="text-xs font-bold leading-tight uppercase tracking-tighter">
              Automatic extraction of deadline dates from your UPFC ticket status list.
            </p>
          </div>
          <div className="mt-auto">
            <a
              href="https://www.upfc.jp/helloproject/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold underline decoration-1 underline-offset-4 hover:text-tertiary transition-colors"
            >
              UPFC 公式サイト ↗
            </a>
          </div>
        </div>

        {/* 右カラム: 入力エリア */}
        <div className="md:col-span-9 p-8 md:p-16 flex flex-col">
          <div className="mb-12">
            <h2 className="text-[1.5rem] font-medium tracking-tight mb-2">Import Schedule</h2>
            <div className="h-1 w-12 bg-primary mb-8" />
          </div>

          <div className="relative mb-8">
            <label className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline block mb-4">
              Source Data
            </label>
            <textarea
              className="w-full h-64 bg-transparent border-b border-outline-variant/40 py-4 text-sm resize-none focus:outline-none focus:border-b-2 focus:border-primary transition-all placeholder:italic placeholder:text-outline/50"
              placeholder="UPFCのチケット申込状況をコピペしてください"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-outline">
                <span className="material-symbols-outlined text-sm">content_copy</span>
                <a
                  href="https://www.upfc.jp/helloproject/mypage/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[0.6875rem] font-bold uppercase tracking-widest hover:text-primary transition-colors"
                >
                  UPFC 申込状況ページ ↗
                </a>
              </div>
              <p className="text-[0.6875rem] text-outline italic">
                入力内容はサーバーに送信されません
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-6 items-start">
            <button
              onClick={onAnalyze}
              disabled={!pasteText.trim()}
              className="bg-primary text-on-primary-fixed px-12 py-5 text-sm font-bold uppercase tracking-[0.2em] hover:bg-secondary transition-colors w-full sm:w-auto disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              締切を確認
            </button>
            <button
              onClick={onCalendar}
              className="group flex items-center gap-2 text-[0.6875rem] font-bold uppercase tracking-widest text-outline hover:text-primary transition-all cursor-pointer"
            >
              <span>コピペせずにカレンダーから探す</span>
              <span className="material-symbols-outlined text-sm group-hover:translate-x-1 transition-transform">
                arrow_forward
              </span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── 画面B: 抽出結果 ──────────────────────────────────────

function ResultScreen({
  matchResults,
  allDeadlines,
  onBack,
}: {
  matchResults: MatchResult[];
  allDeadlines: Deadline[];
  onBack: () => void;
}) {
  const matched = matchResults.filter((r) => r.matched.length > 0);
  const unmatched = matchResults.filter((r) => r.matched.length === 0);

  // マッチした公演に紐づく未来の締切を取得（(type, deadline_at) でデデュープ）
  function deadlinesFor(uids: string[]): Deadline[] {
    const seen = new Set<string>();
    return allDeadlines
      .filter((d) => uids.includes(d.news_uid))
      // 申込開始・当落確認は非表示（当落確認はメール通知あり、申込開始は不要）
      // 申込締切（apply_end）は表示する（抽選前のケースで残り期間を確認できる）
      .filter((d) => d.type !== "apply_start" && d.type !== "result")
      .filter((d) => {
        const key = `${d.type}-${d.deadline_at}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  // 今日締切のものがあるか
  const today = new Date();
  const urgentCount = matched.filter((r) => {
    const dls = deadlinesFor(r.matched.map((n) => n.uid));
    return dls.some((d) => {
      const diff = (new Date(d.deadline_at).getTime() - today.getTime()) / 86400000;
      return diff < 1;
    });
  }).length;

  if (matchResults.length === 0) {
    return (
      <main className="px-6 py-16 max-w-4xl mx-auto text-center">
        <p className="text-outline text-sm uppercase tracking-widest mb-6">
          まだ結果がありません
        </p>
        <button onClick={onBack} className="text-[0.6875rem] font-bold uppercase tracking-widest underline hover:text-tertiary transition-colors cursor-pointer">
          ← Input に戻る
        </button>
      </main>
    );
  }

  return (
    <main className="pt-8 pb-32 px-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-0 md:gap-14">
        {/* 左カラム */}
        <aside className="md:col-span-4 flex flex-col gap-8 mb-10 md:mb-0">
          <div>
            <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline">Section</span>
            <h2 className="text-5xl font-extrabold tracking-tighter leading-none mt-2">
              RESULT<br />ANALYSIS
            </h2>
          </div>
          <div className="bg-surface-container-low p-6 space-y-4">
            <p className="text-sm font-medium leading-relaxed">
              {matched.length}件の公演がマッチしました。
              {unmatched.length > 0 && `${unmatched.length}件はデータが見つかりませんでした。`}
            </p>
            {urgentCount > 0 && (
              <div className="border-t border-outline-variant/20 pt-4">
                <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-tertiary">Urgent</span>
                <p className="text-2xl font-black">{String(urgentCount).padStart(2, "0")}</p>
              </div>
            )}
          </div>
          <button onClick={onBack} className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline hover:text-primary transition-colors cursor-pointer text-left">
            ← 入力に戻る
          </button>
        </aside>

        {/* 右カラム: 結果リスト */}
        <section className="md:col-span-8 space-y-12">
          {matched.map((r) => {
            const uids = r.matched.map((n) => n.uid);
            const dls = deadlinesFor(uids);
            return (
              <ResultArticle key={r.parsed.title} parsed={r.parsed} deadlines={dls} />
            );
          })}

          {/* マッチしなかった公演 */}
          {unmatched.length > 0 && (
            <div className="opacity-50">
              <div className="border-b border-outline-variant pb-2 mb-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline">
                  Not Found ({unmatched.length})
                </span>
              </div>
              <p className="text-xs text-outline-variant mb-3">
                データに見つからない公演、または締切がすべて終了した公演です。
              </p>
              {unmatched.map((r) => (
                <p key={r.parsed.title} className="text-sm text-on-surface-variant py-2 border-b border-outline-variant/20">
                  {r.parsed.status} — {r.parsed.title}
                </p>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ResultArticle({
  parsed,
  deadlines,
}: {
  parsed: ParsedApplication;
  deadlines: Deadline[];
}) {
  const isRejected = parsed.status.includes("落選");
  const isCompleted = parsed.status.includes("入金済") || parsed.status.includes("当選");
  const hasFutureDeadlines = deadlines.length > 0;

  const borderClass = isRejected
    ? "border-outline-variant"
    : hasFutureDeadlines
    ? "border-primary border-b-2"
    : "border-outline-variant";

  return (
    <article className={`relative ${isCompleted && !hasFutureDeadlines ? "opacity-60" : ""}`}>
      <div className={`flex justify-between items-baseline border-b pb-2 ${borderClass}`}>
        <h3 className={`text-xl font-black tracking-tight ${isRejected ? "text-on-surface-variant" : ""}`}>
          {parsed.title.length > 40 ? parsed.title.slice(0, 40) + "…" : parsed.title}
        </h3>
        <StatusBadge status={parsed.status} hasFuture={hasFutureDeadlines} />
      </div>

      {hasFutureDeadlines ? (
        <div className="mt-6 space-y-4">
          {deadlines.map((dl) => (
            <DeadlineRow key={dl.id} dl={dl} />
          ))}
        </div>
      ) : (
        <div className="mt-4 text-sm text-on-surface-variant">
          {isRejected ? (
            <p>落選しました。次回の募集をお待ちください。</p>
          ) : (
            <p>今後の締切はありません。</p>
          )}
        </div>
      )}
    </article>
  );
}

// ─── カレンダー追加ボタン（サービス選択ドロップダウン） ────────────────────

function AddToCalendarButton({
  event,
  urgent = false,
}: {
  event: IcsEvent;
  urgent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  function handleToggle() {
    if (!open && ref.current) {
      // ボタン上部に150px以上スペースがあれば上展開、なければ下展開
      const rect = ref.current.getBoundingClientRect();
      setDropUp(rect.top > 150);
    }
    setOpen((v) => !v);
  }

  function handleGoogle() {
    window.open(generateGoogleCalendarUrl(event), "_blank", "noopener");
    setOpen(false);
  }

  function handleYahoo() {
    window.open(generateYahooCalendarUrl(event), "_blank", "noopener");
    setOpen(false);
  }

  function handleIcs() {
    const ics = generateIcs(event);
    downloadIcs(ics, "fc-" + event.uid.slice(0, 8) + ".ics");
    setOpen(false);
  }

  const menuItem = "w-full px-4 py-2.5 text-left text-xs font-bold hover:bg-surface-container flex items-center gap-2 cursor-pointer whitespace-nowrap";
  const menuPos = dropUp ? "bottom-full mb-1" : "top-full mt-1";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleToggle}
        className={`flex items-center justify-center gap-2 px-6 py-3 text-xs font-bold uppercase tracking-widest transition-colors cursor-pointer ${
          urgent
            ? "bg-white text-primary hover:bg-surface-container-low"
            : "bg-primary text-on-primary-fixed hover:bg-secondary"
        }`}
      >
        <span className="material-symbols-outlined text-sm">calendar_add_on</span>
        カレンダーに追加
      </button>
      {open && (
        <div className={`absolute right-0 ${menuPos} z-20 bg-surface-container-lowest border border-outline-variant shadow-lg min-w-[11rem]`}>
          <button onClick={handleGoogle} className={menuItem}>
            <span className="material-symbols-outlined text-sm">open_in_new</span>
            Google カレンダー
          </button>
          <div className="border-t border-outline-variant" />
          <button onClick={handleYahoo} className={menuItem}>
            <span className="material-symbols-outlined text-sm">open_in_new</span>
            Yahoo! カレンダー
          </button>
          <div className="border-t border-outline-variant" />
          <button onClick={handleIcs} className={menuItem}>
            <span className="material-symbols-outlined text-sm">download</span>
            Apple / その他
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, hasFuture }: { status: string; hasFuture: boolean }) {
  if (status.includes("落選"))
    return <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline">Rejected</span>;
  if (status.includes("入金済"))
    return <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline">Completed</span>;
  if (hasFuture)
    return (
      <span className="text-[0.6875rem] font-bold uppercase tracking-widest bg-primary text-on-primary-fixed px-2 py-1">
        Action Required
      </span>
    );
  return <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline">{status}</span>;
}

function DeadlineRow({ dl }: { dl: Deadline }) {
  const deadline = new Date(dl.deadline_at);
  const now = new Date();
  const diffDays = (deadline.getTime() - now.getTime()) / 86400000;
  const isUrgent = diffDays < 1;

  const calEvent: IcsEvent = {
    uid: dl.id + "@hop-up-tools",
    summary: dl.fc_news.title + "【" + dl.label + "】",
    description: dl.fc_news.detail_url,
    dtstart: new Date(deadline.getTime() - 3600000),
    dtend: deadline,
  };

  const dateStr = deadline.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
  const timeStr = deadline.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className={`p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
        isUrgent
          ? "bg-tertiary-container text-on-tertiary-container"
          : "bg-surface-container-low"
      }`}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {isUrgent && (
            <span className="bg-tertiary text-on-tertiary-container text-[0.625rem] font-bold px-2 py-0.5 uppercase tracking-tighter">
              Today
            </span>
          )}
          <span className={`text-[0.6875rem] font-bold uppercase tracking-widest ${isUrgent ? "opacity-80" : "text-outline"}`}>
            {TYPE_LABEL_EN[dl.type] ?? dl.label}
          </span>
        </div>
        <p className={`text-2xl font-black tracking-tighter ${isUrgent ? "" : "text-on-surface"}`}>
          {dl.label} {dateStr} {timeStr}
        </p>
      </div>
      <AddToCalendarButton event={calEvent} urgent={isUrgent} />
    </div>
  );
}

// ─── 画面C: カレンダー ────────────────────────────────────

function CalendarScreen({
  allDeadlines,
  allNews,
  watchlist,
  onWatchlistChange,
  matchedUids,
}: {
  allDeadlines: Deadline[];
  allNews: FcNewsRow[];
  watchlist: string[];
  onWatchlistChange: (uids: string[]) => void;
  matchedUids: Set<string>;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // centerDate: スクロール連動（月ヘッダー・サマリー・タイムラインに反映）
  const [centerDate, setCenterDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  // selectedDate: クリック連動（選択日の詳細パネル）
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const [calFilter, setCalFilter] = useState<"all" | "mine">("all");
  const [watchlistSearch, setWatchlistSearch] = useState("");
  const [watchlistGroups, setWatchlistGroups] = useState<string[]>([]);
  const [pendingCalendarUid, setPendingCalendarUid] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const year = centerDate.getFullYear();
  const month = centerDate.getMonth();

  const stripRef = useRef<HTMLDivElement>(null);
  const DOW_JA = ["日", "月", "火", "水", "木", "金", "土"];
  const CELL_WIDTH = 48; // 44px幅 + 4px gap

  // 日付ストリップ: today-30〜today+90
  const stripDates: Date[] = [];
  for (let i = -30; i <= 90; i++) {
    stripDates.push(new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  }
  const STRIP_TODAY_IDX = 30;

  // 今日にスクロール（初回マウント時）
  useEffect(() => {
    if (!stripRef.current) return;
    const containerWidth = stripRef.current.clientWidth;
    stripRef.current.scrollLeft = STRIP_TODAY_IDX * CELL_WIDTH - containerWidth / 2 + CELL_WIDTH / 2;
  }, []);

  // スクロール連動: 中心付近の日付でcenterDateを更新
  function handleStripScroll() {
    if (!stripRef.current) return;
    const { scrollLeft, clientWidth } = stripRef.current;
    const PADDING = 16;
    const idx = Math.round((scrollLeft + clientWidth / 2 - PADDING - CELL_WIDTH / 2) / CELL_WIDTH);
    const clamped = Math.max(0, Math.min(stripDates.length - 1, idx));
    const d = stripDates[clamped];
    if (d.getFullYear() !== centerDate.getFullYear() || d.getMonth() !== centerDate.getMonth()) {
      setCenterDate(d);
    }
  }

  const watchlistSet = new Set(watchlist);

  // apply_end 締切日マップ（気になるセクション用）
  const applyEndByUid = new Map<string, Date>();
  for (const dl of allDeadlines) {
    if (dl.type === "apply_end") applyEndByUid.set(dl.news_uid, new Date(dl.deadline_at));
  }

  // watchlist トグル
  function toggleWatchlist(uid: string) {
    if (watchlistSet.has(uid)) {
      onWatchlistChange(watchlist.filter((u) => u !== uid));
      if (pendingCalendarUid === uid) setPendingCalendarUid(null);
    } else {
      onWatchlistChange([...watchlist, uid]);
      setPendingCalendarUid(uid); // 追加時にカレンダー登録を提案
    }
  }

  // フィルター適用済み締切リスト
  const filteredDeadlines =
    calFilter === "mine"
      ? allDeadlines.filter((dl) => matchedUids.has(dl.news_uid) || watchlistSet.has(dl.news_uid))
      : allDeadlines;

  // 締切の種別（ドット色分け用）
  function deadlineKind(dl: Deadline): "applied" | "watchlist" | "other" {
    if (matchedUids.has(dl.news_uid)) return "applied";
    if (watchlistSet.has(dl.news_uid)) return "watchlist";
    return "other";
  }

  function dotColor(dl: Deadline): string {
    const kind = deadlineKind(dl);
    if (kind === "applied") return typeColor(dl.type);
    if (kind === "watchlist") return "#9e3a3a";
    return "#c6c6c6";
  }

  // ─── Gantt 期間構築 ───────────────────────────────────────
  const ganttPeriods: GanttPeriod[] = (() => {
    const grouped = new Map<string, Record<string, Date>>();
    for (const dl of filteredDeadlines) {
      if (!grouped.has(dl.news_uid)) grouped.set(dl.news_uid, {});
      grouped.get(dl.news_uid)![dl.type] = new Date(dl.deadline_at);
    }
    const periods: GanttPeriod[] = [];
    for (const [uid, dates] of grouped) {
      const kind: GanttPeriod["kind"] = matchedUids.has(uid) ? "applied"
        : watchlistSet.has(uid) ? "watchlist" : "other";
      if (dates.apply_end) {
        const applyStart = dates.apply_start ?? new Date(dates.apply_end.getTime() - 7 * 86400000);
        periods.push({ newsUid: uid, start: applyStart, end: dates.apply_end, type: "apply", color: "#6b9ed2", kind });
      }
      if (dates.payment) {
        periods.push({ newsUid: uid, start: dates.payment, end: dates.payment, type: "payment", color: "#d4863a", kind });
      }
      if (dates.sale_end) {
        periods.push({ newsUid: uid, start: dates.sale_start ?? dates.sale_end, end: dates.sale_end, type: "sale", color: "#4aaa88", kind });
      }
    }
    return periods;
  })();

  // 日付ごとの締切マップ（月サマリー用: 現在月のみ）
  const byDate: Record<string, Deadline[]> = {};
  for (const dl of filteredDeadlines) {
    const d = new Date(dl.deadline_at);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const key = d.getDate().toString();
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(dl);
  }

  // 全期間の日付→締切マップ（ストリップのドット用）
  const allByDate = new Map<string, Deadline[]>();
  for (const dl of filteredDeadlines) {
    const d = new Date(dl.deadline_at);
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!allByDate.has(k)) allByDate.set(k, []);
    allByDate.get(k)!.push(dl);
  }
  function stripDateKey(d: Date) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

  const selectedDeadlines = selectedDate
    ? filteredDeadlines.filter((dl) => isSameDay(new Date(dl.deadline_at), selectedDate))
    : [];

  // 月の締切件数
  const totalThisMonth = Object.values(byDate).reduce((s, arr) => s + arr.length, 0);
  const urgentThisMonth = Object.values(byDate)
    .flat()
    .filter((dl) => {
      const diff = (new Date(dl.deadline_at).getTime() - today.getTime()) / 86400000;
      return diff >= 0 && diff < 3;
    }).length;

  const newsMap = new Map(allNews.map((n) => [n.uid, n]));

  // 気になる公演候補（申込締切がある公演 or すでにwatchlist済み）
  const watchlistCandidates = allNews.filter(
    (n) => watchlistSet.has(n.uid) || applyEndByUid.has(n.uid)
  );

  const availableGroups = GROUP_KEYS.filter((g) =>
    watchlistCandidates.some((n) => titleMatchesGroup(n.title, g))
  );

  const filteredCandidates = watchlistCandidates.filter((n) => {
    if (watchlistSearch && !n.title.includes(watchlistSearch)) return false;
    if (watchlistGroups.length > 0 && !watchlistGroups.some((key) => {
      const g = GROUP_KEYS.find((x) => x.key === key);
      return g ? titleMatchesGroup(n.title, g) : false;
    })) return false;
    return true;
  });

  return (
    <main className="max-w-4xl mx-auto px-4 md:px-0 pb-8">
      {/* 月ヘッダー + フィルタートグル */}
      <section className="mb-8">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-5xl font-black tracking-tighter leading-none">
            {MONTH_EN[month]}
          </h2>
          <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline">{year}</span>
        </div>

        {/* フィルタートグル */}
        <div className="flex gap-px mb-4">
          {(["all", "mine"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setCalFilter(f)}
              className={`px-4 py-2 text-[0.6875rem] font-bold uppercase tracking-widest cursor-pointer transition-colors ${
                calFilter === f
                  ? "bg-primary text-on-primary-fixed"
                  : "bg-surface-container text-outline hover:bg-surface-container-high"
              }`}
            >
              {f === "all" ? "すべて" : "気になる + 申込済み"}
            </button>
          ))}
        </div>

        {/* ドット凡例 */}
        <div className="flex items-center gap-4 mb-3 text-[0.625rem] text-outline uppercase tracking-widest">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-primary inline-block" />申込済み
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#9e3a3a" }} />気になる
          </span>
          {calFilter === "all" && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-outline-variant inline-block" />その他
            </span>
          )}
        </div>

        {/* 統合スクロール: 日付ヘッダー + ガントバー */}
        <div
          ref={stripRef}
          onScroll={handleStripScroll}
          style={{
            overflowX: "auto",
            margin: "0 -16px",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          } as React.CSSProperties}
        >
          {(() => {
            const TOTAL_DAYS = stripDates.length; // 121
            const contentWidth = TOTAL_DAYS * CELL_WIDTH + 32; // +32 for 16px padding each side
            const stripStart = stripDates[0].getTime();
            const MS_PER_DAY = 86400000;

            // ガントバー: apply期間のみ、今日以降に締切があるもの
            const gantRows = ganttPeriods
              .filter((p) => p.type === "apply" && p.end.getTime() >= today.getTime() && p.start.getTime() <= stripDates[TOTAL_DAYS - 1].getTime() + MS_PER_DAY)
              .sort((a, b) => a.end.getTime() - b.end.getTime());

            // 今日ラインのx座標（padding込み）
            const todayLineX = 16 + 30 * CELL_WIDTH + CELL_WIDTH / 2;

            return (
              <div style={{ width: contentWidth, padding: "4px 16px 0" }}>
                {/* 日付ヘッダー行 */}
                <div style={{ display: "flex", gap: 4 }}>
                  {stripDates.map((d, idx) => {
                    const isToday = isSameDay(d, today);
                    const isSelected = selectedDate ? isSameDay(d, selectedDate) : false;
                    const dow = d.getDay();
                    const dayDls = allByDate.get(stripDateKey(d)) ?? [];
                    const isMonthStart = d.getDate() === 1;

                    return (
                      <div key={idx} style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", width: 44 }}>
                        {isMonthStart ? (
                          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.1em", color: "#9e3a3a", marginBottom: 2, textTransform: "uppercase" }}>
                            {MONTH_EN[d.getMonth()].replace(".", "")}
                          </div>
                        ) : (
                          <div style={{ height: 14 }} />
                        )}
                        <div
                          onClick={() => setSelectedDate(isSelected ? null : d)}
                          style={{
                            width: 44,
                            padding: "4px 0",
                            textAlign: "center",
                            cursor: "pointer",
                            borderRadius: 8,
                            background: isSelected ? "#9e3a3a" : isToday ? "rgba(158,58,58,0.12)" : "transparent",
                            userSelect: "none",
                          }}
                        >
                          <div style={{ fontSize: 9, fontWeight: 700, marginBottom: 1, color: isSelected ? "rgba(255,255,255,0.75)" : dow === 0 ? "#d96b6b" : dow === 6 ? "#6b9ed2" : "#999" }}>
                            {DOW_JA[dow]}
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1, color: isSelected ? "#fff" : dow === 0 ? "#d96b6b" : dow === 6 ? "#6b9ed2" : undefined }}>
                            {d.getDate()}
                          </div>
                          <div style={{ height: 10, display: "flex", justifyContent: "center", alignItems: "center", gap: 2, marginTop: 2 }}>
                            {dayDls.slice(0, 3).map((dl, j) => (
                              <div key={j} style={{ width: 3, height: 3, borderRadius: "50%", flexShrink: 0, background: isSelected ? "rgba(255,255,255,0.7)" : dotColor(dl) }} />
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ガントバーエリア */}
                <div style={{ position: "relative", paddingTop: 8, paddingBottom: 12 }}>
                  {/* 区切り線 */}
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "rgba(0,0,0,0.06)" }} />

                  {/* 今日ライン */}
                  <div style={{
                    position: "absolute",
                    left: todayLineX - 16, // paddingを引いてrelative内の座標に
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: "#9e3a3a",
                    opacity: 0.35,
                    pointerEvents: "none",
                  }} />

                  {gantRows.length === 0 ? (
                    <div style={{ height: 32, display: "flex", alignItems: "center", fontSize: 10, color: "#bbb" }}>
                      申込期間データなし
                    </div>
                  ) : (
                    gantRows.map((p) => {
                      const news = newsMap.get(p.newsUid);
                      const title = news?.title ?? "";
                      const D_start = Math.floor((p.start.getTime() - stripStart) / MS_PER_DAY);
                      const D_end = Math.floor((p.end.getTime() - stripStart) / MS_PER_DAY);
                      const rawLeft = D_start * CELL_WIDTH;
                      const rawRight = D_end * CELL_WIDTH + CELL_WIDTH;
                      const left = Math.max(0, rawLeft);
                      const right = Math.min(TOTAL_DAYS * CELL_WIDTH, rawRight);
                      const width = Math.max(CELL_WIDTH / 2, right - left);
                      const barColor = p.kind === "applied" ? "#374151" : p.kind === "watchlist" ? "#9e3a3a" : "#9ca3af";
                      const opacity = p.kind === "other" ? 0.4 : 1;

                      return (
                        <div key={p.newsUid} style={{ height: 28, position: "relative" }}>
                          <div style={{
                            position: "absolute",
                            left,
                            width,
                            top: 4,
                            height: 20,
                            borderRadius: 9999,
                            background: barColor,
                            opacity,
                            display: "flex",
                            alignItems: "center",
                            paddingLeft: 8,
                            paddingRight: 4,
                            overflow: "hidden",
                            boxSizing: "border-box",
                          }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.95)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
                              {title}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </section>

      {/* 選択日の詳細 */}
      {selectedDeadlines.length > 0 && (
        <section className="mb-12">
          <header className="flex items-center gap-4 mb-6">
            <div className="h-10 w-1 bg-primary" />
            <div>
              <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline">
                Selected Date
              </span>
              <h3 className="text-xl font-bold uppercase leading-none">
                {selectedDate && `${MONTH_EN[selectedDate.getMonth()].replace(".", "")} ${selectedDate.getDate()}, ${selectedDate.getFullYear()}`}
              </h3>
            </div>
          </header>
          <div className="flex flex-col gap-6">
            {selectedDeadlines.map((dl) => (
              <CalendarDeadlineCard key={dl.id} dl={dl} />
            ))}
          </div>
        </section>
      )}

      {/* Monthly Summary */}
      <section className="mb-12 grid grid-cols-1 md:grid-cols-2 gap-px bg-outline-variant/20">
        <div className="bg-surface py-12 pr-12">
          <h3 className="text-[0.6875rem] font-bold uppercase tracking-[0.3em] mb-4 text-outline">
            Monthly Summary
          </h3>
          <div className="flex items-baseline gap-2">
            <span className="text-7xl font-black tracking-tighter">{totalThisMonth}</span>
            <span className="text-sm font-bold uppercase text-outline">Deadlines</span>
          </div>
        </div>
        <div className="bg-surface py-12 pl-12 flex flex-col justify-end">
          <div className="space-y-4">
            <div className="flex justify-between items-end">
              <span className="text-[0.625rem] font-bold uppercase">直近3日以内</span>
              <span className="text-xl font-bold">{urgentThisMonth}</span>
            </div>
            <div className="w-full h-1 bg-outline-variant/20">
              <div
                className="h-full bg-tertiary"
                style={{ width: totalThisMonth ? `${(urgentThisMonth / totalThisMonth) * 100}%` : "0%" }}
              />
            </div>
            <div className="flex justify-between items-end">
              <span className="text-[0.625rem] font-bold uppercase">Total</span>
              <span className="text-xl font-bold">{totalThisMonth}</span>
            </div>
            <div className="w-full h-1 bg-outline-variant/20">
              <div className="h-full bg-primary w-full" />
            </div>
          </div>
        </div>
      </section>


      {/* ─── 気になる公演 ─── */}
      <section className="mb-16">
        <header className="flex items-center gap-4 mb-6">
          <div className="h-10 w-1" style={{ background: "#9e3a3a" }} />
          <div>
            <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline">
              Watchlist
            </span>
            <h3 className="text-xl font-bold uppercase leading-none">気になる公演</h3>
          </div>
          {watchlist.length > 0 && (
            <div className="ml-auto flex items-center gap-4">
              <span className="text-[0.6875rem] font-bold text-outline uppercase tracking-widest">
                {watchlist.length} 件
              </span>
              <button
                onClick={() => setConfirmClearAll(true)}
                className="text-[0.6875rem] text-outline hover:text-tertiary uppercase tracking-widest cursor-pointer transition-colors"
              >
                すべて解除
              </button>
            </div>
          )}
        </header>

        {/* すべて解除 確認パネル */}
        {confirmClearAll && (
          <div className="mb-4 p-3 border border-error rounded-lg bg-error-container text-on-error-container text-sm flex flex-col gap-2">
            <p className="font-bold">気になるリストを全件削除しますか？</p>
            <div className="flex gap-2">
              <button
                onClick={() => { onWatchlistChange([]); setPendingCalendarUid(null); setConfirmClearAll(false); }}
                className="flex-1 py-2 text-xs font-bold bg-error text-on-error rounded cursor-pointer"
              >
                削除する
              </button>
              <button
                onClick={() => setConfirmClearAll(false)}
                className="flex-1 py-2 text-xs font-bold border border-outline-variant rounded cursor-pointer"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}

        {/* グループフィルター */}
        {availableGroups.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setWatchlistGroups([])}
              className={`px-3 py-1 text-[0.625rem] font-bold uppercase tracking-widest cursor-pointer transition-colors border ${
                watchlistGroups.length === 0
                  ? "bg-primary text-on-primary-fixed border-primary"
                  : "bg-transparent text-outline border-outline-variant hover:border-primary hover:text-primary"
              }`}
            >
              すべて
            </button>
            {availableGroups.map((g) => {
              const active = watchlistGroups.includes(g.key);
              return (
                <button
                  key={g.key}
                  onClick={() =>
                    setWatchlistGroups(
                      active
                        ? watchlistGroups.filter((k) => k !== g.key)
                        : [...watchlistGroups, g.key]
                    )
                  }
                  className={`px-3 py-1 text-[0.625rem] font-bold uppercase tracking-widest cursor-pointer transition-colors border ${
                    active
                      ? "border-transparent text-on-primary-fixed"
                      : "bg-transparent text-outline border-outline-variant hover:border-primary hover:text-primary"
                  }`}
                  style={active ? { background: "#9e3a3a", borderColor: "#9e3a3a" } : {}}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
        )}

        {/* 検索 */}
        <div className="mb-4 flex items-center gap-2 border-b border-outline-variant pb-2">
          <span className="material-symbols-outlined text-outline text-lg">search</span>
          <input
            type="text"
            placeholder="公演名で検索…"
            value={watchlistSearch}
            onChange={(e) => setWatchlistSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-outline-variant"
          />
          {watchlistSearch && (
            <button onClick={() => setWatchlistSearch("")} className="material-symbols-outlined text-outline text-sm cursor-pointer">
              close
            </button>
          )}
        </div>

        {/* リスト */}
        {filteredCandidates.length === 0 ? (
          <p className="text-sm text-outline py-8 text-center">
            {watchlistSearch ? "該当なし" : "申込受付中の公演はありません"}
          </p>
        ) : (
          <div className="flex flex-col gap-px">
            {filteredCandidates.map((news) => {
              const applyEnd = applyEndByUid.get(news.uid);
              const isWatched = watchlistSet.has(news.uid);
              const isPending = pendingCalendarUid === news.uid;
              const applyEndStr = applyEnd
                ? applyEnd.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }) +
                  " " + applyEnd.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
                : null;
              const calEvent: IcsEvent | null = applyEnd ? {
                uid: news.uid + "@hop-up-tools-watchlist",
                summary: news.title + "【申込締切】",
                description: news.detail_url,
                dtstart: new Date(applyEnd.getTime() - 3600000),
                dtend: applyEnd,
              } : null;
              return (
                <div key={news.uid}>
                  <div className={`flex items-center gap-4 px-4 py-4 ${isWatched ? "bg-surface-container" : "bg-surface-container-low"}`}>
                    <button
                      onClick={() => toggleWatchlist(news.uid)}
                      className="material-symbols-outlined text-xl cursor-pointer transition-colors flex-shrink-0"
                      style={{ color: isWatched ? "#9e3a3a" : "#c6c6c6", fontVariationSettings: `'FILL' ${isWatched ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24` }}
                      title={isWatched ? "気になるから削除" : "気になるに追加"}
                    >
                      bookmark
                    </button>
                    <div className="flex-1 min-w-0">
                      <a
                        href={news.detail_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-bold leading-tight hover:underline block truncate"
                      >
                        {news.title}
                      </a>
                      {applyEndStr && (
                        <p className="text-xs text-outline mt-0.5">
                          申込締切 {applyEndStr}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* 追加直後のカレンダー登録提案 */}
                  {isPending && calEvent && (
                    <div className="flex items-center gap-3 px-4 py-3 bg-surface-container-high border-l-2 flex-wrap" style={{ borderColor: "#9e3a3a" }}>
                      <span className="material-symbols-outlined text-sm flex-shrink-0" style={{ color: "#9e3a3a" }}>calendar_add_on</span>
                      <span className="text-xs font-bold flex-1">申込期日をカレンダーに登録しますか？</span>
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => { window.open(generateGoogleCalendarUrl(calEvent), "_blank", "noopener"); setPendingCalendarUid(null); }}
                          className="px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:bg-secondary cursor-pointer transition-colors"
                        >Google</button>
                        <button
                          onClick={() => { window.open(generateYahooCalendarUrl(calEvent), "_blank", "noopener"); setPendingCalendarUid(null); }}
                          className="px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:bg-secondary cursor-pointer transition-colors"
                        >Yahoo!</button>
                        <button
                          onClick={() => { const ics = generateIcs(calEvent); downloadIcs(ics, "fc-watchlist-" + news.uid.slice(0, 8) + ".ics"); setPendingCalendarUid(null); }}
                          className="px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-widest bg-primary text-on-primary-fixed hover:bg-secondary cursor-pointer transition-colors"
                        >Apple / その他</button>
                        <button
                          onClick={() => setPendingCalendarUid(null)}
                          className="px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-widest text-outline hover:text-primary cursor-pointer transition-colors"
                        >スキップ</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function CalendarDeadlineCard({ dl }: { dl: Deadline }) {
  const deadline = new Date(dl.deadline_at);
  const now = new Date();
  const diffDays = (deadline.getTime() - now.getTime()) / 86400000;
  const isUrgent = diffDays < 1;

  const calEvent: IcsEvent = {
    uid: dl.id + "@hop-up-tools",
    summary: dl.fc_news.title + "【" + dl.label + "】",
    description: dl.fc_news.detail_url,
    dtstart: new Date(deadline.getTime() - 3600000),
    dtend: deadline,
  };

  const timeStr = deadline.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`p-6 border-l-4 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface-container-lowest ${isUrgent ? "border-tertiary" : "border-primary"}`}>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {isUrgent && (
            <span className="bg-tertiary-container text-on-tertiary-container text-[0.625rem] font-bold px-2 py-0.5 uppercase tracking-tighter">
              Today
            </span>
          )}
          <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline">
            {TYPE_LABEL_EN[dl.type] ?? dl.label}
          </span>
          <span className="text-[0.6875rem] text-outline">{timeStr}</span>
        </div>
        <h4 className="text-base font-bold leading-tight">
          <a
            href={dl.fc_news.detail_url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {dl.fc_news.title.length > 50
              ? dl.fc_news.title.slice(0, 50) + "…"
              : dl.fc_news.title}
          </a>
        </h4>
        <p className="text-xs text-on-surface-variant">{dl.fc_news.category}</p>
      </div>
      <div className="flex items-center gap-3">
        <AddToCalendarButton event={calEvent} />
      </div>
    </div>
  );
}

// ─── ボトムナビ ───────────────────────────────────────────

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: { t: Tab; icon: string; label: string }[] = [
    { t: "input",    icon: "add_box",        label: "Input" },
    { t: "result",   icon: "analytics",      label: "Result" },
    { t: "calendar", icon: "calendar_today", label: "Calendar" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 py-3 bg-surface border-t border-outline-variant/20">
      {items.map(({ t, icon, label }) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          className={`flex flex-col items-center justify-center transition-all cursor-pointer active:scale-95 ${
            tab === t ? "text-primary scale-110" : "text-outline opacity-60 hover:text-primary"
          }`}
        >
          <span
            className="material-symbols-outlined mb-1"
            style={{ fontVariationSettings: tab === t ? "'FILL' 1" : "'FILL' 0" }}
          >
            {icon}
          </span>
          <span className="text-[0.6875rem] font-bold uppercase tracking-widest">{label}</span>
        </button>
      ))}
    </nav>
  );
}

// ─── ユーティリティ ───────────────────────────────────────

function typeColor(type: string): string {
  const map: Record<string, string> = {
    apply_start: "#6b9ed2", // くすみブルー
    apply_end:   "#d96b6b", // くすみレッド
    payment:     "#d4863a", // くすみオレンジ
    sale_start:  "#4aaa88", // くすみグリーン
    sale_end:    "#9ca3af", // スレートグレー
  };
  return map[type] ?? "#9ca3af";
}
