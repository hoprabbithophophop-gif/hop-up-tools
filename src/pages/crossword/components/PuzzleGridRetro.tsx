// HarmonyPalette の PuzzleGridRetro の移植。並び・大きさ・線の引き方は同じ。
// 色は docs/DESIGN.md のトークンに置き換え（黄色の選択色 → 面の濃淡と黒、赤は間違いの表示だけ）
import React from "react";
import type { GridCell, PuzzleData } from "../../../lib/crossword/types";
import { C } from "../style";

interface PuzzleGridRetroProps {
  data: PuzzleData;
  showSolution?: boolean;
  onCellChange?: (cell: GridCell, newValue: string) => void;
  userAnswers?: Record<string, string>;
  activeCell?: { x: number; y: number } | null;
  /** 今の語（押したマスが属する語）の uuid。この語のマスだけを薄く塗る（行と列を塗る作りは外した。Hop 決定 2026-10-06） */
  activeWordId?: string | null;
  onCellFocus?: (x: number, y: number) => void;
  onCellClick?: (x: number, y: number) => void;
  wrongCells?: Set<string>;
  /** 静かに脈打たせるマス（初めて解く人に、押す所を知らせる。Hop 決定 2026-10-05）。色は使わず濃淡だけ */
  pulseCell?: { x: number; y: number } | null;
}

