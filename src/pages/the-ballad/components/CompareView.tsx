import { useEffect, useRef, useState } from "react";
import type { VideoLink } from "@/data/the-ballad";
import { SHOW_BY_NO, compareAnchor, compareEnd } from "@/data/the-ballad";
import { tbLog } from "@/utils/debugLog";
import { C } from "../ui";
import YouTubePlayer, { type YouTubePlayerApi } from "./YouTubePlayer";

// 同じ曲の複数バージョン(歌唱者/公演)を1枚プレイヤーで loadVideo 切替して聴き比べる(hi-tension方式)。
// iOS対策の要: 再生開始・版切替はユーザーのタップハンドラ内で同期的に loadVideo/unMute を呼ぶ。
// 位置合わせ: 校正アンカーで曲頭からの経過秒を保って切替。区間ループで次の人に進まない。

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
  const playerRef = useRef<YouTubePlayerApi>(null);
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0);

  const anchorOf = (v: VideoLink) => compareAnchor(v.videoId, v.startSec);
  // YouTube iframe の seek→再生ラグで頭出しが僅かに遅れるため、seek/load位置を少し手前に置いて補償
  const SEEK_LEAD = 0.05;

  const elapsedNow = () => {
    const t = playerRef.current?.getCurrentTime() ?? 0;
    return Math.max(0, t - anchorOf(versions[idxRef.current]));
  };
  // 位置合わせ先の秒。ダイジェストの曲区間を越える場合は曲頭に戻す(次の人に着地しない)。
  const syncPos = (to: VideoLink) => {
    const head = anchorOf(to);
    let t = head + elapsedNow();
    const end = compareEnd(to.videoId, to.startSec);
    if (isFinite(end) && t >= end - 0.5) t = head;
    return Math.max(head, t);
  };

  // 初回: マウント(聴き比べボタンで開いた)直後に versions[0] を音ありロード。
  // ready前なら YouTubePlayer 内の wantLoad で onReady 時に実行される。
  useEffect(() => {
    const p = playerRef.current;
    p?.unMute();
    p?.loadVideo(versions[0].videoId, { startSeconds: anchorOf(versions[0]) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 版切替: タップハンドラ内で同期的に loadVideo(cover付き)。iOSでも通る。
  const onPick = (i: number) => {
    if (i === idxRef.current) return;
    const to = versions[i];
    const pos = Math.max(0, syncPos(to) - SEEK_LEAD);
    tbLog("switch", { from: idxRef.current, to: i });
    const p = playerRef.current;
    p?.unMute();
    p?.loadVideo(to.videoId, { startSeconds: pos, cover: true });
    idxRef.current = i;
    setIdx(i);
  };

  // 区間ループ: 曲区間の終わりで曲頭へ戻す(ダイジェストで次の人に進まないように)。
  const onTimeUpdate = (t: number) => {
    const v = versions[idxRef.current];
    const seg = compareEnd(v.videoId, v.startSec);
    const p = playerRef.current;
    const end = isFinite(seg) ? seg : (p?.getDuration() ?? 0);
    if (end > 0 && t >= end - 0.9) p?.seekTo(Math.max(0, anchorOf(v) - SEEK_LEAD));
  };

  const current = versions[idx];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      {/* 再生中の動画(1枚プレイヤーを loadVideo で切替) */}
      <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", background: "#000", flexShrink: 0 }}>
        <div style={{ position: "absolute", inset: 0 }}>
          <YouTubePlayer ref={playerRef} videoId={versions[0].videoId} onTimeUpdate={onTimeUpdate} />
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

      {/* 変更する動画タイトルリスト(タップで即切替) */}
      <p style={{ ...dimLabel, flexShrink: 0, marginBottom: "0.4rem" }}>切り替える（タップで即切替）</p>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {versions.map((v, i) => {
          const isCurrent = i === idx;
          return (
            <button
              key={v.videoId}
              onClick={() => onPick(i)}
              disabled={isCurrent}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                width: "100%",
                padding: "0.6rem 0.9rem",
                background: isCurrent ? "#262626" : C.card,
                color: isCurrent ? "#fff" : C.ink,
                border: "none",
                cursor: isCurrent ? "default" : "pointer",
                textAlign: "left",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>{v.member}</span>
              <span style={{ flex: 1 }} />
              {isCurrent && <span style={{ fontSize: "0.6rem", color: "#fff" }}>再生中</span>}
              <span style={{ fontSize: "0.625rem", color: isCurrent ? "rgba(255,255,255,0.6)" : C.meta }}>{versionLabel(v)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
