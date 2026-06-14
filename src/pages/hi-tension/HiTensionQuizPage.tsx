// コール練習クイズ（開発用・隠しルート /hi-tension/quiz）
//
// 主役は「正しいタイミングで出せるか」。声・マイクは使わず全部タップ。
//   - ステージプラクティス動画（コール答えが映らない）を流す。
//   - コールの少し前に候補ボタンが出る＝正解＋同じ尺の別タイミングのコールを自動でまぜる
//     （チャント帯はオイ/Fu等の短いコール同士）。近づくバーが拍に来た瞬間に正解を狙ってタップ。
//   - 採点は「ボタン正誤 × タイミング精度」。流れは止めない。
//   - 終わったら結果画面：ミスを一覧→「5,6,7,8→ここ！」で正解タイミングを実演＋自分のズレ表示＋
//     「レクチャーで答えを見る」リンク（コールレクチャー動画の数小節前へ）。
// コールデータは採譜ツール(/hi-tension/beat)の保存(localStorage)を読む。
import { useEffect, useMemo, useRef, useState } from "react";
import YouTubePlayer, { type YouTubePlayerApi } from "./components/YouTubePlayer";

const PINK = "#da1884";
const ARENA_BG = "radial-gradient(150% 85% at 50% -8%, #1b2030 0%, #0e1016 48%, #07080c 100%)";
const LS_KEY = "hi_tension:beat_tap";

// コールレクチャー動画（答え確認の飛び先）。ステージプラクティスと同テンポ・頭出しが少し遅いだけ。
const LECTURE_VIDEO = "xr7_Z5ibZMA";
const LECTURE_FIRST_CALL_SEC = 6.0; // レクチャー動画で最初のコールが鳴る時刻(hop実測0:06)。同テンポなのでfirstを合わせれば全体一致
const REVIEW_BARS = 2;          // 答え確認は「ミスの何小節前」から
const LEAD_BEATS = 2;           // 候補ボタンを拍の何拍前から出すか
const PERFECT_MS = 120;
const GOOD_MS = 260;
const MISS_TAIL = GOOD_MS / 1000 + 0.08; // この秒数を過ぎたら無タップ＝ミス確定

type Call = { t: number; note: string; lenBeats: number };
type Verdict = "perfect" | "good" | "late" | "wrong" | "notap";
type Result = { i: number; call: Call; chosen: string | null; errMs: number | null; verdict: Verdict };

