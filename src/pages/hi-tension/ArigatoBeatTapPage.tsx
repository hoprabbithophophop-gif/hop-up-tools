// コール採譜ツール（開発用・非公開）
//
// 目的: ステージ動画を見ながらタップして「その瞬間の動画秒数」を記録し、
//       タップ間隔から大体のBPMを推定したり、各タップにコール文をメモして、
//       コールデータ(JSON)として書き出すための作業用画面。
//       公開ツールではない。隠しルート (/arigato-beat/beat)。
//
// 曲を外から渡すこともできる（コール情報集約センターから呼ぶ）。何も渡さなければ
// 従来どおり＝ありがとビート専用の開発用ツールとして、これまでと同じに動く。
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import YouTubePlayer, { type YouTubePlayerApi } from "./components/YouTubePlayer";
import { splitMora } from "../call-center/callBubbles";

const PINK = "#da1884";
// 既定はありがとビート Stage Practice ver.（BEYOOOOONDS公式）。他のidに差し替え可。
const DEFAULT_VIDEO = "n5AVvFwbeaM"; // ありがとビート ステージプラクティス（コール答えが映像に出ない＝自己チェック練習用）
const LS_KEY = "hi_tension:beat_tap";

/** 外から採譜させたい曲。集約センターが渡す。 */
export type TapPageSong = {
  /** 曲ID。端末への保存を曲ごとに分けるのに使う */
  slug: string;
  title: string;
  groupName: string;
  /** 採譜する動画 */
  videoId: string;
  /** 分かっていれば初期BPM。無ければ叩いた間隔から見当を付ける */
  bpm?: number;
  /** 戻る先のURL */
  backTo?: string;
};

/** 書き出す1件ぶんのコール。groupIdが同じ行どうしは「ひと続きの1つの掛け声」。 */
export type TapPageCall = { t: number; lenSec: number; lenBeats: number; note: string; groupId?: string };

type Props = {
  song?: TapPageSong;
  /**
   * すでに登録されているコール。採譜画面をゼロから始めさせないため。
   * 端末に下書きが残っていればそちらを優先する（作業中のものを消さない）。
   */
  existing?: TapPageCall[];
  /** 「取り込む」ボタンを出したいときだけ渡す。渡さなければ書き出しボタンだけ */
  onSave?: (calls: TapPageCall[]) => void | Promise<void>;
  /** 保存先などの断り書き。渡されたときだけ、画面の上のほうに出す */
  notice?: string;
};
// コールの長さ(拍)の選択肢。0.5刻み・最大8。
const LEN_OPTIONS = Array.from({ length: 16 }, (_, i) => (i + 1) * 0.5); // 0.5..8

/**
 * 「ここ何て言ってるのか分からない」の印。
 * タイミングは合っているので、言葉が分からなくても位置は情報として残す。
 * 取り込みでも送る（コールの入れどころを心得ている人が見たときに
 * 「あ、ここも何か言ってたな」と思い出すきっかけになるため）。
 */
export const CALL_HOLD_MARK = "？";
export const isHold = (s: string) => { const t = s.trim(); return t === "？" || t === "?"; };

// t=動画の絶対秒(無音込み・生タップ)。note=コール文。lenBeats=コールの長さ(拍・小数可)。
// id=並べ替え/削除でも選択が追従するための安定キー。
// groupId=収録モードで一気に叩いた「1つの掛け声」の中の音どうしを結ぶ印。無ければ単発の掛け声。
type Tap = { id: string; t: number; note: string; lenBeats: number; groupId?: string };
let _idc = 0;
const rid = () => {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* ignore */ }
  return `t${Date.now()}_${++_idc}`;
};
type Saved = { videoId: string; taps: Tap[]; bpm: number; anchorSec: number | null; view: "list" | "timeline" };

