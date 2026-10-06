// 作る画面のプレビューの盤で、語をつまんで動かす（Hop 決定 2026-10-05・案A「つまんで動かす」）。
// 押してから 300ms【仮】長押しで語が持ち上がる。長押しの前に指が動いたら普通のスクロールに任せる。
// 持ち上がったら盤の上では touch-action: none にして、離した所に置く。置けるかどうかは呼ぶ側（engine の canMoveTo）が決める。
// 動かした語（pinned）は先頭のマスの右上に小さな黒い四角【仮】を付ける（左上は番号）。
import React, { useEffect, useRef, useState } from "react";
import type { PuzzleData, PlacedItem } from "../../../lib/crossword/types";
import { canMoveTo } from "../../../lib/crossword/engine";
import { PuzzleGridRetro } from "./PuzzleGridRetro";
import { C } from "../style";

// 持ち上げた語の影の濃さ。置ける所では今の濃さ、置けない所の上にいる間は薄くする（2026-10-06 任天堂シミュで決定）
const GHOST_OPACITY = 0.6;
const GHOST_OPACITY_BLOCKED = 0.2; // 【仮】

const CELL = 48; // PuzzleGridRetro の 1 マス
export const LONG_PRESS_MS = 300; // 【仮】
const MOVE_SLOP_PX = 8; // 長押しの前にこれ以上動いたらスクロールとみなす
// 盤の周りの余白（マス数）【仮】。枠の外へも動かせる（Hop 決定 2026-10-05）ので、持ち上げている間は薄いグレーの面で見せる。
// 置き場の大きさがずれないよう、余白の場所はいつも取っておく（呼ぶ側の FitGrid も盤の幅＋2・高さ＋2 で渡す）
export const MOVE_MARGIN = 1;
const M = MOVE_MARGIN * CELL;

interface Props {
  data: PuzzleData;
  enabled: boolean;
  /** 語を (startX, startY) に置く。置けたら true。置けなければ false で、語は元に戻る */
  onDrop: (uuid: string, startX: number, startY: number) => boolean;
}

interface Press {
  pointerId: number;
  x: number;
  y: number;
  item: PlacedItem;
  timer: number;
}

interface Drag {
  pointerId: number;
  item: PlacedItem;
  offX: number; // 語の先頭のマスの左上から指までの距離（盤の 1 マス 48px の座標）
  offY: number;
  left: number;
  top: number;
}

const cellsOf = (it: PlacedItem) =>
  Array.from({ length: it.length }, (_, i) => ({
    x: it.direction === "horizontal" ? it.startX + i : it.startX,
    y: it.direction === "vertical" ? it.startY + i : it.startY,
    ch: it.answer[i],
  }));

