/**
 * PuzzleCloseupModal - クローズアップ入力モーダル（HarmonyPalette からの移植）
 * パズルのセルまたはカギをタップした時に表示される拡大入力インタフェース
 *
 * デザイン: 画面下部のシート。周りの背景（透過）をタップすると閉じる
 * 足した物: 見出しの「ヒント」ボタン。押すと文字盤の場所にヒント（動画・リンク）が出る
 *           見出しの「1文字見る」ボタン。その回で初めて押す時だけ、その場で確かめる（ノーヒントの印が付かなくなるため）
 */

import React, { useEffect, useRef, useState } from "react";
import type { PlacedItem } from "../../../lib/crossword/types";
import type { HintRef } from "../../../lib/crossword/puzzleStore";
import { animateElement, currentValue, type MotionHandle } from "../../../lib/crossword/motion";
import { PAUSE_PLAYERS_EVENT } from "../../../lib/pageWave";
import { PuzzleKeypad, type KeypadType } from "./PuzzleKeypad";
import { Motion } from "./Motion";
import { HintView } from "./HintView";
import { C } from "../style";

interface PuzzleCloseupModalProps {
  wordItem: PlacedItem;
  userAnswers: Record<string, string>;
  activeIndex: number;
  keypadType: KeypadType;
  hint?: HintRef;
  /** 練習問題のヒント（動画でなく1行の文）。あれば「ヒント」を押すと文字盤の場所にこの文が出る */
  hintText?: string;
  onKeyPress: (char: string) => void;
  onBackspace: () => void;
  onClose: () => void;
  onComplete: () => void;
  onPrevCell: () => void;
  onNextCell: () => void;
  onModifyChar?: (char: string, index: number) => void;
  onReveal?: () => void;
  /** その回ですでに1文字見るを使ったか（使っていれば確かめずに開ける） */
  revealUsed?: boolean;
}

// framer-motion の drag="y" / dragElastic 0.2 / dragConstraints {top:0,bottom:0} の再現に使う値
const DRAG_THRESHOLD = 3; // px（framer の PanSession が動き出しとみなす距離）
const DRAG_ELASTIC = 0.2;
const CLOSE_OFFSET = 100;

