import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getSupabase } from "@/lib/supabase";
import {
  buildCells,
  groupByBar,
  loadSkeleton,
  type Cell,
  type Skeleton,
} from "./skeleton";

/**
 * 曲ページ。いまは読むだけ（コールの投稿はまだ入れていない）。
 *
 * ・動画の上には何も重ねない。タイムラインは動画の下に置く
 * ・マスの幅は拍に比例（全マス同じ幅）。実時間には比例させない
 * ・行の折り返しは小節頭で折る。変拍子の小節は短い行になる
 */

type Song = {
  id: string;
  slug: string;
  title: string;
  group_name: string;
  bpm: number | null;
  first_beat_sec: number | null;
  skeleton_digest: string | null;
};

type Offset = {
  video_id: string;
  offset_sec: number;
  rate: number;
  note: string | null;
};

export default function SongPage() {
  const { slug = "" } = useParams();
  const [song, setSong] = useState<Song | null>(null);
  const [offsets, setOffsets] = useState<Offset[]>([]);
  const [sk, setSk] = useState<Skeleton | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoIdx, setVideoIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    loadSkeleton(slug).then(
      (s) => alive && setSk(s),
      (e) => alive && setError(String(e.message ?? e)),
    );
    getSupabase()
      .from("song_structures")
      .select("id, slug, title, group_name, bpm, first_beat_sec, skeleton_digest, song_video_offsets(video_id, offset_sec, rate, note)")
      .eq("slug", slug)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) return setError(error.message);
        if (!data) return setError("この曲は見つかりませんでした");
        const d = data as unknown as Song & { song_video_offsets: Offset[] };
        setSong(d);
        setOffsets(d.song_video_offsets ?? []);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (error) {
    return (
      <Shell>
        <div style={S.notice}>{error}</div>
        <Link to="/call-center" style={S.back}>← 曲の一覧へ</Link>
      </Shell>
    );
  }
  if (!song || !sk) {
    return (
      <Shell>
        <div style={S.notice}>読み込み中…</div>
      </Shell>
    );
  }

  const mismatch = song.skeleton_digest && song.skeleton_digest !== sk.digest;
  const video = offsets[videoIdx];
  const bars = groupByBar(buildCells(sk));

  return (
    <Shell>
      <Link to="/call-center" style={S.back}>← 曲の一覧へ</Link>

      <div style={S.eyebrow}>{song.group_name}</div>
      <h1 style={S.h1}>{song.title}</h1>
      <div style={S.meta}>
        BPM {Math.round(Number(song.bpm))} ／ 拍 {sk.beats.length}個 ／ 小節 {bars.length}個
        {sk.beatsMeasured !== null && sk.beatsMeasured < sk.beats.length && (
          <> ／ うち {sk.beats.length - sk.beatsMeasured}拍は曲の終わりまで継ぎ足した推定</>
        )}
      </div>

      {mismatch && (
        <div style={S.warn}>
          骨組みが作り直されています。運営が直した区間は、古い骨組みを前提にしている可能性があります。
        </div>
      )}

      {/* 動画。上には何も重ねない */}
      {video ? (
        <>
          <div style={S.videoBox}>
            <iframe
              key={video.video_id}
              style={S.iframe}
              src={`https://www.youtube-nocookie.com/embed/${video.video_id}?start=${Math.max(0, Math.floor(video.offset_sec + sk.firstBeatSec))}`}
              title={song.title}
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          {offsets.length > 1 && (
            <div style={S.tabs}>
              {offsets.map((o, i) => (
                <button
                  key={o.video_id}
                  onClick={() => setVideoIdx(i)}
                  style={{ ...S.tab, ...(i === videoIdx ? S.tabOn : null) }}
                >
                  {o.note?.slice(0, 18) || o.video_id}
                </button>
              ))}
            </div>
          )}
          <div style={S.videoMeta}>
            この動画では曲の0拍目が {(video.offset_sec + sk.firstBeatSec).toFixed(2)} 秒目
          </div>
        </>
      ) : (
        <div style={S.notice}>この曲にはまだ動画が結び付いていません。</div>
      )}

      {/* 区間の帯 */}
      <h2 style={S.h2}>曲の作り</h2>
      <div style={S.bandRow}>
        {sk.sections.map((s) => (
          <div
            key={s.order}
            style={{
              ...S.band,
              flexGrow: Math.max(0.4, s.endSec - s.startSec),
              background: BAND_TONE[s.group % BAND_TONE.length],
            }}
            title={`${fmt(s.startSec)} - ${fmt(s.endSec)}`}
          >
            <span style={S.bandLabel}>{s.name ?? s.labelAuto}</span>
          </div>
        ))}
      </div>

      {/* マス */}
      <h2 style={S.h2}>コール表</h2>
      <p style={S.hint}>
        1マスが8分音符です。濃いマスが小節の頭。まだコールは1つも置かれていません。
      </p>
      <div style={S.sheet}>
        {bars.map((bar, i) => (
          <div key={i} style={S.bar}>
            <span style={S.barNo}>{i + 1}</span>
            {bar.map((c) => (
              <CellBox key={c.tick} cell={c} />
            ))}
            {bar.length !== 8 && <span style={S.oddBar}>{bar.length / 2}拍</span>}
          </div>
        ))}
      </div>

      <div style={S.empty}>
        まだ観測がありません。コールを置けるようにする作業はこれからです。
      </div>
    </Shell>
  );
}

