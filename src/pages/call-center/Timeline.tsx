import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { createPlayheadClock } from "@/lib/playheadClock";
import { toBubbles } from "./callBubbles";
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
  /**
   * 曲の骨組み。無い曲では null を渡す。
   * その場合は拍の線も区間の帯も出さず、コールだけが流れる帯になる。
   * コールの位置は秒で持っているので、骨組みが無くても正しく流れる。
   */
  sk: Skeleton | null;
  calls: TimelineCall[];
  /** いまの再生位置（曲の中での秒数）を返す。毎コマ呼ばれる */
  getNow: () => number;
  /** 1拍の長さ（秒）。分かっていれば、長いコールを半拍ずつに割って並べる */
  beatSec?: number;
  /** 帯の全長（秒）。骨組みが無いときの目安に使う */
  totalSec?: number;
  /**
   * 画面に映す秒数。狭いほど拡大される。
   * 8分ごとに粒が並ぶ曲では、狭くしないと丸が重なって段が分かれる
   * （BPM149なら8分＝0.2秒。375px幅で3秒なら1粒25px）。
   */
  spanSec?: number;
};

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

export default memo(function Timeline({ sk, calls, getNow, beatSec, totalSec, spanSec = 3 }: Props) {
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
  // 帯の全長。骨組みがあれば最後の拍まで、無ければ動画の長さか最後のコールまで。
  const lastSec = sk
    ? (sk.beats[sk.beats.length - 1] ?? 0)
    : Math.max(totalSec ?? 0, ...calls.map((c) => c.t + c.lenSec), 10);

  // 長いコールは声に出す単位へ割って、粒として並べる
  const bubbles = useMemo(() => toBubbles(calls, beatSec), [calls, beatSec]);

  // 重なる吹き出しは下の段へ送る（早い者順に空いている段を探す）
  const { laneOf, laneCount } = useMemo(() => {
    const laneEnds: number[] = [];
    const map = new Map<number, number>();
    bubbles.forEach((b, i) => {
      const end = b.t + (bubbleW(b.text) + 3) / pxPerSec;
      let lane = laneEnds.findIndex((e) => e <= b.t + 0.001);
      if (lane < 0) {
        laneEnds.push(end);
        lane = laneEnds.length - 1;
      } else {
        laneEnds[lane] = end;
      }
      map.set(i, lane);
    });
    return { laneOf: map, laneCount: Math.max(1, laneEnds.length) };
  }, [bubbles, pxPerSec]);

  // 毎コマ、いまの位置が中央に来るように帯をずらす。
  // 再生位置は階段状にしか動かないので、なめらかで後戻りしない時計を通す。
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

  const measured = sk ? (sk.beatsMeasured ?? sk.beats.length) : 0;
  const downbeats = useMemo(
    () => new Set((sk?.downbeats ?? []).map((d) => d.toFixed(3))),
    [sk],
  );
  const laneAreaH = Math.max(LANE_PITCH, laneCount * LANE_PITCH);
  // 骨組みが無い曲には区間の帯そのものが無いので、その高さぶんを詰める
  const sectionH = sk ? SECTION_H : 0;
  const bandH = sectionH + laneAreaH;
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
        {/* 拍の線。小節の頭は濃く、継ぎ足した推定のぶんは薄く。骨組みが無い曲では引かない */}
        {(sk?.beats ?? []).map((t, i) => {
          const bar = downbeats.has(t.toFixed(3));
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: t * pxPerSec + pad,
                top: sectionH,
                bottom: 0,
                width: bar ? 1.5 : 1,
                background: bar ? "#b1b8c0" : "#dfe2e6",
                opacity: i >= measured ? 0.4 : 1,
              }}
            />
          );
        })}

        {/* 区間の帯 */}
        {(sk?.sections ?? []).map((s) => (
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

        {/* コール。上から刺さった針の先が「ここで声を出す」瞬間を指す。 */}
        {bubbles.map((b, i) => {
          const x = b.t * pxPerSec + pad;
          const needleTop = sectionH + (laneOf.get(i) ?? 0) * LANE_PITCH;
          const w = bubbleW(b.text);
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
                {b.text}
              </div>
            </Fragment>
          );
        })}
      </div>

      {calls.length === 0 && (
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
