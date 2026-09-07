// 灰toダイヤモンド💎で選べる色。現役はハイ！テンションの名簿をそのまま使い、
// MVに映る卒業メンバー（ハイ！テンションの名簿に無い人）だけここで足す。
// 値の出典: src/data/the-ballad/memberColor.json（The Ballad で確定させた表。同じ色名の現役の公式指定値を流用）
// 一岡伶奈さんはMVに参加していないので入れない（Hop決定 2026-09-07）
import { findMember, type HiTensionMember } from "../hi-tension/data";

export const GRADUATED_MEMBERS: readonly HiTensionMember[] = [
  { id: "shimakura", color: "#A05EB5" },   // 島倉りか・ラベンダー
  { id: "yamazaki",  color: "#e70033" },   // 山﨑夢羽・イタリアンレッド
];

export function findDiamondMember(id: string | null): HiTensionMember | null {
  if (!id) return null;
  return findMember(id) ?? GRADUATED_MEMBERS.find((m) => m.id === id) ?? null;
}
