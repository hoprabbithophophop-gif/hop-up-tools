// 解く画面のヒント。YouTube はアプリ内のプレイヤー（自動再生しない・上に何も重ねない）、それ以外は別タブで開くリンク
import React from "react";
import type { HintRef } from "../../../lib/crossword/puzzleStore";
import { C } from "../style";

export const HintView: React.FC<{ hint: HintRef }> = ({ hint }) => {
  if (hint.kind === "youtube") {
    const src = `https://www.youtube.com/embed/${encodeURIComponent(hint.videoId)}?start=${Math.max(0, Math.floor(hint.startSec))}&playsinline=1`;
    return (
      <div className="p-3">
        <div className="relative w-full" style={{ aspectRatio: "16 / 9", background: C.black }}>
          <iframe
            src={src}
            title="YouTube"
            className="absolute inset-0 w-full h-full"
            style={{ border: 0 }}
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
      </div>
    );
  }
  // 保存された中身はだれでも入れられるので、http(s) 以外のリンクは開けないようにする
  if (!/^https?:\/\//i.test(hint.url)) {
    return (
      <div className="p-4 text-sm break-all" style={{ color: C.secondary }}>
        {hint.url}
      </div>
    );
  }
  return (
    <div className="p-4">
      <a
        href={hint.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-3 py-3 bg-surface-container-low hover:bg-surface-container-high transition-colors text-sm break-all"
        style={{ color: C.ink }}
      >
        <span className="flex-1">{hint.url}</span>
        <span className="material-symbols-outlined leading-none shrink-0" style={{ fontSize: "18px" }}>open_in_new</span>
      </a>
    </div>
  );
};
