// HarmonyPalette の src/components/puzzle/PuzzleRanking.tsx の移植。上位10件・今回のタイムの強調・ランク外のときの表示は同じ。
// 変えた所: 見た目（DESIGN.md。黒地→白い面、1〜3位の金銀銅の色つきアイコン→順位の数字だけ）、
// 名前の出し方（HarmonyPalette は名前を8字で切って「...」を付けていた→名前をそのまま。20字まで）、
// 文言（HarmonyPalette の ja.json に該当の文言が無かったので新しく書いた。すべて【仮】）、
// 記録を送った後に読み直す（refreshKey。HarmonyPalette は送る前に読んだ一覧のままだった）。
import React, { useEffect, useState } from "react";
import { getPuzzleRankings, type RankingEntry } from "../../../lib/crossword/scores";
import { C } from "../style";
import { Motion } from "./Motion";

// 文言【仮】
const T = {
  title: "ランキング",
  loading: "読み込み中...",
  loadFailed: "ランキングの読み込みに失敗しました",
  noRankings: "まだ記録がありません",
  yourTime: "今回のタイム",
  notRanked: "ランク外",
};

// ランキングの印（Hop 決定 2026-10-04。LinkedIn のゲームの称号のように、できたことを祝う形で出す）
export const scoreMark = (reveals: number, misses: number): string =>
  [misses === 0 ? "ノーミス" : null, reveals === 0 ? "ノーヒント" : `${reveals}文字見た`].filter(Boolean).join("・");

// タイムをフォーマット (秒 → M:SS)
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export const PuzzleRanking: React.FC<{ puzzleId: string; currentScore?: number; refreshKey?: number }> = ({ puzzleId, currentScore, refreshKey = 0 }) => {
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getPuzzleRankings(puzzleId, 10);
        if (alive) setRankings(data);
      } catch (err) {
        console.error("Failed to load rankings:", err);
        if (alive) setError(T.loadFailed);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [puzzleId, refreshKey]);

  if (loading) {
    return (
      <div className="bg-white p-6 text-center">
        <p className="text-sm" style={{ color: C.secondary }}>{T.loading}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white p-6 text-center">
        <p className="text-sm" style={{ color: C.error }}>{error}</p>
      </div>
    );
  }

  if (rankings.length === 0) {
    return (
      <div className="bg-white p-6 text-center">
        <p className="text-sm" style={{ color: C.secondary }}>{T.noRankings}</p>
        {currentScore !== undefined && (
          <p className="font-bold font-mono mt-2" style={{ color: C.ink }}>
            {T.yourTime} {formatTime(currentScore)}
          </p>
        )}
      </div>
    );
  }

  const inRanking = currentScore !== undefined && rankings.some((r) => Math.abs(r.timeSeconds - currentScore) < 1);

  return (
    <Motion initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }} className="bg-white p-6">
      {/* タイトル */}
      <h3 className="text-[0.6875rem] font-bold tracking-[0.1em] mb-4 text-center" style={{ color: C.secondary }}>{T.title}</h3>

      {/* ランキングリスト */}
      <div className="space-y-1">
        {rankings.map((entry) => {
          const isCurrentScore = currentScore !== undefined && Math.abs(entry.timeSeconds - currentScore) < 1;
          return (
            <div
              key={entry.rank}
              className={`flex items-center justify-between p-3 ${isCurrentScore ? "bg-surface-container-highest" : "bg-surface-container-low"}`}
            >
              {/* 左側：順位 + 名前 */}
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-6 text-center font-bold shrink-0" style={{ color: C.ink }}>{entry.rank}</span>
                <div className="min-w-0">
                  <p className="font-bold truncate" style={{ color: C.ink }}>{entry.displayName}</p>
                  <p className="text-xs" style={{ color: C.secondary }}>
                    {entry.completedAt.toLocaleDateString()}・{scoreMark(entry.reveals, entry.misses)}
                  </p>
                </div>
              </div>
              {/* 右側：タイム */}
              <div className="font-mono font-bold text-lg shrink-0 ml-2" style={{ color: C.ink }}>{formatTime(entry.timeSeconds)}</div>
            </div>
          );
        })}
      </div>

      {/* 現在のスコアがランク外の場合 */}
      {currentScore !== undefined && !inRanking && (
        <div className="mt-4 p-3 bg-surface-container-low text-center">
          <p className="text-sm mb-1" style={{ color: C.secondary }}>{T.yourTime}</p>
          <p className="font-mono font-bold text-xl" style={{ color: C.ink }}>{formatTime(currentScore)}</p>
          <p className="text-xs mt-1" style={{ color: C.secondary }}>{T.notRanked}</p>
        </div>
      )}
    </Motion>
  );
};
