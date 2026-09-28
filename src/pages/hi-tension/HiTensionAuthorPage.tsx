// ハイ！テンション 振り付け入力ツール（開発用・非公開）
//
// 目的: 「真似したい右手の動き」を、動画の再生時刻に紐づけて Hop が実際になぞって記録し、
//       その軌跡データ(JSON)を書き出して Claude と共有するためのオーサリング画面。
//       公開ツールではない。トップの TOOLS 一覧やナビには載せない隠しルート (/hi-tension/author)。
//
// 仕組み: 上に LIVE 動画、下にタッチパッド(体の前の空間に見立てる)。
//         録画中、指を置いている間だけ「動画の現在時刻 + 指の位置(0〜1正規化)」を ~30Hz で記録する。
//         動画が進んでいない(停止/逆戻り)間は記録しない＝拍とズレない。
import { useEffect, useRef, useState } from "react";
import YouTubePlayer, { type YouTubePlayerApi } from "./components/YouTubePlayer";
import { VIDEO_ID } from "./data";

type Pt = [number, number, number]; // [t_ms, x(0..1 左→右), y(0..1 上→下)]
type Stroke = Pt[];
type Pattern = "A" | "B";
type Recordings = Record<Pattern, Stroke[]>;

const LS_KEY = "hi_tension:author";
const SAMPLE_MS = 33; // ~30Hz
const PINK = "#da1884";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function loadRecordings(): Recordings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && o.patterns) {
        return { A: o.patterns.A ?? [], B: o.patterns.B ?? [] };
      }
    }
  } catch { /* 壊れていたら空で始める */ }
  return { A: [], B: [] };
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.25);
  ctx.strokeStyle = "#fff";
  ctx.stroke();
}

/** 指定時刻 t(ms) に最も近い記録点を、許容差 tol(ms) 内で探す。確認再生のドット用。 */
function nearestPoint(strokes: Stroke[], t: number, tol: number): Pt | null {
  let best: Pt | null = null;
  let bestD = tol;
  for (const s of strokes) {
    for (const p of s) {
      const d = Math.abs(p[0] - t);
      if (d <= bestD) { bestD = d; best = p; }
    }
  }
  return best;
}

function countPoints(strokes: Stroke[]): number {
  return strokes.reduce((sum, s) => sum + s.length, 0);
}

