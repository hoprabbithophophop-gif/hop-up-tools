import { useMemo, useState, Fragment } from "react";
import { SETLIST, findVideo, INDIVIDUAL_MEMBERS, MEMBER_ORDER_INDEX, MEMBER_GROUP, MEMBER_COLOR, haloVideos, SHOW_BY_NO, showSortKey } from "@/data/the-ballad";
import type { VideoLink } from "@/data/the-ballad";
import { C } from "../ui";
import PlayChip from "./PlayChip";
import ShareChip from "./ShareChip";
import { Emph } from "./Emph";
import { Accordion } from "./Accordion";
import { Count, Empty } from "./SongView";

interface Occasion {
  showNo: string;
  video?: VideoLink; // その公演の公式映像（無ければ undefined）
}
interface SongOfMember {
  songCore: string;
  artist: string;
  count: number;         // 歌った公演数（= occasions.length）
  occasions: Occasion[]; // 歌った公演（日付順）
  haloVids: VideoLink[]; // ハロ！ステ等、公演に紐付かない公式歌唱
  hasVideo: boolean;
}
interface MemberAgg {
  member: string;
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
  // 曲の公演内訳は同時に1つだけ開く（別の曲を開くと前のは閉じる）
  const [openSong, setOpenSong] = useState<string | null>(null);

  const toggleSong = (key: string) => setOpenSong((prev) => (prev === key ? null : key));

  const members = useMemo<MemberAgg[]>(() => {
    const map = new Map<string, MemberAgg>();
    for (const e of SETLIST) {
      let m = map.get(e.member);
      if (!m) {
        m = { member: e.member, songs: [], hasVideo: false };
        map.set(e.member, m);
      }
      let s = m.songs.find((x) => x.songCore === e.songCore);
      if (!s) {
        s = { songCore: e.songCore, artist: e.artist, count: 0, occasions: [], haloVids: [], hasVideo: false };
        m.songs.push(s);
      }
      // 同一公演は1回（昼夜別公演はそれぞれ別 showNo）
      if (!s.occasions.some((o) => o.showNo === e.showNo)) {
        const v = findVideo(e.showNo, e.member, e.songCore);
        s.occasions.push({ showNo: e.showNo, video: v });
        if (v) {
          s.hasVideo = true;
          m.hasVideo = true;
        }
      }
    }
    // MEMBERS はスケジュールに名前のある「個人」のみ（全員/ユニット/グループ/デュエットは除外）
    const arr = [...map.values()].filter((m) => INDIVIDUAL_MEMBERS.has(m.member));
    // ハロ！ステの公式歌唱（メンバー×曲）を各曲に足す
    arr.forEach((m) =>
      m.songs.forEach((s) => {
        const hv = haloVideos(m.member, s.songCore);
        if (hv.length) {
          s.haloVids.push(...hv);
          s.hasVideo = true;
          m.hasVideo = true;
        }
      })
    );
    // occasions を日付順に、曲の公演数を確定してから曲を並べ替え
    arr.forEach((m) => {
      m.songs.forEach((s) => {
        s.occasions.sort((a, b) => showSortKey(a.showNo) - showSortKey(b.showNo));
        s.count = s.occasions.length;
      });
      m.songs.sort((a, b) => b.count - a.count || a.songCore.localeCompare(b.songCore, "ja"));
    });
    // スプレッドシート「出演者(横軸)」の並び順（所属ユニット順）に合わせる
    arr.sort((a, b) => (MEMBER_ORDER_INDEX.get(a.member) ?? 9999) - (MEMBER_ORDER_INDEX.get(b.member) ?? 9999));
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
        const songs = m.songs.filter((s) => !videoOnly || s.hasVideo);
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
                {m.hasVideo && <span style={playMark} aria-label="公式映像あり" />}
                <span style={{ fontSize: "0.7rem", color: C.faint, fontWeight: 700 }}>{songs.length}曲</span>
                <span style={{ color: C.hair, fontSize: "0.8rem" }}>{isOpen ? "−" : "+"}</span>
              </div>
            </button>
            <Accordion open={isOpen}>
              <div style={{ padding: "0 1.4rem 1rem" }}>
                {songs.map((s) => {
                  const sk = m.member + "|" + s.songCore;
                  const isSongOpen = openSong === sk;
                  // 「動画あり」ON時は映像のある行だけ
                  const occ = videoOnly ? s.occasions.filter((o) => o.video) : s.occasions;
                  // 昼夜まとめ等、同じ動画が複数公演にある場合、公演の記載は各行に残しつつ、
                  // ボタンは最後の公演（夜）の下に1つだけ出す（同じ映像でのぬか喜び防止）
                  const lastVidIdx = new Map<string, number>();
                  occ.forEach((o, i) => { if (o.video) lastVidIdx.set(o.video.videoId, i); });
                  return (
                    <div key={s.songCore} style={{ borderTop: `1px solid ${C.line}` }}>
                      <button onClick={() => toggleSong(sk)} style={songRowBtn}>
                        <span style={{ fontSize: "0.8rem", color: C.body }}>{s.songCore}</span>
                        {s.artist && <span style={{ fontSize: "0.65rem", color: C.meta }}>{s.artist}</span>}
                        <span style={{ fontSize: "0.7rem", color: C.faint }}>×{s.count}</span>
                        <span style={{ flex: 1 }} />
                        {s.hasVideo && <span style={playMark} aria-label="公式映像あり" />}
                        <span style={{ color: C.hair, fontSize: "0.8rem" }}>{isSongOpen ? "−" : "+"}</span>
                      </button>
                      <Accordion open={isSongOpen}>
                        <div style={{ padding: "0 0 0.5rem" }}>
                          {occ.map((o, i) => {
                            const sh = SHOW_BY_NO.get(o.showNo);
                            const isLastOfVid = o.video ? lastVidIdx.get(o.video.videoId) === i : false;
                            return (
                              <div key={o.showNo} style={occasionRow}>
                                <span style={{ fontSize: "0.75rem", color: C.body, whiteSpace: "nowrap" }}>
                                  {sh ? `${sh.date} ${sh.start}` : `No.${o.showNo}`}
                                </span>
                                {sh && <span style={{ fontSize: "0.65rem", color: C.meta }}>{sh.venue}</span>}
                                {o.video && isLastOfVid && (
                                  <span style={{ flexBasis: "100%", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.3rem", marginTop: "0.15rem" }}>
                                    <PlayChip video={o.video} onPlay={onPlay} />
                                    <ShareChip video={o.video} />
                                  </span>
                                )}
                              </div>
                            );
                          })}
                          {m.hasVideo && s.haloVids.map((v) => (
                            <div key={v.videoId} style={occasionRow}>
                              <span style={{ fontSize: "0.75rem", color: C.body, whiteSpace: "nowrap" }}>{v.startLabel}</span>
                              <span style={{ flexBasis: "100%", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.3rem", marginTop: "0.15rem" }}>
                                <PlayChip video={v} onPlay={onPlay} />
                                <ShareChip video={v} />
                              </span>
                            </div>
                          ))}
                        </div>
                      </Accordion>
                    </div>
                  );
                })}
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
const songRowBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  flexWrap: "wrap",
  width: "100%",
  padding: "0.55rem 0",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
};
const occasionRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  flexWrap: "wrap",
  padding: "0.35rem 0 0.35rem 0.8rem",
};
const playMark: React.CSSProperties = {
  width: 0,
  height: 0,
  borderTop: "4px solid transparent",
  borderBottom: "4px solid transparent",
  borderLeft: "6px solid #000",
  display: "inline-block",
};
