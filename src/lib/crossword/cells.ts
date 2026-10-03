// ひらがなはカタカナにそろえる。小さい字は HarmonyPalette と同じく大きい字と区別する
const toKatakana = (c: string): string => {
  const code = c.charCodeAt(0);
  const isHiragana = (code >= 0x3041 && code <= 0x3096) || code === 0x309d || code === 0x309e;
  return isHiragana ? String.fromCharCode(code + 0x60) : c;
};

export const toCells = (text: string): string[] =>
  Array.from(text.trim().toUpperCase()).map(toKatakana);
