import { useEffect, type RefObject } from "react";
import type { VideoLink } from "@/data/the-ballad";
import { useBackClose } from "@/hooks/useBackClose";
import CompareView from "./CompareView";
import YouTubePlayer, { type YouTubePlayerApi } from "./YouTubePlayer";

// visible の間だけ「戻るで閉じる」を有効化する小コンポーネント(hookを条件付きにするため分離)。
function BackClose({ onClose }: { onClose: () => void }) {
  useBackClose(onClose);
  return null;
}

// 聴き比べ(CompareView)をモーダルで開くラッパー。
// プレイヤーは常時 ready で保持し(暖機)、聴き比べボタンのタップハンドラ内で loadVideo される。
// そのため CompareModal は常時マウントし、visible で表示だけ切り替える(opacity/pointerEvents)。
export default function CompareModal({
  title,
  versions,
  visible,
  playerRef,
  onClose,
}: {
  title: string;
  versions: VideoLink[];
  visible: boolean;
  playerRef: RefObject<YouTubePlayerApi | null>;
  onClose: () => void;
}) {
  const requestClose = () => window.history.back();
  // モーダルを閉じたら(非表示) 映像が見えないのに音だけ鳴り続けるのは規約違反なので一時停止する
  useEffect(() => {
    if (!visible) playerRef.current?.pause();
  }, [visible, playerRef]);
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
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 720, maxHeight: "90vh", display: "flex", flexDirection: "column", background: "#000", padding: "1rem" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.6rem", flexShrink: 0 }}>
          <p style={{ fontSize: "0.95rem", fontWeight: 700, color: "#fff", margin: 0 }}>{title}</p>
          <button onClick={requestClose} aria-label="閉じる" style={{ background: "transparent", border: "none", color: "#fff", fontSize: "1.1rem", cursor: "pointer", padding: "0.2rem 0.5rem" }}>
            ✕
          </button>
        </div>
        {/* 動画: 1枚プレイヤーを常時 ready で保持(loadVideo で版切替) */}
        <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", background: "#000", flexShrink: 0 }}>
          <div style={{ position: "absolute", inset: 0 }}>
            <YouTubePlayer ref={playerRef} />
          </div>
        </div>
        {visible && versions.length > 0 && (
          <CompareView versions={versions} playerRef={playerRef} visible={visible} />
        )}
      </div>
    </div>
  );
}
