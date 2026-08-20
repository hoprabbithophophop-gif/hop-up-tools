import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getSupabase } from "../../lib/supabase";

/* ===================================================================
   /schedule — ハロプロ公演スケジュール（全ファン向け・FC限定以外も）
   データ層: schedule_parent_events / schedule_child_events / schedule_venues
   設計: 親イベント=行、各公演=点、販売期間=帯 の混在ガント
   =================================================================== */

// ─── 型 ───────────────────────────────────────────────
interface Venue {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  nearest_station: string | null;
  is_online: boolean;
  prefecture: string | null;
  official_url: string | null;
}
interface ParentEvent {
  id: string;
  group_name: string;
  title: string;
  event_category: string;
  detail_url: string | null;
}
interface ChildEvent {
  id: string;
  parent_event_id: string;
  venue_id: string | null;
  event_format: string;
  sales_service: string | null;
  target_members: string[];
  event_date: string;          // YYYY-MM-DD
  event_open_time: string | null;  // HH:MM:SS 開場
  event_start_time: string | null; // HH:MM:SS 開演
  event_end_time: string | null;
  part_label: string | null;
  sales_start_at: string | null;  // ISO
  sales_end_at: string | null;
  application_url: string | null;
  is_fc_only: boolean;
  schedule_parent_events: ParentEvent | null;
  schedule_venues: Venue | null;
}

// ─── 定数 ─────────────────────────────────────────────
const GROUPS = [
  "モーニング娘。'26",
  "アンジュルム",
  "Juice=Juice",
  "つばきファクトリー",
  "BEYOOOOONDS",
  "OCHA NORMA",
  "ロージークロニクル",
  "ハロプロ研修生",
];

const MONTHS_EN = ["JAN.", "FEB.", "MAR.", "APR.", "MAY.", "JUN.", "JUL.", "AUG.", "SEP.", "OCT.", "NOV.", "DEC."];

const FORMAT_LABELS: Record<string, string> = {
  concert: "コンサート",
  mini_live: "ミニライブ",
  individual_talk: "個別お話し会",
  group_talk: "グループトーク",
  cheki: "チェキ会",
  sign: "サイン会",
  send_off: "お見送り会",
  draw: "抽選会",
  random_cheki_sign: "ランダムチェキ・サイン",
  three_shot_cheki: "スリーショットチェキ",
  group_shot_cheki: "グループチェキ",
  other: "その他",
};

type PeriodKey = "today" | "week" | "month" | "custom";
type FcMode = "all" | "fc" | "nonfc";

const DAY_W = 26;        // 1日あたりの横幅(px)
const ROW_H = 44;        // 行高（基本は日付軸＝点は中央配置）
const LABEL_W = 168;     // 左ラベル列の幅(px)
const HEADER_H = 40;     // 日付ヘッダー高
const DOT = 9;           // 点(◆)のサイズ
// 展開（時間軸）表示用。1日の中の開演時刻を横の時刻軸にマッピングする
const TOD_START = 11 * 60; // 11:00 を左端
const TOD_END = 21 * 60;   // 21:00 を右端
const TOD_HOURS = [11, 13, 15, 17, 19, 21];
function timeToPct(hms: string | null): number {
  if (!hms) return 50;
  const [h, m] = hms.split(":").map(Number);
  const mins = Math.min(TOD_END, Math.max(TOD_START, h * 60 + (m || 0)));
  return ((mins - TOD_START) / (TOD_END - TOD_START)) * 100;
}

