import type { VideoLink } from "@/data/the-ballad";

/** 動画あり = ▶ 公式映像 チップ。クリックで埋め込み再生。 */
export default function PlayChip({
  video,
  onPlay,
}: {
  video: VideoLink;
  onPlay: (v: VideoLink) => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onPlay(video);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        background: "#000",
        color: "#fff",
        border: "none",
        padding: "0.2rem 0.5rem",
        fontSize: "0.625rem",
        fontWeight: 700,
        letterSpacing: "0.04em",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: "0.6rem" }}>▶</span> 公式映像
    </button>
  );
}
