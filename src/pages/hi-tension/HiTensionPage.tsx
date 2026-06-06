import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import MemberSelect from "./components/MemberSelect";
import YouTubePlayer, { type YouTubePlayerApi } from "./components/YouTubePlayer";
import HandsCanvas, { type HandsCanvasApi } from "./components/HandsCanvas";
import WaitingRoom from "./WaitingRoom";
import RoomMenu from "./RoomMenu";
import ReadyCheck from "./ReadyCheck";
import { VIDEO_ID, WARMUP_VIDEO_ID, WARMUP_VIDEO_START, WARMUP_VIDEO_END, findMember } from "./data";

// 待機室で暖機再生する warmup クリップの YouTube 再生オプション
const WARMUP_LOAD_OPTS = { startSeconds: WARMUP_VIDEO_START, endSeconds: WARMUP_VIDEO_END };
import {
  getLastSelectedMemberId,
  setLastSelectedMemberId,
  getOrCreateAnonymousSessionId,
} from "./storage";
import { submitHiSession, fetchHiSessions, type HiSession } from "./api";
import { useHiTensionRealtime, MAX_PARTICIPANTS, SENO_WINDOW_MS, type LiveDriftReport, type LiveTap } from "./useHiTensionRealtime";
import EndCard from "./components/EndCard";
import BouncyNumber from "./components/BouncyNumber";
import FpsMeter from "./components/FpsMeter";
import HandIcon from "./components/HandIcon";
import NavButton from "./components/NavButton";
import { isNishidaBirthday, NISHIDA_COLOR } from "./birthday";
import { getSupabase } from "@/lib/supabase";

// 同期デバッグ用のデバイス判定（後で削除）
function detectDevice(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  return "other";
}

// PC（other）の動画ステージモニターのサイズ。iframe を小さくして YouTube に低解像度を選ばせ、
// デコード負荷を下げて rate=1.0 を維持しやすくするのが目的。
// 480 だと 360p 自動選択（240p 比 2.25 倍）の可能性、それでも HandsCanvas を screen==="play"
// でガードした効果で余力が吸収できる見込み。崩れたら下げる。
const PC_VIDEO_WIDTH = 480;
const PC_VIDEO_HEIGHT_PX = (PC_VIDEO_WIDTH * 9) / 16;
const SYNC_LOG_INTERVAL_MS = 3000;

// 診断用イベントログ（後で削除）。再生開始まわりの「どこで止まったか」を自動記録する。
const YT_STATE_NAMES: Record<number, string> = {
  [-1]: "UNSTARTED", 0: "ENDED", 1: "PLAYING", 2: "PAUSED", 3: "BUFFERING", 5: "CUED",
};
// 画面上のデバッグ表示 ＋ 重い同期サンプリングログ(hi_sync_debug, 3秒ごと)の on/off。
// 本番はoff。URLに ?hidebug=1 を付けるとonになり localStorage に記録される（?hidebug=0 でoff）。
// ※軽いイベントログ(hi_event_debug＝presence/seno/go_solo/seat_collision 等)は
//   このフラグに関係なく常時収集する（実セッションを後から追えるように）。
const HI_DEBUG: boolean = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("hidebug")) {
      const on = params.get("hidebug") !== "0";
      window.localStorage.setItem("hi_debug", on ? "1" : "0");
      return on;
    }
    return window.localStorage.getItem("hi_debug") === "1";
  } catch {
    return false;
  }
})();

function logHiEvent(sessionId: string, event: string, detail?: string) {
  // 同期が安定したため、本番では診断ログ(hi_event_debug)を書かない（容量肥大の主因だった）。
  // 不具合調査が必要になったら URL に ?hidebug=1 を付ければ従来通りこのログも収集できる。
  if (!HI_DEBUG) return;
  // ログ送信は失敗してもアプリ本体を絶対に巻き込まない（getSupabase が env 不備で throw する等）。
  try {
    getSupabase().from("hi_event_debug").insert({
      session_id: sessionId,
      device: detectDevice(),
      event,
      detail: detail ?? null,
    }).then(({ error }) => { if (error) console.warn("[hi-tension] event log failed", error.message); });
  } catch {
    /* ログ失敗は無視 */
  }
}

type Screen = "select" | "room-menu" | "waiting" | "ready-check" | "play";

// 画面の「深さ」。ブラウザ/端末の戻るで1段ずつ戻すための履歴レベル。
// ready-check と play は同じ「セッション(3)」レベル＝1エントリにまとめ、戻るは待機室へ一段で戻す。
const SCREEN_LEVEL: Record<Screen, number> = {
  select: 0, "room-menu": 1, waiting: 2, "ready-check": 3, play: 3,
};
const LEVEL_SEARCH = ["", "?s=room", "?s=wait", "?s=session"];
function searchToLevel(search: string): number {
  const s = new URLSearchParams(search).get("s") ?? "";
  return s === "room" ? 1 : s === "wait" ? 2 : s === "session" ? 3 : 0;
}

const LONG_PRESS_INTERVAL_MS = 150;
const LONG_PRESS_THRESHOLD_MS = 250;
const BUTTON_SIZE = 120;
const BOUNCE_DURATION_MS = 400;

// せーの失敗判定: 窓 + ready 受信のための余裕
const SENO_FAIL_TIMEOUT_MS = SENO_WINDOW_MS + 1500;
// 同期方式：rate は弄らない（一切 setPlaybackRate を呼ばない）。
// 全端末が drift / buffer を毎秒 broadcast し合い、相対判定で「自分が最遅端末でない」端末が
// pauseVideo で待ち、最遅端末に揃える。最遅端末本人は何もしないので動き続ける。
// 動画が止まって見える代わりに、再生中のリズム変化は絶対に起きない設計。
const DRIFT_CHECK_INTERVAL_MS = 1000;
const PAUSE_AND_WAIT_THRESHOLD_SEC = 0.15;   // 本動画 pause-and-wait の発動閾値
const PAUSE_MAX_SEC = 10;                    // 1回の pause がこれを超えるなら諦めて同期失敗扱い
// 本動画再生中、友達待ちの一時停止がこの秒数を超えそうになったら「連携終了→ソロ完走」に切替。
// せーの後に一度本編が始まったら、何があっても待機室には戻さない（カクッと止まったら即ソロ）。
const SOLO_BAIL_SEC = 2;
const DRIFT_REPORT_TTL_MS = 4000;            // この時間以内に受信した report だけを「現在の他端末状態」として採用
// 暖機 anchor 受信時の初期同期：自分の位置と「あるべき位置」の差がこれ以上なら loadVideo で飛ばす。
// 1.0 だと「ギリ閾値内」で seek スキップした結果、端末間で 20 秒級の相対ずれが残って rate 補正に
// 1 分以上かかるケースが発生したため積極化（暖機は黒画面 buffering を許容しやすい）。
const WARMUP_INITIAL_SEEK_THRESHOLD_SEC = 0.3;
// 暖機動画の rate 補正パラメータ。暖機は「揃える体験のための出囃子」で、本動画と違って
// 多少のリズム変化は許容できる選曲を使う前提。両側調整で両端末ともに少しずつ寄せる。
const WARMUP_RATE_THRESHOLD_SEC = 0.15;      // 他端末 drift との差がこれを超えたら rate を動かす
const WARMUP_RATE_UP = 1.25;                 // 自分が遅延側 → 速くする
const WARMUP_RATE_DOWN = 0.75;               // 自分が先行側 → 遅くする
// バッファ検知とリカバリ
const BUFFER_RECOVERY_GRACE_MS = 5000;       // バッファ復帰後の補正禁止猶予（loadVideo 直後の getVideoLoadedFraction が安定するまで長めに）
// 全員一斉再生
const LEAD_TIME_MS = 300;                    // songstart 送信から一斉リビール(ドットウェーブを外す)までの先取り時間
const SYNC_START_GRACE_MS = 800;             // doSync 直後の補正禁止猶予
// 本動画への遷移条件（ready-check で全員 ✋押下後、ホストが監視）
const SONGSTART_BUFFER_THRESHOLD_SEC = 5;    // 全員の buffer_ahead がこれ以上で再生体力 OK
const SONGSTART_DRIFT_STABLE_DURATION_MS = 2000; // drift ±0.15s が連続でこの時間続けば「揃った」
const SONGSTART_READY_TIMEOUT_MS = 10000;    // 全員 ✋押下後この時間経っても揃わなければ同期失敗

// バッファ残量(秒)＝今の位置より先に溜まってる尺。取得不可なら 0。デバッグ表示で使用。
function getBufferAheadSec(player: YouTubePlayerApi): number {
  const dur = player.getDuration();
  if (dur <= 0) return 0;
  return player.getVideoLoadedFraction() * dur - player.getCurrentTime();
}

// 暖機動画のループ周期（秒）。drift を modular に正規化する際に使う。
const WARMUP_LOOP_DURATION_SEC = WARMUP_VIDEO_END - WARMUP_VIDEO_START;

