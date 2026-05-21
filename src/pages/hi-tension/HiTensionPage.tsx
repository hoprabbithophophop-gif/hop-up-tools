import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import MemberSelect from "./components/MemberSelect";
import YouTubePlayer, { type YouTubePlayerApi } from "./components/YouTubePlayer";
import HandsCanvas, { type HandsCanvasApi } from "./components/HandsCanvas";
import WaitingRoom from "./WaitingRoom";
import RoomMenu from "./RoomMenu";
import ReadyCheck from "./ReadyCheck";
import { VIDEO_ID, findMember } from "./data";
import {
  getLastSelectedMemberId,
  setLastSelectedMemberId,
  getOrCreateAnonymousSessionId,
} from "./storage";
import { submitHiSession, fetchHiSessions, type HiSession } from "./api";
import { useHiTensionRealtime, MAX_PARTICIPANTS, SENO_WINDOW_MS, generateRoomCode } from "./useHiTensionRealtime";
import EndCard from "./components/EndCard";
import HandIcon from "./components/HandIcon";
import { getSupabase } from "@/lib/supabase";

// 同期デバッグ用のデバイス判定（後で削除）
function detectDevice(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  return "other";
}
const SYNC_LOG_INTERVAL_MS = 3000;

type Screen = "select" | "room-menu" | "waiting" | "ready-check" | "play";

const LONG_PRESS_INTERVAL_MS = 150;
const LONG_PRESS_THRESHOLD_MS = 250;
const BUTTON_SIZE = 120;
const BOUNCE_DURATION_MS = 400;

