// ひらがなはカタカナに、小さい字は大きい字にそろえる（Hop 決定 2026-10-05。濁点・半濁点・「ー」は区別する）。
// 字そろえの表は受付係と同じ物（functions/_shared/crosswordKana.ts）を使う
import { hiraganaToKatakana, toLargeKana } from "../../../functions/_shared/crosswordKana";

// 最初に NFKC でそろえる（半角カナ「ｶﾞ」→「ガ」・全角英数の揺れを吸収する。2026-10-06 レビューの直し）
export const toCells = (text: string): string[] =>
  Array.from(text.normalize("NFKC").trim().toUpperCase()).map((c) => toLargeKana(hiraganaToKatakana(c)));

// ヰ・ヱ は文字盤に無く打てないので、使えない字として断る（2026-10-06 レビューの直し）
export const UNUSABLE_KANA = /[ヰヱ]/;

/** 答えのマスに使える字か（カタカナと「ー」。ヰ・ヱ は除く） */
export const isUsableCell = (c: string): boolean => /^[ァ-ヶー]$/.test(c) && !UNUSABLE_KANA.test(c);
