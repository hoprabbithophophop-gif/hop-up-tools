// コール練習クイズ（開発用・隠しルート /arigato-beat/quiz）
//
// 主役は「正しいタイミングで・正しいコールを出せるか」。声・マイクは使わず全部タップ。
//   - ステージプラクティス動画（コール答えが映らない）を流す。
//   - 上に /beat と同じタイムライン（中央プレイヘッド＋拍グリッド＋コールが拍幅のバーで右から流れる）。
//     これから来るコールは「？」でぼかし、通過して判定したコールは中身と正誤色で開示＝自分の出来が流れる。
//   - 下に候補ボタン（位置固定）。？が中央(拍)に来たら正しいコールを選ぶ。
//     ・普通のコール＝同尺の別コールを混ぜた選択肢。
//     ・オイ！／Fu の連打地帯＝専用の［オイ！］［Fu］2択（並び固定でリズムに集中）。
//   - 採点は「コール正誤 × タイミング精度」。流れは止めない。
//   - 終わったら結果画面：ミスを一覧→「5,6,7,8→ここ！」で正解タイミングを実演＋自分のズレ表示＋
//     「レクチャーで答えを見る」リンク（コールレクチャー動画の数小節前へ）。
import { useEffect, useMemo, useRef, useState } from "react";
import YouTubePlayer, { type YouTubePlayerApi } from "./components/YouTubePlayer";
import { ARIGATO_BEAT_CALLS, ARIGATO_BEAT_VIDEO, ARIGATO_BEAT_BPM } from "./arigatoBeatCalls";

const PINK = "#da1884";
const ARENA_BG = "radial-gradient(150% 85% at 50% -8%, #1b2030 0%, #0e1016 48%, #07080c 100%)";

// コールレクチャー動画（答え確認の飛び先）。ステージプラクティスと同テンポ・頭出しが少し遅いだけ。
const LECTURE_VIDEO = "xr7_Z5ibZMA";
const LECTURE_FIRST_CALL_SEC = 6.0; // レクチャー動画で最初のコールが鳴る時刻(hop実測0:06)。同テンポなのでfirstを合わせれば全体一致
const REVIEW_BARS = 2;          // 答え確認は「ミスの何小節前」から
const LEAD_BEATS = 2;           // 候補ボタンを拍の何拍前から出すか
const PERFECT_MS = 120;
const GOOD_MS = 260;
const MISS_TAIL = GOOD_MS / 1000 + 0.08; // この秒数を過ぎたら無タップ＝ミス確定

// タイムライン（/beat流用）
const Q_SPAN_SEC = 6;    // 可視秒数（拍ごとの山が分離して見える幅）
const Q_LANE_PITCH = 42; // レーン間隔

const CHANT_OI = "オイ！";
const CHANT_FU = "Fu";

type Call = { t: number; note: string; lenBeats: number };
type Verdict = "perfect" | "good" | "late" | "wrong" | "notap";
type Target = { call: Call; kind: "chant" | "normal"; answer: string; candidates: string[] };
type Result = { i: number; call: Call; chosen: string | null; errMs: number | null; verdict: Verdict };

// 本物のありがとビート採譜データを使う（quizは“遊ぶ製品”なので採譜のlocalStorageではなく確定データを読む）
function loadData(): { videoId: string; calls: Call[]; bpm: number } {
  const calls = [...ARIGATO_BEAT_CALLS].map(c => ({ t: c.t, note: c.note, lenBeats: c.lenBeats })).sort((a, b) => a.t - b.t);
  return { videoId: ARIGATO_BEAT_VIDEO, calls, bpm: ARIGATO_BEAT_BPM };
}

// オイ！／Fu 系のコールか（連打地帯は専用2択にする）。
function chantKindOf(note: string): "oi" | "fu" | null {
  const n = note.trim();
  if (n === "オイ！" || n === "オイ") return "oi";
  if (/^fu/i.test(n)) return "fu"; // "Fu" / "Fu!" など
  return null;
}

