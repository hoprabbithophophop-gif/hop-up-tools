// ハイ！テンション 振り練習ドリル(パターンA) — 開発用/試作
//
// 方式: パッドを3×3の9ゾーンに分割し、画面に付けたままなぞる指の
//       「ゾーン通過列」で判定(practiceEngine.ts)。スワイプ方向判定ではない。
//       曲は通しで再生し、パターンAの各出現(choreoA.tsのphraseStartsMs)の前に
//       拍同期のカウントインで予告 → 出現中だけ判定する。
//       1画面固定レイアウト(スクロールなし)。公開しない隠しルート(/hi-tension/practice)。
import { useEffect, useMemo, useRef, useState } from "react";
import YouTubePlayer, { type YouTubePlayerApi } from "./components/YouTubePlayer";
import { A_STEPS, A_BPM, A_OFFSET_MS, PRACTICE_VIDEOS, INTRO_TEXT } from "./choreoA";
import {
  TUNING, ChoreoJudge, buildTimeline, phraseLenMs, nextZone, zoneRect, stepText,
  type ZoneId, type TimedStep,
} from "./practiceEngine";

const PINK = "#da1884";
const GREEN = "rgba(80,220,140,0.95)";
const BEAT_MS = 60000 / A_BPM;
/** カウントイン: 予告バナーを出す拍数 / 数字(5,6,7,8)を出す拍数 */
const COUNTIN_BEATS = 8;
const COUNTIN_NUM_BEATS = 4;

