// HarmonyPalette の src/components/puzzle/PuzzleGalleryCard.tsx の移植。並び・文言は同じ。
// 変えた所: 見た目（DESIGN.md。枠線なしの白い面、角なし、影なし、hover は面の濃淡）、アイコン（Material Symbols）、
// 足した物（「初めての人向け」の印）。
import React from "react";
import { useNavigate } from "react-router-dom";
import type { GalleryPuzzle } from "../../../lib/crossword/gallery";
import { C } from "../style";
import { Icon } from "./ui";

// 「初めての人向け」の印の文言【仮】
export const BEGINNER_LABEL = "初めての人向け";

// 日付をフォーマット（例: 1/25）
function formatDate(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export const PuzzleGalleryCard: React.FC<{ puzzle: GalleryPuzzle }> = ({ puzzle }) => {
  const navigate = useNavigate();
  const dateStr = formatDate(puzzle.created_at);

  return (
    <button
      type="button"
      onClick={() => navigate(`/crossword/${puzzle.id}`)}
      className="bg-white hover:bg-surface-container-low p-4 text-left w-full transition-colors"
      style={{ color: C.ink }}
    >
      {/* ヘッダー：タイトル */}
      <div className="flex items-start gap-2 mb-3">
        <Icon icon="extension" className="flex-shrink-0 mt-0.5" />
        <h3 className="text-base font-bold line-clamp-2" style={{ color: C.ink }}>
          {puzzle.title || "無題のパズル"}
        </h3>
      </div>

      {puzzle.is_beginner && (
        <div className="mb-3">
          <span className="inline-block px-2 py-0.5 text-[0.6875rem] font-bold tracking-[0.1em] bg-primary text-white">{BEGINNER_LABEL}</span>
        </div>
      )}

      {/* パズル情報 */}
      <div className="space-y-2 mb-3">
        {/* 作成者 */}
        <div className="flex items-center gap-2 text-sm">
          <Icon icon="person" size={16} className="flex-shrink-0" />
          <span className="truncate" style={{ color: C.secondary }}>{puzzle.creatorName || "Anonymous"}</span>
        </div>

        {/* 作成日・ワード数 */}
        <div className="flex items-center gap-4 text-xs" style={{ color: C.secondary }}>
          {dateStr && (
            <div className="flex items-center gap-1">
              <Icon icon="calendar_today" size={14} />
              <span>{dateStr}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <span>{puzzle.wordCount}ワード</span>
          </div>
        </div>
      </div>

      {/* フッター：プレイ回数とアクション */}
      <div className="flex items-center justify-between pt-3" style={{ borderTop: `1px solid ${C.ghost}` }}>
        <div className="flex items-center gap-1 text-xs" style={{ color: C.secondary }}>
          <Icon icon="play_arrow" size={14} />
          <span>{puzzle.play_count}回プレイ</span>
        </div>
        <div className="flex items-center gap-1 text-sm font-bold">
          <span>遊ぶ</span>
          <span aria-hidden="true">→</span>
        </div>
      </div>
    </button>
  );
};
