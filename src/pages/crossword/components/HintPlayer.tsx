// ヒント欄の「その場で再生して位置を決める」プレイヤー。
// 開いた時は開始時刻で止まっている（自動再生しない）。上には何も重ねない（YouTube の規約）。
// 読み込み方は features/videos/hooks/useYouTubePlayer.ts・the-ballad/components/YouTubePlayer.tsx に合わせた
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { PAUSE_PLAYERS_EVENT } from "../../../lib/pageWave";
import { C } from "../style";

export interface HintPlayerApi {
  getCurrentTime: () => number;
}

interface Props {
  videoId: string;
  /** 欄に入っている開始時刻（秒）。読めない間は null */
  startSec: number | null;
  /** 再生できない動画だった時（削除・非公開・埋め込み禁止。プレイヤーの onError 100/101/150） */
  onUnavailable?: () => void;
}

export function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const existing = document.getElementById("yt-iframe-api");
    if (!existing) {
      const tag = document.createElement("script");
      tag.id = "yt-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      const first = document.getElementsByTagName("script")[0];
      first.parentNode?.insertBefore(tag, first);
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
  });
}

// 再生できない動画の合図（100: 見つからない・非公開、101/150: 埋め込みが許可されていない）
export const UNAVAILABLE_CODES = new Set([100, 101, 150]);

export const HintPlayer = forwardRef<HintPlayerApi, Props>(function HintPlayer({ videoId, startSec, onUnavailable }, ref) {
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;
  const holderRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null);
  const readyRef = useRef(false);
  const startRef = useRef(startSec ?? 0);

  useImperativeHandle(ref, () => ({
    getCurrentTime() {
      try { return playerRef.current?.getCurrentTime?.() ?? 0; } catch { return 0; }
    },
  }), []);

  useEffect(() => {
    let mounted = true;
    readyRef.current = false;
    (async () => {
      await loadYouTubeAPI();
      const holder = holderRef.current;
      if (!mounted || !holder) return;
      const el = document.createElement("div");
      holder.appendChild(el);
      playerRef.current = new window.YT.Player(el, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1, playsinline: 1, start: Math.max(0, Math.floor(startRef.current)) },
        events: {
          onReady: () => { if (mounted) readyRef.current = true; },
          onError: (e: { data: number }) => { if (mounted && UNAVAILABLE_CODES.has(e.data)) unavailableRef.current?.(); },
        },
      });
    })();
    return () => {
      mounted = false;
      readyRef.current = false;
      try { playerRef.current?.destroy(); } catch { /* ignore */ }
      playerRef.current = null;
      if (holderRef.current) holderRef.current.innerHTML = "";
    };
  }, [videoId]);

  // ページ移動の波でページが空白になる時は止める（src/lib/pageWave.ts）
  useEffect(() => {
    const pause = () => { try { playerRef.current?.pauseVideo(); } catch { /* ignore */ } };
    window.addEventListener(PAUSE_PLAYERS_EVENT, pause);
    return () => window.removeEventListener(PAUSE_PLAYERS_EVENT, pause);
  }, []);

  // 開始時刻の欄を直したらその位置へ移る（打ちかけを避けて少し待つ）。「今の位置にする」で入れた値は既にその位置なので動かさない
  useEffect(() => {
    if (startSec === null) return;
    startRef.current = startSec;
    const t = window.setTimeout(() => {
      const p = playerRef.current;
      if (!p || !readyRef.current) return;
      try {
        if (Math.abs((p.getCurrentTime?.() ?? 0) - startSec) < 1.5) return;
        const state = p.getPlayerState?.();
        if (state === 1 || state === 2 || state === 3) p.seekTo(startSec, true);
        else p.cueVideoById?.({ videoId, startSeconds: startSec }); // 止まったままその位置に置く
      } catch { /* ignore */ }
    }, 500);
    return () => window.clearTimeout(t);
  }, [startSec, videoId]);

  return (
    <div className="space-y-1">
      <div style={{ position: "relative", width: "100%", maxWidth: 480, aspectRatio: "16 / 9", background: "#000" }}>
        <div ref={holderRef} style={{ position: "absolute", inset: 0 }} className="[&_iframe]:w-full [&_iframe]:h-full" />
      </div>
      <p className="text-xs font-bold" style={{ color: C.secondary }}>▶ YouTube</p>
    </div>
  );
});
