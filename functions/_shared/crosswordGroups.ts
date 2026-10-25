// クロスワードの「メンバー名・グループ名での自動判定」。保存の受付係と作る画面の両方がこの1つを使う。
// 名簿は呼ぶ側が渡す（受付係は functions/_shared/crosswordMembers.ts の写し、作る画面は src/data/members.ts・groups.ts）。
//
// 判定のきまり
// ・題名とカギの文: メンバーのフルネーム（漢字）か、公式表記のグループ名が入っていたら、そのグループ
// ・答え（カタカナ）: 公式表記がかなのグループ名をカタカナにしたものだけを見る（アンジュルム・ツバキファクトリー・ロージークロニクル）
// ・愛称は普通の言葉と重なるので使わない
// 見比べる前に、両側を NFKC でそろえる（全角英数・全角空白の揺れを吸収する）。

export interface GroupRoster {
  members: readonly { name: string; group: string }[];
  groups: readonly string[];
}

export interface GroupDetectInput {
  title: string;
  clues: readonly string[];
  /** 答え。1マス1字の並びをつないだカタカナ */
  answers: readonly string[];
}

import { toLargeKanaText } from "./crosswordKana";

const norm = (s: string) => s.normalize("NFKC");

// ひらがなをカタカナにそろえる（答えはカタカナで保存される）
const toKatakana = (s: string) =>
  Array.from(s)
    .map((c) => {
      const code = c.charCodeAt(0);
      return code >= 0x3041 && code <= 0x3096 ? String.fromCharCode(code + 0x60) : c;
    })
    .join("");

/** 公式表記がかなだけでできているグループ名（カタカナにしたもの）。答えの判定に使う */
export function kanaGroupNames(groups: readonly string[]): { group: string; kana: string }[] {
  return groups
    .filter((g) => /^[ぁ-ゖァ-ヶー]+$/.test(norm(g)))
    // 答えは小さい字を大きい字にそろえて保存されるので、グループ名も同じくそろえて見比べる（2026-10-05）
    .map((g) => ({ group: g, kana: toLargeKanaText(toKatakana(norm(g))) }));
}

/** 公式表記がかなでないグループの読み（Hop 確認 2026-10-25。CC の下書きを Hop が見て、雨ノ森 川海だけ直した）。
 *  名簿の書き方（CROSSWORD_GROUPS・HELLO_GROUPS）をそのまま鍵にする。愛称は入れない（Hop 決定 2026-10-23「愛称での判定は公開の後」） */
export const GROUP_READINGS: Readonly<Record<string, string>> = {
  "モーニング娘。'26": "モーニングムスメ",
  "Juice=Juice": "ジュースジュース",
  "BEYOOOOONDS": "ビヨーンズ",
  "CHICA#TETSU": "チカテツ",
  "雨ノ森 川海": "アメノモリカワウミ",
  "SeasoningS": "シーズニングス",
  "OCHA NORMA": "オチャノーマ",
  "ハロプロ研修生": "ハロプロケンシュウセイ",
};

/** 見つかったグループを、名簿のグループの並び順で返す（重なりなし） */
export function detectGroups(input: GroupDetectInput, roster: GroupRoster): string[] {
  const texts = [input.title, ...input.clues].map(norm);
  const hit = new Set<string>();

  for (const g of roster.groups) {
    // 年の付くグループ名（モーニング娘。'26）は、年の前の「モーニング娘。」まで合えば拾う
    // （'26 の無い書き方・記号の形が違う書き方も拾うため。Hop 決定 2026-10-03）
    const n = norm(g).replace(/['’‘`´]\s*\d{2}$/, "");
    if (texts.some((t) => t.includes(n))) hit.add(g);
  }
  for (const m of roster.members) {
    const n = norm(m.name);
    if (texts.some((t) => t.includes(n))) hit.add(m.group);
  }

  const answers = input.answers.map((a) => toLargeKanaText(toKatakana(norm(a))));
  for (const { group, kana } of kanaGroupNames(roster.groups)) {
    if (answers.some((a) => a.includes(kana))) hit.add(group);
  }
  // 公式表記がかなでないグループは、読みで見る（【Juice=Juice｜ジュースジュース】の答えは「ジユースジユース」で保存されるため）
  for (const g of roster.groups) {
    const reading = GROUP_READINGS[g];
    if (!reading) continue;
    const kana = toLargeKanaText(reading);
    if (answers.some((a) => a.includes(kana))) hit.add(g);
  }

  return roster.groups.filter((g) => hit.has(g));
}
