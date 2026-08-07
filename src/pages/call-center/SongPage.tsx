import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getSupabase } from "@/lib/supabase";
import Player, { type PlayerApi } from "./Player";
import Timeline from "./Timeline";
import CallTicker from "./CallTicker";
import { buildGrid, toUnits } from "./callBubbles";
import { findBuiltInSong } from "./builtInSongs";
import { loadLocalCalls, type LocalCall } from "./localCalls";
import {
  loadSkeleton,
  positionAt,
  toSongSec,
  toVideoSec,
  type Position,
  type Section,
  type Skeleton,
} from "./skeleton";

/**
 * 曲ページ。動画の再生に合わせて、いまのコールを出す「再生機」。
 *
 * 曲全体のマス目は出さない。コールがある所は曲のごく一部で、
 * 並べても読む助けにならないため。マス目は「読むため」ではなく
 * 「置くため」の道具なので、投稿の段で出す。
 *
 * 動画の上には何も重ねない（YouTubeの決まり）。表示はすべて動画の下。
 */

type Song = {
  id: string;
  slug: string;
  title: string;
  group_name: string;
  bpm: number | null;
  skeleton_digest: string | null;
};

type Offset = {
  video_id: string;
  offset_sec: number;
  rate: number;
  note: string | null;
};

/** 動画の種類。いまは覚え書きの文面から見分けている（仮。専用の列を立てるまでのつなぎ） */
type Kind = "audio" | "live" | "lecture" | "other";

function kindOf(o: Offset): Kind {
  const note = o.note ?? "";
  if (/レクチャー/.test(note)) return "lecture";
  if (/配信音源|音源/.test(note)) return "audio";
  if (/ハロ！ステ|ハロステ|Live|ライブ|MV/i.test(note)) return "live";
  return "other";
}

const KIND_LABEL: Record<Kind, string> = {
  live: "ライブ映像",
  lecture: "コールレクチャー",
  audio: "音源（映像なし）",
  other: "動画",
};

/** 見るものを先に、映像のない音源を最後に。 */
const KIND_ORDER: Record<Kind, number> = { lecture: 0, live: 1, other: 2, audio: 3 };

/**
 * タブに出す名前。短い覚え書きが入っていればそれを、
 * 長い事情メモしか無いときは種類の名前を出す。
 * （動画の種類を持つ列ができたら、そちらを見るように差し替える）
 */
function tabLabel(o: Offset): string {
  const note = (o.note ?? "").trim();
  if (note !== "" && [...note].length <= 16) return note;
  return KIND_LABEL[kindOf(o)];
}

/**
 * 帯に映す秒数の選択肢。
 * 言葉の主語は「コールの見え方」でそろえる。狭く映すほど1つずつが大きく出て、
 * 広く映すほど小さくなり、入りきらないものは点になる。
 */
const SPAN_CHOICES = [
  { sec: 6, label: "小さい" },
  { sec: 3, label: "ふつう" },
  { sec: 1.8, label: "大きい" },
];


