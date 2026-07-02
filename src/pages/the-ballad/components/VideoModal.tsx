import { useEffect } from "react";
import type { VideoLink } from "@/data/the-ballad";
import { SHOW_BY_NO, showLabel, MEMBER_COLOR } from "@/data/the-ballad";
import { useBackClose } from "@/hooks/useBackClose";
import { Emph } from "./Emph";

export default function VideoModal({
  video,
  onClose,
}: {
  video: VideoLink;
  onClose: () => void;
}) {
  // ブラウザバック（戻る）で閉じる。UI操作の閉じるも requestClose 経由で履歴と表示を一致させる。
  const requestClose = useBackClose(onClose);

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const show = SHOW_BY_NO.get(video.showNo);
  const src = `https://www.youtube.com/embed/${video.videoId}?start=${video.startSec}&autoplay=1&rel=0`;

  return (
    <div
      onClick={requestClose}
      className="page-fade-in"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.2rem",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 880 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "0.6rem" }}>
          <div>
            <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#c6c6c6", margin: 0 }}>
              <Emph text={video.member} big="0.6875rem" small="0.6875rem" inkColor="#c6c6c6" color={MEMBER_COLOR[video.member] || undefined} />
            </p>
            <p style={{ fontSize: "0.95rem", fontWeight: 700, color: "#fff", margin: "0.1rem 0 0" }}>
              {video.songCore}
            </p>
            {show && (
              <p style={{ fontSize: "0.6875rem", color: "rgba(255,255,255,0.6)", margin: "0.2rem 0 0" }}>
                {showLabel(show)}
              </p>
            )}
          </div>
          <button
            onClick={requestClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#fff",
              fontSize: "1.1rem",
              cursor: "pointer",
              padding: "0.4rem 0.6rem",
            }}
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", background: "#000" }}>
          <iframe
            src={src}
            title={`${video.member} ${video.songCore}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
          />
        </div>

        <p style={{ fontSize: "0.625rem", color: "rgba(255,255,255,0.45)", margin: "0.6rem 0 0", lineHeight: 1.5 }}>
          公式ダイジェスト映像の該当箇所を再生しています（抜粋のため曲の全編が含まれない場合があります）。
        </p>
      </div>
    </div>
  );
}
