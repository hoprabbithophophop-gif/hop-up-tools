import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import UpfcDummyPreview from "./UpfcDummyPreview";
import FavoritePicker, { type Favorites } from "./FavoritePicker";
import MemberFilterInput from "./MemberFilterInput";
import { OG_MEMBERS, OG_GROUP_LABEL } from "@/data/ogMembers";
import { eventGroupKey, dedupeEventTwins } from "@/lib/eventGrouping";
import { loadVenueGeo, geoForLocation } from "@/lib/venueGeo";
import { getSupabase } from "../../lib/supabase";
import {
  generateIcs,
  downloadIcs,
  generateGoogleCalendarUrl,
  generateYahooCalendarUrl,
  generateMultiIcs,
  generateSubscriptionSlug,
  cleanFcTitle,
  type IcsEvent,
  type IcsAlarm,
} from "../../lib/ics";
import {
  uploadSubscriptionIcs,
  deleteSubscriptionIcs,
  subscriptionUrls,
  type SubscriptionUrls,
} from "../../lib/icsSubscription";
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
  location?: string | null;
  fc_news: { title: string; detail_url: string; category: string };
}

interface ElineupGoodsRow {
  product_url: string;
  product_name: string;
  event_name: string | null;
  sale_end_at: string | null;
}

// e-LineUPグッズを「イベント＋締切」単位でまとめ、締切パイプライン(Deadline)に乗せる形へ変換。
// 同一イベントの複数商品は同じ受付締切なので1件に集約する。
function buildGoodsDeadlines(rows: ElineupGoodsRow[]): Deadline[] {
  const byKey = new Map<string, { ev: string; saleEnd: string; url: string }>();
  for (const r of rows) {
    if (!r.sale_end_at) continue;
    const ev = (r.event_name || r.product_name || "グッズ").trim();
    const key = ev + "|" + r.sale_end_at;
    if (!byKey.has(key)) byKey.set(key, { ev, saleEnd: r.sale_end_at, url: r.product_url });
  }
  return [...byKey.entries()].map(([key, g]) => ({
    id: "goods:" + key,
    news_uid: "goods:" + g.ev,
    type: "goods_sale_end",
    label: "グッズ締切",
    deadline_at: g.saleEnd,
    fc_news: { title: g.ev + " グッズ", detail_url: g.url, category: "グッズ" },
  }));
}

// UPFC記事タイトル / e-LineUPイベント名を突き合わせ用キーに正規化する。
// UPFC「アンジュルム 長野桃羽…2026オリジナルグッズ公開！」と
// e-LineUP「アンジュルム 長野桃羽…2026」を一致させるため、グッズ告知の接尾辞・装飾・空白・
// 引用符の表記揺れ（'26 / ’26）を全部落としてから比較する。
function normGoodsKey(s: string): string {
  return s
    .replace(/オリジナルグッズ公開|グッズ公開|オリジナルグッズ|のお知らせ|グッズ/g, "")
    .replace(/[’'＇`]/g, "")
    .replace(/[！!]/g, "")
    .replace(/[　\s]+/g, "")
    .trim();
}

// 1グッズ販売期間（通販開始=UPFC, 受付締切=e-LineUP）。ガントの独立行になる。
interface GoodsPeriod {
  id: string;        // tooltip識別用（"goodsperiod:" + key）
  label: string;     // イベント名
  start: Date | null; // 通販開始（UPFC）。未ペアなら null
  end: Date;         // 受付締切（e-LineUP）
  url: string;       // e-LineUP商品ページ
}

// e-LineUP締切(goods_sale_end)とUPFC通販開始(goods_sale_start)をイベント名で突き合わせ、
// 開始も締切も揃った「販売期間」だけを返す（開始が無いものはガントに出さず一覧側に任せる）。
function buildGoodsPeriods(deadlines: Deadline[]): GoodsPeriod[] {
  const startByKey = new Map<string, Date>();
  for (const dl of deadlines) {
    if (dl.type === "goods_sale_start") {
      startByKey.set(normGoodsKey(dl.fc_news.title), new Date(dl.deadline_at));
    }
  }
  const periods: GoodsPeriod[] = [];
  for (const dl of deadlines) {
    if (dl.type !== "goods_sale_end") continue;
    const key = normGoodsKey(dl.fc_news.title);
    let start = startByKey.get(key) ?? null;
    if (!start && key) {
      // 完全一致しなければ片方がもう片方を含む関係で照合（地域付き等の揺れ吸収）
      for (const [k, v] of startByKey) {
        if (k && (k.includes(key) || key.includes(k))) { start = v; break; }
      }
    }
    if (!start) continue; // 開始が分からない＝期間バーにできない
    // 月次まとめ通販（「○月通販公開！」）はタイトルが長いので「N月通販」に整える
    let label = dl.fc_news.title.replace(/\s*グッズ$/, "");
    const monthly = label.match(/(\d+)\s*月通販/);
    if (monthly) label = monthly[1] + "月通販";
    periods.push({
      id: "goodsperiod:" + key,
      label,
      start,
      end: new Date(dl.deadline_at),
      url: dl.fc_news.detail_url,
    });
  }
  return periods;
}

// input に Result を統合（締切確認）。旧 "result" は input にエイリアス。
type Tab = "input" | "calendar" | "subscribe";

type RetentionMode = "after-event-1m" | "6m" | "forever";

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

  // タブをURL(?tab=)に反映して履歴に積む → ブラウザの戻る/進むでタブ移動できる
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = (() => {
    const t = searchParams.get("tab");
    if (t === "input" || t === "result") return "input"; // Result は input に統合（旧URL互換）
    if (t === "subscribe") return "subscribe";
    return "calendar";
  })();
  const setTab = (t: Tab) => {
    setSearchParams(t === "calendar" ? {} : { tab: t });
  };
  const [pasteText, setPasteText] = useState<string>(() => {
    try { return localStorage.getItem("fc-input-text") ?? ""; }
    catch { return ""; }
  });
  const [allNews, setAllNews] = useState<FcNewsRow[]>([]);
  const [allDeadlines, setAllDeadlines] = useState<Deadline[]>([]);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  // 締切確認タブ: 解析後は入力欄を畳んで結果に集中（再入力バーで開き直せる）
  const [inputCollapsed, setInputCollapsed] = useState(true);
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
      sb
        .from("elineup_goods")
        .select("product_url, product_name, event_name, sale_end_at")
        .not("sale_end_at", "is", null)
        .gte("sale_end_at", new Date(Date.now() - 7 * 86400000).toISOString()),
      // 会場名→座標の辞書（カレンダー予定の地図タップ用）。描画前に揃えておく
      loadVenueGeo(sb),
    ]).then(([newsRes, dlRes, goodsRes]) => {
      if (newsRes.data) setAllNews(newsRes.data as FcNewsRow[]);
      const deadlines = (dlRes.data as Deadline[]) ?? [];
      const goodsDeadlines = buildGoodsDeadlines((goodsRes.data as ElineupGoodsRow[]) ?? []);
      setAllDeadlines([...deadlines, ...goodsDeadlines]);
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
    setInputCollapsed(true); // 解析したら入力欄を畳んで結果を前面に
    if (tab !== "input") setTab("input");
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
            <>
              {(!inputCollapsed || matchResults.length === 0) ? (
                <InputScreen
                  pasteText={pasteText}
                  setPasteText={setPasteText}
                  onAnalyze={handleAnalyze}
                  onCalendar={() => setTab("calendar")}
                  compact={matchResults.length > 0}
                  onCollapse={matchResults.length > 0 ? () => setInputCollapsed(true) : undefined}
                />
              ) : (
                <ReInputBar onExpand={() => setInputCollapsed(false)} />
              )}
              {matchResults.length > 0 && (
                <ResultScreen
                  matchResults={matchResults}
                  allDeadlines={allDeadlines}
                  onSubscribe={() => setTab("subscribe")}
                />
              )}
            </>
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
              onGoSubscribe={() => setTab("subscribe")}
            />
          )}
          {tab === "subscribe" && (
            <SubscribeScreen
              allDeadlines={allDeadlines}
              matchResults={matchResults}
              watchlist={watchlist}
              onWatchlistChange={setWatchlist}
              applied={applied}
              onAppliedChange={setApplied}
              paid={paid}
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
        {(["calendar", "input", "subscribe"] as Tab[]).map((t) => (
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
            {t === "input" ? "Import" : t === "calendar" ? "Calendar" : "Subscribe"}
          </button>
        ))}
      </nav>
    </header>
  );
}

// ─── 画面A: 入力 ──────────────────────────────────────────

function ReInputBar({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="px-4 pt-6 max-w-7xl mx-auto w-full">
      <button
        onClick={onExpand}
        className="w-full flex items-center justify-between bg-surface-container-low px-5 py-3 text-left hover:bg-surface-container transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2 text-[0.6875rem] font-bold uppercase tracking-widest text-outline">
          <span className="material-symbols-outlined text-base">edit</span>
          再入力（貼り直す）
        </span>
        <span className="material-symbols-outlined text-outline">expand_more</span>
      </button>
    </div>
  );
}

