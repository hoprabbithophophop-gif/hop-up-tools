// ハイ！テンション 振り練習ドリル(パターンA) — 開発用/試作
//
// 方式: パッドを3×3の9ゾーンに分割し、画面に付けたままなぞる指の
//       「ゾーン通過列」で判定(practiceEngine.ts)。スワイプ方向判定ではない。
//       上にLIVE/MVを切替できる動画、下にタッチパッド。
//       動画ごとに「フレーズ開始時刻(アンカー)」を持ち、〔この瞬間を開始に〕で設定/微調整できる。
//       公開しない隠しルート(/hi-tension/practice)。
import { useEffect, useMemo, useRef, useState } from "react";
import YouTubePlayer, { type YouTubePlayerApi } from "./components/YouTubePlayer";
import { A_STEPS, A_BPM, PRACTICE_VIDEOS, INTRO_TEXT } from "./choreoA";
import {
  TUNING, ChoreoJudge, buildTimeline, phraseLenMs, nextZone, zoneRect, stepText,
  type ZoneId, type TimedStep,
} from "./practiceEngine";

const PINK = "#da1884";
const GREEN = "rgba(80,220,140,0.95)";
const ANCHOR_KEY = "hi_tension:practice_anchors";

function loadAnchors(): Record<string, number | null> {
  const base: Record<string, number | null> = {};
  for (const v of PRACTICE_VIDEOS) base[v.id] = v.defaultAnchorMs;
  try {
    const raw = localStorage.getItem(ANCHOR_KEY);
    if (raw) { const o = JSON.parse(raw); for (const k in o) if (typeof o[k] === "number") base[k] = o[k]; }
  } catch { /* ignore */ }
  return base;
}

/** 相対時刻 tMs が本来の区間に入っているステップindex(なければ直前) */
function stepIndexAt(timeline: TimedStep[], tMs: number): number {
  let idx = 0;
  for (let i = 0; i < timeline.length; i++) { if (timeline[i].startMs <= tMs) idx = i; else break; }
  return idx;
}

