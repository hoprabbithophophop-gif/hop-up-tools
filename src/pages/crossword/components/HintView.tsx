// 解く画面のヒント。YouTube はアプリ内のプレイヤー（自動再生しない・上に何も重ねない）、それ以外は別タブで開くリンク
// 動画が見られなくなっていたら（台帳から消えた・削除・非公開・埋め込み禁止）、プレイヤーの代わりに知らせを出す（Hop 決定 2026-10-04）
import React, { useEffect, useRef, useState } from "react";
import type { HintRef } from "../../../lib/crossword/puzzleStore";
import { PAUSE_PLAYERS_EVENT } from "../../../lib/pageWave";
import { loadYouTubeAPI, UNAVAILABLE_CODES } from "./HintPlayer";
import { C } from "../style";

const GONE = "このヒントの動画は見られなくなりました";

// 見た目はこれまでの埋め込みと同じ。再生できない合図を受け取るために IFrame API で置く（自動再生しない）
const HintVideo: React.FC<{ videoId: string; startSec: number }> = ({ videoId, startSec }) => {
  const holderRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let mounted = true;
    setGone(false);
    (async () => {
      await loadYouTubeAPI();
      const holder = holderRef.current;
      if (!mounted || !holder) return;
      const el = document.createElement("div");
      holder.appendChild(el);
      playerRef.current = new window.YT.Player(el, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: { autoplay: 0, controls: 1, rel: 0, playsinline: 1, start: Math.max(0, Math.floor(startSec)) },
        events: { onError: (e: { data: number }) => { if (mounted && UNAVAILABLE_CODES.has(e.data)) setGone(true); } },
      });
    })();
    return () => {
      mounted = false;
      try { playerRef.current?.destroy(); } catch { /* ignore */ }
      playerRef.current = null;
      if (holderRef.current) holderRef.current.innerHTML = "";
    };
  }, [videoId, startSec]);

  useEffect(() => {
    const pause = () => { try { playerRef.current?.pauseVideo(); } catch { /* ignore */ } };
    window.addEventListener(PAUSE_PLAYERS_EVENT, pause);
    return () => window.removeEventListener(PAUSE_PLAYERS_EVENT, pause);
  }, []);

  if (gone) return <GoneNote />;
  return (
    <div className="p-3">
      <div className="relative w-full" style={{ aspectRatio: "16 / 9", background: C.black }}>
        <div ref={holderRef} className="absolute inset-0 [&_iframe]:w-full [&_iframe]:h-full" />
      </div>
    </div>
  );
};

const GoneNote: React.FC = () => (
  <div className="p-4 text-sm" style={{ color: C.secondary }}>
    {GONE}
  </div>
);

export const HintView: React.FC<{ hint: HintRef }> = ({ hint }) => {
  if (hint.kind === "youtube") {
    // gone は問題を開いた時に台帳で確かめた印（ハロプロのジャンル）
    if (hint.gone) return <GoneNote />;
    return <HintVideo videoId={hint.videoId} startSec={hint.startSec} />;
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
        <span className="flex-1 min-w-0">
          {/* 行き先が分かるように、ドメインを先に大きく出す（Hop 決定 2026-10-04） */}
          <span className="block font-bold">{(() => { try { return new URL(hint.url).hostname; } catch { return ""; } })()}</span>
          <span className="block text-xs" style={{ color: C.secondary }}>{hint.url}</span>
        </span>
        <span className="material-symbols-outlined leading-none shrink-0" style={{ fontSize: "18px" }}>open_in_new</span>
      </a>
    </div>
  );
};
