/**
 * PuzzleKeypad - カスタムキーパッドコンポーネント（HarmonyPalette からの移植）
 * パズル内容から文字種（A-Z / ひらがな / カタカナ）を自動判定して表示
 * カタカナにも、ひらがなと同じ ゛ ゜ の仕組みを付けた（対応表はひらがなの表と同じ並び）
 * 「小」は外した。小さい字は大きい字と同じ扱いにそろえたため（Hop 決定 2026-10-05）。空いた所は詰める【仮】
 */

import React, { useState } from "react";
import { C } from "../style";

export type KeypadType = "alphabet" | "hiragana" | "katakana";
type HiraganaMode = "normal" | "dakuten" | "handakuten";

const ALPHABET_KEYS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
];

const ALPHABET_ABC_KEYS = [
  ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
  ["K", "L", "M", "N", "O", "P", "Q", "R", "S"],
  ["T", "U", "V", "W", "X", "Y", "Z"],
];

// 清音のみのひらがな配列（右から左へ読む伝統的な形式）
const HIRAGANA_BASE = [
  ["わ", "ら", "や", "ま", "は", "な", "た", "さ", "か", "あ"],
  ["を", "り", "", "み", "ひ", "に", "ち", "し", "き", "い"],
  ["ん", "る", "ゆ", "む", "ふ", "ぬ", "つ", "す", "く", "う"],
  ["ー", "れ", "", "め", "へ", "ね", "て", "せ", "け", "え"],
  ["", "ろ", "よ", "も", "ほ", "の", "と", "そ", "こ", "お"],
];

// 清音→濁音マッピング
const DAKUTEN_MAP: Record<string, string> = {
  か: "が", き: "ぎ", く: "ぐ", け: "げ", こ: "ご",
  さ: "ざ", し: "じ", す: "ず", せ: "ぜ", そ: "ぞ",
  た: "だ", ち: "ぢ", つ: "づ", て: "で", と: "ど",
  は: "ば", ひ: "び", ふ: "ぶ", へ: "べ", ほ: "ぼ",
  う: "ゔ",
  // カタカナ（ひらがなの表と同じ字の組）
  カ: "ガ", キ: "ギ", ク: "グ", ケ: "ゲ", コ: "ゴ",
  サ: "ザ", シ: "ジ", ス: "ズ", セ: "ゼ", ソ: "ゾ",
  タ: "ダ", チ: "ヂ", ツ: "ヅ", テ: "デ", ト: "ド",
  ハ: "バ", ヒ: "ビ", フ: "ブ", ヘ: "ベ", ホ: "ボ",
  ウ: "ヴ",
};

// 清音→半濁音マッピング
const HANDAKUTEN_MAP: Record<string, string> = {
  は: "ぱ", ひ: "ぴ", ふ: "ぷ", へ: "ぺ", ほ: "ぽ",
  ハ: "パ", ヒ: "ピ", フ: "プ", ヘ: "ペ", ホ: "ポ",
};

const KATAKANA_KEYS = [
  ["ワ", "ラ", "ヤ", "マ", "ハ", "ナ", "タ", "サ", "カ", "ア"],
  ["ヲ", "リ", "", "ミ", "ヒ", "ニ", "チ", "シ", "キ", "イ"],
  ["ン", "ル", "ユ", "ム", "フ", "ヌ", "ツ", "ス", "ク", "ウ"],
  ["ー", "レ", "", "メ", "ヘ", "ネ", "テ", "セ", "ケ", "エ"],
  ["", "ロ", "ヨ", "モ", "ホ", "ノ", "ト", "ソ", "コ", "オ"],
];

/**
 * パズルの回答文字列から文字種を自動判定
 */
export function detectKeypadType(answers: string[]): KeypadType {
  const allChars = answers.join("");
  if (!allChars) return "alphabet";
  if (/^[A-Za-z]+$/.test(allChars)) return "alphabet";
  if (/^[ぁ-ゖー]+$/.test(allChars)) return "hiragana";
  if (/^[ァ-ヶー]+$/.test(allChars)) return "katakana";
  return "alphabet";
}

interface PuzzleKeypadProps {
  type: KeypadType;
  onKeyPress: (char: string) => void;
  onBackspace: () => void;
  onEnter?: () => void;
  onArrowLeft?: () => void;
  onArrowRight?: () => void;
  disabled?: boolean;
  currentChar?: string;
  onModifyCurrentChar?: (char: string) => void;
}

const keyBase = "transition-colors";