// ─── ユーティリティ ───────────────────────────────────
const MS_DAY = 86400000;
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function dayIndex(from: Date, d: Date): number {
  return Math.round((startOfDay(d).getTime() - startOfDay(from).getTime()) / MS_DAY);
}
function parseDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}
// "HH:MM:SS" / "HH:MM" → 当日のDate
function atTime(ymd: string, hms: string | null): Date {
  const base = parseDate(ymd);
  if (!hms) return base;
  const [h, mi] = hms.split(":").map(Number);
  base.setHours(h, mi || 0, 0, 0);
  return base;
}
function fmtTime(hms: string | null): string {
  if (!hms) return "";
  const [h, mi] = hms.split(":");
  return `${h}:${mi}`;
}
function fmtMd(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

// 地図アプリ起動URL（iOS/Android/PC横断で動く汎用Google Maps URL）
function mapUrl(venue: Venue): string {
  const q = encodeURIComponent(venue.address ? `${venue.name} ${venue.address}` : venue.name);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// ─── メイン ───────────────────────────────────────────
export default function SchedulePage() {
  const [rows, setRows] = useState<ChildEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // フィルタ状態
  const [groups, setGroups] = useState<Set<string>>(new Set());
  const [fcMode, setFcMode] = useState<FcMode>("all");
  const [formats, setFormats] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [todayOnly, setTodayOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    document.title = "スケジュール | hop-up-tools";
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    sb.from("schedule_child_events")
      .select("*, schedule_parent_events(*), schedule_venues(*)")
      .order("event_date", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setRows((data as unknown as ChildEvent[]) ?? []);
        setLoading(false);
      });
  }, []);

  const today = useMemo(() => startOfDay(new Date()), []);

  // 表示ウィンドウ [windowStart, windowEnd]
  const [windowStart, windowEnd] = useMemo<[Date, Date]>(() => {
    if (todayOnly) return [today, today];
    switch (period) {
      case "today":
        return [today, today];
      case "week":
        return [today, addDays(today, 6)];
      case "month":
        return [today, addDays(today, 30)];
      case "custom": {
        const s = customStart ? parseDate(customStart) : today;
        const e = customEnd ? parseDate(customEnd) : addDays(s, 30);
        return [s, e < s ? addDays(s, 30) : e];
      }
    }
  }, [period, customStart, customEnd, todayOnly, today]);

  const totalDays = dayIndex(windowStart, windowEnd) + 1;
  const timelineW = totalDays * DAY_W;

  // フィルタ適用
  const filtered = useMemo(() => {
    return rows.filter((c) => {
      const p = c.schedule_parent_events;
      if (!p) return false;
      if (groups.size > 0 && !groups.has(p.group_name)) return false;
      if (fcMode === "fc" && !c.is_fc_only) return false;
      if (fcMode === "nonfc" && c.is_fc_only) return false;
      if (formats.size > 0 && !formats.has(c.event_format)) return false;
      // ウィンドウとの交差: 公演日 or 販売期間がウィンドウ内
      const ev = parseDate(c.event_date);
      const inEvent = ev >= windowStart && ev <= addDays(windowEnd, 1);
      let inSales = false;
      if (c.sales_start_at && c.sales_end_at) {
        const ss = new Date(c.sales_start_at);
        const se = new Date(c.sales_end_at);
        inSales = se >= windowStart && ss <= addDays(windowEnd, 1);
      }
      return inEvent || inSales;
    });
  }, [rows, groups, fcMode, formats, windowStart, windowEnd]);

  // 親イベント単位にまとめる（親=行、子公演=点）
  const lanes = useMemo(() => {
    const map = new Map<string, { parent: ParentEvent; children: ChildEvent[] }>();
    for (const c of filtered) {
      const p = c.schedule_parent_events!;
      if (!map.has(p.id)) map.set(p.id, { parent: p, children: [] });
      map.get(p.id)!.children.push(c);
    }
    const arr = Array.from(map.values());
    // 各レーン内の公演を日時順、レーンは最も近い公演日順
    for (const l of arr) {
      l.children.sort((a, b) => atTime(a.event_date, a.event_start_time).getTime() - atTime(b.event_date, b.event_start_time).getTime());
    }
    arr.sort((a, b) => {
      const ea = a.children[0] ? parseDate(a.children[0].event_date).getTime() : 0;
      const eb = b.children[0] ? parseDate(b.children[0].event_date).getTime() : 0;
      return ea - eb;
    });
    return arr;
  }, [filtered]);

  // 利用可能な形式（フィルタ選択肢用）
  const availFormats = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((c) => s.add(c.event_format));
    return Array.from(s);
  }, [rows]);

  const toggleSet = (set: Set<string>, v: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    setter(n);
  };

  const todayX = dayIndex(windowStart, today) * DAY_W + DAY_W / 2;
  const todayInWindow = today >= windowStart && today <= windowEnd;

  return (
    <div style={{ background: "#f8f9fa", minHeight: "100vh", fontFamily: "Inter, 'Noto Sans JP', sans-serif", color: "#191c1d" }}>
      {/* ヘッダー */}
      <header style={{ padding: "2.4rem 1.6rem 1.2rem", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.8rem" }}>
          <Link to="/" style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#777", textDecoration: "none" }}>
            ← HOP-UP TOOLS
          </Link>
        </div>
        <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#777", margin: "1.2rem 0 0.4rem" }}>
          Schedule
        </p>
        <h1 style={{ fontSize: "2.4rem", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color: "#000", margin: 0 }}>
          公演スケジュール
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#585f6c", margin: "0.8rem 0 0", lineHeight: 1.5 }}>
          ハロー！プロジェクトの公演・イベントを時間軸で俯瞰する。
        </p>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "0 1.6rem 4rem" }}>
        {/* フィルタ */}
        <FilterBar
          groups={groups}
          onToggleGroup={(g) => toggleSet(groups, g, setGroups)}
          fcMode={fcMode}
          onFcMode={setFcMode}
          formats={formats}
          availFormats={availFormats}
          onToggleFormat={(f) => toggleSet(formats, f, setFormats)}
          period={period}
          onPeriod={setPeriod}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStart={setCustomStart}
          onCustomEnd={setCustomEnd}
          todayOnly={todayOnly}
          onTodayOnly={setTodayOnly}
        />

        {/* 本体 */}
        {loading ? (
          <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#777", padding: "2rem 0" }}>Loading...</p>
        ) : error ? (
          <p style={{ fontSize: "0.875rem", color: "#ba1a1a", padding: "2rem 0" }}>読み込みエラー: {error}</p>
        ) : lanes.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "#585f6c", padding: "2rem 0" }}>
            この期間に表示できる公演がありません。期間フィルタを広げてみてください。
          </p>
        ) : (
          <Gantt
            lanes={lanes}
            windowStart={windowStart}
            totalDays={totalDays}
            timelineW={timelineW}
            todayX={todayX}
            todayInWindow={todayInWindow}
            today={today}
            openId={openId}
            onToggleOpen={(id) => setOpenId(openId === id ? null : id)}
          />
        )}
      </main>

      {/* フッター（非公式宣言は必須） */}
      <footer style={{ padding: "3rem 1.6rem", marginTop: "2rem", borderTop: "1px solid rgba(198,198,198,0.2)", maxWidth: 1100, margin: "2rem auto 0" }}>
        <p style={{ fontSize: "0.625rem", color: "#c6c6c6", margin: "0 0 1rem" }}>
          このサイトはファンによる非公式ツールです。アップフロントグループおよびハロー！プロジェクトとは一切関係ありません。
        </p>
        <div style={{ display: "flex", gap: "1.5rem" }}>
          <Link to="/privacy" style={{ color: "#777", textDecoration: "none", fontSize: "0.6875rem" }}>プライバシーポリシー</Link>
          <Link to="/terms" style={{ color: "#777", textDecoration: "none", fontSize: "0.6875rem" }}>利用規約</Link>
        </div>
      </footer>
    </div>
  );
}

