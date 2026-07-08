import { useMemo, useRef, useState } from "react";
import { SETLIST, findVideo, haloVideos, compareAnchor, SHOW_BY_NO, showSortKey } from "@/data/the-ballad";
import type { VideoLink } from "@/data/the-ballad";
import { C } from "../ui";
import PlayChip from "./PlayChip";
import ShareChip from "./ShareChip";
import { MemberEmph } from "./Emph";
import { Accordion } from "./Accordion";
import CompareModal from "./CompareModal";
import type { YouTubePlayerApi } from "./YouTubePlayer";

interface Occasion {
  showNo: string;
  video?: VideoLink; // その公演の公式映像（無ければ undefined）
}
interface MemberAgg {
  member: string;
  count: number;         // 歌った公演数（= occasions.length）
  occasions: Occasion[]; // 歌った公演（日付順）
  haloVids: VideoLink[]; // ハロ！ステ等、公演に紐付かない公式歌唱
  hasVideo: boolean;     // この歌唱者に1本でも動画があるか
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
  // メンバーの公演内訳は同時に1つだけ開く（別メンバーを開くと前のは閉じる）
  const [openMember, setOpenMember] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ song: string; versions: VideoLink[] } | null>(null);
  const playerRef = useRef<YouTubePlayerApi | null>(null);

  const toggleMember = (key: string) => setOpenMember((prev) => (prev === key ? null : key));

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
        m = { member: e.member, count: 0, occasions: [], haloVids: [], hasVideo: false };
        s.members.push(m);
      }
      // 同一公演は1回（昼夜別公演はそれぞれ別 showNo なので別行になる）
      if (!m.occasions.some((o) => o.showNo === e.showNo)) {
        const v = findVideo(e.showNo, e.member, e.songCore);
        m.occasions.push({ showNo: e.showNo, video: v });
        if (v) {
          m.hasVideo = true;
          s.hasVideo = true;
        }
      }
    }
    const arr = [...map.values()];
    // ハロ！ステの公式歌唱（メンバー×曲）を各歌唱者に足す（公演に紐付かない別枠）
    arr.forEach((s) =>
      s.members.forEach((m) => {
        const hv = haloVideos(m.member, s.songCore);
        if (hv.length) {
          m.haloVids.push(...hv);
          m.hasVideo = true;
          s.hasVideo = true;
        }
      })
    );
    // occasions を日付順に並べ、member の公演数を確定してから並べ替え
    arr.forEach((s) => {
      s.members.forEach((m) => {
        m.occasions.sort((a, b) => showSortKey(a.showNo) - showSortKey(b.showNo));
        m.count = m.occasions.length;
      });
      s.members.sort((a, b) => b.count - a.count);
    });
    arr.sort((a, b) => b.count - a.count || a.songCore.localeCompare(b.songCore, "ja"));
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
                {s.hasVideo && <span style={playMark} aria-label="公式映像あり" />}
                <span style={{ fontSize: "0.7rem", color: C.faint, fontWeight: 700 }}>{s.count}回</span>
                <span style={{ color: C.hair, fontSize: "0.8rem" }}>{isOpen ? "−" : "+"}</span>
              </div>
            </button>
            <Accordion open={isOpen}>
              <div style={{ padding: "0 1.4rem 1rem" }}>
                {(() => {
                  const seen = new Set<string>();
                  const all = s.members
                    .flatMap((m) => m.occasions.map((o) => o.video))
                    .filter((v): v is VideoLink => !!v)
                    .filter((v) => (seen.has(v.videoId) ? false : (seen.add(v.videoId), true)));
                  return all.length >= 2 ? (
                    <button
                      onClick={() => {
                        // タップ(ジェスチャ)ハンドラ内で先頭版を音ありロード(iOS対策)してからモーダルを開く
                        playerRef.current?.unMute();
                        playerRef.current?.loadVideo(all[0].videoId, { startSeconds: compareAnchor(all[0].videoId, all[0].startSec) });
                        setCompare({ song: s.songCore, versions: all });
                      }}
                      style={compareBtn}
                    >
                      聴き比べ（{all.length}）
                    </button>
                  ) : null;
                })()}
                {s.members.filter((m) => !videoOnly || m.hasVideo).map((m) => {
                  const mk = s.songCore + "|" + m.member;
                  const isMemOpen = openMember === mk;
                  // 「動画あり」ON時は映像のある行だけ
                  const occ = videoOnly ? m.occasions.filter((o) => o.video) : m.occasions;
                  // 昼夜まとめ等、同じ動画が複数公演にある場合、公演の記載は各行に残しつつ、
                  // ボタンは最後の公演（夜）の下に1つだけ出す（同じ映像でのぬか喜び防止）
                  const lastVidIdx = new Map<string, number>();
                  occ.forEach((o, i) => { if (o.video) lastVidIdx.set(o.video.videoId, i); });
                  return (
                    <div key={m.member} style={{ borderTop: `1px solid ${C.line}` }}>
                      <button onClick={() => toggleMember(mk)} style={memberRowBtn}>
                        <span style={{ fontSize: "0.8rem", color: C.body }}><MemberEmph member={m.member} big="0.8rem" small="0.8rem" /></span>
                        <span style={{ fontSize: "0.7rem", color: C.faint }}>×{m.count}</span>
                        <span style={{ flex: 1 }} />
                        {m.hasVideo && <span style={playMark} aria-label="公式映像あり" />}
                        <span style={{ color: C.hair, fontSize: "0.8rem" }}>{isMemOpen ? "−" : "+"}</span>
                      </button>
                      <Accordion open={isMemOpen}>
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
                          {m.haloVids.map((v) => (
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
        );
      })}
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
const memberRowBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
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
// 「公式映像あり」の印。再生ボタン的な右向き三角（border で作図＝角丸0pxデザインに合わせ、フォント非依存）
const playMark: React.CSSProperties = {
  width: 0,
  height: 0,
  borderTop: "4px solid transparent",
  borderBottom: "4px solid transparent",
  borderLeft: "6px solid #000",
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
