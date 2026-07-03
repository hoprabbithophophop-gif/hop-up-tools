import { useEffect, useRef, useState } from "react";
import type { VideoLink } from "@/data/the-ballad";
import { SHOW_BY_NO, compareAnchor, compareEnd } from "@/data/the-ballad";
import { tbLog, reportIncidentThrottled } from "@/utils/debugLog";
import { C } from "../ui";

// 同じ曲の複数バージョン（歌唱者／公演）を切り替えて聴き比べる。
// 表示: 再生中の動画 / 選択中の動画タイトル / 変更する動画タイトルリスト（リストだけスクロール）。
// M3: 校正アンカーで曲頭からの経過秒を保った位置合わせ切替。
// M2: 2枚プレイヤーで選んだ1本だけ裏で先読み(arm)→もう一度タップで即切替。

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

const dimLabel: React.CSSProperties = {
  fontSize: "0.625rem",
  color: "rgba(255,255,255,0.5)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  margin: 0,
};

export default function CompareView({ versions }: { versions: VideoLink[] }) {
  const slot0 = useRef<HTMLDivElement>(null);
  const slot1 = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const players = useRef<any[]>([null, null]);
  const armTimer = useRef<number | null>(null);
  const clearArmTimer = () => {
    if (armTimer.current != null) {
      clearInterval(armTimer.current);
      armTimer.current = null;
    }
  };
  const [active, setActive] = useState(0);
  const [idx, setIdx] = useState(0);
  const [ready, setReady] = useState(false);
  const [armedIdx, setArmedIdx] = useState<number | null>(null);
  const [armedReady, setArmedReady] = useState(false);

  const anchorOf = (v: VideoLink) => compareAnchor(v.videoId, v.startSec);
  const elapsedNow = () => {
    const p = players.current[active];
    const t = p?.getCurrentTime?.() ?? anchorOf(versions[idx]);
    return Math.max(0, t - anchorOf(versions[idx]));
  };
  // 位置合わせ先の秒。ダイジェストの曲区間を越える場合は曲頭に戻す（次の人に着地しない）。
  const syncPos = (to: VideoLink) => {
    const head = anchorOf(to);
    let t = head + elapsedNow();
    const end = compareEnd(to.videoId, to.startSec);
    if (isFinite(end) && t >= end - 0.5) t = head;
    return Math.max(head, t);
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
        events: {
          onReady: () => !cancelled && setReady(true),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onStateChange: (e: any) => tbLog("state", { pl: 0, s: e?.data, muted: players.current[0]?.isMuted?.() }),
        },
      });
      players.current[1] = new w.YT.Player(slot1.current, {
        videoId: versions[0].videoId,
        playerVars: { rel: 0, playsinline: 1 },
        events: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onStateChange: (e: any) => tbLog("state", { pl: 1, s: e?.data, muted: players.current[1]?.isMuted?.() }),
        },
      });
    });
    return () => {
      cancelled = true;
      clearArmTimer();
      players.current.forEach((p) => p?.destroy?.());
      players.current = [null, null];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // モーダルを開いている間、再生中の曲区間をループ（ダイジェストで次の人に進まないように）。
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const v = versions[idx];
      const p = players.current[active];
      if (!p?.getCurrentTime) return;
      // 2枚プレイヤーの競合等で再生中プレイヤーが勝手にミュートされることがあるため即戻す
      if (p.isMuted?.()) {
        tbLog("automute", { active, idx, s: p.getPlayerState?.() });
        reportIncidentThrottled("automute", { active, idx, videoId: versions[idx]?.videoId, s: p.getPlayerState?.() });
        p.unMute?.();
      }
      const t = p.getCurrentTime();
      const seg = compareEnd(v.videoId, v.startSec);
      const end = isFinite(seg) ? seg : (p.getDuration?.() || 0);
      // YouTube iframe の seekTo は 0.5〜1s 遅延し、その間 end を越えて次曲へ食い込む。
      // 谷底 end からその遅延分だけ手前で seek を開始する（0.2 では吸収しきれず食い込んだ）。
      if (end > 0 && t >= end - 0.9) p.seekTo?.(anchorOf(v), true);
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, active, ready]);

  // iOSのバックグラウンド化/オーディオ中断が起きたか記録（?debug=1 のときだけ）
  useEffect(() => {
    const onVis = () => tbLog("visibility", { hidden: document.hidden });
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const onPick = (i: number) => {
    if (!ready || i === idx) return;
    const inactive = active === 0 ? 1 : 0;

    if (armedIdx === i && armedReady) {
      clearArmTimer();
      tbLog("switch", { from: idx, to: i });
      const np = players.current[inactive];
      np?.unMute?.();
      np?.seekTo?.(syncPos(versions[i]), true);
      np?.playVideo?.();
      players.current[active]?.pauseVideo?.();
      setActive(inactive);
      setIdx(i);
      setArmedIdx(null);
      setArmedReady(false);
      return;
    }

    // 別の版を arm し直す前に、走っているタイマーを必ず止める（表示状態の残留・二重起動を防ぐ）
    clearArmTimer();
    const np = players.current[inactive];
    tbLog("arm", { to: i });
    setArmedIdx(i);
    setArmedReady(false);
    np?.cueVideoById?.({ videoId: versions[i].videoId, startSeconds: syncPos(versions[i]) });
    const started = Date.now();
    armTimer.current = window.setInterval(() => {
      const frac = np?.getVideoLoadedFraction?.() ?? 0;
      if (frac > 0.08 || Date.now() - started > 5000) {
        setArmedReady(true);
        clearArmTimer();
      }
    }, 200);
  };

  const current = versions[idx];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      {/* 再生中の動画（YT がラッパー内の div を iframe に置換。visibility はラッパー側に付ける） */}
      <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", background: "#000", flexShrink: 0 }}>
        <div style={{ position: "absolute", inset: 0, visibility: active === 0 ? "visible" : "hidden" }}>
          <div ref={slot0} style={{ width: "100%", height: "100%" }} />
        </div>
        <div style={{ position: "absolute", inset: 0, visibility: active === 1 ? "visible" : "hidden" }}>
          <div ref={slot1} style={{ width: "100%", height: "100%" }} />
        </div>
      </div>

      {/* 選択中の動画タイトル */}
      <div style={{ flexShrink: 0, padding: "0.7rem 0 0.5rem" }}>
        <p style={dimLabel}>再生中</p>
        <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "#fff", margin: "0.15rem 0 0" }}>
          {current.member}
          <span style={{ fontSize: "0.65rem", fontWeight: 400, color: "rgba(255,255,255,0.55)", marginLeft: "0.5rem" }}>
            {versionLabel(current)}
          </span>
        </p>
      </div>

      {/* 変更する動画タイトルリスト（ここだけスクロール） */}
      <p style={{ ...dimLabel, flexShrink: 0, marginBottom: "0.4rem" }}>切り替える（タップで先読み → もう一度で切替）</p>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {versions.map((v, i) => {
          const isCurrent = i === idx;
          const isArming = armedIdx === i;
          const state = isCurrent ? "再生中" : isArming ? (armedReady ? "もう一度で切替" : "準備中…") : "";
          return (
            <button
              key={v.videoId}
              onClick={() => onPick(i)}
              disabled={!ready || isCurrent}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                width: "100%",
                padding: "0.6rem 0.9rem",
                background: isCurrent ? "#262626" : isArming ? "#3a3a3a" : C.card,
                color: isCurrent || isArming ? "#fff" : C.ink,
                border: "none",
                cursor: isCurrent ? "default" : ready ? "pointer" : "default",
                textAlign: "left",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>{v.member}</span>
              <span style={{ flex: 1 }} />
              {state && <span style={{ fontSize: "0.6rem", color: "#fff" }}>{state}</span>}
              <span style={{ fontSize: "0.625rem", color: isCurrent || isArming ? "rgba(255,255,255,0.6)" : C.meta }}>{versionLabel(v)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
