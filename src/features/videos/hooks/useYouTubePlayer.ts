import { useEffect, useRef, useState, useCallback } from 'react';

const PLAYER_CONTAINER_ID = 'chapter-player';
const POLLING_MS = 250;
const END_THRESHOLD_SECONDS = 0.5;

interface UseYouTubePlayerOptions {
  onChapterEnd: () => void;
  onError?: (errorCode: number) => void;
  /** true になったときにプレイヤーを初期化する。false の間は初期化しない */
  enabled?: boolean;
}

interface UseYouTubePlayerReturn {
  isReady: boolean;
  playChapter: (videoId: string, startSeconds: number, endSeconds: number) => void;
  pause: () => void;
  resume: () => void;
  getCurrentTime: () => number;
}

interface PendingChapter {
  videoId: string;
  startSeconds: number;
  endSeconds: number;
}

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const existing = document.getElementById('yt-iframe-api');
    if (!existing) {
      const tag = document.createElement('script');
      tag.id = 'yt-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      const first = document.getElementsByTagName('script')[0];
      first.parentNode?.insertBefore(tag, first);
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
  });
}

export function useYouTubePlayer({
  onChapterEnd,
  onError,
  enabled = true,
}: UseYouTubePlayerOptions): UseYouTubePlayerReturn {
  const [isReady, setIsReady] = useState(false);
  const playerRef = useRef<YT.Player | null>(null);
  const endSecondsRef = useRef<number>(Number.MAX_SAFE_INTEGER);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onChapterEndRef = useRef(onChapterEnd);
  const chapterEndFiredRef = useRef(false);
  // isReady 前に playChapter が呼ばれた場合に保持する
  const pendingChapterRef = useRef<PendingChapter | null>(null);
  const isReadyRef = useRef(false);

  useEffect(() => {
    onChapterEndRef.current = onChapterEnd;
  }, [onChapterEnd]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current !== null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollingRef.current = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const end = endSecondsRef.current;
      // Infinity or MAX_SAFE_INTEGER の場合はポーリング不要
      if (!isFinite(end) || end === Number.MAX_SAFE_INTEGER) return;
      try {
        const current = player.getCurrentTime();
        if (!chapterEndFiredRef.current && current >= end - END_THRESHOLD_SECONDS) {
          chapterEndFiredRef.current = true;
          stopPolling();
          onChapterEndRef.current();
        }
      } catch {
        // プレイヤーが破棄された後などに発生するエラーは無視
      }
    }, POLLING_MS);
  }, [stopPolling]);

  const doLoadVideo = useCallback((
    player: YT.Player,
    videoId: string,
    startSeconds: number,
    endSeconds: number
  ) => {
    endSecondsRef.current = endSeconds;
    chapterEndFiredRef.current = false;
    stopPolling();
    const params: { videoId: string; startSeconds: number; endSeconds?: number } = {
      videoId,
      startSeconds,
    };
    // Infinity や MAX_SAFE_INTEGER は endSeconds を渡さない
    if (isFinite(endSeconds) && endSeconds !== Number.MAX_SAFE_INTEGER) {
      params.endSeconds = endSeconds;
    }
    console.log('[YTPlayer] loadVideoById called:', videoId, startSeconds, endSeconds);
    player.loadVideoById(params);
  }, [stopPolling]);

  useEffect(() => {
    // enabled が false の間はプレイヤーを初期化しない
    if (!enabled) {
      isReadyRef.current = false;
      setIsReady(false);
      pendingChapterRef.current = null;
      stopPolling();
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch { /* ignore */ }
        playerRef.current = null;
      }
      return;
    }

    let mounted = true;

    const init = async () => {
      // Step 1: API スクリプト読み込み
      console.log('[YTPlayer] Loading API...');
      await loadYouTubeAPI();

      if (!mounted) return;

      // Step 2: DOM要素の存在確認
      const element = document.getElementById(PLAYER_CONTAINER_ID);
      if (!element) {
        console.error(`[YTPlayer] Element #${PLAYER_CONTAINER_ID} not found in DOM`);
        return;
      }

      // Step 3: プレイヤー生成
      console.log('[YTPlayer] API loaded, creating player...');
      playerRef.current = new YT.Player(PLAYER_CONTAINER_ID, {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 0, // 初期化時は autoplay しない
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            if (!mounted) return;
            // Step 4: 準備完了
            console.log('[YTPlayer] onReady fired, player is ready');
            isReadyRef.current = true;
            setIsReady(true);

            // Step 5: 待機中のチャプターがあれば再生開始
            if (pendingChapterRef.current && playerRef.current) {
              const { videoId, startSeconds, endSeconds } = pendingChapterRef.current;
              pendingChapterRef.current = null;
              doLoadVideo(playerRef.current, videoId, startSeconds, endSeconds);
            }
          },
          onStateChange: (event) => {
            if (!mounted) return;
            const state = event.data;
            if (state === YT.PlayerState.PLAYING) {
              startPolling();
            } else if (state === YT.PlayerState.PAUSED || state === YT.PlayerState.BUFFERING) {
              stopPolling();
            } else if (state === YT.PlayerState.ENDED) {
              stopPolling();
              if (!chapterEndFiredRef.current) {
                chapterEndFiredRef.current = true;
                onChapterEndRef.current();
              }
            }
          },
          onError: (event) => {
            if (!mounted) return;
            onError?.(event.data);
          },
        },
      });
    };

    init();

    return () => {
      mounted = false;
      isReadyRef.current = false;
      stopPolling();
      try {
        playerRef.current?.destroy();
      } catch {
        // destroy時のエラーは無視
      }
      playerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const playChapter = useCallback((videoId: string, startSeconds: number, endSeconds: number) => {
    if (isReadyRef.current && playerRef.current) {
      // 準備完了済み → 即再生
      doLoadVideo(playerRef.current, videoId, startSeconds, endSeconds);
    } else {
      // まだ準備できていない → pending に保存して onReady で再生する
      console.log('[YTPlayer] Not ready yet, saving pending chapter:', videoId);
      pendingChapterRef.current = { videoId, startSeconds, endSeconds };
    }
  }, [doLoadVideo]);

  const pause = useCallback(() => {
    playerRef.current?.pauseVideo();
    stopPolling();
  }, [stopPolling]);

  const resume = useCallback(() => {
    playerRef.current?.playVideo();
  }, []);

  const getCurrentTime = useCallback(() => {
    try {
      return playerRef.current?.getCurrentTime() ?? 0;
    } catch {
      return 0;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return { isReady, playChapter, pause, resume, getCurrentTime };
}