export const MovableBoard: React.FC<Props> = ({ data, enabled, onDrop }) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<Press | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const w = data.width * CELL;
  const h = data.height * CELL;
  const W2 = w + 2 * M;
  const H2 = h + 2 * M;

  // 画面上の点 → 盤の座標（FitGrid の縮み分を割り戻す）
  const toBoard = (clientX: number, clientY: number) => {
    const rect = layerRef.current!.getBoundingClientRect();
    const s = rect.width / W2 || 1;
    return { bx: (clientX - rect.left) / s - M, by: (clientY - rect.top) / s - M };
  };

  const itemAt = (bx: number, by: number): PlacedItem | null => {
    const cx = Math.floor(bx / CELL);
    const cy = Math.floor(by / CELL);
    const cell = data.cells.find((c) => c.x === cx && c.y === cy);
    if (!cell?.wordIds?.length) return null;
    const here = data.items.filter((i) => cell.wordIds!.includes(i.uuid));
    // 2語が交わるマスでは、そのマスから始まる語をつまむ【仮】。どちらも始まらなければ先に通る語
    return here.find((i) => i.startX === cx && i.startY === cy) ?? here[0] ?? null;
  };

  const cancelPress = () => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };

  const setDragBoth = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // 持ち上がっている間は、指の動きでページがスクロールしないようにする（touch-action は押した時点で決まるため）
  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const stop = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, []);

  useEffect(() => () => cancelPress(), []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || dragRef.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const { bx, by } = toBoard(e.clientX, e.clientY);
    const item = itemAt(bx, by);
    if (!item) return;
    cancelPress();
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const target = e.currentTarget;
    const timer = window.setTimeout(() => {
      const p = pressRef.current;
      if (!p || p.pointerId !== pointerId) return;
      pressRef.current = null;
      const b = toBoard(p.x, p.y);
      const offX = b.bx - item.startX * CELL;
      const offY = b.by - item.startY * CELL;
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // 指がもう離れている
      }
      setDragBoth({ pointerId, item, offX, offY, left: item.startX * CELL, top: item.startY * CELL });
    }, LONG_PRESS_MS);
    pressRef.current = { pointerId, x: startX, y: startY, item, timer };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pressRef.current;
    if (p && p.pointerId === e.pointerId) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_SLOP_PX) cancelPress();
      return;
    }
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const { bx, by } = toBoard(e.clientX, e.clientY);
    setDragBoth({ ...d, left: bx - d.offX, top: by - d.offY });
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>, cancel: boolean) => {
    const p = pressRef.current;
    if (p && p.pointerId === e.pointerId) {
      cancelPress();
      return;
    }
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setDragBoth(null);
    if (cancel) return;
    const nx = Math.round(d.left / CELL);
    const ny = Math.round(d.top / CELL);
    if (nx === d.item.startX && ny === d.item.startY) return;
    onDrop(d.item.uuid, nx, ny);
  };

  const pins = data.items.filter((i) => i.pinned);
  // 離したら置かれる座標に置けるか（元の場所は置ける扱い）。判定は置く時と同じ canMoveTo
  const dropX = drag ? Math.round(drag.left / CELL) : 0;
  const dropY = drag ? Math.round(drag.top / CELL) : 0;
  const placeable = !drag || (dropX === drag.item.startX && dropY === drag.item.startY) || canMoveTo(data.items, drag.item.uuid, dropX, dropY);

  return (
    <div className="relative" style={{ width: W2, height: H2 }}>
      {/* 枠の外の余白（持ち上げている間だけ薄いグレーの面）【仮】 */}
      {drag &&
        [
          { left: 0, top: 0, width: W2, height: M },
          { left: 0, top: H2 - M, width: W2, height: M },
          { left: 0, top: M, width: M, height: h },
          { left: W2 - M, top: M, width: M, height: h },
        ].map((r, i) => <div key={`margin-${i}`} data-move-margin="" className="absolute pointer-events-none" style={{ ...r, background: C.high }} />)}
      <div className="absolute" style={{ left: M, top: M, width: w, height: h }}>
        <PuzzleGridRetro data={data} showSolution={true} />

        {/* 固定の印（語の先頭のマスの右上。左上は番号）【仮】 */}
        {pins.map((it) => (
          <div
            key={`pin-${it.uuid}`}
            data-pin={it.answer.join("")}
            className="absolute pointer-events-none z-20"
            style={{ left: it.startX * CELL + CELL - 2 - 6, top: it.startY * CELL + 2, width: 6, height: 6, background: C.black }}
          />
        ))}

        {/* 持ち上げている語の元の場所を薄くする */}
        {drag &&
          cellsOf(drag.item).map((c) => (
            <div
              key={`dim-${c.x},${c.y}`}
              className="absolute pointer-events-none z-20"
              style={{ left: c.x * CELL, top: c.y * CELL, width: CELL, height: CELL, background: C.white, opacity: 0.75 }}
            />
          ))}

        {/* 持ち上げている語（半透明で少し大きく） */}
        {drag && (
          <div
            data-ghost={drag.item.answer.join("")}
            data-placeable={placeable ? "yes" : "no"}
            className="absolute pointer-events-none z-40 flex"
            style={{
              left: drag.left,
              top: drag.top,
              flexDirection: drag.item.direction === "horizontal" ? "row" : "column",
              opacity: placeable ? GHOST_OPACITY : GHOST_OPACITY_BLOCKED,
              transform: "scale(1.06)",
              transformOrigin: "top left",
              filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.25))",
            }}
          >
            {drag.item.answer.map((ch, i) => (
              <div
                key={i}
                className="flex items-center justify-center font-black"
                style={{ width: CELL, height: CELL, background: C.white, border: `1px solid ${C.ink}`, color: C.ink, fontSize: "1.5rem" }}
              >
                {ch}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* つまむための面（盤と余白の上に重ねる） */}
      <div
        ref={layerRef}
        data-move-layer=""
        className="absolute inset-0 z-30"
        style={{
          touchAction: drag ? "none" : "auto",
          userSelect: "none",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
          cursor: enabled ? (drag ? "grabbing" : "grab") : "default",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onContextMenu={(e) => {
          if (enabled) e.preventDefault();
        }}
      />
    </div>
  );
};
