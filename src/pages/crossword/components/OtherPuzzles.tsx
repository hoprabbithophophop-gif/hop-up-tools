// 終わりの画面の「ほかの問題」。同じジャンルの新しい順に数件と、一覧への入口。
// カードは一覧と同じ PuzzleGalleryCard。読めなかった・1件も無いときは、一覧への入口だけを出す。
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getOtherPuzzles, type GalleryPuzzle } from "../../../lib/crossword/gallery";
import type { Genre } from "../../../lib/crossword/puzzleStore";
import { C } from "../style";
import { PuzzleGalleryCard } from "./PuzzleGalleryCard";

// 文言
const T = {
  title: "ほかの問題",
  toList: "パズルギャラリーへ",
};
// 出す件数
const COUNT = 3;

export const OtherPuzzles: React.FC<{ genre: Genre; puzzleId: string }> = ({ genre, puzzleId }) => {
  const [list, setList] = useState<GalleryPuzzle[]>([]);

  useEffect(() => {
    let alive = true;
    getOtherPuzzles(genre, puzzleId, COUNT)
      .then((l) => {
        if (alive) setList(l);
      })
      .catch((err) => console.warn("Failed to load other puzzles:", err));
    return () => {
      alive = false;
    };
  }, [genre, puzzleId]);

  return (
    <div className="mt-6">
      {list.length > 0 && (
        <>
          <h2 className="text-[0.6875rem] font-bold tracking-[0.1em] mb-2" style={{ color: C.secondary }}>{T.title}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-[2px]">
            {list.map((p) => (
              <PuzzleGalleryCard key={p.id} puzzle={p} headingLevel={3} />
            ))}
          </div>
        </>
      )}
      <div className="text-center mt-4">
        <Link
          to="/crossword"
          className="inline-flex items-center gap-2 px-6 py-3 bg-surface-container-high hover:bg-surface-container-highest transition-colors font-medium"
          style={{ color: C.ink }}
        >
          {T.toList} <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
};
