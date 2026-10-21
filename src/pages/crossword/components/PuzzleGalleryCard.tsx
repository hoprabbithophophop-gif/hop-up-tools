// HarmonyPalette の src/components/puzzle/PuzzleGalleryCard.tsx の移植。並び・文言は同じ。
// 変えた所: 見た目（DESIGN.md。枠線なしの白い面、角なし、影なし、hover は面の濃淡）、アイコン（Material Symbols）、
// 足した物（「初めての人向け」の印）、下段の「ランキング」の入口（Hop 指示 2026-10-17。解かなくてもランキングを見られるように。
// これに伴い、カード全体が1つのボタンだった作りを、面の押下＋下段の2つのリンクに変えた。ボタンの中にリンクは置けないため）。
import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { GalleryPuzzle } from "../../../lib/crossword/gallery";
import { prefersReducedMotion } from "../../../lib/crossword/motion";
import { C } from "../style";
import { Icon } from "./ui";

// 「初めての人向け」の印の文言
export const BEGINNER_LABEL = "初めての人向け";
// 下段の入口の文言
const T = { ranking: "ランキング", play: "遊ぶ", untitled: "無題の問題" };

// 日付をフォーマット（例: 1/25）
function formatDate(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// headingLevel: 題名の見出しの段（ギャラリーは h2、解き終えた画面の「ほかの問題」の下では h3。2026-10-06 アクセシビリティの直し）
// 押した時の動き（Hop が見本で選んだ案 C・2026-10-21）: 押した面の濃さを 120ms 残してから解く画面へ
const PRESS_HOLD_MS = 120;

// enterDelayMs: 一覧に出る時の入り方（上から順にふわっと。ギャラリーだけが渡す。渡さなければ動かない）
export const PuzzleGalleryCard: React.FC<{ puzzle: GalleryPuzzle; headingLevel?: 2 | 3; enterDelayMs?: number }> = ({ puzzle, headingLevel = 2, enterDelayMs }) => {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const navigate = useNavigate();
  const dateStr = formatDate(puzzle.created_at);
  const [pressed, setPressed] = useState(false);
  const pressTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
  }, []);
  const open = () => {
    if (pressTimer.current !== null) return; // 続けて押しても1回だけ移る
    const to = `/crossword/${puzzle.id}`;
    if (prefersReducedMotion()) {
      navigate(to);
      return;
    }
    setPressed(true);
    pressTimer.current = window.setTimeout(() => navigate(to), PRESS_HOLD_MS);
  };

  return (
    <article
      onClick={open}
      data-pressed={pressed ? "" : undefined}
      className={`bg-white hover:bg-surface-container-low p-4 text-left w-full transition-colors cursor-pointer${enterDelayMs !== undefined ? " cw-float-in" : ""}`}
      style={{ color: C.ink, ...(pressed ? { backgroundColor: C.high } : null), ...(enterDelayMs !== undefined ? { animationDelay: `${enterDelayMs}ms` } : null) }}
    >
      {/* ヘッダー：タイトル */}
      <div className="flex items-start gap-2 mb-3">
        <Icon icon="extension" className="flex-shrink-0 mt-0.5" />
        <Heading className="text-base font-bold line-clamp-2" style={{ color: C.ink }}>
          {puzzle.title || "無題の問題"}
        </Heading>
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
          <span className="truncate" style={{ color: C.secondary }}>{puzzle.creatorName || "名無し"}</span>
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
            <span>{puzzle.wordCount}語</span>
          </div>
        </div>
      </div>

      {/* フッター：プレイ回数とアクション */}
      {/* 下段: 幅が狭い時（解き終えた画面の3列）は入口が次の行に回る。入口の文字は途中で折らない */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-1" style={{ borderTop: `1px solid ${C.ghost}` }}>
        <div className="flex items-center gap-1 text-xs whitespace-nowrap py-2.5" style={{ color: C.secondary }}>
          <Icon icon="play_arrow" size={14} />
          <span>{puzzle.play_count}回遊ばれた</span>
        </div>
        <div className="flex items-center gap-4 text-sm ml-auto">
          {/* ランキングだけを見る（回は始めない）。面の押下（遊ぶ）には伝えない */}
          <Link
            to={`/crossword/${puzzle.id}/ranking`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 whitespace-nowrap py-2.5 hover:text-black transition-colors"
            style={{ color: C.secondary }}
            aria-label={`${puzzle.title || T.untitled}のランキング`}
          >
            <span>{T.ranking}</span>
            <span aria-hidden="true">→</span>
          </Link>
          <Link
            to={`/crossword/${puzzle.id}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 font-bold whitespace-nowrap py-2.5"
            style={{ color: C.ink }}
            aria-label={`${puzzle.title || T.untitled}を遊ぶ`}
          >
            <span>{T.play}</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
};
