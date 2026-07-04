import { useEffect, type RefObject } from "react";
import type { VideoLink } from "@/data/the-ballad";
import { SHOW_BY_NO, showLabel, MEMBER_COLOR } from "@/data/the-ballad";
import { useBackClose } from "@/hooks/useBackClose";
import { Emph } from "./Emph";
import YouTubePlayer, { type YouTubePlayerApi } from "./YouTubePlayer";

// visible の間だけ「戻る/Escで閉じる」を有効化する小コンポーネント(hookを条件付きにするため分離)。
function BackClose({ onClose }: { onClose: () => void }) {
  const requestClose = useBackClose(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);
  return null;
}

// 単体の動画モーダル。プレイヤーは TheBalladPage 側が常時 ready で保持し、再生(PlayChip)の
// タップハンドラ内で loadVideo される(iOS対策)。ここは常時マウントし visible で表示だけ切替。
export default function VideoModal({
  video,
  visible,
  playerRef,
  onClose,
}: {
  video: VideoLink | null;
  visible: boolean;
  playerRef: RefObject<YouTubePlayerApi | null>;
  onClose: () => void;
}) {
  const requestClose = () => window.history.back();
  // 閉じたら映像なしで音だけ鳴り続けないよう一時停止(規約対策)
  useEffect(() => {
    if (!visible) playerRef.current?.pause();
  }, [visible, playerRef]);

  const show = video ? SHOW_BY_NO.get(video.showNo) : undefined;

  return (
    <div
      onClick={requestClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.2rem",
        zIndex: 1000,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 0.12s",
      }}
    >
      {visible && <BackClose onClose={onClose} />}
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 880 }}>
        {video && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "0.6rem" }}>
            <div>
              <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#c6c6c6", margin: 0 }}>
                <Emph text={video.member} big="0.6875rem" small="0.6875rem" inkColor="#c6c6c6" color={MEMBER_COLOR[video.member] || undefined} />
              </p>
              <p style={{ fontSize: "0.95rem", fontWeight: 700, color: "#fff", margin: "0.1rem 0 0" }}>{video.songCore}</p>
              {show && (
                <p style={{ fontSize: "0.6875rem", color: "rgba(255,255,255,0.6)", margin: "0.2rem 0 0" }}>{showLabel(show)}</p>
              )}
            </div>
            <button
              onClick={requestClose}
              style={{ background: "transparent", border: "none", color: "#fff", fontSize: "1.1rem", cursor: "pointer", padding: "0.4rem 0.6rem" }}
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>
        )}

        <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", background: "#000" }}>
          <div style={{ position: "absolute", inset: 0 }}>
            <YouTubePlayer ref={playerRef} containerId="ballad-single-player" />
          </div>
        </div>

        {video && (
          <p style={{ fontSize: "0.625rem", color: "rgba(255,255,255,0.45)", margin: "0.6rem 0 0", lineHeight: 1.5 }}>
            公式ダイジェスト映像の該当箇所を再生しています（抜粋のため曲の全編が含まれない場合があります）。
          </p>
        )}
      </div>
    </div>
  );
}
