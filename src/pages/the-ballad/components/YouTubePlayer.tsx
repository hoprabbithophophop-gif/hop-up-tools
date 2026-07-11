import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import LoadingDots from "../../hi-tension/components/LoadingDots";
import { tbLog, reportIncidentThrottled } from "@/utils/debugLog";

// 聴き比べ用の1枚プレイヤー。hi-tension の YouTubePlayer を流用（CONTAINER_ID と LoadingDots パスのみ変更）。
// iOS対策の要: 再生開始/動画切替はユーザーのタップハンドラ内で同期的に loadVideo/unMute を呼ぶこと。
const POLL_MS = 100;
const LOADING_MIN_MS = 800;

export type YouTubePlayerApi = {
  /** ユーザージェスチャー直後に同期的に呼ぶこと(iOS Safari の autoplay 制約対策) */
  play: () => void;
  pause: () => void;
  replay: () => void;
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
  isPlaying: () => boolean;
  getVideoLoadedFraction: () => number;
  getDuration: () => number;
  mute: () => void;
  unMute: () => void;
  /** 指定動画IDをロードして即再生（同じ iframe を使い回す）。opts で開始/終了秒・cover を指定 */
  loadVideo: (id: string, opts?: { startSeconds?: number; endSeconds?: number; cover?: boolean }) => void;
};

