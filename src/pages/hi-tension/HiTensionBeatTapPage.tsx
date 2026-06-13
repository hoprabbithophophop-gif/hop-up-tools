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

// t=動画の絶対秒(無音込み・生タップ)。note=コール文。lenBeats=コールの長さ(拍・小数可)。
type Tap = { t: number; note: string; lenBeats: number };
type Saved = { videoId: string; taps: Tap[]; bpm: number; anchorSec: number | null; snapOn: boolean; snapRes: "q" | "e" };

function loadSaved(): Saved {
  const base: Saved = { videoId: DEFAULT_VIDEO, taps: [], bpm: 149, anchorSec: null, snapOn: false, snapRes: "e" };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.taps)) {
        return {
          videoId: typeof o.videoId === "string" ? o.videoId : DEFAULT_VIDEO,
          taps: o.taps.map((x: { t: number; note?: string; lenBeats?: number }) => ({ t: x.t, note: x.note ?? "", lenBeats: typeof x.lenBeats === "number" ? x.lenBeats : 1 })),
          bpm: typeof o.bpm === "number" ? o.bpm : 149,
          anchorSec: typeof o.anchorSec === "number" ? o.anchorSec : null,
          snapOn: o.snapOn === true,
          snapRes: o.snapRes === "q" ? "q" : "e",
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

export default function HiTensionBeatTapPage() {
  const playerRef = useRef<YouTubePlayerApi>(null);
  const initial = useRef(loadSaved());
  const [videoId, setVideoId] = useState(initial.current.videoId);
  const [videoInput, setVideoInput] = useState(initial.current.videoId);
  const [taps, setTaps] = useState<Tap[]>(initial.current.taps);
  const [bpm, setBpm] = useState(initial.current.bpm);
  const [anchorSec, setAnchorSec] = useState<number | null>(initial.current.anchorSec);
  const [snapOn, setSnapOn] = useState(initial.current.snapOn);
  const [snapRes, setSnapRes] = useState<"q" | "e">(initial.current.snapRes);
  const [clip, setClip] = useState<{ note: string; lenBeats: number } | null>(null);
  const [rate, setRate] = useState(1);
  const [nowSec, setNowSec] = useState(0);

  const tapsRef = useRef(taps);
  useEffect(() => { tapsRef.current = taps; }, [taps]);

  // 設定とタップは変更のたびにこの端末へ保存（個別persist呼びを廃止）。
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ videoId, taps, bpm, anchorSec, snapOn, snapRes })); } catch { /* ignore */ }
  }, [videoId, taps, bpm, anchorSec, snapOn, snapRes]);

  // BPM＋基準タップの拍グリッドに丸める。基準=確実に拍に乗ったタップ(無くても最初のタップで代用)。
  // 8分/4分で分解能切替。基準は周期的なのでどの拍でもOK(拍1である必要はない)。
  const beatSec = 60 / (bpm || 149);
  const unit = snapRes === "e" ? beatSec / 2 : beatSec;
  // 明示の基準が無ければ最初のタップを基準に使う＝補正がすぐ効く。
  const refSec = anchorSec ?? (taps[0]?.t ?? null);
  const snap = (t: number) => (refSec == null ? t : refSec + Math.round((t - refSec) / unit) * unit);
  const dispT = (t: number) => (snapOn ? snap(t) : t);
  // 行を1グリッド(8分/4分)分ずらす＝半拍ズレたタップの微調整。
  const nudge = (i: number, dir: 1 | -1) => setTaps(prev => prev.map((x, k) => k === i ? { ...x, t: Math.round((x.t + dir * unit) * 1000) / 1000 } : x).sort((a, b) => a.t - b.t));

  const addTap = () => {
    const p = playerRef.current; if (!p) return;
    const t = Math.round(p.getCurrentTime() * 1000) / 1000;
    setTaps(prev => [...prev, { t, note: "", lenBeats: 1 }].sort((a, b) => a.t - b.t));
  };

  const undo = () => setTaps(prev => prev.slice(0, -1));
  const clearAll = () => { if (confirm("全部のタップを消す？")) setTaps([]); };
  const removeAt = (i: number) => setTaps(prev => prev.filter((_, k) => k !== i));
  const setNote = (i: number, note: string) => setTaps(prev => prev.map((x, k) => k === i ? { ...x, note } : x));
  const setLen = (i: number, lenBeats: number) => setTaps(prev => prev.map((x, k) => k === i ? { ...x, lenBeats } : x));
  const copyRow = (i: number) => setClip({ note: taps[i].note, lenBeats: taps[i].lenBeats });
  const pasteRow = (i: number) => { if (clip) setTaps(prev => prev.map((x, k) => k === i ? { ...x, note: clip.note, lenBeats: clip.lenBeats } : x)); };
  const setAnchorRow = (i: number) => setAnchorSec(taps[i].t); // この行のタップを拍の基準に

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
    const out = {
      videoId, bpm, anchorSec, snap: snapOn ? snapRes : null,
      calls: taps.map(tp => ({
        t: snapOn ? Math.round(snap(tp.t) * 1000) / 1000 : tp.t,
        tRaw: tp.t,
        lenBeats: tp.lenBeats,
        lenSec: Math.round(tp.lenBeats * beatSec * 1000) / 1000,
        note: tp.note,
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

      {/* 自動BPM検出（拍に刻んだ時の参考）。8分混在に備え ♩/♪/間隔ms の両読み。 */}
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", margin: "4px 2px 4px", flexWrap: "wrap", fontSize: 12, color: "#999" }}>
        <span>検出♩ <b style={{ fontSize: 16, color: "#ccc" }}>{recentBpm ? recentBpm.toFixed(1) : "—"}</b></span>
        <span>♪なら <b style={{ color: "#ccc" }}>{recentBpm ? (recentBpm * 2).toFixed(1) : "—"}</b></span>
        <span>間隔 <b style={{ color: "#ccc" }}>{recentMs ? `${recentMs}ms` : "—"}</b></span>
      </div>

      {/* 補正：BPM＋基準タップの拍グリッドに丸める */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "2px 2px 4px", flexWrap: "wrap", fontSize: 12 }}>
        <span style={{ color: "#999" }}>BPM</span>
        <input type="number" value={bpm} onChange={e => setBpm(Number(e.target.value) || 0)} step="0.1"
          style={{ width: 70, fontSize: 14, padding: "5px 7px", borderRadius: 6, border: "1px solid #444", background: "#111", color: PINK, fontWeight: 700 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 4, color: snapOn ? PINK : "#999", cursor: "pointer", fontWeight: snapOn ? 700 : 400 }}>
          <input type="checkbox" checked={snapOn} onChange={e => setSnapOn(e.target.checked)} /> 補正ON
        </label>
        {[["e", "8分"], ["q", "4分"]].map(([v, l]) => (
          <button key={v} style={seg(snapRes === v)} onClick={() => setSnapRes(v as "q" | "e")}>{l}</button>
        ))}
        <span style={{ color: "#666" }}>基準: {anchorSec == null ? "自動(最初のタップ)" : `${anchorSec.toFixed(2)}s`}</span>
      </div>
      <p style={{ fontSize: 11, color: "#777", margin: "0 2px 6px", lineHeight: 1.5 }}>
        補正ON＝BPMの拍に秒数を丸める。「基準」は確実に拍に乗った行の <b style={{ color: "#bbb" }}>◎</b> で指定（未指定なら最初のタップを自動採用）。半拍ズレた行は <b style={{ color: "#bbb" }}>‹ ›</b> で前後に動かす。
      </p>

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
          <span style={{ width: 22 }}>#</span>
          <span style={{ width: 58 }}>{snapOn ? "補正秒" : "秒数"}</span>
          <span style={{ width: 40, textAlign: "center" }}>前後</span>
          <span style={{ flex: 1 }}>コール文</span>
          <span style={{ width: 40, textAlign: "center" }}>長さ</span>
          <span style={{ width: 74, textAlign: "right" }}>操作</span>
        </div>
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          {taps.length === 0 && <p style={{ fontSize: 12, color: "#666", textAlign: "center", padding: 14, margin: 0 }}>まだタップなし</p>}
          {taps.map((tap, i) => {
            const shown = dispT(tap.t);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 13, padding: "4px 8px", borderBottom: "1px solid #161616" }}>
                <span style={{ width: 22, color: anchorSec === tap.t ? PINK : "#777", fontWeight: anchorSec === tap.t ? 700 : 400 }}>{i + 1}</span>
                <button onClick={() => seekTo(shown)} style={{ width: 58, textAlign: "left", background: "none", border: "none", color: "#7cf", cursor: "pointer", fontSize: 13, padding: 0 }} title="ここへシーク">{fmt(shown)}</button>
                <span style={{ width: 40, textAlign: "center", whiteSpace: "nowrap" }}>
                  <button onClick={() => nudge(i, -1)} style={{ background: "none", border: "none", color: "#9cf", cursor: "pointer", fontSize: 16, padding: "0 1px" }} title={`${snapRes === "e" ? "8分" : "4分"}前へ`}>‹</button>
                  <button onClick={() => nudge(i, 1)} style={{ background: "none", border: "none", color: "#9cf", cursor: "pointer", fontSize: 16, padding: "0 1px" }} title={`${snapRes === "e" ? "8分" : "4分"}後へ`}>›</button>
                </span>
                <input
                  value={tap.note}
                  onChange={e => setNote(i, e.target.value)}
                  placeholder="コール文…"
                  style={{ flex: 1, fontSize: 13, padding: "4px 6px", borderRadius: 6, border: "1px solid #333", background: "#111", color: "#eee", minWidth: 0 }}
                />
                <input
                  type="number" step="0.5" value={tap.lenBeats}
                  onChange={e => setLen(i, Number(e.target.value) || 0)}
                  style={{ width: 38, fontSize: 12, padding: "4px 3px", borderRadius: 6, border: "1px solid #333", background: "#111", color: "#eee", textAlign: "center" }}
                />
                <span style={{ width: 74, textAlign: "right", whiteSpace: "nowrap" }}>
                  <button onClick={() => setAnchorRow(i)} style={{ background: "none", border: "none", color: anchorSec === tap.t ? PINK : "#9aa0a6", cursor: "pointer", fontSize: 13 }} title="この行を拍の基準に">◎</button>
                  <button onClick={() => copyRow(i)} style={{ background: "none", border: "none", color: "#9aa0a6", cursor: "pointer", fontSize: 13 }} title="このコールをコピー">⧉</button>
                  <button onClick={() => pasteRow(i)} disabled={!clip} style={{ background: "none", border: "none", color: clip ? PINK : "#444", cursor: clip ? "pointer" : "default", fontSize: 13 }} title="ここに貼り付け">⤓</button>
                  <button onClick={() => removeAt(i)} style={{ background: "none", border: "none", color: "#a55", cursor: "pointer", fontSize: 15 }} title="削除">×</button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <button style={{ ...btn, width: "100%", fontWeight: 700 }} onClick={exportData} disabled={taps.length === 0}>書き出す（コピー＋calls.json保存）</button>

      <p style={{ fontSize: 11, color: "#666", margin: "10px 0 0", lineHeight: 1.7 }}>
        手順: ①BPMを入れる(検出♩が目安・149っぽい) ②無音明けの最初の拍で「▼拍1にする」 ③コールの瞬間にSpace ④「補正ON」で拍グリッド(8分/4分)に丸める＝ブレ消える ⑤「長さ拍」にコールの拍数（例「あーりーがーと」=3.5） ⑥同じコールは ⧉コピー→⤓貼付で使い回し ⑦秒数タップでそこへシーク。無音時間は秒数に含まれてる(拍1アンカーが吸収)。
      </p>
    </div>
  );
}
