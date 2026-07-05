import { OMAKE, omakeVideo, OMAKE_CHUSEN, chusenVideo } from "@/data/the-ballad";
import type { VideoLink } from "@/data/the-ballad";
import { C } from "../ui";
import { MemberEmph } from "./Emph";
import { Count, Empty } from "./SongView";

// OMAKE タブ: The Ballad 楽曲のスタジオソロカバー（各ユニット公式チャンネルの単独動画）と、
// 各会場ブロックの歌唱順抽選会（舞台裏）を一覧表示。いずれもタップで全編再生。
// ※スタジオ収録のみで公演映像と混ざらないため、聴き比べ（同曲の別歌唱の切替）は置かない。
export default function OmakeView({
  query,
  onPlay,
}: {
  query: string;
  onPlay: (v: VideoLink) => void;
}) {
  const q = query.trim().toLowerCase();

  const covers = OMAKE.filter((e) => {
    if (!q) return true;
    return (
      e.songCore.toLowerCase().includes(q) ||
      e.artist.toLowerCase().includes(q) ||
      e.member.toLowerCase().includes(q) ||
      e.channel.toLowerCase().includes(q)
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

  if (covers.length === 0 && chusen.length === 0) return <Empty videoOnly={false} />;

  return (
    <div>
      {covers.length > 0 && (
        <p style={{ fontSize: "0.8125rem", color: C.meta, margin: "0 0 1rem", lineHeight: 1.6 }}>
          「Hello! Project 2020 Summer COVERS 〜The Ballad〜」で披露された楽曲の、公式チャンネル配信のスタジオソロカバーです。
        </p>
      )}
      {covers.length > 0 && <Count n={covers.length} unit="曲" />}
      {covers.map((e) => (
        <button key={e.videoId} onClick={() => onPlay(omakeVideo(e))} style={card}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "0.7rem", color: C.body, marginBottom: "0.15rem" }}>
              <MemberEmph member={e.member} big="0.7rem" small="0.7rem" />
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

      {chusen.length > 0 && (
        <div style={{ marginTop: covers.length > 0 ? "2rem" : 0 }}>
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
