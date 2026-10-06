// 終わりの画面の「動画の一覧」。そのパズルのヒントを全部、カギの番号順に並べる。
// YouTube はサムネイルを原寸（320×180 の mqdefault）で出し、加工しない（DESIGN.md §3）。`▶ YouTube` の出典表記を必ず添える。
// 押すと解く画面と同じ埋め込みプレイヤー（HintView。自動再生しない・上に何も重ねない）に置き換わる。YouTube 以外はリンク（HintView と同じ）。
// 幅が 320px に足りない画面では、縮めずに横にずらして見る（縮めるのも加工に当たるため）。
import React, { useState } from "react";
import type { PlacedItem } from "../../../lib/crossword/types";
import type { HintRef, Genre } from "../../../lib/crossword/puzzleStore";
import { C } from "../style";
import { HintView } from "./HintView";

// 文言
const T = {
  title: (genre: Genre | null) => (genre === "other" ? "ヒント" : "ヒントの動画"),
  play: "再生する",
};

const dirLabel = (d: "horizontal" | "vertical") => (d === "horizontal" ? "ヨコ" : "タテ");

export const HintList: React.FC<{ items: PlacedItem[]; hints: Record<string, HintRef>; genre?: Genre | null }> = ({ items, hints, genre = null }) => {
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const list = [...items]
    .sort((a, b) => (a.clueIndex || 0) - (b.clueIndex || 0) || (a.direction === "horizontal" ? -1 : 1))
    .filter((i) => hints[i.uuid]);
  if (list.length === 0) return null;

  return (
    <div className="bg-white p-4 mt-6">
      <h3 className="text-[0.6875rem] font-bold tracking-[0.1em] mb-2" style={{ color: C.secondary }}>{T.title(genre)}</h3>
      <ul>
        {list.map((item) => {
          const hint = hints[item.uuid];
          return (
            <li key={item.uuid} className="py-3" style={{ borderTop: `1px solid ${C.ghost}` }}>
              <p className="text-sm mb-2" style={{ color: C.ink }}>
                <span className="font-bold mr-2">{item.clueIndex}.</span>
                <span className="mr-2" style={{ color: C.secondary }}>{dirLabel(item.direction)}</span>
                <span className="font-bold mr-2">{item.answer.join("")}</span>
                <span style={{ color: C.secondary }}>{item.question}</span>
              </p>
              {hint.kind === "youtube" ? (
                opened.has(item.uuid) ? (
                  <div className="-mx-3">
                    <HintView hint={hint} />
                  </div>
                ) : (
                  // 枠の左右の余白まで使って、幅 360px の画面でも縮めずに収める
                  <div className="-mx-4 overflow-x-auto">
                    <button
                      type="button"
                      onClick={() => setOpened((prev) => new Set(prev).add(item.uuid))}
                      className="block w-max mx-auto text-left"
                      aria-label={`${item.clueIndex}（${dirLabel(item.direction)}）の${T.title(genre)}を${T.play}`}
                    >
                      <img
                        src={`https://i.ytimg.com/vi/${encodeURIComponent(hint.videoId)}/mqdefault.jpg`}
                        width={320}
                        height={180}
                        alt=""
                        loading="lazy"
                        style={{ width: 320, height: 180, maxWidth: "none", display: "block" }}
                      />
                    </button>
                  </div>
                )
              ) : (
                <div className="-mx-4">
                  <HintView hint={hint} />
                </div>
              )}
              {hint.kind === "youtube" && (
                <p className="text-xs mt-1" style={{ color: C.secondary }}>▶ YouTube</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