export default function HiTensionPracticePage() {
  const playerRef = useRef<YouTubePlayerApi>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const userPtRef = useRef<{ x: number; y: number } | null>(null);
  const zoneRef = useRef<ZoneId | null>(null);
  const seekingRef = useRef(false);
  const lastSeekTryRef = useRef(0);

  const [videoId, setVideoId] = useState(PRACTICE_VIDEOS[0].id);
  const [anchors, setAnchors] = useState<Record<string, number | null>>(loadAnchors);
  const [started, setStarted] = useState(false);
  const [rate, setRate] = useState(1);
  const [stepIdx, setStepIdx] = useState(0);
  const [, setSig] = useState("");
  const [msg, setMsg] = useState("");

  const anchor = anchors[videoId] ?? null;

  const timeline = useMemo(() => buildTimeline(A_STEPS, A_BPM, TUNING), []);
  const totalMs = useMemo(() => phraseLenMs(A_STEPS, A_BPM), []);
  const judgeRef = useRef<ChoreoJudge | null>(null);
  if (!judgeRef.current) judgeRef.current = new ChoreoJudge(timeline, TUNING);

  // draw用に最新値をrefへ
  const anchorRef = useRef(anchor);
  const startedRef = useRef(started);
  useEffect(() => { anchorRef.current = anchor; }, [anchor]);
  useEffect(() => { startedRef.current = started; }, [started]);

  const persistAnchors = (next: Record<string, number | null>) => {
    try { localStorage.setItem(ANCHOR_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const selectVideo = (id: string) => {
    if (id === videoId) return;
    setVideoId(id);
    setStarted(false);
    seekingRef.current = false;
    judgeRef.current?.reset();
    setMsg("");
  };

  const start = () => {
    const p = playerRef.current; if (!p) return;
    if (anchor == null) { setMsg("先にフレーズの開始位置を設定してね（下の〔この瞬間を開始に〕）"); return; }
    setStarted(true);
    judgeRef.current?.reset();
    p.play();
    p.seekTo(anchor / 1000);
  };
  const restart = () => {
    const p = playerRef.current; if (!p || anchor == null) return;
    seekingRef.current = false;
    judgeRef.current?.reset();
    p.seekTo(anchor / 1000);
    p.play();
  };
  const setAnchorHere = () => {
    const p = playerRef.current; if (!p) return;
    const t = Math.round(p.getCurrentTime() * 1000);
    setAnchors(prev => { const next = { ...prev, [videoId]: t }; persistAnchors(next); return next; });
    judgeRef.current?.reset();
    setMsg(`開始位置を ${(t / 1000).toFixed(2)}s に設定したよ`);
  };
  const changeRate = (r: number) => { try { playerRef.current?.setPlaybackRate(r); } catch { /* ignore */ } setRate(r); };

  // 指の位置
  const ptFrom = (e: React.PointerEvent) => {
    const pad = padRef.current; if (!pad) return null;
    const r = pad.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const onDown = (e: React.PointerEvent) => { try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ } userPtRef.current = ptFrom(e); };
  const onMove = (e: React.PointerEvent) => { if (userPtRef.current) userPtRef.current = ptFrom(e); };
  const onUp = () => { userPtRef.current = null; zoneRef.current = null; };

  // 描画＋ループ＋判定
  useEffect(() => {
    let raf = 0;
    const canvas = canvasRef.current, pad = padRef.current;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      if (!canvas || !pad) return;
      const r = pad.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (pad) ro.observe(pad);

    const fillZone = (ctx: CanvasRenderingContext2D, W: number, H: number, z: ZoneId, style: string) => {
      const r = zoneRect(z);
      ctx.fillStyle = style;
      ctx.fillRect(r.x0 * W, r.y0 * H, (r.x1 - r.x0) * W, (r.y1 - r.y0) * H);
    };
    const strokeZone = (ctx: CanvasRenderingContext2D, W: number, H: number, z: ZoneId, style: string, w: number) => {
      const r = zoneRect(z);
      ctx.strokeStyle = style; ctx.lineWidth = w;
      ctx.strokeRect(r.x0 * W + w / 2, r.y0 * H + w / 2, (r.x1 - r.x0) * W - w, (r.y1 - r.y0) * H - w);
    };
    const zoneCenter = (z: ZoneId, W: number, H: number) => {
      const r = zoneRect(z);
      return { x: ((r.x0 + r.x1) / 2) * W, y: ((r.y0 + r.y1) / 2) * H };
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!canvas) return;
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // 3×3グリッド線
      ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1 * dpr;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo((i / 3) * W, 0); ctx.lineTo((i / 3) * W, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (i / 3) * H); ctx.lineTo(W, (i / 3) * H); ctx.stroke();
      }

      // 現在ゾーン(指)
      const u = userPtRef.current;
      let zone: ZoneId | null = null;
      if (u) {
        zone = nextZone(zoneRef.current, u.x, u.y, TUNING.hysteresis);
        zoneRef.current = zone;
        fillZone(ctx, W, H, zone, "rgba(255,255,255,0.07)");
      }

      const anc = anchorRef.current;
      const judge = judgeRef.current;
      if (anc == null || !judge) return;

      // 時刻・ループ
      const p = playerRef.current;
      const rawMs = p ? p.getCurrentTime() * 1000 : anc;
      const loopEnd = anc + totalMs;
      if (rawMs >= loopEnd - 20) {
        if (!seekingRef.current && startedRef.current) { seekingRef.current = true; judge.reset(); p?.seekTo(anc / 1000); }
      } else if (rawMs < anc + 400) {
        seekingRef.current = false;
      }
      // スタート時にプレイヤー未準備で seekTo が無視されると0秒から流れて
      // アンカー手前に居続けるので、手前にいたらアンカーへ寄せ直す(自己修復)
      if (startedRef.current && rawMs < anc - 60) {
        const now = performance.now();
        if (now - lastSeekTryRef.current > 500) { lastSeekTryRef.current = now; judge.reset(); p?.seekTo(anc / 1000); }
      }
      const rel = Math.min(Math.max(rawMs - anc, 0), totalMs);

      // 判定(再生開始後のみ。ループのシーク戻り待ち中は時刻が末尾に
      // 張り付いて全ステップが誤miss確定するので止める)
      if (startedRef.current && !seekingRef.current) judge.update(rel, zone);

      // 現在ステップのターゲット表示
      const idx = stepIndexAt(judge.timeline, rel);
      const s = judge.timeline[idx];
      const st = judge.states[idx];
      const okColor = "rgba(80,220,140,";
      const pinkColor = "rgba(218,24,132,";
      if (s.def.kind === "trace") {
        s.def.zones.forEach((z, j) => {
          const passed = st.result === "ok" || j < st.traceIdx;
          if (passed) {
            fillZone(ctx, W, H, z, okColor + "0.30)");
          } else if (j === st.traceIdx && st.result === "pending") {
            fillZone(ctx, W, H, z, pinkColor + "0.22)");
            strokeZone(ctx, W, H, z, PINK, 3 * dpr);
          } else {
            strokeZone(ctx, W, H, z, pinkColor + "0.45)", 2 * dpr);
          }
          const c = zoneCenter(z, W, H);
          ctx.fillStyle = passed ? GREEN : "rgba(255,255,255,0.75)";
          ctx.font = `700 ${16 * dpr}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(String(j + 1), c.x, c.y - (10 * dpr));
        });
      } else if (s.def.kind === "hold") {
        const good = st.result === "ok" || (st.result === "pending" && !st.holdViolated);
        fillZone(ctx, W, H, s.def.zone, (good ? okColor : "rgba(255,90,90,") + "0.28)");
        strokeZone(ctx, W, H, s.def.zone, good ? GREEN : "rgba(255,90,90,0.9)", 3 * dpr);
      } else {
        const [a, b] = s.def.pair;
        const done = st.result === "ok";
        for (const z of [a, b]) {
          fillZone(ctx, W, H, z, (done ? okColor : pinkColor) + "0.20)");
          strokeZone(ctx, W, H, z, done ? GREEN : PINK, 3 * dpr);
        }
        const ca = zoneCenter(a, W, H), cb = zoneCenter(b, W, H);
        const n = s.def.minCrossings ?? TUNING.wiggleDefaultN;
        ctx.fillStyle = done ? GREEN : "#fff";
        ctx.font = `800 ${18 * dpr}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(`${Math.min(st.crossings, n)}/${n}`, (ca.x + cb.x) / 2, (ca.y + cb.y) / 2);
      }

      // 指ドット
      if (u) {
        ctx.beginPath(); ctx.arc(u.x * W, u.y * H, 11 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = PINK; ctx.fill();
        ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "#fff"; ctx.stroke();
      }

      // ストリップ再描画のシグナル(変化時だけstate更新)
      setStepIdx(prev => (prev === idx ? prev : idx));
      const sigNow = judge.states.map(x => x.result[0]).join("") + ":" + st.traceIdx + ":" + st.crossings;
      setSig(prev => (prev === sigNow ? prev : sigNow));
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [timeline, totalMs]);

  const judge = judgeRef.current;
  const curStep = timeline[Math.min(stepIdx, timeline.length - 1)];
  const curState = judge ? judge.states[Math.min(stepIdx, timeline.length - 1)] : null;

  const btn: React.CSSProperties = { fontSize: 14, padding: "8px 12px", borderRadius: 8, border: "1px solid #444", background: "#1a1a1a", color: "#eee", cursor: "pointer" };
  const seg = (active: boolean): React.CSSProperties => ({ ...btn, background: active ? PINK : "#1a1a1a", borderColor: active ? PINK : "#444", color: active ? "#fff" : "#bbb", fontWeight: active ? 700 : 400 });

  const chipColor = (i: number): { bg: string; fg: string } => {
    const r = judge?.states[i].result ?? "pending";
    if (i === stepIdx) return { bg: PINK, fg: "#fff" };
    if (r === "ok") return { bg: "#143", fg: GREEN };
    if (r === "miss") return { bg: "#311", fg: "#e88" };
    return { bg: "#1a1a1a", fg: "#888" };
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: 12, color: "#eee", background: "#000", minHeight: "100dvh", fontFamily: "Inter, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 16, fontWeight: 700, margin: "4px 0 8px" }}>振り練習：パターンA <span style={{ fontSize: 12, color: "#888" }}>(試作)</span></h1>
      {INTRO_TEXT && <p style={{ fontSize: 14, color: "#ccc", margin: "0 0 8px", lineHeight: 1.6 }}>{INTRO_TEXT}</p>}

      {/* 動画切替 */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "#999" }}>動画</span>
        {PRACTICE_VIDEOS.map(v => (
          <button key={v.id} style={seg(videoId === v.id)} onClick={() => selectVideo(v.id)}>
            {v.label}{anchors[v.id] == null ? " (未設定)" : ""}
          </button>
        ))}
      </div>

      <div style={{ position: "relative" }}>
        <YouTubePlayer ref={playerRef} videoId={videoId} onEnded={() => { /* ループ運用 */ }} />
        {!started && (
          <button onClick={start} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", fontSize: 18, fontWeight: 700, cursor: "pointer" }}>▶ 練習スタート</button>
        )}
      </div>

      {anchor == null && (
        <p style={{ fontSize: 12, color: "#f3a", margin: "8px 2px 0", lineHeight: 1.5 }}>
          この動画はフレーズ開始位置が未設定。再生してフレーズが始まる瞬間に〔この瞬間を開始に〕を押してね。
        </p>
      )}

      {/* 現在ステップ表示(高さ固定) */}
      <div style={{ height: 32, margin: "10px 2px 4px", overflow: "hidden" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: curState?.result === "ok" ? GREEN : PINK, letterSpacing: 0.5, whiteSpace: "nowrap", lineHeight: "32px" }}>
          {stepIdx + 1}. {stepText(curStep.def, TUNING)}
        </div>
      </div>

      {/* ステップの順番ストリップ */}
      <div style={{ display: "flex", gap: 4, overflowX: "auto", padding: "2px 0 8px" }}>
        {timeline.map((_, i) => {
          const c = chipColor(i);
          return (
            <span key={i} style={{
              flex: "0 0 auto", minWidth: 24, padding: "2px 4px", textAlign: "center", fontSize: 13,
              borderRadius: 6, background: c.bg, color: c.fg, fontWeight: i === stepIdx ? 800 : 500,
            }}>{i + 1}</span>
          );
        })}
      </div>

      {/* タッチパッド */}
      <div ref={padRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", background: "#0c0c0c", border: "2px solid #333", borderRadius: 10, touchAction: "none", userSelect: "none", overflow: "hidden" }}>
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
        <span style={{ position: "absolute", top: 6, left: "50%", transform: "translateX(-50%)", fontSize: 11, color: "#555", pointerEvents: "none" }}>頭の上</span>
        <span style={{ position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)", fontSize: 11, color: "#555", pointerEvents: "none" }}>前/下</span>
        <span style={{ position: "absolute", top: "50%", left: 6, transform: "translateY(-50%)", fontSize: 11, color: "#555", pointerEvents: "none" }}>左</span>
        <span style={{ position: "absolute", top: "50%", right: 6, transform: "translateY(-50%)", fontSize: 11, color: "#555", pointerEvents: "none" }}>右</span>
      </div>

      {/* 操作 */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "10px 0" }}>
        <span style={{ fontSize: 12, color: "#999" }}>速さ</span>
        {[0.5, 0.75, 1].map(r => (<button key={r} style={seg(rate === r)} onClick={() => changeRate(r)}>{r}x</button>))}
        <button style={{ ...btn, marginLeft: "auto" }} onClick={restart}>最初から</button>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "0 0 4px" }}>
        <button style={{ ...btn, borderColor: PINK, color: PINK }} onClick={setAnchorHere}>▼ この瞬間を開始に</button>
        <span style={{ fontSize: 12, color: "#666" }}>
          開始位置: {anchor == null ? "未設定" : `${(anchor / 1000).toFixed(2)}s`}
        </span>
      </div>
      {msg && <p style={{ fontSize: 12, color: PINK, margin: "4px 0 0" }}>{msg}</p>}
    </div>
  );
}
