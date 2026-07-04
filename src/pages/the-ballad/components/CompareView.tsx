import { useEffect, useRef, useState, type RefObject } from "react";
import type { VideoLink } from "@/data/the-ballad";
import { SHOW_BY_NO, compareAnchor, compareEnd } from "@/data/the-ballad";
import { tbLog } from "@/utils/debugLog";
import { C } from "../ui";
import type { YouTubePlayerApi } from "./YouTubePlayer";

// 同じ曲の複数バージョンを、外部の1枚プレイヤー(playerRef)を loadVideo で切替して聴き比べる。
// プレイヤー本体は CompareModal/SongView 側が常時 ready で保持し、初回再生は聴き比べボタンの
// タップハンドラ内で loadVideo される(iOS対策)。CompareView は版リストとループ制御のみ担当。

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

export default function CompareView({
  versions,
  playerRef,
  visible,
}: {
  versions: VideoLink[];
  playerRef: RefObject<YouTubePlayerApi | null>;
  visible: boolean;
}) {
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0);
  const [elapsed, setElapsed] = useState(0); // 現在版の曲頭からの経過秒(Cメロ等で短い版を選択不可にする判定用)

  const anchorOf = (v: VideoLink) => compareAnchor(v.videoId, v.startSec);
  // YouTube iframe の seek→再生ラグで頭出しが僅かに遅れるため、seek/load位置を少し手前に置いて補償
  const SEEK_LEAD = 0.05;

  const elapsedNow = () => {
    const t = playerRef.current?.getCurrentTime() ?? 0;
    return Math.max(0, t - anchorOf(versions[idxRef.current]));
  };
  const syncPos = (to: VideoLink) => {
    const head = anchorOf(to);
    let t = head + elapsedNow();
    const end = compareEnd(to.videoId, to.startSec);
    if (isFinite(end) && t >= end - 0.5) t = head;
    return Math.max(head, t);
  };

  // 別の曲の聴き比べに切り替わったら idx をリセット(SongView が versions[0] をロード済み)
  useEffect(() => {
    setIdx(0);
    idxRef.current = 0;
  }, [versions]);

  // 区間ループ: 曲区間の終わりで曲頭へ戻す(次の人に進まない)。開いている間だけ poll。
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      const v = versions[idxRef.current];
      if (!p || !v) return;
      const t = p.getCurrentTime();
      setElapsed(Math.max(0, t - anchorOf(v)));
      const seg = compareEnd(v.videoId, v.startSec);
      const end = isFinite(seg) ? seg : (p.getDuration() || 0);
      if (end > 0 && t >= end - 0.9) {
        tbLog("loop", { t: Math.round(t * 10) / 10, anchor: anchorOf(v), end, idx: idxRef.current });
        p.seekTo(Math.max(0, anchorOf(v) - SEEK_LEAD));
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, versions]);

  // 版タップ: ジェスチャ内で unMute して音を出す。別の版なら loadVideo で切替(cover付き)。
  const onPick = (i: number) => {
    const p = playerRef.current;
    p?.unMute();
    if (i === idxRef.current) return;
    const to = versions[i];
    const pos = Math.max(0, syncPos(to) - SEEK_LEAD);
    tbLog("switch", { from: idxRef.current, to: i });
    p?.loadVideo(to.videoId, { startSeconds: pos, cover: true });
    idxRef.current = i;
    setIdx(i);
  };

  const current = versions[idx];
  if (!current) return null;

  return (
    <>
      {/* 選択中の版タイトル */}
      <div style={{ flexShrink: 0, padding: "0.7rem 0 0.5rem" }}>
        <p style={dimLabel}>再生中</p>
        <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "#fff", margin: "0.15rem 0 0" }}>
          {current.member}
          <span style={{ fontSize: "0.65rem", fontWeight: 400, color: "rgba(255,255,255,0.55)", marginLeft: "0.5rem" }}>
            {versionLabel(current)}
          </span>
        </p>
      </div>

      {/* 版リスト(タップで再生/切替) */}
      <p style={{ ...dimLabel, flexShrink: 0, marginBottom: "0.4rem" }}>タップで再生 / 切り替え</p>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {versions.map((v, i) => {
          const isCurrent = i === idx;
          const endI = compareEnd(v.videoId, v.startSec);
          // この版に現在の経過位置に対応する区間が無い(Cメロ等で短縮された版・同じ音源のノーカット短縮)＝選択不可
          const noRegion = !isCurrent && isFinite(endI) && anchorOf(v) + elapsed >= endI - 0.5;
          return (
            <button
              key={v.videoId}
              onClick={() => onPick(i)}
              disabled={noRegion}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                width: "100%",
                padding: "0.6rem 0.9rem",
                background: isCurrent ? "#262626" : noRegion ? "#141414" : C.card,
                color: isCurrent ? "#fff" : noRegion ? "#555" : C.ink,
                border: "none",
                cursor: noRegion ? "default" : "pointer",
                textAlign: "left",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>{v.member}</span>
              <span style={{ flex: 1 }} />
              {isCurrent && <span style={{ fontSize: "0.6rem", color: "#fff" }}>再生中</span>}
              <span style={{ fontSize: "0.625rem", color: isCurrent ? "rgba(255,255,255,0.6)" : noRegion ? "#3a3a3a" : C.meta }}>{versionLabel(v)}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