function loadSaved(lsKey: string, defVideo: string, defBpm: number): Saved {
  const base: Saved = { videoId: defVideo, taps: [], bpm: defBpm, anchorSec: null, view: "list" };
  try {
    const raw = localStorage.getItem(lsKey);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.taps)) {
        return {
          videoId: typeof o.videoId === "string" ? o.videoId : defVideo,
          taps: o.taps.map((x: { id?: string; t: number; note?: string; lenBeats?: number; groupId?: string }) => ({ id: x.id ?? rid(), t: x.t, note: x.note ?? "", lenBeats: typeof x.lenBeats === "number" ? x.lenBeats : 1, groupId: x.groupId })),
          bpm: typeof o.bpm === "number" ? o.bpm : defBpm,
          anchorSec: typeof o.anchorSec === "number" ? o.anchorSec : null,
          view: o.view === "timeline" ? "timeline" : "list",
        };
      }
    }
  } catch { /* 壊れていたら空で始める */ }
  return base;
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${m}:${sec}`;
};

/** 配列の中央値 */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// 長さ(拍)のスロット式ピッカー。縦スワイプで回して中央の値にスナップ＝1ジェスチャで選べる。
function LenPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const ITEM = 34;
  const lockRef = useRef(false);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const idx = LEN_OPTIONS.indexOf(value);
    if (idx >= 0 && Math.abs(el.scrollTop - idx * ITEM) > 2) {
      lockRef.current = true;
      el.scrollTop = idx * ITEM;
      if (tRef.current) clearTimeout(tRef.current);
      tRef.current = setTimeout(() => { lockRef.current = false; }, 60);
    }
  }, [value]);
  const onScroll = () => {
    if (lockRef.current) return;
    const el = ref.current; if (!el) return;
    const idx = Math.max(0, Math.min(LEN_OPTIONS.length - 1, Math.round(el.scrollTop / ITEM)));
    const v = LEN_OPTIONS[idx];
    if (v !== value) onChange(v);
  };
  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className="lenwheel"
      title="スワイプで長さを回して選ぶ"
      style={{ width: 46, height: ITEM, flexShrink: 0, overflowY: "auto", scrollSnapType: "y mandatory", borderRadius: 8, border: "1px solid #3a3a3a", background: "#111", scrollbarWidth: "none" }}
    >
      {LEN_OPTIONS.map(v => (
        <div key={v} style={{ height: ITEM, display: "flex", alignItems: "center", justifyContent: "center", scrollSnapAlign: "start", fontSize: 15, fontWeight: v === value ? 800 : 400, color: v === value ? "#fff" : "#666" }}>{v}</div>
      ))}
    </div>
  );
}

// タイムライン編集ビュー：再生中プレイヘッド中央固定。コールは「拍数＝横幅・全文を縦に折返し」
// のバーで並ぶ。既定（編集OFF）は横ドラッグ＝動画スクラブ（時間が動く）。編集ON時のみバーを
// ドラッグして拍グリッドにスナップ移動できる（不用意に触ってリズムがズレる事故を防ぐ）。
const SPAN_SEC = 6;       // 可視秒数
const LANE_PITCH = 80;    // レーン間隔（折返しで縦に伸びるバーぶん広め）
function TimelineView({ taps, snapGrid, beatSec, unit, refSec, playing, nowSec, getNow, onSeek, onScrub, onMove, curId, pink }: {
  taps: Tap[]; snapGrid: (t: number) => number;
  beatSec: number; unit: number; refSec: number | null;
  playing: boolean; nowSec: number; getNow: () => number;
  onSeek: (t: number) => void; onScrub: (t: number) => void; onMove: (id: string, t: number) => void;
  curId: string | null; pink: string;
}) {
  const vpRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const editRef = useRef(editMode); editRef.current = editMode;
  const dragRef = useRef<{ id: string; startX: number; origT: number } | null>(null);
  // 横スクラブ（編集OFF時）：指で時間軸を掴んで動かす。holdT＝rAFが追う固定時刻。
  const scrubRef = useRef<{ startX: number; startT: number; moved: boolean; holdT: number } | null>(null);
  const playingRef = useRef(playing); playingRef.current = playing;
  const nowRef = useRef(nowSec); nowRef.current = nowSec;

  useEffect(() => {
    const el = vpRef.current; if (!el) return;
    const set = () => { setVw(el.clientWidth); setVh(el.clientHeight); };
    set();
    const ro = new ResizeObserver(set); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pxPerSec = vw > 0 ? vw / SPAN_SEC : 60;

  // レーン割当（時刻順・貪欲first-fit。バーが重なる時だけ次レーンへ）。
  const { laneOf, laneCount, trackSec } = useMemo(() => {
    const sorted = [...taps].sort((a, b) => a.t - b.t);
    const ends: number[] = [];
    const lo = new Map<string, number>();
    let maxEnd = 10;
    for (const tp of sorted) {
      const s = tp.t;
      const e = s + Math.max(tp.lenBeats * beatSec, 0.18);
      maxEnd = Math.max(maxEnd, e);
      let L = ends.findIndex(end => end <= s + 0.001);
      if (L < 0) { ends.push(e); L = ends.length - 1; } else { ends[L] = e; }
      lo.set(tp.id, L);
    }
    return { laneOf: lo, laneCount: Math.max(1, ends.length), trackSec: maxEnd + SPAN_SEC };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taps, beatSec, unit, refSec]);

  // 毎フレーム：現在時刻が中央に来るよう track を translateX（state経由しない＝軽い）。
  // スクラブ中は holdT（指の位置）を、それ以外は再生位置を追う。
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const tr = trackRef.current; if (!tr || vw === 0) return;
      const sc = scrubRef.current;
      const t = sc ? sc.holdT : (playingRef.current ? getNow() : nowRef.current);
      tr.style.transform = `translateX(${(vw / 2 - t * pxPerSec).toFixed(1)}px)`;
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [vw, pxPerSec, getNow]);

  // バードラッグ（編集ON時のみ）。OFFなら何もせず＝親(viewport)の横スクラブに委ねる。
  const onBarDown = (e: React.PointerEvent, tp: Tap) => {
    if (!editRef.current) return;
    e.stopPropagation();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = { id: tp.id, startX: e.clientX, origT: tp.t };
  };
  const onBarMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const nt = Math.max(0, snapGrid(d.origT + (e.clientX - d.startX) / pxPerSec));
    onMove(d.id, nt);
  };
  const onBarUp = () => { dragRef.current = null; };

  // viewport：編集OFFの掴みは横スクラブ（時間が動く）。指を離した時、動いてなければ＝タップで
  // その位置へシーク。動いていれば最後のスクラブ位置のまま。
  const onVpDown = (e: React.PointerEvent) => {
    if (dragRef.current) return; // バー編集中
    const center = playingRef.current ? getNow() : nowRef.current;
    scrubRef.current = { startX: e.clientX, startT: center, moved: false, holdT: center };
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onVpMove = (e: React.PointerEvent) => {
    const sc = scrubRef.current; if (!sc) return;
    const dx = e.clientX - sc.startX;
    if (Math.abs(dx) > 3) sc.moved = true;
    const t = Math.max(0, sc.startT - dx / pxPerSec); // 指で右へ＝過去へ
    sc.holdT = t;
    if (sc.moved) onScrub(t); // ドラッグ中は動画も追従（再生はそのまま）
  };
  const onVpUp = (e: React.PointerEvent) => {
    const sc = scrubRef.current; if (!sc) { return; }
    if (!sc.moved) {
      // タップ＝その x の時刻へシーク
      const el = vpRef.current;
      if (el) { const rect = el.getBoundingClientRect(); onSeek(Math.max(0, sc.startT + (e.clientX - rect.left - vw / 2) / pxPerSec)); }
    }
    scrubRef.current = null;
  };

  // グリッド線（CSS repeating-gradientで軽く描く）。基準refSecに線が来るようオフセット。
  const offset = refSec == null ? 0 : (refSec * pxPerSec) % (unit * pxPerSec);
  const beatPx = unit * pxPerSec;
  const measurePx = beatSec * 4 * pxPerSec;
  const grid: React.CSSProperties = {
    backgroundImage: `repeating-linear-gradient(90deg, rgba(255,255,255,0.10) 0 1px, transparent 1px ${beatPx}px), repeating-linear-gradient(90deg, rgba(255,255,255,0.22) 0 1.5px, transparent 1.5px ${measurePx}px)`,
    backgroundPosition: `${offset}px 0, ${refSec == null ? 0 : (refSec * pxPerSec) % measurePx}px 0`,
  };
  const trackH = Math.max(laneCount * LANE_PITCH + 8, vh);

  return (
    <div ref={vpRef} onPointerDown={onVpDown} onPointerMove={onVpMove} onPointerUp={onVpUp} onPointerCancel={onVpUp}
      onContextMenu={e => e.preventDefault()}
      style={{ position: "relative", flex: "1 1 auto", minHeight: 0, overflow: "hidden", border: "1px solid #222", borderRadius: 8, background: "#0a0a0c", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", cursor: editMode ? "default" : "ew-resize" }}>
      {/* プレイヘッド（中央固定） */}
      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, marginLeft: -1, background: pink, zIndex: 3, pointerEvents: "none" }} />
      {/* 編集チェック（右上）：ONの時だけバーをドラッグして調整できる */}
      <label style={{ position: "absolute", top: 6, right: 8, zIndex: 4, display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: editMode ? pink : "#aaa", fontWeight: editMode ? 700 : 400, background: "rgba(0,0,0,0.55)", padding: "3px 7px", borderRadius: 6, cursor: "pointer" }}
        onPointerDown={e => e.stopPropagation()}>
        <input type="checkbox" checked={editMode} onChange={e => setEditMode(e.target.checked)} /> 編集
      </label>
      {/* トラック（毎フレーム translateX） */}
      <div ref={trackRef} style={{ position: "absolute", left: 0, top: 0, height: trackH, width: Math.max(1, trackSec * pxPerSec), ...grid, willChange: "transform" }}>
        {taps.map(tp => {
          const left = tp.t * pxPerSec;
          const w = Math.max(22, tp.lenBeats * beatSec * pxPerSec);
          const lane = laneOf.get(tp.id) ?? 0;
          const isCur = tp.id === curId;
          // 長い語（BEYOOOOONDS等）でバー幅が狭いと1行に収まらない→フォントを詰めて縦に折る
          const longWord = /[A-Za-z0-9]{6,}/.test(tp.note);
          const barFont = longWord && w < 60 ? 10 : 12;
          return (
            <div
              key={tp.id}
              onPointerDown={e => onBarDown(e, tp)}
              onPointerMove={onBarMove}
              onPointerUp={onBarUp}
              onPointerCancel={onBarUp}
              style={{
                position: "absolute", left, top: lane * LANE_PITCH + 4, width: w,
                borderRadius: 6, border: `1px solid ${isCur ? "#fff" : "rgba(255,255,255,0.25)"}`,
                background: isCur ? pink : "rgba(218,24,132,0.55)",
                color: "#fff", fontSize: barFont, fontWeight: 700, lineHeight: 1.15,
                padding: "3px 4px", whiteSpace: "normal", wordBreak: "break-all", overflowWrap: "anywhere",
                cursor: editMode ? "grab" : "inherit", touchAction: "none",
                userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none",
                boxShadow: isCur ? "0 0 0 1px rgba(255,255,255,0.4)" : undefined,
              }}
              title={editMode ? "ドラッグでタイミング調整" : tp.note}
            >
              {tp.note || "（無）"}
            </div>
          );
        })}
      </div>
      {taps.length === 0 && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 13, pointerEvents: "none" }}>まだタップなし（リストで登録）</div>}
    </div>
  );
}

export default function ArigatoBeatTapPage({ song, onSave, notice, existing }: Props = {}) {
  const playerRef = useRef<YouTubePlayerApi>(null);
  // 端末への保存先。曲を渡されたときは「曲ごと・動画ごと」に分ける
  // （叩いた秒はその動画の絶対秒なので、動画が違えば別物になるため）。
  const lsKey = song ? `call-center:tap:${song.slug}:${song.videoId}` : LS_KEY;
  const initial = useRef(loadSaved(lsKey, song?.videoId ?? DEFAULT_VIDEO, song?.bpm ?? 149));
  // 端末に下書きが無く、すでに登録されているコールが渡されていれば、それを出発点にする
  if (initial.current.taps.length === 0 && existing && existing.length > 0) {
    initial.current = {
      ...initial.current,
      taps: existing.map((c) => ({ id: rid(), t: c.t, note: c.note, lenBeats: c.lenBeats, groupId: c.groupId })),
    };
  }
  const [videoId, setVideoId] = useState(song?.videoId ?? initial.current.videoId);
  const [videoInput, setVideoInput] = useState(song?.videoId ?? initial.current.videoId);
  const [taps, setTaps] = useState<Tap[]>(initial.current.taps);
  const [bpm, setBpm] = useState(initial.current.bpm);
  // 「調整」＝細かく決めたい人だけが開く場所。開くと上に道具の帯が出て、各行にも道具が出る。
  // 普段の採譜（叩く周・書く周）はここを一度も開かずに終わる。
  const [showAdjust, setShowAdjust] = useState(false);
  // コピーしたブロック。dt=ブロック先頭からの相対秒（同じ間隔で複製するため）。
  const [clipBlock, setClipBlock] = useState<{ dt: number; note: string; lenBeats: number }[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [showHelp, setShowHelp] = useState(false);
  const [rate, setRate] = useState(1);
  const [nowSec, setNowSec] = useState(0);
  const [view, setView] = useState<"list" | "timeline">(initial.current.view);
  // 複数の音でできた1つの掛け声を「収録」するときの状態。
  // recordText=先に書いておく全文。recording中は、タップのたびに units を1つずつ消費する。
  const [recordText, setRecordText] = useState("");
  const [recording, setRecording] = useState<{ groupId: string; units: string[]; idx: number } | null>(null);
  // 「書く周」でいま言葉を書いている行。ここが決まっている間だけ、キーボードの上に帯を出す。
  // 速く続けて押されたときのために、画面の描き直しを待たずに今の行を控えておく（下のwritingRef）。
  const [writingIdx, setWritingIdx] = useState<number | null>(null);
  const writingRef = useRef<number | null>(null);
  const setWriting = (i: number | null) => { writingRef.current = i; setWritingIdx(i); };
  // 各行の言葉の入力欄。「次の空欄へ進む」で指を移すのに使う。
  const noteRefs = useRef<(HTMLInputElement | null)[]>([]);
  // 欄から指が離れた直後に帯を消すと、帯のボタンを押せない。少しだけ待ってから消す。
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  const tapsRef = useRef(taps);
  useEffect(() => { tapsRef.current = taps; }, [taps]);

  // 設定とタップは変更のたびにこの端末へ保存（個別persist呼びを廃止）。
  useEffect(() => {
    try { localStorage.setItem(lsKey, JSON.stringify({ videoId, taps, bpm, view })); } catch { /* ignore */ }
  }, [lsKey, videoId, taps, bpm, view]);

  // 叩いた時刻はそのまま保存する（拍に丸める補正は持たない）。
  // 見る側の画面が「コールの頭を最寄りの目盛りへ寄せる」処理を既に持っていて、
  // 実測した目盛りがある曲ではそちらの方が正確なため、ここで丸めても得がない。
  // 拍の長さは「長さ（何拍か）」の秒換算と、調整のタイムラインの目盛り描きにだけ使う。
  const beatSec = 60 / (bpm || 149);
  const unit = beatSec / 2; // ‹›のずらし幅＝半拍で固定
  // 目盛りの起点＝最初のタップ（目盛りは周期的なのでこれで足りる）。
  const refSec = taps[0]?.t ?? null;
  const snap = (t: number) => (refSec == null ? t : refSec + Math.round((t - refSec) / unit) * unit);
  // 収録開始＝先に書いた全文を「音」に割って、タップのたびに1つずつ置いていく待機状態にする。
  const startRecording = () => {
    const text = recordText.trim();
    if (!text) return;
    const units = splitMora(text);
    if (units.length === 0) return;
    setRecording({ groupId: rid(), units, idx: 0 });
    setShowAdjust(false); // 叩く邪魔になるので道具の帯は畳む。進み具合と中止は専用の細い帯に出る
  };
  // 収録中止＝待機をやめるだけでなく、ここまでに置いた音（同じgroupId）も丸ごと消す。
  // 中途半端に残った行を手で1つずつ探して消さなくていいように。
  const cancelRecording = () => {
    if (recording) setTaps(prev => prev.filter(x => x.groupId !== recording.groupId));
    setRecording(null);
  };

  const addTap = () => {
    const p = playerRef.current; if (!p) return;
    const t = Math.round(p.getCurrentTime() * 1000) / 1000;
    // 収録中は、次の音をこのタップの時刻に置く。最後の音まで置いたら自動で収録を終える。
    if (recording) {
      const { groupId, units, idx } = recording;
      setTaps(prev => [...prev, { id: rid(), t, note: units[idx], lenBeats: 0.5, groupId }].sort((a, b) => a.t - b.t));
      const nextIdx = idx + 1;
      if (nextIdx >= units.length) { setRecording(null); setRecordText(""); }
      else setRecording({ groupId, units, idx: nextIdx });
      return;
    }
    setTaps(prev => [...prev, { id: rid(), t, note: "", lenBeats: 1 }].sort((a, b) => a.t - b.t));
  };

  const clearAll = () => { if (confirm("全部のタップを消す？")) { setTaps([]); setSel(new Set()); } };
  const setNote = (i: number, note: string) => setTaps(prev => prev.map((x, k) => k === i ? { ...x, note } : x));

  // ---- 書く周（言葉を入れていく周）----
  // 「入れて次の空欄へ」を1タップで繰り返せるようにする。100行あっても迷子にならないように、
  // 次に行く先は必ず「まだ言葉が入っていない行」。無ければ帯を閉じて終わり。
  const gotoNextBlank = (fromIdx: number, list: Tap[]) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    const next = list.findIndex((x, k) => k > fromIdx && x.note.trim() === "");
    if (next < 0) { setWriting(null); noteRefs.current[fromIdx]?.blur(); return; }
    setWriting(next);
    // 行が描き直されたあとに指を移す
    requestAnimationFrame(() => noteRefs.current[next]?.focus());
  };
  const onNoteFocus = (i: number) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setWriting(i);
  };
  const onNoteBlur = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => setWriting(null), 180);
  };
  /**
   * いまの行に言葉を入れて（textがnullなら入れずに）次の空欄へ進む。
   *
   * 速く続けて押されると、画面の描き直しが追いつかないうちに次の一手が来る。
   * そこで「今どの行か」も「今どこまで埋まったか」も、画面ではなく控え（ref）から読む。
   * 書き込み自体も「いまの最新に対して1行だけ直す」形にして、間に入った叩きを消さない。
   */
  const fillAndNext = (text: string | null) => {
    const i = writingRef.current;
    if (i == null) return;
    const base = tapsRef.current;
    const list = text == null ? base : base.map((x, k) => k === i ? { ...x, note: text } : x);
    if (text != null) {
      tapsRef.current = list;
      setTaps(prev => prev.map((x, k) => k === i ? { ...x, note: text } : x));
    }
    gotoNextBlank(i, list);
  };
  const blankCount = taps.filter(x => x.note.trim() === "").length;
  const holdCount = taps.filter(x => x.note.trim() === "？" || x.note.trim() === "?").length;
  const setLen = (i: number, lenBeats: number) => setTaps(prev => prev.map((x, k) => k === i ? { ...x, lenBeats } : x));

  // ---- 行内ボタン＆選択（IDベース＝並べ替え/削除でも追従。選択は無制限） ----
  const toggleSel = (id: string) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selTaps = () => taps.filter(t => sel.has(t.id)).sort((a, b) => a.t - b.t); // 時刻順
  // 半拍(8分)/拍ずらし＝この行が選択中なら選択ぜんぶ、そうでなければこの行だけ。最頻用。
  const nudgeRow = (i: number, dir: 1 | -1) => {
    const ids = (sel.size > 0 && sel.has(taps[i].id)) ? sel : new Set([taps[i].id]);
    setTaps(prev => prev.map(x => ids.has(x.id) ? { ...x, t: Math.max(0, Math.round((x.t + dir * unit) * 1000) / 1000) } : x).sort((a, b) => a.t - b.t));
  };
  // タイムラインでバーをドラッグして時刻を直接セット（IDで指定・グリッドスナップ済みの値が来る）。
  const moveTap = (id: string, t: number) => setTaps(prev => prev.map(x => x.id === id ? { ...x, t: Math.round(t * 1000) / 1000 } : x).sort((a, b) => a.t - b.t));
  // コピー＝選択行があればそのブロック、無ければこの行だけ。「先頭からの相対秒＋コール＋長さ」で保存。
  const copyFrom = (i: number) => {
    const src = sel.size > 0 ? selTaps() : [taps[i]];
    if (!src.length) return;
    const t0 = src[0].t;
    setClipBlock(src.map(t => ({ dt: Math.round((t.t - t0) * 1000) / 1000, note: t.note, lenBeats: t.lenBeats })));
    setSel(new Set());
  };
  // 複製＝この行を始点に、コピー元と同じ間隔・同じコールで一気に生成。
  const pasteAt = (i: number) => {
    if (!clipBlock || !clipBlock.length) return;
    const start = taps[i];
    setTaps(prev => {
      const next = prev.map(x => x.id === start.id ? { ...x, note: clipBlock[0].note, lenBeats: clipBlock[0].lenBeats } : x);
      for (let k = 1; k < clipBlock.length; k++) {
        next.push({ id: rid(), t: Math.round((start.t + clipBlock[k].dt) * 1000) / 1000, note: clipBlock[k].note, lenBeats: clipBlock[k].lenBeats });
      }
      return next.sort((a, b) => a.t - b.t);
    });
  };
  // 削除＝この行が選択中なら選択ぜんぶ、そうでなければこの行だけ。
  const delRow = (i: number) => {
    if (sel.size > 0 && sel.has(taps[i].id)) { setTaps(prev => prev.filter(x => !sel.has(x.id))); setSel(new Set()); }
    else { const id = taps[i].id; setTaps(prev => prev.filter(x => x.id !== id)); }
  };

  const changeRate = (r: number) => { try { playerRef.current?.setPlaybackRate(r); } catch { /* ignore */ } setRate(r); };
  // タップでシーク＝再生して、リスト追従(playing判定)も復活させる（秒数タップ後に追従が止まる不具合の修正）
  const seekTo = (t: number) => { try { playerRef.current?.seekTo(t); playerRef.current?.play(); } catch { /* ignore */ } setPlaying(true); };
  // スクラブ用＝再生状態は変えずに位置だけ動かす（タイムライン横ドラッグ中に毎フレーム呼ぶ）
  const seekOnly = (t: number) => { try { playerRef.current?.seekTo(t); } catch { /* ignore */ } setNowSec(t); };
  // 自前の再生/停止（iframe を直接クリックさせない＝フォーカスをこの画面に残して Space を効かせる）
  const [playing, setPlaying] = useState(false);
  const togglePlay = () => {
    const p = playerRef.current; if (!p) return;
    if (p.isPlaying()) { p.pause(); setPlaying(false); } else { p.play(); setPlaying(true); }
  };

  const loadVideoId = () => {
    // URL を貼られても id を拾う（youtu.be/xxx, watch?v=xxx, 生 id すべて対応）
    const raw = videoInput.trim();
    const m = raw.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/) || raw.match(/^([A-Za-z0-9_-]{11})$/);
    const id = m ? m[1] : raw;
    setVideoId(id);
  };

  // 動画の現在位置（再生中に「今どのコールか」を光らせるのに使う）
  const onTimeUpdate = (s: number) => setNowSec(s);

  // 今“鳴っている”コール行＝開始がこの秒数以下の最後の行（まだ来てない次の行は先に光らせない＝先行感を出さない）
  const curIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < taps.length; i++) {
      if (taps[i].t <= nowSec + 0.05) idx = i; else break;
    }
    return idx;
  }, [taps, nowSec]);

  // 現在行を一覧スクロール枠の中央へ（スクロール枠を直接動かす＝確実に追従）。
  // playing 判定は外した＝シーク/スクラブで nowSec が動けば必ず追従する（秒数タップ後に止まる不具合の修正）。
  const curRowRef = useRef<HTMLDivElement>(null);
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view !== "list") return;
    const box = scrollBoxRef.current, row = curRowRef.current;
    if (!box || !row || curIdx < 0) return;
    const target = row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2;
    box.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [curIdx, view]);

  // スペースキーでタップ（動画を見ながら押せるように）。入力欄にフォーカス中は無効。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      e.preventDefault();
      addTap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BPM 推定：直近の間隔の中央値から。拍に合わせて刻んだ時に意味を持つ。
  const intervals = useMemo(() => {
    const out: number[] = [];
    for (let i = 1; i < taps.length; i++) out.push(taps[i].t - taps[i - 1].t);
    return out;
  }, [taps]);
  const recentMs = useMemo(() => {
    const recent = intervals.slice(-8).filter(d => d > 0.15 && d < 3);
    const md = median(recent);
    return md > 0 ? Math.round(md * 1000) : 0;
  }, [intervals]);
  const recentBpm = useMemo(() => {
    const recent = intervals.slice(-8).filter(d => d > 0.15 && d < 3); // 異常間隔は除外
    const md = median(recent);
    return md > 0 ? 60 / md : 0;
  }, [intervals]);
  const allBpm = useMemo(() => {
    const all = intervals.filter(d => d > 0.15 && d < 3);
    const md = median(all);
    return md > 0 ? 60 / md : 0;
  }, [intervals]);

  // 書き出しと取り込みで共通の形。時刻は叩いたそのまま（拍への丸めはしない）。
  const buildCalls = (): TapPageCall[] => taps.map(tp => ({
    t: tp.t,
    lenBeats: tp.lenBeats,
    lenSec: Math.round(tp.lenBeats * beatSec * 1000) / 1000,
    note: tp.note,
    groupId: tp.groupId,
  }));

  const [saveState, setSaveState] = useState<"idle" | "busy" | "done">("idle");

  // ---- 出口（← 曲へ）＝ここで取り込みも済ませる ----
  // 「保存し忘れて帰る」経路をなくすため、取り込みボタンは置かず、帰るときに必ず一度きく。
  const [leaving, setLeaving] = useState<{ send: number; blank: number; hold: number } | null>(null);
  const sendable = () => taps.filter(x => x.note.trim() !== "");
  const askLeave = () => {
    if (!onSave) { if (song?.backTo) navigate(song.backTo); return; }
    setLeaving({ send: sendable().length, blank: blankCount, hold: holdCount });
  };
  const leaveWith = async (save: boolean) => {
    const to = song?.backTo;
    if (save && onSave) {
      setSaveState("busy");
      try {
        await onSave(buildCalls());
      } catch {
        // 送れなかったときは帰らずここに留まる（下書きは端末に残っている）
        setSaveState("idle");
        setLeaving(null);
        return;
      }
      setSaveState("idle");
    }
    setLeaving(null);
    if (to) navigate(to);
  };

  // 書く周の帯を、スマホのキーボードのすぐ上に出すための高さ。
  // 画面の下に貼り付けるだけだとキーボードの裏に隠れてしまうため、見えている範囲の下端を測る。
  const [kbInset, setKbInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onVv = () => setKbInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    vv.addEventListener("resize", onVv);
    vv.addEventListener("scroll", onVv);
    onVv();
    return () => { vv.removeEventListener("resize", onVv); vv.removeEventListener("scroll", onVv); };
  }, []);

  const exportData = async () => {
    const out = {
      videoId, bpm, anchorSec: refSec,
      calls: taps.map(tp => ({
        t: tp.t,
        lenBeats: tp.lenBeats,
        lenSec: Math.round(tp.lenBeats * beatSec * 1000) / 1000,
        note: tp.note,
        groupId: tp.groupId,
      })),
    };
    const json = JSON.stringify(out, null, 2);
    try { await navigator.clipboard.writeText(json); } catch { /* ignore */ }
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "calls.json"; a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  const btn: React.CSSProperties = { fontSize: 14, padding: "8px 12px", borderRadius: 8, border: "1px solid #444", background: "#1a1a1a", color: "#eee", cursor: "pointer" };
  const seg = (active: boolean): React.CSSProperties => ({ ...btn, background: active ? PINK : "#1a1a1a", borderColor: active ? PINK : "#444", color: active ? "#fff" : "#bbb", fontWeight: active ? 700 : 400 });
  // コンパクト版（速さ＋ビュー切替を1行に収めるため）
  const segC = (active: boolean): React.CSSProperties => ({ ...seg(active), fontSize: 13, padding: "5px 9px" });

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "8px 12px", color: "#eee", background: "#000", height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{`.lenwheel::-webkit-scrollbar{display:none}`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0 6px", flex: "0 0 auto" }}>
        {song ? (
          <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {song.title}
            <span style={{ fontSize: 12, color: "#888", fontWeight: 400 }}>　{song.groupName}</span>
          </h1>
        ) : (
          <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, flex: "1 1 auto" }}>コール採譜ツール <span style={{ fontSize: 12, color: "#888" }}>(開発用)</span></h1>
        )}
        {song?.backTo && (
          <button style={{ ...btn, fontSize: 12, padding: "4px 10px", flex: "0 0 auto" }} onClick={askLeave}>← 曲へ</button>
        )}
        <button style={{ ...seg(showAdjust), fontSize: 12, padding: "4px 10px", flex: "0 0 auto" }} onClick={() => setShowAdjust(v => !v)}>
          {showAdjust ? "調整を閉じる" : "調整"}
        </button>
      </div>

      {/*
       * 調整＝細かく決めたい人だけが開く場所。
       * 普段の採譜（叩く周・言葉を入れる周）はここを一度も開かずに終わるようにしてある。
       * ここを開いている間だけ、一覧の各行にも直すための道具が出る。
       */}
      {showAdjust && (
        <div style={{ flex: "0 0 auto", background: "#0c0c0c", border: "1px solid #222", borderRadius: 8, padding: "8px 10px", margin: "0 0 8px", maxHeight: "40dvh", overflowY: "auto" }}>
          <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "#999", width: 58, flex: "0 0 auto" }}>速さ</span>
            {[0.5, 0.75, 1].map(r => (<button key={r} style={segC(rate === r)} onClick={() => changeRate(r)}>{(r < 1 ? String(r).slice(1) : String(r)) + "x"}</button>))}
            <button style={{ ...segC(view === "list"), marginLeft: "auto" }} onClick={() => setView("list")}>一覧</button>
            <button style={segC(view === "timeline")} onClick={() => setView("timeline")}>時間の帯</button>
          </div>
          {/* 曲の速さ。長さ（何拍か）の秒への言い換えと、時間の帯の目盛りを描くのに使う */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, fontSize: 12, flexWrap: "wrap" }}>
            <span style={{ color: "#999", width: 58, flex: "0 0 auto" }}>曲の速さ</span>
            <input type="number" value={bpm} onChange={e => setBpm(Number(e.target.value) || 0)} step="0.1"
              style={{ width: 76, fontSize: 14, padding: "5px 7px", borderRadius: 6, border: "1px solid #444", background: "#111", color: PINK, fontWeight: 700 }} />
            <span style={{ color: "#999" }}>叩いた間隔から <b style={{ color: "#ccc" }}>{allBpm ? allBpm.toFixed(1) : "—"}</b></span>
            {allBpm > 0 && <button style={{ ...btn, fontSize: 12, padding: "5px 9px" }} onClick={() => setBpm(Math.round(allBpm * 10) / 10)}>これにする</button>}
          </div>
          {/* ひと息で言う長い掛け声：先に全文を書いてから、音の数だけ叩いて間隔を決める */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
            <input
              value={recordText}
              onChange={e => setRecordText(e.target.value)}
              placeholder="ひと息の掛け声を先に書く（例: ウォオッオッオッオー）"
              style={{ flex: 1, minWidth: 0, fontSize: 13, padding: "7px 8px", borderRadius: 6, border: "1px solid #444", background: "#111", color: "#eee" }}
            />
            <button
              onClick={startRecording}
              disabled={!recordText.trim()}
              style={{ ...btn, fontSize: 12, padding: "7px 10px", flexShrink: 0, background: recordText.trim() ? PINK : "#1a1a1a", borderColor: recordText.trim() ? PINK : "#444", color: "#fff", opacity: recordText.trim() ? 1 : 0.5 }}
            >
              音ごとに叩く
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button style={{ ...btn, fontSize: 12, padding: "5px 10px" }} onClick={() => setShowHelp(v => !v)}>{showHelp ? "使い方を閉じる" : "使い方"}</button>
            {taps.length > 0 && <button style={{ ...btn, fontSize: 12, padding: "5px 10px" }} onClick={exportData}>書き出す</button>}
          </div>
          {showHelp && (
            <div style={{ fontSize: 12, color: "#aaa", lineHeight: 1.7, marginTop: 8, borderTop: "1px solid #222", paddingTop: 8 }}>
              ① ▶を押して曲を流し、コールの瞬間に大きなボタン（かSpace）を叩く。<b style={{ color: "#ccc" }}>言葉はまだ入れない</b><br />
              ② 曲の終わりまで叩いたら、一覧の行を押して言葉を入れる。分からない所は <b style={{ color: "#ccc" }}>？</b> のままでいい<br />
              ③ 抜けがあれば、もう一度流して足りない所を叩き足す<br />
              ※言葉が空のままの行は取り込まれない＝<b style={{ color: "#ccc" }}>押し間違いは放っておいていい</b><br />
              ※ひと息で言う長い掛け声は、上の欄に全文を書いてから「音ごとに叩く」<br />
              ※叩きにくいときは速さを .5x に。無音の時間も秒数に含まれている（動画との合わせはそのまま正しい）
            </div>
          )}
          {/* 曲を渡されているときは、その曲に結び付いた動画で固定する（取り違え防止） */}
          {!song && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
              <input
                value={videoInput}
                onChange={e => setVideoInput(e.target.value)}
                placeholder="別の動画: YouTube URL か ID"
                style={{ flex: 1, minWidth: 0, fontSize: 13, padding: "6px 8px", borderRadius: 6, border: "1px solid #444", background: "#111", color: "#eee" }}
              />
              <button style={{ ...btn, fontSize: 12, padding: "5px 10px" }} onClick={loadVideoId}>読込</button>
            </div>
          )}
        </div>
      )}

      {/* 保存先の断り。渡されたときだけ出す */}
      {notice && (
        <div style={{ flex: "0 0 auto", fontSize: 12, lineHeight: 1.6, color: "#eee", background: "#2a2118", border: "1px solid #6b5a3a", borderRadius: 8, padding: "8px 10px", margin: "0 0 8px" }}>
          {notice}
        </div>
      )}

      {/* ここから下の操作系は固定（一覧だけ内側スクロール＝SE等でも再生/タップが流れない） */}
      <div style={{ flex: "0 0 auto" }}>
      {/* 動画は小さめに上限（短い画面ほど一覧に高さを譲る）。16:9を保つため幅で絞る。 */}
      <div style={{ width: "min(100%, calc(26dvh * 16 / 9))", margin: "0 auto" }}>
        <YouTubePlayer ref={playerRef} videoId={videoId} onEnded={() => { /* 何もしない */ }} onTimeUpdate={onTimeUpdate} />
      </div>

      {/* 再生/停止＋いまの位置と件数 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 2px 4px" }}>
        <button style={{ ...btn, fontWeight: 700, minWidth: 88 }} onClick={togglePlay}>{playing ? "⏸ 停止" : "▶ 再生"}</button>
        <span style={{ fontSize: 12, color: "#666" }}>{fmt(nowSec)}・{taps.length}</span>
      </div>

      {/* ひと息の掛け声を音ごとに叩いている間だけ出る帯。進み具合と、やめる口。 */}
      {recording && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "2px 2px 4px", fontSize: 12, background: "#2a0f1e", border: `1px solid ${PINK}`, borderRadius: 8, padding: "6px 8px" }}>
          <span style={{ color: "#f7c" }}>「{recordText}」を音ごとに叩いています（{recording.idx + 1}/{recording.units.length}）</span>
          <button style={{ ...btn, fontSize: 12, padding: "4px 10px", marginLeft: "auto" }} onClick={cancelRecording}>やめる</button>
        </div>
      )}

      {/* 大きなタップボタン。音ごとに叩いている間は「次にどの音を置くか」をボタン自体に出す。 */}
      <button
        onClick={addTap}
        style={{ width: "100%", padding: "12px", fontSize: 17, fontWeight: 800, borderRadius: 10, border: "none", background: PINK, color: "#fff", cursor: "pointer", letterSpacing: 1, marginTop: 6, marginBottom: 8 }}
      >
        {recording ? `「${recording.units[recording.idx]}」を タップ（${recording.idx + 1}/${recording.units.length}）` : "タップ（Space）"}
      </button>

      </div>{/* 固定ブロック終わり */}

      {view === "timeline" ? (
        <TimelineView
          taps={taps} snapGrid={snap} beatSec={beatSec} unit={unit} refSec={refSec}
          playing={playing} nowSec={nowSec} getNow={() => playerRef.current?.getCurrentTime() ?? nowSec}
          onSeek={t => seekTo(t)} onScrub={t => seekOnly(t)} onMove={moveTap} curId={taps[curIdx]?.id ?? null} pink={PINK}
        />
      ) : (
      /* 叩いた行の一覧＝作業台。押せば聞き直せて、欄を押せば言葉が書ける（残り高さ全部・内側スクロール） */
      <div style={{ border: "1px solid #222", borderRadius: 8, overflow: "hidden", margin: "0 0 8px", flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
        {/* 一覧の上の細い帯：残りどれだけ言葉を入れれば終わるかを出す */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#888", padding: "5px 8px", borderBottom: "1px solid #222", background: "#0c0c0c", flex: "0 0 auto" }}>
          {sel.size > 0 ? (
            <span style={{ color: PINK, fontWeight: 700 }}>{sel.size}行を選択中</span>
          ) : (
            <>
              <span>{taps.length}件</span>
              {blankCount > 0 && <span style={{ color: PINK, fontWeight: 700 }}>言葉なし {blankCount}</span>}
              {holdCount > 0 && <span style={{ color: "#c9a227" }}>？ {holdCount}</span>}
            </>
          )}
        </div>
        <div ref={scrollBoxRef} style={{ position: "relative", flex: "1 1 auto", minHeight: 0, overflowY: "auto", paddingBottom: writingIdx != null ? 64 : 0 }}>
          {taps.length === 0 && (
            <div style={{ fontSize: 12.5, color: "#888", lineHeight: 1.9, padding: "14px 14px", margin: 0 }}>
              ① ▶を押して曲を流す<br />
              ② コールの瞬間に大きなボタンを叩く。<b style={{ color: "#ccc" }}>言葉はまだ入れなくていい</b><br />
              ③ 曲の終わりまで叩いたら、並んだ行に言葉を入れる
            </div>
          )}
          {taps.map((tap, i) => {
            const isCur = i === curIdx;
            const isSel = sel.has(tap.id);
            const isWriting = writingIdx === i;
            const blank = tap.note.trim() === "";
            const iconBtn = (color: string): React.CSSProperties => ({ width: 34, height: 34, flexShrink: 0, borderRadius: 8, border: "1px solid #3a3a3a", background: "#191919", color, cursor: "pointer", fontSize: 16, padding: 0 });
            return (
              <div
                key={tap.id}
                ref={isCur ? curRowRef : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 4, fontSize: 14, padding: "5px 6px 5px 3px",
                  borderBottom: "1px solid #161616",
                  // まだ言葉が入っていない行は左にピンクの線＝埋まった行と一目で見分ける
                  borderLeft: `3px solid ${blank ? PINK : "transparent"}`,
                  background: isWriting ? "rgba(218,24,132,0.26)" : isSel ? "rgba(218,24,132,0.30)" : isCur ? "rgba(218,24,132,0.16)" : undefined,
                }}
              >
                {/* 選択（まとめて消す・コピー用）は調整を開いた時だけ */}
                {showAdjust && (
                  <button onClick={() => toggleSel(tap.id)} style={{ width: 30, height: 38, flexShrink: 0, borderRadius: 8, border: `1px solid ${isSel ? PINK : "#444"}`, background: isSel ? PINK : "#1a1a1a", color: isSel ? "#fff" : "#999", cursor: "pointer", fontSize: 12, fontWeight: 700, padding: 0 }} title="タップで選択">
                    {i + 1}
                  </button>
                )}
                {/* 秒数＝押すとその瞬間から聞き直せる（言葉を入れる周でいちばん使う） */}
                <button onClick={() => seekTo(tap.t)} style={{ width: 52, height: 38, flexShrink: 0, borderRadius: 8, border: "1px solid #333", background: "#141414", color: "#7cf", cursor: "pointer", fontSize: 11, fontWeight: 700, padding: 0 }} title="ここから聞き直す">
                  {fmt(tap.t).replace(/^0:/, "")}
                </button>
                <input
                  ref={el => { noteRefs.current[i] = el; }}
                  value={tap.note}
                  onChange={e => setNote(i, e.target.value)}
                  onFocus={() => onNoteFocus(i)}
                  onBlur={onNoteBlur}
                  placeholder="（言葉はあとで）"
                  style={{ flex: 1, height: 38, fontSize: 14, padding: "4px 6px", borderRadius: 8, border: `1px solid ${isWriting ? PINK : "#333"}`, background: "#111", color: "#eee", minWidth: 40 }}
                />
                {/*
                 * 直すための道具は調整を開いた時だけ。
                 * さらに、音ごとに叩いて置いた行（groupId持ち）は実際に叩いた時刻がそのまま
                 * 正しい間隔になっているので、手で直す前提の道具は出さない。
                 */}
                {showAdjust && (
                  <>
                    {!tap.groupId && (
                      <>
                        <button onClick={() => nudgeRow(i, -1)} style={iconBtn("#9cf")} title="半拍だけ前へ">‹</button>
                        <button onClick={() => nudgeRow(i, 1)} style={iconBtn("#9cf")} title="半拍だけ後ろへ">›</button>
                        <LenPicker value={tap.lenBeats} onChange={v => setLen(i, v)} />
                        <button onClick={() => copyFrom(i)} style={iconBtn(sel.size ? PINK : "#9aa0a6")} title={sel.size ? "選択中の行をまとめてコピー" : "この行をコピー"}>⧉</button>
                        <button onClick={() => pasteAt(i)} disabled={!clipBlock} style={{ ...iconBtn(clipBlock ? PINK : "#444") }} title="この行を始点に複製">⤓</button>
                      </>
                    )}
                    <button onClick={() => delRow(i)} style={iconBtn("#c66")} title={sel.size && isSel ? "選択をまとめて削除" : "削除"}>×</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/*
       * 言葉を入れる周の帯。欄を触っている間だけ、キーボードのすぐ上に出る。
       * 押すたびに「入れて次の空欄へ」進むので、行数が多くても迷子にならない。
       * 指が欄から離れると帯も消えてしまうので、押した瞬間は指を離さない扱いにしている。
       */}
      {writingIdx != null && (
        <div
          onPointerDown={e => e.preventDefault()}
          style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", width: "min(100%, 520px)", bottom: kbInset, zIndex: 200, display: "flex", gap: 6, padding: "8px 10px", background: "#101014", borderTop: "1px solid #333" }}
        >
          <button onClick={() => fillAndNext("オイ！")} style={{ ...btn, flex: "1 1 0", fontSize: 15, fontWeight: 800, background: PINK, borderColor: PINK, color: "#fff", padding: "10px 8px" }}>オイ！</button>
          <button onClick={() => fillAndNext(CALL_HOLD_MARK)} style={{ ...btn, flex: "0 0 auto", fontSize: 15, fontWeight: 800, padding: "10px 18px" }} title="何て言ってるか分からないところ">？</button>
          <button onClick={() => fillAndNext(null)} style={{ ...btn, flex: "0 0 auto", fontSize: 14, padding: "10px 14px" }}>次へ</button>
        </div>
      )}

      {/* 出口。取り込みはここで済ませる＝保存し忘れて帰る道をなくす */}
      {leaving && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={() => setLeaving(null)}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, background: "#141416", borderTop: `2px solid ${PINK}`, padding: "16px 16px 20px" }}>
            <p style={{ fontSize: 15, fontWeight: 700, margin: "0 0 6px" }}>言葉の入った{leaving.send}件を取り込む？</p>
            <p style={{ fontSize: 12, color: "#9aa0a6", lineHeight: 1.7, margin: "0 0 14px" }}>
              {leaving.blank > 0 && <>言葉が空の{leaving.blank}件は入りません<br /></>}
              {leaving.hold > 0 && <>？の{leaving.hold}件も一緒に入ります【仮】<br /></>}
              叩いた内容はこの端末にそのまま残っているので、あとで続きもできます。
            </p>
            <button
              disabled={saveState === "busy" || leaving.send === 0}
              onClick={() => leaveWith(true)}
              style={{ ...btn, width: "100%", fontSize: 15, fontWeight: 800, padding: "12px", background: leaving.send === 0 ? "#1a1a1a" : PINK, borderColor: leaving.send === 0 ? "#444" : PINK, color: "#fff", opacity: leaving.send === 0 ? 0.5 : 1, marginBottom: 8 }}
            >
              {saveState === "busy" ? "取り込み中…" : "取り込んで戻る"}
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => leaveWith(false)} style={{ ...btn, flex: 1, padding: "10px" }}>取り込まずに戻る</button>
              <button onClick={() => setLeaving(null)} style={{ ...btn, flex: 1, padding: "10px" }}>やめる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
