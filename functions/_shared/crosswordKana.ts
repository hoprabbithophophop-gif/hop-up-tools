// クロスワードの答えの字そろえ。小さい字は大きい字と同じ扱いにする（Hop 決定 2026-10-05。10-03 の「区別する」を取り消し）。
// 濁点・半濁点・「ー」はそのまま区別する。作る画面（src/lib/crossword/cells.ts）と受付係（crossword-save）の両方がこの1つを使う。

const SMALL_TO_LARGE: Record<string, string> = {
  ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ",
  ャ: "ヤ", ュ: "ユ", ョ: "ヨ", ッ: "ツ", ヮ: "ワ",
  ヵ: "カ", ヶ: "ケ",
};

/** ひらがな1字をカタカナに。ほかの字はそのまま */
export const hiraganaToKatakana = (c: string): string => {
  const code = c.charCodeAt(0);
  const isHiragana = (code >= 0x3041 && code <= 0x3096) || code === 0x309d || code === 0x309e;
  return isHiragana ? String.fromCharCode(code + 0x60) : c;
};

/** 小さいカタカナ1字を大きい字に。ほかの字はそのまま（ひらがなの小さい字は先にカタカナにしてから通す） */
export const toLargeKana = (c: string): string => SMALL_TO_LARGE[c] ?? c;

/** 文字列の中の小さいカタカナを全部大きい字に */
export const toLargeKanaText = (s: string): string => Array.from(s).map(toLargeKana).join("");
