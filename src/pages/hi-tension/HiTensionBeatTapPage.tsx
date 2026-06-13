// コール採譜ツール（開発用・非公開）
//
// 目的: ステージ動画を見ながらタップして「その瞬間の動画秒数」を記録し、
//       タップ間隔から大体のBPMを推定したり、各タップにコール文をメモして、
//       コールデータ(JSON)として書き出すための作業用画面。
//       公開ツールではない。隠しルート (/hi-tension/beat)。
import { useEffect, useMemo, useRef, useState } from "react";
import YouTubePlayer, { type YouTubePlayerApi } from "./components/YouTubePlayer";

const PINK = "#da1884";
// 既定はありがとビート Stage Practice ver.（BEYOOOOONDS公式）。他のidに差し替え可。
const DEFAULT_VIDEO = "n5AVvFwbeaM";
const LS_KEY = "hi_tension:beat_tap";

type Tap = { t: number; note: string };

function loadTaps(): { videoId: string; taps: Tap[] } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.taps)) {
        return { videoId: typeof o.videoId === "string" ? o.videoId : DEFAULT_VIDEO, taps: o.taps };
      }
    }
  } catch { /* 壊れていたら空で始める */ }
  return { videoId: DEFAULT_VIDEO, taps: [] };
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

export default function HiTensionBeatTapPage() {
  const playerRef = useRef<YouTubePlayerApi>(null);
  const initial = useRef(loadTaps());
  const [videoId, setVideoId] = useState(initial.current.videoId);
  const [videoInput, setVideoInput] = useState(initial.current.videoId);
  const [taps, setTaps] = useState<Tap[]>(initial.current.taps);
  const [rate, setRate] = useState(1);
  const [nowSec, setNowSec] = useState(0);

  const tapsRef = useRef(taps);
  useEffect(() => { tapsRef.current = taps; }, [taps]);

  const persist = (next: Tap[], vid = videoId) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ videoId: vid, taps: next })); } catch { /* ignore */ }
  };

  const addTap = () => {
    const p = playerRef.current; if (!p) return;
    const t = Math.round(p.getCurrentTime() * 1000) / 1000;
    setTaps(prev => {
      const next = [...prev, { t, note: "" }].sort((a, b) => a.t - b.t);
      persist(next);
      return next;
    });
  };

  const undo = () => setTaps(prev => { const next = prev.slice(0, -1); persist(next); return next; });
  const clearAll = () => { if (confirm("全部のタップを消す？")) { setTaps([]); persist([]); } };
  const removeAt = (i: number) => setTaps(prev => { const next = prev.filter((_, k) => k !== i); persist(next); return next; });
  const setNote = (i: number, note: string) => setTaps(prev => { const next = prev.map((x, k) => k === i ? { ...x, note } : x); persist(next); return next; });

  const changeRate = (r: number) => { try { playerRef.current?.setPlaybackRate(r); } catch { /* ignore */ } setRate(r); };
  const seekTo = (t: number) => { try { playerRef.current?.seekTo(t); playerRef.current?.play(); } catch { /* ignore */ } };
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
    persist(tapsRef.current, id);
  };

  // 動画の現在位置をうっすら表示（タップ位置の見当用）
  const onTimeUpdate = (s: number) => setNowSec(s);

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

  const exportData = async () => {
    const json = JSON.stringify({ videoId, bpmGuess: Math.round(allBpm * 100) / 100, taps }, null, 2);
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

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: 12, color: "#eee", background: "#000", minHeight: "100dvh", fontFamily: "Inter, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 16, fontWeight: 700, margin: "4px 0 2px" }}>コール採譜ツール <span style={{ fontSize: 12, color: "#888" }}>(開発用・非公開)</span></h1>
      <p style={{ fontSize: 12, color: "#999", margin: "0 0 8px", lineHeight: 1.6 }}>
        動画を見ながら <b style={{ color: "#ccc" }}>スペースキー</b>（または下の大ボタン）でタップ＝その瞬間の秒数を記録。
        拍に合わせて刻めばBPM、コールに合わせて押せばコールの秒数が並ぶ。各行にコール文をメモして書き出し。
      </p>

      {/* 動画切替 */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
        <input
          value={videoInput}
          onChange={e => setVideoInput(e.target.value)}
          placeholder="YouTube URL か 動画ID"
          style={{ flex: 1, fontSize: 13, padding: "7px 9px", borderRadius: 8, border: "1px solid #444", background: "#111", color: "#eee" }}
        />
        <button style={btn} onClick={loadVideoId}>読込</button>
      </div>

      <YouTubePlayer ref={playerRef} videoId={videoId} onEnded={() => { /* 何もしない */ }} onTimeUpdate={onTimeUpdate} />

      {/* 再生/停止（自前ボタン＝iframeにフォーカスを渡さない） */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 2px 4px" }}>
        <button style={{ ...btn, fontWeight: 700, minWidth: 92 }} onClick={togglePlay}>{playing ? "⏸ 停止" : "▶ 再生"}</button>
        <span style={{ fontSize: 12, color: "#666" }}>現在 {fmt(nowSec)}・{taps.length}タップ</span>
      </div>

      {/* BPM。8分音符が混じると間隔がばらつくので、間隔の中央値と ♩/♪ 両読みを出す。 */}
      <div style={{ display: "flex", gap: 14, alignItems: "baseline", margin: "4px 2px 6px", flexWrap: "wrap" }}>
        <div><span style={{ fontSize: 12, color: "#999" }}>♩BPM </span><b style={{ fontSize: 22, color: PINK }}>{recentBpm ? recentBpm.toFixed(1) : "—"}</b></div>
        <div><span style={{ fontSize: 12, color: "#999" }}>♪なら </span><b style={{ fontSize: 14, color: "#ccc" }}>{recentBpm ? (recentBpm * 2).toFixed(1) : "—"}</b></div>
        <div><span style={{ fontSize: 12, color: "#999" }}>間隔中央 </span><b style={{ fontSize: 14, color: "#ccc" }}>{recentMs ? `${recentMs}ms` : "—"}</b></div>
        <div><span style={{ fontSize: 12, color: "#999" }}>全体♩ </span><b style={{ fontSize: 14, color: "#888" }}>{allBpm ? allBpm.toFixed(1) : "—"}</b></div>
      </div>

      {/* 大きなタップボタン */}
      <button
        onClick={addTap}
        style={{ width: "100%", padding: "16px", fontSize: 18, fontWeight: 800, borderRadius: 10, border: "none", background: PINK, color: "#fff", cursor: "pointer", letterSpacing: 1 }}
      >
        タップ（Space）
      </button>

      {/* 操作 */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "10px 0" }}>
        <span style={{ fontSize: 12, color: "#999" }}>速さ</span>
        {[0.5, 0.75, 1].map(r => (<button key={r} style={seg(rate === r)} onClick={() => changeRate(r)}>{r}x</button>))}
        <button style={{ ...btn, marginLeft: "auto" }} onClick={undo} disabled={taps.length === 0}>1個取消</button>
        <button style={{ ...btn, color: "#e88", borderColor: "#633" }} onClick={clearAll} disabled={taps.length === 0}>全消し</button>
      </div>

      {/* タップ一覧 */}
      <div style={{ border: "1px solid #222", borderRadius: 8, overflow: "hidden", marginBottom: 10 }}>
        <div style={{ display: "flex", fontSize: 11, color: "#888", padding: "6px 8px", borderBottom: "1px solid #222", background: "#0c0c0c" }}>
          <span style={{ width: 28 }}>#</span>
          <span style={{ width: 70 }}>秒数</span>
          <span style={{ width: 56 }}>前との差</span>
          <span style={{ flex: 1 }}>コール文（メモ）</span>
          <span style={{ width: 70, textAlign: "right" }}>操作</span>
        </div>
        <div style={{ maxHeight: 280, overflowY: "auto" }}>
          {taps.length === 0 && <p style={{ fontSize: 12, color: "#666", textAlign: "center", padding: 14, margin: 0 }}>まだタップなし</p>}
          {taps.map((tap, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", fontSize: 13, padding: "4px 8px", borderBottom: "1px solid #161616" }}>
              <span style={{ width: 28, color: "#777" }}>{i + 1}</span>
              <button onClick={() => seekTo(tap.t)} style={{ width: 70, textAlign: "left", background: "none", border: "none", color: "#7cf", cursor: "pointer", fontSize: 13, padding: 0 }} title="ここへシーク">{fmt(tap.t)}</button>
              <span style={{ width: 56, color: "#888", fontSize: 12 }}>{i > 0 ? `+${(tap.t - taps[i - 1].t).toFixed(2)}` : "—"}</span>
              <input
                value={tap.note}
                onChange={e => setNote(i, e.target.value)}
                placeholder="コール文…"
                style={{ flex: 1, fontSize: 13, padding: "4px 6px", borderRadius: 6, border: "1px solid #333", background: "#111", color: "#eee", minWidth: 0 }}
              />
              <span style={{ width: 70, textAlign: "right" }}>
                <button onClick={() => removeAt(i)} style={{ background: "none", border: "none", color: "#a55", cursor: "pointer", fontSize: 16 }} title="削除">×</button>
              </span>
            </div>
          ))}
        </div>
      </div>

      <button style={{ ...btn, width: "100%", fontWeight: 700 }} onClick={exportData} disabled={taps.length === 0}>書き出す（コピー＋calls.json保存）</button>

      <p style={{ fontSize: 11, color: "#666", margin: "10px 0 0", lineHeight: 1.6 }}>
        コツ: ①速さ0.5xにすると押しやすい ②BPMを知りたい時は曲の拍に合わせて8回くらい刻む ③コールの秒数は本番速度で押すと実際に近い ④秒数をタップするとそこへシークして聞き直せる。
      </p>
    </div>
  );
}
