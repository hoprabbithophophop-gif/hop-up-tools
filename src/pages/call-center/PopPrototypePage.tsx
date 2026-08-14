import { useRef, useState } from "react";
import YouTubePlayer, { type YouTubePlayerApi } from "../hi-tension/components/YouTubePlayer";
import HandsCanvas, { type HandsCanvasApi } from "../hi-tension/components/HandsCanvas";
import type { HiSession } from "../hi-tension/api";

/**
 * 試作: 置く画面。
 *
 * 画面いっぱいに収める（スクロールしない）。上から順に、動画・跳ねる面・ボタン。
 * 常時出るのは4つだけ（← 曲へ／▶再生・停止／！／？）。
 * 跳ねる面はハイ！テンションの HandsCanvas をそのまま使い、絵だけ「！の入った吹き出し」にしている。
 * 動画の上には何も重ねない。
 *
 * 客席に出ているのは、ありがとビートに実際に登録されているコール104件。
 * ばらつきや人数はこちらで作らない（実際に人が叩いた結果としてしか出ないもの）。
 *
 * 判断用の試作なので、答えが出たら消す。
 */

// ありがとビートの実際のコール（曲の中での秒数）。棚の calls から取ったもの。
const CALL_SEC = [
  3.295, 5.912, 7.322, 8.933, 10.141, 10.946, 11.751, 12.355, 12.758, 13.362,
  14.167, 14.973, 15.577, 15.98, 16.584, 17.389, 18.194, 18.798, 19.201, 19.805,
  20.61, 21.416, 22.221, 24.235, 27.456, 30.678, 36.516, 38.127, 39.738, 44.57,
  47.389, 51.416, 51.617, 53.631, 56.651, 60.074, 68.53, 69.335, 70.141, 70.745,
  71.147, 71.751, 72.557, 73.362, 74.167, 74.973, 75.778, 76.584, 77.188, 77.59,
  78.194, 79.0, 79.805, 80.61, 83.429, 86.651, 89.872, 92.892, 94.905, 96.516,
  98.127, 103.161, 105.778, 109.604, 109.805, 111.818, 114.839, 118.463,
  127.322, 128.933, 130.543, 132.154, 133.362, 134.167, 134.973, 135.778,
  136.584, 137.389, 138.194, 139.0, 146.248, 169.402, 172.624, 175.845, 179.067,
  182.288, 185.51, 188.731, 191.55, 193.362, 194.167, 194.973, 195.778, 196.584,
  197.389, 198.194, 199.0, 199.805, 200.61, 201.416, 202.624, 205.241, 206.651,
  208.261,
];

// コールレクチャー動画。曲の0秒＝この動画の 3.108 秒
const VIDEO_ID = "xr7_Z5ibZMA";
const OFFSET = 3.108;

/**
 * すでに集まっているぶん。
 * いまは実データが「登録済みのコール104件」しかないので、それを1人ぶんの並びとして渡す。
 * 本番では、人が叩いた生の記録がそのままここに来る。
 */
const COLLECTED: HiSession[] = [
  {
    session_hash: 20260815,
    member_id: "nishida", // 色は overrideColor で塗り替えるので誰でもよい
    is_today: true,
    bucket_indices: CALL_SEC.map((t) => Math.round((t + OFFSET) * 10)),
    bucket_indices_20: CALL_SEC.map((t) => Math.round((t + OFFSET) * 20)),
    played_date: "2026-08-15",
  },
];

