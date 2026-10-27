// 作った人の名前で、運営やメンバー本人になりすませる物を断る（Hop 決定 2026-10-27「作った人・解く人の時間を大事にする」直し）。
// 保存（crossword-save）と組み直し（crossword-update）の両方がここを使う。片方だけ直してずれないように1か所に置く。
//
//  ・運営に見える言葉（公式・運営・hop-up-tools・スタッフ）を含む名前は断る。
//    全角半角・大文字小文字をそろえ（NFKC＋小文字）、空白とつなぎの棒（- ‐ ― など）・中黒・下線・点を落としてから含むかを見る。
//    「HOP-UP TOOLS」「ｈｏｐ ｕｐ ｔｏｏｌｓ」「hop_up_tools」も同じ「hopuptools」になる
//  ・名簿のメンバーのフルネームとぴったり同じ名前は断る。空白（全角の空白を含む）の有無だけそろえて比べる。
//    名簿の側には全角半角そろえ（NFKC）をかけない（山﨑の「﨑」などを別の字に変えて素通りさせないため）
//  ・題名の【公式】は止めない（ここは作った人の名前だけを見る）
import { CROSSWORD_MEMBERS } from "./crosswordMembers";
import { stripUnsafe } from "./crosswordClue";

/** 断る時に画面へ返す理由の名前 */
export const BAD_NAME_REASON = "bad_name";

/** 運営に見える言葉（そろえた後の形で持つ） */
const RESERVED_WORDS = ["公式", "運営", "hopuptools", "スタッフ"];

const SEPARATORS = /[\s\-‐‑‒–—―−_・･.。,、/\\]/gu;
const SPACES = /\s/gu;

const foldForWords = (s: string): string => s.normalize("NFKC").toLowerCase().replace(SEPARATORS, "");
const foldForMembers = (s: string): string => s.replace(SPACES, "");

const MEMBER_NAMES = new Set(CROSSWORD_MEMBERS.map((m) => foldForMembers(m.name)));

/**
 * 作った人の名前がなりすましに当たるか。送られてきた生の値を渡す（文字列でない・空は false）。
 * 保存の時と同じ掃除（見えない字・向きを変える字を落とす）をしてから見る。
 */
export function isReservedCreatorName(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const name = stripUnsafe(raw).trim();
  if (name === "") return false;
  const words = foldForWords(name);
  if (RESERVED_WORDS.some((w) => words.includes(w))) return true;
  return MEMBER_NAMES.has(foldForMembers(name));
}

/** 送られてきた問題（{ body: { creatorName } } の形）の作った人の名前がなりすましに当たるか */
export function puzzleHasReservedCreatorName(puzzle: unknown): boolean {
  if (!puzzle || typeof puzzle !== "object") return false;
  const body = (puzzle as Record<string, unknown>).body;
  if (!body || typeof body !== "object") return false;
  return isReservedCreatorName((body as Record<string, unknown>).creatorName);
}