export const PuzzleCloseupModal: React.FC<PuzzleCloseupModalProps> = ({
  wordItem,
  userAnswers,
  activeIndex,
  keypadType,
  hint,
  hintText,
  onKeyPress,
  onBackspace,
  onClose,
  onComplete,
  onPrevCell,
  onNextCell,
  onModifyChar,
  onReveal,
  revealUsed = false,
}) => {
  const [showHint, setShowHint] = useState(false);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; startY: number; dragging: boolean } | null>(null);
  const dragY = useRef(0); // 今の y（px）。ドラッグで動いた後の exit はここから始める
  const snapBack = useRef<MotionHandle | null>(null);

  // 最後に字を打ったマス（゛゜はこのマスに効かせる）。←→で動いた・消した・開いたばかりの時は null
  const [lastTypedIndex, setLastTypedIndex] = useState<number | null>(null);

  // カギが変わったら入力に戻す
  useEffect(() => {
    setShowHint(false);
    setConfirmReveal(false);
    setLastTypedIndex(null);
  }, [wordItem.uuid]);

  // ページ移動の波が出るときは、動画を外して音を止める（見えないプレーヤーから音を鳴らさない）
  useEffect(() => {
    const stop = () => setShowHint(false);
    window.addEventListener(PAUSE_PLAYERS_EVENT, stop);
    return () => window.removeEventListener(PAUSE_PLAYERS_EVENT, stop);
  }, []);

  const getCellValue = (index: number): string => {
    const x = wordItem.direction === "horizontal" ? wordItem.startX + index : wordItem.startX;
    const y = wordItem.direction === "vertical" ? wordItem.startY + index : wordItem.startY;
    return userAnswers[`${x},${y}`] || "";
  };
  // ゛゜は書き順どおり「字のあと」に効く（Hop 2026-10-06）。直前に打った字のマスに効かせる。字を入れると次のマスへ進むので、
  // 次のマスに交差の字が既にあっても、その字は濁らせない（2026-10-06 レビューの直し）。直前に打った字が無ければ今のマスの字に効かせる
  const modTargetIndex = lastTypedIndex ?? activeIndex;

  const typeChar = (char: string) => {
    setLastTypedIndex(activeIndex);
    onKeyPress(char);
  };
  const forgetTyped = () => setLastTypedIndex(null);
  const prevCell = () => {
    forgetTyped();
    onPrevCell();
  };
  const nextCell = () => {
    forgetTyped();
    onNextCell();
  };
  const backspace = () => {
    forgetTyped();
    onBackspace();
  };
  const modifyChar = (ch: string) => {
    // 今のマスの字に効かせた時は、打ち直したのと同じ扱い（続けて ゜ を押しても同じマスに効く）
    setLastTypedIndex(modTargetIndex);
    onModifyChar?.(ch, modTargetIndex);
  };
  // 1文字見るで入った字も、打った字と同じ扱い（次のマスの交差の字に ゛ が付かないように）
  const reveal = () => {
    setLastTypedIndex(activeIndex);
    onReveal?.();
  };

  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // [No.06] ドラッグジェスチャーで閉じる
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, startY: e.clientY, dragging: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = sheetRef.current;
    if (!d || d.id !== e.pointerId || !el) return;
    const offset = e.clientY - d.startY;
    if (!d.dragging) {
      if (Math.abs(offset) < DRAG_THRESHOLD) return;
      d.dragging = true;
      snapBack.current?.cancel();
      el.getAnimations().forEach((a) => a.cancel());
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 取れなくても動かせる */
      }
    }
    // 上下とも制約の外なので、ずれの 0.2 倍だけ動く（framer の applyConstraints と同じ）
    dragY.current = offset * DRAG_ELASTIC;
    el.style.translate = `0px ${dragY.current}px`;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const el = sheetRef.current;
    if (!d || !d.dragging || !el) return;
    const offset = e.clientY - d.startY;
    if (offset > CLOSE_OFFSET) {
      onClose();
      return;
    }
    // 制約（0）へ戻る。framer の inertia が境界でかけるばね（stiffness 200 / damping 40 / restDelta 1 / restSpeed 10）
    const from = dragY.current;
    snapBack.current = animateElement(el, { y: from }, { y: 0 }, { type: "spring", stiffness: 200, damping: 40, restDelta: 1, restSpeed: 10 });
    dragY.current = 0;
  };

  return (
    <Motion
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.1)" }}
      onClick={handleBackgroundClick}
    >
      {/* [No.04] ボトムシート化 - 画面下部からスライドイン */}
      <Motion
        ref={sheetRef}
        initial={{ y: "100%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "100%", opacity: 0 }}
        exitFrom={() => {
          const el = sheetRef.current;
          const y = el ? currentValue(el, "y") : 0;
          return { y: el && el.style.translate === "" && !el.getAnimations().length ? "0%" : y, opacity: 1 };
        }}
        measure={(_p, v) => {
          const h = sheetRef.current?.offsetHeight ?? 0;
          return typeof v === "string" && v.endsWith("%") ? (parseFloat(v) / 100) * h : v;
        }}
        className="w-full max-w-[480px] max-h-[90vh] overflow-auto"
        style={{ background: C.white, boxShadow: C.modalShadow, touchAction: "pan-x", userSelect: "none", WebkitUserSelect: "none" }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* [No.05] Grip Handle - ドラッグ可能であることを示す */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-12 h-1" style={{ background: C.highest }} />
        </div>

        {/* Header: カギ + ヒント + 閉じるボタン（data-coach は練習問題の案内の印の目印） */}
        {/* カギの文は切り詰めずに全文を折り返して出す（Hop 2026-10-06「全文出ないのストレス」）。ボタンは下の段 */}
        <div data-coach="closeup-head" className="p-4 flex flex-col gap-2" style={{ background: C.low }}>
          <div className="flex items-start gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold shrink-0 pt-0.5">
              <span className="px-2 py-0.5 text-xs font-bold bg-primary text-white">{wordItem.clueIndex}</span>
              <span className="material-symbols-outlined leading-none" style={{ fontSize: "16px", color: C.secondary }}>
                {wordItem.direction === "horizontal" ? "arrow_forward" : "arrow_downward"}
              </span>
            </div>
            <p className="flex-1 min-w-0 text-sm leading-snug whitespace-pre-wrap break-words" style={{ color: C.ink }}>{wordItem.question}</p>
            <button onClick={onClose} className="p-1.5 -mt-1 -mr-1 shrink-0 hover:bg-surface-container-high transition-colors" aria-label="閉じる">
              <span className="material-symbols-outlined leading-none" style={{ fontSize: "20px", color: C.secondary }}>close</span>
            </button>
          </div>
          <div className="flex items-center gap-2 pl-[2.25rem]">
          {(hint || hintText) && (
            <button
              onClick={() => setShowHint((v) => !v)}
              className={`px-2 py-1 text-xs font-bold transition-colors ${showHint ? "bg-primary text-white" : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"}`}
              aria-pressed={showHint}
            >
              ヒント
            </button>
          )}
          {onReveal && (
            <button
              data-coach="reveal"
              onClick={() => (revealUsed ? reveal() : setConfirmReveal(true))}
              className="px-2 py-1 text-xs font-bold bg-surface-container-high text-on-surface hover:bg-surface-container-highest transition-colors shrink-0"
            >
              1文字見る
            </button>
          )}
          </div>
        </div>

        {/* 1文字見るの確かめ（その回で初めての時だけ） */}
        {confirmReveal && (
          <div data-coach="reveal-confirm" className="px-4 py-3 flex flex-wrap items-center gap-2" style={{ background: C.low }}>
            <span className="flex-1 min-w-0 text-sm" style={{ color: C.ink }}>
              1文字見る？
              <span className="block text-xs mt-0.5" style={{ color: C.secondary }}>ノーヒントの印は付かなくなります。</span>
            </span>
            <button
              onClick={() => {
                setConfirmReveal(false);
                reveal();
              }}
              className="px-3 py-1.5 text-sm font-bold bg-primary text-white hover:bg-secondary transition-colors"
            >
              見る
            </button>
            <button onClick={() => setConfirmReveal(false)} className="px-3 py-1.5 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors" style={{ color: C.ink }}>
              やめる
            </button>
          </div>
        )}

        {/* Cells: 拡大セル表示 */}
        <div data-coach="closeup-cells" className="p-4 flex justify-center overflow-x-auto">
          <div className="flex gap-1">
            {Array.from({ length: wordItem.length }, (_, index) => {
              const value = getCellValue(index);
              const isActive = index === activeIndex;
              return (
                <button
                  key={index}
                  onClick={() => {
                    // マスを押して選んだら、そのマスの字に効かせる（今のマスを押し直した時も）
                    forgetTyped();
                    if (index < activeIndex) {
                      for (let i = 0; i < activeIndex - index; i++) prevCell();
                    } else if (index > activeIndex) {
                      for (let i = 0; i < index - activeIndex; i++) nextCell();
                    }
                  }}
                  className={`puzzle-cell w-12 h-12 font-semibold text-xl flex items-center justify-center uppercase transition-all ${isActive ? "scale-110 z-10" : ""}`}
                  style={{
                    background: isActive ? C.activeCell : C.low,
                    boxShadow: isActive ? `0 0 0 2px ${C.black}` : undefined,
                    color: value ? "#1a1a1a" : "#9ca3af",
                  }}
                >
                  {value || "·"}
                </button>
              );
            })}
          </div>
        </div>

        {/* Keypad（ヒントを開いている間はここにヒントを出す） */}
        <div data-coach="keypad">
          {showHint && hint ? (
            <HintView hint={hint} />
          ) : showHint && hintText ? (
            <p className="p-4 text-sm leading-relaxed" style={{ color: C.ink }}>{hintText}</p>
          ) : (
            <PuzzleKeypad
              type={keypadType}
              onKeyPress={typeChar}
              onBackspace={backspace}
              onEnter={onComplete}
              onArrowLeft={prevCell}
              onArrowRight={nextCell}
              disabled={false}
              currentChar={getCellValue(modTargetIndex)}
              onModifyCurrentChar={modifyChar}
            />
          )}
        </div>
      </Motion>
    </Motion>
  );
};

export default PuzzleCloseupModal;
