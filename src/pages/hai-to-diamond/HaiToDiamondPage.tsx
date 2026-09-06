// 灰toダイヤモンド 💎 — 第0段（記録なし）
//
// 入口でメンバーカラーを選び（ハイ！テンションと同じ）、画面下の💎ボタンを押すと
// その色の💎が画面の上から降る。💎は動画の裏を通って画面の下に積もり、曲が進むにつれて
// カメラが引いて山が動画の背景になる。動画は真ん中に固定（動画本体の上には何も描かない）。
// 再生開始はハイ！テンションと同じ流儀: ユーザーのタップの中で同期的に play() を呼ぶ。
import { useCallback, useRef, useState } from "react";
import { faPlay } from "@fortawesome/free-solid-svg-icons";
import YouTubePlayer, { type YouTubePlayerApi } from "../hi-tension/components/YouTubePlayer";
import FaIcon from "../hi-tension/components/FaIcon";
import { findMember, ARENA_BG } from "../hi-tension/data";
import { getLastSelectedMemberId, setLastSelectedMemberId } from "../hi-tension/storage";
import DiamondCanvas, { type DiamondCanvasApi } from "./DiamondCanvas";
import DiamondMemberSelect from "./DiamondMemberSelect";
import DiamondTapButton, { type DiamondTapButtonApi } from "./DiamondTapButton";

/** BEYOOOOONDS『灰toダイヤモンド』Promotion Edit（公式）。https://youtu.be/ImXkCr22kCU */
const VIDEO_ID = "ImXkCr22kCU";
/** 額縁（動画の周りの帯）の太さ(px) */
const FRAME = 14;
/** PCでは動画を縮めて置く（ハイ！テンションと同じ幅） */
const PC_VIDEO_WIDTH = 480;

function isTouchDevice(): boolean {
  return /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
}

export default function HaiToDiamondPage() {
  const playerRef = useRef<YouTubePlayerApi>(null);
  const canvasRef = useRef<DiamondCanvasApi>(null);
  const tapButtonRef = useRef<DiamondTapButtonApi>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  /** タップした動画時刻（秒）。第1段で記録を送るときに使う。今は保持のみ。 */
  const tapsRef = useRef<number[]>([]);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);

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
    tapButtonRef.current?.reset();
    setPlayingBoth(true);
  }, []);

  const handleEnded = useCallback(() => {
    setPlayingBoth(false);
  }, []);

  // 動画上の YouTube 純正の再生ボタンから始めた場合も拾う。1=PLAYING / 0=ENDED。PAUSED は触らない【仮】
  const handlePlayerStateChange = useCallback((state: number) => {
    if (state === 1) setPlayingBoth(true);
    else if (state === 0) setPlayingBoth(false);
  }, []);

  const handleTimeUpdate = useCallback((t: number) => {
    const d = playerRef.current?.getDuration() ?? 0;
    if (d > 0) canvasRef.current?.setProgress(t / d);
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