export default function PopPrototypePage() {
  const playerRef = useRef<YouTubePlayerApi>(null);
  const handsRef = useRef<HandsCanvasApi>(null);
  const [playing, setPlaying] = useState(false);
  const [marks, setMarks] = useState(0);
  const [holds, setHolds] = useState(0);
  const [nowSec, setNowSec] = useState(0);

  const onTime = (sec: number) => {
    handsRef.current?.onTimeUpdate(sec);
    setNowSec(Math.max(0, sec - OFFSET));
  };

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPlaying()) { p.pause(); setPlaying(false); }
    else { p.play(); setPlaying(true); }
  };

  /**
   * 「！」＝自分のぶんが跳ねる。
   * 押した瞬間（onPointerDown）に出す。指を離すのを待つとその分そのまま遅れて感じる。
   * ハイ！テンションの✋ボタンも同じく onPointerDown で反応している。
   */
  const pressMark = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    handsRef.current?.spawnSelf();
    setMarks((n) => n + 1);
  };
  // 「？」＝置くだけ。跳ねさせない（自信のない報告なので静かに置く、という前提の確認用）
  const pressHold = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setHolds((n) => n + 1);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;

  return (
    <div style={S.page}>
      {/* 上から順に固定。ページ全体はスクロールしない */}
      <div style={S.head}>
        <span style={S.back}>← 曲へ</span>
        <span style={S.title}>ありがとビート</span>
        <span style={S.count}>！ {marks} ／ ？ {holds}</span>
      </div>

      <div style={S.videoBox}>
        <YouTubePlayer ref={playerRef} videoId={VIDEO_ID} onEnded={() => setPlaying(false)} onTimeUpdate={onTime} />
      </div>

      <div style={S.row}>
        <button type="button" style={S.play} onClick={togglePlay}>{playing ? "⏸ 停止" : "▶ 再生"}</button>
        <span style={S.clock}>{fmt(nowSec)}</span>
      </div>

      {/* 跳ねる面。残りの高さを全部使う。動画の上には重ねない */}
      <div style={S.stage}>
        <HandsCanvas
          ref={handsRef}
          icon="mark"
          sessions={COLLECTED}
          selfMemberId="nishida"
          selfSeatHash={7}
          overrideColor="#ffffff"
          scaleCount={300}
          // 跳ねた頂点と絵の高さぶんを上に確保して、面の中に全部収める
          topMargin={150}
          freezeAge
        />
      </div>

      <div style={S.btnRow}>
        <button type="button" style={S.mark} onPointerDown={pressMark} onContextMenu={(e) => e.preventDefault()}>！</button>
        <button type="button" style={S.hold} onPointerDown={pressHold} onContextMenu={(e) => e.preventDefault()}>？</button>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: {
    background: "#000", color: "#eee", height: "100dvh", overflow: "hidden",
    display: "flex", flexDirection: "column",
    maxWidth: 520, margin: "0 auto", padding: "8px 10px 10px",
    fontFamily: "'Hiragino Sans','Noto Sans JP',system-ui,sans-serif",
  },
  head: { display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto", marginBottom: 6 },
  back: { fontSize: 12, color: "#9aa0a6" },
  title: { fontSize: 15, fontWeight: 800 },
  count: { marginLeft: "auto", fontSize: 12, color: "#8a8a92", fontFamily: "ui-monospace,Menlo,Consolas,monospace" },
  videoBox: { flex: "0 0 auto" },
  row: { display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto", margin: "6px 0" },
  play: { background: "#1a1a1a", color: "#eee", border: 0, boxShadow: "inset 0 0 0 1px #444", padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  clock: { fontSize: 12, color: "#666", fontFamily: "ui-monospace,Menlo,Consolas,monospace" },
  stage: { position: "relative", flex: "1 1 auto", minHeight: 0, background: "#0a0a0c", overflow: "hidden" },
  btnRow: { display: "flex", gap: 8, flex: "0 0 auto", marginTop: 8 },
  mark: { flex: 1, background: "#fff", color: "#000", border: 0, padding: "22px 10px", fontSize: 30, fontWeight: 900, lineHeight: 1, cursor: "pointer", fontFamily: "inherit" },
  hold: { flex: "0 0 84px", background: "#1a1a1a", color: "#9aa0a6", border: 0, boxShadow: "inset 0 0 0 1px #4a4a52", fontSize: 22, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" },
};