interface Props {
  /** 初期動画。省略時は空プレイヤーを作り、loadVideo で実際の動画を入れる(暖機用) */
  videoId?: string;
  /** iframe コンテナのDOM id。複数プレイヤーを同時マウントする時に一意にする */
  containerId?: string;
  onEnded?: () => void;
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
  { videoId, containerId = "ballad-yt-player", onEnded, onTimeUpdate, onPlayerStateChange },
  ref,
) {
  const [isReady, setIsReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [loadCovering, setLoadCovering] = useState(false);
  const startedRef = useRef(false);
  const minTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null);
  const isReadyRef = useRef(false);
  const lastStartRef = useRef(0); // 最後に loadVideo で指定した startSeconds(0付近から再生される稀な現象の補正用)
  const wantPlayRef = useRef(false);
  const wantLoadRef = useRef<{ id: string; opts?: { startSeconds?: number; endSeconds?: number; cover?: boolean } } | null>(null);
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
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
    let muteChk = 0;
    const startPolling = () => {
      stopPolling();
      muteChk = 0;
      pollRef.current = setInterval(() => {
        const p = playerRef.current;
        if (!p) return;
        try { onTimeUpdateRef.current?.(p.getCurrentTime()); } catch { /* ignore */ }
        // automute監視(約1秒毎): 再生中(PLAYING)なのに勝手にミュートされたら記録＋自動で音を戻す(iOSの保険)
        if (++muteChk >= 10) {
          muteChk = 0;
          try {
            if (p.getPlayerState?.() === 1 && p.isMuted?.()) {
              reportIncidentThrottled("automute", { t: Math.round((p.getCurrentTime?.() ?? 0) * 10) / 10 });
              p.unMute();
              tbLog("automute-recover");
            }
          } catch { /* ignore */ }
        }
      }, POLL_MS);
    };

    const init = async () => {
      await loadYouTubeAPI();
      if (!mounted) return;
      let element: HTMLElement | null = null;
      for (let i = 0; i < 25; i++) {
        element = document.getElementById(containerId);
        if (element || !mounted) break;
        await new Promise(r => setTimeout(r, 200));
      }
      if (!mounted || !element) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const YT = (window as any).YT;
      playerRef.current = new YT.Player(containerId, {
        height: "100%",
        width: "100%",
        ...(videoId ? { videoId } : {}),
        playerVars: {
          autoplay: 0, // 再生はユーザーのタップハンドラ内で loadVideo/play を同期呼び出しして起動(iOS対策)
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          cc_load_policy: 0, // 字幕をデフォルト非表示(勝手にオンになるのを防ぐ)
        },
        events: {
          onReady: () => {
            if (!mounted) return;
            isReadyRef.current = true;
            setIsReady(true);
            if (wantLoadRef.current) {
              const { id, opts } = wantLoadRef.current;
              wantLoadRef.current = null;
              try {
                playerRef.current?.loadVideoById?.({
                  videoId: id,
                  startSeconds: opts?.startSeconds ?? 0,
                  ...(opts?.endSeconds !== undefined ? { endSeconds: opts.endSeconds } : {}),
                });
              } catch { /* ignore */ }
            }
            if (wantPlayRef.current) {
              wantPlayRef.current = false;
              try { playerRef.current?.playVideo(); } catch { /* ignore */ }
            }
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onStateChange: (event: any) => {
            if (!mounted) return;
            const state = event.data;
            onPlayerStateChangeRef.current?.(state);
            if (state === 1 /* PLAYING */) {
              startPolling();
              setLoadCovering(false);
              if (coverTimerRef.current) { clearTimeout(coverTimerRef.current); coverTimerRef.current = null; }
              // 勝手にオンになる字幕(captions)を無効化。動画切替後もPLAYING毎に効かせる
              try { playerRef.current?.unloadModule?.("captions"); playerRef.current?.unloadModule?.("cc"); } catch { /* ignore */ }
              // startSeconds が稀に効かず0付近から再生される現象を補正。位置が startSeconds より
              // 3秒以上「手前」の時だけ発動(正常に進んでいる/ループ復帰した時は発動しない=UX影響なし)
              try {
                const want = lastStartRef.current;
                const cur = playerRef.current?.getCurrentTime?.() ?? 0;
                if (want > 3 && cur < want - 3) playerRef.current?.seekTo(want, true);
              } catch { /* ignore */ }
            } else if (state === 2 || state === 3) {
              stopPolling();
            } else if (state === 0 /* ENDED */) {
              stopPolling();
              onEndedRef.current?.();
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

  useEffect(() => () => {
    if (minTimerRef.current) clearTimeout(minTimerRef.current);
    if (coverTimerRef.current) clearTimeout(coverTimerRef.current);
  }, []);

  const beginLoadingTimer = () => {
    if (!startedRef.current) {
      startedRef.current = true;
      setStarted(true);
      minTimerRef.current = setTimeout(() => setMinTimeElapsed(true), LOADING_MIN_MS);
    }
  };

  useImperativeHandle(ref, () => ({
    play() {
      beginLoadingTimer();
      const p = playerRef.current;
      if (p && isReadyRef.current) {
        try {
          if (p.getPlayerState() === 0) p.seekTo(0, true);
          p.playVideo();
        } catch { /* ignore */ }
      } else {
        wantPlayRef.current = true;
      }
    },
    pause() { try { playerRef.current?.pauseVideo(); } catch { /* ignore */ } },
    replay() {
      const p = playerRef.current;
      if (!p) return;
      try { p.seekTo(0, true); p.playVideo(); } catch { /* ignore */ }
    },
    seekTo(seconds: number) {
      // 明示 seek 先を「意図した現在位置」として記録する。更新しないと直前 loadVideo の startSeconds(切替位置)が
      // lastStartRef に残り、PLAYING補正がループの曲頭戻しを「0付近への異常」と誤判定して切替位置へ引き戻す
      // (ループの戻り先がサビになる不具合)。
      lastStartRef.current = Math.max(0, seconds);
      try { playerRef.current?.seekTo(Math.max(0, seconds), true); } catch { /* ignore */ }
    },
    getCurrentTime() { try { return playerRef.current?.getCurrentTime() ?? 0; } catch { return 0; } },
    isPlaying() { try { return playerRef.current?.getPlayerState() === 1; } catch { return false; } },
    getVideoLoadedFraction() { try { return playerRef.current?.getVideoLoadedFraction?.() ?? 0; } catch { return 0; } },
    getDuration() { try { return playerRef.current?.getDuration?.() ?? 0; } catch { return 0; } },
    mute() { try { playerRef.current?.mute?.(); } catch { /* ignore */ } },
    unMute() { try { playerRef.current?.unMute?.(); } catch { /* ignore */ } },
    loadVideo(id: string, opts?: { startSeconds?: number; endSeconds?: number; cover?: boolean }) {
      beginLoadingTimer();
      lastStartRef.current = opts?.startSeconds ?? 0;
      if (opts?.cover) {
        setLoadCovering(true);
        if (coverTimerRef.current) clearTimeout(coverTimerRef.current);
        coverTimerRef.current = setTimeout(() => setLoadCovering(false), 6000);
      }
      const p = playerRef.current;
      if (p && isReadyRef.current) {
        try {
          p.loadVideoById?.({
            videoId: id,
            startSeconds: opts?.startSeconds ?? 0,
            ...(opts?.endSeconds !== undefined ? { endSeconds: opts.endSeconds } : {}),
          });
        } catch { /* ignore */ }
      } else {
        wantLoadRef.current = { id, opts };
      }
    },
  }), []);

  const showLoading = !isReady || (started && !minTimeElapsed) || loadCovering;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#000" }}>
      <div id={containerId} style={{ width: "100%", height: "100%" }} />
      {/* 動画切替時にYouTube純正UI(タイトル/再生ボタン/関連動画)が一瞬見えるのを隠すカバー。
          出す時は即座に(チラつきを覆う)、消す時だけフェードで再生を見せる。pointerEvents:none で動画上の操作は奪わない(規約)。 */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          pointerEvents: "none",
          opacity: showLoading ? 1 : 0,
          transition: showLoading ? "none" : "opacity 0.3s ease",
        }}
      >
        <LoadingDots />
      </div>
    </div>
  );
});

export default YouTubePlayer;