type ClockAnchor = {
  t0: number;       // Supabase 時刻 (ms)
  p0: number;       // 動画位置（秒）
  offset: number;   // Supabase時計 - 自分の時計（ms）。anchor 確定時に凍結
  kind: "warmup" | "main";
};

// anchor から「今この瞬間の canonical 動画位置」を計算する。
// warmup はループするので modular 正規化、main は単調増加。
function calculateExpected(anchor: ClockAnchor, nowMs: number): number {
  const supabaseNow = nowMs + anchor.offset;
  const elapsedSec = (supabaseNow - anchor.t0) / 1000;
  if (anchor.kind === "main") return anchor.p0 + elapsedSec;
  // warmup: anchor.p0 から elapsed 秒進んだ位置をループ周期内に正規化
  const offsetFromStart = (anchor.p0 - WARMUP_VIDEO_START) + elapsedSec;
  const normalized = ((offsetFromStart % WARMUP_LOOP_DURATION_SEC) + WARMUP_LOOP_DURATION_SEC) % WARMUP_LOOP_DURATION_SEC;
  return WARMUP_VIDEO_START + normalized;
}

// drift = expected - actual の生値を、ループの周回違い（例：expected=21, actual=81 等）を吸収して
// 「最短経路の差」に正規化する。main では何もしない。
function normalizeDrift(anchor: ClockAnchor, rawDrift: number): number {
  if (anchor.kind === "main") return rawDrift;
  let drift = rawDrift;
  if (drift > WARMUP_LOOP_DURATION_SEC / 2) drift -= WARMUP_LOOP_DURATION_SEC;
  if (drift < -WARMUP_LOOP_DURATION_SEC / 2) drift += WARMUP_LOOP_DURATION_SEC;
  return drift;
}