export const PuzzleKeypad: React.FC<PuzzleKeypadProps> = ({
  type,
  onKeyPress,
  onBackspace,
  onEnter,
  onArrowLeft,
  onArrowRight,
  disabled = false,
  currentChar,
  onModifyCurrentChar,
}) => {
  const [isAlphabetOrder, setIsAlphabetOrder] = useState(false);
  const [hiraganaMode, setHiraganaMode] = useState<HiraganaMode>("normal");
  const hasModifiers = type === "hiragana" || type === "katakana";

  const transformChar = (char: string): string => {
    if (!char) return "";
    if (hiraganaMode === "dakuten" && DAKUTEN_MAP[char]) return DAKUTEN_MAP[char];
    if (hiraganaMode === "handakuten" && HANDAKUTEN_MAP[char]) return HANDAKUTEN_MAP[char];
    return char;
  };

  const getKeys = () => {
    if (type === "alphabet") return isAlphabetOrder ? ALPHABET_ABC_KEYS : ALPHABET_KEYS;
    if (type === "hiragana") return HIRAGANA_BASE;
    return KATAKANA_KEYS;
  };

  const keys = getKeys();

  const handleKeyClick = (char: string) => {
    if (disabled || !char) return;
    const outputChar = hasModifiers ? transformChar(char) : char;
    onKeyPress(outputChar);
    if (hiraganaMode !== "normal") setHiraganaMode("normal");
  };

  // 濁音・半濁音ボタンの処理。書き順どおり「字のあと」に押して、直前の字を変える。
  // 変えられる字が無ければ何もしない（「先に ゛ を押してから字」の順は使わない。Hop 2026-10-06）
  const handleModifierClick = (mode: HiraganaMode) => {
    if (!currentChar || !onModifyCurrentChar) return;
    let modified: string | undefined;
    if (mode === "dakuten") modified = DAKUTEN_MAP[currentChar];
    if (mode === "handakuten") modified = HANDAKUTEN_MAP[currentChar];
    if (modified) onModifyCurrentChar(modified);
  };

  const modifierStyle = (mode: HiraganaMode, map: Record<string, string>): React.CSSProperties =>
    hiraganaMode === mode
      ? { background: C.black, color: C.white }
      : currentChar && map[currentChar]
        ? { background: C.highest, color: C.black }
        : { background: C.low, color: C.secondary };

  return (
    <div className="w-full p-3">
      <div className="space-y-1">
        {keys.map((row, rowIndex) => (
          <div key={rowIndex} className="flex justify-center gap-0.5">
            {row.map((baseChar, charIndex) => {
              const displayChar = hasModifiers ? transformChar(baseChar) : baseChar;
              const hasTransform = hasModifiers && displayChar !== baseChar;
              return (
                <button
                  key={`${baseChar}-${charIndex}`}
                  onClick={() => handleKeyClick(baseChar)}
                  disabled={disabled || !baseChar}
                  className={`w-8 h-9 ${!baseChar ? "invisible" : ""} font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${keyBase} text-sm`}
                  style={{ background: hasTransform ? C.highest : C.low, color: C.ink, boxShadow: hasTransform ? `inset 0 0 0 1px ${C.black}` : undefined }}
                >
                  {displayChar || baseChar}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex justify-center gap-2 mt-3 flex-wrap">
        {(onArrowLeft || onArrowRight) && (
          <div className="flex gap-1">
            {onArrowLeft && (
              <button onClick={onArrowLeft} disabled={disabled} className={`p-2.5 bg-primary hover:bg-secondary disabled:opacity-50 ${keyBase}`} aria-label="前のセル">
                <span className="material-symbols-outlined leading-none text-white" style={{ fontSize: "16px" }}>arrow_back</span>
              </button>
            )}
            {onArrowRight && (
              <button onClick={onArrowRight} disabled={disabled} className={`p-2.5 bg-primary hover:bg-secondary disabled:opacity-50 ${keyBase}`} aria-label="次のセル">
                <span className="material-symbols-outlined leading-none text-white" style={{ fontSize: "16px" }}>arrow_forward</span>
              </button>
            )}
          </div>
        )}

        {/* ひらがな・カタカナのモード切替ボタン */}
        {hasModifiers && (
          <div className="flex gap-1">
            <button
              onClick={() => handleModifierClick("dakuten")}
              disabled={disabled || (currentChar ? !DAKUTEN_MAP[currentChar] : false)}
              className={`px-3 py-2 font-bold text-sm ${keyBase}`}
              style={modifierStyle("dakuten", DAKUTEN_MAP)}
            >
              ゛
            </button>
            <button
              onClick={() => handleModifierClick("handakuten")}
              disabled={disabled || (currentChar ? !HANDAKUTEN_MAP[currentChar] : false)}
              className={`px-3 py-2 font-bold text-sm ${keyBase}`}
              style={modifierStyle("handakuten", HANDAKUTEN_MAP)}
            >
              ゜
            </button>
          </div>
        )}

        {type === "alphabet" && (
          <button
            onClick={() => setIsAlphabetOrder((prev) => !prev)}
            disabled={disabled}
            className={`px-3 py-2.5 font-semibold text-xs ${keyBase}`}
            style={{ background: C.highest, color: C.ink }}
          >
            {isAlphabetOrder ? "ABC" : "QWERTY"}
          </button>
        )}

        <button
          onClick={onBackspace}
          disabled={disabled}
          className={`px-4 py-2.5 font-semibold disabled:opacity-50 flex items-center gap-1.5 ${keyBase}`}
          style={{ background: C.highest, color: C.ink }}
        >
          <span className="material-symbols-outlined leading-none" style={{ fontSize: "16px" }}>backspace</span>
          <span className="text-sm">削除</span>
        </button>

        {onEnter && (
          <button
            onClick={onEnter}
            disabled={disabled}
            className={`px-4 py-2.5 font-semibold disabled:opacity-50 flex items-center gap-1.5 bg-primary hover:bg-secondary text-white ${keyBase}`}
          >
            <span className="material-symbols-outlined leading-none" style={{ fontSize: "16px" }}>keyboard_return</span>
            <span className="text-sm">決定</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default PuzzleKeypad;
