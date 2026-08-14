import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getSupabase } from "@/lib/supabase";
import YouTubePlayer, { type YouTubePlayerApi } from "../hi-tension/components/YouTubePlayer";
import HandsCanvas, { type HandsCanvasApi } from "../hi-tension/components/HandsCanvas";
import type { HiSession } from "../hi-tension/api";
import { toVideoSec } from "./skeleton";
import { findBuiltInSong } from "./builtInSongs";

/**
 * 置く画面。
 *
 * 画面いっぱいに収める（スクロールしない）。上から順に、動画・跳ねる面・ボタン。
 * 常時出るのは4つだけ（← 曲へ／▶再生・停止／！／？）。
 * 跳ねる面はハイ！テンションの客席（HandsCanvas）をそのまま使い、絵だけ「！の入った吹き出し」にしている。
 * 動画の上には何も重ねない。
 *
 * すでに集まっているぶん（登録済みのコール）は、跳ねる面にそのまま流す。
 *
 * ※叩いた結果を送る先（生の叩きの棚）はまだ無い。いまは画面の中に数えるだけで、
 *   離れると消える。触り心地を確かめるための段階。
 */

type Video = { video_id: string; offset_sec: number; rate: number; label: string | null };

export default function PlacePage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const playerRef = useRef<YouTubePlayerApi>(null);
  const handsRef = useRef<HandsCanvasApi>(null);

  const [title, setTitle] = useState("");
  const [video, setVideo] = useState<Video | null>(null);
  const [sessions, setSessions] = useState<HiSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [marks, setMarks] = useState(0);
  const [holds, setHolds] = useState(0);
  const [nowSec, setNowSec] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);

    // 棚に入っていない曲は同梱データで開く
    const builtIn = findBuiltInSong(slug);
    const openBuiltIn = () => {
      if (!builtIn) return false;
      setTitle(builtIn.title);
      const v = builtIn.videos[0];
      if (v) setVideo({ video_id: v.videoId, offset_sec: v.offsetSec, rate: 1, label: v.label });
      return true;
    };

    try {
      getSupabase()
        .from("song_structures")
        .select("id, title, song_video_offsets(video_id, offset_sec, rate, label)")
        .eq("slug", slug)
        .maybeSingle()
        .then(({ data }) => {
          if (!alive) return;
          if (!data) { if (!openBuiltIn()) setError("この曲は見つかりませんでした"); return; }
          const d = data as unknown as { id: string; title: string; song_video_offsets: Video[] };
          setTitle(d.title);
          const v = d.song_video_offsets?.[0];
          if (!v) { setError("この曲にはまだ動画が結び付いていません"); return; }
          setVideo({ video_id: v.video_id, offset_sec: Number(v.offset_sec), rate: Number(v.rate) || 1, label: v.label });

          // すでに登録されているコールを、跳ねる面に流すぶんとして読む
          getSupabase()
            .rpc("get_song_calls", { p_song_id: d.id })
            .then(({ data: rows }) => {
              if (!alive || !rows) return;
              const secs = (rows as { start_sec: number | null }[])
                .filter((r) => r.start_sec !== null)
                .map((r) => toVideoSec(Number(r.start_sec), Number(v.offset_sec), Number(v.rate) || 1));
              if (secs.length === 0) return;
              setSessions([{
                session_hash: 424242,
                member_id: "nishida", // 色は overrideColor で塗るので誰でもよい
                is_today: true,
                bucket_indices: secs.map((t) => Math.round(t * 10)),
                bucket_indices_20: secs.map((t) => Math.round(t * 20)),
                played_date: new Date().toISOString().slice(0, 10),
              }]);
            }, () => { /* 読めなくても置く画面は成り立つ */ });
        }, () => { if (alive && !openBuiltIn()) setError("いま棚に繋がりません"); });
    } catch {
      if (!openBuiltIn()) setError("いま棚に繋がりません");
    }
    return () => { alive = false; };
  }, [slug]);

  const onTime = (sec: number) => {
    handsRef.current?.onTimeUpdate(sec);
    setNowSec(Math.max(0, sec - (video?.offset_sec ?? 0)));
  };

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPlaying()) { p.pause(); setPlaying(false); }
    else { p.play(); setPlaying(true); }
  };

  /** 押した瞬間（onPointerDown）に出す。指を離すのを待つとその分そのまま遅れて感じる。 */
  const pressMark = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    handsRef.current?.spawnSelf();
    setMarks((n) => n + 1);
  };
  const pressHold = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setHolds((n) => n + 1);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;

  if (error) {
    return (
      <div style={{ ...S.page, justifyContent: "center", alignItems: "center" }}>
        <p style={{ fontSize: 14 }}>{error}</p>
        <button style={S.play} onClick={() => navigate(`/call-center/song/${slug}`)}>← 曲へ</button>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={S.head}>
        <button style={S.back} onClick={() => navigate(`/call-center/song/${slug}`)}>← 曲へ</button>
        <span style={S.title}>{title}</span>
        <span style={S.count}>！ {marks} ／ ？ {holds}</span>
      </div>

      <div style={S.videoBox}>
        {video && (
          <YouTubePlayer
            ref={playerRef}
            videoId={video.video_id}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={onTime}
          />
        )}
      </div>

      <div style={S.row}>
        <button type="button" style={S.play} onClick={togglePlay}>{playing ? "⏸ 停止" : "▶ 再生"}</button>
        <span style={S.clock}>{fmt(nowSec)}</span>
        <span style={S.notice}>いまは送られません【仮】</span>
      </div>

      {/* 跳ねる面。残りの高さを全部使う。動画の上には重ねない */}
      <div style={S.stage}>
        <HandsCanvas
          ref={handsRef}
          icon="mark"
          sessions={sessions}
          selfMemberId="nishida"
          selfSeatHash={7}
          overrideColor="#ffffff"
          scaleCount={300}
          topMargin={150}
          freezeAge
        />
      </div>

      <div style={S.btnRow}>
        <button type="button" style={S.mark} onPointerDown={pressMark} onContextMenu={(e) => e.preventDefault()}>！</button>
        <button type="button" style={S.hold} onPointerDown={pressHold} onContextMenu={(e) => e.preventDefault()}>？</button>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: {
    background: "#000", color: "#eee", height: "100dvh", overflow: "hidden",
    display: "flex", flexDirection: "column",
    maxWidth: 520, margin: "0 auto", padding: "8px 10px 10px",
    fontFamily: "'Hiragino Sans','Noto Sans JP',system-ui,sans-serif",
  },
  head: { display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto", marginBottom: 6 },
  back: { background: "none", border: 0, color: "#9aa0a6", fontSize: 12, cursor: "pointer", padding: 0, fontFamily: "inherit" },
  title: { fontSize: 15, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  count: { marginLeft: "auto", fontSize: 12, color: "#8a8a92", fontFamily: "ui-monospace,Menlo,Consolas,monospace", flexShrink: 0 },
  videoBox: { flex: "0 0 auto" },
  row: { display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto", margin: "6px 0" },
  play: { background: "#1a1a1a", color: "#eee", border: 0, boxShadow: "inset 0 0 0 1px #444", padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  clock: { fontSize: 12, color: "#666", fontFamily: "ui-monospace,Menlo,Consolas,monospace" },
  notice: { marginLeft: "auto", fontSize: 11, color: "#6a6a72" },
  stage: { position: "relative", flex: "1 1 auto", minHeight: 0, background: "#0a0a0c", overflow: "hidden" },
  btnRow: { display: "flex", gap: 8, flex: "0 0 auto", marginTop: 8 },
  mark: { flex: 1, background: "#fff", color: "#000", border: 0, padding: "22px 10px", fontSize: 30, fontWeight: 900, lineHeight: 1, cursor: "pointer", fontFamily: "inherit" },
  hold: { flex: "0 0 84px", background: "#1a1a1a", color: "#9aa0a6", border: 0, boxShadow: "inset 0 0 0 1px #4a4a52", fontSize: 22, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" },
};
