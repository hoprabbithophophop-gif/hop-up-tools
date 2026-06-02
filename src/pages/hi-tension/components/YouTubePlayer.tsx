import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import LoadingDots from "./LoadingDots";

const CONTAINER_ID = "hi-tension-player";
const POLL_MS = 100;
const LOADING_MIN_MS = 2000;

export type YouTubePlayerApi = {
  /** ユーザージェスチャー直後に同期的に呼ぶこと(iOS Safari の autoplay 制約対策) */
  play: () => void;
  pause: () => void;
  /** 動画を頭出しして再生開始("もう一度" 用) */
  replay: () => void;
  /** 指定秒へシーク(同期ドリフト補正用) */
  seekTo: (seconds: number) => void;
  /** 現在の再生位置(秒)。取得不可なら 0 */
  getCurrentTime: () => number;
  /** PLAYING 状態か(一時停止/バッファリング中は false) */
  isPlaying: () => boolean;
  /** 再生速度を設定(YouTubeは 0.25/0.5/0.75/1/1.25/1.5/1.75/2 のいずれか。それ以外は最寄りに丸められる) */
  setPlaybackRate: (rate: number) => void;
  /** 現在の再生速度。取得不可なら 1 */
  getPlaybackRate: () => number;
  /** 再生品質を要求（'small'=240p, 'medium'=360p, 'large'=480p, 'hd720', 'hd1080', 'default'）。
   *  デコード負荷を抑えたい時に呼ぶ。YouTube が auto を優先する場合は無視されることもある。 */
  setPlaybackQuality: (quality: string) => void;
  /** バッファ済み割合(0〜1)。取得不可なら 0 */
  getVideoLoadedFraction: () => number;
  /** 動画の総尺(秒)。取得不可なら 0 */
  getDuration: () => number;
  /** ミュート（待機室の暖機再生用） */
  mute: () => void;
  /** ミュート解除（本番動画再生時） */
  unMute: () => void;
  /** 指定動画IDをロードして即再生（同じ iframe を使い回し、JS/CDN接続を温存）。
   *  opts で開始/終了秒を指定可能（暖機用クリップで使う） */
  loadVideo: (id: string, opts?: { startSeconds?: number; endSeconds?: number; cover?: boolean }) => void;
  /** 指定動画IDを cue（ロードのみで再生はしない。✋押下までの待ち時間に仕込む） */
  cueVideo: (id: string, opts?: { startSeconds?: number; endSeconds?: number }) => void;
};

interface Props {
  videoId: string;
  onEnded: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  /** YT.PlayerState の値(1=PLAYING, 2=PAUSED, 3=BUFFERING, 0=ENDED) */
  onPlayerStateChange?: (state: number) => void;
}

