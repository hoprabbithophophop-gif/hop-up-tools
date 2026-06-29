import type { VideoLink } from "@/data/the-ballad";
import { SHOW_BY_NO } from "@/data/the-ballad";
import { C } from "../ui";
import PlayChip from "./PlayChip";

const MAX = 4; // 別動画が多いときの並べすぎ防止

/**
 * (メンバー×曲) の公式映像チップ。
 * - 同じ動画(動画ID)は1つにまとめる（合体ダイジェストが昼夜2公演に紐付くと重複するため）
 * - ラベルは「日付 開演時刻」。開演時刻は省略しない（14:30 / 18:15 / 14:30/18:15）
 */
export default function VideoChips({
  videos,
  onPlay,
}: {
  videos: VideoLink[];
  onPlay: (v: VideoLink) => void;
}) {
  // 動画IDで重複排除（同一動画は1チップ）
  const seen = new Set<string>();
  const uniq = videos.filter((v) => (seen.has(v.videoId) ? false : (seen.add(v.videoId), true)));
  if (uniq.length === 0) return null;

  const shown = uniq.slice(0, MAX);
  const rest = uniq.length - shown.length;
  return (
    <>
      {shown.map((v) => {
        const date = SHOW_BY_NO.get(v.showNo)?.date ?? "";
        const label = [date, v.startLabel].filter(Boolean).join(" ");
        return (
          <span key={v.videoId} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.625rem", color: C.meta }}>{label}</span>
            <PlayChip video={v} onPlay={onPlay} />
          </span>
        );
      })}
      {rest > 0 && <span style={{ fontSize: "0.625rem", color: C.faint }}>ほか{rest}本</span>}
    </>
  );
}
