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
 * 画面いっぱいに収める（スクロールしない）。上から順に、動画・跳ねる面・色チップ・！ボタン。
 * 常時出るのは3つだけ（← 曲へ／▶再生・停止／！）。
 * 跳ねる面はハイ！テンションの客席（HandsCanvas）をそのまま使い、絵だけ「！の入った吹き出し」にしている。
 * 動画の上には何も重ねない。
 *
 * すでに集まっているぶん（登録済みのコール・過去の参加者の叩き）は、跳ねる面にそのまま流す。
 *
 * メンカラ（推しメンの色）はペンライトの色替えと同じ感覚で、！を叩くたびに変えてよい。
 * 選んでいる色は！ボタン自体を染めて今どの色で叩いているか分かるようにする。
 *
 * 叩いた結果（棚に置く1行=1曲を通しで叩いたぶん）は、
 *   ・動画が終わったとき
 *   ・叩きが1個以上ある状態で「← 曲へ」で離れようとしたとき
 * に確認を挟んでから送る。文言はすべて仮置き（あとで差し替える前提。※【仮】マークはUIに出さない）。
 */

type Video = { video_id: string; offset_sec: number; rate: number; label: string | null };

/** 確認モーダルを何が呼び出したか。ボタンの並びが変わる */
type ConfirmTrigger = "ended" | "back";

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

/** メンバーIDから色を引く。src/data/members.ts（/profile と同じメンバー表）が正。ID=氏名。 */
function resolveMemberColor(id: string): string | undefined {
  return ALL_MEMBERS.find((m) => m.name === id)?.color;
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
    // メンバーID（未選択は "" ＝白）ごとに秒をまとめる
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
        member_id: key, // "" は resolveMemberColor が undefined を返し、白になる
        is_today: playedDate === today,
        bucket_indices: memberSecs.map((t) => Math.round(t * 10)),
        bucket_indices_20: memberSecs.map((t) => Math.round(t * 20)),
        played_date: playedDate,
      });
    }
  }
  return out;
}