export const PuzzleGridRetro: React.FC<PuzzleGridRetroProps> = ({
  data,
  showSolution = false,
  userAnswers = {},
  activeCell,
  activeWordId = null,
  onCellFocus,
  onCellClick,
  wrongCells = new Set(),
  pulseCell = null,
}) => {
  const cellSize = 48;
  const containerWidth = data.width * cellSize;
  const containerHeight = data.height * cellSize;

  const isHighlighted = (cell: GridCell) => {
    if (!activeCell || !activeWordId) return false;
    return !!cell.wordIds?.includes(activeWordId);
  };

  if (!data.cells || data.cells.length === 0) {
    return (
      <div className="flex items-center justify-center p-12 bg-surface-container-low text-on-surface">
        パズルデータがありません
      </div>
    );
  }

  const cellsMap = new Map<string, GridCell>();
  data.cells.forEach((cell) => {
    cellsMap.set(`${cell.x},${cell.y}`, cell);
  });

  return (
    <div className="relative">
      <style>{`
        .puzzle-cell:focus {
          outline: none;
        }
        /* 押す所を知らせる脈打ち（1.2秒周期【仮】・濃淡だけ）。動きを減らす設定では止めて薄い面だけ出す */
        @keyframes crossword-cell-pulse {
          0%, 100% { opacity: 0; }
          50% { opacity: 1; }
        }
        .crossword-cell-pulse {
          background: rgba(0, 0, 0, 0.14);
          animation: crossword-cell-pulse 1.2s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .crossword-cell-pulse { animation: none; opacity: 0.6; }
        }
      `}</style>

      <div className="relative" style={{ width: containerWidth, height: containerHeight }}>
        {data.cells.map((cell) => {
          const cellKey = `${cell.x},${cell.y}`;
          const isActive = activeCell?.x === cell.x && activeCell?.y === cell.y;
          const isRowColActive = isHighlighted(cell);
          const isWrong = wrongCells.has(cellKey);
          const value = showSolution ? cell.value : userAnswers[cellKey] || "";

          const borderStyles = calculateBorderStyles(cell, cellsMap);
          const dashedBg = generateDashedBorderBackground(cell, borderStyles, cellSize);

          return (
            <div
              key={cellKey}
              className="absolute"
              style={{ width: cellSize, height: cellSize, left: cell.x * cellSize, top: cell.y * cellSize }}
            >
              {/* [No.13] ハイライト強化 - 関連ワード背景 */}
              {isRowColActive && !isActive && (
                <div className="absolute inset-0 pointer-events-none z-0" style={{ background: C.highlight }} />
              )}

              {/* [No.13] アクティブセル背景 */}
              {isActive && <div className="absolute inset-0 pointer-events-none z-0" style={{ background: C.active }} />}

              {pulseCell && pulseCell.x === cell.x && pulseCell.y === cell.y && (
                <div data-pulse="" className="crossword-cell-pulse absolute inset-0 pointer-events-none z-0" />
              )}

              <button
                id={`cell-${cell.x}-${cell.y}`}
                type="button"
                onClick={() => onCellClick?.(cell.x, cell.y)}
                onFocus={() => onCellFocus?.(cell.x, cell.y)}
                aria-label={`${cell.y + 1}行${cell.x + 1}列: ${value || "空"}`}
                className={`
                  puzzle-cell relative
                  w-full h-full text-center font-black uppercase
                  ${isActive ? "z-10" : "z-5"}
                  ${showSolution ? "cursor-default" : "cursor-pointer hover:opacity-80"}
                  focus:outline-none
                  transition-all
                `}
                style={{
                  backgroundColor: isWrong ? C.errorTint : isActive ? C.activeCell : value ? C.white : "transparent",
                  boxShadow: isWrong ? `0 0 0 2px ${C.error}` : isActive ? `0 0 0 2px ${C.black}` : undefined,
                  fontSize: "1.5rem",
                  fontWeight: 900,
                  letterSpacing: "-0.02em",
                  color: isWrong ? C.error : value ? C.ink : C.placeholder,
                  WebkitTextStroke: isActive ? undefined : value ? "0.3px #000" : undefined,
                  borderTopWidth: borderStyles.top === "solid" ? "1px" : "0",
                  borderRightWidth: borderStyles.right === "solid" ? "1px" : "0",
                  borderBottomWidth: borderStyles.bottom === "solid" ? "1px" : "0",
                  borderLeftWidth: borderStyles.left === "solid" ? "1px" : "0",
                  borderStyle: "solid",
                  borderColor: isWrong ? C.error : isActive ? C.black : BORDER_COLOR,
                  ...(dashedBg && {
                    backgroundImage: dashedBg.backgroundImage,
                    backgroundSize: dashedBg.backgroundSize,
                    backgroundPosition: dashedBg.backgroundPosition,
                    backgroundRepeat: dashedBg.backgroundRepeat,
                  }),
                }}
                disabled={showSolution}
              >
                {value || ""}
              </button>

              {/* Clue Number */}
              {cell.clueNumber && (
                <div className="absolute top-0.5 left-1 text-[9px] font-black z-10 pointer-events-none" style={{ color: C.ink }}>
                  {cell.clueNumber}
                </div>
              )}

              {/* Error Icon */}
              {isWrong && (
                <div className="absolute top-0 right-0 z-20 pointer-events-none" style={{ color: C.error }}>
                  <span className="material-symbols-outlined leading-none" style={{ fontSize: "20px", fontVariationSettings: "'FILL' 0, 'wght' 700, 'GRAD' 0, 'opsz' 24" }}>close</span>
                </div>
              )}

              {/* Mystery Cell Border */}
              {cell.isMystery && (
                <div className="absolute inset-0 border-4 border-double pointer-events-none z-15" style={{ borderColor: C.black }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * 隣接セルとの関係に基づいてボーダースタイルを計算
 * 同じ単語内の文字間 → 破線（dashed）
 * 異なる単語の文字が隣接 → 実線（solid）
 */
interface BorderStyles {
  top: "solid" | "dashed";
  right: "solid" | "dashed";
  bottom: "solid" | "dashed";
  left: "solid" | "dashed";
}

const calculateBorderStyles = (cell: GridCell, cellsMap: Map<string, GridCell>): BorderStyles => {
  const styles: BorderStyles = { top: "solid", right: "solid", bottom: "solid", left: "solid" };
  if (!cell.wordIds || cell.wordIds.length === 0) return styles;
  const adjacentOffsets = {
    top: { dx: 0, dy: -1 },
    right: { dx: 1, dy: 0 },
    bottom: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
  };
  for (const [direction, offset] of Object.entries(adjacentOffsets)) {
    const adjCell = cellsMap.get(`${cell.x + offset.dx},${cell.y + offset.dy}`);
    if (adjCell && adjCell.wordIds && adjCell.wordIds.length > 0) {
      const hasCommonWord = cell.wordIds.some((id) => adjCell.wordIds!.includes(id));
      if (hasCommonWord) styles[direction as keyof BorderStyles] = "dashed";
    }
  }
  return styles;
};

interface DashedBorderBgStyles {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
}

const DASH_LENGTH = 4; // 破線の長さ (px)
const GAP_LENGTH = 3; // 空白の長さ (px)
const BORDER_COLOR = "#6b7280"; // HarmonyPalette と同じ線の色（DESIGN.md の盤の線の例外）

const generateDashedBorderBackground = (cell: GridCell, borderStyles: BorderStyles, cellSize: number): DashedBorderBgStyles | null => {
  const images: string[] = [];
  const sizes: string[] = [];
  const positions: string[] = [];
  const pattern = DASH_LENGTH + GAP_LENGTH;
  const horizontalGradient = `repeating-linear-gradient(to right, ${BORDER_COLOR} 0px, ${BORDER_COLOR} ${DASH_LENGTH}px, transparent ${DASH_LENGTH}px, transparent ${pattern}px)`;
  const verticalGradient = `repeating-linear-gradient(to bottom, ${BORDER_COLOR} 0px, ${BORDER_COLOR} ${DASH_LENGTH}px, transparent ${DASH_LENGTH}px, transparent ${pattern}px)`;
  const xOffset = (cell.x * cellSize) % pattern;
  const yOffset = (cell.y * cellSize) % pattern;
  if (borderStyles.top === "dashed") {
    images.push(horizontalGradient);
    sizes.push(`100% 1px`);
    positions.push(`${-xOffset}px 0px`);
  }
  if (borderStyles.bottom === "dashed") {
    images.push(horizontalGradient);
    sizes.push(`100% 1px`);
    positions.push(`${-xOffset}px 100%`);
  }
  if (borderStyles.left === "dashed") {
    images.push(verticalGradient);
    sizes.push(`1px 100%`);
    positions.push(`0px ${-yOffset}px`);
  }
  if (borderStyles.right === "dashed") {
    images.push(verticalGradient);
    sizes.push(`1px 100%`);
    positions.push(`100% ${-yOffset}px`);
  }
  if (images.length === 0) return null;
  return {
    backgroundImage: images.join(", "),
    backgroundSize: sizes.join(", "),
    backgroundPosition: positions.join(", "),
    backgroundRepeat: "no-repeat",
  };
};