// ─── フィルタバー ─────────────────────────────────────
function FilterBar(props: {
  groups: Set<string>; onToggleGroup: (g: string) => void;
  fcMode: FcMode; onFcMode: (m: FcMode) => void;
  formats: Set<string>; availFormats: string[]; onToggleFormat: (f: string) => void;
  period: PeriodKey; onPeriod: (p: PeriodKey) => void;
  customStart: string; customEnd: string; onCustomStart: (s: string) => void; onCustomEnd: (s: string) => void;
  todayOnly: boolean; onTodayOnly: (b: boolean) => void;
}) {
  const capLabel: React.CSSProperties = { fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#777", margin: 0, flexShrink: 0, width: "5.5rem" };
  const row: React.CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", padding: "0.45rem 0" };
  return (
    <div style={{ background: "#fff", padding: "0.9rem 1.2rem", marginBottom: "0.4rem" }}>
      {/* 今日のアクション期限ショートカット */}
      <button
        onClick={() => props.onTodayOnly(!props.todayOnly)}
        style={{
          display: "inline-flex", alignItems: "center", gap: "0.4rem",
          background: props.todayOnly ? "#ba1a1a" : "#000", color: "#fff", border: "none",
          padding: "0.5rem 1rem", fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.1em", cursor: "pointer", marginBottom: "0.6rem", borderRadius: 0,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: "1rem" }}>today</span>
        今日の予定だけ
      </button>

      {/* グループ */}
      <div style={{ ...row, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <p style={capLabel}>Group</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
          {GROUPS.map((g) => (
            <Chip key={g} label={g} active={props.groups.has(g)} onClick={() => props.onToggleGroup(g)} />
          ))}
        </div>
      </div>

      {/* FC限定 */}
      <div style={{ ...row, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <p style={capLabel}>Membership</p>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          {([["all", "全部"], ["fc", "FCのみ"], ["nonfc", "FC以外"]] as [FcMode, string][]).map(([m, l]) => (
            <Chip key={m} label={l} active={props.fcMode === m} onClick={() => props.onFcMode(m)} />
          ))}
        </div>
      </div>

      {/* 形式 */}
      {props.availFormats.length > 0 && (
        <div style={{ ...row, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
          <p style={capLabel}>Format</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
            {props.availFormats.map((f) => (
              <Chip key={f} label={FORMAT_LABELS[f] ?? f} active={props.formats.has(f)} onClick={() => props.onToggleFormat(f)} />
            ))}
          </div>
        </div>
      )}

      {/* 期間 */}
      <div style={{ ...row, borderTop: "1px solid rgba(0,0,0,0.06)", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <p style={capLabel}>Period</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
          {([["today", "今日"], ["week", "今週"], ["month", "今月"], ["custom", "カスタム"]] as [PeriodKey, string][]).map(([p, l]) => (
            <Chip key={p} label={l} active={!props.todayOnly && props.period === p} onClick={() => { props.onTodayOnly(false); props.onPeriod(p); }} />
          ))}
          {props.period === "custom" && !props.todayOnly && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", marginLeft: "0.2rem" }}>
              <input type="date" value={props.customStart} onChange={(e) => props.onCustomStart(e.target.value)}
                style={{ fontSize: "0.75rem", padding: "0.3rem 0.4rem", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 0, fontFamily: "inherit" }} />
              <span style={{ color: "#777" }}>→</span>
              <input type="date" value={props.customEnd} onChange={(e) => props.onCustomEnd(e.target.value)}
                style={{ fontSize: "0.75rem", padding: "0.3rem 0.4rem", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 0, fontFamily: "inherit" }} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "#000" : "#f3f4f5",
        color: active ? "#fff" : "#585f6c",
        border: "none", borderRadius: 0,
        padding: "0.4rem 0.7rem", fontSize: "0.75rem", fontWeight: active ? 700 : 400,
        cursor: "pointer", transition: "background 0.12s, color 0.12s", whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

// ─── ガント本体 ───────────────────────────────────────
// 単一の横スクロール内で「ラベルセル(sticky left)＋タイムラインセル」の統合行にし、
// 開いた行の直下にフル幅の詳細をその場展開する。
function Gantt(props: {
  lanes: { parent: ParentEvent; children: ChildEvent[] }[];
  windowStart: Date; totalDays: number; timelineW: number;
  todayX: number; todayInWindow: boolean; today: Date;
  openId: string | null; onToggleOpen: (id: string) => void;
}) {
  const { lanes, windowStart, totalDays, timelineW, todayX, todayInWindow } = props;
  const days = useMemo(() => Array.from({ length: totalDays }, (_, i) => addDays(windowStart, i)), [windowStart, totalDays]);
  const fullW = LABEL_W + timelineW;

  const stickyLabel: React.CSSProperties = {
    position: "sticky", left: 0, zIndex: 2, width: LABEL_W, flexShrink: 0, boxSizing: "border-box",
  };

  return (
    <div style={{ background: "#fff", overflowX: "auto", overflowY: "hidden", position: "relative" }}>
      <div style={{ width: fullW, position: "relative" }}>
        {/* ── ヘッダー行 ── */}
        <div style={{ display: "flex", height: HEADER_H, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <div style={{ ...stickyLabel, background: "#fff", display: "flex", alignItems: "flex-end", padding: "0 0.8rem 0.3rem" }}>
            <span style={{ fontSize: "0.5625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#999" }}>Event</span>
          </div>
          <div style={{ position: "relative", width: timelineW, height: HEADER_H }}>
            {days.map((d, i) => {
              const isMonthStart = i === 0 || d.getDate() === 1;
              const dow = d.getDay();
              return (
                <div key={i} style={{ position: "absolute", left: i * DAY_W, top: 0, width: DAY_W, height: HEADER_H, textAlign: "center", boxSizing: "border-box" }}>
                  {isMonthStart && (
                    <span style={{ position: "absolute", left: 2, top: 1, fontSize: "0.5625rem", fontWeight: 700, letterSpacing: "0.04em", color: "#000", whiteSpace: "nowrap" }}>
                      {MONTHS_EN[d.getMonth()]}
                    </span>
                  )}
                  <span style={{ position: "absolute", left: 0, right: 0, top: 15, fontSize: "0.5625rem", color: dow === 0 ? "#ba1a1a" : dow === 6 ? "#3b6fba" : "#999" }}>{d.getDate()}</span>
                  <span style={{ position: "absolute", left: 0, right: 0, top: 26, fontSize: "0.5rem", color: dow === 0 ? "#ba1a1a" : "#bbb" }}>{WEEKDAY[dow]}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 各レーン ── */}
        {lanes.map((l, i) => {
          const isOpen = props.openId === l.parent.id;
          const rowBg = isOpen ? "#f3f4f5" : "#fff";
          return (
            <div key={l.parent.id}>
              <div style={{ display: "flex", height: ROW_H, ...(i > 0 ? { borderTop: "1px solid rgba(0,0,0,0.05)" } : {}) }}>
                {/* ラベルセル（sticky） */}
                <div onClick={() => props.onToggleOpen(l.parent.id)}
                  style={{ ...stickyLabel, background: rowBg, padding: "0 0.8rem", cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "center", overflow: "hidden" }}>
                  <span style={{ fontSize: "0.5625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#999", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.parent.group_name}</span>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#191c1d", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.3 }}>{l.parent.title}</span>
                </div>
                {/* タイムラインセル */}
                <div onClick={() => props.onToggleOpen(l.parent.id)} style={{ position: "relative", width: timelineW, height: ROW_H, cursor: "pointer", background: rowBg }}>
                  {/* 週末の薄い縦帯 */}
                  {days.map((d, di) => (d.getDay() === 0 || d.getDay() === 6) ? (
                    <div key={di} style={{ position: "absolute", left: di * DAY_W, top: 0, width: DAY_W, height: ROW_H, background: d.getDay() === 0 ? "rgba(186,26,26,0.035)" : "rgba(0,0,0,0.02)" }} />
                  ) : null)}
                  {/* 販売期間の帯 */}
                  {l.children.map((c) => {
                    if (!c.sales_start_at || !c.sales_end_at) return null;
                    const ss = dayIndex(windowStart, new Date(c.sales_start_at));
                    const se = dayIndex(windowStart, new Date(c.sales_end_at));
                    const x = Math.max(0, ss) * DAY_W;
                    const w = Math.max(DAY_W * 0.6, (Math.min(totalDays - 1, se) - Math.max(0, ss) + 1) * DAY_W - 4);
                    return (
                      <div key={`bar-${c.id}`} title={`販売 ${fmtMd(new Date(c.sales_start_at))}〜${fmtMd(new Date(c.sales_end_at))}`}
                        style={{ position: "absolute", left: x + 2, top: ROW_H / 2 - 4, height: 8, width: w, background: "#000", opacity: 0.85 }} />
                    );
                  })}
                  {/* 公演=点（◆）。基本は日付軸：日ごとに中央配置。詳細はタップで時間軸展開 */}
                  {(() => {
                    // 同日複数公演はまとめて1点に（タップで時間軸に展開して内訳表示）
                    const byDay = new Map<number, ChildEvent[]>();
                    for (const c of l.children) {
                      const di = dayIndex(windowStart, parseDate(c.event_date));
                      if (di < 0 || di >= totalDays) continue;
                      if (!byDay.has(di)) byDay.set(di, []);
                      byDay.get(di)!.push(c);
                    }
                    return Array.from(byDay.entries()).map(([di, cs]) => {
                      const x = di * DAY_W + DAY_W / 2;
                      const allPast = cs.every((c) => atTime(c.event_date, c.event_start_time) < props.today);
                      const times = cs.map((c) => fmtTime(c.event_start_time)).filter(Boolean).join(" / ");
                      return (
                        <span key={`dot-${l.parent.id}-${di}`} title={`${fmtMd(parseDate(cs[0].event_date))} ${times}${cs.length > 1 ? `（${cs.length}公演）` : ""} ${cs[0].schedule_venues?.name ?? ""}`}
                          style={{ position: "absolute", left: x - DOT / 2, top: ROW_H / 2 - DOT / 2, width: DOT, height: DOT, background: allPast ? "#bbb" : "#000", transform: "rotate(45deg)", display: "block" }} />
                      );
                    });
                  })()}
                </div>
              </div>

              {/* ── 詳細（行のその場展開） ── */}
              {isOpen && (
                <div style={{ position: "sticky", left: 0, width: "100%", maxWidth: "100vw", background: "#f3f4f5", borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                  <DetailPanel lane={l} today={props.today} />
                </div>
              )}
            </div>
          );
        })}

        {/* 今日ライン（赤縦線） */}
        {todayInWindow && (
          <div style={{ position: "absolute", left: LABEL_W + todayX, top: 0, width: 2, height: HEADER_H, background: "#ba1a1a", zIndex: 3, pointerEvents: "none" }} />
        )}
      </div>
    </div>
  );
}

// ─── 詳細パネル（タップで時間軸に拡張展開） ────────────
// 基本ガントは日付軸。ここで初めて「1日の中の開演時刻」を横の時刻軸で見せる。
function DetailPanel({ lane, today }: { lane: { parent: ParentEvent; children: ChildEvent[] }; today: Date }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
    });
  };
  const capLabel: React.CSSProperties = { fontSize: "0.5625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#999" };
  const linkBtn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "0.3rem", background: "#000", color: "#fff", textDecoration: "none",
    padding: "0.45rem 0.8rem", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.04em",
  };

  // 日付ごとにまとめる（同日複数公演を1つの時刻軸トラックに並べる）
  const byDate = new Map<string, ChildEvent[]>();
  for (const c of lane.children) {
    if (!byDate.has(c.event_date)) byDate.set(c.event_date, []);
    byDate.get(c.event_date)!.push(c);
  }
  const dates = Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div style={{ padding: "1rem 1.2rem 1.4rem", maxWidth: 820 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <span style={capLabel}>{lane.parent.group_name}</span>
        {lane.parent.detail_url && (
          <a href={lane.parent.detail_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.6875rem", color: "#585f6c", textDecoration: "none" }}>
            公式詳細ページ ↗
          </a>
        )}
      </div>

      {dates.map(([date, shows]) => {
        const d = parseDate(date);
        const v = shows[0].schedule_venues; // 同日は基本同一会場
        const past = shows.every((s) => atTime(s.event_date, s.event_start_time) < today);
        return (
          <div key={date} style={{ background: "#fff", padding: "0.8rem 1rem 1rem", marginBottom: "0.4rem", opacity: past ? 0.6 : 1 }}>
            {/* 日付・会場ヘッダー */}
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.7rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 700, color: d.getDay() === 0 ? "#ba1a1a" : "#191c1d" }}>
                {d.getMonth() + 1}/{d.getDate()}（{WEEKDAY[d.getDay()]}）
              </span>
              {v && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: "0.95rem", color: "#585f6c" }}>{v.is_online ? "language" : "place"}</span>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 700 }}>{v.name}</span>
                  {v.prefecture && <span style={{ fontSize: "0.6875rem", color: "#999" }}>（{v.prefecture}）</span>}
                </span>
              )}
              {shows.some((s) => s.is_fc_only) && <span style={{ fontSize: "0.5625rem", fontWeight: 700, letterSpacing: "0.06em", color: "#fff", background: "#585f6c", padding: "0.1rem 0.4rem" }}>FC限定</span>}
              {past && <span style={{ fontSize: "0.5625rem", fontWeight: 700, letterSpacing: "0.06em", color: "#999" }}>終了</span>}
            </div>

            {/* 時刻軸トラック */}
            <TimeTrack shows={shows} />

            {/* 会場詳細・導線 */}
            {v && (
              <div style={{ marginTop: "0.7rem" }}>
                {!v.is_online && v.address && (
                  <p style={{ fontSize: "0.75rem", color: "#585f6c", margin: "0 0 0.2rem", cursor: "pointer" }} onClick={() => copy(v.address!, `addr-${date}`)}>
                    {v.address} <span style={{ color: "#999" }}>{copied === `addr-${date}` ? "コピーしました" : "（タップでコピー）"}</span>
                  </p>
                )}
                {!v.is_online && v.nearest_station && (
                  <p style={{ fontSize: "0.75rem", color: "#585f6c", margin: "0 0 0.4rem" }}>最寄り: {v.nearest_station}</p>
                )}
                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
                  {!v.is_online && (
                    <a href={mapUrl(v)} target="_blank" rel="noopener noreferrer" style={linkBtn}>
                      <span className="material-symbols-outlined" style={{ fontSize: "1rem" }}>map</span>地図を開く
                    </a>
                  )}
                  {shows[0].application_url && (
                    <a href={shows[0].application_url!} target="_blank" rel="noopener noreferrer" style={{ ...linkBtn, background: "#585f6c" }}>
                      <span className="material-symbols-outlined" style={{ fontSize: "1rem" }}>open_in_new</span>申込ページ
                    </a>
                  )}
                  {v.official_url && (
                    <a href={v.official_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.6875rem", color: "#585f6c", textDecoration: "none", alignSelf: "center" }}>
                      会場公式 ↗
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// 1日の中の開場(○)→開演(◆)を【縦】の時刻軸（11時=上 〜 21時=下）にプロットするトラック
const TRACK_H = 188;       // 縦トラックの高さ
const TRACK_PAD = 12;      // 上下パディング
const AXIS_X = 52;         // 軸線の横位置（左側は時刻ラベル）
function timeToY(hms: string | null): number {
  return TRACK_PAD + (timeToPct(hms) / 100) * (TRACK_H - 2 * TRACK_PAD);
}
function TimeTrack({ shows }: { shows: ChildEvent[] }) {
  // 同時刻帯で重ならないよう、公演ごとに横レーンをずらす
  return (
    <div style={{ position: "relative", height: TRACK_H }}>
      {/* 縦の軸線 */}
      <div style={{ position: "absolute", left: AXIS_X, top: TRACK_PAD, bottom: TRACK_PAD, width: 1, background: "rgba(0,0,0,0.12)" }} />
      {/* 時刻目盛り（左側） */}
      {TOD_HOURS.map((h) => {
        const y = timeToY(`${h}:00`);
        return (
          <div key={h} style={{ position: "absolute", left: 0, top: y, transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 4, width: AXIS_X + 6 }}>
            <span style={{ fontSize: "0.5rem", color: "#bbb", width: AXIS_X - 8, textAlign: "right" }}>{h}時</span>
            <span style={{ width: 6, height: 1, background: "rgba(0,0,0,0.15)" }} />
          </div>
        );
      })}
      {/* 各公演：開場○ →（縦線）→ 開演◆。複数公演は右へレーンをずらす */}
      {shows.map((s) => {
        if (!s.event_start_time) return null;
        const yStart = timeToY(s.event_start_time);
        const yOpen = s.event_open_time != null ? timeToY(s.event_open_time) : null;
        const laneX = AXIS_X; // すべて1本の縦軸上にプロット（昼夜は時刻で縦に分離）
        return (
          <div key={s.id}>
            {/* 開場→開演 の縦連結線 */}
            {yOpen != null && (
              <span style={{ position: "absolute", left: laneX, top: Math.min(yOpen, yStart), height: Math.abs(yStart - yOpen), width: 2, background: "rgba(0,0,0,0.25)", transform: "translateX(-50%)" }} />
            )}
            {/* 開場マーカー（中空○）＋ラベル */}
            {yOpen != null && (
              <>
                <span title={`開場 ${fmtTime(s.event_open_time)}`} style={{ position: "absolute", left: laneX, top: yOpen, width: 7, height: 7, borderRadius: "50%", border: "1.5px solid #999", background: "#fff", transform: "translate(-50%, -50%)", boxSizing: "border-box" }} />
                <span style={{ position: "absolute", left: laneX + 10, top: yOpen, transform: "translateY(-50%)", fontSize: "0.5625rem", color: "#999", whiteSpace: "nowrap" }}>開場 {fmtTime(s.event_open_time)}</span>
              </>
            )}
            {/* 開演マーカー（◆）＋ラベル */}
            <span title={`開演 ${fmtTime(s.event_start_time)}`} style={{ position: "absolute", left: laneX, top: yStart, width: DOT, height: DOT, background: "#000", transform: "translate(-50%, -50%) rotate(45deg)" }} />
            <span style={{ position: "absolute", left: laneX + 10, top: yStart, transform: "translateY(-50%)", fontSize: "0.6875rem", fontWeight: 700, color: "#191c1d", whiteSpace: "nowrap" }}>開演 {fmtTime(s.event_start_time)}</span>
          </div>
        );
      })}
    </div>
  );
}