export default function PlacePage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const playerRef = useRef<YouTubePlayerApi>(null);
  const handsRef = useRef<HandsCanvasApi>(null);

  const [title, setTitle] = useState("");
  const [groupName, setGroupName] = useState("");
  const [video, setVideo] = useState<Video | null>(null);
  const [sessions, setSessions] = useState<HiSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  // 「！」を叩いた、その動画の中での秒の並び。棚へ送るときはこの配列をそのまま渡す。
  const [markSecs, setMarkSecs] = useState<number[]>([]);
  // markSecs と同じ長さ。i番目の！を叩いた瞬間に選んでいたメンバー（未選択は null）
  const [markMemberIds, setMarkMemberIds] = useState<(string | null)[]>([]);
  // 今選んでいる色（ペンライトの色替え）。null=無色（白）
  const [currentColor, setCurrentColor] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState(0);

  const [confirmTrigger, setConfirmTrigger] = useState<ConfirmTrigger | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // 人間確認を出しているあいだ、答えが返るまで待つための受け皿（SongTapPage と同じ形）
  const [gate, setGate] = useState<((t: string | null) => void) | null>(null);

  const askForToken = () =>
    new Promise<string | null>((resolve) => {
      setGate(() => (t: string | null) => { setGate(null); resolve(t); });
    });

  // この曲のグループのメンバーだけをチップに出す
  const chipMembers = useMemo(
    () => ALL_MEMBERS.filter((m) => m.group === groupName),
    [groupName],
  );

  // 端末に覚えている色を復元。ただしこの曲のチップに無い色（グループが違う等）は復元しない
  // ＝どのチップも光っていないのに！ボタンだけ色付いている、という食い違いを避けるため
  useEffect(() => {
    if (!groupName || chipMembers.length === 0) return;
    const remembered = getLastSelectedColorId();
    if (remembered && chipMembers.some((m) => m.name === remembered)) {
      setCurrentColor(remembered);
    }
  }, [groupName, chipMembers]);

  useEffect(() => {
    let alive = true;
    setError(null);

    // 棚に入っていない曲は同梱データで開く
    const builtIn = findBuiltInSong(slug);
    const openBuiltIn = () => {
      if (!builtIn) return false;
      setTitle(builtIn.title);
      setGroupName(builtIn.groupName);
      const v = builtIn.videos[0];
      if (v) setVideo({ video_id: v.videoId, offset_sec: v.offsetSec, rate: 1, label: v.label });
      return true;
    };

    try {
      getSupabase()
        .from("song_structures")
        .select("id, title, group_name, song_video_offsets(video_id, offset_sec, rate, label)")
        .eq("slug", slug)
        .maybeSingle()
        .then(({ data }) => {
          if (!alive) return;
          if (!data) { if (!openBuiltIn()) setError("この曲は見つかりませんでした"); return; }
          const d = data as unknown as { id: string; title: string; group_name: string; song_video_offsets: Video[] };
          setTitle(d.title);
          setGroupName(d.group_name);
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
              setSessions((prev) => [...prev, {
                session_hash: 424242,
                member_id: "", // 誰の色でもない＝白（resolveMemberColorが見つけられないIDにしている）
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

  /** 動画が最後まで再生された。叩きが1個以上あれば送るか確認する */
  const onEnded = () => {
    setPlaying(false);
    if (markSecs.length > 0) setConfirmTrigger("ended");
  };

  /** 色チップを押す。もう一度同じ色を押したら解除（無色＝白に戻る） */
  const pickColor = (name: string) => {
    const next = currentColor === name ? null : name;
    setCurrentColor(next);
    setLastSelectedColorId(next);
  };

  /** 押した瞬間（onPointerDown）に出す。指を離すのを待つとその分そのまま遅れて感じる。 */
  const pressMark = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const color = currentColor ? resolveMemberColor(currentColor) ?? "#ffffff" : "#ffffff";
    handsRef.current?.spawnSelf(color);
    const t = Math.round((playerRef.current?.getCurrentTime() ?? 0) * 1000) / 1000;
    setMarkSecs((arr) => [...arr, t]);
    setMarkMemberIds((arr) => [...arr, currentColor]);
  };

  /** 「← 曲へ」。叩きが残っていれば確認を挟む。ゼロならそのまま戻る */
  const handleBack = () => {
    if (markSecs.length > 0) { setConfirmTrigger("back"); return; }
    navigate(`/call-center/song/${slug}`);
  };

  /**
   * 叩いたぶんを棚へ送る。
   * 1) まだ入場していなければ人間確認を出す
   * 2) 曲の鍵（song_structures.id）を棚から引く（同梱データの仮の鍵ではなく本物の鍵が要る）
   * 3) 送る本人（匿名ログインのID）を添えて1行として入れる（秒の並びと、色の並びの2列）
   *
   * 棚（テーブル）がまだ適用されていなくても画面が壊れないよう、失敗したらその場に留まる。
   */
  const doSend = async (): Promise<boolean> => {
    if (!video) return false;
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
        mark_secs: markSecs,
        mark_member_ids: markMemberIds,
        created_by: userData.user.id,
      });
      if (e3) throw e3;

      // 送れた＝この参加は1行として棚に乗った。次の通しはゼロから数え直す
      setMarkSecs([]);
      setMarkMemberIds([]);
      setSending(false);
      return true;
    } catch {
      setSending(false);
      setSendError("送れませんでした。時間をおいてもう一度");
      setTimeout(() => setSendError(null), 6000);
      return false;
    }
  };

  const onConfirmSend = async () => {
    const ok = await doSend();
    if (!ok) return; // 失敗。モーダルは開いたまま、その場に留まる
    setConfirmTrigger(null);
    if (confirmTrigger === "back") navigate(`/call-center/song/${slug}`);
  };

  /** 「送らない」（onEnded起点）／「やめる」（back起点）：閉じるだけ、その場に留まる */
  const onConfirmStay = () => setConfirmTrigger(null);

  /** 「送らずに戻る」（back起点のみ）：送らずに離脱する */
  const onConfirmLeaveWithoutSending = () => {
    setConfirmTrigger(null);
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

  const currentColorHex = currentColor ? resolveMemberColor(currentColor) : undefined;
  const markBg = currentColorHex ?? "#fff";
  const markFg = currentColorHex ? (isLight(currentColorHex) ? "#000" : "#fff") : "#000";

  return (
    <div style={S.page}>
      {gate && <HumanCheckGate onDone={gate} />}
      {confirmTrigger && (
        <div style={S.modalBack}>
          <div style={S.modalCard}>
            <div style={S.modalTitle}>！ {markSecs.length}個 を送る？</div>
            <p style={S.modalLede}>ちょっとタイミングずれたかも、とかはライブ感ということでいいじゃない。</p>
            <div style={S.modalRow}>
              <button style={S.modalPrimary} onClick={onConfirmSend} disabled={sending}>
                {sending ? "送っています…" : "送る"}
              </button>
              {confirmTrigger === "back" && (
                <button style={S.modalSecondary} onClick={onConfirmLeaveWithoutSending} disabled={sending}>送らずに戻る</button>
              )}
              <button style={S.modalSecondary} onClick={onConfirmStay} disabled={sending}>
                {confirmTrigger === "back" ? "やめる" : "送らない"}
              </button>
            </div>
          </div>
        </div>
      )}
      {sendError && <div style={S.errorBanner}>{sendError}</div>}

      <div style={S.head}>
        <button style={S.back} onClick={handleBack}>← 曲へ</button>
        <span style={S.title}>{title}</span>
        <span style={S.count}>！ {markSecs.length}</span>
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

      {/* メンカラのチップ（ペンライトの色替え）。このグループにメンバー表が無ければ出さない */}
      {chipMembers.length > 0 && (
        <div style={S.chipRow}>
          {chipMembers.map((m) => (
            <button
              key={m.name}
              type="button"
              onClick={() => pickColor(m.name)}
              style={{
                ...S.chip,
                background: m.color,
                boxShadow: currentColor === m.name
                  ? "0 0 0 2px #fff, inset 0 0 0 1px rgba(0,0,0,0.4)"
                  : "inset 0 0 0 1px rgba(0,0,0,0.4)",
              }}
              title={m.name}
            >
              <span style={{ ...S.chipLabel, color: isLight(m.color) ? "#000" : "#fff" }}>{m.name}</span>
            </button>
          ))}
        </div>
      )}

      <div style={S.btnRow}>
        <button
          type="button"
          style={{ ...S.mark, background: markBg, color: markFg }}
          onPointerDown={pressMark}
          onContextMenu={(e) => e.preventDefault()}
        >！</button>
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
  stage: { position: "relative", flex: "1 1 auto", minHeight: 0, background: "#0a0a0c", overflow: "hidden" },
  chipRow: { display: "flex", gap: 8, overflowX: "auto", flex: "0 0 auto", padding: "8px 2px 0" },
  chip: {
    flex: "0 0 auto", width: 50, height: 50, borderRadius: "50%", border: 0, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 2,
  },
  chipLabel: { fontSize: 9, fontWeight: 700, lineHeight: 1.1, textAlign: "center", overflow: "hidden", maxWidth: 44 },
  btnRow: { display: "flex", gap: 8, flex: "0 0 auto", marginTop: 8 },
  mark: { flex: 1, background: "#fff", color: "#000", border: 0, padding: "22px 10px", fontSize: 30, fontWeight: 900, lineHeight: 1, cursor: "pointer", fontFamily: "inherit" },
  modalBack: {
    position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.7)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
  },
  modalCard: { background: "#111", boxShadow: "inset 0 0 0 1px #333", padding: "22px 20px", maxWidth: 380, width: "100%" },
  modalTitle: { fontSize: 16, fontWeight: 900, marginBottom: 10, color: "#fff" },
  modalLede: { fontSize: 12.5, lineHeight: 1.8, color: "#9aa0a6", margin: "0 0 18px" },
  modalRow: { display: "flex", flexDirection: "column", gap: 8 },
  modalPrimary: { background: "#fff", color: "#000", border: 0, padding: "12px 14px", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" },
  modalSecondary: { background: "none", color: "#9aa0a6", border: 0, boxShadow: "inset 0 0 0 1px #444", padding: "12px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  errorBanner: {
    position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 150,
    background: "#000", color: "#fff", fontSize: 13, fontWeight: 700,
    padding: "12px 16px", textAlign: "center", boxShadow: "inset 0 1px 0 #333",
  },
};
