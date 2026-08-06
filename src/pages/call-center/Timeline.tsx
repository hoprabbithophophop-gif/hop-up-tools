import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Skeleton } from "./skeleton";

/**
 * 横に流れるコールの帯。ありがとビートのコール練習クイズと同じ作り。
 *
 * 中央の線は動かない。動くのは背景の方で、いまの位置がいつも中央に来るように
 * 帯全体を横へずらす。コールは「拍の長さぶんの幅を持つ箱」として右から流れてくる。
 *
 * ありがとビートとの違いは、拍の線の引き方。あちらは曲の速さが一定なので
 * 等間隔の模様で敷けるが、こちらは曲ごとに速さが変わる（途中で速くなる曲もある）ため、
 * 解析で実際に取れた拍の秒数を1本ずつ置いている。
 */

export type TimelineCall = {
  /** 曲の頭から何秒目か */
  t: number;
  /** 長さ（秒）。拍ではなく秒で持つ＝骨組みが無い曲でもそのまま描ける */
  lenSec: number;
  note: string;
};

type Props = {
  sk: Skeleton;
  calls: TimelineCall[];
  /** いまの再生位置（曲の中での秒数）を返す。毎コマ呼ばれる */
  getNow: () => number;
  /** 画面に映す秒数。狭いほど拡大される */
  spanSec?: number;
};

const LANE_PITCH = 44;
const SECTION_H = 24;

export default memo(function Timeline({ sk, calls, getNow, spanSec = 6 }: Props) {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [vw, setVw] = useState(0);
  const getNowRef = useRef(getNow);
  getNowRef.current = getNow;

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const set = () => setVw(el.clientWidth);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pxPerSec = vw > 0 ? vw / spanSec : 60;
  const lastSec = sk.beats[sk.beats.length - 1] ?? 0;

  // 重なるコールは下の段へ送る（早い者順に空いている段を探す）
  const { laneOf, laneCount } = useMemo(() => {
    const order = calls.map((c, i) => ({ c, i })).sort((a, b) => a.c.t - b.c.t);
    const laneEnds: number[] = [];
    const map = new Map<number, number>();
    for (const { c, i } of order) {
      const end = c.t + Math.max(c.lenSec, 0.18);
      let lane = laneEnds.findIndex((e) => e <= c.t + 0.001);
      if (lane < 0) {
        laneEnds.push(end);
        lane = laneEnds.length - 1;
      } else {
        laneEnds[lane] = end;
      }
      map.set(i, lane);
    }
    return { laneOf: map, laneCount: Math.max(1, laneEnds.length) };
  }, [calls]);

  // 毎コマ、いまの位置が中央に来るように帯をずらす。
  // 再生位置は約0.1秒刻みでしか動かないので、そのまま使うとカクつく。
  // 値が飛んだときだけ合わせ直し、間は時計で進めて滑らかにする。
  useEffect(() => {
    let raf = 0;
    let smooth = -1;
    let lastPerf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const track = trackRef.current;
      if (!track || vw === 0) return;
      const raw = getNowRef.current();
      const perf = performance.now();
      if (smooth < 0 || raw < smooth - 0.15 || raw > smooth + 0.5) {
        smooth = raw; // 最初・巻き戻し・大きく飛んだときは即合わせる
      } else {
        smooth += (perf - lastPerf) / 1000; // 実際に経った時間ぶん進める
        smooth += (raw - smooth) * 0.1; // 本当の値へゆるく寄せる（ずれ続けないように）
      }
      lastPerf = perf;
      track.style.transform = `translateX(${(vw / 2 - smooth * pxPerSec).toFixed(1)}px)`;
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [vw, pxPerSec]);

  const measured = sk.beatsMeasured ?? sk.beats.length;
  const downbeats = useMemo(() => new Set(sk.downbeats.map((d) => d.toFixed(3))), [sk.downbeats]);
  const laneAreaH = Math.max(LANE_PITCH, laneCount * LANE_PITCH);
  const bandH = SECTION_H + laneAreaH;
  const pad = vw; // 曲の頭でも左半分が空にならないよう、左へ伸ばす

  return (
    <div ref={viewRef} style={{ ...S.view, height: bandH }}>
      {/* 中央のプレイヘッド。これは動かない */}
      <div style={S.playhead} />

      <div
        ref={trackRef}
        style={{
          ...S.track,
          left: -pad,
          width: Math.max(1, lastSec * pxPerSec + pad * 2),
          height: bandH,
        }}
      >
        {/* 拍の線。小節の頭は濃く、継ぎ足した推定のぶんは薄く */}
        {sk.beats.map((t, i) => {
          const bar = downbeats.has(t.toFixed(3));
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: t * pxPerSec + pad,
                top: SECTION_H,
                bottom: 0,
                width: bar ? 1.5 : 1,
                background: bar ? "#b1b8c0" : "#dfe2e6",
                opacity: i >= measured ? 0.4 : 1,
              }}
            />
          );
        })}

        {/* 区間の帯 */}
        {sk.sections.map((s) => (
          <div
            key={s.order}
            style={{
              ...S.section,
              left: s.startSec * pxPerSec + pad,
              width: Math.max(2, (s.endSec - s.startSec) * pxPerSec),
              background: SECTION_TONE[s.group % SECTION_TONE.length],
            }}
          >
            <span style={S.sectionLabel}>{s.name ?? s.labelAuto}</span>
          </div>
        ))}

        {/* コール */}
        {calls.map((c, i) => (
          <div
            key={i}
            style={{
              ...S.call,
              left: c.t * pxPerSec + pad,
              width: Math.max(22, c.lenSec * pxPerSec),
              top: SECTION_H + (laneOf.get(i) ?? 0) * LANE_PITCH + 4,
              height: LANE_PITCH - 8,
            }}
          >
            {c.note}
          </div>
        ))}
      </div>

      {calls.length === 0 && (
        <div style={S.empty}>まだこの曲のコールは1件も登録されていません</div>
      )}
    </div>
  );
});

/** 区間の色分けはグレーの濃淡だけ（線を引かず面の段差で示す） */
const SECTION_TONE = ["#e9ebed", "#dfe2e6", "#d3d7dc", "#c8cdd3", "#bcc2c9", "#b1b8c0", "#a6aeb7"];

const S: Record<string, React.CSSProperties> = {
  view: {
    position: "relative",
    overflow: "hidden",
    background: "#fff",
    userSelect: "none",
    WebkitUserSelect: "none",
  },
  playhead: {
    position: "absolute",
    left: "50%",
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    background: "#000",
    zIndex: 3,
    pointerEvents: "none",
  },
  track: { position: "absolute", top: 0, willChange: "transform", zIndex: 1 },
  section: {
    position: "absolute",
    top: 0,
    height: SECTION_H,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 800,
    color: "#33383f",
    whiteSpace: "nowrap",
    padding: "0 6px",
  },
  call: {
    position: "absolute",
    background: "#000",
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    lineHeight: 1.15,
    padding: "2px 4px",
    overflow: "hidden",
    wordBreak: "break-all",
    zIndex: 2,
  },
  empty: {
    position: "absolute",
    left: 0,
    right: 0,
    top: SECTION_H,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12.5,
    color: "#9aa1aa",
    pointerEvents: "none",
    zIndex: 2,
  },
};
