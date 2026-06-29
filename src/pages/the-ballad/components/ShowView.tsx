import { useMemo, useState, Fragment } from "react";
import { SHOWS, SETLIST, findVideo } from "@/data/the-ballad";
import type { VideoLink, SetlistEntry } from "@/data/the-ballad";
import { C } from "../ui";
import PlayChip from "./PlayChip";
import { Count, Empty } from "./SongView";

interface ShowAgg {
  no: string;
  date: string;
  start: string;
  venue: string;
  pref: string;
  performerCount: number;
  entries: { e: SetlistEntry; label: string; video?: VideoLink }[];
  hasVideo: boolean;
}

// "9/19(土)" → 9（月）。月グループの並び順に使う
const monthKey = (d: string) => {
  const m = d.match(/(\d+)\//);
  return m ? Number(m[1]) : 99;
};

export default function ShowView({
  query,
  videoOnly,
  onPlay,
  attended,
  onToggleAttend,
}: {
  query: string;
  videoOnly: boolean;
  onPlay: (v: VideoLink) => void;
  attended: Set<string>;
  onToggleAttend: (no: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const shows = useMemo<ShowAgg[]>(() => {
    const byShow = new Map<string, SetlistEntry[]>();
    for (const e of SETLIST) {
      const arr = byShow.get(e.showNo) ?? [];
      arr.push(e);
      byShow.set(e.showNo, arr);
    }
    return SHOWS.map((s) => {
      // SETLIST の並び＝シート行順＝演奏順（OP→1..N→ED）。再ソートしない。
      const raw = byShow.get(s.no) ?? [];
      const firstNum = raw.findIndex((e) => e.order !== "");
      const entries = raw.map((e, i) => ({
        e,
        // 歌唱順が空欄の全員曲は、番号付き曲より前なら OP・後なら ED
        label: e.order !== "" ? e.order : firstNum === -1 || i < firstNum ? "OP" : "ED",
        video: findVideo(e.showNo, e.member, e.songCore),
      }));
      return {
        no: s.no,
        date: s.date,
        start: s.start,
        venue: s.venue,
        pref: s.pref,
        performerCount: s.performers.length,
        entries,
        hasVideo: entries.some((x) => x.video),
      };
    }).sort((a, b) =>
      // 月ごとにまとめ、各月の中は公演番号順
      monthKey(a.date) - monthKey(b.date) ||
      (parseInt(a.no, 10) || 0) - (parseInt(b.no, 10) || 0)
    );
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = shows.filter((s) => {
    if (videoOnly && !s.hasVideo) return false;
    if (!q) return true;
    return (
      s.venue.toLowerCase().includes(q) ||
      s.date.toLowerCase().includes(q) ||
      s.pref.toLowerCase().includes(q) ||
      s.entries.some((x) => x.e.member.toLowerCase().includes(q) || x.e.songCore.toLowerCase().includes(q))
    );
  });

  if (filtered.length === 0) return <Empty videoOnly={videoOnly} />;

  return (
    <div>
      <Count n={filtered.length} unit="公演" />
      {filtered.map((s, i) => {
        const isOpen = open === s.no;
        const month = (s.date.match(/(\d+)\//) || [])[1];
        const prevMonth = i > 0 ? (filtered[i - 1].date.match(/(\d+)\//) || [])[1] : undefined;
        return (
          <Fragment key={s.no}>
            {month && month !== prevMonth && <MonthHeader label={`${month}月`} />}
          <div style={{ background: C.card, marginBottom: 2 }}>
            <div style={{ display: "flex", alignItems: "stretch" }}>
            <button onClick={() => setOpen(isOpen ? null : s.no)} style={{ ...rowBtn, flex: 1 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: C.hair, letterSpacing: "0.05em" }}>No.{s.no}</span>
                  <span style={{ fontSize: "0.875rem", fontWeight: 700, color: C.ink }}>{s.date} {s.start}</span>
                </div>
                <p style={{ fontSize: "0.7rem", color: C.meta, margin: "0.15rem 0 0" }}>{s.venue}（{s.pref}）</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                {s.hasVideo && <span style={dot} aria-label="公式映像あり" />}
                <span style={{ fontSize: "0.7rem", color: C.faint, fontWeight: 700 }}>{s.entries.length}曲</span>
                <span style={{ color: C.hair, fontSize: "0.8rem" }}>{isOpen ? "−" : "+"}</span>
              </div>
            </button>
            <button
              onClick={() => onToggleAttend(s.no)}
              style={attendBtn(attended.has(s.no))}
              aria-pressed={attended.has(s.no)}
              title="参戦した公演に印を付ける"
            >
              {attended.has(s.no) ? "✓ 参戦" : "参戦"}
            </button>
            </div>
            {isOpen && (
              <div style={{ padding: "0 1.4rem 1rem" }}>
                {s.entries.map((x, i) => (
                  <div key={i} style={entryRow}>
                    <span style={{ fontSize: "0.7rem", color: C.hair, fontWeight: 700, width: "1.6rem", flexShrink: 0 }}>
                      {x.label}
                    </span>
                    <span style={{ fontSize: "0.8rem", color: C.body, flexShrink: 0 }}>{x.e.member}</span>
                    <span style={{ fontSize: "0.8rem", color: C.ink }}>{x.e.songCore}</span>
                    {x.e.artist && <span style={{ fontSize: "0.65rem", color: C.meta }}>{x.e.artist}</span>}
                    <span style={{ flex: 1 }} />
                    {x.video && x.video.startLabel.includes("/") && (
                      <span style={{ fontSize: "0.6rem", color: C.faint }}>昼夜まとめ</span>
                    )}
                    {x.video && <PlayChip video={x.video} onPlay={onPlay} />}
                  </div>
                ))}
              </div>
            )}
          </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function MonthHeader({ label }: { label: string }) {
  return (
    <p style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.04em", color: C.faint, margin: "1.6rem 0 0.4rem", padding: "0 0.2rem" }}>
      {label}
    </p>
  );
}

const rowBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "1rem",
  width: "100%",
  padding: "1rem 1.4rem",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
};
const attendBtn = (on: boolean): React.CSSProperties => ({
  flexShrink: 0,
  border: "none",
  borderLeft: `1px solid ${C.line}`,
  background: on ? "#000" : "transparent",
  color: on ? "#fff" : C.faint,
  fontSize: "0.625rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  padding: "0 0.9rem",
  cursor: "pointer",
  whiteSpace: "nowrap",
});
const entryRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  flexWrap: "wrap",
  padding: "0.4rem 0",
  borderTop: `1px solid ${C.line}`,
};
const dot: React.CSSProperties = { width: 6, height: 6, background: "#000", display: "inline-block" };