// 尺バケツ：短い/中/長で分ける（選択肢を尺で見分けられないように同バケツから抽選）
function bucketOf(lenBeats: number): "s" | "m" | "l" {
  if (lenBeats <= 2) return "s";
  if (lenBeats >= 5) return "l";
  return "m";
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

// 判定済みバーの色（背景/枠/文字）
const VERDICT_BAR: Record<Verdict, { bg: string; bd: string; fg: string }> = {
  perfect: { bg: "rgba(54,211,153,0.24)", bd: "rgba(54,211,153,0.85)", fg: "#36d399" },
  good: { bg: "rgba(124,196,255,0.24)", bd: "rgba(124,196,255,0.85)", fg: "#7cc4ff" },
  late: { bg: "rgba(245,179,66,0.24)", bd: "rgba(245,179,66,0.85)", fg: "#f5b342" },
  wrong: { bg: "rgba(255,107,138,0.24)", bd: "rgba(255,107,138,0.85)", fg: "#ff6b8a" },
  notap: { bg: "rgba(136,136,136,0.18)", bd: "rgba(136,136,136,0.55)", fg: "#9aa3b0" },
};

export default function HiTensionQuizPage() {
  const data = useRef(loadData());
  const calls = data.current.calls;
  const bpm = data.current.bpm || 149;
  const beatSec = 60 / bpm;

  // 各コールに候補を用意（普通＝正解＋同尺ダミー2 ／ 連打＝オイ/Fu2択）。毎回ランダムだが起動時に固定。
  const targets = useMemo<Target[]>(() => {
    return calls.map((call, idx) => {
      const ck = chantKindOf(call.note);
      if (ck) {
        return { call, kind: "chant", answer: ck === "oi" ? CHANT_OI : CHANT_FU, candidates: [CHANT_OI, CHANT_FU] };
      }
      const bucket = bucketOf(call.lenBeats);
      const pool = calls
        .filter((c, k) => k !== idx && c.note && c.note !== call.note && !chantKindOf(c.note) && bucketOf(c.lenBeats) === bucket)
        .map(c => c.note);
      const uniq = [...new Set(pool)];
      let distract = shuffle(uniq).slice(0, 2);
      if (distract.length < 2) {
        const more = [...new Set(calls.map(c => c.note).filter(n => n && n !== call.note && !chantKindOf(n) && !distract.includes(n)))];
        distract = [...distract, ...shuffle(more).slice(0, 2 - distract.length)];
      }
      const candidates = shuffle([call.note || "♪", ...distract]);
      return { call, kind: "normal", answer: call.note || "♪", candidates };
    });
  }, [calls]);

  const playerRef = useRef<YouTubePlayerApi>(null);
  const [phase, setPhase] = useState<"ready" | "playing" | "result">("ready");
  const [activeIdx, setActiveIdx] = useState(-1);
  const [verdictMap, setVerdictMap] = useState<Record<number, Verdict>>({}); // タイムライン開示用（判定したら中身＋色を出す）
  const [flash, setFlash] = useState<{ verdict: Verdict; errMs: number | null } | null>(null);
  const [results, setResults] = useState<Result[]>([]);

  const judgedRef = useRef<Set<number>>(new Set());
  const resRef = useRef<Result[]>([]);
  const rafRef = useRef(0);
  const nowRef = useRef(0);
  const activeIdxRef = useRef(-1);
  const armedRef = useRef(false); // 先頭で再生中の状態が続いてから判定開始（古い再生位置での誤終了を防ぐ）
  const startFramesRef = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastT = calls.length ? calls[calls.length - 1].t : 0;

  const judge = (i: number, chosen: string | null, errSec: number | null) => {
    if (judgedRef.current.has(i)) return;
    judgedRef.current.add(i);
    const tg = targets[i];
    let verdict: Verdict;
    let errMs: number | null = null;
    if (chosen === null) verdict = "notap";
    else if (chosen !== tg.answer) verdict = "wrong";
    else {
      errMs = Math.round((errSec ?? 0) * 1000);
      const a = Math.abs(errMs);
      verdict = a <= PERFECT_MS ? "perfect" : a <= GOOD_MS ? "good" : "late";
    }
    const r: Result = { i, call: tg.call, chosen, errMs, verdict };
    resRef.current[i] = r;
    setVerdictMap(m => ({ ...m, [i]: verdict })); // タイムラインに開示
    if (chosen !== null) {
      setFlash({ verdict, errMs });
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 650);
    }
  };

  const finish = () => {
    cancelAnimationFrame(rafRef.current);
    try { playerRef.current?.pause(); } catch { /* ignore */ }
    // 未判定はノータップ・ミス扱いで埋める
    for (let i = 0; i < targets.length; i++) if (!judgedRef.current.has(i)) judge(i, null, null);
    const filled: Result[] = targets.map((tg, i) => resRef.current[i] ?? { i, call: tg.call, chosen: null, errMs: null, verdict: "notap" });
    setResults(filled);
    setPhase("result");
  };

  const getNow = () => playerRef.current?.getCurrentTime?.() ?? nowRef.current;

  const start = () => {
    judgedRef.current = new Set(); resRef.current = []; setResults([]); setFlash(null); setVerdictMap({});
    armedRef.current = false; startFramesRef.current = 0;
    activeIdxRef.current = -1; setActiveIdx(-1);
    setPhase("playing");
    try { playerRef.current?.seekTo(0); playerRef.current?.play(); } catch { /* ignore */ }
    // プレイヤー準備が間に合わず頭出しが効かないことがあるので、少し後にもう一度頭へ戻す
    setTimeout(() => { try { playerRef.current?.seekTo(0); playerRef.current?.play(); } catch { /* ignore */ } }, 500);
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const now = playerRef.current?.getCurrentTime?.() ?? 0;
      nowRef.current = now;
      // 「頭(0.05〜1.5s)を実際に前進しながら再生中」が3フレーム続いて初めて判定開始。
      // 準備中は getCurrentTime が 0 を返し isPlaying は楽観的に true になりがち＝now>0.05 で本当の再生だけ拾う。
      // これで一瞬の0読みや古い再生位置(動画終端)での即終了を防ぐ。
      if (!armedRef.current) {
        const playing = playerRef.current?.isPlaying?.() ?? false;
        if (now > 0.05 && now <= 1.5 && playing) startFramesRef.current += 1;
        else startFramesRef.current = 0;
        if (startFramesRef.current >= 3) armedRef.current = true;
        else return;
      }
      // 通り過ぎた未判定はミス確定
      for (let i = 0; i < targets.length; i++) {
        if (!judgedRef.current.has(i) && now > targets[i].call.t + MISS_TAIL) judge(i, null, null);
      }
      // アクティブ＝出現中でまだ未判定の次のコール
      let ai = -1;
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i].call.t;
        if (!judgedRef.current.has(i) && now >= t - LEAD_BEATS * beatSec && now <= t + MISS_TAIL) { ai = i; break; }
      }
      if (ai !== activeIdxRef.current) { activeIdxRef.current = ai; setActiveIdx(ai); }
      if (now >= lastT + 1.2) finish();
    };
    loop();
  };

  const stop = () => { cancelAnimationFrame(rafRef.current); try { playerRef.current?.pause(); } catch { /* ignore */ } setPhase("ready"); };

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const onTap = (note: string) => {
    if (activeIdxRef.current < 0) return;
    const i = activeIdxRef.current;
    const tg = targets[i];
    const now = getNow();
    judge(i, note, now - tg.call.t);
  };

  // 答え確認リンク（レクチャー動画の数小節前へ）。
  // 同テンポなので「最初のコール(ステージ)→レクチャー0:06」を合わせれば全体が合う：
  //   lecture時刻 = (このコール - 最初のコール) + 6秒。そこから数小節前を頭出し。
  const firstT = calls.length ? calls[0].t : 0;
  const lectureUrl = (t: number) => {
    const lectureT = (t - firstT) + LECTURE_FIRST_CALL_SEC;
    const sec = Math.max(0, Math.round(lectureT - REVIEW_BARS * 4 * beatSec));
    return `https://www.youtube.com/watch?v=${LECTURE_VIDEO}&t=${sec}s`;
  };

  const active = activeIdx >= 0 ? targets[activeIdx] : null;

  const btn: React.CSSProperties = { fontSize: 15, padding: "11px 18px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#eee", fontWeight: 700, cursor: "pointer" };
  // 候補ボタン＝高さ固定（テキストが長くても枠内で折り返す＝ガタガタしない）。
  const choiceBtn: React.CSSProperties = { height: 62, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 15, padding: "4px 8px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#eee", fontWeight: 700, cursor: "pointer", lineHeight: 1.15, wordBreak: "break-all", overflow: "hidden" };

  const verdictLabel: Record<Verdict, string> = { perfect: "PERFECT", good: "GOOD", late: "タイミングずれ", wrong: "ちがうコール", notap: "押せてない" };
  const verdictColor: Record<Verdict, string> = { perfect: "#36d399", good: "#7cc4ff", late: "#f5b342", wrong: "#ff6b8a", notap: "#888" };

  return (
    <div style={{ minHeight: "100dvh", background: ARENA_BG, color: "#eef1f5", display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, sans-serif", padding: "10px 14px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        <h1 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>コール練習クイズ <span style={{ fontSize: 11, color: "#8b93a0", fontWeight: 400 }}>(開発用)</span></h1>
        {phase === "playing" && <button style={{ ...btn, marginLeft: "auto", padding: "5px 12px", fontSize: 12 }} onClick={stop}>やめる</button>}
      </div>

      {calls.length === 0 && phase === "ready" && (
        <p style={{ fontSize: 13, color: "#9aa3b0", marginTop: 12 }}>採譜データがありません。先に <b style={{ color: "#cbd2dc" }}>/arigato-beat/beat</b> でコールを記録してね。</p>
      )}

      {/* 動画（ステージプラクティス＝答えが映らない） */}
      <div style={{ width: "min(100%, calc(22dvh * 16 / 9))", margin: "8px auto 0", flex: "0 0 auto" }}>
        <YouTubePlayer ref={playerRef} videoId={data.current.videoId} onEnded={() => phase === "playing" && armedRef.current && finish()} />
      </div>

      {/* ===== ready ===== */}
      {phase === "ready" && (
        <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "#9aa3b0", maxWidth: 360, lineHeight: 1.7, margin: 0 }}>
            曲が流れる→上のタイムラインで <b style={{ color: "#cbd2dc" }}>？が中央(拍)に近づく</b>→<b style={{ color: "#cbd2dc" }}>正しいコールを選ぶ</b>。<br />
            大事なのは<b style={{ color: PINK }}>タイミング</b>。オイ！／Fu の連打は専用ボタンで。終わったら苦手を結果画面で振り返れる。
          </p>
          {calls.length > 0 && (
            <button style={{ ...btn, background: PINK, borderColor: PINK, color: "#fff", fontSize: 17, padding: "13px 30px" }} onClick={start}>▶ スタート</button>
          )}
        </div>
      )}

      {/* ===== playing ===== */}
      {phase === "playing" && (
        <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 12, position: "relative", paddingTop: 8 }}>
          {/* タイムライン（中央プレイヘッド＋拍グリッド＋？でぼかし／判定済みは開示） */}
          <QuizTimeline
            calls={calls} beatSec={beatSec} getNow={getNow}
            verdictMap={verdictMap} activeIdx={activeIdx} pink={PINK}
          />

          {/* 判定フラッシュ */}
          <div style={{ height: 30, textAlign: "center" }}>
            {flash && (
              <span style={{ fontSize: 22, fontWeight: 900, color: verdictColor[flash.verdict] }}>
                {verdictLabel[flash.verdict]}{flash.errMs != null && flash.verdict !== "perfect" ? `（${flash.errMs > 0 ? "+" : ""}${flash.errMs}ms）` : ""}
              </span>
            )}
          </div>

          {/* 候補ボタン（位置固定） */}
          <div style={{ minHeight: 84, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            {!active ? (
              <div style={{ minHeight: 62, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7480", fontSize: 14 }}>♪ つぎのコールを待つ…</div>
            ) : active.kind === "chant" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, maxWidth: 320, width: "100%", margin: "0 auto" }}>
                <button onClick={() => onTap(CHANT_OI)} style={{ ...choiceBtn, height: 72, fontSize: 22, borderColor: "rgba(218,24,132,0.55)", background: "rgba(218,24,132,0.12)" }}>オイ！</button>
                <button onClick={() => onTap(CHANT_FU)} style={{ ...choiceBtn, height: 72, fontSize: 22, borderColor: "rgba(124,196,255,0.5)", background: "rgba(124,196,255,0.1)" }}>Fu</button>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                {active.candidates.map((c, k) => (
                  <button key={k} onClick={() => onTap(c)} style={choiceBtn}>{c}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== result ===== */}
      {phase === "result" && (
        <ResultView results={results} beatSec={beatSec} lectureUrl={lectureUrl} onRetry={start}
          verdictLabel={verdictLabel} verdictColor={verdictColor} />
      )}
    </div>
  );
}

// タイムライン（/beat流用・読み取り専用）：中央固定プレイヘッド＋拍グリッド。コールは拍幅のバーで右から流れる。
// これから来る＝「？」でぼかし、判定済み＝中身＋正誤色で開示。translateXは自前rAFで毎フレーム（親を再描画させない）。
function QuizTimeline({ calls, beatSec, getNow, verdictMap, activeIdx, pink }: {
  calls: Call[]; beatSec: number; getNow: () => number;
  verdictMap: Record<number, Verdict>; activeIdx: number; pink: string;
}) {
  const vpRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(0);
  const getNowRef = useRef(getNow); getNowRef.current = getNow;

  useEffect(() => {
    const el = vpRef.current; if (!el) return;
    const set = () => setVw(el.clientWidth);
    set();
    const ro = new ResizeObserver(set); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pxPerSec = vw > 0 ? vw / Q_SPAN_SEC : 60;
  const refSec = calls.length ? calls[0].t : 0;

  // レーン割当（時刻順・貪欲first-fit。バーが重なる時だけ次レーンへ）。
  const { laneOf, laneCount, trackSec } = useMemo(() => {
    const sorted = calls.map((c, i) => ({ c, i })).sort((a, b) => a.c.t - b.c.t);
    const ends: number[] = [];
    const lo = new Map<number, number>();
    let maxEnd = 10;
    for (const { c, i } of sorted) {
      const s = c.t;
      const e = s + Math.max(c.lenBeats * beatSec, 0.18);
      maxEnd = Math.max(maxEnd, e);
      let L = ends.findIndex(end => end <= s + 0.001);
      if (L < 0) { ends.push(e); L = ends.length - 1; } else { ends[L] = e; }
      lo.set(i, L);
    }
    return { laneOf: lo, laneCount: Math.max(1, ends.length), trackSec: maxEnd + Q_SPAN_SEC };
  }, [calls, beatSec]);

  // 毎フレーム：現在時刻が中央に来るよう track を translateX。
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const tr = trackRef.current; if (!tr || vw === 0) return;
      const t = getNowRef.current();
      tr.style.transform = `translateX(${(vw / 2 - t * pxPerSec).toFixed(1)}px)`;
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [vw, pxPerSec]);

  // グリッド線（拍＝薄／小節頭＝濃）。基準refSecに線が来るようオフセット。
  const beatPx = beatSec * pxPerSec;
  const measurePx = beatSec * 4 * pxPerSec;
  const grid: React.CSSProperties = {
    backgroundImage: `repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0 1px, transparent 1px ${beatPx}px), repeating-linear-gradient(90deg, rgba(255,255,255,0.2) 0 1.5px, transparent 1.5px ${measurePx}px)`,
    backgroundPosition: `${(refSec * pxPerSec) % beatPx}px 0, ${(refSec * pxPerSec) % measurePx}px 0`,
  };
  const bandH = Math.min(150, Math.max(96, laneCount * Q_LANE_PITCH + 8));
  const trackH = Math.max(laneCount * Q_LANE_PITCH + 8, bandH);

  return (
    <div ref={vpRef} style={{ position: "relative", height: bandH, flex: "0 0 auto", overflow: "hidden", border: "1px solid #1d2430", borderRadius: 10, background: "#0a0c12", userSelect: "none", WebkitUserSelect: "none" }}>
      {/* プレイヘッド（中央固定） */}
      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, marginLeft: -1, background: pink, zIndex: 3, pointerEvents: "none", boxShadow: "0 0 8px rgba(218,24,132,0.6)" }} />
      {/* トラック（毎フレーム translateX） */}
      <div ref={trackRef} style={{ position: "absolute", left: 0, top: 0, height: trackH, width: Math.max(1, trackSec * pxPerSec), ...grid, willChange: "transform" }}>
        {calls.map((c, i) => {
          const left = c.t * pxPerSec;
          const w = Math.max(20, c.lenBeats * beatSec * pxPerSec);
          const lane = laneOf.get(i) ?? 0;
          const v = verdictMap[i];
          const judged = v !== undefined;
          const isActive = i === activeIdx;
          const longWord = /[A-Za-z0-9]{6,}/.test(c.note);
          const barFont = longWord && w < 70 ? 10 : 12;
          let bg: string, bd: string, col: string, text: string;
          if (judged) { const vb = VERDICT_BAR[v]; bg = vb.bg; bd = vb.bd; col = vb.fg; text = c.note || "♪"; }
          else if (isActive) { bg = pink; bd = "#fff"; col = "#fff"; text = "？"; }
          else { bg = "rgba(255,255,255,0.05)"; bd = "rgba(255,255,255,0.16)"; col = "#7d8694"; text = "？"; }
          return (
            <div key={i} style={{
              position: "absolute", left, top: lane * Q_LANE_PITCH + 4, width: w, maxHeight: Q_LANE_PITCH - 6,
              borderRadius: 6, border: `1px solid ${bd}`, background: bg, color: col,
              fontSize: judged ? barFont : 14, fontWeight: judged ? 700 : 800, lineHeight: 1.1,
              padding: "3px 4px", whiteSpace: "normal", wordBreak: "break-all", overflowWrap: "anywhere", overflow: "hidden",
              display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
              boxShadow: isActive ? "0 0 0 1px rgba(255,255,255,0.5)" : undefined,
            }}>
              {text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 結果画面：スコア＋ミス一覧（正解タイミング実演＋ズレ＋レクチャーリンク）
function ResultView({ results, beatSec, lectureUrl, onRetry, verdictLabel, verdictColor }: {
  results: Result[]; beatSec: number; lectureUrl: (t: number) => string; onRetry: () => void;
  verdictLabel: Record<Verdict, string>; verdictColor: Record<Verdict, string>;
}) {
  const ok = results.filter(r => r.verdict === "perfect" || r.verdict === "good").length;
  const misses = results.filter(r => r.verdict !== "perfect" && r.verdict !== "good");
  const btn: React.CSSProperties = { fontSize: 14, padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#eee", fontWeight: 700, cursor: "pointer" };

  return (
    <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "8px 2px" }}>
      <div style={{ textAlign: "center", margin: "6px 0 14px" }}>
        <div style={{ fontSize: 13, color: "#9aa3b0" }}>正解タイミング</div>
        <div style={{ fontSize: 40, fontWeight: 900, color: PINK }}>{ok}<span style={{ fontSize: 18, color: "#9aa3b0" }}> / {results.length}</span></div>
      </div>

      {misses.length === 0 ? (
        <p style={{ textAlign: "center", color: "#36d399", fontWeight: 700 }}>全部タイミング合ってた！完璧！</p>
      ) : (
        <>
          <div style={{ fontSize: 12, color: "#9aa3b0", margin: "0 4px 8px" }}>苦手だったコール（{misses.length}）</div>
          {misses.map(r => (
            <div key={r.i} style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12, margin: "0 0 10px", background: "rgba(255,255,255,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 800, wordBreak: "break-all" }}>{r.call.note || "♪"}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: verdictColor[r.verdict], marginLeft: "auto" }}>
                  {verdictLabel[r.verdict]}{r.errMs != null ? `（${r.errMs > 0 ? "+" : ""}${r.errMs}ms ${r.errMs > 0 ? "遅い" : "早い"}）` : ""}
                </span>
              </div>
              <TimingDemo beatSec={beatSec} note={r.call.note || "♪"} />
              <a href={lectureUrl(r.call.t)} target="_blank" rel="noopener noreferrer"
                style={{ display: "inline-block", marginTop: 8, fontSize: 13, color: "#7cc4ff", textDecoration: "none", fontWeight: 700 }}>
                ▶ レクチャーで答えを見る（数小節前から）
              </a>
            </div>
          ))}
        </>
      )}

      <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 12 }}>
        <button style={{ ...btn, background: PINK, borderColor: PINK, color: "#fff" }} onClick={onRetry}>もう一回</button>
      </div>
    </div>
  );
}

// 「5,6,7,8 → ここ！」で正解タイミングを実演（上級編のカウントイン流用）
function TimingDemo({ beatSec, note }: { beatSec: number; note: string }) {
  const [step, setStep] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = ["5", "6", "7", "8", note];

  const play = () => {
    if (timer.current) clearTimeout(timer.current);
    let k = 0; setStep(seq[0]);
    const tick = () => {
      k += 1;
      if (k < seq.length) { setStep(seq[k]); timer.current = setTimeout(tick, beatSec * 1000); }
      else { timer.current = setTimeout(() => setStep(null), 700); }
    };
    timer.current = setTimeout(tick, beatSec * 1000);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const isCall = step !== null && step === note;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <button onClick={play} style={{ fontSize: 13, padding: "7px 12px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "#eee", cursor: "pointer", flex: "0 0 auto", fontWeight: 700 }}>
        ▶ 正解の<br />タイミング
      </button>
      <div style={{ flex: 1, height: 44, borderRadius: 9, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <span style={{ fontSize: isCall ? 22 : 18, fontWeight: 900, color: isCall ? PINK : "#cbd2dc", wordBreak: "break-all", textAlign: "center", lineHeight: 1.1, padding: "0 6px" }}>
          {step ?? "5・6・7・8 →"}
        </span>
      </div>
    </div>
  );
}
