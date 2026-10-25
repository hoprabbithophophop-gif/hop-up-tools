// カギ（問題文）が書かれているか。○・□・→ と空白だけのカギは「書いていない」と見る（Hop 決定 2026-10-23）。
// 見えない字（ゼロ幅の空白・つなぎ U+200B〜200D、語をつなぐ字 U+2060、BOM U+FEFF、ハングルの埋め字 U+3164）だけのカギも「書いていない」（2026-10-26 レビューの直し）。
// 作る画面（カギの下書き・足りない物の数・公開の確かめ）と保存の受付係（crossword-save・crossword-update）が同じ物差しを使う
export const isBlankClue = (clue: string): boolean => /^[○□→\s\u200B-\u200D\u2060\uFEFF\u3164]*$/.test(clue);

/** 絵文字（家族の絵文字などのつなぎ U+200D の前後に来る字）か */
const isPictographic = (ch: string | undefined): boolean =>
  ch !== undefined && (/\p{Extended_Pictographic}/u.test(ch) || ch === "\uFE0F" || /[\u{1F3FB}-\u{1F3FF}]/u.test(ch));

/**
 * 改行・タブを含む制御文字と、見えない字・向きを変える字を落とす（ランキングの名前 crossword-score と、問題の保存 crossword-save が使う）。
 * 1行の欄（名前・題名・タグ・カギ）向け。contact.ts の stripUnsafe とは別物（あちらは改行を残す）。
 * ただし絵文字と絵文字の間のつなぎ（U+200D。家族の絵文字など）は、絵文字が崩れないように残す（2026-10-26 レビューの直しで足した）
 */
export function stripUnsafe(input: string): string {
  const chars = Array.from(input);
  let out = "";
  let prevKept: string | undefined;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const c = ch.codePointAt(0) as number;
    if (c === 0x200d && isPictographic(prevKept) && isPictographic(chars[i + 1])) {
      out += ch;
      prevKept = ch;
      continue;
    }
    if (c < 0x20 || c === 0x7f) continue; // 制御文字（1行なので改行・タブも落とす）
    if (c >= 0x200b && c <= 0x200f) continue; // ゼロ幅・方向マーク
    if (c >= 0x202a && c <= 0x202e) continue; // 埋め込み・上書き
    if (c >= 0x2060 && c <= 0x2064) continue; // 不可視結合子
    if (c >= 0x2066 && c <= 0x2069) continue; // 分離
    if (c === 0xfeff) continue; // BOM
    if (c === 0x3164 || c === 0xffa0) continue; // ハングルの埋め字（見えない字。2026-10-26 に足した）
    out += ch;
    prevKept = ch;
  }
  return out;
}
