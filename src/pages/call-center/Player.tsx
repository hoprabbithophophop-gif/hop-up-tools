import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

/**
 * 集約センター用の、操作できるYouTube埋め込み。
 *
 * ただ枠を置くだけの埋め込みでは「いま何秒を再生しているか」が読めないので、
 * YouTube が配っている操作用の仕組みを使って動画を置く。読み取った再生位置に
 * 合わせて、下のコール表示を動かす。
 *
 * ハイ！テンションにも同じ役目の部品があるが、あちらは置き場所の名札が
 * 決め打ちで1画面に1つしか置けない作りになっている。本番で動いているものを
 * 書き換えたくないので、こちらは別に用意した。
 *
 * 動画の上には何も重ねない（YouTubeの決まり）。表示はすべて動画の下に置く。
 */

const CONTAINER_ID = "call-center-player";

export type PlayerApi = {
  /** いま再生している秒数。読めないときは0 */
  getCurrentTime: () => number;
  /** 再生中か（一時停止・読み込み中は false） */
  isPlaying: () => boolean;
  /** 指定の秒へ飛ぶ */
  seekTo: (seconds: number) => void;
  /** 再生を始める。必ず利用者が押した操作の中から呼ぶこと（iPhone対策） */
  play: () => void;
  pause: () => void;
};

type Props = {
  videoId: string;
  /** 最初に頭出しする秒数 */
  startSeconds?: number;
  /** 再生・一時停止が切り替わったとき */
  onPlayingChange?: (playing: boolean) => void;
};

function loadYouTubeApi(): Promise<void> {
  return new Promise((resolve) => {
    if (window.YT?.Player) return resolve();
    if (!document.getElementById("yt-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "yt-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
  });
}

const Player = forwardRef<PlayerApi, Props>(function Player(
  { videoId, startSeconds = 0, onPlayingChange },
  ref,
) {
  const playerRef = useRef<YT.Player | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const onPlayingChangeRef = useRef(onPlayingChange);
  useEffect(() => {
    onPlayingChangeRef.current = onPlayingChange;
  }, [onPlayingChange]);

  // 最初の1回だけ作る。動画の切り替えは作り直さず、中身の入れ替えで行う。
  const firstVideo = useRef({ videoId, startSeconds });

  useEffect(() => {
    let alive = true;
    loadYouTubeApi().then(() => {
      if (!alive || playerRef.current) return;
      const el = document.getElementById(CONTAINER_ID);
      if (!el) return;
      playerRef.current = new YT.Player(CONTAINER_ID, {
        height: "100%",
        width: "100%",
        videoId: firstVideo.current.videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          start: Math.max(0, Math.floor(firstVideo.current.startSeconds)),
        },
        events: {
          onReady: () => {
            if (!alive) return;
            readyRef.current = true;
            setReady(true);
          },
          onStateChange: (e) => {
            if (!alive) return;
            onPlayingChangeRef.current?.(e.data === 1);
          },
        },
      });
    });
    return () => {
      alive = false;
      try {
        playerRef.current?.destroy();
      } catch {
        /* 破棄済みなら何もしない */
      }
      playerRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // 動画を切り替える。読み込むだけで再生はしない（勝手に音が出ないように）。
  useEffect(() => {
    if (!ready) return;
    if (videoId === firstVideo.current.videoId) return;
    firstVideo.current = { videoId, startSeconds };
    try {
      (
        playerRef.current as unknown as {
          cueVideoById?: (a: { videoId: string; startSeconds?: number }) => void;
        }
      )?.cueVideoById?.({ videoId, startSeconds: Math.max(0, startSeconds) });
    } catch {
      /* 切り替えに失敗しても画面は壊さない */
    }
  }, [videoId, startSeconds, ready]);

  useImperativeHandle(
    ref,
    () => ({
      getCurrentTime() {
        try {
          return playerRef.current?.getCurrentTime() ?? 0;
        } catch {
          return 0;
        }
      },
      isPlaying() {
        try {
          return playerRef.current?.getPlayerState() === 1;
        } catch {
          return false;
        }
      },
      seekTo(seconds: number) {
        try {
          playerRef.current?.seekTo(Math.max(0, seconds), true);
        } catch {
          /* まだ準備できていないときは何もしない */
        }
      },
      play() {
        try {
          playerRef.current?.playVideo();
        } catch {
          /* 同上 */
        }
      },
      pause() {
        try {
          playerRef.current?.pauseVideo();
        } catch {
          /* 同上 */
        }
      },
    }),
    [],
  );

  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000" }}>
      <div id={CONTAINER_ID} style={{ width: "100%", height: "100%" }} />
    </div>
  );
});

export default Player;
