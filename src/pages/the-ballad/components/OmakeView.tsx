import { useMemo, useRef, useState } from "react";
import { OMAKE, omakeVideo, OMAKE_CHUSEN, chusenVideo, MEMBER_COLOR, compareAnchor } from "@/data/the-ballad";
import type { OmakeEntry, VideoLink } from "@/data/the-ballad";
import { C } from "../ui";
import { Emph } from "./Emph";
import { Count, Empty } from "./SongView";
import CompareModal from "./CompareModal";
import type { YouTubePlayerApi } from "./YouTubePlayer";

// OMAKE タブ: The Ballad 楽曲のスタジオソロカバー（各ユニット公式チャンネルの単独動画）を
// カード一覧で表示。タップで全編再生。同一曲が2版以上ある「逢いたくていま」だけ聴き比べ可。
interface SongGroup {
  songCore: string;
  artist: string;
  entries: OmakeEntry[];
}

export default function OmakeView({
  query,
  onPlay,
}: {
  query: string;
  onPlay: (v: VideoLink) => void;
}) {
  const [compare, setCompare] = useState<{ song: string; versions: VideoLink[] } | null>(null);
  const playerRef = useRef<YouTubePlayerApi | null>(null);

  // 同一曲でまとめる（登場順を維持）。ほとんどは1版、逢いたくていまだけ3版。
  const groups = useMemo<SongGroup[]>(() => {
    const map = new Map<string, SongGroup>();
    for (const e of OMAKE) {
      let g = map.get(e.songCore);
      if (!g) {
        g = { songCore: e.songCore, artist: e.artist, entries: [] };
        map.set(e.songCore, g);
      }
      g.entries.push(e);
    }
    return [...map.values()];
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = groups.filter((g) => {
    if (!q) return true;
    return (
      g.songCore.toLowerCase().includes(q) ||
      g.artist.toLowerCase().includes(q) ||
      g.entries.some((e) => e.member.toLowerCase().includes(q) || e.channel.toLowerCase().includes(q))
    );
  });

  // 歌唱順抽選会（会場ブロックごとの舞台裏動画）。検索は日付・会場・チームに掛ける。
  const chusen = OMAKE_CHUSEN.filter((e) => {
    if (!q) return true;
    return (
      e.venue.toLowerCase().includes(q) ||
      e.date.includes(q) ||
      (e.team && `${e.team}チーム`.toLowerCase().includes(q)) ||
      "歌唱順抽選会".includes(q)
    );
  });

  if (filtered.length === 0 && chusen.length === 0) return <Empty videoOnly={false} />;

  const total = filtered.reduce((n, g) => n + g.entries.length, 0);

  return (
    <div>
      {filtered.length > 0 && (
        <p style={{ fontSize: "0.8125rem", color: C.meta, margin: "0 0 1rem", lineHeight: 1.6 }}>
          「Hello! Project 2020 Summer COVERS 〜The Ballad〜」で披露された楽曲の、公式チャンネル配信のスタジオソロカバーです。
        </p>
      )}
      {filtered.length > 0 && <Count n={total} unit="曲" />}
      {filtered.map((g) => {
        const versions = g.entries.map(omakeVideo);
        const multi = g.entries.length >= 2;
        return (
          <div key={g.songCore} style={{ marginBottom: multi ? "0.6rem" : 2 }}>
            {g.entries.map((e) => (
              <button key={e.videoId} onClick={() => onPlay(omakeVideo(e))} style={card}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: "0.7rem", color: C.body, marginBottom: "0.15rem" }}>
                    <Emph text={e.member} big="0.7rem" small="0.7rem" color={MEMBER_COLOR[e.member] || undefined} />
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.95rem", fontWeight: 700, color: C.ink }}>{e.songCore}</span>
                    <span style={{ fontSize: "0.7rem", color: C.meta }}>{e.artist}</span>
                  </div>
                  <div style={{ fontSize: "0.625rem", color: C.faint, marginTop: "0.2rem", letterSpacing: "0.02em" }}>{e.channel}</div>
                </div>
                <span style={{ fontSize: "0.7rem", color: C.hair, flexShrink: 0 }}>▶</span>
              </button>
            ))}
            {multi && (
              <button
                onClick={() => {
                  // タップ(ジェスチャ)内で先頭版を音ありロード(iOS対策)してからモーダルを開く
                  playerRef.current?.unMute();
                  playerRef.current?.loadVideo(versions[0].videoId, { startSeconds: compareAnchor(versions[0].videoId, versions[0].startSec) });
                  setCompare({ song: g.songCore, versions });
                }}
                style={compareBtn}
              >
                聴き比べ（{versions.length}）
              </button>
            )}
          </div>
        );
      })}

      {chusen.length > 0 && (
        <div style={{ marginTop: filtered.length > 0 ? "2rem" : 0 }}>
          <h2 style={{ fontSize: "0.8125rem", fontWeight: 700, color: C.ink, margin: "0 0 0.4rem", letterSpacing: "0.02em" }}>
            歌唱順抽選会
          </h2>
          <p style={{ fontSize: "0.75rem", color: C.meta, margin: "0 0 0.8rem", lineHeight: 1.6 }}>
            各会場ブロックで歌唱順をくじ引きで決める、公式チャンネルの舞台裏映像です。
          </p>
          {chusen.map((e) => (
            <button key={e.videoId} onClick={() => onPlay(chusenVideo(e))} style={card}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.9rem", fontWeight: 700, color: C.ink }}>{e.date}</span>
                  <span style={{ fontSize: "0.8rem", color: C.body }}>{e.venue}</span>
                  {e.team && (
                    <span style={{ fontSize: "0.625rem", fontWeight: 700, color: "#fff", background: C.ink, padding: "0.05rem 0.35rem", letterSpacing: "0.04em" }}>
                      {e.team}チーム
                    </span>
                  )}
                </div>
              </div>
              <span style={{ fontSize: "0.7rem", color: C.hair, flexShrink: 0 }}>▶</span>
            </button>
          ))}
        </div>
      )}

      <CompareModal
        visible={!!compare}
        title={compare?.song ?? ""}
        versions={compare?.versions ?? []}
        playerRef={playerRef}
        onClose={() => setCompare(null)}
      />
    </div>
  );
}

const card: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "1rem",
  width: "100%",
  padding: "1rem 1.4rem",
  marginBottom: 2,
  background: C.card,
  border: "none",
  cursor: "pointer",
  textAlign: "left",
};

const compareBtn: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "0.6rem",
  background: C.ink,
  color: "#fff",
  border: "none",
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.04em",
  cursor: "pointer",
};