function CellBox({ cell }: { cell: Cell }) {
  return (
    <span
      style={{
        ...S.cell,
        background: cell.isBarStart ? "#dfe2e6" : cell.isBeat ? "#eceef0" : "#f4f5f6",
        opacity: cell.estimated ? 0.45 : 1,
      }}
      title={`${fmt(cell.sec)}${cell.estimated ? "（推定）" : ""}`}
    />
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

/** 区間の色分けはグレーの濃淡だけ（線を引かず面の段差で示す） */
const BAND_TONE = ["#e9ebed", "#dfe2e6", "#d3d7dc", "#c8cdd3", "#bcc2c9", "#b1b8c0", "#a6aeb7"];

const S: Record<string, React.CSSProperties> = {
  page: { background: "#f8f9fa", minHeight: "100vh", color: "#000" },
  wrap: { maxWidth: 880, margin: "0 auto", padding: "28px 20px 96px" },
  back: {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 12,
    color: "#585f6c",
    textDecoration: "none",
    display: "inline-block",
    marginBottom: 20,
  },
  eyebrow: {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.22em",
    color: "#585f6c",
  },
  h1: { fontSize: 28, fontWeight: 900, lineHeight: 1.25, margin: "6px 0 8px" },
  meta: { fontSize: 12.5, color: "#585f6c", marginBottom: 22 },
  h2: { fontSize: 15, fontWeight: 900, margin: "36px 0 8px" },
  hint: { fontSize: 12.5, color: "#585f6c", margin: "0 0 10px" },
  videoBox: { position: "relative", paddingTop: "56.25%", background: "#000" },
  iframe: { position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 },
  videoMeta: { fontSize: 12, color: "#585f6c", marginTop: 8 },
  tabs: { display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" },
  tab: {
    font: "inherit",
    fontSize: 12,
    fontWeight: 700,
    padding: "7px 12px",
    background: "#fff",
    color: "#585f6c",
    border: 0,
    cursor: "pointer",
  },
  tabOn: { background: "#000", color: "#fff" },
  bandRow: { display: "flex", gap: 2, height: 34 },
  band: { display: "grid", placeItems: "center", overflow: "hidden", flexBasis: 0 },
  bandLabel: {
    fontSize: 10,
    fontWeight: 800,
    color: "#33383f",
    whiteSpace: "nowrap",
    padding: "0 2px",
  },
  sheet: { display: "flex", flexDirection: "column", gap: 4 },
  bar: { display: "flex", gap: 2, alignItems: "center" },
  barNo: {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 9,
    color: "#9aa1aa",
    width: 22,
    textAlign: "right",
    flex: "0 0 22px",
  },
  cell: { width: 26, height: 30, flex: "0 0 26px", display: "block" },
  oddBar: {
    fontSize: 9.5,
    color: "#585f6c",
    marginLeft: 6,
    fontFamily: "Inter, system-ui, sans-serif",
  },
  notice: { background: "#fff", padding: "16px 18px", fontSize: 14, marginTop: 12 },
  warn: { background: "#000", color: "#fff", padding: "12px 16px", fontSize: 12.5, margin: "12px 0" },
  empty: { background: "#fff", padding: "18px", fontSize: 13.5, color: "#585f6c", marginTop: 20 },
};