function loadYouTubeAPI(): Promise<void> {
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

const YouTubePlayer = forwardRef<YouTubePlayerApi, Props>(function YouTubePlayer(
  { videoId, onEnded, onTimeUpdate, onPlayerStateChange },
  ref,
) {
  const [isReady, setIsReady] = useState(false);
  // 初回 play() から LOADING_MIN_MS 経過したかを保持。
  // 再生がすぐ始まるとローディングアニメが見えないため、最低2秒は表示する。
  const [started, setStarted] = useState(false);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const startedRef = useRef(false);
  const minTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const isReadyRef = useRef(false);
  const wantPlayRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onEndedRef = useRef(onEnded);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onPlayerStateChangeRef = useRef(onPlayerStateChange);

  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);
  useEffect(() => { onTimeUpdateRef.current = onTimeUpdate; }, [onTimeUpdate]);
  useEffect(() => { onPlayerStateChangeRef.current = onPlayerStateChange; }, [onPlayerStateChange]);

  useEffect(() => {
    let mounted = true;

    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const startPolling = () => {
      stopPolling();
      pollRef.current = setInterval(() => {
        const p = playerRef.current;
        if (!p) return;
        try {
          onTimeUpdateRef.current?.(p.getCurrentTime());
        } catch {
          // ignore
        }
      }, POLL_MS);
    };

    const init = async () => {
      await loadYouTubeAPI();
      if (!mounted) return;

      let element: HTMLElement | null = null;
      for (let i = 0; i < 25; i++) {
        element = document.getElementById(CONTAINER_ID);
        if (element || !mounted) break;
        await new Promise(r => setTimeout(r, 200));
      }
      if (!mounted || !element) return;

      playerRef.current = new YT.Player(CONTAINER_ID, {
        height: "100%",
        width: "100%",
        videoId,
        playerVars: {
          autoplay: 0,           // iOS Safari は同期 play() で起動するのでブラウザ任せの autoplay は使わない
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            if (!mounted) return;
            isReadyRef.current = true;
            setIsReady(true);
            // 先に play() が呼ばれていれば、ここで再生開始
            if (wantPlayRef.current) {
              wantPlayRef.current = false;
              try { playerRef.current?.playVideo(); } catch { /* ignore */ }
            }
          },
          onStateChange: (event) => {
            if (!mounted) return;
            const state = event.data;
            onPlayerStateChangeRef.current?.(state);
            if (state === 1 /* PLAYING */) {
              startPolling();
            } else if (state === 2 /* PAUSED */ || state === 3 /* BUFFERING */) {
              stopPolling();
            } else if (state === 0 /* ENDED */) {
              stopPolling();
              onEndedRef.current();
            }
          },
        },
      });
    };

    init();

    return () => {
      mounted = false;
      stopPolling();
      try { playerRef.current?.destroy(); } catch { /* ignore */ }
      playerRef.current = null;
      isReadyRef.current = false;
    };
  }, [videoId]);

  useEffect(() => {
    return () => {
      if (minTimerRef.current) clearTimeout(minTimerRef.current);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    play() {
      // 初回 play() でローディング最低表示タイマーを開始
      if (!startedRef.current) {
        startedRef.current = true;
        setStarted(true);
        minTimerRef.current = setTimeout(() => setMinTimeElapsed(true), LOADING_MIN_MS);
      }
      const p = playerRef.current;
      if (p && isReadyRef.current) {
        try {
          // 動画終了後に play() が呼ばれた場合は先頭に戻してから再生
          // (ENDED 状態で playVideo() しても iOS Safari では無反応)
          if (p.getPlayerState() === 0 /* ENDED */) p.seekTo(0, true);
          p.playVideo();
        } catch { /* ignore */ }
      } else {
        // まだ準備できていない → 準備完了時に再生
        wantPlayRef.current = true;
      }
    },
    pause() {
      try { playerRef.current?.pauseVideo(); } catch { /* ignore */ }
    },
    replay() {
      const p = playerRef.current;
      if (!p) return;
      try {
        p.seekTo(0, true);
        p.playVideo();
      } catch { /* ignore */ }
    },
    seekTo(seconds: number) {
      try { playerRef.current?.seekTo(Math.max(0, seconds), true); } catch { /* ignore */ }
    },
    getCurrentTime() {
      try { return playerRef.current?.getCurrentTime() ?? 0; } catch { return 0; }
    },
    isPlaying() {
      try { return playerRef.current?.getPlayerState() === 1; } catch { return false; }
    },
    setPlaybackRate(rate: number) {
      try { (playerRef.current as unknown as { setPlaybackRate?: (r: number) => void })?.setPlaybackRate?.(rate); } catch { /* ignore */ }
    },
    getPlaybackRate() {
      try { return (playerRef.current as unknown as { getPlaybackRate?: () => number })?.getPlaybackRate?.() ?? 1; } catch { return 1; }
    },
    setPlaybackQuality(quality: string) {
      try { (playerRef.current as unknown as { setPlaybackQuality?: (q: string) => void })?.setPlaybackQuality?.(quality); } catch { /* ignore */ }
    },
    getVideoLoadedFraction() {
      try { return (playerRef.current as unknown as { getVideoLoadedFraction?: () => number })?.getVideoLoadedFraction?.() ?? 0; } catch { return 0; }
    },
    getDuration() {
      try { return playerRef.current?.getDuration?.() ?? 0; } catch { return 0; }
    },
    mute() {
      try { (playerRef.current as unknown as { mute?: () => void })?.mute?.(); } catch { /* ignore */ }
    },
    unMute() {
      try { (playerRef.current as unknown as { unMute?: () => void })?.unMute?.(); } catch { /* ignore */ }
    },
    loadVideo(id: string, opts?: { startSeconds?: number; endSeconds?: number; cover?: boolean }) {
      // 初回 play() 同様にローディング最小表示タイマーを開始。
      // cover 指定時は2回目以降でもカバーを出し直す（前の動画＝本編サムネが切替の隙間に
      // 一瞬見えるのを防ぐ。入室時の暖機ロードで使う。暖機ループや本編再生では使わない）。
      if (opts?.cover || !startedRef.current) {
        startedRef.current = true;
        setStarted(true);
        setMinTimeElapsed(false);
        if (minTimerRef.current) clearTimeout(minTimerRef.current);
        minTimerRef.current = setTimeout(() => setMinTimeElapsed(true), LOADING_MIN_MS);
      }
      const p = playerRef.current;
      if (p && isReadyRef.current) {
        try {
          (p as unknown as { loadVideoById?: (a: { videoId: string; startSeconds?: number; endSeconds?: number }) => void })?.loadVideoById?.({
            videoId: id,
            startSeconds: opts?.startSeconds ?? 0,
            ...(opts?.endSeconds !== undefined ? { endSeconds: opts.endSeconds } : {}),
          });
        } catch { /* ignore */ }
      }
    },
    cueVideo(id: string, opts?: { startSeconds?: number; endSeconds?: number }) {
      const p = playerRef.current;
      if (p && isReadyRef.current) {
        try {
          (p as unknown as { cueVideoById?: (a: { videoId: string; startSeconds?: number; endSeconds?: number }) => void })?.cueVideoById?.({
            videoId: id,
            startSeconds: opts?.startSeconds ?? 0,
            ...(opts?.endSeconds !== undefined ? { endSeconds: opts.endSeconds } : {}),
          });
        } catch { /* ignore */ }
      }
    },
  }), []);

  // 初回 play() から LOADING_MIN_MS の間、または player が ready になるまで表示
  const showLoading = !isReady || (started && !minTimeElapsed);

  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000" }}>
      <div id={CONTAINER_ID} style={{ width: "100%", height: "100%" }} />
      {showLoading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#000",
            pointerEvents: "none",
          }}
        >
          <LoadingDots />
        </div>
      )}
    </div>
  );
});

export default YouTubePlayer;
