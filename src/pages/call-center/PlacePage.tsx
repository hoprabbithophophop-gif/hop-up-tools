import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getSupabase } from "@/lib/supabase";
import YouTubePlayer, { type YouTubePlayerApi } from "../hi-tension/components/YouTubePlayer";
import HandsCanvas, { type HandsCanvasApi } from "../hi-tension/components/HandsCanvas";
import type { HiSession } from "../hi-tension/api";
import { toVideoSec } from "./skeleton";
import { findBuiltInSong } from "./builtInSongs";
import { ensureCanWrite } from "@/lib/anonAuth";
import HumanCheckGate from "@/components/HumanCheckGate";
import { ALL_MEMBERS } from "@/data/members";
import { isLight } from "@/lib/colorUtils";

/**
 * 置く画面。
 *
 * 画面いっぱいに収める（スクロールしない）。上から順に、動画・色えらび・跳ねる面／振り返り・！ボタン。
 * 常時出るのは3つだけ（← 曲へ／▶再生・停止／！）。
 * 跳ねる面はハイ！テンションの客席（HandsCanvas）をそのまま使い、絵だけ「！の入った吹き出し」にしている。
 * 動画の上には何も重ねない。
 *
 * すでに集まっているぶん（登録済みのコール・過去の参加者の叩き）は、跳ねる面にそのまま流す。
 *
 * メンカラ（推しメンの色）はペンライトの色替えと同じ感覚で、！を叩くたびに変えてよい。
 * 選んでいる色は！ボタン自体を染めて今どの色で叩いているか分かるようにする。
 * 色えらびは丸だけ（名前ラベルは出さない）。公式ペンライトの矢印送りと同じ操作で、
 * 曲中に小さい丸を狙わなくても矢印の連打で目当ての色まで行ける。
 *
 * 叩いた結果（棚に置く1行=1曲を通しで叩いたぶん）は、
 *   ・動画が終わったとき
 *   ・叩きが1個以上ある状態で「← 曲へ」で離れようとしたとき
 * に振り返りの画面（置いたものが時刻順に並ぶ一覧）を挟んでから送る。
 * 文言はすべて仮置き（あとで差し替える前提。※【仮】マークはUIに出さない）。
 */

type Video = { video_id: string; offset_sec: number; rate: number; label: string | null };

/** 振り返り画面を何が呼び出したか。ボタンの並びが変わる */
type ReviewTrigger = "ended" | "back";

/** 1回の「！」。時刻・そのとき選んでいた色・その色が誰の色か（棚に送る用） */
type MarkEntry = { id: number; sec: number; colorHex: string; memberId: string | null };

/** 色えらびの1粒（＝チップ）。表示名は出さないので色さえ引ければよい */
type ChipMember = { name: string; color: string };

/**
 * 色えらびの読み元が棚に繋がらないとき用の代わり。src/data/members.ts の今の並び。
 * ツアー時点の名簿でも今の在籍でもないので最後の手段（画面を死なせないためだけに使う）。
 */
function fallbackChipMembers(groupName: string): ChipMember[] {
  return ALL_MEMBERS.filter((m) => m.group === groupName).map((m) => ({ name: m.name, color: m.color }));
}

/** 端末に覚えさせる「最後に選んでいた色」。並び順やお気に入りまでは作り込まない。 */
const LAST_COLOR_KEY = "call_center:last_selected_member_id";
function getLastSelectedColorId(): string | null {
  try { return localStorage.getItem(LAST_COLOR_KEY); } catch { return null; }
}
function setLastSelectedColorId(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_COLOR_KEY, id);
    else localStorage.removeItem(LAST_COLOR_KEY);
  } catch { /* ignore (プライベートモード等) */ }
}

/** 明るいグレー。値の発明はしない前提の1つ ※仮の明度 */
const NEUTRAL_HEX = "#d0d0d0";