function InputScreen({
  pasteText,
  setPasteText,
  onAnalyze,
  onCalendar,
  compact = false,
  onCollapse,
}: {
  pasteText: string;
  setPasteText: (v: string) => void;
  onAnalyze: () => void;
  onCalendar: () => void;
  compact?: boolean;
  onCollapse?: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <>
    <main className={compact ? "px-4 pt-6" : "flex-grow flex items-center justify-center px-4 py-12"}>
      <div className="w-full max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-0 border border-outline-variant/20 bg-surface-container-lowest">
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
              {compact ? "再確認" : "締切を確認"}
            </button>
            {compact && onCollapse ? (
              <button
                onClick={onCollapse}
                className="group flex items-center gap-2 text-[0.6875rem] font-bold uppercase tracking-widest text-outline hover:text-primary transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">expand_less</span>
                <span>閉じる</span>
              </button>
            ) : (
              <>
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
              </>
            )}
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
  onSubscribe,
}: {
  matchResults: MatchResult[];
  allDeadlines: Deadline[];
  onSubscribe: () => void;
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

  if (matchResults.length === 0) return null; // 結果が無い時は呼び出し側で非表示

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
          <button
            onClick={onSubscribe}
            className="bg-primary text-on-primary-fixed px-6 py-4 text-left transition-colors hover:bg-secondary cursor-pointer flex items-start gap-3"
          >
            <span className="material-symbols-outlined">rss_feed</span>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest mb-1">カレンダーアプリで購読</p>
              <p className="text-[0.6875rem] opacity-90 leading-tight">TimeTree・iPhone標準カレンダーに自動同期</p>
            </div>
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

  // 公演(event)は「開演〜2時間」の予定として扱う。締切類は「締切の1時間前〜締切」。
  const isEvent = dl.type === "event";
  const calEvent: IcsEvent = {
    uid: dl.id + "@hop-up-tools",
    summary: "【" + dl.label + "】" + cleanFcTitle(dl.fc_news.title),
    description: dl.fc_news.title + "\n" + dl.fc_news.detail_url,
    dtstart: isEvent ? deadline : new Date(deadline.getTime() - 3600000),
    dtend: isEvent ? new Date(deadline.getTime() + 7200000) : deadline,
    location: dl.location ?? undefined,
    geo: geoForLocation(dl.location),
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
  onGoSubscribe,
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
  onGoSubscribe: () => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 購読URL発行済みか。発行済みなら気になる追加で自動配信されるため、単発カレンダー登録は出さない（二重登録防止）
  const hasSubscription = (() => {
    try { return !!localStorage.getItem("fc-sub-slug"); } catch { return false; }
  })();

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
  const [ganttMemberFilter, setGanttMemberFilter] = useState<string>("");
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


  // グッズ販売期間（通販開始↔受付締切のペア）。ガントの独立行として描く。
  const goodsPeriods = buildGoodsPeriods(filteredDeadlines);

  // 要対応締切のみ（apply_end / payment）— result・apply_start 等は件数に含めない
  const actionableTypes = new Set(["apply_end", "payment"]);
  const actionableDeadlines = filteredDeadlines.filter((dl) => actionableTypes.has(dl.type));

  // 同一公演の重複event行は1枚のカードに畳む
  const selectedDeadlines = selectedDate
    ? dedupeEventTwins(filteredDeadlines.filter((dl) => isSameDay(new Date(dl.deadline_at), selectedDate))).deduped
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
              <span className="flex items-center gap-1">
                <span className="w-5 h-2 inline-block overflow-hidden" style={{ background: "#585f6c" }}>
                  <svg width="20" height="8" style={{ display: "block" }}>
                    {Array.from({ length: 4 }, (_, i) => (
                      <g key={i}>
                        <circle cx={3 + i * 6} cy={2.5} r={1} fill="rgba(255,255,255,0.6)" />
                        <circle cx={6 + i * 6} cy={5.5} r={1} fill="rgba(255,255,255,0.6)" />
                      </g>
                    ))}
                  </svg>
                </span>
                <span className="text-[0.6875rem] font-bold uppercase tracking-widest">グッズ販売期間</span>
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
            <MemberFilterInput value={ganttMemberFilter} onChange={setGanttMemberFilter} />
          </div>
        </div>

        {/* 左: イベントラベル固定列／右: タイムライン横スクロール */}
        <div style={{ margin: "0 -16px", display: "flex", alignItems: "flex-start" }}>
          {(() => {
            const TOTAL_DAYS = stripDates.length; // 121
            const contentWidth = TOTAL_DAYS * CELL_WIDTH + 32; // +32 for 16px padding each side
            const stripStart = stripDates[0].getTime();
            const MS_PER_DAY = 86400000;
            const LANE_H = 26;         // 各レーンの高さ（左ラベル列と右バーで共有し行を揃える）
            const LABEL_W = "40%";     // 左ラベル列の幅（残り60%がタイムライン）
            const HEADER_SPACER = 64;  // 日付ヘッダー高さ相当（左列の上端を右ペインの先頭行に揃える）

            // ガントバー: apply期間のみ、今日以降に締切があるもの
            const gantRows = ganttPeriods
              .filter((p) => {
                if (p.type !== "apply") return false;
                if (p.end.getTime() < today.getTime()) return false;
                if (p.start.getTime() > stripDates[TOTAL_DAYS - 1].getTime() + MS_PER_DAY) return false;
                const news = allNews.find((n) => n.uid === p.newsUid);
                if (ganttGroupFilter) {
                  if (!news) return false;
                  const g = GROUP_KEYS.find((k) => k.key === ganttGroupFilter);
                  if (!g || !titleMatchesGroup(news.title, g)) return false;
                }
                if (ganttMemberFilter) {
                  if (!news || !news.title.includes(ganttMemberFilter)) return false;
                }
                return true;
              })
              .sort((a, b) => a.end.getTime() - b.end.getTime());

            // グッズ販売期間行: 締切が今日以降・ウィンドウ内・フィルタ適用
            const goodsRows = goodsPeriods.filter((g) => {
              if (g.end.getTime() < today.getTime()) return false;
              if (g.start!.getTime() > stripDates[TOTAL_DAYS - 1].getTime() + MS_PER_DAY) return false;
              if (ganttGroupFilter) {
                const grp = GROUP_KEYS.find((k) => k.key === ganttGroupFilter);
                if (!grp || !titleMatchesGroup(g.label, grp)) return false;
              }
              if (ganttMemberFilter && !g.label.includes(ganttMemberFilter)) return false;
              return true;
            });

            // ── イベント単位クラスタ: 申込各種＋グッズを eventGroupKey で束ねる ──
            // チケット記事(★FC会員限定★/「」/受付種別/のお知らせ等)とグッズ記事(オリジナルグッズ公開！)を
            // 同じ正規化キーに落として同一イベントとして束ねる。クラスタは最寄り締切が近い順。
            const ck = (t: string) =>
              eventGroupKey(t)
                .replace(/オリジナルグッズ公開|グッズ公開|オリジナルグッズ|グッズ/g, "")
                .replace(/[’'＇`！!]/g, "")
                .replace(/[　\s]+/g, "")
                .trim();
            const KNOWN_RECEPTIONS = ["FC先行受付", "NEXT先行受付", "FC2次受付", "FC3次受付", "FC追加受付", "当日券予約販売", "当日券予約受付", "当日券販売", "開催決定"];
            // 「開催決定！」記事はそのイベント最初のFC受付（apply期間あり）なので 1次受付 と表示する
            const laneLabel = (t: string) => {
              const k = KNOWN_RECEPTIONS.find((kw) => t.includes(kw));
              if (!k) return "申込";
              return k === "開催決定" ? "FC1次受付" : k;
            };

            type Cluster = { key: string; name: string; ticketRows: { p: GanttPeriod; label: string }[]; goods: GoodsPeriod | null; nearest: number };
            const clusterMap = new Map<string, Cluster>();
            const ensureCluster = (key: string, name: string) => {
              let c = clusterMap.get(key);
              if (!c) { c = { key, name, ticketRows: [], goods: null, nearest: Infinity }; clusterMap.set(key, c); }
              return c;
            };
            for (const p of gantRows) {
              const t = newsMap.get(p.newsUid)?.title ?? "";
              const c = ensureCluster(ck(t) || p.newsUid, eventGroupKey(t) || t);
              if (eventGroupKey(t)) c.name = eventGroupKey(t); // チケット由来の名前を優先
              c.ticketRows.push({ p, label: laneLabel(t) });
              c.nearest = Math.min(c.nearest, p.end.getTime());
            }
            for (const g of goodsRows) {
              const c = ensureCluster(ck(g.label) || g.id, g.label);
              c.goods = g;
              c.nearest = Math.min(c.nearest, g.end.getTime());
            }
            const clusters = [...clusterMap.values()].sort((a, b) => a.nearest - b.nearest);
            const clusterLanes = (c: Cluster) => c.ticketRows.length + (c.goods ? 1 : 0);
            const clusterH = (c: Cluster) => clusterLanes(c) * LANE_H + 8; // paddingTop(5)+marginBottom(3)相当

            // ── 1レーン描画: チケット申込（申込バー＋入金斜線＋当落ひし形） ──
            const renderTicketLane = (p: GanttPeriod, label: string) => {
              const left = Math.max(0, (p.start.getTime() - stripStart) / MS_PER_DAY * CELL_WIDTH);
              const right = Math.min(TOTAL_DAYS * CELL_WIDTH, (p.end.getTime() - stripStart) / MS_PER_DAY * CELL_WIDTH);
              const width = Math.max(CELL_WIDTH / 2, right - left);
              const isOpen = tooltipUid === p.newsUid;
              const paymentDate = paymentByUid.get(p.newsUid);
              const paymentBarStart = paymentDate ? (paymentStartByUid.get(p.newsUid) ?? resultByUid.get(p.newsUid) ?? p.end) : null;
              const pLeft = paymentBarStart !== null ? Math.max(0, (paymentBarStart.getTime() - stripStart) / MS_PER_DAY * CELL_WIDTH) : null;
              const pRight = paymentDate ? Math.min(TOTAL_DAYS * CELL_WIDTH, (paymentDate.getTime() - stripStart) / MS_PER_DAY * CELL_WIDTH) : null;
              const pWidth = pLeft !== null && pRight !== null ? Math.max(CELL_WIDTH / 2, pRight - pLeft) : null;
              const showPaymentBar = pLeft !== null && pWidth !== null && pRight! > 0 && pLeft < TOTAL_DAYS * CELL_WIDTH;
              const resultDate = resultByUid.get(p.newsUid);
              const resultX = resultDate ? (resultDate.getTime() - stripStart) / MS_PER_DAY * CELL_WIDTH : null;
              const showResultMarker = resultX !== null && resultX >= 0 && resultX <= TOTAL_DAYS * CELL_WIDTH;
              const onClick = (e: React.MouseEvent) => { e.stopPropagation(); if (isOpen) setTooltipUid(null); else { setTooltipUid(p.newsUid); setTooltipPos({ x: e.clientX, y: e.clientY }); } };
              return (
                <div key={p.newsUid} style={{ height: LANE_H, position: "relative", background: isOpen ? "rgba(0,0,0,0.06)" : "transparent" }}>
                  <div className="gantt-bar-apply" style={{ position: "absolute", left, width, top: 4, height: 18, background: "#585f6c", overflow: "hidden", boxSizing: "border-box", cursor: "pointer" }} onClick={onClick}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.95)", whiteSpace: "nowrap", lineHeight: "18px", display: "inline-block", paddingLeft: 8, paddingRight: 4 }}>{label}</span>
                  </div>
                  {showPaymentBar && (
                    <div className="gantt-bar-payment" style={{ position: "absolute", left: pLeft!, width: pWidth!, top: 4, height: 18, backgroundColor: "#f8f9fa", overflow: "hidden", cursor: "pointer", zIndex: 1 }} onClick={onClick}>
                      <svg width={pWidth!} height={18} style={{ display: "block" }}>
                        {Array.from({ length: Math.ceil((pWidth! + 18) / 8) + 1 }, (_, i) => { const x = -18 + i * 8; return <line key={i} x1={x} y1={18} x2={x + 18} y2={0} stroke="#585f6c" strokeWidth="1.5" />; })}
                      </svg>
                    </div>
                  )}
                  {showResultMarker && (
                    <div style={{ position: "absolute", left: resultX! - 1, top: 2, width: 2, height: LANE_H - 4, background: "#585f6c", zIndex: 2, cursor: "pointer" }} onClick={onClick}>
                      <div style={{ position: "absolute", top: -3, left: -3, width: 8, height: 8, background: "#585f6c", transform: "rotate(45deg)" }} />
                    </div>
                  )}
                </div>
              );
            };

            // ── 1レーン描画: グッズ販売期間（ドット柄） ──
            const renderGoodsLane = (g: GoodsPeriod) => {
              const gLeft = Math.max(0, (g.start!.getTime() - stripStart) / MS_PER_DAY * CELL_WIDTH);
              const gRight = Math.min(TOTAL_DAYS * CELL_WIDTH, (g.end.getTime() - stripStart) / MS_PER_DAY * CELL_WIDTH);
              const gWidth = Math.max(CELL_WIDTH / 2, gRight - gLeft);
              const isOpen = tooltipUid === g.id;
              return (
                <div key={g.id} style={{ height: LANE_H, position: "relative", background: isOpen ? "rgba(0,0,0,0.06)" : "transparent" }}>
                  <div style={{ position: "absolute", left: gLeft, width: gWidth, top: 4, height: 18, background: "#585f6c", overflow: "hidden", boxSizing: "border-box", cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); if (isOpen) setTooltipUid(null); else { setTooltipUid(g.id); setTooltipPos({ x: e.clientX, y: e.clientY }); } }}>
                    <svg width={gWidth} height={18} style={{ position: "absolute", inset: 0, display: "block", pointerEvents: "none" }}>
                      {Array.from({ length: Math.ceil(gWidth / 6) + 1 }, (_, c) => (
                        <g key={c}><circle cx={3 + c * 6} cy={5} r={1.1} fill="rgba(255,255,255,0.55)" /><circle cx={6 + c * 6} cy={13} r={1.1} fill="rgba(255,255,255,0.55)" /></g>
                      ))}
                    </svg>
                    <span style={{ position: "relative", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.95)", whiteSpace: "nowrap", lineHeight: "18px", display: "inline-block", paddingLeft: 8, paddingRight: 4 }}>グッズ販売</span>
                  </div>
                </div>
              );
            };

            // 現在時刻ラインのx座標（分単位でリアルタイム移動）
            const nowOffsetPx = (now.getTime() - stripStart) / MS_PER_DAY * CELL_WIDTH;
            const todayLineX = 16 + nowOffsetPx;

            return (
              <>
              {/* 左: イベントラベル固定列（横スクロールしても動かない） */}
              <div style={{ width: LABEL_W, flexShrink: 0, paddingLeft: 16, boxSizing: "border-box" }}>
                <div style={{ height: HEADER_SPACER }} />
                {clusters.map((c, ci) => (
                  <div key={c.key} style={{ height: clusterH(c), boxSizing: "border-box", display: "flex", alignItems: "center", paddingRight: 8, ...(ci > 0 ? { borderTop: "1px solid rgba(0,0,0,0.06)" } : {}) }}>
                    <span style={{ fontSize: 10, fontWeight: 800, lineHeight: 1.2, color: "#191c1d", borderLeft: "3px solid #000000", paddingLeft: 6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } as React.CSSProperties}>
                      {c.name}
                    </span>
                  </div>
                ))}
              </div>
              {/* 右: タイムライン */}
              <div
                ref={stripRef}
                onScroll={handleStripScroll}
                style={{ overflowX: "auto", flex: 1, minWidth: 0, scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
              >
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

                  {clusters.length === 0 ? (
                    <div style={{ height: 32, display: "flex", alignItems: "center", fontSize: 10, color: "#bbb" }}>
                      表示できる予定なし
                    </div>
                  ) : (
                    clusters.map((cluster, ci) => (
                      <div key={cluster.key} style={{ height: clusterH(cluster), boxSizing: "border-box", paddingTop: 5, paddingBottom: 3, overflow: "hidden", ...(ci > 0 ? { borderTop: "1px solid rgba(0,0,0,0.06)" } : {}) }}>
                        {cluster.ticketRows.map(({ p, label }) => renderTicketLane(p, label))}
                        {cluster.goods && renderGoodsLane(cluster.goods)}
                      </div>
                    ))
                  )}
                </div>
              </div>
              </div>
              </>
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

        // ── グッズ販売期間のツールチップ ──
        const goodsTip = goodsPeriods.find((gp) => gp.id === tooltipUid);
        if (goodsTip) {
          return (
            <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setTooltipUid(null)}>
              <div
                style={{ position: "fixed", left: Math.max(8, x), top: Math.max(8, y), width: tipW, background: "#ffffff", border: "1px solid #000000", borderRadius: 0, padding: "12px 14px", zIndex: 51, fontSize: 11 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ fontWeight: 700, fontSize: 11, lineHeight: 1.4, marginBottom: 10, color: "#191c1d" }}>
                  {goodsTip.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.6875rem", fontWeight: 700, color: "#777" }}>通販開始</span>
                    <span style={{ fontWeight: 700, color: "#191c1d", fontSize: 10 }}>{fmtDate(goodsTip.start!)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.6875rem", fontWeight: 700, color: "#777" }}>受付締切</span>
                    <span style={{ fontWeight: 700, color: "#ba1a1a", fontSize: 10 }}>{fmtDate(goodsTip.end)}</span>
                  </div>
                </div>
                {goodsTip.url && (
                  <a
                    href={goodsTip.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "block", marginTop: 10, padding: "7px 0", textAlign: "center", background: "#000000", color: "#ffffff", borderRadius: 0, fontSize: "0.6875rem", fontWeight: 700, textDecoration: "none", letterSpacing: "0.05em", textTransform: "uppercase" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    商品ページを開く →
                  </a>
                )}
              </div>
            </div>
          );
        }

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

      {/* ─── グッズ締切フォールバック（通販開始が照合できずガント未掲載のものだけ・慎ましく） ─── */}
      {(() => {
        const startKeys = allDeadlines
          .filter((d) => d.type === "goods_sale_start")
          .map((d) => normGoodsKey(d.fc_news.title))
          .filter(Boolean);
        const isPaired = (title: string) => {
          const k = normGoodsKey(title);
          return !!k && startKeys.some((sk) => sk === k || sk.includes(k) || k.includes(sk));
        };
        const goods = allDeadlines
          .filter((d) => d.type === "goods_sale_end" && new Date(d.deadline_at) >= now && !isPaired(d.fc_news.title))
          .sort((a, b) => new Date(a.deadline_at).getTime() - new Date(b.deadline_at).getTime());
        if (goods.length === 0) return null;
        return (
          <section className="mb-8">
            <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-2">グッズ締切</p>
            <div className="flex flex-col">
              {goods.map((d) => {
                const end = new Date(d.deadline_at);
                const dateStr = end.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
                const timeStr = end.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
                return (
                  <a
                    key={d.id}
                    href={d.fc_news.detail_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 py-1.5 border-b border-outline-variant/10 text-outline hover:text-primary transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm flex-shrink-0">shopping_bag</span>
                    <span className="flex-1 min-w-0 truncate text-xs text-on-surface">{d.fc_news.title}</span>
                    <span className="text-[0.6875rem] flex-shrink-0">{dateStr} {timeStr}</span>
                  </a>
                );
              })}
            </div>
          </section>
        );
      })()}

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
                      {...(!isWatched && news.title.includes('BEYOOOOONDS') ? { 'data-demo-id': 'watchlist-beyo-hotel-add-btn' } : {})}
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
                    hasSubscription ? (
                      // 購読URL発行済み → 自動で配信されるので単発登録は出さない（二重登録防止）
                      <div className="flex items-center gap-3 px-4 py-3 bg-surface-container-high border-l-2 flex-wrap" style={{ borderColor: "#000000" }}>
                        <span className="material-symbols-outlined text-sm flex-shrink-0" style={{ color: "#000000" }}>check_circle</span>
                        <span className="text-xs font-bold flex-1">この予定は購読URLに追加されました（自動で配信されます）。</span>
                        <button
                          onClick={() => setPendingCalendarUid(null)}
                          className="px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-widest text-outline hover:text-primary cursor-pointer transition-colors"
                        >OK</button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 px-4 py-3 bg-surface-container-high border-l-2" style={{ borderColor: "#000000" }}>
                        <div className="flex items-center gap-3 flex-wrap">
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
                        <button
                          onClick={onGoSubscribe}
                          className="text-[0.625rem] text-outline hover:text-primary cursor-pointer transition-colors text-left underline underline-offset-2"
                        >毎回入れるのが面倒なら → まとめて購読する（Subscribe）</button>
                      </div>
                    )
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
                      {watchlistSet.has(news.uid) && (
                        <button
                          onClick={() => toggleWatchlist(news.uid)}
                          className="material-symbols-outlined text-xl cursor-pointer transition-colors flex-shrink-0"
                          style={{ color: "#000000", fontVariationSettings: `'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24` }}
                          title="気になるから削除"
                        >
                          bookmark
                        </button>
                      )}
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

  const isEvent = dl.type === "event";
  const calEvent: IcsEvent = {
    uid: dl.id + "@hop-up-tools",
    summary: "【" + dl.label + "】" + cleanFcTitle(dl.fc_news.title),
    description: dl.fc_news.title + "\n" + dl.fc_news.detail_url,
    dtstart: isEvent ? deadline : new Date(deadline.getTime() - 3600000),
    dtend: isEvent ? new Date(deadline.getTime() + 7200000) : deadline,
    location: dl.location ?? undefined,
    geo: geoForLocation(dl.location),
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
        {dl.location && (
          <p className="text-xs text-outline flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">place</span>{dl.location}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <AddToCalendarButton event={calEvent} demoid="watchlist-add-calendar-btn" />
      </div>
    </div>
  );
}

// ─── 画面D: 購読 ──────────────────────────────────────────

const SUBSCRIPTION_TYPES_TO_SUBSCRIBE = ["apply_start", "apply_end", "result", "payment_start", "payment", "sale_start", "sale_end", "event", "goods_sale_end"];

// 推しを登録していれば自動チェックする「申込前に動く」種別
const FAVORITE_ACTIONABLE_TYPES = ["apply_start", "apply_end", "sale_start", "sale_end", "event", "goods_sale_end"];

// 申込「確定」状態（もう申込締切の通知は要らない）を表すstatusキーワード
const APPLIED_STATUS_KEYWORDS = ["申込済", "当選", "落選", "入金済", "入金待ち", "当選取消"];

// 公演の出発通知リードタイム（ユーザー設定）。trigger=null は通知なし。
const EVENT_LEAD_OPTIONS: { key: string; label: string; trigger: string | null }[] = [
  { key: "P1D",  label: "前日", trigger: "-P1D" },
  { key: "PT3H", label: "3時間前", trigger: "-PT3H" },
  { key: "PT2H", label: "2時間前", trigger: "-PT2H" },
  { key: "PT1H", label: "1時間前", trigger: "-PT1H" },
  { key: "none", label: "通知なし", trigger: null },
];
function eventLeadTrigger(key: string): string | null {
  return (EVENT_LEAD_OPTIONS.find((o) => o.key === key) ?? EVENT_LEAD_OPTIONS[1]).trigger;
}

// 種類＋状況 → 通知(VALARM)配列。発行時に1回だけ算出して events に焼く（生成側は描画のみ）。
// isAttending=実際に行く公演か（当選/入金済）。出発通知は行く公演にだけ出す。
function alarmsForDeadline(type: string, isFirstShowOfDay: boolean, leadTrigger: string | null, isAttending: boolean): IcsAlarm[] {
  switch (type) {
    case "apply_end":
      return [{ trigger: "-P1D", description: "明日が申込締切です" }, { trigger: "-PT1H", description: "まもなく申込締切です" }];
    case "payment":
      return [{ trigger: "-P1D", description: "明日が入金締切です" }, { trigger: "-PT1H", description: "まもなく入金締切です" }];
    case "sale_end":
    case "goods_sale_end":
      return [{ trigger: "-P1D", description: "明日がグッズ締切です" }];
    case "result":
      return [{ trigger: "-P1D", description: "明日 当落発表です" }];
    case "apply_start":
      return [{ trigger: "-PT1H", description: "まもなく申込開始です" }];
    case "sale_start":
      return [{ trigger: "-PT1H", description: "まもなくグッズ販売開始です" }];
    case "payment_start":
      return [{ trigger: "-PT1H", description: "まもなく入金開始です" }];
    case "event":
      // 公演＝出発通知。行く公演(当選/入金済)・その日の最初・リードタイム設定ありの時だけ1本。
      if (!isAttending || !isFirstShowOfDay || !leadTrigger) return [];
      return [{ trigger: leadTrigger, description: "そろそろお出かけの時間です（本日公演）" }];
    default:
      return [{ trigger: "-P1D", description: "明日が締切です" }, { trigger: "-PT1H", description: "まもなく締切です" }];
  }
}

// ─── 推し（favorites）によるタイトル自動マッチ ────────────────
// ③全体イベント用キーワード（全グループ出演 → 推しがいれば該当）
const WHOLE_EVENT_KEYWORDS = ["ハロ！コン", "ハロコン", "ひなフェス", "Hello! Project 20", "ハロー！プロジェクト 20"];

// グループ名 → タイトル中の検出キー（GROUP_KEYS と同じ語幹）
const GROUP_TITLE_KEYS: Record<string, string[]> = {
  "モーニング娘。'26": ["モーニング娘"],
  "アンジュルム": ["アンジュルム"],
  "Juice=Juice": ["Juice=Juice"],
  "つばきファクトリー": ["つばきファクトリー"],
  "BEYOOOOONDS": ["BEYOOOOONDS", "CHICA#TETSU", "雨ノ森 川海", "SeasoningS"],
  "OCHA NORMA": ["OCHA NORMA"],
  "ロージークロニクル": ["ロージークロニクル"],
};

const OG_NAME_LIST = OG_MEMBERS.map((m) => m.name);

function favoritesAreEmpty(f: Favorites): boolean {
  return f.members.length === 0 && f.groups.length === 0;
}

// タイトルが推し（①メンバー名 ②グループ名 ③全体イベント）に該当するか
function titleMatchesFavorites(title: string, f: Favorites): boolean {
  // ① 推しメンバー名
  if (f.members.some((name) => title.includes(name))) return true;
  // ② 推しグループ名（OG枠は OGメンバー名のいずれか）
  for (const g of f.groups) {
    if (g === OG_GROUP_LABEL) {
      if (OG_NAME_LIST.some((name) => title.includes(name))) return true;
    } else {
      const keys = GROUP_TITLE_KEYS[g];
      if (keys && keys.some((k) => title.includes(k))) return true;
    }
  }
  // ③ 全体イベント（推しを1人でも登録していれば）
  if (!favoritesAreEmpty(f) && WHOLE_EVENT_KEYWORDS.some((k) => title.includes(k))) return true;
  return false;
}

// 締切リストを公演キーで束ねる（出現順＝最早締切順を維持）
function groupDeadlinesByEvent(deadlines: Deadline[]): { key: string; deadlines: Deadline[] }[] {
  const map = new Map<string, Deadline[]>();
  for (const dl of deadlines) {
    const key = eventGroupKey(dl.fc_news.title);
    const arr = map.get(key);
    if (arr) arr.push(dl);
    else map.set(key, [dl]);
  }
  return [...map.entries()].map(([key, dls]) => ({ key, deadlines: dls }));
}

function computeDefaultIncluded(
  deadlines: Deadline[],
  matchResults: MatchResult[],
  watchlistSet: Set<string>,
  appliedSet: Set<string>,
  paidSet: Set<string>,
  favorites: Favorites,
): Set<string> {
  const now = new Date();
  const statusByNewsUid = new Map<string, string>();
  for (const r of matchResults) {
    for (const m of r.matched) {
      statusByNewsUid.set(m.uid, r.parsed.status);
    }
  }

  // 自分が関わる公演（貼った/申込済/入金済）の eventGroupKey 集合。
  // 部や当落で出し分けず、この公演グループの「これから来る予定」は全部チェックする方針。
  // （過去の締切は下の時間フィルタで自然に除外されるので、入金済の人に過ぎた申込締切が出る等は起きない）
  const involvedGroups = new Set<string>();
  // 申込が確定した news_uid（申込締切の通知はもう不要）／入金済の news_uid（入金締切も不要）。
  // ※ news_uid 単位で判定。グループ単位で消すと二次募集・別部を巻き込むのでNG。
  const appliedUids = new Set<string>();
  const paidUids = new Set<string>();
  for (const dl of deadlines) {
    const st = statusByNewsUid.get(dl.news_uid) ?? "";
    const involved = statusByNewsUid.has(dl.news_uid) || appliedSet.has(dl.news_uid) || paidSet.has(dl.news_uid);
    if (involved) involvedGroups.add(eventGroupKey(dl.fc_news.title));
    if (appliedSet.has(dl.news_uid) || paidSet.has(dl.news_uid) || APPLIED_STATUS_KEYWORDS.some((k) => st.includes(k))) {
      appliedUids.add(dl.news_uid);
    }
    if (paidSet.has(dl.news_uid) || st.includes("入金済")) paidUids.add(dl.news_uid);
  }

  const included = new Set<string>();
  for (const dl of deadlines) {
    if (new Date(dl.deadline_at) < now) continue;
    if (!SUBSCRIPTION_TYPES_TO_SUBSCRIBE.includes(dl.type)) continue;

    // 関わる公演 = 二次/追加受付・公演予定・グッズ含め、未来の予定を全部ON
    if (involvedGroups.has(eventGroupKey(dl.fc_news.title))) {
      if (dl.type === "apply_end" && appliedUids.has(dl.news_uid)) continue; // 申込済→申込締切は配信しない
      if (dl.type === "payment" && paidUids.has(dl.news_uid)) continue;      // 入金済→入金締切は配信しない
      included.add(dl.id);
      continue;
    }

    // 推し・気になる = 申込前に動く予定だけON
    if (watchlistSet.has(dl.news_uid) || titleMatchesFavorites(dl.fc_news.title, favorites)) {
      if (FAVORITE_ACTIONABLE_TYPES.includes(dl.type)) included.add(dl.id);
    }
  }
  return included;
}

function statusBadgeFor(newsUid: string, matchResults: MatchResult[], appliedSet: Set<string>, paidSet: Set<string>): { label: string; tone: "primary" | "muted" | "danger" } | null {
  const m = matchResults.find((r) => r.matched.some((mm) => mm.uid === newsUid));
  if (m) {
    if (m.parsed.status.includes("入金済")) return { label: "入金済", tone: "muted" };
    if (m.parsed.status.includes("当選")) return { label: "当選", tone: "primary" };
    if (m.parsed.status.includes("落選")) return { label: "落選", tone: "danger" };
    return { label: "申込済み", tone: "primary" };
  }
  if (paidSet.has(newsUid)) return { label: "入金済", tone: "muted" };
  if (appliedSet.has(newsUid)) return { label: "申込済み", tone: "primary" };
  return null;
}

function SubscribeScreen({
  allDeadlines,
  matchResults,
  watchlist,
  onWatchlistChange,
  applied,
  onAppliedChange,
  paid,
}: {
  allDeadlines: Deadline[];
  matchResults: MatchResult[];
  watchlist: string[];
  onWatchlistChange: (uids: string[]) => void;
  applied: string[];
  onAppliedChange: (uids: string[]) => void;
  paid: string[];
}) {
  const watchlistSet = useMemo(() => new Set(watchlist), [watchlist]);
  const appliedSet = useMemo(() => new Set(applied), [applied]);
  const paidSet = useMemo(() => new Set(paid), [paid]);

  const [slug, setSlug] = useState<string | null>(() => {
    try { return localStorage.getItem("fc-sub-slug"); } catch { return null; }
  });
  const [retention, setRetention] = useState<RetentionMode>(() => {
    try {
      const v = localStorage.getItem("fc-sub-retention");
      if (v === "after-event-1m" || v === "6m" || v === "forever") return v;
    } catch { /* ignore */ }
    return "after-event-1m";
  });
  // 公演の出発通知リードタイム（前日/3時間前/.../通知なし）
  const [eventLead, setEventLead] = useState<string>(() => {
    try { return localStorage.getItem("fc-sub-event-lead") ?? "PT3H"; } catch { return "PT3H"; }
  });
  const [includedIds, setIncludedIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("fc-sub-included");
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set<string>();
  });
  const [favorites, setFavorites] = useState<Favorites>(() => {
    try {
      const saved = localStorage.getItem("fc-sub-favorites");
      if (saved) {
        const v = JSON.parse(saved);
        return { members: v.members ?? [], groups: v.groups ?? [] };
      }
    } catch { /* ignore */ }
    return { members: [], groups: [] };
  });
  const [initialized, setInitialized] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishedUrls, setPublishedUrls] = useState<SubscriptionUrls | null>(() => slug ? subscriptionUrls(slug) : null);
  const [copied, setCopied] = useState(false);
  // 自動保存（発行済みなら選択変更をdebounce 2sでサーバ反映。差分スキップ＋離脱時保存）
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const lastSavedSigRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  // ?focus=<公演キー>: 予定メモの「通知の変更」リンクから該当公演へ直行（スクロール＋一瞬ハイライト）
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  useEffect(() => {
    const f = searchParams.get("focus");
    if (!f) return;
    setPendingFocus(f);
    // 消費したらURLから外す（リロード・履歴戻りで毎回スクロールさせない）
    const next = new URLSearchParams(searchParams);
    next.delete("focus");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // 初回マウント時、保存済みincludedが無い場合だけ自動デフォルト計算
  useEffect(() => {
    if (initialized) return;
    if (allDeadlines.length === 0) return;
    const saved = (() => { try { return localStorage.getItem("fc-sub-included"); } catch { return null; } })();
    if (saved) {
      setInitialized(true);
      return;
    }
    setIncludedIds(computeDefaultIncluded(allDeadlines, matchResults, watchlistSet, appliedSet, paidSet, favorites));
    setInitialized(true);
  }, [allDeadlines, matchResults, watchlistSet, appliedSet, paidSet, favorites, initialized]);

  function persistIncluded(next: Set<string>) {
    setIncludedIds(next);
    try { localStorage.setItem("fc-sub-included", JSON.stringify([...next])); } catch { /* ignore */ }
  }

  function persistFavorites(next: Favorites) {
    setFavorites(next);
    try { localStorage.setItem("fc-sub-favorites", JSON.stringify(next)); } catch { /* ignore */ }
  }

  // 推しを追加・変更したら、該当する「申込前に動く」予定を自動でチェックに追加（追加のみ・手動の外しは尊重）
  useEffect(() => {
    if (!initialized) return;
    if (favoritesAreEmpty(favorites)) return;
    const now = new Date();
    const toAdd: string[] = [];
    for (const dl of allDeadlines) {
      if (new Date(dl.deadline_at) < now) continue;
      if (!FAVORITE_ACTIONABLE_TYPES.includes(dl.type)) continue;
      if (includedIds.has(dl.id)) continue;
      if (titleMatchesFavorites(dl.fc_news.title, favorites)) toAdd.push(dl.id);
    }
    if (toAdd.length > 0) persistIncluded(new Set([...includedIds, ...toAdd]));
    // includedIds は依存に含めない（追加のたびに再発火させない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favorites, initialized, allDeadlines]);

  // Importで貼り直したら、その公演グループの未来の予定を自動でチェックに追加（追加のみ・手動の外しは尊重）
  useEffect(() => {
    if (!initialized) return;
    if (matchResults.length === 0) return;
    const matchedUids = new Set(matchResults.flatMap((r) => r.matched.map((m) => m.uid)));
    const statusByUid = new Map<string, string>();
    for (const r of matchResults) for (const m of r.matched) statusByUid.set(m.uid, r.parsed.status);
    const isApplied = (uid: string) => appliedSet.has(uid) || paidSet.has(uid) || APPLIED_STATUS_KEYWORDS.some((k) => (statusByUid.get(uid) ?? "").includes(k));
    const isPaid = (uid: string) => paidSet.has(uid) || (statusByUid.get(uid) ?? "").includes("入金済");
    const involved = new Set<string>();
    for (const dl of allDeadlines) {
      if (matchedUids.has(dl.news_uid)) involved.add(eventGroupKey(dl.fc_news.title));
    }
    if (involved.size === 0) return;
    const now = new Date();
    const toAdd: string[] = [];
    for (const dl of allDeadlines) {
      if (new Date(dl.deadline_at) < now) continue;
      if (!SUBSCRIPTION_TYPES_TO_SUBSCRIBE.includes(dl.type)) continue;
      if (includedIds.has(dl.id)) continue;
      if (dl.type === "apply_end" && isApplied(dl.news_uid)) continue; // 申込済→申込締切は再追加しない
      if (dl.type === "payment" && isPaid(dl.news_uid)) continue;      // 入金済→入金締切は再追加しない
      if (involved.has(eventGroupKey(dl.fc_news.title))) toAdd.push(dl.id);
    }
    if (toAdd.length > 0) persistIncluded(new Set([...includedIds, ...toAdd]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchResults, initialized, allDeadlines]);

  // ── 自動保存（発行済みのみ・debounce 2s・差分スキップ・離脱時flush） ──
  // タイマー/リスナーから最新値を読むためのref（毎レンダーで更新）
  const includedRef = useRef(includedIds); includedRef.current = includedIds;
  const retentionRef = useRef(retention); retentionRef.current = retention;
  const slugRef = useRef(slug); slugRef.current = slug;
  const allDeadlinesRef = useRef(allDeadlines); allDeadlinesRef.current = allDeadlines;
  const eventLeadRef = useRef(eventLead); eventLeadRef.current = eventLead;
  const matchResultsRef = useRef(matchResults); matchResultsRef.current = matchResults;
  const paidRef = useRef(paid); paidRef.current = paid;
  function selectionSig(ids: Set<string>, ret: RetentionMode): string {
    return [...ids].sort().join(",") + "|" + ret + "|" + eventLeadRef.current;
  }
  // 初期化後、現在の状態を「保存済み」とみなす（タブを開いただけでは発行しない）
  useEffect(() => {
    if (initialized && lastSavedSigRef.current === null) {
      lastSavedSigRef.current = selectionSig(includedIds, retention);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized]);
  // 変更をdebounce 2sで自動発行（前回保存と差分があるときだけ）
  useEffect(() => {
    if (!initialized || !slug || lastSavedSigRef.current === null) return;
    if (selectionSig(includedIds, retention) === lastSavedSigRef.current) return; // 差分なし→何もしない
    setSaveState("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { void handlePublish({ silent: true }); }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedIds, retention, eventLead, initialized, slug]);
  // 離脱時（タブ移動/ページ非表示/閉じる）に保留中の変更を即発行
  useEffect(() => {
    function flush() {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      const ids = includedRef.current, ret = retentionRef.current;
      if (slugRef.current && ids.size > 0 && selectionSig(ids, ret) !== lastSavedSigRef.current) {
        void handlePublish({ silent: true });
      }
    }
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush(); // アンマウント＝Subscribeタブから離脱
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // チェックの付け外しは双子セット（畳まれた同一公演の全id）単位で同期させる
  function toggleDeadline(id: string) {
    const twins = twinIdsOf(id);
    const anyIn = twins.some((t) => includedIds.has(t));
    const next = new Set(includedIds);
    for (const t of twins) { if (anyIn) next.delete(t); else next.add(t); }
    persistIncluded(next);
  }

  // 公演まるごとON/OFF（全部入ってたら全部外す、そうでなければ全部入れる）
  function toggleGroup(dls: Deadline[]) {
    const allIn = dls.every((d) => twinIdsOf(d.id).some((t) => includedIds.has(t)));
    const next = new Set(includedIds);
    for (const d of dls) {
      for (const t of twinIdsOf(d.id)) { if (allIn) next.delete(t); else next.add(t); }
    }
    persistIncluded(next);
  }

  // この公演を一覧から外す：気になる解除＋チェック全解除（申込締切後に居座る公演を消せるように）
  function removeEventFromList(dls: Deadline[]) {
    const uids = new Set(dls.map((d) => d.news_uid));
    onWatchlistChange(watchlist.filter((u) => !uids.has(u)));
    const ids = new Set(dls.flatMap((d) => twinIdsOf(d.id)));
    persistIncluded(new Set([...includedIds].filter((id) => !ids.has(id))));
  }

  function persistRetention(mode: RetentionMode) {
    setRetention(mode);
    try { localStorage.setItem("fc-sub-retention", mode); } catch { /* ignore */ }
    // 発行済みなら自動保存effectがdebounceでサーバ反映する（ここでは即時発行しない）
  }

  function persistEventLead(key: string) {
    setEventLead(key);
    try { localStorage.setItem("fc-sub-event-lead", key); } catch { /* ignore */ }
    // 反映は自動保存effectがdebounceで行う
  }

  // 申込締切の行で「申込んだ」＝申込済を記録＋その申込締切を配信から外す（自動保存で反映）
  function markApplied(dl: Deadline) {
    if (!appliedSet.has(dl.news_uid)) onAppliedChange([...applied, dl.news_uid]);
    if (includedIds.has(dl.id)) {
      const next = new Set(includedIds);
      next.delete(dl.id);
      persistIncluded(next);
    }
  }

  const now = new Date();
  const futureDeadlinesRaw = allDeadlines
    .filter((dl) => SUBSCRIPTION_TYPES_TO_SUBSCRIBE.includes(dl.type))
    .filter((dl) => new Date(dl.deadline_at) >= now)
    .filter((dl) => {
      // 関連のあるものだけ表示: matched / watchlist / applied / 既に購読対象
      return (
        matchResults.some((r) => r.matched.some((m) => m.uid === dl.news_uid)) ||
        watchlistSet.has(dl.news_uid) ||
        appliedSet.has(dl.news_uid) ||
        includedIds.has(dl.id) ||
        titleMatchesFavorites(dl.fc_news.title, favorites)
      );
    })
    .sort((a, b) => new Date(a.deadline_at).getTime() - new Date(b.deadline_at).getTime());

  // 同一公演の「公演」行が複数のお知らせから生えて二重になるのを畳む（表示は代表1行）
  const { deduped: futureDeadlines, twinIdsByRepId } = dedupeEventTwins(futureDeadlinesRaw);
  // 代表id → 双子全id（畳んでいない行は自分だけ）。チェックの判定・操作はこの単位で行う
  const twinIdsOf = (id: string) => twinIdsByRepId.get(id) ?? [id];
  const isIncluded = (dl: Deadline) => twinIdsOf(dl.id).some((id) => includedIds.has(id));
  // ステータスバッジ（当選/入金済等）は双子のどのお知らせ由来でも拾う
  const dlById = new Map(futureDeadlinesRaw.map((d) => [d.id, d]));
  const badgeForTwins = (dl: Deadline) => {
    for (const id of twinIdsOf(dl.id)) {
      const b = statusBadgeFor(dlById.get(id)?.news_uid ?? dl.news_uid, matchResults, appliedSet, paidSet);
      if (b) return b;
    }
    return null;
  };

  // 完了済み (入金済 or paid) のDeadlineを分離
  const completedDeadlines = futureDeadlines.filter((dl) => {
    const status = matchResults.find((r) => r.matched.some((m) => m.uid === dl.news_uid))?.parsed.status ?? "";
    return status.includes("入金済") || paidSet.has(dl.news_uid);
  });
  const activeDeadlines = futureDeadlines.filter((dl) => !completedDeadlines.includes(dl));

  // 公演単位グルーピング（配信する予定を公演キーで束ねて表示）
  const activeGroups = groupDeadlinesByEvent(activeDeadlines);
  const completedGroups = groupDeadlinesByEvent(completedDeadlines);

  // pendingFocus の公演が画面に現れたらスクロール＋ハイライト。
  // 依存配列なし＝毎レンダー後に試行：データ読込前にリンクを開いても、読込完了の再レンダーで自然に発火する。
  useEffect(() => {
    if (!pendingFocus) return;
    if (!showCompleted && completedGroups.some((g) => g.key === pendingFocus)) {
      setShowCompleted(true); // 完了済み側に居る公演は折りたたみを開いてから（次のレンダーで続き）
      return;
    }
    const el = document.querySelector(`[data-event-group="${CSS.escape(pendingFocus)}"]`);
    if (!el) return; // まだ描画されていない（該当公演がデータに無い場合は何もしないまま）
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const key = pendingFocus;
    setHighlightKey(key);
    setPendingFocus(null);
    window.setTimeout(() => setHighlightKey((cur) => (cur === key ? null : cur)), 2000);
  });

  async function handlePublish(opts?: { silent?: boolean }) {
    const silent = opts?.silent ?? false;
    // 最新値はrefから（タイマー/離脱リスナー経由でも正しく読む）
    const ids = includedRef.current;
    const ret = retentionRef.current;
    const sl = slugRef.current;
    const deadlines = allDeadlinesRef.current;
    if (ids.size === 0) {
      if (!silent) setError("配信する予定が1つも選択されていません。");
      return;
    }
    setError(null);
    if (silent) setSaveState("saving"); else setPublishing(true);
    try {
      const useSlug = sl ?? generateSubscriptionSlug();
      const chosenRaw = [...ids]
        .map((id) => deadlines.find((dl) => dl.id === id))
        .filter((dl): dl is Deadline => !!dl);
      // 双子（同一公演の重複event行）は1本だけ配信＝カレンダーに同じ公演が2個並ばない
      const chosen = dedupeEventTwins(chosenRaw).deduped;
      // 同日の公演のうち「最も早い1件」を出発通知の対象に（2部以降は会場に居るので通知なし）
      const firstEventByDate = new Map<string, string>(); // 日付キー → 最早の event の dl.id
      for (const dl of chosen) {
        if (dl.type !== "event") continue;
        const d = new Date(dl.deadline_at);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const cur = firstEventByDate.get(key);
        if (!cur || new Date(dl.deadline_at) < new Date(chosen.find((x) => x.id === cur)!.deadline_at)) {
          firstEventByDate.set(key, dl.id);
        }
      }
      const firstEventIds = new Set(firstEventByDate.values());
      const leadTrigger = eventLeadTrigger(eventLeadRef.current);
      // 「実際に行く公演」判定（当選 or 入金済）。出発通知はここだけに出す。
      const statusByUid = new Map<string, string>();
      for (const r of matchResultsRef.current) for (const m of r.matched) statusByUid.set(m.uid, r.parsed.status);
      const paidSetNow = new Set(paidRef.current);
      const isAttending = (uid: string) => {
        const st = statusByUid.get(uid) ?? "";
        return paidSetNow.has(uid) || st.includes("入金済") || (st.includes("当選") && !st.includes("当選取消"));
      };
      // 予定メモから設定にすぐ飛べるリンク（公演キー付き＝開くと該当公演までスクロール）
      const settingsUrlFor = (title: string) =>
        "https://hop-up-tools.pages.dev/fc-ticket?tab=subscribe&focus=" + encodeURIComponent(eventGroupKey(title));
      const events: IcsEvent[] = chosen.map((dl) => {
        const at = new Date(dl.deadline_at);
        // 公演(event)は「開演〜2時間」の予定として扱う。締切類は「締切の1時間前〜締切」。
        const isEvent = dl.type === "event";
        return {
          uid: dl.id + "@hop-up-tools",
          summary: "【" + dl.label + "】" + cleanFcTitle(dl.fc_news.title),
          description: dl.fc_news.title + "\n" + dl.fc_news.detail_url + "\n\n通知の変更: " + settingsUrlFor(dl.fc_news.title),
          dtstart: isEvent ? at : new Date(at.getTime() - 3600000),
          dtend: isEvent ? new Date(at.getTime() + 7200000) : at,
          location: dl.location ?? undefined,
          // 会場座標も発行時に焼き込む（regenは描画のみ）
          geo: geoForLocation(dl.location),
          // 通知は発行時に算出して焼き込む（生成側・regenは描画のみ）
          alarms: alarmsForDeadline(dl.type, isEvent && firstEventIds.has(dl.id), leadTrigger, isAttending(dl.news_uid)),
        };
      });
      if (events.length === 0) {
        if (!silent) setError("配信する予定が1つも選択されていません。");
        return;
      }
      const ics = generateMultiIcs(events);
      const urls = await uploadSubscriptionIcs(useSlug, ics, events, ret);
      if (!sl) {
        setSlug(useSlug);
        try { localStorage.setItem("fc-sub-slug", useSlug); } catch { /* ignore */ }
      }
      setPublishedUrls(urls);
      lastSavedSigRef.current = selectionSig(ids, ret); // 保存済みシグネチャ更新（差分スキップ用）
      if (silent) {
        setSaveState("saved");
        window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 2000);
      }
    } catch (e) {
      if (!silent) setError("URLの発行に失敗しました: " + (e instanceof Error ? e.message : String(e)));
      else setSaveState("idle");
    } finally {
      if (!silent) setPublishing(false);
    }
  }

  async function handleDelete() {
    if (!slug) return;
    if (!confirm("購読URLを無効化します。\nスマホのカレンダーアプリでも購読の解除をお願いします。\n（設定 → カレンダー → アカウント → 該当カレンダーを削除）")) return;
    setDeleting(true);
    try {
      await deleteSubscriptionIcs(slug);
      setSlug(null);
      setPublishedUrls(null);
      try {
        localStorage.removeItem("fc-sub-slug");
      } catch { /* ignore */ }
    } catch (e) {
      setError("削除に失敗しました: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeleting(false);
    }
  }

  function handleCopy() {
    if (!publishedUrls) return;
    navigator.clipboard.writeText(publishedUrls.https).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // 双子は1公演として数える（＝実際にカレンダーへ配信される予定数と一致させる）
  const includedCount = dedupeEventTwins(allDeadlines.filter((dl) => includedIds.has(dl.id))).deduped.length;

  return (
    <main className="pt-8 pb-32 px-6 max-w-4xl mx-auto">
      {/* 自動保存トースト：フッターナビの上に固定表示（スクロール位置に関係なく必ず見える） */}
      {saveState !== "idle" && (
        <div
          className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[60] px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-widest pointer-events-none inline-flex items-center gap-1.5"
          style={{ background: "#ffffff", color: "#777", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 8px rgba(0,0,0,0.10)" }}
          aria-live="polite"
        >
          <span className="material-symbols-outlined text-sm" style={{ color: "#bbb" }}>{saveState === "saving" ? "cloud_sync" : "cloud_done"}</span>
          {saveState === "saving" ? "保存中…" : "保存しました"}
        </div>
      )}
      <div className="mb-8">
        <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline">Section</span>
        <h2 className="text-5xl font-extrabold tracking-tighter leading-none mt-2">
          SUBSCRIBE
        </h2>
        <p className="text-sm text-on-surface-variant mt-3">
          カレンダーアプリと自動同期できる購読URLを発行します。
        </p>
      </div>

      {/* 推しを登録セクション */}
      <FavoritePicker favorites={favorites} onChange={persistFavorites} />

      {/* 配信する予定セクション */}
      <section className="mb-8">
        <div className="flex items-baseline justify-between border-b border-outline-variant/30 pb-2 mb-4">
          <h3 className="text-[0.6875rem] font-bold uppercase tracking-widest">配信する予定</h3>
          <span className="text-[0.6875rem] text-outline">{includedCount}件選択中</span>
        </div>

        {activeDeadlines.length === 0 && completedDeadlines.length === 0 && (
          <p className="text-sm text-on-surface-variant py-8 text-center">
            まず Input タブで申込状況を貼り付けるか、Calendar タブで気になる公演を追加してください。
          </p>
        )}

        <div className="space-y-4">
          {activeGroups.map((g) => {
            const allChecked = g.deadlines.every((d) => isIncluded(d));
            return (
              <div
                key={g.key}
                data-event-group={g.key}
                className="-mx-2 px-2 py-1"
                style={{ background: highlightKey === g.key ? "rgba(0,0,0,0.07)" : "transparent", transition: "background 0.7s ease" }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <button
                    onClick={() => toggleGroup(g.deadlines)}
                    className="flex items-center gap-2 text-left flex-1 min-w-0 cursor-pointer"
                    title="公演まるごとON/OFF"
                  >
                    <span className={`w-3.5 h-3.5 flex-shrink-0 border ${allChecked ? "bg-primary border-primary" : "bg-transparent border-outline-variant"}`} />
                    <span className="text-sm font-bold leading-snug">{g.key}</span>
                  </button>
                  <span className="text-[0.625rem] text-outline flex-shrink-0">{g.deadlines.length}件</span>
                  <button
                    onClick={() => removeEventFromList(g.deadlines)}
                    className="material-symbols-outlined text-base text-outline hover:text-error cursor-pointer flex-shrink-0 leading-none"
                    title="この公演を一覧から外す（気になる解除）"
                  >close</button>
                </div>
                <div className="space-y-1 pl-5">
                  {g.deadlines.map((dl) => (
                    <DeadlineCheckRow
                      key={dl.id}
                      dl={dl}
                      checked={isIncluded(dl)}
                      onToggle={() => toggleDeadline(dl.id)}
                      statusBadge={badgeForTwins(dl)}
                      hideTitle
                      onMarkApplied={dl.type === "apply_end" && !appliedSet.has(dl.news_uid) ? () => markApplied(dl) : undefined}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {completedDeadlines.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline hover:text-primary cursor-pointer"
            >
              {showCompleted ? "▾" : "▸"} 完了済みの予定 ({completedDeadlines.length})
            </button>
            {showCompleted && (
              <div className="mt-2 space-y-4 opacity-60">
                {completedGroups.map((g) => (
                  <div
                    key={g.key}
                    data-event-group={g.key}
                    className="-mx-2 px-2 py-1"
                    style={{ background: highlightKey === g.key ? "rgba(0,0,0,0.07)" : "transparent", transition: "background 0.7s ease" }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold leading-snug">{g.key}</span>
                      <span className="text-[0.625rem] text-outline ml-auto flex-shrink-0">{g.deadlines.length}件</span>
                    </div>
                    <div className="space-y-1 pl-5">
                      {g.deadlines.map((dl) => (
                        <DeadlineCheckRow
                          key={dl.id}
                          dl={dl}
                          checked={isIncluded(dl)}
                          onToggle={() => toggleDeadline(dl.id)}
                          statusBadge={badgeForTwins(dl)}
                          hideTitle
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 公演の通知タイミング（出発の目安） */}
      <section className="mb-8">
        <div className="flex items-baseline justify-between border-b border-outline-variant/30 pb-2 mb-4">
          <h3 className="text-[0.6875rem] font-bold uppercase tracking-widest">公演の通知</h3>
        </div>
        <select
          value={eventLead}
          onChange={(e) => persistEventLead(e.target.value)}
          className="w-full md:w-auto bg-surface-container-low border border-outline-variant/30 px-4 py-2 text-sm cursor-pointer"
        >
          {EVENT_LEAD_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label === "通知なし" ? "通知なし" : `公演の${o.label}`}</option>
          ))}
        </select>
        <p className="text-[0.6875rem] text-outline mt-2">
          ※ 出発の目安に通知します。会場までの距離・準備時間に合わせて選んでください。同じ日に2部以上ある時は、最初の公演にだけ通知します。
        </p>
      </section>

      {/* 保持期限セレクト */}
      <section className="mb-8">
        <div className="flex items-baseline justify-between border-b border-outline-variant/30 pb-2 mb-4">
          <h3 className="text-[0.6875rem] font-bold uppercase tracking-widest">保持期限</h3>
        </div>
        <select
          value={retention}
          onChange={(e) => persistRetention(e.target.value as RetentionMode)}
          className="w-full md:w-auto bg-surface-container-low border border-outline-variant/30 px-4 py-2 text-sm cursor-pointer"
        >
          <option value="after-event-1m">公演終了+1ヶ月後に自動削除（推奨）</option>
          <option value="6m">6ヶ月後に自動削除</option>
          <option value="forever">自分で削除するまで保持</option>
        </select>
        <p className="text-[0.6875rem] text-outline mt-2">
          ※ 終了した予定は毎日の自動更新でカレンダーから整理されます（カレンダーアプリ側の同期タイミングにより反映が遅れる場合あり）。
        </p>
      </section>

      {/* URL発行/表示エリア */}
      <section className="mb-8">
        <div className="flex items-baseline justify-between border-b border-outline-variant/30 pb-2 mb-4">
          <h3 className="text-[0.6875rem] font-bold uppercase tracking-widest">購読URL</h3>
        </div>

        {!publishedUrls ? (
          <div className="space-y-3">
            <button
              onClick={() => handlePublish()}
              disabled={publishing || includedCount === 0}
              className="bg-primary text-on-primary-fixed px-8 py-4 text-sm font-bold uppercase tracking-[0.2em] hover:bg-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              {publishing ? "発行中…" : "URLを発行する"}
            </button>
            {/* 操作の瞬間の一言（段階表示） */}
            <p className="text-xs text-on-surface-variant">
              登録すると、選んだ締切がカレンダーに自動で並びます。新しい締切も自動で追加されます。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 主役：カレンダーに追加（この端末で購読登録） */}
            <a
              href={publishedUrls.webcal}
              className="bg-primary text-on-primary-fixed w-full px-6 py-4 text-sm font-bold uppercase tracking-[0.2em] hover:bg-secondary transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-base">calendar_add_on</span>
              カレンダーに追加
            </a>
            {/* 脇役：コピー（別端末用） */}
            <button
              onClick={handleCopy}
              className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline hover:text-primary transition-colors cursor-pointer inline-flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">content_copy</span>
              {copied ? "コピーしました" : "URLをコピー"}
            </button>
            {/* 発行完了直後の応援（C） */}
            <div className="pt-4 border-t border-outline-variant/30">
              <p className="text-sm text-on-surface-variant mb-3">
                このツールが役に立ったら、維持費の足しに応援してもらえると嬉しいです（任意）。
              </p>
              <a
                href="https://ofuse.me/hopuptools"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block bg-primary text-on-primary-fixed px-6 py-3 text-xs font-bold uppercase tracking-widest hover:bg-secondary transition-colors cursor-pointer"
              >
                応援する
              </a>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-tertiary bg-tertiary-container/30 px-4 py-3">{error}</p>
        )}
      </section>

      {/* 注意事項（普段は畳んでおく＝知りたい人だけ開く） */}
      <section className="mb-8">
        <details className="group">
          <summary className="flex items-center justify-between border-b border-outline-variant/30 pb-2 cursor-pointer list-none select-none">
            <h3 className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline">このツールについて</h3>
            <span className="material-symbols-outlined text-base text-outline transition-transform group-open:rotate-180">expand_more</span>
          </summary>
          <ul className="text-xs text-on-surface-variant space-y-2 list-disc list-inside mt-4">
            <li>このツールは締切を忘れないためのリマインダーです。予定にチェックを付けても、公演への申込・入金は完了しません。申込は各公式ページで行ってください。</li>
            <li>入力した申込状況や登録内容はお使いの端末内に保存され、運営が収集・分析することはありません。（購読URLを発行した場合のみ、選んだ予定がURL先に保管されます）</li>
            <li>カレンダーに登録すると、保存した締切が自動で表示されます。新しい締切は自動で追加、終わった予定は自動で整理されます（反映まで最大数時間。すぐ反映したい時は画面を下に引っ張って更新）。含まれるのは予定だけで、お名前・ログイン・支払いの情報は入りません。</li>
            <li>カレンダーアプリによっては読み取り専用で表示されます（編集できません）。</li>
            <li>このリンクはあなた専用です。保存した予定が入っているので、他の人には共有しないでください。</li>
          </ul>
        </details>
      </section>

      {/* URL無効化 */}
      {slug && (
        <section className="mt-12 pt-6 border-t border-outline-variant/30">
          <h3 className="text-[0.6875rem] font-bold uppercase tracking-widest text-outline mb-2">URLを無効化する</h3>
          <p className="text-xs text-on-surface-variant mb-3">
            購読URLを完全に削除します。流出が疑われる場合や、もう使わない場合に。
          </p>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs font-bold uppercase tracking-widest text-tertiary border border-tertiary px-4 py-2 hover:bg-tertiary hover:text-on-tertiary-container transition-colors cursor-pointer disabled:opacity-30"
          >
            {deleting ? "削除中…" : "URLを無効化"}
          </button>
        </section>
      )}

      {/* 応援（A・常設フッター） */}
      <footer className="mt-12 pt-6 border-t border-outline-variant/30">
        <p className="text-sm text-on-surface-variant mb-3">
          このツールは無料で運営しています。余裕があれば、サーバー代の維持に応援していただけると助かります。
        </p>
        <a
          href="https://ofuse.me/hopuptools"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-primary text-on-primary-fixed px-6 py-3 text-xs font-bold uppercase tracking-widest hover:bg-secondary transition-colors cursor-pointer"
        >
          応援する
        </a>
        <p className="text-[0.6875rem] text-outline mt-3">
          ※任意です。なくても全機能そのまま使えます。いただいた応援はサーバー代・運営の維持に使います（利益目的の運営ではありません）。
        </p>
      </footer>
    </main>
  );
}

function DeadlineCheckRow({
  dl,
  checked,
  onToggle,
  statusBadge,
  hideTitle = false,
  onMarkApplied,
}: {
  dl: Deadline;
  checked: boolean;
  onToggle: () => void;
  statusBadge: { label: string; tone: "primary" | "muted" | "danger" } | null;
  hideTitle?: boolean;
  onMarkApplied?: () => void;
}) {
  const deadline = new Date(dl.deadline_at);
  const dateStr = deadline.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
  const timeStr = deadline.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

  const badgeClass = statusBadge?.tone === "danger"
    ? "bg-tertiary-container text-on-tertiary-container"
    : statusBadge?.tone === "muted"
    ? "bg-surface-container text-outline"
    : "bg-primary text-on-primary-fixed";

  return (
    <label className="flex items-start gap-3 p-3 bg-surface-container-lowest hover:bg-surface-container-low cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1 w-4 h-4 cursor-pointer flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-xs font-bold text-on-surface">
            {dl.label}
          </span>
          <span className="text-xs font-bold">{dateStr} {timeStr}</span>
          {statusBadge && (
            <span className={`text-[0.5625rem] font-bold uppercase tracking-widest px-1.5 py-0.5 ${badgeClass}`}>
              {statusBadge.label}
            </span>
          )}
        </div>
        {!hideTitle && (
          <p className="text-xs text-on-surface-variant truncate">{dl.fc_news.title}</p>
        )}
        {onMarkApplied && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMarkApplied(); }}
            className="mt-1 text-[0.625rem] font-bold uppercase tracking-widest text-outline hover:text-primary cursor-pointer"
          >
            申込んだ → この通知を消す
          </button>
        )}
      </div>
    </label>
  );
}

// ─── ボトムナビ ───────────────────────────────────────────

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: { t: Tab; icon: string; label: string }[] = [
    { t: "calendar",  icon: "calendar_today", label: "Calendar" },
    { t: "input",     icon: "content_paste",  label: "Import" },
    { t: "subscribe", icon: "rss_feed",       label: "Subscribe" },
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
