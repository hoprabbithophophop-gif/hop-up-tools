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
import { memo, useEffect, useMemo, useRef, useState } from "react";
import YouTubePlayer, { type YouTubePlayerApi } from "./components/YouTubePlayer";
import { ARIGATO_BEAT_CALLS, ARIGATO_BEAT_VIDEO, ARIGATO_BEAT_BPM, ARIGATO_BEAT_SECTIONS } from "./arigatoBeatCalls";

const PINK = "#da1884";
const ARENA_BG = "radial-gradient(150% 85% at 50% -8%, #1b2030 0%, #0e1016 48%, #07080c 100%)";

// コールレクチャー動画（答え確認の飛び先）。ステージプラクティスと同テンポ・頭出しが少し遅いだけ。
const LECTURE_VIDEO = "xr7_Z5ibZMA";
const LECTURE_FIRST_CALL_SEC = 6.0; // レクチャー動画で最初のコールが鳴る時刻(hop実測0:06)。同テンポなのでfirstを合わせれば全体一致
const REVIEW_BARS = 2;          // 答え確認は「ミスの何小節前」から
const LEAD_BEATS = 6;           // 候補ボタンを拍の何拍前から「表示」するか（読む時間用。判定窓とは別。BPM149で6拍≈2.4秒）
// 採点＝DDD(lets-ddd-easy)方式を流用。「最初の未判定コールに当てる」＋「±BADを過ぎたら即ミス消化」＋「±BAD内じゃないと当てない」＋入力デバウンス。
// 連打が崩れない肝＝窓を狭く・ミスを即消化（居座らせない）。窓が広い(旧850ms=約2拍)と隣を掴んで連鎖する。
const PERFECT_EARLY_MS = 100;   // 頭より「前」はここまでPERFECT（＝当たる早い窓と同じ）
const PERFECT_LATE_MS = 200;    // 頭より「後ろ」はここまでPERFECT（コールは少し遅れて返すのが自然なので後ろ広め・hop調整）
const LATE_MS = 300;            // 後ろはここまで当たる＆GOOD（後ろのマッチ／無タップミス窓）
const EARLY_MS = 100;           // 頭より「前」はここまでしか当たらない＝それ以前は判定無し（早い側だけ厳しく狭く・hop方針）
const MIN_TAP_GAP_SEC = 0.1;    // 連打で1タップが2コールを消費しないための最小間隔（DDDの入力デバウンス相当）

// タイムライン（/beat流用）
const Q_SPAN_SEC = 6;    // 可視秒数（拍ごとの山が分離して見える幅）
const Q_LANE_PITCH = 48; // レーン間隔（バー最大高さ=これ-6。長文コールが3行でも収まるよう確保）

const CHANT_OI = "オイ！";
const CHANT_FU = "Fu";