function newSeatHash(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export default function HiTensionPage() {
  const [screen, setScreen] = useState<Screen>("select");
  const [memberId, setMemberId] = useState<string | null>(() => getLastSelectedMemberId());
  const [sessions, setSessions] = useState<HiSession[]>([]);
  const [seatHash, setSeatHash] = useState<number>(0);
  const [isPressed, setIsPressed] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [endedSelfCount, setEndedSelfCount] = useState(0);
  // play 中に押した回数（ごほうび表示用。submit は timestampsRef を使うので別系統）。
  const [selfPressCount, setSelfPressCount] = useState(0);
  const [isRealtimePlay, setIsRealtimePlay] = useState(false);
  const [bouncingSessionId, setBouncingSessionId] = useState<string | null>(null);
  // 部屋コード。null = グローバル部屋、文字列 = 合言葉の専用部屋
  const [roomCode, setRoomCode] = useState<string | null>(null);
  // 自分でコードを打って入った人か（true）。打ち間違いで空室に入りホストになっても
  // 「入力し直す」を出せるよう、isHost ではなく入室経路で判定する。部屋を作った人は false。
  const [enteredByCode, setEnteredByCode] = useState(false);
  // ready-check 状態
  const [readyCheckGroup, setReadyCheckGroup] = useState<string[]>([]);
  const [readyCount, setReadyCount] = useState(0);
  const [selfReadied, setSelfReadied] = useState(false);
  const [readyCheckFailed, setReadyCheckFailed] = useState(false);
  // 再生中の手の整列用の自分の席番号（ソロ時は -1）
  const [playSeatIndex, setPlaySeatIndex] = useState(-1);
  // ✋押下で play 画面に遷移後、songstart で揃うまでの間。この間は presence track を維持して
  // ホスト判定（seno/ready 集計）を生かす。
  const [syncing, setSyncing] = useState(false);
  // 同期動作中（暖機 anchor or 本動画 anchor が確定）→ debug ループと drift loop がアクティブ
  const [syncActive, setSyncActive] = useState(false);
  // 同期デバッグ表示（原因特定用、後で削除）
  const [debugInfo, setDebugInfo] = useState<{
    anchorOffset: number; liveOffset: number; rtt: number; drift: number; rate: number;
    maxDrift: number; elapsed: number; bufferAhead: number;
  } | null>(null);
  // セッションIDはコンポーネント生存中に固定
  const anonSessionId = useMemo(() => getOrCreateAnonymousSessionId(), []);

  const timestampsRef = useRef<number[]>([]);
  const currentTimeRef = useRef(0);
  const pressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittedRef = useRef(false);
  const videoEndedRef = useRef(false);
  const canvasRef = useRef<HandsCanvasApi | null>(null);
  const playerApiRef = useRef<YouTubePlayerApi | null>(null);
  const bounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRealtimePlayRef = useRef(false);

  // ready-check / 同期まわりの ref
  const screenRef = useRef<Screen>("select");
  const isHostRef = useRef(false);
  const myKeyRef = useRef("");
  // 自分の席番号の最新有効値（再生中は untrack で -1 になるため保持しておく）
  const mySeatIndexRef = useRef(-1);
  const readyCheckGroupRef = useRef<string[]>([]);
  const readiedSetRef = useRef<Set<string>>(new Set());
  const senoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 曲開始の基準点。kind="warmup" なら暖機動画用、kind="main" なら本動画用。
  // t0/p0 は Supabase 時計基準、offset は anchor 確定時の対 Supabase 時計ズレを凍結したもの
  const clockAnchorRef = useRef<ClockAnchor | null>(null);
  const driftTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 全員一斉再生の状態
  const awaitingPlaybackRef = useRef(false);                            // ✋押下後、初回 PLAYING 到達を待っている
  const awaitingSongStartRef = useRef(false);                           // ✋押下後、songstart(seek揃え) を待っている
  const playbackReadyMapRef = useRef<Map<string, number>>(new Map());   // sessionId → PLAYING 到達時刻(Supabase)
  const songStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendPlaybackReadyRef = useRef<(tPlay: number) => void>(() => {});
  // 収束デバッグ用（後で削除）
  const syncStartAtRef = useRef(0);
  const maxDriftRef = useRef(0);
  const lastSyncLogAtRef = useRef(0);
  // 実効再生速度測定用：前回の (videoPos, dateNow) サンプルを保持して
  // 次の log 時に Δ videoPos / Δ dateNow を算出する
  const prevSampleForRateRef = useRef<{ videoPos: number; dateNow: number } | null>(null);
  // バッファ検知関連
  const isBufferingRef = useRef(false);
  const bufferRecoveryGraceUntilRef = useRef(0);
  // 待機室で warmup 動画を muted 再生中フラグ。本番動画とENDED処理を切り分けるのに使う
  const isWarmupRef = useRef(false);
  // pause-and-wait：自分が先行している時に pauseVideo() を入れて待つ。0 なら pause していない、
  // 値が入っていれば「この時刻になったら playVideo() で復帰」
  const pauseUntilRef = useRef(0);
  // 連携終了→ソロ完走モード。本動画中にズレが大きくなった/友達と合わなくなった時点で true になり、
  // 以降は同期（pause待ち・drift配信・✋共有）を一切やめて、自分のペースで最後まで再生する。
  const soloModeRef = useRef(false);
  // 他端末の最新 drift+buffer 報告（受信時刻つき）。pause-and-wait の相対判定と本動画遷移条件の判定に使う。
  // sessionId === presenceKey の場合は自分。自分の最新値も入れておく（送信側の集計を簡単にするため）。
  const driftReportsRef = useRef<Map<string, LiveDriftReport>>(new Map());
  // ✋押下後、本動画遷移の安定判定で「全員 drift が ±0.15s 以内」が連続している開始時刻（ms）。
  // 0 = まだ連続していない（誰かの drift が大きい）
  const driftStableSinceRef = useRef(0);
  // ✋押下後の遷移判定タイマー。ホストだけが回す
  const songstartReadyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 暖機動画の anchor が確定済みか。後から待機室に入った人は受信するまで false
  const warmupAnchorReceivedRef = useRef(false);
  const getClockOffsetRef = useRef<() => number>(() => 0);
  const getBestRoundtripRef = useRef<() => number>(() => Infinity);
  const sendSongStartRef = useRef<(t0: number, p0: number) => void>(() => {});
  const sendSenoFailRef = useRef<() => void>(() => {});
  const sendWarmupStartRef = useRef<(t0: number, p0: number) => void>(() => {});
  const sendDriftReportRef = useRef<(drift: number, bufferAhead: number) => void>(() => {});

  useEffect(() => { isRealtimePlayRef.current = isRealtimePlay; }, [isRealtimePlay]);
  useEffect(() => { screenRef.current = screen; }, [screen]);

  // 診断ログ：syncActive 変化を追う（pause/rate が動かない原因切り分け）
  useEffect(() => {
    logHiEvent(anonSessionId, "sync_active", String(syncActive));
  }, [syncActive, anonSessionId]);

  // 同期デバッグ表示の更新ループ（原因特定用、後で削除）。
  // syncActive で trigger するので暖機動画の同期中もログが取れる。
  useEffect(() => {
    if (!HI_DEBUG) return;            // 本番では同期デバッグ表示・hi_sync_debug書き込みを動かさない
    logHiEvent(anonSessionId, "debug_effect", `syncActive=${syncActive}`);
    if (!syncActive) { setDebugInfo(null); return; }
    let tickCount = 0;
    const timer = setInterval(() => {
      tickCount++;
      if (tickCount === 1) logHiEvent(anonSessionId, "debug_tick_first");
      if (tickCount % 25 === 0) logHiEvent(anonSessionId, "debug_tick", `count=${tickCount}`);
      const anchor = clockAnchorRef.current;
      const player = playerApiRef.current;
      if (!anchor || !player) {
        if (tickCount % 25 === 0) logHiEvent(anonSessionId, "debug_skip", `anchor=${!!anchor} player=${!!player}`);
        return;
      }
      const nowMs = Date.now();
      const expected = calculateExpected(anchor, nowMs);
      const actual = player.getCurrentTime();
      const rtt = getBestRoundtripRef.current();
      const drift = normalizeDrift(anchor, expected - actual);
      if (Math.abs(drift) > maxDriftRef.current) maxDriftRef.current = Math.abs(drift);
      const liveOffset = Math.round(getClockOffsetRef.current());
      const rttMs = Number.isFinite(rtt) ? Math.round(rtt) : -1;
      const rate = player.getPlaybackRate();
      const bufferAhead = +getBufferAheadSec(player).toFixed(1);
      const elapsed = syncStartAtRef.current ? Math.round((Date.now() - syncStartAtRef.current) / 1000) : 0;
      setDebugInfo({
        anchorOffset: Math.round(anchor.offset),
        liveOffset,
        rtt: rttMs,
        drift: +drift.toFixed(2),
        rate,
        maxDrift: +maxDriftRef.current.toFixed(2),
        elapsed,
        bufferAhead,
      });
      // 3秒ごとに Supabase へ記録（手打ち不要にする。後で削除）
      const now = Date.now();
      if (now - lastSyncLogAtRef.current >= SYNC_LOG_INTERVAL_MS) {
        lastSyncLogAtRef.current = now;
        logHiEvent(anonSessionId, "sync_insert_attempt", `tick=${tickCount}`);
        // 実効再生速度（前回 log からの Δ videoPos / Δ dateNow）。初回サンプルは null。
        let effectiveRate: number | null = null;
        const prev = prevSampleForRateRef.current;
        if (prev) {
          const dVideo = actual - prev.videoPos;
          const dWall = (now - prev.dateNow) / 1000;
          if (dWall > 0) effectiveRate = +(dVideo / dWall).toFixed(4);
        }
        prevSampleForRateRef.current = { videoPos: actual, dateNow: now };
        getSupabase().from("hi_sync_debug").insert({
          session_id: anonSessionId,
          member_id: memberId,
          device: detectDevice(),
          clock_offset: Math.round(anchor.offset),
          rtt: rttMs,
          drift: +drift.toFixed(2),
          rate,
          max_drift: +maxDriftRef.current.toFixed(2),
          elapsed,
          buffer_ahead: bufferAhead,
          effective_rate: effectiveRate,
        }).then(({ error }) => { if (error) console.warn("[hi-tension] sync log failed", error.message); });
      }
    }, 200);
    return () => clearInterval(timer);
  }, [syncActive, anonSessionId, memberId]);

  // --- 同期ドリフト補正ループ ---
  const stopDriftLoop = useCallback(() => {
    if (driftTimerRef.current) { clearInterval(driftTimerRef.current); driftTimerRef.current = null; }
    if (songStartTimerRef.current) { clearTimeout(songStartTimerRef.current); songStartTimerRef.current = null; }
    if (playbackTimeoutRef.current) { clearTimeout(playbackTimeoutRef.current); playbackTimeoutRef.current = null; }
    if (songstartReadyTimerRef.current) { clearInterval(songstartReadyTimerRef.current); songstartReadyTimerRef.current = null; }
    // 同期関連の状態をリセット（次回の再生開始時に持ち越さない）
    awaitingPlaybackRef.current = false;
    bufferRecoveryGraceUntilRef.current = 0;
    isBufferingRef.current = false;
    pauseUntilRef.current = 0;
    driftReportsRef.current.clear();
    driftStableSinceRef.current = 0;
    // warmupAnchorReceivedRef と clockAnchorRef はここではクリアしない。
    // startDriftLoop の冒頭でこの関数を呼ぶ「再起動リセット」用途で anchor まで
    // 消してしまうと、ホストの 3 秒ごと再 broadcast → handleWarmupStart で
    // skip 条件 (anchor 既存) が成立せず再 anchor → また startDriftLoop → また stopDriftLoop
    // で anchor が永久に null のままになり、debug useEffect も drift loop も
    // 「anchor なし」で skip し続ける。完全停止が必要な場所（handleVideoEnded 本動画終了・
    // handleBackToTop・handleChangeColor）で呼び側が個別にクリアする。
    // 実効再生速度の前回サンプルもクリア（次セッションは初回 log で null になる）
    prevSampleForRateRef.current = null;
  }, []);

  const startDriftLoop = useCallback(() => {
    stopDriftLoop();
    logHiEvent(anonSessionId, "drift_loop_start");
    let driftTickCount = 0;
    driftTimerRef.current = setInterval(() => {
      driftTickCount++;
      if (driftTickCount === 1) logHiEvent(anonSessionId, "drift_tick_first");
      if (driftTickCount % 10 === 0) logHiEvent(anonSessionId, "drift_tick", `count=${driftTickCount}`);
      const anchor = clockAnchorRef.current;
      const player = playerApiRef.current;
      if (!anchor || !player) {
        if (driftTickCount % 10 === 0) logHiEvent(anonSessionId, "drift_skip", `anchor=${!!anchor} player=${!!player}`);
        return;
      }

      const now = Date.now();
      const bufferAhead = getBufferAheadSec(player);

      // pause-and-wait 中（本動画のみ使う）は何もしない。resume は別 setTimeout が担当。
      if (pauseUntilRef.current > 0) return;
      // 連携終了→ソロ完走モード：以降は同期も drift 配信もしない（自分のペースで最後まで再生）。
      if (soloModeRef.current) return;

      const isPlaying = player.isPlaying();
      const expected = calculateExpected(anchor, now);
      const actual = player.getCurrentTime();
      const drift = normalizeDrift(anchor, expected - actual); // 正: 自分が遅れ, 負: 自分が先行

      // 異常値スキップ：loadVideo 直後の buffering 中は actual=0, bufferAhead<0 になり、
      // normalizeDrift が「ループ周期 62s」前提で誤計算する（例：actual=0 → 46-62=-16s で先行扱い）。
      // この異常値を broadcast すると他端末の相対判定を巻き込むので、broadcast 自体をスキップする。
      if (actual <= 0) return;
      if (bufferAhead < 0.5) return;

      // 自分の drift+buffer を全員に配信。他端末はこれを見て相対判定する。
      sendDriftReportRef.current(drift, bufferAhead);
      driftReportsRef.current.set(myKeyRef.current, {
        sessionId: myKeyRef.current,
        drift,
        bufferAhead,
        receivedAt: now,
      });

      if (!isPlaying) return;
      if (now < bufferRecoveryGraceUntilRef.current) return;

      // 直近 DRIFT_REPORT_TTL_MS 以内の他端末 report から min/max を集計
      let maxOtherDrift = drift;
      let minOtherDrift = drift;
      for (const report of driftReportsRef.current.values()) {
        if (report.sessionId === myKeyRef.current) continue;
        if (now - report.receivedAt > DRIFT_REPORT_TTL_MS) continue;
        if (report.drift > maxOtherDrift) maxOtherDrift = report.drift;
        if (report.drift < minOtherDrift) minOtherDrift = report.drift;
      }

      if (anchor.kind === "warmup") {
        // 暖機動画は rate 補正で両側調整。pause しない（黒画面・buffering を避ける）。
        const currentRate = player.getPlaybackRate();
        let targetRate = 1.0;
        if (drift > maxOtherDrift - WARMUP_RATE_THRESHOLD_SEC && drift > minOtherDrift + WARMUP_RATE_THRESHOLD_SEC) {
          // 自分が一番遅れている（max ≈ self）→ 速くする
          targetRate = WARMUP_RATE_UP;
        } else if (drift < minOtherDrift + WARMUP_RATE_THRESHOLD_SEC && drift < maxOtherDrift - WARMUP_RATE_THRESHOLD_SEC) {
          // 自分が一番進んでいる（min ≈ self）→ 遅くする
          targetRate = WARMUP_RATE_DOWN;
        }
        if (Math.abs(currentRate - targetRate) > 0.05) {
          player.setPlaybackRate(targetRate);
          logHiEvent(anonSessionId, "rate_set", `warmup rate=${targetRate} drift=${drift.toFixed(2)} otherMin=${minOtherDrift.toFixed(2)} otherMax=${maxOtherDrift.toFixed(2)}`);
        }
        return;
      }

      // 本動画：pause-and-wait（rate は触らない）
      const relativeDelay = maxOtherDrift - drift;
      // 友達待ちが ~2秒を超えそう＝カクッと止まる手前で、連携を切って自分は止まらずソロ完走する。
      // （旧：10秒待って seno-fail で全員待機室にリセット → 廃止）
      if (relativeDelay > SOLO_BAIL_SEC) {
        soloModeRef.current = true;
        pauseUntilRef.current = 0;
        player.play(); // 待ちで止めていたら再生に戻す
        setIsRealtimePlay(false); // ✋共有を外し、既存のソロ再生と同じ状態へ
        logHiEvent(anonSessionId, "go_solo", `relDelay=${relativeDelay.toFixed(2)} drift=${drift.toFixed(2)} maxOther=${maxOtherDrift.toFixed(2)}`);
        return;
      }
      if (relativeDelay > PAUSE_AND_WAIT_THRESHOLD_SEC) {
        const pauseMs = relativeDelay * 1000;
        player.pause();
        pauseUntilRef.current = now + pauseMs;
        logHiEvent(anonSessionId, "pause_called", `main pauseMs=${Math.round(pauseMs)} drift=${drift.toFixed(2)} maxOther=${maxOtherDrift.toFixed(2)}`);
        setTimeout(() => {
          if (pauseUntilRef.current > 0 && Date.now() >= pauseUntilRef.current) {
            pauseUntilRef.current = 0;
            playerApiRef.current?.play();
          }
        }, pauseMs);
      }
    }, DRIFT_CHECK_INTERVAL_MS);
  }, [stopDriftLoop, anonSessionId]);

  // --- 暖機動画の anchor 受信（待機室入室時 / 新メンバー入室時にホストが配る）---
  const handleWarmupStart = useCallback((t0: number, p0: number) => {
    // 既に anchor 確定済みなら無視（重複配信を防ぐ）
    if (warmupAnchorReceivedRef.current && clockAnchorRef.current) return;
    const offset = getClockOffsetRef.current();
    const anchor: ClockAnchor = { t0, p0, offset, kind: "warmup" };
    clockAnchorRef.current = anchor;
    warmupAnchorReceivedRef.current = true;
    setSyncActive(true);
    syncStartAtRef.current = Date.now();
    maxDriftRef.current = 0;

    // 初期同期: anchor が示す「今いるべき位置」と自分の現在位置を比較。
    // 差が WARMUP_INITIAL_SEEK_THRESHOLD_SEC 超なら loadVideo の startSeconds で一気に飛ばす。
    // pause-and-wait は 10秒上限なので、ループ周期内の最大半周期 (~31秒) は詰めきれないため、
    // 初期だけは loadVideo で位置同期する必要がある。
    const player = playerApiRef.current;
    if (player) {
      const nowMs = Date.now();
      const expectedPos = calculateExpected(anchor, nowMs);
      const actualPos = player.getCurrentTime();
      const initialDrift = normalizeDrift(anchor, expectedPos - actualPos);
      if (Math.abs(initialDrift) > WARMUP_INITIAL_SEEK_THRESHOLD_SEC) {
        // 0.5 秒分の予測（loadVideo の buffering 時間）を加算してからジャンプ
        const targetPos = calculateExpected(anchor, nowMs + 500);
        player.loadVideo(WARMUP_VIDEO_ID, { startSeconds: targetPos, endSeconds: WARMUP_VIDEO_END });
        bufferRecoveryGraceUntilRef.current = nowMs + BUFFER_RECOVERY_GRACE_MS;
        logHiEvent(anonSessionId, "warmup_initial_sync", `expected=${expectedPos.toFixed(2)} actual=${actualPos.toFixed(2)} jumpTo=${targetPos.toFixed(2)}`);
      }
    }

    startDriftLoop();
    logHiEvent(anonSessionId, "warmup_start_recv", `p0=${p0.toFixed(2)}`);
  }, [anonSessionId, startDriftLoop]);

  // --- 他端末の drift / buffer 受信（pause-and-wait の相対判定に使う）---
  const handleDriftReport = useCallback((report: LiveDriftReport) => {
    driftReportsRef.current.set(report.sessionId, report);
  }, []);

  // --- 全員 ✋押下後、ホストが「本動画遷移してよい状態」を監視するループ ---
  // 条件：全端末の drift report が新鮮、buffer >= 5s、|drift| <= 0.15s が 2 秒連続。
  // 10 秒経って成立しなければ sendSenoFail。
  const startSongstartReadyMonitor = useCallback(() => {
    if (songstartReadyTimerRef.current) clearInterval(songstartReadyTimerRef.current);
    driftStableSinceRef.current = 0;
    const startedAt = Date.now();
    logHiEvent(anonSessionId, "monitor_start", `n=${readyCheckGroupRef.current.length}`);
    songstartReadyTimerRef.current = setInterval(() => {
      const now = Date.now();
      // タイムアウト → 同期失敗で ready-check に戻す
      if (now - startedAt > SONGSTART_READY_TIMEOUT_MS) {
        // 各メンバーの最終 buffer/報告鮮度をスナップして失敗理由を残す
        const snap = readyCheckGroupRef.current.map(id => {
          const r = driftReportsRef.current.get(id);
          if (!r) return "none";
          return `buf=${r.bufferAhead.toFixed(1)},age=${now - r.receivedAt}`;
        }).join(" | ");
        logHiEvent(anonSessionId, "monitor_timeout", snap);
        if (songstartReadyTimerRef.current) { clearInterval(songstartReadyTimerRef.current); songstartReadyTimerRef.current = null; }
        sendSenoFailRef.current();
        return;
      }
      const group = readyCheckGroupRef.current;
      if (group.length === 0) return;
      // 全員の最新 report が新鮮か（TTL 以内）
      const reports: LiveDriftReport[] = [];
      for (const id of group) {
        const r = driftReportsRef.current.get(id);
        if (!r || now - r.receivedAt > DRIFT_REPORT_TTL_MS) {
          driftStableSinceRef.current = 0;
          return;
        }
        reports.push(r);
      }
      // 暖機動画の目的は iOS Safari の Play/Pause を効く状態に持ち込むこと + 回線/バッファを温める
      // ことであり、暖機中の同期は本来どうでもよい(本動画切替後に同期し直す)。
      // ドリフト整列を待つと暖機 anchor のズレで判定が成立せず seno-fail を量産していたため、
      // バッファ十分なら即 songstart を送る方針に変更。
      const allBuffered = reports.every(r => r.bufferAhead >= SONGSTART_BUFFER_THRESHOLD_SEC);
      if (!allBuffered) return;
      if (songstartReadyTimerRef.current) { clearInterval(songstartReadyTimerRef.current); songstartReadyTimerRef.current = null; }
      // t0 = 今 + LEAD_TIME_MS（Supabase時計）, p0 = 0（本動画は 0 秒から開始）
      const offset = getClockOffsetRef.current();
      const tReveal = now + offset + LEAD_TIME_MS;
      logHiEvent(anonSessionId, "songstart_send", `n=${reports.length}`);
      sendSongStartRef.current(tReveal, 0);
    }, 500);
  }, [anonSessionId]);

  // --- YouTube プレイヤー状態の監視 ---
  const handlePlayerStateChange = useCallback((state: number) => {
    // 診断ログ：待機室・ready-check・play すべての状態遷移を記録（暖機動画の挙動も追跡したいため）
    if (screenRef.current === "waiting" || screenRef.current === "ready-check" || screenRef.current === "play") {
      logHiEvent(anonSessionId, "state", YT_STATE_NAMES[state] ?? String(state));
    }
    if (state === 3 /* BUFFERING */) {
      isBufferingRef.current = true;
    } else if (state === 1 /* PLAYING */) {
      if (isBufferingRef.current) {
        isBufferingRef.current = false;
        bufferRecoveryGraceUntilRef.current = Date.now() + BUFFER_RECOVERY_GRACE_MS;
      }
    }
  }, [anonSessionId]);

  // --- realtime hook コールバック ---
  const clearSenoTimer = useCallback(() => {
    if (senoTimerRef.current) { clearTimeout(senoTimerRef.current); senoTimerRef.current = null; }
  }, []);

  // せーの受信: 自分がグループに入っていれば ready-check へ
  const handleSeno = useCallback((_senoAt: number, group: string[]) => {
    const included = group.includes(myKeyRef.current);
    logHiEvent(anonSessionId, "seno_recv", `included=${included} n=${group.length} seat=${mySeatIndexRef.current} host=${isHostRef.current}`);
    if (!included) return; // 後から来た人は対象外
    clearSenoTimer();
    readyCheckGroupRef.current = group;
    readiedSetRef.current = new Set();
    playbackReadyMapRef.current = new Map();
    awaitingPlaybackRef.current = false;
    awaitingSongStartRef.current = false;
    setSyncing(false);
    setReadyCheckGroup(group);
    setReadyCount(0);
    setSelfReadied(false);
    setReadyCheckFailed(false);
    setScreen("ready-check");
    // 暖機の warmup は muted のまま走らせ続ける（iframe/JS/CDN接続を維持）。
    // 本番動画への切替は✋押下時に一発でやる（ジェスチャー内で確実に再生開始）。
    // ※以前ここで cueVideo していたが、iOS 4G で cue 完了前に play() が来ると
    //   CUED→UNSTARTED の死に状態に陥り再生されなくなるため廃止。
    // ホストは窓の番人: 時間内に全員揃わなければ seno-fail を出す
    if (isHostRef.current) {
      senoTimerRef.current = setTimeout(() => {
        const grp = readyCheckGroupRef.current;
        const readied = grp.filter(id => readiedSetRef.current.has(id)).length;
        logHiEvent(anonSessionId, "seno_fail_send", `reason=ready_timeout readied=${readied}/${grp.length}`);
        sendSenoFailRef.current();
      }, SENO_FAIL_TIMEOUT_MS);
    }
  }, [clearSenoTimer, anonSessionId]);

  // ready 受信: 集計のみ。全員が✋を押したら、ホストが「全員 buffer + drift 安定」監視を開始。
  // 成立で sendSongStart（本動画遷移）、10秒タイムアウトで sendSenoFail。
  const handleReady = useCallback((sessionId: string) => {
    readiedSetRef.current.add(sessionId);
    const group = readyCheckGroupRef.current;
    const readied = group.filter(id => readiedSetRef.current.has(id)).length;
    setReadyCount(readied);
    if (isHostRef.current) logHiEvent(anonSessionId, "ready_recv", `${readied}/${group.length} member=${group.includes(sessionId)}`);
    if (isHostRef.current && group.length > 0 && group.every(id => readiedSetRef.current.has(id))) {
      clearSenoTimer();
      startSongstartReadyMonitor();
    }
  }, [clearSenoTimer, startSongstartReadyMonitor, anonSessionId]);

  // songstart 受信: 暖機動画 anchor から本動画 anchor に切替、本動画を loadVideo で再生開始。
  // ✋押下後 syncing 中の人だけ反応する（待機室・無関係な人は無視）。
  const handleSongStart = useCallback((t0: number, p0: number) => {
    // ✋押下して songstart 待ちの人 or ready-check で✋押した状態の人だけ
    if (!awaitingSongStartRef.current && screenRef.current !== "ready-check") return;
    awaitingSongStartRef.current = false;
    clearSenoTimer();
    logHiEvent(anonSessionId, "songstart_recv", `p0=${p0.toFixed(2)}`);
    const offset = getClockOffsetRef.current();
    clockAnchorRef.current = { t0, p0, offset, kind: "main" }; // 本動画 anchor に切替
    warmupAnchorReceivedRef.current = false;     // 暖機 anchor フラグ解除
    const localT0 = t0 - offset;
    const delay = localT0 - Date.now();
    const doSync = () => {
      songStartTimerRef.current = null;
      logHiEvent(anonSessionId, "dosync", `playing=${playerApiRef.current?.isPlaying()}`);
      logHiEvent(anonSessionId, "play_seat", `seat=${mySeatIndexRef.current}`); // 座標軸重なり調査：自分の席番号
      soloModeRef.current = false; // 新しい本編開始：前回のソロ状態を持ち越さない
      // 暖機動画から本動画へ切替（ここで loadVideo を呼ぶ。ジェスチャー外だが既に PLAYING なので iOS でも通る想定）
      isWarmupRef.current = false;
      // 暖機 drift loop で 0.75/1.25 倍速がセットされた直後に本動画切替に来ると rate が持ち越されて
      // 本動画が早送り/スロー再生になる（実機テストで iOS が rate=1.25 のまま本動画再生→ずっと早送り）。
      // loadVideo 前に明示的に 1.0 へ戻す。
      playerApiRef.current?.setPlaybackRate(1.0);
      playerApiRef.current?.unMute();
      playerApiRef.current?.loadVideo(VIDEO_ID);
      // PC（other）はデコード余力が乏しく rate≈0.97 になりがちで同期破綻の主因。
      // 低解像度を明示要求して負荷を激減させる（240p で画素数 約 1/12）。
      // iframe サイズ縮小（ステージモニター化）と併用すると確実性 UP。
      if (detectDevice() === "other") {
        playerApiRef.current?.setPlaybackQuality("small");
      }
      // 状態切替：syncing 終了、本動画再生中フラグ ON、画面遷移
      setSyncing(false);
      setIsRealtimePlay(true);
      setScreen("play");
      bufferRecoveryGraceUntilRef.current = Date.now() + SYNC_START_GRACE_MS;
      syncStartAtRef.current = Date.now();
      maxDriftRef.current = 0;
      // drift loop は暖機から続いているので start し直し（refs をリセットしたい場合に有効）
      startDriftLoop();
    };
    if (songStartTimerRef.current) clearTimeout(songStartTimerRef.current);
    if (delay > 0) {
      songStartTimerRef.current = setTimeout(doSync, delay);
    } else {
      doSync();
    }
  }, [clearSenoTimer, startDriftLoop, anonSessionId]);

  // せーの失敗: ready-check に留まったまま「息が合わなかった」表示。
  // ※本動画再生中（isRealtimePlay）は無視する。一度本編が始まったら待機室には戻さず、
  //   ズレた時は drift loop 側で「連携終了→ソロ完走」に切り替える方針のため。
  const handleSenoFail = useCallback(() => {
    // ✋押下後の awaitingSongStart 中、または ready-check 中の人だけ処理。
    // 本動画再生中・ソロ再生中・ロビーなどは無視。
    if (!awaitingSongStartRef.current && screenRef.current !== "ready-check") return;
    logHiEvent(anonSessionId, "seno_fail_recv", `screen=${screenRef.current} awaitSong=${awaitingSongStartRef.current} rtplay=${isRealtimePlayRef.current}`);
    clearSenoTimer();
    if (playbackTimeoutRef.current) { clearTimeout(playbackTimeoutRef.current); playbackTimeoutRef.current = null; }
    stopDriftLoop();
    // anchor もクリア → ホストの 3 秒ごと再 broadcast で新しい暖機 anchor がセットされる
    warmupAnchorReceivedRef.current = false;
    clockAnchorRef.current = null;
    readiedSetRef.current = new Set();
    playbackReadyMapRef.current = new Map();
    awaitingPlaybackRef.current = false;
    awaitingSongStartRef.current = false;
    setIsRealtimePlay(false);
    setSyncing(false);
    setReadyCount(0);
    setSelfReadied(false);
    setReadyCheckFailed(true);
    setScreen("ready-check"); // play に遷移済みでも ready-check に戻す
  }, [clearSenoTimer, stopDriftLoop, anonSessionId]);

  const handleTap = useCallback((tap: LiveTap) => {
    if (!isRealtimePlayRef.current || soloModeRef.current) return;
    // 【計装】✋座標軸の重なり調査用：相手のタップが自分と同じ席番号で届いた瞬間だけ記録。
    if (tap.seatIndex === mySeatIndexRef.current) {
      logHiEvent(anonSessionId, "seat_collision", `recv_seat=${tap.seatIndex} my_seat=${mySeatIndexRef.current} member=${tap.memberId}`);
    }
    // 片道ラグを実測: 受信時のサーバー時刻 − 送信時のサーバー時刻。
    // sentAt=0(旧クライアント or 欠落)や負値(時計逆転)は 0 にクランプ。
    const recvServerNow = Date.now() + getClockOffsetRef.current();
    const lagMs = tap.sentAt > 0 ? Math.max(0, recvServerNow - tap.sentAt) : 0;
    canvasRef.current?.receiveLiveTap(tap.memberId, tap.seatIndex, tap.videoTime, lagMs);
  }, [anonSessionId]);

  const handleBounce = useCallback((bounce: { sessionId: string }) => {
    setBouncingSessionId(bounce.sessionId);
    if (bounceTimerRef.current) clearTimeout(bounceTimerRef.current);
    bounceTimerRef.current = setTimeout(() => setBouncingSessionId(null), BOUNCE_DURATION_MS);
  }, []);

  const {
    participants,
    presenceKey,
    mySeatIndex,
    isHost,
    connected,
    channelError,
    getClockOffset,
    getBestRoundtrip,
    sendSeno,
    sendReady,
    sendSongStart,
    sendSenoFail,
    sendWarmupStart,
    sendDriftReport,
    broadcastTap,
    broadcastBounce,
  } = useHiTensionRealtime({
    sessionId: anonSessionId,
    memberId,
    roomCode,
    inWaitingRoom: screen === "waiting" || screen === "ready-check" || (screen === "play" && syncing),
    onSeno: handleSeno,
    onReady: handleReady,
    onSongStart: handleSongStart,
    onSenoFail: handleSenoFail,
    onTap: handleTap,
    onBounce: handleBounce,
    onWarmupStart: handleWarmupStart,
    onDriftReport: handleDriftReport,
  });

  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { myKeyRef.current = presenceKey; }, [presenceKey]);
  useEffect(() => { if (mySeatIndex >= 0) mySeatIndexRef.current = mySeatIndex; }, [mySeatIndex]);
  useEffect(() => { getClockOffsetRef.current = getClockOffset; }, [getClockOffset]);
  useEffect(() => { getBestRoundtripRef.current = getBestRoundtrip; }, [getBestRoundtrip]);
  useEffect(() => { sendSongStartRef.current = sendSongStart; }, [sendSongStart]);
  useEffect(() => { sendSenoFailRef.current = sendSenoFail; }, [sendSenoFail]);
  useEffect(() => { sendWarmupStartRef.current = sendWarmupStart; }, [sendWarmupStart]);
  useEffect(() => { sendDriftReportRef.current = sendDriftReport; }, [sendDriftReport]);

  // 【計装】待機室/ready-check での presence 変化を記録。
  // ランダム合流バグ調査用：ゴースト残留（n が実人数より多い）・seat ズレ・ホスト判定の取り違えを検出する。
  useEffect(() => {
    if (screen !== "waiting" && screen !== "ready-check") return;
    logHiEvent(anonSessionId, "presence", `room=${roomCode ?? "global"} n=${participants.length} seat=${mySeatIndex} host=${isHost}`);
  }, [participants, screen, mySeatIndex, isHost, roomCode, anonSessionId]);

  // ホストが待機室・ready-check 画面にいる間、暖機動画の anchor を 3 秒ごとに永続的に配信する。
  // 永続化の理由：
  //  - 新メンバー入室時に確実に anchor が届く（participants.length 依存だと race condition がある）
  //  - 同期失敗 (handleSenoFail) で anchor がクリアされた後、新しい anchor を自動再作成・配信できる
  //  - ホスト引き継ぎ時にも自然に新ホストが配信を開始する
  useEffect(() => {
    if (!isHost) return;
    if (screen !== "waiting" && screen !== "ready-check") return;

    const broadcastWarmupAnchor = () => {
      const player = playerApiRef.current;
      if (!player) return;
      // 既存の暖機 anchor がある → そのまま再 broadcast
      const existing = clockAnchorRef.current;
      if (existing && existing.kind === "warmup") {
        sendWarmupStartRef.current(existing.t0, existing.p0);
        return;
      }
      // anchor まだない → 暖機動画の再生位置が確定するのを待ってから作成
      const currentPos = player.getCurrentTime();
      if (currentPos < WARMUP_VIDEO_START) return;
      const offset = getClockOffsetRef.current();
      const t0 = Date.now() + offset;
      sendWarmupStartRef.current(t0, currentPos);
    };

    broadcastWarmupAnchor();
    const interval = setInterval(broadcastWarmupAnchor, 3000);
    return () => clearInterval(interval);
  }, [isHost, screen]);

  // 自分があふれ（3人目以降＝同じ合言葉に定員超で来た）か
  const isOverflow = mySeatIndex >= MAX_PARTICIPANTS;

  useEffect(() => {
    fetchHiSessions().then((data) => {
      setSessions(data);
      const totalHi = data.reduce((sum, s) => sum + s.bucket_indices.length, 0);
      console.log(`[hi-tension] loaded ${data.length} sessions, ${totalHi} hi total`);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (bounceTimerRef.current) clearTimeout(bounceTimerRef.current);
      clearSenoTimer();
      stopDriftLoop();
    };
  }, [clearSenoTimer, stopDriftLoop]);

  const clearPressTimers = useCallback(() => {
    if (pressIntervalRef.current) { clearInterval(pressIntervalRef.current); pressIntervalRef.current = null; }
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
  }, []);

  useEffect(() => { return () => clearPressTimers(); }, [clearPressTimers]);

  // 再生まわりの状態をリセットする
  const resetPlayState = () => {
    timestampsRef.current = [];
    submittedRef.current = false;
    videoEndedRef.current = false;
    soloModeRef.current = false; // 連携終了→ソロのフラグを次の再生に持ち越さない
    setVideoEnded(false);
    setEndedSelfCount(0);
    setSelfPressCount(0);
  };

  // ひとりで始める
  const handleConfirm = (id: string) => {
    // ★ iOS Safari autoplay 対策: gesture スコープ内で最初に呼ぶ
    logHiEvent(anonSessionId, "play_called", "confirm");
    isWarmupRef.current = false;
    playerApiRef.current?.unMute();
    playerApiRef.current?.loadVideo(VIDEO_ID); // warmup が乗ってる可能性があるので明示的に本番動画をロード
    setMemberId(id);
    setLastSelectedMemberId(id);
    setSeatHash(newSeatHash());
    resetPlayState();
    setPlaySeatIndex(-1);
    setIsRealtimePlay(false);
    setScreen("play");
  };

  // 合言葉の部屋メニューを開く
  const handleOpenRoomMenu = (id: string) => {
    setMemberId(id);
    setLastSelectedMemberId(id);
    setScreen("room-menu");
  };

  // 合言葉で部屋に入る（部屋作成は廃止。同じ合言葉を入れた人同士で合流し、入室順で
  // 先頭が自動的にホストになる）
  const handleJoinRoom = (code: string) => {
    setRoomCode(code);
    setEnteredByCode(true); // コードを打って入った → 打ち間違い時に入れ直せるように
    setSeatHash(newSeatHash());
    // 待機室で暖機動画を音付き再生（出囃子）。cover で切替の隙間に本編サムネが見えるのを防ぐ。
    isWarmupRef.current = true;
    playerApiRef.current?.unMute();
    playerApiRef.current?.loadVideo(WARMUP_VIDEO_ID, { ...WARMUP_LOAD_OPTS, cover: true });
    setScreen("waiting");
  };

  // 部屋メニュー → 色選択に戻る
  const handleRoomMenuBack = () => {
    setScreen("select");
  };

  // 合言葉部屋の待機室 → コード入力画面に戻る（打ち間違えた時の入れ直し）。
  // 「ロビーに戻る」同様、出囃子(暖機動画)を止めて同期状態もリセットする。
  // （止めないと room-menu に移っても暖機動画の音が鳴り続ける。inWaitingRoom が
  //  false になるのでリアルタイム接続自体は自動で切れる）
  const handleReenterCode = () => {
    clearSenoTimer();
    stopDriftLoop();
    setSyncActive(false);
    warmupAnchorReceivedRef.current = false;
    clockAnchorRef.current = null;
    isWarmupRef.current = false;
    playerApiRef.current?.pause();
    setScreen("room-menu");
  };

  // 待機室 / ready-check → 色選択に戻る
  const handleBackToTop = () => {
    clearSenoTimer();
    stopDriftLoop();
    setSyncActive(false); // ロビーに戻る → 同期動作を完全停止
    warmupAnchorReceivedRef.current = false;
    clockAnchorRef.current = null;
    // 暖機/cue 中の動画を止める（ロビーに戻ったら鳴らない/データ消費しない）
    isWarmupRef.current = false;
    playerApiRef.current?.pause();
    setRoomCode(null);
    setEnteredByCode(false);
    setScreen("select");
  };

  // --- 画面 ↔ URL 履歴の連携（ブラウザ/端末の戻るで1画面ずつ戻れるように）---
  const navigate = useNavigate();
  const location = useLocation();
  const skipUrlSyncRef = useRef(false);

  // 戻る/進む で URL が screen とズレたとき、screen を URL のレベルに合わせて後始末する
  const reconcileToLevel = (level: number) => {
    // 部屋/待機/セッションのURLに直接来た・リロードした等で状態(メンバー)が無いならロビーへ
    if (level >= 1 && !memberId) {
      navigate("/hi-tension", { replace: true });
      return;
    }
    const target: Screen =
      level === 0 ? "select" : level === 1 ? "room-menu" : level === 2 ? "waiting" : "ready-check";
    // 共通の後始末（セッション・タイマー・同期を畳む）
    clearSenoTimer();
    stopDriftLoop();
    warmupAnchorReceivedRef.current = false;
    clockAnchorRef.current = null;
    readiedSetRef.current = new Set();
    playbackReadyMapRef.current = new Map();
    awaitingPlaybackRef.current = false;
    awaitingSongStartRef.current = false;
    soloModeRef.current = false;
    setIsRealtimePlay(false);
    setSyncing(false);
    setSelfReadied(false);
    setReadyCheckFailed(false);
    setReadyCount(0);
    if (target === "waiting") {
      // 部屋に戻る：暖機を再開（出囃子）。※iOSはジェスチャー外なので自動再生しないことがある。
      setSyncActive(true);
      isWarmupRef.current = true;
      playerApiRef.current?.setPlaybackRate(1.0);
      playerApiRef.current?.unMute();
      playerApiRef.current?.loadVideo(WARMUP_VIDEO_ID, { ...WARMUP_LOAD_OPTS, cover: true });
    } else {
      setSyncActive(false);
      isWarmupRef.current = false;
      playerApiRef.current?.pause();
      if (target === "select") setRoomCode(null);
    }
    skipUrlSyncRef.current = true; // この setScreen で URL push を再発火させない
    setScreen(target);
  };

  // screen が変わったら URL を合わせる（前進=push / 後退・同レベルへの戻し=replace）
  useEffect(() => {
    if (skipUrlSyncRef.current) { skipUrlSyncRef.current = false; return; }
    const level = SCREEN_LEVEL[screen];
    const urlLevel = searchToLevel(window.location.search);
    if (level === urlLevel) return;
    navigate(`/hi-tension${LEVEL_SEARCH[level]}`, { replace: level < urlLevel });
  }, [screen, navigate]);

  // 戻る/進む（location 変化）で URL が screen とズレたら合わせ直す
  useEffect(() => {
    const urlLevel = searchToLevel(location.search);
    if (urlLevel === SCREEN_LEVEL[screenRef.current]) return;
    reconcileToLevel(urlLevel);
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  // やっぱりひとりで（待機室から直接再生。inWaitingRoom が false になり自動で untrack される）
  const handleSolo = () => {
    // gesture スコープ内なので iOS でも play() が通る。warmup→本番動画へ切替。
    logHiEvent(anonSessionId, "play_called", "solo");
    isWarmupRef.current = false;
    playerApiRef.current?.unMute();
    playerApiRef.current?.loadVideo(VIDEO_ID);
    resetPlayState();
    setPlaySeatIndex(-1);
    setIsRealtimePlay(false);
    setScreen("play");
  };

  // ホストが「せーの」を押す（待機室）
  const handleSenoButton = () => {
    const group = participants.slice(0, MAX_PARTICIPANTS).map(p => p.sessionId);
    if (group.length < MAX_PARTICIPANTS) return; // 2人揃うまでせーのしない（ボタン無効化のバックストップ）
    logHiEvent(anonSessionId, "seno_send", `n=${group.length} parts=${participants.length} seat=${mySeatIndex} host=${isHost}`);
    sendSeno(group);
  };

  // ホストが失敗後「もう一回 せーの」を押す（同じグループで再挑戦、抜けた人は除外）
  const handleRetrySeno = () => {
    const present = new Set(participants.map(p => p.sessionId));
    const group = readyCheckGroupRef.current.filter(id => present.has(id));
    if (group.length === 0) return;
    logHiEvent(anonSessionId, "seno_send", `retry room=${roomCode ?? "global"} n=${group.length} parts=${participants.length} seat=${mySeatIndex} host=${isHost}`);
    sendSeno(group);
  };

  // ready-check で✋を押す（＝参加＆開始の意思表明）。
  // 暖機動画はそのまま継続。本動画への切替は songstart 受信時（暖機 drift 安定後）に行う。
  const handleReadyTap = () => {
    if (selfReadied) return;
    logHiEvent(anonSessionId, "ready_tap");
    awaitingSongStartRef.current = true;
    resetPlayState();
    setSelfReadied(true);
    setPlaySeatIndex(mySeatIndexRef.current);  // 手の整列用に席番号を保存
    setSyncing(true);  // songstart まで presence track を維持（ホスト判定を生かす）
    sendReady();
    // 画面遷移なし（ready-check のまま）、loadVideo 呼ばない（暖機継続）
  };

  const handleVideoEnded = () => {
    // warmup クリップが endSeconds に達した時もここに来る。本番ではなく単に頭から再ロードしてループ。
    if (isWarmupRef.current) {
      playerApiRef.current?.loadVideo(WARMUP_VIDEO_ID, WARMUP_LOAD_OPTS);
      return;
    }
    clearPressTimers();
    stopDriftLoop();
    setSyncActive(false); // 本動画終了 → 同期動作を完全停止
    warmupAnchorReceivedRef.current = false;
    clockAnchorRef.current = null;
    setIsPressed(false);
    videoEndedRef.current = true;
    const count = timestampsRef.current.length;
    console.log(`[hi-tension] video ended (${count} presses)`);
    setEndedSelfCount(count);
    setVideoEnded(true);
    if (submittedRef.current) return;
    if (!memberId || count === 0) return;
    submittedRef.current = true;
    submitHiSession({
      memberId,
      timestamps: timestampsRef.current.slice(),
      anonymousSessionId: anonSessionId,
    }).then((result) => {
      if (result.ok) { console.log("[hi-tension] session saved."); }
      else { console.warn("[hi-tension] save failed:", result.error); submittedRef.current = false; }
    });
  };

  const handleChangeColor = () => {
    playerApiRef.current?.pause();
    clearPressTimers();
    stopDriftLoop();
    setSyncActive(false); // ロビーに戻る → 同期動作を完全停止
    warmupAnchorReceivedRef.current = false;
    clockAnchorRef.current = null;
    resetPlayState();
    setIsPressed(false);
    setRoomCode(null);
    setScreen("select");
  };

  const handleReplay = () => {
    playerApiRef.current?.replay(); // gesture スコープ内
    resetPlayState();
    setIsPressed(false);
    setSeatHash(newSeatHash());
    fetchHiSessions().then(setSessions);
  };

  const handleTimeUpdate = useCallback((t: number) => {
    currentTimeRef.current = t;
    // ✋の物差しは「実際の動画位置(t)」をそのまま使う。recordHi(送信側)も同じ。
    // 2台の動画は pause-and-wait でお互いほぼ揃っている一方、抽象クロックは起動時の
    // 出遅れ(約1秒)ぶん映像とズレるため、クロック基準だと✋が映像から定常的にズレる。
    // 映像位置基準にすると✋が映像にちゃんと乗る（端末間の残差は ~0.15秒）。
    canvasRef.current?.onTimeUpdate(t);
  }, []);

  const recordHi = useCallback(() => {
    if (videoEndedRef.current) return;
    // ✋の videoTime は実際の動画位置を使う（受信側 handleTimeUpdate と同じ物差し）。
    // 抽象クロック基準だと映像との定常ズレ(約1秒)が✋に出るため。
    const t = currentTimeRef.current;
    timestampsRef.current.push(t);
    setSelfPressCount((c) => c + 1); // ごほうび表示のカウントアップ（押すたび弾む）
    console.log(`[hi-tension] HI! @ ${t.toFixed(2)}s`);
    canvasRef.current?.spawnSelf();
    if (isRealtimePlayRef.current && !soloModeRef.current) broadcastTap(t);
  }, [broadcastTap]);

  const handlePressStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsPressed(true);
    recordHi();
    clearPressTimers();
    holdTimerRef.current = setTimeout(() => {
      pressIntervalRef.current = setInterval(recordHi, LONG_PRESS_INTERVAL_MS);
    }, LONG_PRESS_THRESHOLD_MS);
  };

  const handlePressEnd = () => {
    setIsPressed(false);
    clearPressTimers();
  };

  const member = findMember(memberId);

  return (
    <>
      <style>{`
        @keyframes hi-tension-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/* FPS計測（開発モード or ?hidebug=1 のみ。本番ビルドには出ない）。混雑時の最低fpsを測る用 */}
      {(import.meta.env.DEV || HI_DEBUG) && <FpsMeter />}

      {/* 同期デバッグ表示（?hidebug=1 の時だけ。本番では出さない） */}
      {HI_DEBUG && debugInfo && (
        <div
          style={{
            position: "fixed",
            top: 4,
            left: 4,
            zIndex: 300,
            background: "rgba(0,0,0,0.72)",
            color: "#0f0",
            fontSize: "0.6rem",
            fontFamily: "monospace",
            padding: "4px 6px",
            lineHeight: 1.4,
            pointerEvents: "none",
            whiteSpace: "pre",
          }}
        >
          {`offset a/l: ${debugInfo.anchorOffset} / ${debugInfo.liveOffset}\nrtt: ${debugInfo.rtt}ms\ndrift: ${debugInfo.drift}s\nmaxDrift: ${debugInfo.maxDrift}s\nrate: ${debugInfo.rate}x\nbuf: ${debugInfo.bufferAhead}s\nelapsed: ${debugInfo.elapsed}s`}
        </div>
      )}

      {/* Play screen は常時マウント */}
      <div
        style={{
          height: "100dvh",
          overflow: "hidden",
          background: "#f8f9fa",
          color: "#191c1d",
          fontFamily: "Inter, 'Noto Sans JP', sans-serif",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* PC（other）では動画を PC_VIDEO_WIDTH に縮めて「ステージモニター」風に表示。
            iframe の表示サイズを小さくすることで YouTube が低解像度を自動選択しやすくなり、
            PC ブラウザのデコード負荷が下がる（rate≈1.0 維持＝同期破綻防止）。
            iOS/Android はモバイルの縦画面いっぱいで従来通り。 */}
        <div
          style={{
            position: "relative",
            zIndex: 2, // ✋キャンバスより前面＝跳ねた✋の先が動画の裏に隠れる（動画の延長感）
            ...(detectDevice() === "other"
              ? { width: PC_VIDEO_WIDTH, maxWidth: "100%", margin: "0 auto" }
              : {}),
          }}
        >
          <YouTubePlayer
            ref={playerApiRef}
            videoId={VIDEO_ID}
            onEnded={handleVideoEnded}
            onTimeUpdate={handleTimeUpdate}
            onPlayerStateChange={handlePlayerStateChange}
          />
        </div>

        {/* HandsCanvas と recordHi ボタン等は本動画再生中（play）の時のみマウント。
            ＊YouTubePlayer は上で常時マウント維持（暖機動画を切らさないため）。
            waiting / ready-check の状態では下半分が空になり、その上に WaitingRoom / ReadyCheck が
            通常通りオーバーレイされる。これまでは常時マウントしていたため、PC で動画を 360px に
            縮小すると下層の recordHi ボタンが WaitingRoom 上端の隙間に透けて見えていた。 */}
        {screen === "play" && (
          <div
            style={{
              flex: 1,
              // minHeight:0 は完走後のスクロール用。再生中に効かせると iPhone SE 等で残り高さに
              // 合わせて中身が圧縮され、丸い✋ボタンが楕円に潰れるため、完走後だけにする。
              minHeight: videoEnded ? 0 : undefined,
              position: "relative",
              // 動画より背面に置く（z:1 < 動画 z:2）＝中の✋キャンバスが動画の裏へ回り込める。
              // 潜り込みは HandsCanvas 側で top:-40（✋だけ。カウント/ボタンは動かさない）。
              zIndex: 1,
              isolation: "isolate", // 子の z-index を安定させる（✋履歴=2 / 中断=1 / タップ✋・免責=3）
              // 再生中は「客電落ち」の暗いアリーナ。完走後(EndCard)は明るいままにしたいので !videoEnded のみ。
              background: videoEnded
                ? undefined
                : "radial-gradient(150% 85% at 50% -8%, #1b2030 0%, #0e1016 48%, #07080c 100%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              // 完走後の終了画面は iPhone SE 等の短い画面だと縦に収まらず、外側の overflow:hidden で
              // シェアボタン・著作権表記が切れる。完走後だけ縦スクロールを許可して必ず届くようにする。
              // 再生中はタップボタンを動かしたくないのでスクロールさせない。
              overflowY: videoEnded ? "auto" : undefined,
              WebkitOverflowScrolling: "touch",
              padding: videoEnded ? "1.2rem 1.2rem 2rem" : "2.4rem 1.2rem 2rem",
            }}
          >
            {/* ステージ照明：上から差す光がゆっくり明滅して「たまに照らされる」。✋(z:2)の背面(z:0)。 */}
            {!videoEnded && (
              <>
                <style>{`@keyframes hopStageLight{0%,100%{opacity:0.2}40%{opacity:0.75}65%{opacity:0.35}}`}</style>
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 0,
                    pointerEvents: "none",
                    background:
                      "radial-gradient(95% 55% at 50% -4%, rgba(120,160,255,0.30), rgba(190,120,255,0.10) 42%, transparent 70%)",
                    mixBlendMode: "screen",
                    animation: "hopStageLight 10s ease-in-out infinite",
                  }}
                />
              </>
            )}

            <HandsCanvas
              key={seatHash}
              ref={canvasRef}
              sessions={sessions}
              selfMemberId={memberId}
              selfSeatHash={seatHash}
              selfSeatIndex={isRealtimePlay ? playSeatIndex : -1}
              enableSides={detectDevice() === "other"}
              overrideColor={isNishidaBirthday() ? NISHIDA_COLOR : undefined}
              onPixiEvent={(event, detail) => logHiEvent(anonSessionId, event, detail)}
            />

            {videoEnded ? (
              <div style={{ position: "relative", zIndex: 3, width: "100%", display: "flex", justifyContent: "center" }}>
                <EndCard
                  selfCount={endedSelfCount}
                  totalCount={sessions.reduce((sum, s) => sum + s.bucket_indices.length, 0) + endedSelfCount}
                  memberColor={member?.color ?? "#000"}
                  onReplay={handleReplay}
                  onChangeColor={handleChangeColor}
                />
              </div>
            ) : (
              <div
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "1rem",
                  minHeight: 120,
                  zIndex: 3,
                }}
              >
                {/* ごほうび：押した回数。押すたび桁が弾んでカウントアップ（音の代わりの手応え）。 */}
                <BouncyNumber value={selfPressCount} color={(isNishidaBirthday() ? NISHIDA_COLOR : member?.color) ?? "#000"} size="2rem" />
                <button
                  type="button"
                  onPointerDown={handlePressStart}
                  onPointerUp={handlePressEnd}
                  onPointerLeave={handlePressEnd}
                  onPointerCancel={handlePressEnd}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    width: BUTTON_SIZE,
                    height: BUTTON_SIZE,
                    flexShrink: 0, // 縦が足りない画面でも丸を保つ（楕円に潰れない）
                    borderRadius: "50%",
                    background: (isNishidaBirthday() ? NISHIDA_COLOR : member?.color) ?? "#000",
                    color: "#fff",
                    border: "none",
                    cursor: "pointer",
                    // 暗いアリーナ背景＋濃いメンカラでも埋もれないよう白リングで縁取り。
                    boxShadow: isPressed
                      ? "0 0 0 3px rgba(255,255,255,0.92), 0 0 0 11px rgba(255,255,255,0.14)"
                      : "0 0 0 3px rgba(255,255,255,0.92), 0 6px 20px rgba(0,0,0,0.4)",
                    transform: isPressed ? "scale(0.92)" : "scale(1)",
                    transition: "transform 0.12s, box-shadow 0.12s",
                    touchAction: "manipulation",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    WebkitTouchCallout: "none",
                    WebkitTapHighlightColor: "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                  }}
                >
                  <HandIcon size={Math.round(BUTTON_SIZE * 0.55)} color="#fff" />
                </button>
              </div>
            )}

            {/* 下部：戻る（他画面と同じく下部左に統一）＋ 著作権表記 */}
            <div
              style={{
                marginTop: "auto",
                paddingTop: "2.4rem",
                width: "100%",
                maxWidth: 360,
                position: "relative",
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
              }}
            >
              {/* 中断導線：z-order を✋履歴より下(z:1)にして、✋がボタンの上に被るように。
                  ✋キャンバスは pointerEvents:none なのでクリックは透過して効く。 */}
              {!videoEnded && (
                <div style={{ display: "flex", justifyContent: "flex-start", position: "relative", zIndex: 1 }}>
                  <NavButton direction="back" onClick={handleChangeColor} background="#00873e" color="#fff">
                    中断して戻る
                  </NavButton>
                </div>
              )}
              <p
                style={{
                  margin: 0,
                  fontSize: "0.625rem",
                  color: "#777",
                  textAlign: "center",
                  lineHeight: 1.6,
                  position: "relative",
                  zIndex: 3,
                }}
              >
                楽曲・映像の著作権は権利者に帰属します。
                <br />
                権利者からの申し出により直ちに公開を停止します。
                <br />
                <span style={{ fontSize: "0.5rem", color: "#999" }}>
                  Hand icon by Font Awesome (CC BY 4.0)
                </span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Select 画面 */}
      {screen === "select" && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#f8f9fa", overflowY: "auto" }}>
          <MemberSelect
            initialSelectedId={memberId}
            onConfirm={handleConfirm}
            onOpenRoomMenu={handleOpenRoomMenu}
          />
        </div>
      )}

      {/* 合言葉の部屋メニュー。ラッパーにも背景を敷く（RoomMenu のフェードイン中に背後の
          動画サムネが一瞬透けるのを防ぐ。select 画面のラッパーと同じ扱い）。 */}
      {screen === "room-menu" && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#f8f9fa" }}>
          <RoomMenu
            onJoin={handleJoinRoom}
            onBack={handleRoomMenuBack}
          />
        </div>
      )}

      {/* 待機室・ready-check は動画ラッパーの直下に重ねる。動画の実高さに合わせて top を計算：
          PC（other）: 動画ラッパーを PC_VIDEO_WIDTH に縮めているので 16:9 で PC_VIDEO_HEIGHT_PX。
          モバイル: 動画は画面幅いっぱい × 9/16 = 56.25vw。 */}
      {(() => {
        const overlayTop = detectDevice() === "other" ? `${PC_VIDEO_HEIGHT_PX}px` : "56.25vw";
        return (
          <>
            {screen === "waiting" && (
              <WaitingRoom
                participants={participants}
                mySessionId={presenceKey}
                isHost={isHost}
                connected={connected}
                channelError={channelError}
                isOverflow={isOverflow}
                roomCode={roomCode}
                enteredByCode={enteredByCode}
                onBounceSignal={broadcastBounce}
                bouncingSessionId={bouncingSessionId}
                onSeno={handleSenoButton}
                onSolo={handleSolo}
                onReenterCode={handleReenterCode}
                onBackToTop={handleBackToTop}
                topOffset={overlayTop}
              />
            )}

            {screen === "ready-check" && (
              <ReadyCheck
                isHost={isHost}
                selfReadied={selfReadied}
                readyCount={readyCount}
                groupSize={readyCheckGroup.length}
                failed={readyCheckFailed}
                memberColor={member?.color ?? "#000"}
                onReadyTap={handleReadyTap}
                onRetrySeno={handleRetrySeno}
                onQuit={handleBackToTop}
                topOffset={overlayTop}
              />
            )}
          </>
        );
      })()}
    </>
  );
}
