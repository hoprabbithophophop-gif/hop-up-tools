import { useMemo } from "react";
import { SETLIST, findVideo, MEMBER_GROUP, MEMBER_ORDER_INDEX } from "@/data/the-ballad";
import type { VideoLink } from "@/data/the-ballad";
import { C } from "../ui";
import VideoChips from "./VideoChips";

interface HeardSong {
  member: string;
  songCore: string;
  artist: string;
  count: number;
  videos: VideoLink[];
}
interface HeardMember {
  member: string;
  showCount: number;
  total: number;
  songs: { songCore: string; artist: string; count: number; videos: VideoLink[] }[];
}

export default function MineView({
  attended,
  onPlay,
  onGoShows,
}: {
  attended: Set<string>;
  onPlay: (v: VideoLink) => void;
  onGoShows: () => void;
}) {
  const data = useMemo(() => {
    const songMap = new Map<string, HeardSong>();
    const memberMap = new Map<string, { member: string; shows: Set<string>; songs: Map<string, HeardSong> }>();
    for (const e of SETLIST) {
      if (!attended.has(e.showNo)) continue;
      if (e.member.startsWith("全員")) continue; // 全員曲（OP/ED）は集計対象外
      const v = findVideo(e.showNo, e.member, e.songCore);
      const sk = e.member + "|" + e.songCore;
      let s = songMap.get(sk);
      if (!s) {
        s = { member: e.member, songCore: e.songCore, artist: e.artist, count: 0, videos: [] };
        songMap.set(sk, s);
      }
      s.count++;
      if (v && !s.videos.some((x) => x.videoId === v.videoId)) s.videos.push(v);

      let m = memberMap.get(e.member);
      if (!m) {
        m = { member: e.member, shows: new Set(), songs: new Map() };
        memberMap.set(e.member, m);
      }
      m.shows.add(e.showNo);
      let ms = m.songs.get(e.songCore);
      if (!ms) {
        ms = { member: e.member, songCore: e.songCore, artist: e.artist, count: 0, videos: [] };
        m.songs.set(e.songCore, ms);
      }
      ms.count++;
      if (v && !ms.videos.some((x) => x.videoId === v.videoId)) ms.videos.push(v);
    }

    const songList = [...songMap.values()].sort(
      (a, b) => b.count - a.count || a.songCore.localeCompare(b.songCore, "ja")
    );
    const memberList: HeardMember[] = [...memberMap.values()]
      .map((m) => {
        const songs = [...m.songs.values()].sort((a, b) => b.count - a.count || a.songCore.localeCompare(b.songCore, "ja"));
        return { member: m.member, showCount: m.shows.size, total: songs.reduce((n, x) => n + x.count, 0), songs };
      })
      .sort((a, b) => b.total - a.total || (MEMBER_ORDER_INDEX.get(a.member) ?? 9999) - (MEMBER_ORDER_INDEX.get(b.member) ?? 9999));

    const totalHeard = songList.reduce((n, x) => n + x.count, 0);
    return { songList, memberList, totalHeard, showCount: attended.size };
  }, [attended]);

  if (attended.size === 0) {
    return (
      <div style={{ padding: "2rem 0", textAlign: "center" }}>
        <p style={{ fontSize: "0.85rem", color: C.body, margin: "0 0 0.4rem" }}>まだ参戦した公演が登録されていません。</p>
        <p style={{ fontSize: "0.75rem", color: C.meta, margin: "0 0 1.4rem", lineHeight: 1.6 }}>
          SHOWS で行った公演に「参戦」を付けると、誰のどの歌唱を何回聴いたかがここに集計されます。<br />
          記録はこの端末のブラウザ内だけに保存されます。
        </p>
        <button
          onClick={onGoShows}
          style={{ background: C.ink, color: "#fff", border: "none", padding: "0.6rem 1.2rem", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}
        >
          SHOWS で公演を選ぶ →
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* 参戦サマリー */}
      <div style={{ background: C.card, padding: "1.2rem 1.4rem", marginBottom: "1.6rem", display: "flex", gap: "2rem", flexWrap: "wrap" }}>
        <Stat n={data.showCount} unit="公演参戦" />
        <Stat n={data.songList.length} unit="曲を体感" />
        <Stat n={data.totalHeard} unit="のべ歌唱" />
      </div>

      {/* 聴いた回数 */}
      <p style={sectionLabel}>聴いた回数</p>
      {data.songList.map((s) => (
        <div key={s.member + s.songCore} style={row}>
          <span style={{ fontSize: "0.85rem", fontWeight: 700, color: C.ink }}>{s.songCore}</span>
          {s.artist && <span style={{ fontSize: "0.65rem", color: C.meta }}>{s.artist}</span>}
          <span style={{ fontSize: "0.75rem", color: C.body }}>{s.member}</span>
          <span style={{ fontSize: "0.75rem", color: C.ink, fontWeight: 700 }}>×{s.count}</span>
          <span style={{ flex: 1 }} />
          <VideoChips videos={s.videos} onPlay={onPlay} />
        </div>
      ))}

      {/* メンバー別 */}
      <p style={{ ...sectionLabel, marginTop: "2rem" }}>メンバー別</p>
      {data.memberList.map((m) => (
        <div key={m.member} style={{ background: C.card, marginBottom: 2, padding: "0.9rem 1.4rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.9rem", fontWeight: 700, color: C.ink }}>{m.member}</span>
            <span style={{ fontSize: "0.65rem", color: C.meta }}>{(MEMBER_GROUP[m.member] || "").split("/")[0]}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: "0.7rem", color: C.faint, fontWeight: 700 }}>{m.showCount}公演・のべ{m.total}回</span>
          </div>
          <div style={{ marginTop: "0.4rem" }}>
            {m.songs.map((s) => (
              <div key={s.songCore} style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", padding: "0.3rem 0", borderTop: `1px solid ${C.line}` }}>
                <span style={{ fontSize: "0.8rem", color: C.body }}>{s.songCore}</span>
                <span style={{ fontSize: "0.7rem", color: C.faint }}>×{s.count}</span>
                <span style={{ flex: 1 }} />
                <VideoChips videos={s.videos} onPlay={onPlay} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ n, unit }: { n: number; unit: string }) {
  return (
    <div>
      <span style={{ fontSize: "1.6rem", fontWeight: 700, color: C.ink, letterSpacing: "-0.02em" }}>{n}</span>
      <span style={{ fontSize: "0.7rem", color: C.meta, marginLeft: "0.3rem" }}>{unit}</span>
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: C.faint,
  margin: "0 0 0.6rem",
};
const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  flexWrap: "wrap",
  background: C.card,
  padding: "0.7rem 1.4rem",
  marginBottom: 2,
};
