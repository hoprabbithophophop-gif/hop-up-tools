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

  // カギが変わったら入力に戻す
  useEffect(() => {
    setShowHint(false);
    setConfirmReveal(false);
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
  // ゛゜は書き順どおり「字のあと」に効く。字を入れると次のマスへ進んでいるので、今のマスが空なら1つ前の字に効かせる（Hop 2026-10-06）
  const modTargetIndex = !getCellValue(activeIndex) && activeIndex > 0 && getCellValue(activeIndex - 1) ? activeIndex - 1 : activeIndex;

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
        <div data-coach="closeup-head" className="p-4 flex items-center gap-3" style={{ background: C.low }}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="px-2 py-0.5 text-xs font-bold bg-primary text-white">{wordItem.clueIndex}</span>
            <span className="material-symbols-outlined leading-none" style={{ fontSize: "16px", color: C.secondary }}>
              {wordItem.direction === "horizontal" ? "arrow_forward" : "arrow_downward"}
            </span>
          </div>
          <p className="flex-1 text-sm truncate" style={{ color: C.ink }}>{wordItem.question}</p>
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
              onClick={() => (revealUsed ? onReveal() : setConfirmReveal(true))}
              className="px-2 py-1 text-xs font-bold bg-surface-container-high text-on-surface hover:bg-surface-container-highest transition-colors shrink-0"
            >
              1文字見る
            </button>
          )}
          <button onClick={onClose} className="p-1.5 hover:bg-surface-container-high transition-colors" aria-label="閉じる">
            <span className="material-symbols-outlined leading-none" style={{ fontSize: "20px", color: C.secondary }}>close</span>
          </button>
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
                onReveal?.();
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
                    if (index < activeIndex) {
                      for (let i = 0; i < activeIndex - index; i++) onPrevCell();
                    } else if (index > activeIndex) {
                      for (let i = 0; i < index - activeIndex; i++) onNextCell();
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
              onKeyPress={onKeyPress}
              onBackspace={onBackspace}
              onEnter={onComplete}
              onArrowLeft={onPrevCell}
              onArrowRight={onNextCell}
              disabled={false}
              currentChar={getCellValue(modTargetIndex)}
              onModifyCurrentChar={(ch) => onModifyChar?.(ch, modTargetIndex)}
            />
          )}
        </div>
      </Motion>
    </Motion>
  );
};

export default PuzzleCloseupModal;
