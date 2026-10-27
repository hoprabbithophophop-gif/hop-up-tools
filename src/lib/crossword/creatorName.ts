// 作った人の名前の欄で、使えない名前かどうかを見る（Hop 決定 2026-10-27）。
// 公式・運営・このサイト・メンバー本人と間違われる名前は、打っている時点で知らせ、公開を止める。受付係も同じ物を断る（断る理由の名前は bad_name）。
// 受付係の物差し（functions/_shared/crosswordCreatorName.ts の isReservedCreatorName）の写し。画面だけ通して受付係で断られることが無いように、そろえておく。
//  ・運営に見える言葉は、全角半角・大文字小文字をそろえ（NFKC＋小文字）、空白とつなぎの棒・中黒・下線・点を落としてから含むかを見る
//    （「HOP-UP TOOLS」「ｈｏｐ ｕｐ ｔｏｏｌｓ」「hop_up_tools」も同じ「hopuptools」になる）
//  ・名簿のメンバーのフルネームとぴったり同じ名前は断る。空白の有無だけそろえて比べる（名簿の側に NFKC をかけない。山﨑の「﨑」を別の字に変えないため）
//  ・見えない字・向きを変える字は先に落とす（受付係が保存の前に落とす字と同じ）
import { ALL_MEMBERS } from "../../data/members";

const RESERVED_WORDS = ["公式", "運営", "hopuptools", "スタッフ"];
const SEPARATORS = /[\s\-‐‑‒–—―−_・･.。,、/\\]/gu;
const SPACES = /\s/gu;
// 制御文字・ゼロ幅・方向マーク・埋め込み・不可視結合子・分離・BOM・ハングルの埋め字（絵文字のつなぎ U+200D も落とす。名前の判定には要らない）
const UNSAFE = /[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤⁦-⁩﻿ㅤﾠ]/gu;

const foldForWords = (s: string) => s.normalize("NFKC").toLowerCase().replace(SEPARATORS, "");
const foldForMembers = (s: string) => s.replace(SPACES, "");
const MEMBER_NAMES = new Set(ALL_MEMBERS.map((m) => foldForMembers(m.name)));

export const isBadCreatorName = (raw: string): boolean => {
  const name = raw.replace(UNSAFE, "").trim();
  if (!name) return false;
  if (RESERVED_WORDS.some((w) => foldForWords(name).includes(w))) return true;
  return MEMBER_NAMES.has(foldForMembers(name));
};
