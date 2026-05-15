import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

const CONTAINER_ID = "hi-tension-player";
const POLL_MS = 100;

export type YouTubePlayerApi = {
  /** ユーザージェスチャー直後に同期的に呼ぶこと(iOS Safari の autoplay 制約対策) */
  play: () => void;
  pause: () => void;
};

interface Props {
  videoId: string;
  onEnded: () => void;
  onTimeUpdate?: (currentTime: number) => void;
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
  { videoId, onEnded, onTimeUpdate },
  ref,
) {
  const [isReady, setIsReady] = useState(false);
  const playerRef = useRef<YT.Player | null>(null);
  const isReadyRef = useRef(false);
  const wantPlayRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onEndedRef = useRef(onEnded);
  const onTimeUpdateRef = useRef(onTimeUpdate);

  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);
  useEffect(() => { onTimeUpdateRef.current = onTimeUpdate; }, [onTimeUpdate]);

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

  useImperativeHandle(ref, () => ({
    play() {
      const p = playerRef.current;
      if (p && isReadyRef.current) {
        // ユーザージェスチャー直後の同期呼び出し
        try { p.playVideo(); } catch { /* ignore */ }
      } else {
        // まだ準備できていない → 準備完了時に再生
        wantPlayRef.current = true;
      }
    },
    pause() {
      try { playerRef.current?.pauseVideo(); } catch { /* ignore */ }
    },
  }), []);

  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000" }}>
      <div id={CONTAINER_ID} style={{ width: "100%", height: "100%" }} />
      {!isReady && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#000",
            color: "rgba(255,255,255,0.4)",
            fontSize: "0.6875rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            pointerEvents: "none",
          }}
        >
          Loading…
        </div>
      )}
    </div>
  );
});

export default YouTubePlayer;
