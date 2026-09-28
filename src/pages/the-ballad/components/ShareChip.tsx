import { useState } from "react";
import type { VideoLink } from "@/data/the-ballad";

// 公式映像の該当箇所（曲の頭）を指す YouTube URL を共有/コピーするボタン。
// スマホ等では共有シート（Web Share API）、非対応環境ではクリップボードにコピー。
export default function ShareChip({ video }: { video: VideoLink }) {
  const [copied, setCopied] = useState(false);
  const url = `https://youtu.be/${video.videoId}?t=${video.startSec}`;

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
    } catch {
      // 共有シートをキャンセルした等 → 何もしない
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボード不可環境では何もしない
    }
  };

  return (
    <button
      onClick={onClick}
      aria-label="共有URLをコピー"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        background: "transparent",
        color: "#000",
        border: "1px solid #000",
        padding: "0.2rem 0.5rem",
        fontSize: "0.625rem",
        fontWeight: 700,
        letterSpacing: "0.04em",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {copied ? "コピー済" : "URL"}
    </button>
  );
}
