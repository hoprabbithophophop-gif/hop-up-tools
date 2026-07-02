import type { VideoLink } from "@/data/the-ballad";
import { useBackClose } from "@/hooks/useBackClose";
import CompareView from "./CompareView";

// 歌い比べ（CompareView）をモーダルで開くラッパー。
export default function CompareModal({
  title,
  versions,
  onClose,
}: {
  title: string;
  versions: VideoLink[];
  onClose: () => void;
}) {
  const requestClose = useBackClose(onClose);
  return (
    <div
      onClick={requestClose}
      className="page-fade-in"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.2rem", zIndex: 1000 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 720, maxHeight: "90vh", overflowY: "auto", background: "#000", padding: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.6rem" }}>
          <p style={{ fontSize: "0.95rem", fontWeight: 700, color: "#fff", margin: 0 }}>{title}</p>
          <button onClick={requestClose} aria-label="閉じる" style={{ background: "transparent", border: "none", color: "#fff", fontSize: "1.1rem", cursor: "pointer", padding: "0.2rem 0.5rem" }}>
            ✕
          </button>
        </div>
        <CompareView versions={versions} />
      </div>
    </div>
  );
}
