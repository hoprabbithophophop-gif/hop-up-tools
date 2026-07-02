import { useMemo, useState } from "react";
import { SETLIST, findVideo, MEMBER_COLOR, haloVideos } from "@/data/the-ballad";
import type { VideoLink } from "@/data/the-ballad";
import { C } from "../ui";
import VideoChips from "./VideoChips";
import { Emph } from "./Emph";
import { Accordion } from "./Accordion";
import CompareModal from "./CompareModal";

interface MemberAgg {
  member: string;
  count: number;
  videos: VideoLink[]; // 公式映像のある公演（公演ごと一意）
}
interface SongAgg {
  songCore: string;
  artist: string;
  count: number;
  members: MemberAgg[];
  hasVideo: boolean;
}

export default function SongView({
  query,
  videoOnly,
  onPlay,
}: {
  query: string;
  videoOnly: boolean;
  onPlay: (v: VideoLink) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ song: string; versions: VideoLink[] } | null>(null);

  const songs = useMemo<SongAgg[]>(() => {
    const map = new Map<string, SongAgg>();
    for (const e of SETLIST) {
      if (e.member.startsWith("全員")) continue; // 全員曲（OP/ED）はSONGSに出さない
      let s = map.get(e.songCore);
      if (!s) {
        s = { songCore: e.songCore, artist: e.artist, count: 0, members: [], hasVideo: false };
        map.set(e.songCore, s);
      }
      if (!s.artist && e.artist) s.artist = e.artist;
      s.count++;
      let m = s.members.find((x) => x.member === e.member);
      if (!m) {
        m = { member: e.member, count: 0, videos: [] };
        s.members.push(m);
      }
      m.count++;
      const v = findVideo(e.showNo, e.member, e.songCore);
      if (v && !m.videos.some((x) => x.showNo === v.showNo)) {
        m.videos.push(v);
        s.hasVideo = true;
      }
    }
    const arr = [...map.values()];
    arr.forEach((s) => s.members.sort((a, b) => b.count - a.count));
    arr.sort((a, b) => b.count - a.count || a.songCore.localeCompare(b.songCore, "ja"));
    // ハロ！ステの公式歌唱（メンバー×曲）を各歌唱者に足す
    arr.forEach((s) =>
      s.members.forEach((m) => {
        const hv = haloVideos(m.member, s.songCore);
        if (hv.length) {
          m.videos.push(...hv);
          s.hasVideo = true;
        }
      })
    );
    return arr;
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = songs.filter((s) => {
    if (videoOnly && !s.hasVideo) return false;
    if (!q) return true;
    return (
      s.songCore.toLowerCase().includes(q) ||
      s.artist.toLowerCase().includes(q) ||
      s.members.some((m) => m.member.toLowerCase().includes(q))
    );
  });

  if (filtered.length === 0) return <Empty videoOnly={videoOnly} />;

  return (
    <div>
      <Count n={filtered.length} unit="曲" />
      {filtered.map((s) => {
        const isOpen = open === s.songCore;
        return (
          <div key={s.songCore} style={{ background: C.card, marginBottom: 2 }}>
            <button
              onClick={() => setOpen(isOpen ? null : s.songCore)}
              style={rowBtn}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.95rem", fontWeight: 700, color: C.ink }}>{s.songCore}</span>
                  {s.artist && <span style={{ fontSize: "0.7rem", color: C.meta }}>{s.artist}</span>}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                {s.hasVideo && <span style={dot} aria-label="公式映像あり" />}
                <span style={{ fontSize: "0.7rem", color: C.faint, fontWeight: 700 }}>{s.count}回</span>
                <span style={{ color: C.hair, fontSize: "0.8rem" }}>{isOpen ? "−" : "+"}</span>
              </div>
            </button>
            <Accordion open={isOpen}>
              <div style={{ padding: "0 1.4rem 1rem" }}>
                {(() => {
                  const seen = new Set<string>();
                  const all = s.members
                    .flatMap((m) => m.videos)
                    .filter((v) => (seen.has(v.videoId) ? false : (seen.add(v.videoId), true)));
                  return all.length >= 2 ? (
                    <button onClick={() => setCompare({ song: s.songCore, versions: all })} style={compareBtn}>
                      聴き比べ（{all.length}）
                    </button>
                  ) : null;
                })()}
                {s.members.map((m) => (
                  <div key={m.member} style={memberRow}>
                    <span style={{ fontSize: "0.8rem", color: C.body }}><Emph text={m.member} big="0.8rem" small="0.8rem" color={MEMBER_COLOR[m.member] || undefined} /></span>
                    <span style={{ fontSize: "0.7rem", color: C.faint }}>×{m.count}</span>
                    <span style={{ flex: 1 }} />
                    <VideoChips videos={m.videos} onPlay={onPlay} />
                  </div>
                ))}
              </div>
            </Accordion>
          </div>
        );
      })}
      {compare && <CompareModal title={compare.song} versions={compare.versions} onClose={() => setCompare(null)} />}
    </div>
  );
}

const compareBtn: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "0.6rem",
  marginBottom: "0.6rem",
  background: C.ink,
  color: "#fff",
  border: "none",
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.04em",
  cursor: "pointer",
};

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
const memberRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  flexWrap: "wrap",
  padding: "0.4rem 0",
  borderTop: `1px solid ${C.line}`,
};
const dot: React.CSSProperties = {
  width: 6,
  height: 6,
  background: "#000",
  display: "inline-block",
};

export function Count({ n, unit }: { n: number; unit: string }) {
  return (
    <p style={{ fontSize: "0.6875rem", color: C.faint, margin: "0 0 0.8rem", letterSpacing: "0.04em" }}>
      {n} {unit}
    </p>
  );
}

export function Empty({ videoOnly }: { videoOnly: boolean }) {
  return (
    <p style={{ fontSize: "0.8rem", color: C.meta, padding: "2rem 0", textAlign: "center" }}>
      {videoOnly ? "公式映像が紐付いた項目はまだありません。" : "該当する項目が見つかりません。"}
    </p>
  );
}
