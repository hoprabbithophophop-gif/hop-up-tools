// 灰toダイヤモンド 💎 — 第0段（記録なし）
//
// 動画（公式 Promotion Edit）を上に置き、その下の床をタップすると💎が降る。
// 💎の面の向きに光の筋が伸び、動画の額縁を照らす（動画本体の上には何も描かない）。
// 再生開始はハイ！テンションと同じ流儀: プレイヤーは常時マウントし、
// ユーザーのタップの中で同期的に play() を呼ぶ（iOS Safari の自動再生制限対策）。
import { useCallback, useRef, useState } from "react";
import { faPlay } from "@fortawesome/free-solid-svg-icons";
import YouTubePlayer, { type YouTubePlayerApi } from "../hi-tension/components/YouTubePlayer";
import FaIcon from "../hi-tension/components/FaIcon";
import DiamondCanvas, { type DiamondCanvasApi } from "./DiamondCanvas";

/** BEYOOOOONDS『灰toダイヤモンド』Promotion Edit（公式）。https://youtu.be/ImXkCr22kCU */
const VIDEO_ID = "ImXkCr22kCU";
/** 額縁（動画の周りの帯）の太さ(px) */
const FRAME = 14;
/** PCでは動画を縮めて置く（ハイ！テンションと同じ幅） */
const PC_VIDEO_WIDTH = 480;
const BG = "radial-gradient(150% 85% at 50% -8%, #1b2030 0%, #0e1016 48%, #07080c 100%)";

function isTouchDevice(): boolean {
  return /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
}

export default function HaiToDiamondPage() {
  const playerRef = useRef<YouTubePlayerApi>(null);
  const canvasRef = useRef<DiamondCanvasApi>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  const floorRef = useRef<HTMLDivElement>(null);
  /** タップした動画時刻（秒）。第1段で記録を送るときに使う。今は保持のみ。 */
  const tapsRef = useRef<number[]>([]);
  const [playing, setPlaying] = useState(false);

  const handleStart = useCallback(() => {
    // タップの中で同期的に呼ぶ
    playerRef.current?.play();
    tapsRef.current = [];
    setPlaying(true);
  }, []);

  const handleEnded = useCallback(() => {
    setPlaying(false);
  }, []);

  const handleFloorTap = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!playing) return;
    const floor = floorRef.current;
    if (!floor) return;
    const fr = floor.getBoundingClientRect();
    tapsRef.current.push(playerRef.current?.getCurrentTime() ?? 0);
    canvasRef.current?.spawn(e.clientX - fr.left + floor.offsetLeft);
  }, [playing]);

  return (
    <div
      style={{
        position: "relative",
        height: "100dvh",
        overflow: "hidden",
        background: BG,
        color: "#e8eaed",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 光と💎の層。動画の裏（zIndex 0） */}
      <DiamondCanvas ref={canvasRef} videoBoxRef={videoBoxRef} frame={FRAME} />

      {/* 動画。額縁ぶんの余白を空けて置く。背景は透明にして裏のキャンバスの額縁を見せる */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          padding: FRAME,
          ...(isTouchDevice() ? {} : { width: PC_VIDEO_WIDTH + FRAME * 2, maxWidth: "100%", margin: "0 auto" }),
        }}
      >
        <div ref={videoBoxRef}>
          <YouTubePlayer ref={playerRef} videoId={VIDEO_ID} onEnded={handleEnded} />
        </div>
      </div>

      {/* 床。ここをタップすると💎が降る。再生前は開始ボタンだけを置く */}
      <div
        ref={floorRef}
        onPointerDown={handleFloorTap}
        style={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          touchAction: "manipulation",
          userSelect: "none",
          WebkitUserSelect: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!playing && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
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

      <footer style={{ position: "relative", zIndex: 1, padding: "0.4rem 0.8rem", fontSize: 11, color: "#8a8e98", textAlign: "center" }}>
        Gem icon by Font Awesome (CC BY 4.0)
      </footer>
    </div>
  );
}
