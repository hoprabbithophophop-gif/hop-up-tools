import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getSupabase } from "@/lib/supabase";
import ArigatoBeatTapPage, { type TapPageCall } from "../hi-tension/ArigatoBeatTapPage";
import { loadSkeleton, toSongSec } from "./skeleton";
import { saveLocalCalls, type LocalCall } from "./localCalls";
import { findBuiltInSong } from "./builtInSongs";
import { ensureCanWrite } from "@/lib/anonAuth";
import HumanCheckGate from "@/components/HumanCheckGate";

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
  const [posting, setPosting] = useState<string | null>(null);
  // 人間確認を出しているあいだ、答えが返るまで待つための受け皿
  const [gate, setGate] = useState<((t: string | null) => void) | null>(null);

  const askForToken = () =>
    new Promise<string | null>((resolve) => {
      setGate(() => (t: string | null) => { setGate(null); resolve(t); });
    });

  useEffect(() => {
    let alive = true;

    // 棚に入れる前の曲（同梱データ）も採譜できるようにする。
    // ここが無いと、いま唯一中身のあるありがとビートで採譜画面が開けない。
    const builtIn = findBuiltInSong(slug);
    if (builtIn) {
      setSong({
        id: builtIn.slug,
        slug: builtIn.slug,
        title: builtIn.title,
        group_name: builtIn.groupName,
        bpm: builtIn.bpm,
      });
      setOffsets(
        builtIn.videos.map((v) => ({
          video_id: v.videoId,
          offset_sec: v.offsetSec,
          rate: 1,
          note: v.label,
        })),
      );
      setBpmHint(builtIn.bpm);
      return () => {
        alive = false;
      };
    }

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

  /**
   * 採譜したものを取り込む。
   *
   * 1) まず端末に控える（ここは必ず成功させる。書き込みが通らなくても失われないように）
   * 2) 書き込みの直前に、まだ入場していなければ人間確認を出す
   * 3) 棚へ入れる。どういう条件で置いたか（来歴）も一緒に残す
   */
  const onSave = async (calls: TapPageCall[]) => {
    const converted: LocalCall[] = calls
      .filter((c) => c.note.trim() !== "")
      .map((c) => ({
        t: Math.round(toSongSec(c.t, video.offset_sec, video.rate) * 1000) / 1000,
        lenSec: c.lenSec,
        note: c.note.trim(),
      }))
      .sort((a, b) => a.t - b.t);

    saveLocalCalls(slug, converted); // 先に手元へ。ここから先が失敗しても消えない
    if (converted.length === 0) return;

    setPosting("入場の確認中…");
    try {
      const ok = await ensureCanWrite(askForToken);
      if (!ok) { setPosting(null); return; }

      setPosting("送っています…");
      const db = getSupabase();
      // 曲の鍵は棚から引く（同梱データの仮の鍵ではなく、本物の鍵が要る）
      const { data: row, error: e1 } = await db
        .from("song_structures").select("id").eq("slug", slug).maybeSingle();
      if (e1 || !row) throw new Error("この曲はまだ棚に登録されていません");

      const { error: e2 } = await db.from("calls").insert(
        converted.map((c) => ({
          song_id: row.id,
          start_sec: c.t,
          len_sec: c.lenSec,
          kind: "single",
          text: c.note.slice(0, 100),
          status: "visible",
          // 来歴：あとで目盛りや頭出しが直ったとき、この条件で置かれた行だけ直せる
          src_video_id: video.video_id,
          src_offset_sec: video.offset_sec,
          src_bpm: bpmHint ?? null,
          src_anchor_sec: converted[0]?.t ?? null,
          placed_by_method: "ear",
        })),
      );
      if (e2) throw e2;
      setPosting(`${converted.length}件を送りました`);
      setTimeout(() => setPosting(null), 2500);
    } catch (err) {
      setPosting(`送れませんでした（${(err as Error).message}）。手元には残っています`);
      setTimeout(() => setPosting(null), 6000);
    }
  };

  return (
    <>
      {gate && <HumanCheckGate onDone={gate} />}
      {posting && <div style={S.posting}>{posting}</div>}
    <ArigatoBeatTapPage
      /*
       * 保存先の断り。いま採譜した結果はこの端末の中にしか残らない
       * （棚へ書き込むには匿名ログインが必要で、まだ有効になっていない）。
       * これを伝えないまま採譜させると、別の端末で開いたときに消えていて、
       * 作った人の労力がそのまま失われる。※文言は後から差し替える前提の仮置き
       */
      notice="取り込むと、まず手元に控えてから送ります。送れなくても手元には残ります。"
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
    </>
  );
}

const S: Record<string, React.CSSProperties> = {
  /** 送信の途中経過。動画の上には重ねない位置に出す */
  posting: {
    position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 150,
    background: "#000", color: "#fff", fontSize: 13, fontWeight: 700,
    padding: "12px 16px", textAlign: "center",
  },
};

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#000", color: "#eee", minHeight: "100dvh", padding: "24px 20px", fontFamily: "Inter, system-ui, sans-serif" }}>
      <p style={{ fontSize: 14 }}>{children}</p>
      <a href="/call-center" style={{ fontSize: 13, color: "#7cf" }}>← 曲の一覧へ</a>
    </div>
  );
}
