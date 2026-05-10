import { useEffect, useRef, useState } from "react";
import UpfcDummyPreview from "./UpfcDummyPreview";
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

  const [tab, setTab] = useState<Tab>("calendar");
  const [pasteText, setPasteText] = useState<string>(() => {
    try { return localStorage.getItem("fc-input-text") ?? ""; }
    catch { return ""; }
  });
  const [allNews, setAllNews] = useState<FcNewsRow[]>([]);
  const [allDeadlines, setAllDeadlines] = useState<Deadline[]>([]);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [watchlist, setWatchlistState] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("fc-watchlist") ?? "[]"); }
    catch { return []; }
  });
  const [applied, setAppliedState] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("fc-applied") ?? "[]"); }
    catch { return []; }
  });
  const [paid, setPaidState] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("fc-paid") ?? "[]"); }
    catch { return []; }
  });

  const matchedUids = new Set(matchResults.flatMap((r) => r.matched.map((m) => m.uid)));

  function setWatchlist(uids: string[]) {
    setWatchlistState(uids);
    localStorage.setItem("fc-watchlist", JSON.stringify(uids));
  }
  function setApplied(uids: string[]) {
    setAppliedState(uids);
    localStorage.setItem("fc-applied", JSON.stringify(uids));
  }
  function setPaid(uids: string[]) {
    setPaidState(uids);
    localStorage.setItem("fc-paid", JSON.stringify(uids));
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
    }).catch(() => {
      setFetchError(true);
      setLoading(false);
    });
  }, []);

  // allNews ロード完了後、保存済み入力テキストがあれば自動パース
  useEffect(() => {
    if (allNews.length === 0 || !pasteText.trim()) return;
    const parsed = parseUpfcText(pasteText);
    setMatchResults(matchApplications(parsed, allNews));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allNews]);

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

      {/* 注意書きバナー */}
      <div className="w-full bg-surface-container-low border-b border-outline-variant/20 px-6 py-2 text-center text-[0.625rem] text-outline tracking-wide">
        β版・非公式ツールです。自己責任でご利用ください。バグや不具合は
        <a href="https://x.com/hop_rabbit_hop" target="_blank" rel="noopener noreferrer" className="underline text-primary ml-1">@hop_rabbit</a>
        まで。
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-outline text-xs uppercase tracking-widest">
          Loading...
        </div>
      ) : fetchError ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-sm text-on-surface">データ取得に失敗しました</p>
          <button
            onClick={() => window.location.reload()}
            className="text-xs uppercase tracking-widest text-primary border border-primary px-6 py-2 hover:bg-primary hover:text-on-primary transition-colors cursor-pointer"
          >
            再読み込み
          </button>
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
              applied={applied}
              onAppliedChange={setApplied}
              paid={paid}
              onPaidChange={setPaid}
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
            data-demo-id={t === 'calendar' ? 'nav-calendar' : undefined}
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
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <>
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
              className="text-xs font-bold underline decoration-1 underline-offset-4 hover:text-primary transition-colors"
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
            <div className="flex items-center gap-2 mb-4">
              <label className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline">
                Source Data
              </label>
              <button
                type="button"
                data-demo-id="help-btn"
                onClick={() => setHelpOpen(true)}
                className="w-5 h-5 rounded-full border border-outline text-outline text-[0.625rem] font-bold leading-none flex items-center justify-center hover:border-primary hover:text-primary transition-colors cursor-pointer"
                aria-label="コピー範囲の説明を見る"
              >
                ?
              </button>
            </div>
            <textarea
              data-demo-id="upfc-textarea"
              className="w-full h-64 bg-transparent border-b border-outline-variant/40 py-4 text-sm resize-none focus:outline-none focus:border-b-2 focus:border-primary transition-all placeholder:italic placeholder:text-outline/50"
              placeholder="UPFCのチケット申込状況をコピペしてください"
              value={pasteText}
              onChange={(e) => {
                setPasteText(e.target.value);
                try { localStorage.setItem("fc-input-text", e.target.value); } catch { /* ignore */ }
              }}
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
              data-demo-id="analyze-btn"
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
            <p className="text-[0.625rem] text-outline-variant">
              ※ チケット申込にはHello! Projectオフィシャルファンクラブへの加入が必要です
            </p>
          </div>
        </div>
      </div>
    </main>

    {/* ヘルプモーダル */}
    {helpOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
        onClick={() => setHelpOpen(false)}
      >
        <div
          className="bg-surface-container-lowest w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-sm shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
            <h2 className="text-sm font-bold uppercase tracking-widest">コピー範囲の説明</h2>
            <button
              type="button"
              data-demo-id="help-close-btn"
              onClick={() => setHelpOpen(false)}
              className="text-outline hover:text-primary transition-colors cursor-pointer"
              aria-label="閉じる"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
          <div className="px-6 py-6 flex flex-col gap-6">
            <p className="text-sm leading-relaxed text-on-surface-variant">
              Hello! Projectオフィシャルファンクラブにログイン後、マイページの「チケット申込状況」を開き、下のピンクの枠内をすべて選択してコピーしてください。
            </p>
            <ol className="text-xs text-on-surface-variant flex flex-col gap-1 list-decimal list-inside">
              <li>Hello! Projectオフィシャルファンクラブにログインしてマイページを開く</li>
              <li>「チケット申込状況」タブをクリック</li>
              <li>公演リストの最初から最後までを選択</li>
              <li>コピーしてテキストエリアにペースト<br /><span className="text-outline">PC: Ctrl+C / ⌘C　スマホ: 長押し→「コピー」</span></li>
            </ol>
            <UpfcDummyPreview />
            <p className="text-[0.6875rem] text-outline italic">
              ※ コピーした内容はこのブラウザ内でのみ処理されます。サーバーには送信されません。
            </p>
          </div>
        </div>
      </div>
    )}
    </>
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
      return diff >= 0 && diff < 3;
    });
  }).length;

  if (matchResults.length === 0) {
    return (
      <main className="px-6 py-16 max-w-4xl mx-auto text-center">
        <p className="text-outline text-sm uppercase tracking-widest mb-6">
          まだ結果がありません
        </p>
        <button onClick={onBack} className="text-[0.6875rem] font-bold uppercase tracking-widest underline hover:text-primary transition-colors cursor-pointer">
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
              <div className="border-b border-outline-variant/20 pb-2 mb-2">
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
          {parsed.title}
        </h3>
        <StatusBadge status={parsed.status} hasFuture={hasFutureDeadlines} />
      </div>

      {hasFutureDeadlines ? (
        <div className="mt-6 space-y-6">
          {Object.entries(
            deadlines.reduce<Record<string, Deadline[]>>((acc, dl) => {
              (acc[dl.news_uid] ??= []).push(dl);
              return acc;
            }, {})
          ).map(([uid, dls]) => (
            <div key={uid}>
              {/* 複数記事にまたがる場合のみサブヘッダーを表示 */}
              {new Set(deadlines.map((d) => d.news_uid)).size > 1 && (
                <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-2 px-1">
                  {dls[0].fc_news.title.replace(/[『』「」【】〔〕]/g, "").replace(/のお知らせ.*$/, "").replace(/^.+?(FC|先行)/, "$1")}
                </p>
              )}
              <div className="space-y-4">
                {dls.map((dl, idx) => (
                  <DeadlineRow key={dl.id} dl={dl} paidUp={isCompleted && dl.type === "payment"} isFirst={idx === 0} />
                ))}
              </div>
            </div>
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
  past = false,
  demoid,
}: {
  event: IcsEvent;
  urgent?: boolean;
  past?: boolean;
  demoid?: string;
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
        data-demo-id={demoid}
        className={`flex items-center justify-center gap-2 px-6 py-3 text-xs font-bold uppercase tracking-widest transition-colors cursor-pointer ${
          past
            ? "bg-surface-container text-outline hover:bg-surface-container-high"
            : urgent
            ? "bg-white text-primary hover:bg-surface-container-low"
            : "bg-primary text-on-primary-fixed hover:bg-secondary"
        }`}
      >
        <span className="material-symbols-outlined text-sm">calendar_add_on</span>
        カレンダーに追加
      </button>
      {open && (
        <div className={`absolute right-0 ${menuPos} z-20 bg-surface-container-lowest border border-primary min-w-[11rem] text-on-surface`}>
          <button onClick={handleGoogle} data-demo-id="google-cal-btn" className={menuItem}>
            <span className="material-symbols-outlined text-sm">open_in_new</span>
            Google カレンダー
          </button>
          <div className="border-t border-outline-variant/20" />
          <button onClick={handleYahoo} className={menuItem}>
            <span className="material-symbols-outlined text-sm">open_in_new</span>
            Yahoo! カレンダー
          </button>
          <div className="border-t border-outline-variant/20" />
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

function DeadlineRow({ dl, paidUp = false, isFirst = false }: { dl: Deadline; paidUp?: boolean; isFirst?: boolean }) {
  const deadline = new Date(dl.deadline_at);
  const now = new Date();
  const diffDays = (deadline.getTime() - now.getTime()) / 86400000;
  const isPast = diffDays < 0 || paidUp;
  const isUrgent = !paidUp && diffDays >= 0 && diffDays < 3;

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
        isPast
          ? "bg-surface-container-lowest opacity-50"
          : isUrgent
          ? "bg-tertiary-container text-on-tertiary-container"
          : "bg-surface-container-low"
      }`}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {isUrgent && (
            <span className="bg-tertiary text-on-tertiary-container text-[0.625rem] font-bold px-2 py-0.5 uppercase tracking-tighter">
              {diffDays < 1 ? "Today" : `${Math.ceil(diffDays)}日後`}
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
      <AddToCalendarButton event={calEvent} urgent={isUrgent} past={isPast} demoid={isFirst ? "add-calendar-btn" : undefined} />
    </div>
  );
}

// ─── 画面C: カレンダー ────────────────────────────────────

function CalendarScreen({
  allDeadlines,
  allNews,
  watchlist,
  onWatchlistChange,
  applied,
  onAppliedChange,
  paid,
  onPaidChange,
  matchedUids,
}: {
  allDeadlines: Deadline[];
  allNews: FcNewsRow[];
  watchlist: string[];
  onWatchlistChange: (uids: string[]) => void;
  applied: string[];
  onAppliedChange: (uids: string[]) => void;
  paid: string[];
  onPaidChange: (uids: string[]) => void;
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
  const [ganttGroupFilter, setGanttGroupFilter] = useState<string>("");
  const [watchlistSearch, setWatchlistSearch] = useState("");
  const [watchlistGroups, setWatchlistGroups] = useState<string[]>([]);
  const [pendingCalendarUid, setPendingCalendarUid] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [tooltipUid, setTooltipUid] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

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
    const initialScroll = STRIP_TODAY_IDX * CELL_WIDTH - containerWidth / 2 + CELL_WIDTH / 2;
    stripRef.current.scrollLeft = initialScroll;
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
  const appliedSet = new Set(applied);
  const paidSet = new Set(paid);

  function toggleApplied(uid: string) {
    if (appliedSet.has(uid)) {
      onAppliedChange(applied.filter((u) => u !== uid));
      // 申込解除したら入金済みも解除
      onPaidChange(paid.filter((u) => u !== uid));
    } else {
      onAppliedChange([...applied, uid]);
      // 申込時にwatchlistにも追加
      if (!watchlistSet.has(uid)) onWatchlistChange([...watchlist, uid]);
    }
  }

  function togglePaid(uid: string) {
    if (paidSet.has(uid)) {
      onPaidChange(paid.filter((u) => u !== uid));
    } else {
      onPaidChange([...paid, uid]);
    }
  }

  // apply_end 締切日マップ（気になるセクション用）
  const applyEndByUid = new Map<string, Date>();
  const paymentByUid = new Map<string, Date>();
  for (const dl of allDeadlines) {
    if (dl.type === "apply_end") applyEndByUid.set(dl.news_uid, new Date(dl.deadline_at));
    if (dl.type === "payment") paymentByUid.set(dl.news_uid, new Date(dl.deadline_at));
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
        periods.push({ newsUid: uid, start: applyStart, end: dates.apply_end, type: "apply", color: "#000000", kind });
      }
      if (dates.payment) {
        periods.push({ newsUid: uid, start: dates.payment, end: dates.payment, type: "payment", color: "#585f6c", kind });
      }
      if (dates.sale_end) {
        periods.push({ newsUid: uid, start: dates.sale_start ?? dates.sale_end, end: dates.sale_end, type: "sale", color: "#777777", kind });
      }
    }
    return periods;
  })();


  // 要対応締切のみ（apply_end / payment）— result・apply_start 等は件数に含めない
  const actionableTypes = new Set(["apply_end", "payment"]);
  const actionableDeadlines = filteredDeadlines.filter((dl) => actionableTypes.has(dl.type));

  const selectedDeadlines = selectedDate
    ? filteredDeadlines.filter((dl) => isSameDay(new Date(dl.deadline_at), selectedDate))
    : [];
  const selectedActionCount = selectedDate
    ? actionableDeadlines.filter((dl) => isSameDay(new Date(dl.deadline_at), selectedDate)).length
    : 0;

  // 本日の要対応締切（タイプ別）
  const todayActionable = actionableDeadlines.filter((dl) => isSameDay(new Date(dl.deadline_at), today));
  const todayPayment = todayActionable.filter((dl) => dl.type === "payment").length;
  const todayApply   = todayActionable.filter((dl) => dl.type === "apply_end").length;
  // 直近3日以内の要対応締切（Daily Summaryの大見出し用）
  const upcomingActionable = actionableDeadlines.filter((dl) => {
    const diff = (new Date(dl.deadline_at).getTime() - today.getTime()) / 86400000;
    return diff >= 0 && diff < 3;
  });
  const upcomingPayment = upcomingActionable.filter((dl) => dl.type === "payment").length;
  const upcomingApply   = upcomingActionable.filter((dl) => dl.type === "apply_end").length;
  // 直近3日以内の入金締切（申込済み・未入金のみ）
  const urgentPayment = filteredDeadlines.filter((dl) => {
    if (dl.type !== "payment") return false;
    if (!appliedSet.has(dl.news_uid)) return false;
    if (paidSet.has(dl.news_uid)) return false;
    const diff = (new Date(dl.deadline_at).getTime() - today.getTime()) / 86400000;
    return diff >= 0 && diff < 3;
  }).length;

  const newsMap = new Map(allNews.map((n) => [n.uid, n]));

  // Ganttツールチップ用: newsUid → 全締切種別
  const deadlinesByNewsUid = new Map<string, Record<string, Date>>();
  for (const dl of filteredDeadlines) {
    if (!deadlinesByNewsUid.has(dl.news_uid)) deadlinesByNewsUid.set(dl.news_uid, {});
    deadlinesByNewsUid.get(dl.news_uid)![dl.type] = new Date(dl.deadline_at);
  }
  // 入金バー開始日: payment_start → result → 申込締切日 の優先順
  const paymentStartByUid = new Map<string, Date>();
  const resultByUid = new Map<string, Date>();
  for (const dl of filteredDeadlines) {
    if (dl.type === "payment_start") paymentStartByUid.set(dl.news_uid, new Date(dl.deadline_at));
    if (dl.type === "result") resultByUid.set(dl.news_uid, new Date(dl.deadline_at));
  }

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
  }).sort((a, b) => {
    const now = new Date();
    const aPayment = paymentByUid.get(a.uid);
    const bPayment = paymentByUid.get(b.uid);
    const aApplyEnd = applyEndByUid.get(a.uid);
    const bApplyEnd = applyEndByUid.get(b.uid);
    const aExpired = !!(aApplyEnd && aApplyEnd < now);
    const bExpired = !!(bApplyEnd && bApplyEnd < now);

    // 入金待ち（申込済み・未入金・入金期限あり）を最優先
    const aUrgent = appliedSet.has(a.uid) && !paidSet.has(a.uid) && !!aPayment;
    const bUrgent = appliedSet.has(b.uid) && !paidSet.has(b.uid) && !!bPayment;
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;
    if (aUrgent && bUrgent) return aPayment!.getTime() - bPayment!.getTime();

    // 終了済みは末尾
    if (aExpired !== bExpired) return aExpired ? 1 : -1;

    // 申込受付中（申込締切が未来）を入金期間中（申込締切が過去）より上
    const aApplyFuture = !!(aApplyEnd && aApplyEnd > now);
    const bApplyFuture = !!(bApplyEnd && bApplyEnd > now);
    if (aApplyFuture !== bApplyFuture) return aApplyFuture ? -1 : 1;

    // 申込受付中同士は申込締切が近い順
    if (aApplyFuture && bApplyFuture) return aApplyEnd!.getTime() - bApplyEnd!.getTime();

    // 入金期間中同士は入金締切が近い順
    if (!aApplyFuture && !bApplyFuture) {
      if (!aPayment && !bPayment) return 0;
      if (!aPayment) return 1;
      if (!bPayment) return -1;
      return aPayment.getTime() - bPayment.getTime();
    }

    return 0;
  });

  // 完了・終了済み：最終締切（入金締切 or 申込締切）が過去のもの
  const now2 = new Date();
  const isDone = (uid: string) => {
    const lastDeadline = paymentByUid.get(uid) ?? applyEndByUid.get(uid);
    return !!(lastDeadline && lastDeadline < now2);
  };
  const activeCandidates = filteredCandidates.filter((n) => !isDone(n.uid));
  const doneCandidates   = filteredCandidates.filter((n) =>  isDone(n.uid)).sort((a, b) => {
    const aLast = (paymentByUid.get(a.uid) ?? applyEndByUid.get(a.uid))?.getTime() ?? 0;
    const bLast = (paymentByUid.get(b.uid) ?? applyEndByUid.get(b.uid))?.getTime() ?? 0;
    return bLast - aLast; // 直近に締切だったものが上
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

        {/* フィルター + 凡例エリア */}
        <div className="flex flex-col gap-2 mb-4">
          {/* 行1: すべて / 気になる+申込済み トグル + 凡例 */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-px">
              {(["all", "mine"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setCalFilter(f)}
                  className={`px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-widest cursor-pointer transition-colors ${
                    calFilter === f
                      ? "bg-primary text-on-primary-fixed"
                      : "bg-surface-container text-outline hover:bg-surface-container-high"
                  }`}
                >
                  {f === "all" ? "すべて" : "自分の公演のみ"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-[0.625rem] text-outline tracking-widest flex-wrap">
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-primary inline-block" />申込済み</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 inline-block" style={{ background: "#585f6c" }} />気になる</span>
              {calFilter === "all" && <span className="flex items-center gap-1"><span className="w-2 h-2 bg-outline-variant inline-block" />その他</span>}
              <span className="text-outline-variant">｜</span>
              <span className="flex items-center gap-1">
                <span className="w-5 h-2 inline-block bg-primary" style={{ opacity: 0.5 }} />
                <span className="text-[0.6875rem] font-bold uppercase tracking-widest">申込期間</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-5 h-2 inline-block overflow-hidden" style={{ backgroundColor: "#f8f9fa" }}>
                  <svg width="20" height="8" style={{ display: "block" }}>
                    {Array.from({ length: 5 }, (_, i) => {
                      const x = -8 + i * 8;
                      return <line key={i} x1={x} y1={8} x2={x + 8} y2={0} stroke="#585f6c" strokeWidth="1.5" />;
                    })}
                  </svg>
                </span>
                <span className="text-[0.6875rem] font-bold uppercase tracking-widest">入金期間</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-0.5 h-3 bg-secondary relative">
                  <span className="absolute -top-0.5 -left-0.5 w-2 h-2 bg-secondary inline-block" style={{ transform: "rotate(45deg)" }} />
                </span>
                <span className="text-[0.6875rem] font-bold uppercase tracking-widest ml-1.5">当落発表</span>
              </span>
              <span className="text-outline-variant">｜ バーをタップで詳細</span>
            </div>
          </div>
          {/* 行2: グループフィルター */}
          <div className="flex gap-1 flex-wrap">
            {GROUP_KEYS.filter((g) => !["CHICA#TETSU", "雨ノ森 川海", "SeasoningS"].includes(g.key) && allNews.some((n) => titleMatchesGroup(n.title, g))).map((g) => (
              <button
                key={g.key}
                onClick={() => setGanttGroupFilter(ganttGroupFilter === g.key ? "" : g.key)}
                className={`px-2 py-0.5 text-[0.625rem] font-bold tracking-wide cursor-pointer transition-colors border ${
                  ganttGroupFilter === g.key
                    ? "bg-primary text-on-primary-fixed border-primary"
                    : "bg-transparent text-outline border-outline-variant hover:border-primary hover:text-primary"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
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
              .filter((p) => {
                if (p.type !== "apply") return false;
                if (p.end.getTime() < today.getTime()) return false;
                if (p.start.getTime() > stripDates[TOTAL_DAYS - 1].getTime() + MS_PER_DAY) return false;
                if (ganttGroupFilter) {
                  const news = allNews.find((n) => n.uid === p.newsUid);
                  if (!news) return false;
                  const g = GROUP_KEYS.find((k) => k.key === ganttGroupFilter);
                  if (!g) return false;
                  return titleMatchesGroup(news.title, g);
                }
                return true;
              })
              .sort((a, b) => a.end.getTime() - b.end.getTime());

            // 現在時刻ラインのx座標（分単位でリアルタイム移動）
            const nowOffsetPx = (now.getTime() - stripStart) / MS_PER_DAY * CELL_WIDTH;
            const todayLineX = 16 + nowOffsetPx;

            return (
              <div style={{ width: contentWidth, padding: "4px 16px 0" }}>
                {/* 日付ヘッダー行 */}
                <div style={{ display: "flex", gap: 4 }}>
                  {stripDates.map((d, idx) => {
                    const isToday = isSameDay(d, today);
                    const isSelected = selectedDate ? isSameDay(d, selectedDate) : false;
                    const dow = d.getDay();
const isMonthStart = d.getDate() === 1;

                    return (
                      <div key={idx} style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", width: 44 }}>
                        {isMonthStart ? (
                          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.1em", color: "#000000", marginBottom: 2, textTransform: "uppercase" }}>
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
                            borderRadius: 0,
                            background: isSelected ? "#000000" : isToday ? "rgba(0,0,0,0.08)" : "transparent",
                            userSelect: "none",
                          }}
                        >
                          <div style={{ fontSize: 9, fontWeight: 700, marginBottom: 1, color: isSelected ? "rgba(255,255,255,0.75)" : dow === 0 ? "#ba1a1a" : dow === 6 ? "#585f6c" : "#999" }}>
                            {DOW_JA[dow]}
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1, color: isSelected ? "#fff" : dow === 0 ? "#ba1a1a" : dow === 6 ? "#585f6c" : undefined }}>
                            {d.getDate()}
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
                    background: "#ba1a1a",
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
                      const rawLeft = (p.start.getTime() - stripStart) / MS_PER_DAY * CELL_WIDTH;
                      const rawRight = (p.end.getTime() - stripStart) / MS_PER_DAY * CELL_WIDTH;
                      const left = Math.max(0, rawLeft);
                      const right = Math.min(TOTAL_DAYS * CELL_WIDTH, rawRight);
                      const width = Math.max(CELL_WIDTH / 2, right - left);
                      const barColor = "#585f6c";
                      const isTooltipOpen = tooltipUid === p.newsUid;

                      // 入金バー: payment_start → result → 申込締切日 の優先順で開始日を決定
                      const paymentDate = paymentByUid.get(p.newsUid);
                      const paymentBarStart = paymentDate
                        ? (paymentStartByUid.get(p.newsUid) ?? resultByUid.get(p.newsUid) ?? p.end)
                        : null;
                      const pRawLeft = paymentBarStart !== null ? (paymentBarStart.getTime() - stripStart) / MS_PER_DAY * CELL_WIDTH : null;
                      const pRawRight = paymentDate ? (paymentDate.getTime() - stripStart) / MS_PER_DAY * CELL_WIDTH : null;
                      const pLeft = pRawLeft !== null ? Math.max(0, pRawLeft) : null;
                      const pRight = pRawRight !== null ? Math.min(TOTAL_DAYS * CELL_WIDTH, pRawRight) : null;
                      const pWidth = pLeft !== null && pRight !== null ? Math.max(CELL_WIDTH / 2, pRight - pLeft) : null;
                      const showPaymentBar = pLeft !== null && pWidth !== null && pRight! > 0 && pLeft < TOTAL_DAYS * CELL_WIDTH;

                      // 当落発表マーカー
                      const resultDate = resultByUid.get(p.newsUid);
                      const resultRawX = resultDate ? (resultDate.getTime() - stripStart) / MS_PER_DAY * CELL_WIDTH : null;
                      const resultX = resultRawX !== null ? resultRawX : null;
                      const showResultMarker = resultX !== null && resultX >= 0 && resultX <= TOTAL_DAYS * CELL_WIDTH;

                      const rowHeight = showPaymentBar ? 34 : 30;

                      const handleBarClick = (e: React.MouseEvent) => {
                        e.stopPropagation();
                        if (isTooltipOpen) {
                          setTooltipUid(null);
                        } else {
                          setTooltipUid(p.newsUid);
                          setTooltipPos({ x: e.clientX, y: e.clientY });
                        }
                      };

                      return (
                        <div key={p.newsUid} style={{ height: rowHeight, position: "relative", background: isTooltipOpen ? "rgba(0,0,0,0.06)" : "transparent" }}>
                          {/* 申込期間バー */}
                          <div
                            className="bar-text-wrap gantt-bar-apply"
                            style={{
                              position: "absolute",
                              left,
                              width,
                              top: 6,
                              height: 18,
                              borderRadius: 0,
                              background: barColor,
                              overflow: "hidden",
                              boxSizing: "border-box",
                              cursor: "pointer",
                              "--bar-w": `${width}px`,
                            } as React.CSSProperties}
                            onClick={handleBarClick}
                          >
                            {(() => {
                              // 日本語混じりを考慮した概算: 8px/char。収まる場合はアニメなし
                              const approxTextW = title.length * 8 + 12;
                              const hasOverflow = approxTextW > width;
                              const duration = hasOverflow ? Math.max(4, (approxTextW + width) / 35) : 0;
                              return (
                                <span
                                  className={hasOverflow ? "bar-text-inner" : undefined}
                                  style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.95)", whiteSpace: "nowrap", display: "inline-block", lineHeight: "18px", verticalAlign: "top", ...(hasOverflow ? { animationDuration: `${duration}s` } : {}) }}
                                >
                                  <span style={{ paddingLeft: 8, paddingRight: 4 }}>{title}</span>
                                  {hasOverflow && (
                                    <span className="bar-marquee-dup" aria-hidden="true">
                                      <span style={{ display: "inline-block", width }} />
                                      <span style={{ paddingLeft: 8, paddingRight: 4 }}>{title}</span>
                                      <span style={{ display: "inline-block", width }} />
                                    </span>
                                  )}
                                </span>
                              );
                            })()}
                          </div>
                          {/* 入金バー（斜線パターン、payment_start or 当落確認〜入金締切） */}
                          {showPaymentBar && (
                            <div
                              className="gantt-bar-payment"
                              style={{
                                position: "absolute",
                                left: pLeft!,
                                width: pWidth!,
                                top: 10,
                                height: 18,
                                backgroundColor: "#f8f9fa",
                                overflow: "hidden",
                                cursor: "pointer",
                                zIndex: 1,
                              }}
                              onClick={handleBarClick}
                            >
                              <svg width={pWidth!} height={18} style={{ display: "block" }}>
                                {Array.from({ length: Math.ceil((pWidth! + 18) / 8) + 1 }, (_, i) => {
                                  const x = -18 + i * 8;
                                  return <line key={i} x1={x} y1={18} x2={x + 18} y2={0} stroke="#585f6c" strokeWidth="1.5" />;
                                })}
                              </svg>
                            </div>
                          )}
                          {/* 当落発表マーカー（縦線 + ひし形） */}
                          {showResultMarker && (
                            <div
                              style={{
                                position: "absolute",
                                left: resultX! - 1,
                                top: 2,
                                width: 2,
                                height: rowHeight - 4,
                                background: "#585f6c",
                                zIndex: 2,
                                cursor: "pointer",
                              }}
                              onClick={handleBarClick}
                            >
                              {/* ひし形マーカー */}
                              <div style={{
                                position: "absolute",
                                top: -3,
                                left: -3,
                                width: 8,
                                height: 8,
                                background: "#585f6c",
                                transform: "rotate(45deg)",
                              }} />
                            </div>
                          )}
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

      {/* Ganttツールチップ */}
      {tooltipUid && (() => {
        const news = newsMap.get(tooltipUid);
        const dates = deadlinesByNewsUid.get(tooltipUid) ?? {};
        const fmtDate = (d: Date) => {
          const DOW = ["日","月","火","水","木","金","土"];
          const h = d.getHours();
          const m = d.getMinutes();
          const time = (h !== 0 || m !== 0) ? ` ${h}:${String(m).padStart(2,"0")}` : "";
          return `${d.getMonth()+1}/${d.getDate()}(${DOW[d.getDay()]})${time}`;
        };
        // ツールチップ位置: 右端対策・下半分は上向き
        const tipW = 240;
        const tipH = 200; // 最大高さ概算
        const x = tooltipPos.x + tipW > window.innerWidth - 8
          ? tooltipPos.x - tipW - 8
          : tooltipPos.x + 8;
        const y = tooltipPos.y > window.innerHeight / 2
          ? tooltipPos.y - tipH - 8
          : tooltipPos.y + 8;
        return (
          <div
            style={{ position: "fixed", inset: 0, zIndex: 50 }}
            onClick={() => setTooltipUid(null)}
          >
            <div
              style={{
                position: "fixed",
                left: Math.max(8, x),
                top: Math.max(8, y),
                width: tipW,
                background: "#ffffff",
                border: "1px solid #000000",
                borderRadius: 0,
                boxShadow: "none",
                padding: "12px 14px",
                zIndex: 51,
                fontSize: 11,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontWeight: 700, fontSize: 11, lineHeight: 1.4, marginBottom: 10, color: "#191c1d" }}>
                {news?.title}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {dates.apply_start && (
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#474747", fontSize: 10 }}>
                    <span style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.6875rem", fontWeight: 700, color: "#777" }}>申込開始</span>
                    <span style={{ fontWeight: 700, color: "#191c1d" }}>{fmtDate(dates.apply_start)}</span>
                  </div>
                )}
                {dates.apply_end && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.6875rem", fontWeight: 700, color: "#777" }}>申込締切</span>
                    <span style={{ fontWeight: 700, color: "#ba1a1a", fontSize: 10 }}>{fmtDate(dates.apply_end)}</span>
                  </div>
                )}
                {dates.payment && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.6875rem", fontWeight: 700, color: "#777" }}>入金締切</span>
                    <span style={{ fontWeight: 700, color: "#585f6c", fontSize: 10 }}>{fmtDate(dates.payment)}</span>
                  </div>
                )}
                {dates.result && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.6875rem", fontWeight: 700, color: "#777" }}>当落確認</span>
                    <span style={{ fontWeight: 700, color: "#191c1d", fontSize: 10 }}>{fmtDate(dates.result)}</span>
                  </div>
                )}
              </div>
              {news?.detail_url && (
                <a
                  href={news.detail_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "block",
                    marginTop: 10,
                    padding: "7px 0",
                    textAlign: "center",
                    background: "#000000",
                    color: "#ffffff",
                    borderRadius: 0,
                    fontSize: "0.6875rem",
                    fontWeight: 700,
                    textDecoration: "none",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  申込ページを開く →
                </a>
              )}
            </div>
          </div>
        );
      })()}

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

      {/* Daily Summary */}
      <section className="mb-12 grid grid-cols-1 md:grid-cols-2 gap-px bg-outline-variant/20">
        <div className="bg-surface py-12 pr-12">
          <h3 className="text-[0.6875rem] font-bold uppercase tracking-[0.3em] mb-4 text-outline">
            Upcoming / 3 Days
          </h3>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-7xl font-black tracking-tighter">{upcomingActionable.length}</span>
            <span className="text-sm font-bold uppercase text-outline">Deadlines</span>
          </div>
          <div className="flex gap-3 mt-3">
            {upcomingPayment > 0 && (
              <span className="text-[0.625rem] font-bold uppercase tracking-widest px-2 py-1 bg-error text-on-error">
                入金 {upcomingPayment}件
              </span>
            )}
            {upcomingApply > 0 && (
              <span className="text-[0.625rem] font-bold uppercase tracking-widest px-2 py-1 bg-tertiary-container text-on-tertiary-container">
                申込 {upcomingApply}件
              </span>
            )}
            {upcomingActionable.length === 0 && (
              <span className="text-[0.625rem] text-outline">直近3日間に締切なし</span>
            )}
          </div>
        </div>
        <div className="bg-surface py-12 pl-12 flex flex-col justify-end">
          <div className="space-y-4">
            <div className="flex justify-between items-end">
              <span className="text-[0.625rem] font-bold uppercase">3日以内の未入金</span>
              <span className="text-xl font-bold" style={{ color: urgentPayment > 0 ? "var(--color-error)" : undefined }}>
                {urgentPayment}
              </span>
            </div>
            <div className="w-full h-1 bg-outline-variant/20">
              <div
                className="h-full bg-error"
                style={{ width: urgentPayment > 0 ? "100%" : "0%" }}
              />
            </div>
            <div className="flex justify-between items-end">
              <span className="text-[0.625rem] font-bold uppercase">本日の締切</span>
              <span className="text-xl font-bold">{todayActionable.length}</span>
            </div>
            <div className="w-full h-1 bg-outline-variant/20">
              <div className="h-full bg-primary" style={{ width: todayActionable.length > 0 ? "100%" : "0%" }} />
            </div>
          </div>
        </div>
      </section>


      {/* ─── 気になる公演 ─── */}
      <section className="mb-16">
        <header className="flex items-center gap-4 mb-6">
          <div className="h-10 w-1 bg-primary" />
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
                className="text-[0.6875rem] text-outline hover:text-primary uppercase tracking-widest cursor-pointer transition-colors"
              >
                すべて解除
              </button>
            </div>
          )}
        </header>

        {/* すべて解除 確認パネル */}
        {confirmClearAll && (
          <div className="mb-4 p-3 border border-error bg-error-container text-on-error-container text-sm flex flex-col gap-2">
            <p className="font-bold">気になるリストを全件削除しますか？</p>
            <div className="flex gap-2">
              <button
                onClick={() => { onWatchlistChange([]); setPendingCalendarUid(null); setConfirmClearAll(false); }}
                className="flex-1 py-2 text-xs font-bold bg-error text-on-error cursor-pointer"
              >
                削除する
              </button>
              <button
                onClick={() => setConfirmClearAll(false)}
                className="flex-1 py-2 text-xs font-bold border border-outline cursor-pointer"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}

        {/* カード状態の凡例 */}
        <div className="flex gap-4 text-[0.625rem] text-outline mb-4 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-1 h-4 inline-block flex-shrink-0" style={{ background: "#ba1a1a" }} />
            入金急ぎ（3日以内）
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-0.5 h-4 inline-block flex-shrink-0 bg-black" />
            申込済み
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 inline-block flex-shrink-0" style={{ background: "#e1e3e4" }} />
            入金期間中
          </span>
        </div>

        {/* グループフィルター */}
        {availableGroups.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setWatchlistGroups([])}
              className={`px-3 py-1 text-[0.625rem] font-bold uppercase tracking-widest cursor-pointer transition-colors ${
                watchlistGroups.length === 0
                  ? "bg-primary text-on-primary-fixed"
                  : "bg-surface-container-high text-outline hover:bg-surface-container-highest hover:text-primary"
              }`}
            >
              すべて
            </button>
            {availableGroups.map((g) => {
              const active = watchlistGroups.includes(g.key);
              return (
                <button
                  key={g.key}
                  data-demo-id={g.key === 'BEYOOOOONDS' ? 'watchlist-filter-beyooooonds' : undefined}
                  onClick={() =>
                    setWatchlistGroups(
                      active
                        ? watchlistGroups.filter((k) => k !== g.key)
                        : [...watchlistGroups, g.key]
                    )
                  }
                  className={`px-3 py-1 text-[0.625rem] font-bold uppercase tracking-widest cursor-pointer transition-colors ${
                    active
                      ? "bg-primary text-on-primary-fixed"
                      : "bg-surface-container-high text-outline hover:bg-surface-container-highest hover:text-primary"
                  }`}
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
        {activeCandidates.length === 0 && doneCandidates.length === 0 ? (
          <p className="text-sm text-outline py-8 text-center">
            {watchlistSearch ? "該当なし" : "公演の右側にある bookmark アイコンを押して追加できます"}
          </p>
        ) : (
          <div className="flex flex-col gap-px">
            {activeCandidates.map((news) => {
              const applyEnd = applyEndByUid.get(news.uid);
              const paymentEnd = paymentByUid.get(news.uid);
              const isWatched = watchlistSet.has(news.uid);
              const isApplied = appliedSet.has(news.uid);
              const isPaid = paidSet.has(news.uid);
              const isPending = pendingCalendarUid === news.uid;
              const now3 = new Date();
              const inPaymentPeriod = !!(paymentEnd && paymentEnd > now3 && (!applyEnd || applyEnd < now3));
              const isPaymentUrgent = isApplied && !isPaid && paymentEnd
                && (paymentEnd.getTime() - Date.now()) / 86400000 < 3;
              const applyEndStr = applyEnd
                ? applyEnd.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }) +
                  " " + applyEnd.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
                : null;
              const paymentEndStr = paymentEnd
                ? paymentEnd.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }) +
                  " " + paymentEnd.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
                : null;
              const calEvent: IcsEvent | null = applyEnd ? {
                uid: news.uid + "@hop-up-tools-watchlist",
                summary: news.title + "【申込締切】",
                description: news.detail_url,
                dtstart: new Date(applyEnd.getTime() - 3600000),
                dtend: applyEnd,
              } : null;
              // 色 + ボーダー幅の両方で状態を区別（色覚異常対応）
              const cardStyle: React.CSSProperties = isPaymentUrgent
                ? { borderLeft: "4px solid #ba1a1a", background: "#ffffff" }  // 太さ4px = 緊急
                : isApplied
                ? { borderLeft: "2px solid #000000", background: "#ffffff" }  // 太さ2px = 要対応
                : inPaymentPeriod
                ? { borderLeft: "2px solid transparent", background: "#e1e3e4" }
                : { borderLeft: "2px solid transparent", background: "#f3f4f5" };
              return (
                <div key={news.uid}>
                  <div className="flex items-center gap-4 px-4 py-4" style={cardStyle}>
                    <button
                      onClick={() => toggleWatchlist(news.uid)}
                      className="material-symbols-outlined text-xl cursor-pointer transition-colors flex-shrink-0"
                      style={{ color: isWatched ? "#000000" : "#c6c6c6", fontVariationSettings: `'FILL' ${isWatched ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24` }}
                      title={isWatched ? "気になるから削除" : "気になるに追加"}
                      {...(!isWatched && (news.title.includes('BEYOOOOONDS') && news.title.includes('宿泊')) ? { 'data-demo-id': 'watchlist-beyo-hotel-add-btn' } : {})}
                    >
                      bookmark
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <a
                          href={news.detail_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-bold leading-tight hover:underline block break-words"
                        >
                          {news.title}
                        </a>
                      </div>
                      {isApplied && paymentEndStr && (
                        <p className={`mt-0.5 font-bold ${isPaymentUrgent ? "text-xs text-error" : "text-xs text-outline"}`}
                           style={isPaymentUrgent ? { fontSize: "0.75rem", letterSpacing: "0.02em" } : undefined}>
                          {isPaymentUrgent ? "⚠ 入金締切 " : "入金締切 "}{paymentEndStr}
                        </p>
                      )}
                      {!isApplied && inPaymentPeriod && paymentEndStr && (
                        <p className="text-xs text-outline mt-0.5">
                          入金締切 {paymentEndStr}（申込締切は終了）
                        </p>
                      )}
                      {!isApplied && !inPaymentPeriod && applyEndStr && (
                        <p className="text-xs text-outline mt-0.5">
                          申込締切 {applyEndStr}
                        </p>
                      )}
                    </div>
                    {/* 申込/入金ボタン */}
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      {!isApplied && !inPaymentPeriod && (
                        <button
                          onClick={() => toggleApplied(news.uid)}
                          className="flex items-center gap-1 text-[0.5625rem] font-bold uppercase tracking-widest px-2 py-1.5 border border-outline text-outline hover:bg-surface-container-highest cursor-pointer transition-colors whitespace-nowrap"
                        >
                          <span className="material-symbols-outlined text-[0.75rem] leading-none">check_small</span>
                          申込した
                        </button>
                      )}
                      {isApplied && !isPaid && (
                        <>
                          <button
                            onClick={() => togglePaid(news.uid)}
                            className="text-[0.5625rem] font-bold uppercase tracking-widest px-2 py-1.5 bg-primary text-on-primary-fixed hover:bg-secondary cursor-pointer transition-colors whitespace-nowrap"
                          >
                            入金した
                          </button>
                          <button
                            onClick={() => toggleApplied(news.uid)}
                            className="text-[0.5625rem] font-bold uppercase tracking-widest px-2 py-1.5 border border-error text-error hover:bg-error-container cursor-pointer transition-colors whitespace-nowrap"
                            title="申込済みを取り消す"
                          >
                            申込取消
                          </button>
                        </>
                      )}
                      {isPaid && (
                        <button
                          onClick={() => togglePaid(news.uid)}
                          className="text-[0.5625rem] font-bold uppercase tracking-widest px-2 py-1.5 border border-outline text-outline hover:bg-surface-container-highest cursor-pointer transition-colors whitespace-nowrap"
                          title="入金済みを取り消す"
                        >
                          取り消す
                        </button>
                      )}
                    </div>
                  </div>
                  {/* 追加直後のカレンダー登録提案 */}
                  {isPending && calEvent && (
                    <div className="flex items-center gap-3 px-4 py-3 bg-surface-container-high border-l-2 flex-wrap" style={{ borderColor: "#000000" }}>
                      <span className="material-symbols-outlined text-sm flex-shrink-0" style={{ color: "#000000" }}>calendar_add_on</span>
                      <span className="text-xs font-bold flex-1">申込期日をカレンダーに登録しますか？</span>
                      <div className="flex gap-2 flex-wrap">
                        <button
                          data-demo-id="watchlist-google-cal-btn"
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

        {/* 完了・終了済みセクション */}
        {doneCandidates.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowCompleted((v) => !v)}
              className="flex items-center gap-2 text-[0.625rem] font-bold uppercase tracking-widest text-outline hover:text-primary cursor-pointer transition-colors py-2"
            >
              <span className="material-symbols-outlined text-sm">
                {showCompleted ? "expand_less" : "expand_more"}
              </span>
              完了・終了済み {doneCandidates.length}件
            </button>
            {showCompleted && (
              <div className="flex flex-col gap-px opacity-50">
                {doneCandidates.map((news) => {
                  const applyEnd  = applyEndByUid.get(news.uid);
                  const paymentEnd = paymentByUid.get(news.uid);
                  const isPaid    = paidSet.has(news.uid);
                  const lastDeadline = paymentEnd ?? applyEnd;
                  const lastLabel    = paymentEnd ? "入金締切" : "申込締切";
                  const lastDateStr  = lastDeadline
                    ? lastDeadline.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }) +
                      " " + lastDeadline.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
                    : null;
                  return (
                    <div key={news.uid} className="flex items-center gap-4 px-4 py-3 bg-surface-container-low">
                      <div className="flex-1 min-w-0">
                        <a
                          href={news.detail_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-bold leading-tight hover:underline block break-words"
                        >
                          {news.title}
                        </a>
                        {lastDateStr && (
                          <p className="text-xs text-outline mt-0.5">{lastLabel} {lastDateStr}</p>
                        )}
                      </div>
                      {isPaid && (
                        <span className="flex-shrink-0 text-[0.5625rem] font-bold uppercase tracking-widest px-1.5 py-0.5 bg-primary text-on-primary-fixed">入金済</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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
  const isUrgent = diffDays >= 0 && diffDays < 3;

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
    apply_end:   "#000000", // primary — 申込締切（最重要）
    payment:     "#585f6c", // secondary — 入金締切
    result:      "#777777", // outline — 当落確認
    apply_start: "#c6c6c6", // outline-variant — 申込開始（情報）
    sale_start:  "#c6c6c6",
    sale_end:    "#777777",
  };
  return map[type] ?? "#c6c6c6";
}