export default function SongPage() {
  const { slug = "" } = useParams();
  const [song, setSong] = useState<Song | null>(null);
  const [rawOffsets, setRawOffsets] = useState<Offset[]>([]);
  const [sk, setSk] = useState<Skeleton | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoIdx, setVideoIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  // 採譜したコール。いまは端末の中にあるものを読む（サーバー保存はまだ通らない）
  const [calls, setCalls] = useState<LocalCall[]>([]);
  // 帯に映す秒数。狭いほど拍が読みやすく、広いほど先が見える。
  // 何を言うかは下の段が受け持つので、どちらに振っても言葉は分かる。
  const [spanSec, setSpanSec] = useState(3);

  const playerRef = useRef<PlayerApi>(null);
  // 毎コマ書き換えるので、React の描き直しを挟まずに直接触る
  const progressRef = useRef<HTMLDivElement | null>(null);
  const clockRef = useRef<HTMLSpanElement | null>(null);
  // いま表示している居場所。変わったときだけ描き直す
  const shownRef = useRef("");

  useEffect(() => {
    let alive = true;
    setError(null);
    // 骨組みは「あれば拍の線と区間が出る」飾り。無い曲もそのまま開ける。
    setSk(null);

    // まだ棚に入れていない曲は、アプリに同梱したデータで開く
    const builtIn = findBuiltInSong(slug);
    if (builtIn) {
      setSong({
        id: builtIn.slug,
        slug: builtIn.slug,
        title: builtIn.title,
        group_name: builtIn.groupName,
        bpm: builtIn.bpm,
        skeleton_digest: null,
      });
      setRawOffsets(
        builtIn.videos.map((v) => ({
          video_id: v.videoId,
          offset_sec: v.offsetSec,
          rate: 1,
          note: v.label,
        })),
      );
      const mine = loadLocalCalls(slug);
      setCalls(mine.length > 0 ? mine : builtIn.calls);
      return () => {
        alive = false;
      };
    }

    setCalls(loadLocalCalls(slug));
    loadSkeleton(slug).then(
      (s) => alive && setSk(s),
      () => { /* 骨組みが無い曲。コールは秒で持っているのでこのまま表示できる */ },
    );
    getSupabase()
      .from("song_structures")
      .select("id, slug, title, group_name, bpm, skeleton_digest, song_video_offsets(video_id, offset_sec, rate, note)")
      .eq("slug", slug)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) return setError(error.message);
        if (!data) return setError("この曲は見つかりませんでした");
        const d = data as unknown as Song & { song_video_offsets: Offset[] };
        setSong(d);
        setRawOffsets(d.song_video_offsets ?? []);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  const offsets = useMemo(
    () => [...rawOffsets].sort((a, b) => KIND_ORDER[kindOf(a)] - KIND_ORDER[kindOf(b)]),
    [rawOffsets],
  );
  const video = offsets[videoIdx];

  // 1拍の長さ。骨組みがあればそちら、無ければ棚に入れたBPMから。
  const beatSec = useMemo(() => {
    if (sk && sk.bpm > 0) return 60 / sk.bpm;
    if (song?.bpm) return 60 / Number(song.bpm);
    return undefined;
  }, [sk, song]);

  // 8分ごとの目盛りと、その上に立つ粒。粒は必ず目盛りに吸着する。
  const grid = useMemo(
    () =>
      buildGrid({
        beats: sk?.beats,
        downbeats: sk?.downbeats,
        beatSec,
        anchorSec: calls[0]?.t ?? 0,
        endSec: Math.max(calls[calls.length - 1]?.t ?? 0, sk?.beats[sk.beats.length - 1] ?? 0) + 8,
      }),
    [sk, beatSec, calls],
  );
  const units = useMemo(() => toUnits(calls, beatSec, grid), [calls, beatSec, grid]);
  const sections = useMemo(
    () =>
      (sk?.sections ?? []).map((s) => ({
        order: s.order,
        startSec: s.startSec,
        endSec: s.endSec,
        label: s.name ?? s.labelAuto,
        group: s.group,
      })),
    [sk],
  );

  // 帯は毎コマこれを呼ぶ。作り直されると帯の動きが途切れるので、中身だけ差し替わる形にする。
  const videoRef = useRef(video);
  videoRef.current = video;
  const getNowSong = useRef(() => {
    const v = videoRef.current;
    const p = playerRef.current;
    if (!v || !p) return 0;
    return toSongSec(p.getCurrentTime(), v.offset_sec, v.rate);
  }).current;

  // 再生位置を毎コマ読んで、曲の中での居場所に直す。
  useEffect(() => {
    if (!video) return;
    let raf = 0;
    // 曲の長さ。骨組みがあれば最後の拍まで、無ければ動画の長さを借りる。
    const skTotal = sk ? (sk.beats[sk.beats.length - 1] ?? 0) : 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const p = playerRef.current;
      if (!p) return;
      const songSec = getNowSong();
      const total = skTotal > 0 ? skTotal : Math.max(0, p.getDuration() - video.offset_sec);

      if (progressRef.current) {
        const ratio = total > 0 ? Math.max(0, Math.min(1, songSec / total)) : 0;
        progressRef.current.style.transform = `scaleX(${ratio})`;
      }
      if (clockRef.current) clockRef.current.textContent = fmt(Math.max(0, songSec));

      if (!sk) return; // 骨組みが無い曲では、小節や区間の表示そのものが出ない
      const next = positionAt(sk, songSec);
      const key = `${next.bar}/${next.beatInBar}/${next.section?.order ?? -1}`;
      if (key !== shownRef.current) {
        shownRef.current = key;
        setPos(next);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sk, video]);

  if (error) {
    return (
      <Shell>
        <div style={S.notice}>{error}</div>
        <Link to="/call-center" style={S.back}>← 曲の一覧へ</Link>
      </Shell>
    );
  }
  if (!song) {
    return (
      <Shell>
        <div style={S.notice}>読み込み中…</div>
      </Shell>
    );
  }

  const mismatch = sk && song.skeleton_digest && song.skeleton_digest !== sk.digest;
  const startAt = video ? toVideoSec(0, video.offset_sec, video.rate) : 0;

  // 区間の頭へ飛ぶ。押した操作の中で再生まで済ませる（iPhoneで音が出る条件）
  const jumpTo = (s: Section) => {
    const p = playerRef.current;
    if (!p || !video) return;
    p.seekTo(toVideoSec(s.startSec, video.offset_sec, video.rate));
    p.play();
  };

  return (
    <Shell>
      <Link to="/call-center" style={S.back}>← 曲の一覧へ</Link>

      <div style={S.eyebrow}>{song.group_name}</div>
      <h1 style={S.h1}>{song.title}</h1>

      {mismatch && (
        <div style={S.warn}>
          骨組みが作り直されています。運営が直した区間は、古い骨組みを前提にしている可能性があります。
        </div>
      )}

      {video ? (
        <>
          {/* 動画は上に貼り付けて、下の内容がその後ろを流れていくようにする */}
          <div style={S.videoStick}>
            <Player
              key={video.video_id}
              ref={playerRef}
              videoId={video.video_id}
              startSeconds={startAt}
              onPlayingChange={setPlaying}
            />

            {/* 曲のどこを再生しているか。動画の下に置く */}
            <div style={S.progressTrack}>
              <div ref={progressRef} style={S.progressFill} />
            </div>
          </div>

          {/*
            自前の再生ボタン。押された操作の中から直接プレイヤーを動かす。
            iPhoneは「利用者が押した瞬間」でないと音を出さないため、
            この形にしておかないと再生が始まらないことがある。
          */}
          <div style={S.transport}>
            <button
              onClick={() => {
                const p = playerRef.current;
                if (!p) return;
                if (p.isPlaying()) p.pause();
                else p.play();
              }}
              style={S.playBtn}
            >
              {playing ? "■　停止" : "▶　再生"}
            </button>
            <button
              onClick={() => {
                const p = playerRef.current;
                if (!p) return;
                p.seekTo(startAt);
                p.play();
              }}
              style={S.rewindBtn}
            >
              曲の頭から
            </button>
          </div>

          {offsets.length > 1 && (
            <div style={S.tabs}>
              {offsets.map((o, i) => (
                <button
                  key={o.video_id}
                  onClick={() => setVideoIdx(i)}
                  style={{ ...S.tab, ...(i === videoIdx ? S.tabOn : null) }}
                >
                  {tabLabel(o)}
                </button>
              ))}
            </div>
          )}

          {kindOf(video) === "audio" && (
            <p style={S.videoNote}>
              これは配信されている音源です。映像はなく、ジャケットの絵が出たままになります。
            </p>
          )}

          {/* 横に流れるコールの帯。中央の線がいまの位置 */}
          <div style={S.timelineWrap}>
            <Timeline
              sections={sections}
              grid={grid}
              units={units}
              getNow={getNowSong}
              totalSec={playerRef.current ? playerRef.current.getDuration() - video.offset_sec : 0}
              spanSec={spanSec}
            />
          </div>

          {/* 何を言うかは、拡大しても縮めても読めるようにこちらで受け持つ */}
          <CallTicker units={units} getNow={getNowSong} />

          <div style={S.spanRow}>
            {SPAN_CHOICES.map((c) => (
              <button
                key={c.sec}
                onClick={() => setSpanSec(c.sec)}
                style={{ ...S.spanBtn, ...(spanSec === c.sec ? S.spanBtnOn : null) }}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div style={S.stagePos}>
            {sk && (
              <>
                {pos && pos.bar > 0 ? (pos.section?.name ?? pos.section?.labelAuto ?? "—") : "再生前"}
                <span style={S.sep}>／</span>
                {pos && pos.bar > 0 ? `${pos.bar}小節目 ${pos.beatInBar}拍目` : "0小節目"}
                <span style={S.sep}>／</span>
              </>
            )}
            <span ref={clockRef} style={S.clock}>0:00.00</span>
            <span style={S.sep}>／</span>
            {playing ? "再生中" : "停止中"}
          </div>

          <Link to={`/call-center/song/${song.slug}/tap?v=${video.video_id}`} style={S.tapLink}>
            この動画でコールを採譜する
          </Link>

          {/* 曲の作りと拍の情報は、骨組みがある曲にだけ出る */}
          {sk && (
            <>
              <h2 style={S.h2}>曲の作り</h2>
              <p style={S.hint}>押すとその場所から再生します。</p>
              <div style={S.sectionList}>
                {sk.sections.map((s) => {
                  const on = pos?.section?.order === s.order;
                  return (
                    <button
                      key={s.order}
                      onClick={() => jumpTo(s)}
                      style={{ ...S.sectionRow, ...(on ? S.sectionRowOn : null) }}
                    >
                      <span style={S.sectionTime}>{fmt(s.startSec)}</span>
                      <span style={S.sectionName}>{s.name ?? s.labelAuto}</span>
                      <span style={S.sectionLen}>{Math.round(s.endSec - s.startSec)}秒</span>
                    </button>
                  );
                })}
              </div>

              <div style={S.meta}>
                BPM {Math.round(Number(song.bpm))} ／ 拍 {sk.beats.length}個
                {sk.beatsMeasured !== null && sk.beatsMeasured < sk.beats.length && (
                  <> ／ うち {sk.beats.length - sk.beatsMeasured}拍は曲の終わりまで継ぎ足した推定</>
                )}
                <br />
                この動画では曲の0拍目が {toVideoSec(sk.firstBeatSec, video.offset_sec, video.rate).toFixed(2)} 秒目
              </div>
            </>
          )}
        </>
      ) : (
        <div style={S.notice}>この曲にはまだ動画が結び付いていません。</div>
      )}
    </Shell>
  );
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={S.page}>
      <div style={S.wrap}>{children}</div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { background: "#f8f9fa", minHeight: "100vh", color: "#000" },
  wrap: { maxWidth: 620, margin: "0 auto", padding: "24px 20px 96px" },
  back: {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 12,
    color: "#585f6c",
    textDecoration: "none",
    display: "inline-block",
    marginBottom: 18,
  },
  eyebrow: {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.22em",
    color: "#585f6c",
  },
  h1: { fontSize: 26, fontWeight: 900, lineHeight: 1.25, margin: "6px 0 16px" },
  h2: { fontSize: 15, fontWeight: 900, margin: "36px 0 6px" },
  hint: { fontSize: 12.5, color: "#585f6c", margin: "0 0 10px" },
  meta: { fontSize: 12, color: "#585f6c", marginTop: 28, lineHeight: 1.8 },
  videoNote: { fontSize: 12.5, color: "#585f6c", margin: "10px 0 0", lineHeight: 1.7 },

  videoStick: {
    position: "sticky",
    top: 0,
    zIndex: 20,
    background: "#f8f9fa",
    // 画面の外へはみ出さないよう、横の余白ぶんだけ広げて背景を敷く
    margin: "0 -20px",
    padding: "0 20px",
  },
  progressTrack: { height: 3, background: "#dfe2e6", overflow: "hidden" },
  progressFill: {
    height: "100%",
    background: "#000",
    transform: "scaleX(0)",
    transformOrigin: "left center",
  },

  tabs: { display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" },
  tab: {
    font: "inherit",
    fontSize: 12,
    fontWeight: 700,
    padding: "8px 14px",
    background: "#fff",
    color: "#585f6c",
    border: 0,
    cursor: "pointer",
  },
  tabOn: { background: "#000", color: "#fff" },

  timelineWrap: { marginTop: 12 },
  stagePos: {
    fontSize: 12,
    color: "#585f6c",
    fontVariantNumeric: "tabular-nums",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 10,
  },
  sep: { color: "#c8cdd3", margin: "0 8px" },
  clock: { fontFamily: "Inter, system-ui, sans-serif" },

  transport: { display: "flex", gap: 2, marginTop: 2 },
  playBtn: {
    font: "inherit",
    flex: "1 1 auto",
    fontSize: 14,
    fontWeight: 800,
    padding: "14px 16px",
    background: "#000",
    color: "#fff",
    border: 0,
    cursor: "pointer",
    letterSpacing: "0.04em",
  },
  rewindBtn: {
    font: "inherit",
    flex: "0 0 auto",
    fontSize: 12.5,
    fontWeight: 700,
    padding: "14px 16px",
    background: "#fff",
    color: "#585f6c",
    border: 0,
    cursor: "pointer",
  },

  spanRow: { display: "flex", gap: 2, justifyContent: "center", marginTop: 2 },
  spanBtn: {
    font: "inherit",
    fontSize: 11.5,
    fontWeight: 700,
    padding: "7px 14px",
    background: "#fff",
    color: "#585f6c",
    border: 0,
    cursor: "pointer",
  },
  spanBtnOn: { background: "#000", color: "#fff" },

  tapLink: {
    display: "block",
    marginTop: 14,
    padding: "12px 16px",
    background: "#000",
    color: "#fff",
    fontSize: 13.5,
    fontWeight: 700,
    textAlign: "center",
    textDecoration: "none",
  },

  sectionList: { display: "flex", flexDirection: "column", gap: 2 },
  sectionRow: {
    font: "inherit",
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    textAlign: "left",
    background: "#fff",
    color: "#000",
    border: 0,
    padding: "12px 16px",
    cursor: "pointer",
  },
  sectionRowOn: { background: "#000", color: "#fff" },
  sectionTime: {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 11,
    opacity: 0.55,
    flex: "0 0 52px",
    fontVariantNumeric: "tabular-nums",
  },
  sectionName: { fontSize: 14, fontWeight: 700, flex: "1 1 auto" },
  sectionLen: { fontSize: 11, opacity: 0.55, flex: "0 0 auto" },

  notice: { background: "#fff", padding: "16px 18px", fontSize: 14, marginTop: 12 },
  warn: { background: "#000", color: "#fff", padding: "12px 16px", fontSize: 12.5, margin: "0 0 12px" },
};
