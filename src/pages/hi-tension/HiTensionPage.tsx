import { useState, useEffect, useRef, useCallback } from "react";
import MemberSelect from "./components/MemberSelect";
import YouTubePlayer, { type YouTubePlayerApi } from "./components/YouTubePlayer";
import HandsCanvas, { type HandsCanvasApi } from "./components/HandsCanvas";
import { VIDEO_ID, findMember } from "./data";
import {
  getLastSelectedMemberId,
  setLastSelectedMemberId,
  getOrCreateAnonymousSessionId,
} from "./storage";
import { submitHiSession, fetchHiSessions, type HiSession } from "./api";
import EndCard from "./components/EndCard";
import HandIcon from "./components/HandIcon";

type Screen = "select" | "play";

const LONG_PRESS_INTERVAL_MS = 150;
const LONG_PRESS_THRESHOLD_MS = 250;
const BUTTON_SIZE = 120;

function newSeatHash(): number {
  // 「はじめる」毎にランダムな席を抽選
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
  const timestampsRef = useRef<number[]>([]);
  const currentTimeRef = useRef(0);
  const pressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittedRef = useRef(false);
  const videoEndedRef = useRef(false);
  const canvasRef = useRef<HandsCanvasApi | null>(null);
  const playerApiRef = useRef<YouTubePlayerApi | null>(null);

  useEffect(() => {
    getOrCreateAnonymousSessionId();
  }, []);

  // 過去セッションをページ初回ロード時に先読み(「はじめる」を押すころには揃ってる)
  useEffect(() => {
    fetchHiSessions().then((data) => {
      setSessions(data);
      const totalHi = data.reduce((sum, s) => sum + s.bucket_indices.length, 0);
      console.log(`[hi-tension] loaded ${data.length} sessions, ${totalHi} hi total`);
    });
  }, []);

  const clearPressTimers = useCallback(() => {
    if (pressIntervalRef.current) {
      clearInterval(pressIntervalRef.current);
      pressIntervalRef.current = null;
    }
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearPressTimers();
  }, [clearPressTimers]);

  const handleConfirm = (id: string) => {
    // ★ ここが最重要: iOS Safari の autoplay 制約対策。
    // ユーザージェスチャー(クリック)の同期スコープ内で play() を呼び切る。
    // この呼び出しより前に setState や非同期処理を挟むとジェスチャー文脈が切れて
    // playVideo() が拒否される可能性があるので、必ず最初に呼ぶ。
    playerApiRef.current?.play();

    setMemberId(id);
    setLastSelectedMemberId(id);
    timestampsRef.current = [];
    submittedRef.current = false;
    setSeatHash(newSeatHash()); // 入るたびに違う席
    videoEndedRef.current = false;
    setVideoEnded(false);
    setEndedSelfCount(0);
    setScreen("play");
  };

  const handleVideoEnded = () => {
    // 長押し中に動画完走するとボタンが unmount されて pointerup が届かず、
    // setInterval が永続走行→ recordHi 連射→ ✋エンドレス、を防ぐ。
    clearPressTimers();
    setIsPressed(false);
    videoEndedRef.current = true;

    const count = timestampsRef.current.length;
    console.log(`[hi-tension] video ended (${count} presses)`);

    // カードはまず先に出す(保存失敗・押下0回でも結果表示する)
    setEndedSelfCount(count);
    setVideoEnded(true);

    if (submittedRef.current) return;
    if (!memberId || count === 0) return;

    submittedRef.current = true;
    const anonId = getOrCreateAnonymousSessionId();
    submitHiSession({
      memberId,
      timestamps: timestampsRef.current.slice(),
      anonymousSessionId: anonId,
    }).then((result) => {
      if (result.ok) {
        console.log("[hi-tension] session saved.");
      } else {
        console.warn("[hi-tension] save failed:", result.error);
        submittedRef.current = false;
      }
    });
  };

  const handleChangeColor = () => {
    // 動画を止めて選択画面に戻る
    playerApiRef.current?.pause();
    clearPressTimers();
    videoEndedRef.current = false;
    setVideoEnded(false);
    setEndedSelfCount(0);
    timestampsRef.current = [];
    submittedRef.current = false;
    setIsPressed(false);
    setScreen("select");
  };

  const handleReplay = () => {
    // iOS Safari のユーザージェスチャー文脈を維持するため、player への命令を最初に
    playerApiRef.current?.replay();

    videoEndedRef.current = false;
    setVideoEnded(false);
    setEndedSelfCount(0);
    timestampsRef.current = [];
    submittedRef.current = false;
    setIsPressed(false);
    setSeatHash(newSeatHash()); // 「もう一度」も新しい席
    // 前回保存分(自分の直前の完走)が累計に反映されるよう再取得
    fetchHiSessions().then(setSessions);
  };

  const handleTimeUpdate = useCallback((t: number) => {
    currentTimeRef.current = t;
    canvasRef.current?.onTimeUpdate(t);
  }, []);

  const recordHi = useCallback(() => {
    if (videoEndedRef.current) return; // 動画完走後の取りこぼし保険
    const t = currentTimeRef.current;
    timestampsRef.current.push(t);
    console.log(`[hi-tension] HI! @ ${t.toFixed(2)}s`);
    canvasRef.current?.spawnSelf();
  }, []);

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
      {/* Play screen は常時マウント。YouTubePlayer の iframe をユーザー操作前から DOM に置いておくことで、
         「はじめる」クリックの同期スコープ内で playVideo() を確実に呼べるようにする。 */}
      <div
        style={{
          height: "100dvh", // dvh で動的に viewport に合わせ + overflow hidden で
          overflow: "hidden", // iOS Safari の rubber band 余地まで完全に潰す
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
                totalCount={
                  sessions.reduce((sum, s) => sum + s.bucket_indices.length, 0) + endedSelfCount
                }
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

      {/* Select 画面はオーバーレイで上に重ねる。「はじめる」クリックでアンマウント */}
      {screen === "select" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "#f8f9fa",
            overflowY: "auto",
          }}
        >
          <MemberSelect
            initialSelectedId={memberId}
            onConfirm={handleConfirm}
          />
        </div>
      )}
    </>
  );
}
