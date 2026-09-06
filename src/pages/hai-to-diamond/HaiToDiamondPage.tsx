// 灰toダイヤモンド 💎 — 第1段（記録あり・みんなの💎も降る）
//
// 入口でメンバーカラーを選び（ハイ！テンションと同じ）、画面下の💎ボタンを押すと
// その色の💎が画面の上から降る。💎は動画の裏を通って画面の下に積もり、曲が進むにつれて
// カメラが引いて山が動画の背景になる。動画は真ん中に固定（動画本体の上には何も描かない）。
// 再生開始はハイ！テンションと同じ流儀: ユーザーのタップの中で同期的に play() を呼ぶ。
import { useCallback, useEffect, useRef, useState } from "react";
import { faPlay } from "@fortawesome/free-solid-svg-icons";
import YouTubePlayer, { type YouTubePlayerApi } from "../hi-tension/components/YouTubePlayer";
import FaIcon from "../hi-tension/components/FaIcon";
import { findMember, ARENA_BG } from "../hi-tension/data";
import { getLastSelectedMemberId, setLastSelectedMemberId, getOrCreateAnonymousSessionId } from "../hi-tension/storage";
import { fetchHiSessions, submitHiSession, type HiSession } from "../hi-tension/api";
import DiamondCanvas, { type DiamondCanvasApi } from "./DiamondCanvas";
import DiamondMemberSelect from "./DiamondMemberSelect";
import DiamondTapButton, { type DiamondTapButtonApi } from "./DiamondTapButton";

/** BEYOOOOONDS『灰toダイヤモンド』Promotion Edit（公式）。https://youtu.be/ImXkCr22kCU */
const VIDEO_ID = "ImXkCr22kCU";
/** 額縁（動画の周りの帯）の太さ(px) */
const FRAME = 14;
/** PCでは動画を縮めて置く（ハイ！テンションと同じ幅） */
const PC_VIDEO_WIDTH = 480;
/** 他の人の💎を1回の時刻更新（0.1秒）で出す上限。大勢の同時押しで一気に固まらないための蓋【仮】 */
const MAX_OTHERS_PER_TICK = 25;

/** みんなの記録を「0.05秒刻みの時刻 → その時押した人の色」の帳簿にする */
function buildBucketMap(sessions: HiSession[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const s of sessions) {
    const c = findMember(s.member_id)?.color;
    if (!c) continue;
    const buckets = s.bucket_indices_20 ?? s.bucket_indices.map((b) => b * 2);
    for (const b of buckets) {
      const arr = map.get(b);
      if (arr) arr.push(c); else map.set(b, [c]);
    }
  }
  return map;
}

function isTouchDevice(): boolean {
  return /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
}

