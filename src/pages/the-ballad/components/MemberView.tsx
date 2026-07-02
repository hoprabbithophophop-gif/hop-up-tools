import { useMemo, useState, Fragment } from "react";
import { SETLIST, findVideo, INDIVIDUAL_MEMBERS, MEMBER_ORDER_INDEX, MEMBER_GROUP, MEMBER_COLOR, haloVideos } from "@/data/the-ballad";
import type { VideoLink } from "@/data/the-ballad";
import { C } from "../ui";
import VideoChips from "./VideoChips";
import { Emph } from "./Emph";
import { Accordion } from "./Accordion";
import { Count, Empty } from "./SongView";

interface SongOfMember {
  songCore: string;
  artist: string;
  count: number;
  videos: VideoLink[];
}
interface MemberAgg {
  member: string;
  total: number;
  songs: SongOfMember[];
  hasVideo: boolean;
}

export default function MemberView({
  query,
  videoOnly,
  onPlay,
}: {
  query: string;
  videoOnly: boolean;
  onPlay: (v: VideoLink) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const members = useMemo<MemberAgg[]>(() => {
    const map = new Map<string, MemberAgg>();
    for (const e of SETLIST) {
      let m = map.get(e.member);
      if (!m) {
        m = { member: e.member, total: 0, songs: [], hasVideo: false };
        map.set(e.member, m);
      }
      m.total++;
      let s = m.songs.find((x) => x.songCore === e.songCore);
      if (!s) {
        s = { songCore: e.songCore, artist: e.artist, count: 0, videos: [] };
        m.songs.push(s);
      }
      s.count++;
      const v = findVideo(e.showNo, e.member, e.songCore);
      if (v && !s.videos.some((x) => x.showNo === v.showNo)) {
        s.videos.push(v);
        m.hasVideo = true;
      }
    }
    // MEMBERS はスケジュールに名前のある「個人」のみ（全員/ユニット/グループ/デュエットは除外）
    const arr = [...map.values()].filter((m) => INDIVIDUAL_MEMBERS.has(m.member));
    arr.forEach((m) => m.songs.sort((a, b) => b.count - a.count || a.songCore.localeCompare(b.songCore, "ja")));
    // スプレッドシート「出演者(横軸)」の並び順（所属ユニット順）に合わせる
    arr.sort((a, b) =>
      (MEMBER_ORDER_INDEX.get(a.member) ?? 9999) - (MEMBER_ORDER_INDEX.get(b.member) ?? 9999)
    );
    // ハロ！ステの公式歌唱（メンバー×曲）を各曲に足す
    arr.forEach((m) =>
      m.songs.forEach((s) => {
        const hv = haloVideos(m.member, s.songCore);
        if (hv.length) {
          s.videos.push(...hv);
          m.hasVideo = true;
        }
      })
    );
    return arr;
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = members.filter((m) => {
    if (videoOnly && !m.hasVideo) return false;
    if (!q) return true;
    return (
      m.member.toLowerCase().includes(q) ||
      m.songs.some((s) => s.songCore.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q))
    );
  });

  if (filtered.length === 0) return <Empty videoOnly={videoOnly} />;

  return (
    <div>
      <Count n={filtered.length} unit="人" />
      {filtered.map((m, i) => {
        const isOpen = open === m.member;
        // 所属ユニット（サブユニットは / の前で束ねる）が変わったら見出しを出す
        const grp = (MEMBER_GROUP[m.member] || "").split("/")[0];
        const prevGrp = i > 0 ? (MEMBER_GROUP[filtered[i - 1].member] || "").split("/")[0] : "";
        // 見出しと重複しないよう、各行にはサブユニット（CHICA#TETSU 等）だけ出す
        const sub = (MEMBER_GROUP[m.member] || "").split("/").slice(1).join("/");
        return (
          <Fragment key={m.member}>
            {grp && grp !== prevGrp && <GroupHeader label={grp} />}
          <div style={{ background: C.card, marginBottom: 2 }}>
            <button onClick={() => setOpen(isOpen ? null : m.member)} style={rowBtn}>
              <span style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap", minWidth: 0 }}>
                <span style={{ fontSize: "0.95rem", fontWeight: 700, color: C.ink }}>
                  <Emph text={m.member} big="0.95rem" small="0.95rem" weight={700} color={MEMBER_COLOR[m.member] || undefined} />
                </span>
                {sub && (
                  <span style={{ fontSize: "0.6875rem", color: C.meta }}>{sub}</span>
                )}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                {m.hasVideo && <span style={dot} aria-label="公式映像あり" />}
                <span style={{ fontSize: "0.7rem", color: C.faint, fontWeight: 700 }}>{m.songs.length}曲</span>
                <span style={{ color: C.hair, fontSize: "0.8rem" }}>{isOpen ? "−" : "+"}</span>
              </div>
            </button>
            <Accordion open={isOpen}>
              <div style={{ padding: "0 1.4rem 1rem" }}>
                {m.songs.map((s) => (
                  <div key={s.songCore} style={songRow}>
                    <span style={{ fontSize: "0.8rem", color: C.body }}>{s.songCore}</span>
                    {s.artist && <span style={{ fontSize: "0.65rem", color: C.meta }}>{s.artist}</span>}
                    {s.count > 1 && <span style={{ fontSize: "0.7rem", color: C.faint }}>×{s.count}</span>}
                    <span style={{ flex: 1 }} />
                    <VideoChips videos={s.videos} onPlay={onPlay} />
                  </div>
                ))}
              </div>
            </Accordion>
          </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function GroupHeader({ label }: { label: string }) {
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
const songRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  flexWrap: "wrap",
  padding: "0.4rem 0",
  borderTop: `1px solid ${C.line}`,
};
const dot: React.CSSProperties = { width: 6, height: 6, background: "#000", display: "inline-block" };
