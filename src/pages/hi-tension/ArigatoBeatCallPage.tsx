// コール練習プレイヤー（開発用・隠しルート /arigato-beat/call）
//
// 目的: 採譜ツール(/arigato-beat/beat)で作ったコールを「テレプロンプター」で再生する。
//   - YouTube同期モード: ステージ練習動画(YouTube)に合わせてコールを表示（フル制御で完全同期）。
//   - 単独モード: 動画なしで内部クロックを回す。3・2・1カウントダウンで頭出しし、±msオフセットで
//     微調整。インスタのレクチャー映像など“操作できない動画”と手動で合わせて一緒に流す用。
//   どちらも表示は共通＝今のコールを中央に大きく、次のコールを下に小さく予告。
//   コールデータは採譜ツールの保存(localStorage)を読む（採譜が固まったらデータファイルに焼く想定）。
import { useEffect, useMemo, useRef, useState } from "react";
import YouTubePlayer, { type YouTubePlayerApi } from "./components/YouTubePlayer";

const PINK = "#da1884";
// 本編アリーナと同じ暗背景（白メンカラが溶けないよう統一してきた流れに合わせる）
const ARENA_BG = "radial-gradient(150% 85% at 50% -8%, #1b2030 0%, #0e1016 48%, #07080c 100%)";
const LS_KEY = "hi_tension:beat_tap";

type Call = { t: number; note: string; lenBeats: number };

function loadCalls(): { videoId: string; calls: Call[]; bpm: number } {
  try {
    const o = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    const taps: Call[] = Array.isArray(o.taps)
      ? o.taps.filter((x: Call) => typeof x?.t === "number").map((x: Call) => ({ t: x.t, note: x.note || "", lenBeats: x.lenBeats || 1 }))
      : [];
    taps.sort((a, b) => a.t - b.t);
    return { videoId: o.videoId || "n5AVvFwbeaM", calls: taps, bpm: o.bpm || 149 };
  } catch {
    return { videoId: "n5AVvFwbeaM", calls: [], bpm: 149 };
  }
}

