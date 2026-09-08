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

/** 再生中の色えらび（◀ 丸の列 ▶）に出す並び。現役11人のあと、MVに映る卒業3人を続ける。
 *  高瀬くるみさんは卒業だが、ハイ！テンションの名簿にまだ現役として載っているので
 *  GRADUATED_MEMBERS には足さず（色は findDiamondMember がそちらから拾う）、並びだけ卒業側に置く。
 *  色なし（グレー）は作らない＝必ずどれかの色が選ばれている状態にする（Hop決定 2026-09-07） */
export const DIAMOND_COLOR_ORDER: readonly string[] = [
  // 現役
  "nishida", "eguchi", "otsubo", "sugiyama", "maeda", "okamura",
  "kiyono", "kojima", "hirai", "kobayashi", "satoyoshi",
  // 卒業
  "shimakura", "takase", "yamazaki",
] as const;

/** 再生中の色えらびを「ユニットごとのページ」で出す時の、1ページぶんの並び（Hop決定 2026-09-08）。
 *  中身は入口で色を選んでいた頃の行の分け方をそのまま使う。4ページ目は卒業3人だが、
 *  見た目の区別（明るさを落とす等）は付けない＝離脱したように見せないため（Hop決定 2026-09-08）。
 *  DIAMOND_COLOR_ORDER と同じ14人を、余さず・重ねずに並べること（片方だけに人を足すと帯から消える）。
 *  一列の帯（DIAMOND_COLOR_ORDER）とは別々に持つ。片方からもう片方を組み立てると、
 *  どちらかの並びを変えたい時にもう片方まで動いてしまう */
export const DIAMOND_COLOR_PAGES: readonly (readonly string[])[] = [
  ["nishida", "eguchi", "otsubo", "sugiyama"],
  ["maeda", "okamura", "kiyono", "kojima"],
  ["hirai", "kobayashi", "satoyoshi"],
  ["shimakura", "takase", "yamazaki"],
] as const;

/** 色えらびの最初の色。前回の色が使えなければ西田さんのホットピンク（Hop決定 2026-09-07） */
export const DIAMOND_DEFAULT_MEMBER_ID = "nishida";
