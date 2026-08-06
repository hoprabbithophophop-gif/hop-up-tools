import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { createPlayheadClock } from "@/lib/playheadClock";
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
  /** 帯の全長（秒）。骨組みが無いときの目安に使う */
  totalSec?: number;
  /** 画面に映す秒数。狭いほど拡大される */
  spanSec?: number;
};

const LANE_PITCH = 46;
const SECTION_H = 24;
/** 吹き出しを吊り下げる糸の長さ。拍の線と吹き出しをつなぐ */
const STEM_H = 14;
/** 吹き出しの高さ */
const BUBBLE_H = 30;
/** 尻尾（吹き出しの左上から上へ伸びる三角）の大きさ */
const TAIL_W = 7;
const TAIL_H = 9;

/**
 * その文字を出すのに、およそ何ピクセル要るか。
 * 吹き出しの幅そのものは中身に合わせて伸びる（文字は切れない）。
 * これは「どの段に置くか」を決めるときの見当にだけ使う。
 */
const estTextPx = (s: string) => 16 + [...s].length * 12.5;

export default memo(function Timeline({ sk, calls, getNow, totalSec, spanSec = 6 }: Props) {
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

  // 重なるコールは下の段へ送る（早い者順に空いている段を探す）
  const { laneOf, laneCount } = useMemo(() => {
    const order = calls.map((c, i) => ({ c, i })).sort((a, b) => a.c.t - b.c.t);
    const laneEnds: number[] = [];
    const map = new Map<number, number>();
    for (const { c, i } of order) {
      // 重なり判定は、見た目の幅（言う長さ／文字幅の広いほう）で行う
      const end = c.t + Math.max(c.lenSec, estTextPx(c.note) / pxPerSec, 0.18);
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
  }, [calls, pxPerSec]);

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

        {/* コール。拍の線から糸を垂らして、雫の形の吹き出しをぶら下げる。
            尖った角が「ここで声を出す」瞬間を指す。 */}
        {calls.map((c, i) => {
          const x = c.t * pxPerSec + pad;
          const top = sectionH + (laneOf.get(i) ?? 0) * LANE_PITCH + STEM_H;
          return (
            <Fragment key={i}>
              <div style={{ ...S.stem, left: x, top: sectionH, height: top - sectionH }} />
              <div style={{ ...S.tail, left: x, top: top - TAIL_H + 1 }} />
              <div
                style={{
                  ...S.call,
                  left: x,
                  // 幅は「言う長さ」ぶん取るが、文字が入らないときは中身に合わせて伸ばす
                  minWidth: c.lenSec * pxPerSec,
                  top,
                  height: BUBBLE_H,
                }}
              >
                {c.note}
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
  /** 吹き出しを吊り下げる糸 */
  stem: {
    position: "absolute",
    width: 1,
    background: "#000",
    opacity: 0.4,
    zIndex: 2,
  },

  /** 吹き出しの尻尾。糸の先から吹き出しへつながる三角 */
  tail: {
    position: "absolute",
    width: 0,
    height: 0,
    borderLeft: `${TAIL_W}px solid #000`,
    borderBottom: `${TAIL_H}px solid transparent`,
    zIndex: 4,
  },

  // ぶら下がる吹き出し。尻尾の付け根が「声を出す瞬間」を指す。
  // 文字は左端に寄せる。中央に置くと、吹き出しの長さの半分ぶん遅れて
  // 文字が中央線に届くので、拍に合わせて読む人には「ずれている」ように見える。
  call: {
    position: "absolute",
    background: "#000",
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    textAlign: "left",
    lineHeight: 1.15,
    padding: "2px 9px 2px 7px",
    borderRadius: 14,
    width: "max-content",
    whiteSpace: "nowrap",
    zIndex: 3,
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