function loadData(): { videoId: string; calls: Call[]; bpm: number } {
  try {
    const o = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    const calls: Call[] = Array.isArray(o.taps)
      ? o.taps.filter((x: Call) => typeof x?.t === "number").map((x: Call) => ({ t: x.t, note: x.note || "", lenBeats: x.lenBeats || 1 }))
      : [];
    calls.sort((a, b) => a.t - b.t);
    return { videoId: o.videoId || "n5AVvFwbeaM", calls, bpm: o.bpm || 149 };
  } catch {
    return { videoId: "n5AVvFwbeaM", calls: [], bpm: 149 };
  }
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

export default function HiTensionQuizPage() {
  const data = useRef(loadData());
  const calls = data.current.calls;
  const bpm = data.current.bpm || 149;
  const beatSec = 60 / bpm;

  // 各コールに候補（正解＋同尺ダミー2個）を用意（毎回ランダムだが起動時に固定）。
  const targets = useMemo(() => {
    return calls.map((call, idx) => {
      const bucket = bucketOf(call.lenBeats);
      const pool = calls
        .filter((c, k) => k !== idx && c.note && c.note !== call.note && bucketOf(c.lenBeats) === bucket)
        .map(c => c.note);
      const uniq = [...new Set(pool)];
      let distract = shuffle(uniq).slice(0, 2);
      // 同尺が足りなければ他バケツからも借りる
      if (distract.length < 2) {
        const more = [...new Set(calls.map(c => c.note).filter(n => n && n !== call.note && !distract.includes(n)))];
        distract = [...distract, ...shuffle(more).slice(0, 2 - distract.length)];
      }
      const candidates = shuffle([call.note || "♪", ...distract]);
      return { call, candidates };
    });
  }, [calls]);

  const playerRef = useRef<YouTubePlayerApi>(null);
  const [phase, setPhase] = useState<"ready" | "playing" | "result">("ready");
  const [nowSec, setNowSec] = useState(0);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [flash, setFlash] = useState<{ verdict: Verdict; errMs: number | null } | null>(null);
  const [results, setResults] = useState<Result[]>([]);

  const judgedRef = useRef<Set<number>>(new Set());
  const resRef = useRef<Result[]>([]);
  const rafRef = useRef(0);
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
    else if (chosen !== (tg.call.note || "♪")) verdict = "wrong";
    else {
      errMs = Math.round((errSec ?? 0) * 1000);
      const a = Math.abs(errMs);
      verdict = a <= PERFECT_MS ? "perfect" : a <= GOOD_MS ? "good" : "late";
    }
    const r: Result = { i, call: tg.call, chosen, errMs, verdict };
    resRef.current[i] = r;
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

  const start = () => {
    judgedRef.current = new Set(); resRef.current = []; setResults([]); setFlash(null);
    armedRef.current = false; startFramesRef.current = 0;
    setPhase("playing");
    try { playerRef.current?.seekTo(0); playerRef.current?.play(); } catch { /* ignore */ }
    // プレイヤー準備が間に合わず頭出しが効かないことがあるので、少し後にもう一度頭へ戻す
    setTimeout(() => { try { playerRef.current?.seekTo(0); playerRef.current?.play(); } catch { /* ignore */ } }, 500);
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const now = playerRef.current?.getCurrentTime?.() ?? 0;
      setNowSec(now);
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
      setActiveIdx(ai);
      if (now >= lastT + 1.2) finish();
    };
    loop();
  };

  const stop = () => { cancelAnimationFrame(rafRef.current); try { playerRef.current?.pause(); } catch { /* ignore */ } setPhase("ready"); };

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const onTap = (note: string) => {
    if (activeIdx < 0) return;
    const tg = targets[activeIdx];
    const now = playerRef.current?.getCurrentTime?.() ?? nowSec;
    judge(activeIdx, note, now - tg.call.t);
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
  const approach = active ? Math.min(1, Math.max(0, (nowSec - (active.call.t - LEAD_BEATS * beatSec)) / (LEAD_BEATS * beatSec))) : 0;

  const btn: React.CSSProperties = { fontSize: 15, padding: "11px 18px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#eee", fontWeight: 700, cursor: "pointer" };

  const verdictLabel: Record<Verdict, string> = { perfect: "PERFECT", good: "GOOD", late: "タイミングずれ", wrong: "ちがうコール", notap: "押せてない" };
  const verdictColor: Record<Verdict, string> = { perfect: "#36d399", good: "#7cc4ff", late: "#f5b342", wrong: "#ff6b8a", notap: "#888" };

  return (
    <div style={{ minHeight: "100dvh", background: ARENA_BG, color: "#eef1f5", display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, sans-serif", padding: "10px 14px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        <h1 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>コール練習クイズ <span style={{ fontSize: 11, color: "#8b93a0", fontWeight: 400 }}>(開発用)</span></h1>
        {phase === "playing" && <button style={{ ...btn, marginLeft: "auto", padding: "5px 12px", fontSize: 12 }} onClick={stop}>やめる</button>}
      </div>

      {calls.length === 0 && phase === "ready" && (
        <p style={{ fontSize: 13, color: "#9aa3b0", marginTop: 12 }}>採譜データがありません。先に <b style={{ color: "#cbd2dc" }}>/hi-tension/beat</b> でコールを記録してね。</p>
      )}

      {/* 動画（ステージプラクティス＝答えが映らない） */}
      <div style={{ width: "min(100%, calc(24dvh * 16 / 9))", margin: "8px auto 0", flex: "0 0 auto" }}>
        <YouTubePlayer ref={playerRef} videoId={data.current.videoId} onEnded={() => phase === "playing" && armedRef.current && finish()} />
      </div>

      {/* ===== ready ===== */}
      {phase === "ready" && (
        <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "#9aa3b0", maxWidth: 360, lineHeight: 1.7, margin: 0 }}>
            曲が流れる→コールの少し前に候補が出る→<b style={{ color: "#cbd2dc" }}>近づくバーが拍に来た瞬間に正解をタップ</b>。<br />
            大事なのは<b style={{ color: PINK }}>タイミング</b>。終わったら苦手を結果画面で振り返れる。
          </p>
          {calls.length > 0 && (
            <button style={{ ...btn, background: PINK, borderColor: PINK, color: "#fff", fontSize: 17, padding: "13px 30px" }} onClick={start}>▶ スタート</button>
          )}
        </div>
      )}

      {/* ===== playing ===== */}
      {phase === "playing" && (
        <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, position: "relative" }}>
          {/* 判定フラッシュ */}
          <div style={{ height: 40, textAlign: "center" }}>
            {flash && (
              <span style={{ fontSize: 24, fontWeight: 900, color: verdictColor[flash.verdict] }}>
                {verdictLabel[flash.verdict]}{flash.errMs != null && flash.verdict !== "perfect" ? `（${flash.errMs > 0 ? "+" : ""}${flash.errMs}ms）` : ""}
              </span>
            )}
          </div>

          {/* 近づくバー（中央＝拍） */}
          <div style={{ position: "relative", height: 10, borderRadius: 5, background: "rgba(255,255,255,0.07)", overflow: "hidden", margin: "0 6px" }}>
            <div style={{ position: "absolute", left: "50%", top: -4, bottom: -4, width: 2, marginLeft: -1, background: PINK }} />
            {active && <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${approach * 50}%`, background: "linear-gradient(90deg, transparent, rgba(218,24,132,0.5))" }} />}
          </div>

          {/* 候補ボタン */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", minHeight: 56 }}>
            {active
              ? active.candidates.map((c, k) => (
                <button key={k} onClick={() => onTap(c)} style={{ ...btn, fontSize: 16, padding: "13px 18px", maxWidth: 160, lineHeight: 1.2, wordBreak: "break-all" }}>{c}</button>
              ))
              : <span style={{ color: "#6b7480", fontSize: 14, alignSelf: "center" }}>♪ つぎのコールを待つ…</span>}
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
