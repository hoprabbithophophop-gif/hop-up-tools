import { useEffect, useRef, useState } from "react";
import type { VideoLink } from "@/data/the-ballad";
import { SHOW_BY_NO, COMPARE_ANCHOR } from "@/data/the-ballad";
import { C } from "../ui";

// 同じ曲の複数バージョン（歌唱者／公演）を切り替えて聴き比べる。
// M3: 校正アンカーで「曲頭からの経過秒」を保った位置合わせ切替。
// M2: 2枚のプレイヤーを持ち、選んだ1本だけ裏で先読み(arm)→準備OK後の再タップで即切替（10本は読まない）。

let ytReady: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.YT && w.YT.Player) return Promise.resolve();
  if (ytReady) return ytReady;
  ytReady = new Promise<void>((resolve) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return ytReady;
}

function versionLabel(v: VideoLink): string {
  const date = SHOW_BY_NO.get(v.showNo)?.date ?? "";
  return [date, v.startLabel].filter(Boolean).join(" ") || "公式映像";
}

export default function CompareView({ versions }: { versions: VideoLink[] }) {
  const slot0 = useRef<HTMLDivElement>(null);
  const slot1 = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const players = useRef<any[]>([null, null]);
  const [active, setActive] = useState(0); // 表示・再生中のスロット
  const [idx, setIdx] = useState(0); // 表示中の版
  const [ready, setReady] = useState(false);
  const [armedIdx, setArmedIdx] = useState<number | null>(null); // 先読み中/済みの版
  const [armedReady, setArmedReady] = useState(false);

  const anchorOf = (v: VideoLink) => COMPARE_ANCHOR[v.videoId] ?? v.startSec;
  const elapsedNow = () => {
    const p = players.current[active];
    const t = p?.getCurrentTime?.() ?? anchorOf(versions[idx]);
    return Math.max(0, t - anchorOf(versions[idx]));
  };

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !slot0.current || !slot1.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      players.current[0] = new w.YT.Player(slot0.current, {
        videoId: versions[0].videoId,
        playerVars: { start: Math.floor(anchorOf(versions[0])), rel: 0, playsinline: 1 },
        events: { onReady: () => !cancelled && setReady(true) },
      });
      players.current[1] = new w.YT.Player(slot1.current, {
        videoId: versions[0].videoId,
        playerVars: { rel: 0, playsinline: 1 },
      });
    });
    return () => {
      cancelled = true;
      players.current.forEach((p) => p?.destroy?.());
      players.current = [null, null];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 版タップ：準備OKの版なら切替、それ以外はその1本だけ先読み(arm)。
  const onPick = (i: number) => {
    if (!ready || i === idx) return;
    const inactive = active === 0 ? 1 : 0;

    if (armedIdx === i && armedReady) {
      // 切替：先読み済みスロットを現在の楽曲位置にseekして再生、表示を入れ替え。
      const np = players.current[inactive];
      np?.seekTo?.(anchorOf(versions[i]) + elapsedNow(), true);
      np?.playVideo?.();
      players.current[active]?.pauseVideo?.();
      setActive(inactive);
      setIdx(i);
      setArmedIdx(null);
      setArmedReady(false);
      return;
    }

    // arm：非表示スロットに cue（先読み）。先読み中に曲が進むぶんを少し見込んだ位置に。
    const np = players.current[inactive];
    setArmedIdx(i);
    setArmedReady(false);
    np?.cueVideoById?.({ videoId: versions[i].videoId, startSeconds: anchorOf(versions[i]) + elapsedNow() + 1.2 });
    const started = Date.now();
    const timer = setInterval(() => {
      const frac = np?.getVideoLoadedFraction?.() ?? 0;
      if (frac > 0.08 || Date.now() - started > 5000) {
        setArmedReady(true);
        clearInterval(timer);
      }
    }, 200);
  };

  return (
    <div>
      <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", background: "#000" }}>
        <div ref={slot0} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", visibility: active === 0 ? "visible" : "hidden" }} />
        <div ref={slot1} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", visibility: active === 1 ? "visible" : "hidden" }} />
      </div>

      <p style={{ fontSize: "0.625rem", color: C.faint, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0.8rem 0 0.4rem" }}>
        歌い比べ（タップで先読み → もう一度で切替）
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {versions.map((v, i) => {
          const isActive = i === idx;
          const isArming = armedIdx === i;
          const state = isActive ? "▶ 再生中" : isArming ? (armedReady ? "もう一度で切替" : "準備中…") : "";
          return (
            <button
              key={v.videoId}
              onClick={() => onPick(i)}
              disabled={!ready}
              aria-pressed={isActive}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                width: "100%",
                padding: "0.6rem 0.9rem",
                background: isActive ? C.ink : isArming ? "#3a3a3a" : C.card,
                color: isActive || isArming ? "#fff" : C.ink,
                border: "none",
                cursor: ready ? "pointer" : "default",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>{v.member}</span>
              <span style={{ flex: 1 }} />
              {state && <span style={{ fontSize: "0.6rem", color: isActive ? "rgba(255,255,255,0.7)" : "#fff" }}>{state}</span>}
              <span style={{ fontSize: "0.625rem", color: isActive || isArming ? "rgba(255,255,255,0.6)" : C.meta }}>
                {versionLabel(v)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
