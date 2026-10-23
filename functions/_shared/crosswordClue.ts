// カギ（問題文）が書かれているか。○・□・→ と空白だけのカギは「書いていない」と見る（Hop 決定 2026-10-23）。
// 作る画面（カギの下書き・足りない物の数・公開の確かめ）と保存の受付係（crossword-save・crossword-update）が同じ物差しを使う
export const isBlankClue = (clue: string): boolean => /^[○□→\s]*$/.test(clue);