/** 相対時刻 tMs が本来の区間に入っているステップindex(なければ直前) */
function stepIndexAt(timeline: TimedStep[], tMs: number): number {
  let idx = 0;
  for (let i = 0; i < timeline.length; i++) { if (timeline[i].startMs <= tMs) idx = i; else break; }
  return idx;
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Phase =
  | { kind: "idle"; nextStartMs: number | null }
  | { kind: "countin"; occ: number; beatsLeft: number }
  | { kind: "playing"; occ: number; relMs: number };

export default function HiTensionPracticePage() {
  const playerRef = useRef<YouTubePlayerApi>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const userPtRef = useRef<{ x: number; y: number } | null>(null);
  const zoneRef = useRef<ZoneId | null>(null);
  const lastOccRef = useRef(-1);

  const [videoId, setVideoId] = useState(PRACTICE_VIDEOS[0].id);
  const [started, setStarted] = useState(false);
  const [rate, setRate] = useState(1);
  const [stepIdx, setStepIdx] = useState(0);
  const [phaseLabel, setPhaseLabel] = useState<"idle" | "countin" | "playing">("idle");
  const [nextStartMs, setNextStartMs] = useState<number | null>(null);
  const [, setSig] = useState("");

  const video = PRACTICE_VIDEOS.find(v => v.id === videoId) ?? PRACTICE_VIDEOS[0];
  const starts = useMemo(() => video.phraseStartsMs.map(s => s + A_OFFSET_MS), [video]);

  const timeline = useMemo(() => buildTimeline(A_STEPS, A_BPM, TUNING), []);
  const totalMs = useMemo(() => phraseLenMs(A_STEPS, A_BPM), []);
  const judgeRef = useRef<ChoreoJudge | null>(null);
  if (!judgeRef.current) judgeRef.current = new ChoreoJudge(timeline, TUNING);

  const startedRef = useRef(started);
  const startsRef = useRef(starts);
  useEffect(() => { startedRef.current = started; }, [started]);
  useEffect(() => { startsRef.current = starts; }, [starts]);

  // ページのスクロールを止める(なぞり中に画面が滑るのを防ぐ)
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.documentElement.style.overscrollBehavior = prevOverscroll;
    };
  }, []);

  const selectVideo = (id: string) => {
    if (id === videoId) return;
    setVideoId(id);
    setStarted(false);
    lastOccRef.current = -1;
    judgeRef.current?.reset();
  };

  const start = () => {
    const p = playerRef.current; if (!p) return;
    setStarted(true);
    lastOccRef.current = -1;
    judgeRef.current?.reset();
    p.play();
  };
  const restart = () => {
    const p = playerRef.current; if (!p) return;
    lastOccRef.current = -1;
    judgeRef.current?.reset();
    p.seekTo(0);
    p.play();
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

  // 現在のフェーズ(待ち/カウントイン/出現中)を時刻から求める
  const phaseAt = (tMs: number): Phase => {
    const ss = startsRef.current;
    for (let i = 0; i < ss.length; i++) {
      const rel = tMs - ss[i];
      if (rel >= 0 && rel < totalMs) return { kind: "playing", occ: i, relMs: rel };
    }
    for (let i = 0; i < ss.length; i++) {
      const until = ss[i] - tMs;
      if (until > 0 && until <= COUNTIN_BEATS * BEAT_MS) {
        return { kind: "countin", occ: i, beatsLeft: Math.ceil(until / BEAT_MS) };
      }
    }
    const next = ss.find(s => s > tMs);
    return { kind: "idle", nextStartMs: next ?? null };
  };

  // 描画＋判定
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
      ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 1 * dpr;
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
        fillZone(ctx, W, H, zone, "rgba(255,255,255,0.06)");
      }

      const judge = judgeRef.current;
      const p = playerRef.current;
      if (!judge || !p) return;

      const tMs = p.getCurrentTime() * 1000;
      const phase = startedRef.current ? phaseAt(tMs) : ({ kind: "idle", nextStartMs: startsRef.current[0] ?? null } as Phase);

      // 出現の切り替わりで判定をリセット(チップもまっさらに)
      if (phase.kind !== "idle" && phase.occ !== lastOccRef.current) {
        judge.reset();
        lastOccRef.current = phase.occ;
      }

      let idx = 0;
      if (phase.kind === "playing") {
        judge.update(phase.relMs, zone);
        idx = stepIndexAt(judge.timeline, phase.relMs);
        const s = judge.timeline[idx];

        // ターゲット表示: 薄い→濃い(終点が一番明るい)。通過済みの強調はしない。
        if (s.def.kind === "trace") {
          const n = s.def.zones.length;
          s.def.zones.forEach((z, j) => {
            const a = n === 1 ? 0.40 : 0.08 + (0.32 * j) / (n - 1);
            fillZone(ctx, W, H, z, `rgba(218,24,132,${a.toFixed(3)})`);
            if (j === n - 1) strokeZone(ctx, W, H, z, PINK, 3 * dpr);
          });
        } else if (s.def.kind === "hold") {
          fillZone(ctx, W, H, s.def.zone, "rgba(218,24,132,0.40)");
          strokeZone(ctx, W, H, s.def.zone, PINK, 3 * dpr);
        } else {
          const [a, b] = s.def.pair;
          const st = judge.states[idx];
          const nReq = s.def.minCrossings ?? TUNING.wiggleDefaultN;
          for (const z of [a, b]) {
            fillZone(ctx, W, H, z, "rgba(218,24,132,0.30)");
            strokeZone(ctx, W, H, z, PINK, 3 * dpr);
          }
          const ca = zoneCenter(a, W, H), cb = zoneCenter(b, W, H);
          ctx.fillStyle = st.result === "ok" ? GREEN : "#fff";
          ctx.font = `800 ${16 * dpr}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(`${Math.min(st.crossings, nReq)}/${nReq}`, (ca.x + cb.x) / 2, (ca.y + cb.y) / 2);
        }
      } else if (phase.kind === "countin" && phase.beatsLeft <= COUNTIN_NUM_BEATS) {
        // 拍同期カウントイン 5,6,7,8
        const num = 5 + (COUNTIN_NUM_BEATS - phase.beatsLeft);
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = `800 ${Math.min(W, H) * 0.45}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(num), W / 2, H / 2);
      }

      // 指ドット
      if (u) {
        ctx.beginPath(); ctx.arc(u.x * W, u.y * H, 11 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = PINK; ctx.fill();
        ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "#fff"; ctx.stroke();
      }

      // React側の表示更新(変化時のみ)
      setPhaseLabel(prev => (prev === phase.kind ? prev : phase.kind));
      setNextStartMs(prev => {
        const v = phase.kind === "idle" ? phase.nextStartMs : null;
        return prev === v ? prev : v;
      });
      setStepIdx(prev => (prev === idx ? prev : idx));
      const st = judge.states[idx];
      const sigNow = judge.states.map(x => x.result[0]).join("") + ":" + st.traceIdx + ":" + st.crossings + ":" + (phase.kind === "countin" ? phase.beatsLeft : "");
      setSig(prev => (prev === sigNow ? prev : sigNow));
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, totalMs]);

  const judge = judgeRef.current;
  const curStep = timeline[Math.min(stepIdx, timeline.length - 1)];
  const curState = judge ? judge.states[Math.min(stepIdx, timeline.length - 1)] : null;

  const btn: React.CSSProperties = { fontSize: 14, padding: "6px 12px", borderRadius: 8, border: "1px solid #444", background: "#1a1a1a", color: "#eee", cursor: "pointer" };
  const seg = (active: boolean): React.CSSProperties => ({ ...btn, background: active ? PINK : "#1a1a1a", borderColor: active ? PINK : "#444", color: active ? "#fff" : "#bbb", fontWeight: active ? 700 : 400 });

  const chipColor = (i: number): { bg: string; fg: string } => {
    const r = judge?.states[i].result ?? "pending";
    if (phaseLabel === "playing" && i === stepIdx) return { bg: PINK, fg: "#fff" };
    if (r === "ok") return { bg: "#143", fg: GREEN };
    if (r === "miss") return { bg: "#311", fg: "#e88" };
    return { bg: "#1a1a1a", fg: "#888" };
  };

  // ステータス行(高さ固定)の中身
  let statusNode: React.ReactNode = null;
  if (phaseLabel === "countin") {
    statusNode = <span style={{ color: "#fff", fontWeight: 800 }}>もうすぐパターンA！</span>;
  } else if (phaseLabel === "playing") {
    statusNode = (
      <span style={{ color: curState?.result === "ok" ? GREEN : PINK, fontWeight: 800 }}>
        {stepIdx + 1}. {stepText(curStep.def, TUNING)}
      </span>
    );
  } else if (started && nextStartMs != null) {
    statusNode = <span style={{ color: "#888" }}>次のパターンA {fmtTime(nextStartMs)}</span>;
  }

  return (
    <div style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto", padding: "8px 12px", color: "#eee", background: "#000", fontFamily: "Inter, system-ui, sans-serif", touchAction: "none" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flex: "0 0 auto" }}>
        <h1 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>振り練習：パターンA <span style={{ fontSize: 11, color: "#888" }}>(試作)</span></h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {PRACTICE_VIDEOS.length > 1 && PRACTICE_VIDEOS.map(v => (
            <button key={v.id} style={{ ...seg(videoId === v.id), fontSize: 12, padding: "4px 8px" }} onClick={() => selectVideo(v.id)}>{v.label}</button>
          ))}
        </div>
      </div>

      <div style={{ position: "relative", flex: "0 0 auto" }}>
        <YouTubePlayer ref={playerRef} videoId={videoId} onEnded={() => setStarted(false)} />
        {!started && (
          <button onClick={start} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", fontSize: 18, fontWeight: 700, cursor: "pointer", padding: 16 }}>
            {INTRO_TEXT && <span style={{ fontSize: 14, fontWeight: 400, color: "#ccc", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{INTRO_TEXT}</span>}
            <span>▶ 練習スタート</span>
          </button>
        )}
      </div>

      {/* ステータス行(高さ固定) */}
      <div style={{ height: 28, margin: "6px 0 2px", fontSize: 16, lineHeight: "28px", whiteSpace: "nowrap", overflow: "hidden", flex: "0 0 auto" }}>
        {statusNode}
      </div>

      {/* ステップの順番ストリップ */}
      <div style={{ display: "flex", gap: 3, overflowX: "hidden", padding: "0 0 6px", flex: "0 0 auto" }}>
        {timeline.map((_, i) => {
          const c = chipColor(i);
          return (
            <span key={i} style={{
              flex: "1 1 0", minWidth: 0, padding: "2px 0", textAlign: "center", fontSize: 11,
              borderRadius: 4, background: c.bg, color: c.fg, fontWeight: phaseLabel === "playing" && i === stepIdx ? 800 : 500,
            }}>{i + 1}</span>
          );
        })}
      </div>

      {/* タッチパッド(残り高さ全部) */}
      <div ref={padRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        style={{ position: "relative", flex: "1 1 auto", minHeight: 0, background: "#0c0c0c", border: "2px solid #333", borderRadius: 10, touchAction: "none", userSelect: "none", overflow: "hidden" }}>
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
        <span style={{ position: "absolute", top: 4, left: "50%", transform: "translateX(-50%)", fontSize: 11, color: "#555", pointerEvents: "none" }}>頭の上</span>
        <span style={{ position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)", fontSize: 11, color: "#555", pointerEvents: "none" }}>前/下</span>
        <span style={{ position: "absolute", top: "50%", left: 6, transform: "translateY(-50%)", fontSize: 11, color: "#555", pointerEvents: "none" }}>左</span>
        <span style={{ position: "absolute", top: "50%", right: 6, transform: "translateY(-50%)", fontSize: 11, color: "#555", pointerEvents: "none" }}>右</span>
      </div>

      {/* 操作 */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "8px 0 0", flex: "0 0 auto" }}>
        <span style={{ fontSize: 12, color: "#999" }}>速さ</span>
        {[0.5, 0.75, 1].map(r => (<button key={r} style={seg(rate === r)} onClick={() => changeRate(r)}>{r}x</button>))}
        <button style={{ ...btn, marginLeft: "auto" }} onClick={restart}>最初から</button>
      </div>
    </div>
  );
}