export default function HaiToDiamondPage() {
  const playerRef = useRef<YouTubePlayerApi>(null);
  const canvasRef = useRef<DiamondCanvasApi>(null);
  const tapButtonRef = useRef<DiamondTapButtonApi>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  /** 自分がタップした動画時刻（秒）。曲の終わりに記録として送る */
  const tapsRef = useRef<number[]>([]);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  /** みんなの記録（動画時刻の帳簿）。読み込み前は空 */
  const bucketMapRef = useRef<Map<number, string[]>>(new Map());
  const lastBucketRef = useRef(-1);
  const submittedRef = useRef(false);

  // 入口を抜けたら、この動画の池からみんなの記録を読む（ハイ！テンションと同じ窓口）
  useEffect(() => {
    if (!memberId) return;
    let cancelled = false;
    fetchHiSessions(VIDEO_ID).then((rows) => {
      if (!cancelled) bucketMapRef.current = buildBucketMap(rows);
    }).catch((e) => console.warn("[hai-to-diamond] fetch sessions failed:", e));
    return () => { cancelled = true; };
  }, [memberId]);

  const member = findMember(memberId);
  const color = member?.color ?? "#ffffff";

  const handleConfirmMember = useCallback((id: string) => {
    setLastSelectedMemberId(id);
    setMemberId(id);
  }, []);

  const setPlayingBoth = (v: boolean) => { playingRef.current = v; setPlaying(v); };

  const handleStart = useCallback(() => {
    // タップの中で同期的に呼ぶ
    playerRef.current?.play();
    tapsRef.current = [];
    lastBucketRef.current = -1;
    submittedRef.current = false;
    tapButtonRef.current?.reset();
    setPlayingBoth(true);
  }, []);

  /** 曲が終わったら自分の記録を送る（1回だけ・押していなければ送らない） */
  const submitOnce = useCallback(() => {
    if (submittedRef.current || !memberId || tapsRef.current.length === 0) return;
    submittedRef.current = true;
    submitHiSession({
      memberId,
      timestamps: tapsRef.current.slice(),
      anonymousSessionId: getOrCreateAnonymousSessionId(),
      videoId: VIDEO_ID,
    }).then((r) => {
      if (!r.ok) { console.warn("[hai-to-diamond] save failed:", r.error); submittedRef.current = false; }
    }).catch((e) => { console.warn("[hai-to-diamond] save failed:", e); submittedRef.current = false; });
  }, [memberId]);

  const handleEnded = useCallback(() => {
    setPlayingBoth(false);
    submitOnce();
  }, [submitOnce]);

  // 動画上の YouTube 純正の再生ボタンから始めた場合も拾う。1=PLAYING / 0=ENDED。PAUSED は触らない【仮】
  const handlePlayerStateChange = useCallback((state: number) => {
    if (state === 1) setPlayingBoth(true);
    else if (state === 0) { setPlayingBoth(false); submitOnce(); }
  }, [submitOnce]);

  const handleTimeUpdate = useCallback((t: number) => {
    const d = playerRef.current?.getDuration() ?? 0;
    if (d > 0) canvasRef.current?.setProgress(t / d);
    // みんなの💎: 前回の時刻からいままでに押された分を、その人の色で降らせる
    const cur = Math.floor(t * 20);
    let last = lastBucketRef.current;
    if (cur < last) last = cur - 1;                 // 巻き戻し（頭出し等）
    if (cur - last > 40) last = cur - 40;           // 大きく飛んだ時は直近2秒ぶんだけ
    let budget = MAX_OTHERS_PER_TICK;
    for (let b = last + 1; b <= cur && budget > 0; b++) {
      const colors = bucketMapRef.current.get(b);
      if (!colors) continue;
      for (const c of colors) { if (budget-- <= 0) break; canvasRef.current?.spawn(c); }
    }
    lastBucketRef.current = cur;
  }, []);

  /** 💎ボタン1回ぶん。再生中だけ受け付ける */
  const handleRecord = useCallback((): boolean => {
    if (!playingRef.current) return false;
    tapsRef.current.push(playerRef.current?.getCurrentTime() ?? 0);
    canvasRef.current?.spawn(color);
    return true;
  }, [color]);

  if (!memberId) {
    return <DiamondMemberSelect initialSelectedId={getLastSelectedMemberId()} onConfirm={handleConfirmMember} />;
  }

  return (
    <div
      style={{
        position: "relative",
        height: "100dvh",
        overflow: "hidden",
        background: ARENA_BG,
        color: "#e8eaed",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 光と💎の層。動画の裏（zIndex 0） */}
      <DiamondCanvas ref={canvasRef} videoBoxRef={videoBoxRef} frame={FRAME} />

      {/* 動画。画面の縦の真ん中に固定。額縁ぶんの余白を空け、背景は透明にして裏のキャンバスの額縁を見せる */}
      <div
        style={{
          position: "absolute",
          zIndex: 2,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          padding: FRAME,
          width: isTouchDevice() ? "100%" : PC_VIDEO_WIDTH + FRAME * 2,
          maxWidth: "100%",
          boxSizing: "border-box",
        }}
      >
        <div ref={videoBoxRef}>
          <YouTubePlayer ref={playerRef} videoId={VIDEO_ID} onEnded={handleEnded} onTimeUpdate={handleTimeUpdate} onPlayerStateChange={handlePlayerStateChange} />
        </div>
      </div>

      {/* 画面下。再生前は開始ボタン、再生中は💎ボタン */}
      <div
        style={{
          position: "absolute",
          zIndex: 3,
          left: 0,
          right: 0,
          bottom: "1.6rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.6rem",
          pointerEvents: "none",
        }}
      >
        <div style={{ pointerEvents: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.6rem" }}>
          {playing ? (
            <DiamondTapButton ref={tapButtonRef} accentColor={color} onRecord={handleRecord} />
          ) : (
            <button
              type="button"
              onClick={handleStart}
              aria-label="再生"
              style={{
                width: 88,
                height: 88,
                borderRadius: "50%",
                border: "none",
                background: "rgba(255,255,255,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <FaIcon icon={faPlay} size={36} color="#ffffff" />
            </button>
          )}
        </div>
      </div>

      <footer style={{ position: "absolute", zIndex: 3, left: 0, right: 0, bottom: 0, padding: "0.4rem 0.8rem", fontSize: 11, color: "#8a8e98", textAlign: "center" }}>
        Gem icon by Font Awesome (CC BY 4.0)
      </footer>
    </div>
  );
}