export default function ArigatoBeatCallPage() {
  const data = useRef(loadCalls());
  const calls = data.current.calls;
  const [mode, setMode] = useState<"youtube" | "solo">("youtube");

  // 表示中のコール番号だけを state に（毎フレームの now は ref で持ち再描画を減らす）。
  const [idx, setIdx] = useState(-1);
  const idxRef = useRef(-1);
  const nowRef = useRef(0);

  const playerRef = useRef<YouTubePlayerApi>(null);

  // 単独モードのクロック
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false); runningRef.current = running;
  const startPerfRef = useRef(0);
  const [offsetMs, setOffsetMs] = useState(0);
  const offsetRef = useRef(0); offsetRef.current = offsetMs;
  const [countdown, setCountdown] = useState(0); // 3,2,1（0=非表示）
  const [playing, setPlaying] = useState(false);

  // now から「今鳴ってるコール番号」を出して、変わった時だけ再描画。
  const applyNow = (t: number) => {
    nowRef.current = t;
    let lo = -1;
    for (let i = 0; i < calls.length; i++) { if (calls[i].t <= t + 0.03) lo = i; else break; }
    if (lo !== idxRef.current) { idxRef.current = lo; setIdx(lo); }
  };

  // YouTube同期：毎フレーム getCurrentTime を読む
  useEffect(() => {
    if (mode !== "youtube") return;
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); const t = playerRef.current?.getCurrentTime?.(); if (typeof t === "number") applyNow(t); };
    loop();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, calls]);

  // 単独：内部クロック（performance基準）＋オフセット
  useEffect(() => {
    if (mode !== "solo" || !running) return;
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); applyNow(Math.max(0, (performance.now() - startPerfRef.current) / 1000 + offsetRef.current / 1000)); };
    loop();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, running, calls]);

  const cur = idx >= 0 ? calls[idx] : null;
  const next = calls[idx + 1] ?? null;
  const nnext = calls[idx + 2] ?? null;

  // ---- YouTube操作 ----
  const togglePlay = () => {
    const p = playerRef.current; if (!p) return;
    if (p.isPlaying()) { p.pause(); setPlaying(false); } else { p.play(); setPlaying(true); }
  };
  const restartYt = () => { try { playerRef.current?.seekTo(0); playerRef.current?.play(); } catch { /* ignore */ } setPlaying(true); };

  // ---- 単独モード：3・2・1カウントダウン→クロック開始 ----
  const cdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startSolo = () => {
    if (cdTimer.current) clearTimeout(cdTimer.current);
    setRunning(false); idxRef.current = -1; setIdx(-1);
    let c = 3; setCountdown(3);
    const tick = () => {
      c -= 1;
      if (c > 0) { setCountdown(c); cdTimer.current = setTimeout(tick, 700); }
      else { setCountdown(0); startPerfRef.current = performance.now(); setRunning(true); }
    };
    cdTimer.current = setTimeout(tick, 700);
  };
  const stopSolo = () => { if (cdTimer.current) clearTimeout(cdTimer.current); setCountdown(0); setRunning(false); idxRef.current = -1; setIdx(-1); };
  useEffect(() => () => { if (cdTimer.current) clearTimeout(cdTimer.current); }, []);

  const btn: React.CSSProperties = { fontSize: 14, padding: "9px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#eee", cursor: "pointer" };
  const seg = (active: boolean): React.CSSProperties => ({ ...btn, padding: "6px 12px", background: active ? PINK : "rgba(255,255,255,0.06)", borderColor: active ? PINK : "rgba(255,255,255,0.18)", color: active ? "#fff" : "#cbd2dc", fontWeight: active ? 700 : 400 });

  return (
    <div style={{ minHeight: "100dvh", background: ARENA_BG, color: "#eef1f5", display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, sans-serif", padding: "10px 14px", boxSizing: "border-box" }}>
      {/* ヘッダ＋モード切替 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        <h1 style={{ fontSize: 15, fontWeight: 800, margin: 0, letterSpacing: 0.5 }}>コール練習 <span style={{ fontSize: 11, color: "#8b93a0", fontWeight: 400 }}>(開発用)</span></h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button style={seg(mode === "youtube")} onClick={() => { stopSolo(); setMode("youtube"); }}>YouTube</button>
          <button style={seg(mode === "solo")} onClick={() => { setPlaying(false); setMode("solo"); }}>単独</button>
        </div>
      </div>

      {calls.length === 0 && (
        <p style={{ fontSize: 13, color: "#9aa3b0", marginTop: 12 }}>採譜データがありません。先に <b style={{ color: "#cbd2dc" }}>/arigato-beat/beat</b> でコールを記録してね。</p>
      )}

      {/* YouTubeモードだけ動画を出す（同期元） */}
      {mode === "youtube" && (
        <div style={{ width: "min(100%, calc(24dvh * 16 / 9))", margin: "8px auto 0", flex: "0 0 auto" }}>
          <YouTubePlayer ref={playerRef} videoId={data.current.videoId} onEnded={() => setPlaying(false)} />
        </div>
      )}

      {/* テレプロンプター（今のコール大・次を小さく予告） */}
      <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, position: "relative", padding: "10px 0" }}>
        {countdown > 0 ? (
          <div style={{ fontSize: 96, fontWeight: 900, color: PINK, lineHeight: 1 }}>{countdown}</div>
        ) : (
          <>
            <div style={{ fontSize: "min(13vw, 64px)", fontWeight: 900, color: "#fff", textAlign: "center", lineHeight: 1.1, wordBreak: "break-word", textShadow: "0 2px 18px rgba(218,24,132,0.35)" }}>
              {cur ? (cur.note || "♪") : <span style={{ color: "#6b7480", fontSize: 22, fontWeight: 600 }}>{mode === "solo" ? "スタートで開始" : "再生でスタート"}</span>}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, color: "#9aa3b0", fontSize: 18, fontWeight: 700 }}>
              {next && <><span style={{ fontSize: 11, color: "#6b7480", fontWeight: 600 }}>NEXT</span><span style={{ color: "#cbd2dc" }}>{next.note || "♪"}</span></>}
              {nnext && <span style={{ color: "#6b7480", fontSize: 14 }}>／ {nnext.note || "♪"}</span>}
            </div>
          </>
        )}
      </div>

      {/* 操作バー（モード別） */}
      <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
        {mode === "youtube" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...btn, fontWeight: 700, minWidth: 110 }} onClick={togglePlay}>{playing ? "⏸ 停止" : "▶ 再生"}</button>
            <button style={btn} onClick={restartYt}>⤺ 最初から</button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8 }}>
              {running ? (
                <button style={{ ...btn, fontWeight: 700, minWidth: 140, background: PINK, borderColor: PINK, color: "#fff" }} onClick={stopSolo}>■ 停止</button>
              ) : (
                <button style={{ ...btn, fontWeight: 700, minWidth: 140, background: PINK, borderColor: PINK, color: "#fff" }} onClick={startSolo}>▶ スタート（3・2・1）</button>
              )}
            </div>
            {/* 頭出しのズレを微調整。インスタ等と手動で合わせた後の追い込み用。 */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#9aa3b0", width: "100%", maxWidth: 420 }}>
              <span style={{ flex: "0 0 auto" }}>ズレ調整</span>
              <input type="range" min={-1000} max={1000} step={10} value={offsetMs} onChange={e => setOffsetMs(Number(e.target.value))} style={{ flex: 1, accentColor: PINK }} />
              <span style={{ flex: "0 0 auto", width: 64, textAlign: "right", color: "#cbd2dc", fontVariantNumeric: "tabular-nums" }}>{offsetMs > 0 ? "+" : ""}{offsetMs}ms</span>
            </label>
            <p style={{ fontSize: 11, color: "#6b7480", margin: 0, textAlign: "center", maxWidth: 420 }}>動画（インスタ等）の頭と「スタート」を合わせて押す。ズレてたらスライダーで前後に。＋は遅らせる。</p>
          </>
        )}
      </div>
    </div>
  );
}