// X(旧Twitter)シェア。文面・タグ・URLは hop 指定（勝手に足さない）。本編EndCardと同じ Web Intent 方式
// （ログイン/API不要・URLは &url= でなく本文に独立行で入れる）。ハッシュタグは #ありがとビートpractice のみ。
const SHARE_URL = "https://hop-up-tools.pages.dev/arigato-beat/quiz";
function shareToX(ok: number, total: number, perfect: number, good: number) {
  const text = [
    "ありがとビート コール練習で",
    `正しいタイミング ${ok}/${total}！`,
    `PERFECT ${perfect}・GOOD ${good}`,
    "#ありがとビートpractice",
    SHARE_URL,
  ].join("\n");
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

type Call = { t: number; note: string; lenBeats: number };
type Verdict = "perfect" | "good" | "wrong" | "notap";
type Target = { call: Call; kind: "chant" | "normal" | "cue"; answer: string; candidates: string[] };

// （）で囲まれたものはコールではなく、レクチャー動画で言ってた「心掛け／合いの手」（例：（かわいく））。
// クイズの出題対象にも候補にもしない。タイムラインには心掛けとして薄く出すだけ。
function isCue(note: string): boolean {
  return /^[（(]/.test(note.trim());
}
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

// 秒 → 曲のセクション名（startSec が t 以下で最後のもの）。どのありがとう/オイ！かを特定するため。
function sectionOf(t: number): string {
  let name = ARIGATO_BEAT_SECTIONS[0]?.name ?? "";
  for (const s of ARIGATO_BEAT_SECTIONS) { if (s.startSec <= t) name = s.name; else break; }
  return name;
}
function fmtSec(t: number): string {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// 採譜ズレ補正（コールindex→秒）。結果のカウントイン見返しで「ズレてると感じたら直す」分をこの端末に貯める。
// ライブ判定には使わない（検証済みロジックを触らない）＝書き出してデータ(arigatoBeatCalls.ts)に焼く運用。
const LS_OFFSETS = "arigato_beat:call_offsets";
function loadOffsets(): Record<string, number> {
  try { const o = JSON.parse(localStorage.getItem(LS_OFFSETS) || "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}
function saveOffsets(o: Record<string, number>) {
  try { localStorage.setItem(LS_OFFSETS, JSON.stringify(o)); } catch { /* ignore */ }
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
  wrong: { bg: "rgba(255,107,138,0.24)", bd: "rgba(255,107,138,0.85)", fg: "#ff6b8a" },
  notap: { bg: "rgba(136,136,136,0.18)", bd: "rgba(136,136,136,0.55)", fg: "#9aa3b0" },
};

export default function ArigatoBeatQuizPage() {
  const data = useRef(loadData());
  const calls = data.current.calls;
  const bpm = data.current.bpm || 149;
  const beatSec = 60 / bpm;
  const firstT = calls.length ? calls[0].t : 0;
  // レベル：Lv1＝レクチャー動画(答えが画面に出る・やさしい)、Lv2＝ステージ動画(答えなし・本番)。
  // 同テンポなので時間軸は定数シフトで揃う：レクチャー時刻 = ステージ時刻 + (6.0 - 最初のコール)。
  const levelVideo = (lvl: 1 | 2) => (lvl === 1 ? LECTURE_VIDEO : data.current.videoId);
  const levelShift = (lvl: 1 | 2) => (lvl === 1 ? LECTURE_FIRST_CALL_SEC - firstT : 0);

  // 各コールに候補を用意（普通＝正解＋同尺ダミー2 ／ 連打＝オイ/Fu2択）。毎回ランダムだが起動時に固定。
  const targets = useMemo<Target[]>(() => {
    return calls.map((call, idx) => {
      if (isCue(call.note)) {
        return { call, kind: "cue", answer: "", candidates: [] };
      }
      const ck = chantKindOf(call.note);
      if (ck) {
        return { call, kind: "chant", answer: ck === "oi" ? CHANT_OI : CHANT_FU, candidates: [CHANT_OI, CHANT_FU] };
      }
      const bucket = bucketOf(call.lenBeats);
      const pool = calls
        .filter((c, k) => k !== idx && c.note && c.note !== call.note && !chantKindOf(c.note) && !isCue(c.note) && bucketOf(c.lenBeats) === bucket)
        .map(c => c.note);
      const uniq = [...new Set(pool)];
      let distract = shuffle(uniq).slice(0, 2);
      if (distract.length < 2) {
        const more = [...new Set(calls.map(c => c.note).filter(n => n && n !== call.note && !chantKindOf(n) && !isCue(n) && !distract.includes(n)))];
        distract = [...distract, ...shuffle(more).slice(0, 2 - distract.length)];
      }
      const candidates = shuffle([call.note || "♪", ...distract]);
      return { call, kind: "normal", answer: call.note || "♪", candidates };
    });
  }, [calls]);

  const playerRef = useRef<YouTubePlayerApi>(null);
  const loadedVideoRef = useRef(data.current.videoId); // 今プレイヤーに載ってる動画（レクチャー確認で切り替わる）
  const [phase, setPhase] = useState<"ready" | "playing" | "result">("ready");
  const [activeIdx, setActiveIdx] = useState(-1);
  const [verdictMap, setVerdictMap] = useState<Record<number, Verdict>>({}); // タイムライン開示用（判定したら中身＋色を出す）
  const [flash, setFlash] = useState<{ verdict: Verdict; errMs: number | null } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [offsets, setOffsets] = useState<Record<string, number>>(loadOffsets); // 採譜ズレ補正（見返しで調整）
  const [reviewIdx, setReviewIdx] = useState(-1); // カウントイン見返し中のコール（-1=なし）
  const [level, setLevel] = useState<1 | 2>(2);   // 今プレイ中/した レベル
  const levelRef = useRef<1 | 2>(2);              // 「もう一回」が同じレベルを確実に拾うための参照
  const [levelOffset, setLevelOffset] = useState(0); // レベルの時間軸シフト秒（Lv1=レクチャー換算, Lv2=0）
  const levelOffsetRef = useRef(0);
  // タイムライン用＝レベルのシフトを乗せたコール時刻（バー位置を再生時刻に合わせる）
  const playCalls = useMemo(() => calls.map(c => ({ ...c, t: c.t + levelOffset })), [calls, levelOffset]);

  const judgedRef = useRef<Set<number>>(new Set());
  const resRef = useRef<Result[]>([]);
  const rafRef = useRef(0);
  const nowRef = useRef(0);
  const activeIdxRef = useRef(-1);
  const lastTapAtRef = useRef(-1); // 直前に判定したタップ時刻（デバウンス用）
  const armedRef = useRef(false); // 先頭で再生中の状態が続いてから判定開始（古い再生位置での誤終了を防ぐ）
  const startFramesRef = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kickTimer = useRef<ReturnType<typeof setInterval> | null>(null); // 黒画面で固まる対策：再生が始まるまでキック

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
      errMs = Math.round((errSec ?? 0) * 1000); // +は遅い、−は早い
      // PERFECTは左右非対称（頭より前は厳しく狭く・後ろは少し広め）。窓外(=errMs<-EARLY)はonTapで弾くのでここには来ない。
      verdict = (errMs >= -PERFECT_EARLY_MS && errMs <= PERFECT_LATE_MS) ? "perfect" : "good";
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
    if (kickTimer.current) { clearInterval(kickTimer.current); kickTimer.current = null; }
    // 動画は止めない：曲の終わり〜「見てくれてありがとう」シーンまでそのまま流す（ぶつ切りにしない）。
    // 未判定はノータップ・ミス扱いで埋める（cue＝心掛けは採点対象外）
    for (let i = 0; i < targets.length; i++) if (targets[i].kind !== "cue" && !judgedRef.current.has(i)) judge(i, null, null);
    const filled: Result[] = targets
      .map((tg, i) => tg.kind === "cue" ? null : (resRef.current[i] ?? { i, call: tg.call, chosen: null, errMs: null, verdict: "notap" as Verdict }))
      .filter((r): r is Result => r !== null);
    setResults(filled);
    setPhase("result");
  };

  // 安定参照（毎レンダーで作り直さない）＝QuizTimelineのReact.memoが効く＝判定外の再描画で揺れない（ガタつき対策）
  const getNow = useRef(() => playerRef.current?.getCurrentTime?.() ?? nowRef.current).current;

  const start = (lvl?: 1 | 2) => {
    const L = lvl ?? levelRef.current; // 引数なし(もう一回)は今のレベルを確実に拾う
    judgedRef.current = new Set(); resRef.current = []; setResults([]); setFlash(null); setVerdictMap({});
    armedRef.current = false; startFramesRef.current = 0;
    activeIdxRef.current = -1; setActiveIdx(-1); lastTapAtRef.current = -1;
    // レベルの時間軸シフトと動画をセット。
    const off = levelShift(L);
    levelOffsetRef.current = off; setLevelOffset(off); setLevel(L); levelRef.current = L;
    setPhase("playing");
    pushPlayingState(); // ブラウザバックで戻れるよう履歴に積む
    // このレベルの動画を載せる。別動画なら loadVideo（0から自動再生）。同じ動画なら seekTo(0) で頭出し。
    const vid = levelVideo(L);
    const switching = loadedVideoRef.current !== vid;
    if (switching) {
      try { playerRef.current?.loadVideo?.(vid, { startSeconds: 0 }); } catch { /* ignore */ }
      loadedVideoRef.current = vid;
    }
    // 黒画面/くるくるのまま固まる対策：再生が始まる(isPlaying)まで300 msごとに最大8回キック。
    // モバイルはタップgesture内で同期的に play() しないと自動再生されない＝切替でも即 play() する。
    // ただし切替時は explicit な seekTo(0) はしない（ロード中の新動画に割り込むと固まる＝それがLv1→Lv2の固まりの原因）。
    // 同じ動画(もう一回)だけ seekTo(0) で頭出し。
    const kick = () => { try { if (!switching) playerRef.current?.seekTo(0); playerRef.current?.play(); } catch { /* ignore */ } };
    kick();
    if (kickTimer.current) clearInterval(kickTimer.current);
    let kicks = 0;
    kickTimer.current = setInterval(() => {
      kicks += 1;
      if ((playerRef.current?.isPlaying?.() ?? false) || kicks >= 8) {
        if (kickTimer.current) { clearInterval(kickTimer.current); kickTimer.current = null; }
        return;
      }
      kick();
    }, 300);
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
      // DDD方式：先頭の未判定コールが「頭＋後ろ窓(LATE)」を過ぎていたら即ミス消化（居座らせない＝連鎖の元を断つ）。
      // 順番に消化（一気に複数過ぎてても順に）。cueは出題対象外。
      const lo = levelOffsetRef.current; // レベルの時間軸シフト（Lv1=レクチャー換算, Lv2=0）
      for (let guard = 0; guard < targets.length; guard++) {
        let fi = -1;
        for (let i = 0; i < targets.length; i++) { if (targets[i].kind === "cue" || judgedRef.current.has(i)) continue; fi = i; break; }
        if (fi < 0) break;
        if (now > targets[fi].call.t + lo + LATE_MS / 1000) judge(fi, null, null); // 後ろ窓を過ぎた＝無タップミス
        else break;
      }
      // アクティブ＝「先頭の未判定コール」（DDDのfirst-unjudged）。表示窓(LEAD)に入っていれば候補ボタンを出す。
      // タップは onTap 側で ±MATCH 内のときだけ当てる（窓外は無効）。
      let ai = -1;
      for (let i = 0; i < targets.length; i++) {
        if (targets[i].kind === "cue" || judgedRef.current.has(i)) continue;
        if (now >= targets[i].call.t + lo - LEAD_BEATS * beatSec) ai = i; // 出現済みなら表示
        break; // 先頭の未判定だけ見る
      }
      if (ai !== activeIdxRef.current) { activeIdxRef.current = ai; setActiveIdx(ai); }
      if (now >= lastT + lo + 1.2) finish();
    };
    loop();
  };

  // レベル選択(ready)へ戻す共通処理（再生停止・見返し閉じ）。
  const goReady = () => {
    cancelAnimationFrame(rafRef.current);
    if (kickTimer.current) { clearInterval(kickTimer.current); kickTimer.current = null; }
    try { playerRef.current?.pause(); } catch { /* ignore */ }
    setReviewIdx(-1); setPhase("ready");
  };

  // ブラウザバック対応：プレイ開始時に履歴を1つ積み、戻る/やめるでページ離脱でなくレベル選択へ。
  const pushedRef = useRef(false);
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const pushPlayingState = () => { if (!pushedRef.current) { try { history.pushState({ q: "arigato-quiz-play" }, ""); } catch { /* ignore */ } pushedRef.current = true; } };
  const stop = () => { if (pushedRef.current) history.back(); else goReady(); }; // やめる＝バックと同じ経路

  useEffect(() => {
    const onPop = () => { if (phaseRef.current !== "ready") goReady(); pushedRef.current = false; };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { cancelAnimationFrame(rafRef.current); if (flashTimer.current) clearTimeout(flashTimer.current); if (kickTimer.current) clearInterval(kickTimer.current); }, []);

  const onTap = (note: string) => {
    const now = getNow();
    // 入力デバウンス（1タップが2コールを消費しない）。窓外でも時刻は更新（DDD流用）。
    if (now - lastTapAtRef.current < MIN_TAP_GAP_SEC) return;
    lastTapAtRef.current = now;
    // 当てる先＝先頭の未判定コール（DDDのfirst-unjudged）。
    let i = -1;
    for (let k = 0; k < targets.length; k++) { if (targets[k].kind === "cue" || judgedRef.current.has(k)) continue; i = k; break; }
    if (i < 0) return;
    const errSec = now - (targets[i].call.t + levelOffsetRef.current);
    // 当たる窓は左右非対称：前(早い)はEARLYまで・後ろ(遅い)はLATEまで。頭より前は厳しく＝それ以前は判定無し（無視・ペナルティ無し、もう一回叩ける）。
    if (errSec < -EARLY_MS / 1000 || errSec > LATE_MS / 1000) return;
    judge(i, note, errSec);
  };

  // ===== 結果の「見返し」＝採譜キャリブレーター =====
  // ページ内プレイヤーをレクチャー動画に切り替え、コールの数小節前から再生。動画の再生に同期して
  // 「5・6・7・8 →（コール）」のカウントインを動画の下に出す（YouTube規約で動画の上には重ねない）。
  // "→" の瞬間＝採譜が記録してるコールの位置。実際のコールとズレてたら ±拍ボタンで直す（補正値を貯める）。
  // 同テンポなので「最初のコール(ステージ)→レクチャー0:06」を合わせれば全体一致：lecture時刻=(コール-最初)+6秒。
  const callTOf = (i: number) => calls[i].t + (offsets[i] ?? 0);              // 補正込みのコール時刻(ステージ)
  const lectureTOf = (i: number) => (callTOf(i) - firstT) + LECTURE_FIRST_CALL_SEC; // レクチャー換算
  const segStart = (lectureT: number) => Math.max(0, lectureT - REVIEW_BARS * 4 * beatSec); // 数小節前
  const seekLecture = (sec: number) => {
    const s = Math.max(0, sec);
    if (loadedVideoRef.current !== LECTURE_VIDEO) {
      try { playerRef.current?.loadVideo?.(LECTURE_VIDEO, { startSeconds: s }); } catch { /* ignore */ }
      loadedVideoRef.current = LECTURE_VIDEO;
    } else {
      try { playerRef.current?.seekTo?.(s); playerRef.current?.play?.(); } catch { /* ignore */ }
    }
  };
  const startReview = (i: number) => { setReviewIdx(i); seekLecture(segStart(lectureTOf(i))); };
  const replayReview = () => { if (reviewIdx >= 0) seekLecture(segStart(lectureTOf(reviewIdx))); };
  const nudgeReview = (deltaSec: number) => {
    if (reviewIdx < 0) return;
    const i = reviewIdx;
    const next = Math.round(((offsets[i] ?? 0) + deltaSec) * 1000) / 1000;
    const n = { ...offsets, [i]: next };
    setOffsets(n); saveOffsets(n);
    // 新しい補正でセグメント頭から再生し直して、ズレが直ったか即見れる
    const lt = (calls[i].t + next - firstT) + LECTURE_FIRST_CALL_SEC;
    seekLecture(segStart(lt));
  };
  const resetOffsets = () => {
    if (!Object.keys(offsets).length) return;
    if (!confirm("保存した採譜の補正を全部消す？（採点には影響なし）")) return;
    setOffsets({}); saveOffsets({}); setReviewIdx(-1);
  };
  const exportOffsets = async () => {
    const list = Object.keys(offsets).map(k => Number(k)).filter(i => (offsets[i] ?? 0) !== 0).sort((a, b) => a - b)
      .map(i => ({ i, note: calls[i].note, baseT: calls[i].t, offsetSec: offsets[i], newT: Math.round((calls[i].t + offsets[i]) * 1000) / 1000 }));
    const json = JSON.stringify(list, null, 2);
    try { await navigator.clipboard.writeText(json); } catch { /* ignore */ }
    try { const blob = new Blob([json], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "arigato-beat-offsets.json"; a.click(); URL.revokeObjectURL(url); } catch { /* ignore */ }
  };

  const active = activeIdx >= 0 ? targets[activeIdx] : null;

  const btn: React.CSSProperties = { fontSize: 15, padding: "11px 18px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#eee", fontWeight: 700, cursor: "pointer" };
  // 候補ボタン＝高さ固定（テキストが長くても枠内で折り返す＝ガタガタしない）。
  const choiceBtn: React.CSSProperties = { height: 62, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 15, padding: "4px 8px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#eee", fontWeight: 700, cursor: "pointer", lineHeight: 1.15, wordBreak: "break-all", overflow: "hidden" };

  const verdictLabel: Record<Verdict, string> = { perfect: "PERFECT", good: "GOOD", wrong: "ちがうコール", notap: "押せてない" };
  const verdictColor: Record<Verdict, string> = { perfect: "#36d399", good: "#7cc4ff", wrong: "#ff6b8a", notap: "#888" };

  return (
    <div style={{ height: "100dvh", overflow: "hidden", background: ARENA_BG, color: "#eef1f5", display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, sans-serif", padding: "10px 14px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        <h1 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>コール練習クイズ <span style={{ fontSize: 11, color: "#8b93a0", fontWeight: 400 }}>(開発用)</span></h1>
        {phase === "playing" && <button style={{ ...btn, marginLeft: "auto", padding: "5px 12px", fontSize: 12 }} onClick={stop}>やめる</button>}
      </div>

      {calls.length === 0 && phase === "ready" && (
        <p style={{ fontSize: 13, color: "#9aa3b0", marginTop: 12 }}>採譜データがありません。先に <b style={{ color: "#cbd2dc" }}>/arigato-beat/beat</b> でコールを記録してね。</p>
      )}

      {/* 動画（ステージプラクティス＝答えが映らない）。フルサイズで見たい＝コンテナ全幅(16:9維持） */}
      <div style={{ width: "100%", margin: "8px auto 0", flex: "0 0 auto" }}>
        <YouTubePlayer ref={playerRef} videoId={data.current.videoId} onEnded={() => phase === "playing" && armedRef.current && finish()} />
      </div>

      {/* 見返しパネル（動画の下＝カウントイン＋採譜の±拍補正） */}
      {phase === "result" && reviewIdx >= 0 && (
        <ReviewPanel
          note={calls[reviewIdx].note || "♪"}
          section={sectionOf(calls[reviewIdx].t)}
          lectureCallT={lectureTOf(reviewIdx)}
          beatSec={beatSec}
          getNow={getNow}
          offsetSec={offsets[reviewIdx] ?? 0}
          onNudge={nudgeReview}
          onReplay={replayReview}
          onClose={() => setReviewIdx(-1)}
          pink={PINK}
        />
      )}

      {/* ===== ready（レベル選択）===== */}
      {phase === "ready" && (
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, textAlign: "center", padding: "8px 0" }}>
          <p style={{ fontSize: 14, color: "#cbd2dc", maxWidth: 360, lineHeight: 1.8, margin: 0 }}>
            正しいコールを正しいタイミングでタップ！<br />
            <span style={{ color: "#9aa3b0" }}>小さく口ずさみながらだと本番でも対応できるはず！</span>
          </p>
          {calls.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 340 }}>
              <button style={{ ...btn, background: PINK, borderColor: PINK, color: "#fff", fontSize: 16, padding: "14px 18px", textAlign: "left", lineHeight: 1.4 }} onClick={() => start(1)}>
                ▶ レベル1<br /><span style={{ fontSize: 12, fontWeight: 400, color: "#ffd6ea" }}>コールを見ながら</span>
              </button>
              <button style={{ ...btn, fontSize: 16, padding: "14px 18px", textAlign: "left", lineHeight: 1.4 }} onClick={() => start(2)}>
                ▶ レベル2<br /><span style={{ fontSize: 12, fontWeight: 400, color: "#9aa3b0" }}>答えなしで思い出す</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===== playing ===== */}
      {phase === "playing" && (
        <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 12, position: "relative", paddingTop: 8 }}>
          {/* タイムライン（中央プレイヘッド＋拍グリッド＋？でぼかし／判定済みは開示） */}
          <QuizTimeline
            calls={playCalls} beatSec={beatSec} getNow={getNow}
            verdictMap={verdictMap} activeIdx={activeIdx} pink={PINK} revealAll={level === 1}
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
        <ResultView results={results} onRetry={start} onReview={startReview} reviewIdx={reviewIdx}
          offsets={offsets} onExport={exportOffsets} onReset={resetOffsets} onBackToSelect={goReady} level={level}
          verdictLabel={verdictLabel} verdictColor={verdictColor} />
      )}
    </div>
  );
}

// タイムライン（/beat流用・読み取り専用）：中央固定プレイヘッド＋拍グリッド。コールは拍幅のバーで右から流れる。
// これから来る＝「？」でぼかし、判定済み＝中身＋正誤色で開示。translateXは自前rAFで毎フレーム（親を再描画させない）。
const QuizTimeline = memo(function QuizTimeline({ calls, beatSec, getNow, verdictMap, activeIdx, pink, revealAll }: {
  calls: Call[]; beatSec: number; getNow: () => number;
  verdictMap: Record<number, Verdict>; activeIdx: number; pink: string; revealAll: boolean;
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

  // 毎フレーム：現在時刻が中央に来るよう track を translateX（GPU合成＝グリッド線もクリスプに動く）。
  // getCurrentTime()は約100ms刻みで量子化されてる＝そのまま使うとスクロールがカクつくので
  // 値が変わった/シークした時だけ再アンカーし、間は performance.now で外挿して滑らかにする（本編横画面と同方式）。
  useEffect(() => {
    let raf = 0, smoothT = -1, lastP = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const tr = trackRef.current; if (!tr || vw === 0) return;
      const raw = getNowRef.current(); // getCurrentTimeは約100ms刻みで量子化されてる
      const nowP = performance.now();
      if (smoothT < 0 || raw < smoothT - 0.15 || raw > smoothT + 0.5) {
        smoothT = raw; // 初回・シーク戻り・大幅ズレは即合わせ
      } else {
        smoothT += (nowP - lastP) / 1000; // 実経過で滑らかに進める（量子化の間を補間）
        smoothT += (raw - smoothT) * 0.1; // 量子化された真値へ緩く寄せる（カクつかせずドリフト防止）
      }
      lastP = nowP;
      tr.style.transform = `translateX(${(vw / 2 - smoothT * pxPerSec).toFixed(1)}px)`;
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [vw, pxPerSec]);

  // グリッド線（拍＝薄／小節頭＝濃）はトラックに乗せる＝transformで一緒に動く＝線が均等・クリスプ。
  // 開始時(t=0)に左半分が空かないよう、トラックを左へ PAD ぶん延ばしてグリッドで埋める（PADはmesurePxの倍数＝整列維持）。
  const beatPx = beatSec * pxPerSec;
  const measurePx = beatSec * 4 * pxPerSec;
  const PAD = Math.ceil(vw / Math.max(1, measurePx)) * measurePx;
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
      {/* トラック（グリッド＋バー・毎フレーム translateX。左へPAD延ばして開始時の空きを埋める） */}
      <div ref={trackRef} style={{ position: "absolute", left: -PAD, top: 0, height: trackH, width: Math.max(1, trackSec * pxPerSec + PAD), ...grid, willChange: "transform", zIndex: 1 }}>
        {calls.map((c, i) => {
          const left = c.t * pxPerSec + PAD;
          const w = Math.max(20, c.lenBeats * beatSec * pxPerSec);
          const lane = laneOf.get(i) ?? 0;
          const cue = isCue(c.note);
          const v = verdictMap[i];
          const judged = v !== undefined;
          const isActive = i === activeIdx;
          const longWord = /[A-Za-z0-9]{6,}/.test(c.note);
          const barFont = (w < 44 || longWord || c.note.length >= 6) ? 10 : 12; // 狭バー/長語/長文は詰める（縦に潰れて見切れるの防止）
          let bg: string, bd: string, col: string, text: string;
          // Lv1(revealAll)はコール文を出す＝やさしい。Lv2は未判定を「？」で隠す。
          const hidden = revealAll ? (c.note || "♪") : "？";
          if (cue) { bg = "transparent"; bd = "rgba(255,255,255,0.14)"; col = "#6b7480"; text = c.note; } // 心掛け＝薄く常時表示
          else if (judged) { const vb = VERDICT_BAR[v]; bg = vb.bg; bd = vb.bd; col = vb.fg; text = c.note || "♪"; }
          else if (isActive) { bg = pink; bd = "#fff"; col = "#fff"; text = hidden; }
          else { bg = "rgba(255,255,255,0.05)"; bd = "rgba(255,255,255,0.16)"; col = "#7d8694"; text = hidden; }
          return (
            <div key={i} style={{
              position: "absolute", left, top: lane * Q_LANE_PITCH + 4, width: w, maxHeight: Q_LANE_PITCH - 4,
              borderRadius: 6, border: `1px ${cue ? "dashed" : "solid"} ${bd}`, background: bg, color: col,
              fontSize: cue ? 10 : (text === "？" ? 14 : barFont), fontWeight: cue ? 500 : (text === "？" ? 800 : 700), fontStyle: cue ? "italic" : "normal", lineHeight: 1.1,
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
});

// 結果画面：スコア＋おさらい一覧（PERFECT以外を全部・セクション別）。各コールを「見返す」と動画＋カウントインへ。
function ResultView({ results, onRetry, onReview, reviewIdx, offsets, onExport, onReset, onBackToSelect, level, verdictLabel, verdictColor }: {
  results: Result[]; onRetry: () => void; onReview: (i: number) => void; reviewIdx: number;
  offsets: Record<string, number>; onExport: () => void; onReset: () => void; onBackToSelect: () => void; level: 1 | 2;
  verdictLabel: Record<Verdict, string>; verdictColor: Record<Verdict, string>;
}) {
  const perfect = results.filter(r => r.verdict === "perfect").length;
  const good = results.filter(r => r.verdict === "good").length;
  const ok = perfect + good;
  // 全PERFECT狙い＝PERFECT以外を全部おさらい（GOOD含む）。
  const review = results.filter(r => r.verdict !== "perfect");
  const btn: React.CSSProperties = { fontSize: 14, padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#eee", fontWeight: 700, cursor: "pointer" };

  return (
    <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "8px 2px" }}>
      <div style={{ textAlign: "center", margin: "6px 0 8px" }}>
        <div style={{ fontSize: 13, color: "#9aa3b0" }}>正解タイミング</div>
        <div style={{ fontSize: 40, fontWeight: 900, color: PINK }}>{ok}<span style={{ fontSize: 18, color: "#9aa3b0" }}> / {results.length}</span></div>
      </div>
      {/* 内訳（0件のものは出さない） */}
      <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap", fontSize: 12, margin: "0 0 14px" }}>
        {(["perfect", "good", "wrong", "notap"] as Verdict[]).map(k => {
          const n = results.filter(r => r.verdict === k).length;
          if (!n) return null;
          return <span key={k} style={{ color: verdictColor[k], fontWeight: 700 }}>{verdictLabel[k]} {n}</span>;
        })}
      </div>

      {review.length === 0 ? (
        <p style={{ textAlign: "center", color: "#36d399", fontWeight: 700 }}>全部PERFECT！完璧！</p>
      ) : (
        <>
          <div style={{ fontSize: 12, color: "#9aa3b0", margin: "0 4px 8px" }}>PERFECTじゃなかったコール（{review.length}）— おさらい・セクション別</div>
          {ARIGATO_BEAT_SECTIONS.map(sec => {
            const inSec = review.filter(r => sectionOf(r.call.t) === sec.name);
            if (!inSec.length) return null;
            return (
              <div key={sec.name} style={{ margin: "0 0 12px" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: PINK, margin: "0 2px 6px", letterSpacing: 0.5 }}>{sec.name}（{inSec.length}）</div>
                {inSec.map(r => (
                  <div key={r.i} style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12, margin: "0 0 8px", background: "rgba(255,255,255,0.03)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: "#7d8694", fontVariantNumeric: "tabular-nums", flex: "0 0 auto" }}>{fmtSec(r.call.t)}</span>
                      <span style={{ fontSize: 16, fontWeight: 800, wordBreak: "break-all" }}>{r.call.note || "♪"}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: verdictColor[r.verdict], marginLeft: "auto", flex: "0 0 auto" }}>
                        {verdictLabel[r.verdict]}{r.errMs != null ? `（${r.errMs > 0 ? "+" : ""}${r.errMs}ms）` : ""}
                      </span>
                    </div>
                    <button onClick={() => onReview(r.i)}
                      style={{ width: "100%", fontSize: 14, color: reviewIdx === r.i ? "#fff" : "#cfe8ff", background: reviewIdx === r.i ? "rgba(218,24,132,0.5)" : "rgba(124,196,255,0.12)", border: `1px solid ${reviewIdx === r.i ? PINK : "rgba(124,196,255,0.45)"}`, borderRadius: 10, padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}>
                      ▶ 見返す（動画＋5,6,7,8カウントイン）{(offsets[r.i] ?? 0) !== 0 ? `・補正${offsets[r.i] > 0 ? "+" : ""}${Math.round(offsets[r.i] * 1000)}ms` : ""}
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 12 }}>
        <button style={{ ...btn, background: PINK, borderColor: PINK, color: "#fff", minWidth: 200 }} onClick={onRetry}>もう一回（レベル{level}）</button>
        <button style={{ ...btn, minWidth: 200 }} onClick={onBackToSelect}>レベル選択へ戻る</button>
        <button style={{ ...btn, minWidth: 200 }} onClick={() => shareToX(ok, results.length, perfect, good)}>𝕏 でシェアする</button>
        {Object.values(offsets).some(v => v !== 0) && (
          <>
            <button style={{ ...btn, minWidth: 200, fontSize: 13 }} onClick={onExport}>▶ ズレ補正を書き出す（hopへ渡す用）</button>
            <button style={{ ...btn, minWidth: 200, fontSize: 12, color: "#c98", borderColor: "rgba(255,180,120,0.3)" }} onClick={onReset}>補正をリセット</button>
          </>
        )}
      </div>
    </div>
  );
}

// 見返しパネル（動画の下）：動画の再生に同期して「5・6・7・8 →（コール）」をカウントイン。
// "→" の瞬間＝採譜が記録してるコール位置。動画の実際のコールとズレてたら ±拍で直す（採譜キャリブレーター）。
function ReviewPanel({ note, section, lectureCallT, beatSec, getNow, offsetSec, onNudge, onReplay, onClose, pink }: {
  note: string; section: string; lectureCallT: number; beatSec: number; getNow: () => number;
  offsetSec: number; onNudge: (deltaSec: number) => void; onReplay: () => void; onClose: () => void; pink: string;
}) {
  const [step, setStep] = useState<string | null>(null);
  const getNowRef = useRef(getNow); getNowRef.current = getNow;
  const callTRef = useRef(lectureCallT); callTRef.current = lectureCallT;
  const beatRef = useRef(beatSec); beatRef.current = beatSec;
  const noteRef = useRef(note); noteRef.current = note;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const d = getNowRef.current() - callTRef.current; // +はコール過ぎ
      const b = beatRef.current;
      let s: string | null = null;
      if (d >= -4 * b && d < -3 * b) s = "5";
      else if (d >= -3 * b && d < -2 * b) s = "6";
      else if (d >= -2 * b && d < -1 * b) s = "7";
      else if (d >= -1 * b && d < 0) s = "8";
      else if (d >= 0 && d < 1.2 * b) s = noteRef.current; // →コールの瞬間
      setStep(prev => (prev === s ? prev : s));
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  const isCall = step !== null && step === note;
  const offBeats = Math.round((offsetSec / beatSec) * 100) / 100;
  const offLabel = offsetSec === 0 ? "補正なし（このまま）" : `補正 ${offsetSec > 0 ? "+" : ""}${offBeats}拍（${offsetSec > 0 ? "+" : ""}${Math.round(offsetSec * 1000)}ms）`;
  const nb: React.CSSProperties = { fontSize: 13, fontWeight: 800, padding: "8px 11px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.07)", color: "#eee", cursor: "pointer" };
  return (
    <div style={{ flex: "0 0 auto", margin: "8px 0 0", padding: "10px 12px", borderRadius: 12, border: `1px solid ${pink}`, background: "rgba(218,24,132,0.08)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#cbd2dc", marginBottom: 6 }}>
        <span style={{ color: pink, fontWeight: 800 }}>{section}</span>
        <b style={{ fontSize: 14, color: "#fff" }}>{note}</b>
        <span style={{ fontSize: 11, color: "#8b93a0" }}>動画の実演と「→」が合ってるか見て、ズレてたら直す</span>
        <button onClick={onClose} style={{ ...nb, marginLeft: "auto", padding: "4px 9px", fontSize: 11 }}>閉じる</button>
      </div>
      {/* カウントイン表示（動画下＝規約OK） */}
      <div style={{ height: 46, borderRadius: 9, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 8 }}>
        <span style={{ fontSize: isCall ? 22 : 26, fontWeight: 900, color: isCall ? pink : "#cbd2dc", lineHeight: 1, padding: "0 8px", textAlign: "center", wordBreak: "break-all" }}>
          {isCall ? `→ ${step}` : (step ?? "▶ 再生中… 5・6・7・8 →")}
        </span>
      </div>
      {/* ズレてたら直す＝採譜補正（±拍） */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
        <button onClick={() => onNudge(-beatSec)} style={nb}>−1拍</button>
        <button onClick={() => onNudge(-beatSec / 2)} style={nb}>−½</button>
        <button onClick={onReplay} style={{ ...nb, background: "rgba(255,255,255,0.13)" }}>▶ もう一回</button>
        <button onClick={() => onNudge(beatSec / 2)} style={nb}>+½</button>
        <button onClick={() => onNudge(beatSec)} style={nb}>+1拍</button>
      </div>
      <div style={{ textAlign: "center", fontSize: 11, color: offsetSec === 0 ? "#7d8694" : pink, marginTop: 6, fontWeight: 700 }}>{offLabel}</div>
    </div>
  );
}