export default function HiTensionAuthorPage() {
  const playerRef = useRef<YouTubePlayerApi>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const recordingsRef = useRef<Recordings>(loadRecordings());

  const [pattern, setPattern] = useState<Pattern>("A");
  const patternRef = useRef<Pattern>("A");
  useEffect(() => { patternRef.current = pattern; }, [pattern]);

  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  useEffect(() => { recordingRef.current = recording; }, [recording]);

  const pointerDownRef = useRef(false);
  const latestPointerRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const currentStrokeRef = useRef<Stroke | null>(null);
  const lastTRef = useRef(-1);

  const [, force] = useState(0);
  const bump = () => force(v => v + 1);
  const [timeSec, setTimeSec] = useState(0);
  const [rate, setRate] = useState(1);
  const [msg, setMsg] = useState("");

  const save = () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ videoId: VIDEO_ID, patterns: recordingsRef.current }));
    } catch { /* 容量超過などは無視(ローカルのみのメモ) */ }
  };

  // ---- ポインタ(指/マウス)入力 ----
  const ptFromEvent = (e: React.PointerEvent) => {
    const pad = padRef.current;
    if (!pad) return { x: 0.5, y: 0.5 };
    const r = pad.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    return { x, y };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    latestPointerRef.current = ptFromEvent(e);
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pointerDownRef.current = true;
    if (recordingRef.current) {
      lastTRef.current = -1; // 新しいストロークは時刻監視をリセット(別箇所から録り直しても弾かれない)
      const stroke: Stroke = [];
      currentStrokeRef.current = stroke;
      recordingsRef.current[patternRef.current].push(stroke);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointerDownRef.current) return;
    latestPointerRef.current = ptFromEvent(e);
  };

  const endPointer = () => {
    if (!pointerDownRef.current) return;
    pointerDownRef.current = false;
    // 空ストローク(タップだけで点が乗らなかった)は捨てる
    const st = currentStrokeRef.current;
    if (st && st.length === 0) {
      const arr = recordingsRef.current[patternRef.current];
      if (arr[arr.length - 1] === st) arr.pop();
    }
    currentStrokeRef.current = null;
    if (recordingRef.current) { save(); bump(); }
  };

  // ---- 録画サンプリング(動画時刻に同期) ----
  useEffect(() => {
    const id = setInterval(() => {
      if (!recordingRef.current || !pointerDownRef.current) return;
      const player = playerRef.current;
      if (!player) return;
      const t = Math.round(player.getCurrentTime() * 1000);
      if (t <= lastTRef.current) return; // 動画が進んでない→拍がズレるので記録しない
      lastTRef.current = t;
      const { x, y } = latestPointerRef.current;
      currentStrokeRef.current?.push([t, round3(x), round3(y)]);
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, []);

  // ---- 描画ループ(軌跡 + 現在位置/確認ドット) ----
  useEffect(() => {
    let raf = 0;
    const canvas = canvasRef.current;
    const pad = padRef.current;
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

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const strokes = recordingsRef.current[patternRef.current];

      // 記録済みの軌跡(薄く)
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = "rgba(218,24,132,0.35)";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const s of strokes) {
        if (s.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(s[0][1] * W, s[0][2] * H);
        for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][1] * W, s[i][2] * H);
        ctx.stroke();
      }

      if (recordingRef.current && pointerDownRef.current) {
        // 録画中: いま指がある位置(濃いピンク)
        const { x, y } = latestPointerRef.current;
        dot(ctx, x * W, y * H, 11 * dpr, PINK);
      } else {
        // 確認再生: 動画の現在時刻に対応する記録点を動かす
        const player = playerRef.current;
        if (player) {
          const t = player.getCurrentTime() * 1000;
          const p = nearestPoint(strokes, t, 200);
          if (p) dot(ctx, p[1] * W, p[2] * H, 11 * dpr, "#ff5fb0");
        }
      }
    };
    draw();

    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // ---- 操作 ----
  const toggleRecord = () => {
    setRecording(r => {
      const next = !r;
      recordingRef.current = next;
      if (!next) save();
      return next;
    });
    setMsg("");
  };

  const changeRate = (r: number) => {
    try { playerRef.current?.setPlaybackRate(r); } catch { /* ignore */ }
    setRate(r);
  };

  const clearPattern = () => {
    recordingsRef.current[patternRef.current] = [];
    save();
    bump();
    setMsg(`パターン${patternRef.current} を消したよ`);
  };

  const exportData = async () => {
    const json = JSON.stringify({ videoId: VIDEO_ID, patterns: recordingsRef.current });
    let copied = false;
    try { await navigator.clipboard.writeText(json); copied = true; } catch { /* ignore */ }
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "hi-tension-choreo.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
    setMsg(copied ? "コピー＆ダウンロードしたよ。チャットに貼るかファイルを渡してね" : "ダウンロードしたよ");
  };

  const onLoadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const o = JSON.parse(String(reader.result));
        recordingsRef.current = { A: o.patterns?.A ?? [], B: o.patterns?.B ?? [] };
        save();
        bump();
        setMsg("読み込んだ");
      } catch {
        setMsg("読み込み失敗(ファイル形式を確認)");
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  const ptCount = countPoints(recordingsRef.current[pattern]);

  // ---- スタイル ----
  const btn: React.CSSProperties = {
    fontSize: 14,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #444",
    background: "#1a1a1a",
    color: "#eee",
    cursor: "pointer",
  };
  const seg = (active: boolean): React.CSSProperties => ({
    ...btn,
    background: active ? PINK : "#1a1a1a",
    borderColor: active ? PINK : "#444",
    color: active ? "#fff" : "#bbb",
    fontWeight: active ? 700 : 400,
  });

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: 12, color: "#eee", background: "#000", minHeight: "100dvh", fontFamily: "Inter, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 16, fontWeight: 700, margin: "4px 0 2px" }}>振り付け入力ツール <span style={{ fontSize: 12, color: "#888" }}>(開発用・非公開)</span></h1>
      <p style={{ fontSize: 12, color: "#999", margin: "0 0 10px" }}>
        動画を再生しながら、下のエリアを右手の動きでなぞってね。動画の時刻ごとの位置が記録されるよ。
      </p>

      <YouTubePlayer ref={playerRef} videoId={VIDEO_ID} onEnded={() => { /* 末尾でも記録は続けたいので何もしない */ }} onTimeUpdate={(s) => setTimeSec(s)} />

      {/* 速度 */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "8px 0" }}>
        <span style={{ fontSize: 12, color: "#999" }}>速さ</span>
        {[0.25, 0.5, 1].map(r => (
          <button key={r} style={seg(rate === r)} onClick={() => changeRate(r)}>{r}x</button>
        ))}
        <span style={{ fontSize: 12, color: "#666", marginLeft: "auto" }}>{timeSec.toFixed(1)}s</span>
      </div>

      {/* タッチパッド */}
      <div
        ref={padRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "4 / 3",
          background: "#0c0c0c",
          border: recording ? `2px solid ${PINK}` : "2px solid #333",
          borderRadius: 10,
          touchAction: "none",
          userSelect: "none",
          overflow: "hidden",
        }}
      >
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
        {/* 空間ラベル */}
        <span style={{ position: "absolute", top: 6, left: "50%", transform: "translateX(-50%)", fontSize: 11, color: "#555", pointerEvents: "none" }}>頭の上</span>
        <span style={{ position: "absolute", top: "50%", left: 6, transform: "translateY(-50%)", fontSize: 11, color: "#555", pointerEvents: "none" }}>左</span>
        <span style={{ position: "absolute", top: "50%", right: 6, transform: "translateY(-50%)", fontSize: 11, color: "#555", pointerEvents: "none" }}>右</span>
        <span style={{ position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)", fontSize: 11, color: "#555", pointerEvents: "none" }}>胸/下</span>
      </div>

      {/* パターン切替 + 録画 */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "10px 0" }}>
        <span style={{ fontSize: 12, color: "#999" }}>パターン</span>
        <button style={seg(pattern === "A")} onClick={() => setPattern("A")}>A</button>
        <button style={seg(pattern === "B")} onClick={() => setPattern("B")}>B</button>
        <span style={{ fontSize: 12, color: "#666", marginLeft: 4 }}>{ptCount}点</span>
        <button
          style={{ ...btn, marginLeft: "auto", background: recording ? "#c01" : PINK, borderColor: recording ? "#c01" : PINK, color: "#fff", fontWeight: 700 }}
          onClick={toggleRecord}
        >
          {recording ? "■ 停止" : "● 録画"}
        </button>
      </div>

      {/* 書き出し・読み込み・消去 */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button style={btn} onClick={exportData}>書き出す(コピー+保存)</button>
        <label style={{ ...btn, display: "inline-block" }}>
          読み込む
          <input type="file" accept="application/json,.json" onChange={onLoadFile} style={{ display: "none" }} />
        </label>
        <button style={{ ...btn, color: "#e88", borderColor: "#633" }} onClick={clearPattern}>パターン{pattern}を消去</button>
      </div>

      {msg && <p style={{ fontSize: 12, color: PINK, margin: "10px 0 0" }}>{msg}</p>}

      <p style={{ fontSize: 11, color: "#666", margin: "14px 0 0", lineHeight: 1.6 }}>
        使い方: ①パターンA/Bを選ぶ → ②動画を再生(速さを落とすと楽) → ③「● 録画」→ ④下のエリアを右手の動きでなぞる(指を置いてる間だけ記録) → ⑤「■ 停止」。
        止めたあとに動画を再生すると、記録した動きがドットで再生されるので確認できる。良ければ「書き出す」。データは自動でこの端末に保存されるよ。
      </p>
    </div>
  );
}
