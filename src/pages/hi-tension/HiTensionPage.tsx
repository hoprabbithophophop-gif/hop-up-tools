import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import MemberSelect from "./components/MemberSelect";
import YouTubePlayer, { type YouTubePlayerApi } from "./components/YouTubePlayer";
import HandsCanvas, { type HandsCanvasApi } from "./components/HandsCanvas";
import WaitingRoom from "./WaitingRoom";
import RoomMenu from "./RoomMenu";
import Countdown from "./Countdown";
import { VIDEO_ID, findMember } from "./data";
import {
  getLastSelectedMemberId,
  setLastSelectedMemberId,
  getOrCreateAnonymousSessionId,
} from "./storage";
import { submitHiSession, fetchHiSessions, type HiSession } from "./api";
import { useHiTensionRealtime, MAX_PARTICIPANTS, generateRoomCode } from "./useHiTensionRealtime";
import EndCard from "./components/EndCard";
import HandIcon from "./components/HandIcon";

type Screen = "select" | "room-menu" | "waiting" | "countdown" | "play";

const LONG_PRESS_INTERVAL_MS = 150;
const LONG_PRESS_THRESHOLD_MS = 250;
const BUTTON_SIZE = 120;
const BOUNCE_DURATION_MS = 400;

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
  const [startAt, setStartAt] = useState<number | null>(null);
  const [isRealtimePlay, setIsRealtimePlay] = useState(false);
  const [bouncingSessionId, setBouncingSessionId] = useState<string | null>(null);
  // 部屋コード。null = グローバル部屋、文字列 = 合言葉の専用部屋
  const [roomCode, setRoomCode] = useState<string | null>(null);

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
  useEffect(() => { isRealtimePlayRef.current = isRealtimePlay; }, [isRealtimePlay]);

  // 待機室での自分の席番（あふれ判定用）。start 受信時に最新値を参照するため ref で持つ。
  const mySeatIndexRef = useRef(-1);

  const handleStart = useCallback((at: number) => {
    // あふれ（5人目以降）は start broadcast を受けてもカウントダウンに入れない
    if (mySeatIndexRef.current >= MAX_PARTICIPANTS) return;
    setStartAt(at);
    setScreen("countdown");
  }, []);

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
    broadcastStart,
    broadcastTap,
    broadcastBounce,
  } = useHiTensionRealtime({
    sessionId: anonSessionId,
    memberId,
    roomCode,
    inWaitingRoom: screen === "waiting",
    onStart: handleStart,
    onTap: handleTap,
    onBounce: handleBounce,
  });

  useEffect(() => { mySeatIndexRef.current = mySeatIndex; }, [mySeatIndex]);

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
    };
  }, []);

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

  // ひとりで始める
  const handleConfirm = (id: string) => {
    // ★ iOS Safari autoplay 対策: gesture スコープ内で最初に呼ぶ
    playerApiRef.current?.play();
    setMemberId(id);
    setLastSelectedMemberId(id);
    timestampsRef.current = [];
    submittedRef.current = false;
    setSeatHash(newSeatHash());
    videoEndedRef.current = false;
    setVideoEnded(false);
    setEndedSelfCount(0);
    setIsRealtimePlay(false);
    setScreen("play");
  };

  // だれでも待つ（グローバル待機室）
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

  // 待機室 → 色選択に戻る
  const handleBackToTop = () => {
    setRoomCode(null);
    setScreen("select");
  };

  // やっぱりひとりで（待機室から直接再生。inWaitingRoom が false になり自動で untrack される）
  const handleSolo = () => {
    // gesture スコープ内なので iOS でも play() が通る
    playerApiRef.current?.play();
    timestampsRef.current = [];
    submittedRef.current = false;
    videoEndedRef.current = false;
    setVideoEnded(false);
    setEndedSelfCount(0);
    setIsRealtimePlay(false);
    setScreen("play");
  };

  // カウントダウン終了・TAP ボタン押下（gesture スコープ → iOS でも play() が通る）
  // screen が "play" になると inWaitingRoom が false になり自動で untrack される。
  const handleCountdownReady = useCallback(() => {
    timestampsRef.current = [];
    submittedRef.current = false;
    videoEndedRef.current = false;
    setVideoEnded(false);
    setEndedSelfCount(0);
    setIsRealtimePlay(true);
    playerApiRef.current?.play();
    setScreen("play");
  }, []);

  const handleVideoEnded = () => {
    clearPressTimers();
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
    videoEndedRef.current = false;
    setVideoEnded(false);
    setEndedSelfCount(0);
    timestampsRef.current = [];
    submittedRef.current = false;
    setIsPressed(false);
    setRoomCode(null);
    setScreen("select");
  };

  const handleReplay = () => {
    playerApiRef.current?.replay(); // gesture スコープ内
    videoEndedRef.current = false;
    setVideoEnded(false);
    setEndedSelfCount(0);
    timestampsRef.current = [];
    submittedRef.current = false;
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
    const t = currentTimeRef.current;
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
            onStart={broadcastStart}
            onSolo={handleSolo}
            onBackToTop={handleBackToTop}
          />
        </div>
      )}

      {/* カウントダウン */}
      {screen === "countdown" && startAt !== null && (
        <Countdown startAt={startAt} onReady={handleCountdownReady} />
      )}
    </>
  );
}
