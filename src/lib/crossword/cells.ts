// ひらがなはカタカナに、小さい字は大きい字にそろえる（Hop 決定 2026-10-05。濁点・半濁点・「ー」は区別する）。
// 字そろえの表は受付係と同じ物（functions/_shared/crosswordKana.ts）を使う
import { hiraganaToKatakana, toLargeKana } from "../../../functions/_shared/crosswordKana";

export const toCells = (text: string): string[] =>
  Array.from(text.trim().toUpperCase()).map((c) => toLargeKana(hiraganaToKatakana(c)));
