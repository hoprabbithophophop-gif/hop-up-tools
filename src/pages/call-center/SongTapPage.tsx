import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getSupabase } from "@/lib/supabase";
import ArigatoBeatTapPage, { type TapPageCall } from "../hi-tension/ArigatoBeatTapPage";
import { loadSkeleton, toSongSec } from "./skeleton";
import { saveLocalCalls, type LocalCall } from "./localCalls";

/**
 * 曲のコールを採譜する画面。
 *
 * 中身はありがとビートの採譜ツールをそのまま使う。あちらは
 * 「動画を見ながら叩いて秒数を記録し、コール文を書き込む」道具として
 * 既に出来上がっているので、同じものを曲ごとに開けるようにしただけ。
 * 採譜ツール自体は書き換えず、曲を渡す受け口を足して呼んでいる。
 *
 * 叩いて記録されるのは「その動画の何秒目か」。取り込むときに
 * 「曲の何秒目か」へ直してから置き場に入れる。こうしておくと、
 * 同じ曲の別の動画に切り替えても同じコールがそのまま乗る。
 */

type Song = {
  id: string;
  slug: string;
  title: string;
  group_name: string;
  bpm: number | null;
};

type Offset = { video_id: string; offset_sec: number; rate: number; note: string | null };

export default function SongTapPage() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const wantVideo = params.get("v");

  const [song, setSong] = useState<Song | null>(null);
  const [offsets, setOffsets] = useState<Offset[]>([]);
  const [bpmHint, setBpmHint] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSupabase()
      .from("song_structures")
      .select("id, slug, title, group_name, bpm, song_video_offsets(video_id, offset_sec, rate, note)")
      .eq("slug", slug)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) return setError(error.message);
        if (!data) return setError("この曲は見つかりませんでした");
        const d = data as unknown as Song & { song_video_offsets: Offset[] };
        setSong(d);
        setOffsets(d.song_video_offsets ?? []);
        if (d.bpm) setBpmHint(Number(d.bpm));
      });
    // 骨組みがある曲なら、そのBPMを補正の初期値として借りる（無くても採譜はできる）
    loadSkeleton(slug).then(
      (sk) => alive && sk.bpm > 0 && setBpmHint((v) => v ?? sk.bpm),
      () => { /* 骨組みが無い曲。BPMは叩いた間隔から見当を付ける */ },
    );
    return () => {
      alive = false;
    };
  }, [slug]);

  if (error) return <Notice>{error}</Notice>;
  if (!song) return <Notice>読み込み中…</Notice>;

  const video = offsets.find((o) => o.video_id === wantVideo) ?? offsets[0];
  if (!video) {
    return <Notice>この曲にはまだ動画が結び付いていないので、採譜を始められません。</Notice>;
  }

  const onSave = (calls: TapPageCall[]) => {
    // 叩いた秒（その動画の絶対秒）を、曲の時計の秒へ直す
    const converted: LocalCall[] = calls
      .filter((c) => c.note.trim() !== "")
      .map((c) => ({
        t: Math.round(toSongSec(c.t, video.offset_sec, video.rate) * 1000) / 1000,
        lenSec: c.lenSec,
        note: c.note.trim(),
      }))
      .sort((a, b) => a.t - b.t);
    saveLocalCalls(slug, converted);
  };

  return (
    <ArigatoBeatTapPage
      key={video.video_id}
      song={{
        slug: song.slug,
        title: song.title,
        groupName: song.group_name,
        videoId: video.video_id,
        bpm: bpmHint,
        backTo: `/call-center/song/${song.slug}`,
      }}
      onSave={onSave}
    />
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#000", color: "#eee", minHeight: "100dvh", padding: "24px 20px", fontFamily: "Inter, system-ui, sans-serif" }}>
      <p style={{ fontSize: 14 }}>{children}</p>
      <a href="/call-center" style={{ fontSize: 13, color: "#7cf" }}>← 曲の一覧へ</a>
    </div>
  );
}
