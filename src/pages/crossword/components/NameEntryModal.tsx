// HarmonyPalette の PuzzleBuilderPage.tsx の「Name Entry Modal for Ranking」の移植。並び・20字は同じ。ボタンの文言とスキップの動きは変えた
// （スキップ＝「載せない」を押したら記録しない。HarmonyPalette は「スキップ」で名前なしで記録していた。Hop 決定 2026-10-03）。
// 変えた所: 見た目（DESIGN.md。黒い窓→白い窓、角なし、絵文字🏆を外した）。
import React, { useState } from "react";
import { C } from "../style";
import { formatTime } from "../../../lib/crossword/youtubeUrl";
import { Motion } from "./Motion";
import { useDialog } from "./useDialog";

// タイムは m:ss（1時間を超えたら h:mm:ss）
const mmss = formatTime;

export const NameEntryModal: React.FC<{
  clearTime: number;
  onSubmit: (name: string) => void;
  onSkip: () => void;
}> = ({ clearTime, onSubmit, onSkip }) => {
  const [rankingName, setRankingName] = useState("");
  // 名前を入れるか載せないかを選んでもらう窓なので、Esc では閉じない【仮】（2026-10-06 アクセシビリティの直し）
  const ref = useDialog({ closeOnEsc: false });
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="cw-name-title" className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <Motion initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white p-6 max-w-sm w-full" style={{ boxShadow: C.modalShadow }}>
        <h2 id="cw-name-title" className="text-xl font-bold mb-2" style={{ color: C.ink }}>解けた！</h2>
        <p className="text-sm mb-4" style={{ color: C.secondary }}>
          タイム：<span className="font-bold" style={{ color: C.ink }}>{mmss(clearTime)}</span>
        </p>
        <label htmlFor="cw-name-input" className="block text-sm mb-2" style={{ color: C.ink }}>ランキングに載せる名前を入力：</label>
        <input
          id="cw-name-input"
          type="text"
          value={rankingName}
          onChange={(e) => setRankingName(e.target.value)}
          placeholder="ニックネーム"
          maxLength={20}
          className="w-full bg-surface-container-low px-4 py-2 text-base text-on-surface placeholder:text-outline focus:outline-none focus:bg-white focus:shadow-[inset_0_-2px_0_#000] mb-4"
        />
        <div className="flex gap-2">
          <button onClick={onSkip} className="flex-1 py-2 bg-surface-container-high hover:bg-surface-container-highest transition-colors" style={{ color: C.secondary }}>
            {/* 押した結果が分かる言葉にする（スキップは記録しないため。任天堂のデザイナー視点のシミュレーションで決定・2026-10-03） */}
            載せない
          </button>
          <button onClick={() => onSubmit(rankingName.trim())} className="flex-1 py-2 bg-primary hover:bg-secondary text-white font-bold transition-colors">
            載せる
          </button>
        </div>
      </Motion>
    </div>
  );
};
