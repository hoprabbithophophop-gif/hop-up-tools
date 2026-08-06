import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { createPlayheadClock } from "@/lib/playheadClock";
import type { CallUnit, GridLine } from "./callBubbles";

/**
 * 横に流れるコールの帯。
 *
 * 中央の線は動かない。動くのは背景の方で、いまの位置がいつも中央に来るように
 * 帯全体を横へずらす。コールは上から針が刺さった丸い吹き出しとして流れてくる。
 *
 * 針の先は必ず目盛りの上に立つ。ここが外れると「拍に乗っている」ことが
 * 見る人に伝わらず、ただ文字が流れているだけになる。
 */

/** 区間の帯の高さ */
const SECTION_H = 24;
/** 吹き出し（丸）の高さ */
const BUBBLE_H = 26;
/** 針の高さ。この先が「声を出す瞬間」を指す */
const NEEDLE_H = 15;
/** 針の根元の太さ */
const NEEDLE_W = 8;
const LANE_PITCH = NEEDLE_H + BUBBLE_H + 5;

/** 吹き出しの幅。1文字なら丸、長ければ横に伸びた楕円になる */
const bubbleW = (s: string) => Math.max(BUBBLE_H, [...s].length * 11 + 14);

type Props = {
  /** 区間の帯に出すもの。骨組みが無い曲では空 */
  sections?: { order: number; startSec: number; endSec: number; label: string; group: number }[];
  /** 8分ごとの目盛り */
  grid: GridLine[];
  /** 画面に出す粒 */
  units: CallUnit[];
  /** いまの再生位置（曲の中での秒数）を返す。毎コマ呼ばれる */
  getNow: () => number;
  /** 帯の全長（秒） */
  totalSec: number;
  /** 画面に映す秒数。狭いほど拡大される */
  spanSec?: number;
};

export default memo(function Timeline({
  sections = [],
  grid,
  units,
  getNow,
  totalSec,
  spanSec = 3,
}: Props) {
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
  const lastSec = Math.max(totalSec, units.length ? units[units.length - 1].t + 2 : 0, 10);

  // 重なる吹き出しは下の段へ送る（早い者順に空いている段を探す）
  const { laneOf, laneCount } = useMemo(() => {
    const laneEnds: number[] = [];
    const map = new Map<number, number>();
    units.forEach((u, i) => {
      const end = u.t + (bubbleW(u.text) + 3) / pxPerSec;
      let lane = laneEnds.findIndex((e) => e <= u.t + 0.001);
      if (lane < 0) {
        laneEnds.push(end);
        lane = laneEnds.length - 1;
      } else {
        laneEnds[lane] = end;
      }
      map.set(i, lane);
    });
    return { laneOf: map, laneCount: Math.max(1, laneEnds.length) };
  }, [units, pxPerSec]);

  // 毎コマ、いまの位置が中央に来るように帯をずらす。
  useEffect(() => {
    let raf = 0;
    const clock = createPlayheadClock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const track = trackRef.current;
      if (!track || vw === 0) return;
      const t = clock(getNowRef.current(), performance.now());
      track.style.transform = `translateX(${(vw / 2 - t * pxPerSec).toFixed(1)}px)`;
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [vw, pxPerSec]);

  const sectionH = sections.length > 0 ? SECTION_H : 0;
  const bandH = sectionH + Math.max(LANE_PITCH, laneCount * LANE_PITCH) + 4;
  const pad = vw; // 曲の頭でも左半分が空にならないよう、左へ伸ばす

  return (
    <div ref={viewRef} style={{ ...S.view, height: bandH }}>
      {/* 中央のプレイヘッド。これは動かない */}
      <div style={S.playhead} />

      <div
        ref={trackRef}
        style={{ ...S.track, left: -pad, width: Math.max(1, lastSec * pxPerSec + pad * 2), height: bandH }}
      >
        {/* 目盛り。小節の頭が一番濃く、拍がその次、裏拍は薄い */}
        {grid.map((g, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: g.t * pxPerSec + pad,
              top: sectionH,
              bottom: 0,
              width: g.bar ? 1.5 : 1,
              background: g.bar ? "#9aa1aa" : g.beat ? "#c8cdd3" : "#e9ebed",
            }}
          />
        ))}

        {/* 区間の帯 */}
        {sections.map((s) => (
          <div
            key={s.order}
            style={{
              ...S.section,
              left: s.startSec * pxPerSec + pad,
              width: Math.max(2, (s.endSec - s.startSec) * pxPerSec),
              background: SECTION_TONE[s.group % SECTION_TONE.length],
            }}
          >
            <span style={S.sectionLabel}>{s.label}</span>
          </div>
        ))}

        {/* コール。針の先が目盛りの上に立ち、そこが「声を出す瞬間」 */}
        {units.map((u, i) => {
          const x = u.t * pxPerSec + pad;
          const needleTop = sectionH + (laneOf.get(i) ?? 0) * LANE_PITCH;
          const w = bubbleW(u.text);
          return (
            <Fragment key={i}>
              <div style={{ ...S.needle, left: x - NEEDLE_W / 2, top: needleTop }} />
              <div
                style={{
                  ...S.call,
                  left: x - w / 2,
                  width: w,
                  top: needleTop + NEEDLE_H,
                  height: BUBBLE_H,
                }}
              >
                {u.text}
              </div>
            </Fragment>
          );
        })}
      </div>

      {units.length === 0 && (
        <div style={{ ...S.empty, top: sectionH }}>まだこの曲のコールは1件も登録されていません</div>
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
    zIndex: 5,
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

  /** 上から刺さる針。先端が「声を出す瞬間」を指す */
  needle: {
    position: "absolute",
    width: 0,
    height: 0,
    borderLeft: `${NEEDLE_W / 2}px solid transparent`,
    borderRight: `${NEEDLE_W / 2}px solid transparent`,
    borderBottom: `${NEEDLE_H}px solid #000`,
    zIndex: 3,
  },

  // 丸い吹き出し。針の真下に中心が来る。
  // 塗りつぶすと粒が並んだとき黒い塊になって読めないので、白抜きに輪郭。
  call: {
    position: "absolute",
    background: "#fff",
    color: "#000",
    border: "1.5px solid #000",
    boxSizing: "border-box",
    fontSize: 12.5,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    lineHeight: 1,
    borderRadius: "50%",
    whiteSpace: "nowrap",
    zIndex: 4,
  },

  empty: {
    position: "absolute",
    left: 0,
    right: 0,
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