/**
 * メンバーIDから色を引く。src/data/members.ts（/profile と同じメンバー表）が正。ID=氏名。
 * 見つからなければ（＝メンバーではない）中立のグレーを返す。白は現役メンバーカラー
 * （松本わかな・井上玲音・石井泉羽・中山夏月姫・橋田歩果）と衝突するので使わない。
 */
function resolveMemberColor(id: string): string {
  return ALL_MEMBERS.find((m) => m.name === id)?.color ?? NEUTRAL_HEX;
}

/** 選んでいる色（未選択＝null／メンバー＝氏名）から、実際に表示する色を引く */
function colorIdToHex(id: string | null): string {
  if (id === null) return NEUTRAL_HEX;
  return resolveMemberColor(id);
}
/** 選んでいる色から、棚に送る「メンバーID」を引く。未選択はメンバーではないのでnull */
function colorIdToMemberId(id: string | null): string | null {
  return id;
}

/**
 * 棚の1行を「メンバー(色)ごとの疑似セッション」に分ける。
 * 同じ行でも！を叩いたときの色がバラバラなことがあるので、色ごとに別の跳ねる粒として扱う。
 * session_hash は行ID＋メンバーIDから決定的に作る（再取得のたびに席がワープしないように）。
 */
function hashSessionKey(rowId: string, memberKey: string): number {
  // FNV-1a 32bit
  let h = 0x811c9dc5;
  const s = `${rowId}:${memberKey}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mark_secs は numeric[] なので、PostgREST の版によっては要素が文字列で来ることがある。
// Number() で必ず数へ直してから使う（calls.start_sec 等、既存コードの numeric 変換と同じ流儀）。
type TapRow = { id: string; mark_secs: (number | string)[] | null; mark_member_ids: (string | null)[] | null; created_at: string };

function tapRowsToSessions(rows: TapRow[]): HiSession[] {
  const today = new Date().toISOString().slice(0, 10);
  const out: HiSession[] = [];
  for (const row of rows) {
    const secs = (row.mark_secs ?? []).map(Number);
    const memberIds = row.mark_member_ids ?? [];
    // メンバーID（未選択は "" ＝グレー）ごとに秒をまとめる
    const byMember = new Map<string, number[]>();
    secs.forEach((sec, i) => {
      const key = memberIds[i] ?? "";
      const arr = byMember.get(key) ?? [];
      arr.push(sec);
      byMember.set(key, arr);
    });
    const playedDate = row.created_at?.slice(0, 10) || today;
    for (const [key, memberSecs] of byMember) {
      out.push({
        session_hash: hashSessionKey(row.id, key),
        member_id: key, // "" は resolveMemberColor がメンバー無しとしてグレーを返す
        is_today: playedDate === today,
        bucket_indices: memberSecs.map((t) => Math.round(t * 10)),
        bucket_indices_20: memberSecs.map((t) => Math.round(t * 20)),
        played_date: playedDate,
      });
    }
  }
  return out;
}

/** 見返すときに何秒巻き戻すか。BPMが無い曲がほとんどなのでカウントインは作らず固定秒にする ※仮 */
const REWIND_SEC = 5;

export default function PlacePage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const playerRef = useRef<YouTubePlayerApi>(null);
  const handsRef = useRef<HandsCanvasApi>(null);
  const markIdRef = useRef(0);

  const [title, setTitle] = useState("");
  const [groupName, setGroupName] = useState("");
  const [video, setVideo] = useState<Video | null>(null);
  const [sessions, setSessions] = useState<HiSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  // 叩いたもの一つひとつ。棚へ送るときはここから秒の列・メンバーIDの列を取り出す。
  const [marks, setMarks] = useState<MarkEntry[]>([]);
  // 今選んでいる色（ペンライトの色替え）。null=色なし（既定＝グレー扱い）
  const [currentColor, setCurrentColor] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState(0);

  const [reviewTrigger, setReviewTrigger] = useState<ReviewTrigger | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // 人間確認を出しているあいだ、答えが返るまで待つための受け皿（SongTapPage と同じ形）
  const [gate, setGate] = useState<((t: string | null) => void) | null>(null);

  const askForToken = () =>
    new Promise<string | null>((resolve) => {
      setGate(() => (t: string | null) => { setGate(null); resolve(t); });
    });

  // 色えらびに出すメンバー。曲に紐づくツアーの固定名簿→今の在籍→（棚に繋がらない時だけ）
  // members.ts の代用、の順で決まる。詳しくは effect 内のコメントを参照。
  const [chipMembers, setChipMembers] = useState<ChipMember[]>([]);

  // 色えらびの選択肢。グレー（色なし）・メンバー（公式の並び順）、の順で固定。
  // 白は既定色にしない（松本わかな・井上玲音・石井泉羽・中山夏月姫・橋田歩果の現役メンカラと衝突するため）
  const colorOptions = useMemo(
    () => [
      { id: null as string | null, hex: NEUTRAL_HEX },
      ...chipMembers.map((m) => ({ id: m.name as string | null, hex: m.color })),
    ],
    [chipMembers],
  );

  // 端末に覚えている色を復元。この曲の色えらびに無ければ復元しない
  // （どの丸も光っていないのに！ボタンだけ色付いている、という食い違いを避けるため）
  useEffect(() => {
    const remembered = getLastSelectedColorId();
    if (remembered && chipMembers.some((m) => m.name === remembered)) {
      setCurrentColor(remembered);
    }
  }, [chipMembers]);

  useEffect(() => {
    let alive = true;
    setError(null);

    // 棚に入っていない曲は同梱データで開く
    const builtIn = findBuiltInSong(slug);
    const openBuiltIn = () => {
      if (!builtIn) return false;
      setTitle(builtIn.title);
      setGroupName(builtIn.groupName);
      // 同梱データには曲もツアーも紐付いていない＝棚に繋がらない時と同じ代用でよい
      setChipMembers(fallbackChipMembers(builtIn.groupName));
      const v = builtIn.videos[0];
      if (v) setVideo({ video_id: v.videoId, offset_sec: v.offsetSec, rate: 1, label: v.label });
      return true;
    };

    try {
      getSupabase()
        .from("song_structures")
        .select("id, title, group_name, tour_key, song_video_offsets(video_id, offset_sec, rate, label)")
        .eq("slug", slug)
        .maybeSingle()
        .then(({ data }) => {
          if (!alive) return;
          if (!data) { if (!openBuiltIn()) setError("この曲は見つかりませんでした"); return; }
          const d = data as unknown as { id: string; title: string; group_name: string; tour_key: string | null; song_video_offsets: Video[] };
          setTitle(d.title);
          setGroupName(d.group_name);
          const v = d.song_video_offsets?.[0];
          if (!v) { setError("この曲にはまだ動画が結び付いていません"); return; }
          setVideo({ video_id: v.video_id, offset_sec: Number(v.offset_sec), rate: Number(v.rate) || 1, label: v.label });

          /**
           * 色えらびに出すメンバー。3段のフォールバック:
           * 1) 曲にツアーの紐付きがあれば tour_rosters（ツアー時点の固定名簿）
           * 2) 無ければ hello_members の今の在籍（並び順の欄が無いので、members.ts と
           *    同じ並びの名前はその順、無い名前は名前順で末尾に置く）
           * 3) どちらも読めなければ（棚に繋がらない等）members.ts の代用（画面を死なせない）
           */
          if (d.tour_key) {
            getSupabase()
              .from("tour_rosters")
              .select("name, color, display_order")
              .eq("tour_key", d.tour_key)
              .order("display_order", { ascending: true })
              .then(({ data: rosterRows }) => {
                if (!alive) return;
                if (!rosterRows || rosterRows.length === 0) { setChipMembers(fallbackChipMembers(d.group_name)); return; }
                setChipMembers((rosterRows as { name: string; color: string }[]).map((r) => ({ name: r.name, color: r.color })));
              }, () => { if (alive) setChipMembers(fallbackChipMembers(d.group_name)); });
          } else {
            getSupabase()
              .from("hello_members")
              .select("name, color")
              .eq("group_name", d.group_name)
              .eq("active", true)
              .not("color", "is", null)
              .then(({ data: activeRows }) => {
                if (!alive) return;
                if (!activeRows) { setChipMembers(fallbackChipMembers(d.group_name)); return; }
                const rows = (activeRows as { name: string; color: string | null }[])
                  .filter((r): r is { name: string; color: string } => !!r.color);
                if (rows.length === 0) { setChipMembers(fallbackChipMembers(d.group_name)); return; }
                // members.ts に同じ名前があればその並び順、無い名前は名前順で末尾に置く
                const order = new Map(ALL_MEMBERS.filter((m) => m.group === d.group_name).map((m, i) => [m.name, i]));
                rows.sort((a, b) => {
                  const ai = order.get(a.name) ?? Number.MAX_SAFE_INTEGER;
                  const bi = order.get(b.name) ?? Number.MAX_SAFE_INTEGER;
                  if (ai !== bi) return ai - bi;
                  return a.name.localeCompare(b.name, "ja");
                });
                setChipMembers(rows);
              }, () => { if (alive) setChipMembers(fallbackChipMembers(d.group_name)); });
          }

          // すでに登録されているコールを、跳ねる面に流すぶんとして読む
          getSupabase()
            .rpc("get_song_calls", { p_song_id: d.id })
            .then(({ data: rows }) => {
              if (!alive || !rows) return;
              const secs = (rows as { start_sec: number | null }[])
                .filter((r) => r.start_sec !== null)
                .map((r) => toVideoSec(Number(r.start_sec), Number(v.offset_sec), Number(v.rate) || 1));
              if (secs.length === 0) return;
              setSessions((prev) => [...prev, {
                session_hash: 424242,
                member_id: "", // 誰の色でもない＝グレー（resolveMemberColorが見つけられないIDにしている）
                is_today: true,
                bucket_indices: secs.map((t) => Math.round(t * 10)),
                bucket_indices_20: secs.map((t) => Math.round(t * 20)),
                played_date: new Date().toISOString().slice(0, 10),
              }]);
            }, () => { /* 読めなくても置く画面は成り立つ */ });

          // 過去の参加者が叩いたぶんも、同じ動画のものだけ跳ねる面に流す
          // （動画が違うと秒の物差しも違うので混ぜない＝ハイ！テンションの「動画ごとに客席を分ける」流儀と同じ）。
          // 件数はキリなく増えるので直近200行に絞る（過去のディスク負荷事故の再発防止）。
          // 棚（テーブル）がまだ無くても置く画面は成り立つよう、失敗しても黙って諦める。
          getSupabase()
            .from("call_tap_sessions")
            .select("id, mark_secs, mark_member_ids, created_at")
            .eq("song_id", d.id)
            .eq("video_id", v.video_id)
            .order("created_at", { ascending: false })
            .limit(200)
            .then(({ data: tapRows }) => {
              if (!alive || !tapRows) return;
              const crowd = tapRowsToSessions(tapRows as TapRow[]);
              if (crowd.length === 0) return;
              setSessions((prev) => [...prev, ...crowd]);
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

  /** 動画が最後まで再生された。叩きが1個以上あれば振り返りを出す */
  const onEnded = () => {
    setPlaying(false);
    if (marks.length > 0) setReviewTrigger("ended");
  };

  /** 色えらびの丸を直接押す */
  const pickColor = (id: string | null) => {
    setCurrentColor(id);
    setLastSelectedColorId(id);
  };

  /** 矢印での色送り（公式ペンライトの色替えと同じ操作）。delta=-1で前、+1で次 */
  const moveColor = (delta: number) => {
    const idx = colorOptions.findIndex((o) => o.id === currentColor);
    const base = idx === -1 ? 0 : idx;
    const next = (base + delta + colorOptions.length) % colorOptions.length;
    pickColor(colorOptions[next].id);
  };

  /** 押した瞬間（onPointerDown）に出す。指を離すのを待つとその分そのまま遅れて感じる。 */
  const pressMark = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const colorHex = colorIdToHex(currentColor);
    handsRef.current?.spawnSelf(colorHex);
    const sec = Math.round((playerRef.current?.getCurrentTime() ?? 0) * 1000) / 1000;
    const id = ++markIdRef.current;
    setMarks((arr) => [...arr, { id, sec, colorHex, memberId: colorIdToMemberId(currentColor) }]);
  };

  /** 「← 曲へ」。叩きが残っていれば振り返りを挟む。ゼロならそのまま戻る */
  const handleBack = () => {
    if (marks.length > 0) { setReviewTrigger("back"); return; }
    navigate(`/call-center/song/${slug}`);
  };

  /**
   * 振り返り画面の「見返す」。その時刻の少し前から再生する（一覧は出したまま）。
   * play() は「動画が終わった直後（ENDED状態）」だと内部で先頭(0秒)へ戻す仕様なので、
   * 先に play() を呼んでから seekTo で狙った位置へ上書きする（逆順だと 0秒に戻されて消える）。
   */
  const seekPreview = (sec: number) => {
    playerRef.current?.play();
    playerRef.current?.seekTo(Math.max(0, sec - REWIND_SEC));
    setPlaying(true);
  };

  /** 振り返り画面の「×」。棚にはまだ送っていないので、画面の中の並びから外すだけでよい */
  const removeMark = (id: number) => {
    setMarks((arr) => arr.filter((m) => m.id !== id));
  };

  /**
   * 叩いたぶんを棚へ送る。
   * 1) まだ入場していなければ人間確認を出す
   * 2) 曲の鍵（song_structures.id）を棚から引く（同梱データの仮の鍵ではなく本物の鍵が要る）
   * 3) 送る本人（匿名ログインのID）を添えて1行として入れる（秒の並びと、メンバーIDの並びの2列）
   *
   * 棚（テーブル）がまだ適用されていなくても画面が壊れないよう、失敗したらその場に留まる。
   */
  const doSend = async (): Promise<boolean> => {
    if (!video || marks.length === 0) return false;
    setSendError(null);
    setSending(true);
    try {
      const ok = await ensureCanWrite(askForToken);
      if (!ok) throw new Error("入場の確認をやめました");

      const db = getSupabase();
      const { data: row, error: e1 } = await db
        .from("song_structures").select("id").eq("slug", slug).maybeSingle();
      if (e1 || !row) throw new Error("この曲はまだ棚に登録されていません");

      const { data: userData, error: e2 } = await db.auth.getUser();
      if (e2 || !userData.user) throw new Error("入場情報を取得できませんでした");

      const { error: e3 } = await db.from("call_tap_sessions").insert({
        song_id: row.id,
        video_id: video.video_id,
        mark_secs: marks.map((m) => m.sec),
        mark_member_ids: marks.map((m) => m.memberId),
        created_by: userData.user.id,
      });
      if (e3) throw e3;

      // 送れた＝この参加は1行として棚に乗った。次の通しはゼロから数え直す
      setMarks([]);
      setSending(false);
      return true;
    } catch {
      setSending(false);
      setSendError("送れませんでした。時間をおいてもう一度");
      setTimeout(() => setSendError(null), 6000);
      return false;
    }
  };

  const onReviewSend = async () => {
    const ok = await doSend();
    if (!ok) return; // 失敗。振り返り画面は開いたまま、その場に留まる
    setReviewTrigger(null);
    if (reviewTrigger === "back") navigate(`/call-center/song/${slug}`);
  };

  /** 「まだ叩く」：振り返り画面を閉じるだけ、その場に留まって続きを叩ける */
  const onReviewKeepTapping = () => setReviewTrigger(null);

  /** 「送らずに戻る」（back起点のみ）：送らずに離脱する */
  const onReviewLeaveWithoutSending = () => {
    setReviewTrigger(null);
    navigate(`/call-center/song/${slug}`);
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

  const currentColorHex = colorIdToHex(currentColor);
  const markBg = currentColorHex;
  const markFg = isLight(currentColorHex) ? "#000" : "#fff";
  // 時刻順に並べて見せる（叩いた順とは限らない＝巻き戻して見返した後にまた叩く、があるため）
  const sortedMarks = [...marks].sort((a, b) => a.sec - b.sec);

  return (
    <div style={S.page}>
      {gate && <HumanCheckGate onDone={gate} />}
      {sendError && <div style={S.errorBanner}>{sendError}</div>}

      <div style={S.head}>
        <button style={S.back} onClick={handleBack}>← 曲へ</button>
        <span style={S.title}>{title}</span>
        <span style={S.count}>！ {marks.length}</span>
      </div>

      <div style={S.videoBox}>
        {video && (
          <YouTubePlayer
            ref={playerRef}
            videoId={video.video_id}
            onEnded={onEnded}
            onTimeUpdate={onTime}
          />
        )}
      </div>

      <div style={S.row}>
        <button type="button" style={S.play} onClick={togglePlay}>{playing ? "⏸ 停止" : "▶ 再生"}</button>
        <span style={S.clock}>{fmt(nowSec)}</span>
      </div>

      {reviewTrigger ? (
        /* 振り返り画面。動画は上に出たままなので「見返す」で流しながら一覧を読める */
        <div style={S.reviewWrap}>
          <div style={S.reviewHeading}>！ {marks.length}個</div>
          <div style={S.reviewList}>
            {sortedMarks.map((m) => (
              <div key={m.id} style={S.reviewRow}>
                <span style={S.reviewTime}>{fmt(m.sec)}</span>
                <span style={{ ...S.reviewDot, background: m.colorHex }} />
                <button type="button" style={S.reviewLink} onClick={() => seekPreview(m.sec)}>見返す</button>
                <button type="button" style={S.reviewRemove} onClick={() => removeMark(m.id)} aria-label="この！を消す">×</button>
              </div>
            ))}
          </div>
          <div style={S.reviewFooter}>
            <p style={S.reviewLede}>ちょっとタイミングずれたかも、とかはライブ感ということでいいじゃない。</p>
            <div style={S.reviewActions}>
              <button style={S.modalPrimary} onClick={onReviewSend} disabled={sending || marks.length === 0}>
                {sending ? "送っています…" : "これで送る"}
              </button>
              {reviewTrigger === "back" && (
                <button style={S.modalSecondary} onClick={onReviewLeaveWithoutSending} disabled={sending}>送らずに戻る</button>
              )}
              <button style={S.modalSecondary} onClick={onReviewKeepTapping} disabled={sending}>まだ叩く</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* 跳ねる面。残りの高さを全部使う。動画の上には重ねない */}
          <div style={S.stage}>
            <HandsCanvas
              ref={handsRef}
              icon="mark"
              sessions={sessions}
              selfMemberId="nishida"
              selfSeatHash={7}
              resolveColor={resolveMemberColor}
              scaleCount={300}
              topMargin={150}
              freezeAge
            />
          </div>

          {/* 色えらび（丸だけ・名前は出さない）。公式ペンライトと同じく矢印でも送れる */}
          <div style={S.colorPickerRow}>
            <button type="button" style={S.arrowBtn} onClick={() => moveColor(-1)} aria-label="前の色">◀</button>
            <div style={S.dotsRow}>
              {colorOptions.map((opt) => {
                const selected = opt.id === currentColor;
                return (
                  <button
                    key={opt.id ?? "neutral"}
                    type="button"
                    onClick={() => pickColor(opt.id)}
                    aria-label={opt.id === null ? "色なし" : opt.id}
                    style={{
                      ...S.dot,
                      background: opt.hex,
                      transform: selected ? "scale(1.35)" : "scale(1)",
                      boxShadow: selected
                        ? "0 0 0 2px #fff, inset 0 0 0 1px rgba(0,0,0,0.35)"
                        : "inset 0 0 0 1px rgba(0,0,0,0.35)",
                      zIndex: selected ? 1 : 0,
                    }}
                  />
                );
              })}
            </div>
            <button type="button" style={S.arrowBtn} onClick={() => moveColor(1)} aria-label="次の色">▶</button>
          </div>

          <div style={S.btnRow}>
            <button
              type="button"
              style={{ ...S.mark, background: markBg, color: markFg }}
              onPointerDown={pressMark}
              onContextMenu={(e) => e.preventDefault()}
            >！</button>
          </div>
        </>
      )}
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
  stage: { position: "relative", flex: "1 1 auto", minHeight: 0, background: "#0a0a0c", overflow: "hidden" },
  colorPickerRow: { display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto", padding: "8px 0 0" },
  arrowBtn: { flex: "0 0 auto", width: 26, height: 26, background: "#1a1a1a", color: "#eee", border: 0, boxShadow: "inset 0 0 0 1px #444", fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: 0 },
  dotsRow: { flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 3, padding: "0 6px" },
  dot: { flex: "0 1 22px", aspectRatio: "1", minWidth: 12, maxWidth: 22, borderRadius: "50%", border: 0, cursor: "pointer", padding: 0 },
  btnRow: { display: "flex", gap: 8, flex: "0 0 auto", marginTop: 8 },
  mark: { flex: 1, background: "#d0d0d0", color: "#000", border: 0, padding: "22px 10px", fontSize: 30, fontWeight: 900, lineHeight: 1, cursor: "pointer", fontFamily: "inherit" },
  reviewWrap: { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", marginTop: 8 },
  reviewHeading: { fontSize: 13, fontWeight: 800, color: "#eee", flex: "0 0 auto", marginBottom: 4 },
  reviewList: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 },
  reviewRow: { display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", boxShadow: "inset 0 -1px 0 #222" },
  reviewTime: { fontSize: 13, fontFamily: "ui-monospace,Menlo,Consolas,monospace", color: "#eee", width: 62, flex: "0 0 auto" },
  reviewDot: { width: 16, height: 16, borderRadius: "50%", flex: "0 0 auto", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.3)" },
  reviewLink: { flex: "1 1 auto", textAlign: "left", background: "none", border: 0, color: "#7cf", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: "4px 0" },
  reviewRemove: { flex: "0 0 auto", width: 30, height: 30, background: "none", color: "#9aa0a6", border: 0, boxShadow: "inset 0 0 0 1px #444", fontSize: 16, cursor: "pointer", fontFamily: "inherit" },
  reviewFooter: { flex: "0 0 auto", paddingTop: 10 },
  reviewLede: { fontSize: 12, lineHeight: 1.7, color: "#9aa0a6", margin: "0 0 10px" },
  reviewActions: { display: "flex", flexDirection: "column", gap: 8 },
  modalPrimary: { background: "#fff", color: "#000", border: 0, padding: "12px 14px", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" },
  modalSecondary: { background: "none", color: "#9aa0a6", border: 0, boxShadow: "inset 0 0 0 1px #444", padding: "12px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  errorBanner: {
    position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 150,
    background: "#000", color: "#fff", fontSize: 13, fontWeight: 700,
    padding: "12px 16px", textAlign: "center", boxShadow: "inset 0 1px 0 #333",
  },
};