// せーの失敗判定: 窓 + ready 受信のための余裕
const SENO_FAIL_TIMEOUT_MS = SENO_WINDOW_MS + 1500;
// 同期ドリフト補正
const DRIFT_CHECK_INTERVAL_MS = 1000;
// 3段階階層: dead zone → soft sync (rate) → hard sync (seek)
const DEAD_ZONE_SEC = 0.15;               // ここ未満は無視（±150ms 目標＝半拍未満）
const SOFT_SYNC_MAX_SEC = 2.0;            // ここ未満は rate 補正、超えたら seek
const RATE_FAST = 1.25;                   // 自分が遅れてる時の加速
const RATE_SLOW = 0.75;                   // 自分が先行してる時の減速
const RATE_HOLD_MAX_MS = 5000;            // rate 維持の最大時間
const SEEK_COOLDOWN_MS = 3000;            // seek直後の再 seek を抑制する間隔
const SEEK_LEAD_TRIGGER_SEC = 1.5;        // ズレがこれを超えたら先回り seek
const SEEK_LEAD_SEC = 1.5;                // 先回り秒（バッファリング中に進むぶんを見越す）
// バッファ検知とリカバリ
const BUFFER_RECOVERY_GRACE_MS = 2500;    // バッファ復帰後の補正禁止猶予
// 諦めモード（連続バッファで seek を諦める）
const GIVE_UP_BUFFER_COUNT = 3;           // この回数以上バッファったら諦めモード
const GIVE_UP_WINDOW_MS = 30000;          // バッファ回数を数える窓
const GIVE_UP_THRESHOLD_SEC = 0.5;        // 諦めモード時のしきい値（rate補正のみ）。手のアニメが見えなくなる前に強めの rate 補正を入れる
// Plan E: 全員一斉再生（pause を使わず、再生継続したまま rate sync で揃える）
const LEAD_TIME_MS = 300;                 // songstart 送信から一斉リビール(ドットウェーブを外す)までの先取り時間。短いほど裏再生時間が減り iOS の自動 pause も避けやすい
const RATE_HOLD_FACTOR = 0.7;             // rate 補正の hold を控えめにしてオーバーシュート(振動)を防ぐ
const PLAYBACK_READY_TIMEOUT_MS = 5000;   // playback-ready が揃わない時、ホストが待つ上限

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
  const [isRealtimePlay, setIsRealtimePlay] = useState(false);
  const [bouncingSessionId, setBouncingSessionId] = useState<string | null>(null);
  // 部屋コード。null = グローバル部屋、文字列 = 合言葉の専用部屋
  const [roomCode, setRoomCode] = useState<string | null>(null);
  // ready-check 状態
  const [readyCheckGroup, setReadyCheckGroup] = useState<string[]>([]);
  const [readyCount, setReadyCount] = useState(0);
  const [selfReadied, setSelfReadied] = useState(false);
  const [readyCheckFailed, setReadyCheckFailed] = useState(false);
  // 再生中の手の整列用の自分の席番号（ソロ時は -1）
  const [playSeatIndex, setPlaySeatIndex] = useState(-1);
  // 同期デバッグ表示（原因特定用、後で削除）
  const [debugInfo, setDebugInfo] = useState<{
    anchorOffset: number; liveOffset: number; rtt: number; drift: number; rate: number;
    maxDrift: number; elapsed: number;
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
  // 曲開始の基準点。t0/p0 は Supabase 時計基準、offset は開始時の対 Supabase 時計ズレを凍結したもの
  const clockAnchorRef = useRef<{ t0: number; p0: number; offset: number } | null>(null);
  const driftTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSeekAtRef = useRef<number>(0);
  // Plan E（全員一斉再生）の状態
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
  // バッファ検知関連
  const isBufferingRef = useRef(false);
  const bufferRecoveryGraceUntilRef = useRef(0);
  const bufferingTimestampsRef = useRef<number[]>([]);
  const lowQualityModeRef = useRef(false);
  // rate 補正中の hold タイマー（再判定までの保持時間）
  const rateHoldUntilRef = useRef(0);
  const getClockOffsetRef = useRef<() => number>(() => 0);
  const getBestRoundtripRef = useRef<() => number>(() => Infinity);
  const sendSongStartRef = useRef<(t0: number, p0: number) => void>(() => {});
  const sendSenoFailRef = useRef<() => void>(() => {});

  useEffect(() => { isRealtimePlayRef.current = isRealtimePlay; }, [isRealtimePlay]);
  useEffect(() => { screenRef.current = screen; }, [screen]);

  // 同期デバッグ表示の更新ループ（原因特定用、後で削除）
  useEffect(() => {
    if (!isRealtimePlay) { setDebugInfo(null); return; }
    const timer = setInterval(() => {
      const anchor = clockAnchorRef.current;
      const player = playerApiRef.current;
      if (!anchor || !player) return;
      const supabaseNow = Date.now() + anchor.offset;
      const expected = anchor.p0 + (supabaseNow - anchor.t0) / 1000;
      const actual = player.getCurrentTime();
      const rtt = getBestRoundtripRef.current();
      const drift = expected - actual;
      if (Math.abs(drift) > maxDriftRef.current) maxDriftRef.current = Math.abs(drift);
      const liveOffset = Math.round(getClockOffsetRef.current());
      const rttMs = Number.isFinite(rtt) ? Math.round(rtt) : -1;
      const rate = player.getPlaybackRate();
      const elapsed = syncStartAtRef.current ? Math.round((Date.now() - syncStartAtRef.current) / 1000) : 0;
      setDebugInfo({
        anchorOffset: Math.round(anchor.offset),
        liveOffset,
        rtt: rttMs,
        drift: +drift.toFixed(2),
        rate,
        maxDrift: +maxDriftRef.current.toFixed(2),
        elapsed,
      });
      // 3秒ごとに Supabase へ記録（手打ち不要にする。後で削除）
      const now = Date.now();
      if (now - lastSyncLogAtRef.current >= SYNC_LOG_INTERVAL_MS) {
        lastSyncLogAtRef.current = now;
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
        }).then(({ error }) => { if (error) console.warn("[hi-tension] sync log failed", error.message); });
      }
    }, 200);
    return () => clearInterval(timer);
  }, [isRealtimePlay]);

  // --- 同期ドリフト補正ループ ---
  const stopDriftLoop = useCallback(() => {
    if (driftTimerRef.current) { clearInterval(driftTimerRef.current); driftTimerRef.current = null; }
    if (songStartTimerRef.current) { clearTimeout(songStartTimerRef.current); songStartTimerRef.current = null; }
    if (playbackTimeoutRef.current) { clearTimeout(playbackTimeoutRef.current); playbackTimeoutRef.current = null; }
    // 同期関連の状態をリセット（次回の再生開始時に持ち越さない）
    awaitingPlaybackRef.current = false;
    rateHoldUntilRef.current = 0;
    bufferRecoveryGraceUntilRef.current = 0;
    isBufferingRef.current = false;
    bufferingTimestampsRef.current = [];
    lowQualityModeRef.current = false;
    lastSeekAtRef.current = 0;
    // 再生速度を 1.0 に戻す（rate 補正中に動画が終わるケース等）
    if (playerApiRef.current?.getPlaybackRate() !== 1) {
      playerApiRef.current?.setPlaybackRate(1);
    }
  }, []);

  const startDriftLoop = useCallback(() => {
    stopDriftLoop();
    driftTimerRef.current = setInterval(() => {
      const anchor = clockAnchorRef.current;
      const player = playerApiRef.current;
      if (!anchor || !player) return;
      // 再生中以外（一時停止/バッファリング）は補正しない
      if (!player.isPlaying()) return;
      // バッファ復帰直後はプレイヤーの位置情報が不安定なので猶予期間を置く
      if (Date.now() < bufferRecoveryGraceUntilRef.current) return;
      // rate 補正中の hold 期間中は判定スキップ（rate を変えたら効果が出るまで待つ）
      if (Date.now() < rateHoldUntilRef.current) return;

      // offset は開始時に凍結済み。anchor は Supabase 時計基準。
      const supabaseNow = Date.now() + anchor.offset;
      const expected = anchor.p0 + (supabaseNow - anchor.t0) / 1000;
      const actual = player.getCurrentTime();
      if (actual <= 0 || expected <= 0) return;

      const drift = expected - actual;   // 正: 自分が遅れ、負: 自分が先行
      const absDrift = Math.abs(drift);

      // dead zone: ほぼ揃ってる → rate が 1.0 でなければ戻す
      if (absDrift < DEAD_ZONE_SEC) {
        if (player.getPlaybackRate() !== 1.0) player.setPlaybackRate(1.0);
        return;
      }

      const isGiveUp = lowQualityModeRef.current;
      const seekThreshold = isGiveUp ? GIVE_UP_THRESHOLD_SEC : SOFT_SYNC_MAX_SEC;

      // hard sync (seek) 領域
      if (absDrift >= seekThreshold) {
        // 諦めモードでは seek 禁止 → rate 補正のみで耐える
        if (isGiveUp) {
          const targetRate = drift > 0 ? RATE_FAST : RATE_SLOW;
          if (player.getPlaybackRate() !== targetRate) player.setPlaybackRate(targetRate);
          rateHoldUntilRef.current = Date.now() + Math.min(RATE_HOLD_MAX_MS, (absDrift / 0.25) * 1000 * RATE_HOLD_FACTOR);
          return;
        }
        // 通常モード: クールダウン経過後に先回り seek
        if (Date.now() - lastSeekAtRef.current < SEEK_COOLDOWN_MS) return;
        const leadSec = absDrift >= SEEK_LEAD_TRIGGER_SEC ? SEEK_LEAD_SEC : 0;
        player.seekTo(expected + leadSec);
        if (player.getPlaybackRate() !== 1.0) player.setPlaybackRate(1.0);
        lastSeekAtRef.current = Date.now();
        return;
      }

      // soft sync (rate 補正) 領域
      // drift > 0: 自分が遅れ → 1.25倍で追いつく
      // drift < 0: 自分が先行 → 0.75倍で待つ
      const targetRate = drift > 0 ? RATE_FAST : RATE_SLOW;
      if (player.getPlaybackRate() !== targetRate) player.setPlaybackRate(targetRate);
      // 0.25 / 秒のペースで補正される。控えめ(70%)に止めて再判定し、行き過ぎ(振動)を防ぐ
      rateHoldUntilRef.current = Date.now() + Math.min(RATE_HOLD_MAX_MS, (absDrift / 0.25) * 1000 * RATE_HOLD_FACTOR);
    }, DRIFT_CHECK_INTERVAL_MS);
  }, [stopDriftLoop]);

  // --- YouTube プレイヤー状態の監視（バッファ検知 / 諦めモード）---
  const handlePlayerStateChange = useCallback((state: number) => {
    if (state === 3 /* BUFFERING */) {
      if (!isBufferingRef.current) {
        isBufferingRef.current = true;
        // 同期再生中に発生したバッファだけを諦めモード判定に数える
        if (isRealtimePlayRef.current) {
          const now = Date.now();
          const recent = bufferingTimestampsRef.current.filter(t => now - t < GIVE_UP_WINDOW_MS);
          recent.push(now);
          bufferingTimestampsRef.current = recent;
          if (recent.length >= GIVE_UP_BUFFER_COUNT) {
            lowQualityModeRef.current = true;
            console.log("[hi-tension] entered give-up sync mode (buffering loop detected)");
          }
        }
      }
    } else if (state === 1 /* PLAYING */) {
      // Plan E (pause なし): ✋押下後の初回 PLAYING 到達 → 動画は止めず再生継続。
      // 「動画 0 秒に相当する Supabase 時刻」を計算して報告する。
      if (awaitingPlaybackRef.current) {
        awaitingPlaybackRef.current = false;
        const offset = getClockOffsetRef.current();
        const videoPos = playerApiRef.current?.getCurrentTime() ?? 0;
        // 動画 0 秒だった Supabase 時刻 = 今の Supabase 時刻 − 経過再生秒
        const tZero = (Date.now() + offset) - videoPos * 1000;
        sendPlaybackReadyRef.current(tZero);
      }
      if (isBufferingRef.current) {
        isBufferingRef.current = false;
        bufferRecoveryGraceUntilRef.current = Date.now() + BUFFER_RECOVERY_GRACE_MS;
      }
    }
  }, []);

  // 全員の再生開始が出揃ったら、一斉リビール時刻 t_reveal と基準動画位置 p0 を配る（ホスト）。
  // 最も遅く 0 秒に到達した端末を基準にする（他は先行しているので減速で揃う）。
  const startSyncedPlayback = useCallback((group: string[]) => {
    const ready = group.filter(id => playbackReadyMapRef.current.has(id));
    if (ready.length === 0) return;
    const tZeroMax = Math.max(...ready.map(id => playbackReadyMapRef.current.get(id)!));
    const tReveal = Date.now() + getClockOffsetRef.current() + LEAD_TIME_MS;
    const p0 = (tReveal - tZeroMax) / 1000; // 基準端末が t_reveal 時点でいる動画位置
    sendSongStartRef.current(tReveal, p0);
  }, []);

  // playback-ready 受信（ホスト）: 全員の再生開始時刻が揃ったら一斉リビールを配る
  const handlePlaybackReady = useCallback((sessionId: string, tZero: number) => {
    playbackReadyMapRef.current.set(sessionId, tZero);
    const group = readyCheckGroupRef.current;
    if (!isHostRef.current || group.length === 0) return;
    if (group.every(id => playbackReadyMapRef.current.has(id))) {
      if (playbackTimeoutRef.current) { clearTimeout(playbackTimeoutRef.current); playbackTimeoutRef.current = null; }
      startSyncedPlayback(group);
    }
  }, [startSyncedPlayback]);

  // --- realtime hook コールバック ---
  const clearSenoTimer = useCallback(() => {
    if (senoTimerRef.current) { clearTimeout(senoTimerRef.current); senoTimerRef.current = null; }
  }, []);

  // せーの受信: 自分がグループに入っていれば ready-check へ
  const handleSeno = useCallback((_senoAt: number, group: string[]) => {
    if (!group.includes(myKeyRef.current)) return; // 後から来た人は対象外
    clearSenoTimer();
    readyCheckGroupRef.current = group;
    readiedSetRef.current = new Set();
    playbackReadyMapRef.current = new Map();
    awaitingPlaybackRef.current = false;
    awaitingSongStartRef.current = false;
    setReadyCheckGroup(group);
    setReadyCount(0);
    setSelfReadied(false);
    setReadyCheckFailed(false);
    setScreen("ready-check");
    // ホストは窓の番人: 時間内に全員揃わなければ seno-fail を出す
    if (isHostRef.current) {
      senoTimerRef.current = setTimeout(() => {
        sendSenoFailRef.current();
      }, SENO_FAIL_TIMEOUT_MS);
    }
  }, [clearSenoTimer]);

  // ready 受信: 集計のみ。全員が✋を押したら、ホストは playback-ready の集約タイムアウトを開始する。
  // （songstart のトリガーは playback-ready 集約に移譲。Plan E）
  const handleReady = useCallback((sessionId: string) => {
    readiedSetRef.current.add(sessionId);
    const group = readyCheckGroupRef.current;
    setReadyCount(group.filter(id => readiedSetRef.current.has(id)).length);
    if (isHostRef.current && group.length > 0 && group.every(id => readiedSetRef.current.has(id))) {
      clearSenoTimer();
      if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
      // 5秒待っても playback-ready が揃わなければ、準備できた端末だけで開始する（フォールバック）
      playbackTimeoutRef.current = setTimeout(() => {
        playbackTimeoutRef.current = null;
        startSyncedPlayback(group);
      }, PLAYBACK_READY_TIMEOUT_MS);
    }
  }, [clearSenoTimer, startSyncedPlayback]);

  // songstart 受信: t0(=揃え時刻, Supabase時刻)で全員一斉に seek(p0) して動画位置を揃える。
  // 動画は✋押下時から再生画面で見えている（隠さない）。以降の微ズレは driftLoop の rate sync で吸収。
  const handleSongStart = useCallback((t0: number, p0: number) => {
    if (!awaitingSongStartRef.current) return; // ✋を押して songstart 待ちの人だけ
    awaitingSongStartRef.current = false;
    clearSenoTimer();
    const offset = getClockOffsetRef.current();   // Supabase時計 - 自分の時計
    clockAnchorRef.current = { t0, p0, offset };
    const localT0 = t0 - offset;                  // 揃え時刻を自分のローカル時計に換算
    const delay = localT0 - Date.now();
    const doSync = () => {
      songStartTimerRef.current = null;
      // 動画は表示中（アクティブ）なので seek してもサムネ化しない。基準位置へ一斉に揃える。
      playerApiRef.current?.play();
      playerApiRef.current?.seekTo(p0);
      lastSeekAtRef.current = Date.now();
      // seek 完了（バッファ）を待ってから補正開始（未完了での誤判定・暴走を防ぐ）
      bufferRecoveryGraceUntilRef.current = Date.now() + 2000;
      // 収束デバッグ用のリセット
      syncStartAtRef.current = Date.now();
      maxDriftRef.current = 0;
      startDriftLoop();
    };
    if (songStartTimerRef.current) clearTimeout(songStartTimerRef.current);
    if (delay > 0) {
      songStartTimerRef.current = setTimeout(doSync, delay);
    } else {
      doSync();
    }
  }, [clearSenoTimer, startDriftLoop]);

  // せーの失敗: ready-check に留まったまま「息が合わなかった」表示。
  // ✋押下で再生開始した動画を止めて頭出しする（裏で流れ続けないように）。
  const handleSenoFail = useCallback(() => {
    // ✋押下で play 画面に遷移済みの人（awaitingSongStart）と、ready-check で待ってる人を処理。
    // 無関係（ソロ再生中など）は無視。
    if (!awaitingSongStartRef.current && screenRef.current !== "ready-check") return;
    clearSenoTimer();
    if (playbackTimeoutRef.current) { clearTimeout(playbackTimeoutRef.current); playbackTimeoutRef.current = null; }
    stopDriftLoop();
    playerApiRef.current?.pause();
    playerApiRef.current?.seekTo(0);
    readiedSetRef.current = new Set();
    playbackReadyMapRef.current = new Map();
    awaitingPlaybackRef.current = false;
    awaitingSongStartRef.current = false;
    setIsRealtimePlay(false);
    setReadyCount(0);
    setSelfReadied(false);
    setReadyCheckFailed(true);
    setScreen("ready-check"); // play に遷移済みでも ready-check に戻す
  }, [clearSenoTimer, stopDriftLoop]);

  const handleTap = useCallback((tap: { memberId: string; seatIndex: number; videoTime: number }) => {
    if (!isRealtimePlayRef.current) return;
    canvasRef.current?.receiveLiveTap(tap.memberId, tap.seatIndex, tap.videoTime);
  }, []);

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
    sendPlaybackReady,
    broadcastTap,
    broadcastBounce,
  } = useHiTensionRealtime({
    sessionId: anonSessionId,
    memberId,
    roomCode,
    inWaitingRoom: screen === "waiting" || screen === "ready-check",
    onSeno: handleSeno,
    onReady: handleReady,
    onSongStart: handleSongStart,
    onSenoFail: handleSenoFail,
    onTap: handleTap,
    onBounce: handleBounce,
    onPlaybackReady: handlePlaybackReady,
  });

  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { myKeyRef.current = presenceKey; }, [presenceKey]);
  useEffect(() => { if (mySeatIndex >= 0) mySeatIndexRef.current = mySeatIndex; }, [mySeatIndex]);
  useEffect(() => { getClockOffsetRef.current = getClockOffset; }, [getClockOffset]);
  useEffect(() => { getBestRoundtripRef.current = getBestRoundtrip; }, [getBestRoundtrip]);
  useEffect(() => { sendSongStartRef.current = sendSongStart; }, [sendSongStart]);
  useEffect(() => { sendSenoFailRef.current = sendSenoFail; }, [sendSenoFail]);
  useEffect(() => { sendPlaybackReadyRef.current = sendPlaybackReady; }, [sendPlaybackReady]);

  // 待機室が満員か / 自分があふれ（5人目以降）か
  const roomFull = participants.length >= MAX_PARTICIPANTS;
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

  // グローバル待機室は5分でタイムアウト → ロビーに戻す（放置・居座り対策）。
  // 合言葉の部屋（roomCode あり）には適用しない。
  useEffect(() => {
    if (screen !== "waiting" || roomCode !== null) return;
    const timer = setTimeout(() => setScreen("select"), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [screen, roomCode]);

  // 再生まわりの状態をリセットする
  const resetPlayState = () => {
    timestampsRef.current = [];
    submittedRef.current = false;
    videoEndedRef.current = false;
    setVideoEnded(false);
    setEndedSelfCount(0);
  };

  // ひとりで始める
  const handleConfirm = (id: string) => {
    // ★ iOS Safari autoplay 対策: gesture スコープ内で最初に呼ぶ
    playerApiRef.current?.play();
    setMemberId(id);
    setLastSelectedMemberId(id);
    setSeatHash(newSeatHash());
    resetPlayState();
    setPlaySeatIndex(-1);
    setIsRealtimePlay(false);
    setScreen("play");
  };

  // だれかと（グローバル待機室）
  const handleWaitGlobal = (id: string) => {
    if (roomFull) return; // 満員なら入室しない（ボタン無効化のバックストップ）
    setMemberId(id);
    setLastSelectedMemberId(id);
    setRoomCode(null);
    setSeatHash(newSeatHash());
    setScreen("waiting");
  };

  // 合言葉の部屋メニューを開く
  const handleOpenRoomMenu = (id: string) => {
    setMemberId(id);
    setLastSelectedMemberId(id);
    setScreen("room-menu");
  };

  // 部屋を作る（新しいコードを発行して待機室へ）
  const handleCreateRoom = () => {
    setRoomCode(generateRoomCode());
    setSeatHash(newSeatHash());
    setScreen("waiting");
  };

  // コードで部屋に入る
  const handleJoinRoom = (code: string) => {
    setRoomCode(code);
    setSeatHash(newSeatHash());
    setScreen("waiting");
  };

  // 部屋メニュー → 色選択に戻る
  const handleRoomMenuBack = () => {
    setScreen("select");
  };

  // 合言葉部屋の待機室 → コード入力画面に戻る（打ち間違えた時の入れ直し）
  const handleReenterCode = () => {
    setScreen("room-menu");
  };

  // 待機室 / ready-check → 色選択に戻る
  const handleBackToTop = () => {
    clearSenoTimer();
    stopDriftLoop();
    setRoomCode(null);
    setScreen("select");
  };

  // やっぱりひとりで（待機室から直接再生。inWaitingRoom が false になり自動で untrack される）
  const handleSolo = () => {
    // gesture スコープ内なので iOS でも play() が通る
    playerApiRef.current?.play();
    resetPlayState();
    setPlaySeatIndex(-1);
    setIsRealtimePlay(false);
    setScreen("play");
  };

  // ホストが「せーの」を押す（待機室）
  const handleSenoButton = () => {
    const group = participants.slice(0, MAX_PARTICIPANTS).map(p => p.sessionId);
    if (group.length === 0) return;
    sendSeno(group);
  };

  // ホストが失敗後「もう一回 せーの」を押す（同じグループで再挑戦、抜けた人は除外）
  const handleRetrySeno = () => {
    const present = new Set(participants.map(p => p.sessionId));
    const group = readyCheckGroupRef.current.filter(id => present.has(id));
    if (group.length === 0) return;
    sendSeno(group);
  };

  // ready-check で✋を押す（＝参加＆動画再生＆開始の意思表明）
  const handleReadyTap = () => {
    if (selfReadied) return;
    // ✋押下で再生開始し、すぐ再生画面へ遷移する（動画を隠さない = iOS の自動 pause を回避）。
    // 全員の再生位置は songstart 受信時に seek で一斉に揃える。
    playerApiRef.current?.play();
    awaitingPlaybackRef.current = true;
    awaitingSongStartRef.current = true;
    resetPlayState();
    setSelfReadied(true);
    setPlaySeatIndex(mySeatIndexRef.current);  // 手の整列用に席番号を保存
    setIsRealtimePlay(true);
    sendReady();
    setScreen("play");
  };

  const handleVideoEnded = () => {
    clearPressTimers();
    stopDriftLoop();
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
    canvasRef.current?.onTimeUpdate(t);
  }, []);

  const recordHi = useCallback(() => {
    if (videoEndedRef.current) return;
    const anchor = clockAnchorRef.current;
    let t = currentTimeRef.current;
    // 同期再生中は、ズレ補正(seek/rate)の影響を打ち消すため Supabase 基準の動画時刻を使う。
    // 「同じリアル瞬間に押した」が全員同じ video_time として共有される。
    if (isRealtimePlayRef.current && anchor) {
      const supabaseNow = Date.now() + anchor.offset;
      t = anchor.p0 + (supabaseNow - anchor.t0) / 1000;
    }
    timestampsRef.current.push(t);
    console.log(`[hi-tension] HI! @ ${t.toFixed(2)}s`);
    canvasRef.current?.spawnSelf();
    if (isRealtimePlayRef.current) broadcastTap(t);
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

      {/* 同期デバッグ表示（原因特定用、後で削除） */}
      {debugInfo && (
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
          {`offset a/l: ${debugInfo.anchorOffset} / ${debugInfo.liveOffset}\nrtt: ${debugInfo.rtt}ms\ndrift: ${debugInfo.drift}s\nmaxDrift: ${debugInfo.maxDrift}s\nrate: ${debugInfo.rate}x\nelapsed: ${debugInfo.elapsed}s`}
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
        <YouTubePlayer
          ref={playerApiRef}
          videoId={VIDEO_ID}
          onEnded={handleVideoEnded}
          onTimeUpdate={handleTimeUpdate}
          onPlayerStateChange={handlePlayerStateChange}
        />

        <div
          style={{
            flex: 1,
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "2.4rem 1.2rem 2rem",
          }}
        >
          <HandsCanvas
            key={seatHash}
            ref={canvasRef}
            sessions={sessions}
            selfMemberId={memberId}
            selfSeatHash={seatHash}
            selfSeatIndex={isRealtimePlay ? playSeatIndex : -1}
          />

          {videoEnded ? (
            <div style={{ position: "relative", zIndex: 1, width: "100%", display: "flex", justifyContent: "center" }}>
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
                alignItems: "center",
                justifyContent: "center",
                minHeight: 120,
                zIndex: 1,
              }}
            >
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
                  borderRadius: "50%",
                  background: member?.color ?? "#000",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  boxShadow: isPressed
                    ? "0 0 0 1px rgba(0,0,0,0.12), 0 0 0 8px rgba(0,0,0,0.06)"
                    : "0 0 0 1px rgba(0,0,0,0.08)",
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

          <p
            style={{
              marginTop: "auto",
              paddingTop: "2.4rem",
              fontSize: "0.625rem",
              color: "#777",
              textAlign: "center",
              lineHeight: 1.6,
              position: "relative",
              zIndex: 1,
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

      {/* Select 画面 */}
      {screen === "select" && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#f8f9fa", overflowY: "auto" }}>
          <MemberSelect
            initialSelectedId={memberId}
            onConfirm={handleConfirm}
            onWaitGlobal={handleWaitGlobal}
            onOpenRoomMenu={handleOpenRoomMenu}
            roomFull={roomFull}
          />
        </div>
      )}

      {/* 合言葉の部屋メニュー */}
      {screen === "room-menu" && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100 }}>
          <RoomMenu
            onCreate={handleCreateRoom}
            onJoin={handleJoinRoom}
            onBack={handleRoomMenuBack}
          />
        </div>
      )}

      {/* 待機室 */}
      {screen === "waiting" && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100 }}>
          <WaitingRoom
            participants={participants}
            mySessionId={presenceKey}
            isHost={isHost}
            connected={connected}
            channelError={channelError}
            isOverflow={isOverflow}
            roomCode={roomCode}
            onBounceSignal={broadcastBounce}
            bouncingSessionId={bouncingSessionId}
            onSeno={handleSenoButton}
            onSolo={handleSolo}
            onReenterCode={handleReenterCode}
            onBackToTop={handleBackToTop}
          />
        </div>
      )}

      {/* せーの → ready-check */}
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
        />
      )}
    </>
  );
}
