/**
 * StickyHintBar - 現在選択中のマスに対応するカギを常に画面下部に表示（HarmonyPalette からの移植）
 * 呼び名は「ヒント」→「カギ」に変更
 */

import React from "react";
import { C } from "../style";

interface HintItem {
  number: number;
  direction: "horizontal" | "vertical";
  hint: string;
}

interface StickyHintBarProps {
  currentHint: HintItem | null;
  onPrevHint?: () => void;
  onNextHint?: () => void;
  onToggleDirection?: () => void;
}

const barStyle: React.CSSProperties = { background: C.white, boxShadow: "0 -1px 8px rgba(0,0,0,0.08)" };

export const StickyHintBar: React.FC<StickyHintBarProps> = ({ currentHint, onPrevHint, onNextHint, onToggleDirection }) => {
  if (!currentHint) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-40 w-full p-3" style={barStyle}>
        <p className="text-center text-sm font-medium" style={{ color: C.secondary }}>
          マスを押すと、ここにカギが出ます
        </p>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 w-full p-3" style={barStyle}>
      <div className="flex items-center gap-2">
        {onPrevHint && (
          <button onClick={onPrevHint} className="p-2 bg-surface-container-low hover:bg-surface-container-high transition-colors" aria-label="前のカギ">
            <span aria-hidden="true" className="material-symbols-outlined leading-none" style={{ fontSize: "16px", color: C.secondary }}>chevron_left</span>
          </button>
        )}

        <button
          onClick={onToggleDirection}
          className="flex items-center gap-1 px-3 py-1.5 bg-surface-container-low hover:bg-surface-container-high font-semibold transition-colors"
          title="押すと向きを切り替えます"
          aria-label={`${currentHint.number}${currentHint.direction === "horizontal" ? "ヨコ" : "タテ"}・押すと向きを切り替えます`}
        >
          <span className="text-sm" style={{ color: C.ink }}>{currentHint.number}.</span>
          <span aria-hidden="true" className="material-symbols-outlined leading-none" style={{ fontSize: "16px", color: C.secondary }}>
            {currentHint.direction === "horizontal" ? "arrow_forward" : "arrow_downward"}
          </span>
        </button>

        <div className="flex-1 text-sm truncate" style={{ color: C.ink }}>
          {currentHint.hint}
        </div>

        {onNextHint && (
          <button onClick={onNextHint} className="p-2 bg-surface-container-low hover:bg-surface-container-high transition-colors" aria-label="次のカギ">
            <span aria-hidden="true" className="material-symbols-outlined leading-none" style={{ fontSize: "16px", color: C.secondary }}>chevron_right</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default StickyHintBar;
