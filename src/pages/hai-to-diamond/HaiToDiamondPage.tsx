// 灰toダイヤモンド 💎 — 第1段（記録あり・みんなの💎も降る）
//
// 入口でメンバーカラーを選び（ハイ！テンションと同じ）、画面下の💎ボタンを押すと
// その色の💎が画面の上から降る。💎は動画の裏を通って画面の下に積もり、曲が進むにつれて
// カメラが引いて山が動画の背景になる。動画は真ん中に固定（動画本体の上には何も描かない）。
// 再生開始はハイ！テンションと同じ流儀: ユーザーのタップの中で同期的に play() を呼ぶ。
import { useCallback, useEffect, useRef, useState } from "react";
import YouTubePlayer, { type YouTubePlayerApi } from "../hi-tension/components/YouTubePlayer";
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
/** シェア文面（Hop確定 2026-09-06・A案）。タグとURLは指定のものだけ。URLは仮のルート名 */
const SHARE_URL = "https://hop-up-tools.pages.dev/hai-to-diamond";
function buildShareText(count: number): string {
  return `灰toダイヤモンドに合わせて 💎を ${count.toLocaleString()}個 降らせました\n#輝きなビヨちゃん\n${SHARE_URL}`;
}
function shareToX(count: number) {
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildShareText(count))}`, "_blank", "noopener,noreferrer");
}
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
  /** 曲が終わった後の画面（自分の回数・最初に戻る・シェア）。再生開始で消える */
  const [ended, setEnded] = useState(false);
  const [finalCount, setFinalCount] = useState(0);
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

  const setPlayingBoth = (v: boolean) => { playingRef.current = v; setPlaying(v); };

  /** 「はじめる」＝ハイ！テンションと同じく、このタップの中で同期的に再生を始める（iOS Safari 対策）。
   *  プレイヤーは入口の裏で先に読み込み済み */
  const handleConfirmMember = useCallback((id: string) => {
    playerRef.current?.play();
    setLastSelectedMemberId(id);
    setMemberId(id);
    tapsRef.current = [];
    lastBucketRef.current = -1;
    submittedRef.current = false;
    tapButtonRef.current?.reset();
    setEnded(false);
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

  const finish = useCallback(() => {
    setPlayingBoth(false);
    setFinalCount(tapsRef.current.length);
    setEnded(true);
    submitOnce();
  }, [submitOnce]);

  const handleEnded = useCallback(() => { finish(); }, [finish]);

  // 動画上の YouTube 純正の再生ボタンから始めた場合も拾う。1=PLAYING / 0=ENDED。PAUSED は触らない【仮】
  const handlePlayerStateChange = useCallback((state: number) => {
    if (state === 1) { setEnded(false); setPlayingBoth(true); }
    else if (state === 0) finish();
  }, [finish]);

  /** 最初に戻る＝入口の色選びへ */
  const handleBackToStart = useCallback(() => {
    setEnded(false);
    setPlayingBoth(false);
    setMemberId(null);
  }, []);

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
      {/* 入口。本編（プレイヤー込み）は常時マウントし、その上に重ねる＝「はじめる」の時点でプレイヤーが準備済み */}
      {!memberId && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10 }}>
          <DiamondMemberSelect initialSelectedId={getLastSelectedMemberId()} onConfirm={handleConfirmMember} />
        </div>
      )}

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

      {/* 画面下。再生中は💎ボタン、曲が終わったら回数・最初に戻る・シェア */}
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
          ) : ended ? (
            // 縦に積むと小さい画面で動画と重なる（iPhone SE 幅で実際に重なった）ので、ボタンは横並び
            <>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color, lineHeight: 1, textShadow: "0 0 12px rgba(0,0,0,0.6)" }}>{finalCount.toLocaleString()}</div>
              <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", justifyContent: "center" }}>
                <button
                  type="button"
                  onClick={handleBackToStart}
                  style={{ padding: "0.7rem 1.2rem", background: "#f1f3f5", color: "#0e1016", border: "none", fontSize: "0.875rem", fontWeight: 700, letterSpacing: "0.05em", cursor: "pointer" }}
                >
                  最初に戻る
                </button>
                <button
                  type="button"
                  onClick={() => shareToX(finalCount)}
                  style={{ padding: "0.7rem 1.2rem", background: "rgba(14,16,22,0.85)", color: "#f5f7fa", border: "1px solid rgba(255,255,255,0.5)", fontSize: "0.875rem", fontWeight: 700, letterSpacing: "0.05em", cursor: "pointer" }}
                >
                  𝕏 でシェアする
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <footer style={{ position: "absolute", zIndex: 3, left: 0, right: 0, bottom: 0, padding: "0.4rem 0.8rem", fontSize: 11, color: "#8a8e98", textAlign: "center" }}>
        Gem icon by Font Awesome (CC BY 4.0)
      </footer>
    </div>
  );
}
