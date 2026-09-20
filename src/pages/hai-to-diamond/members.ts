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

/** 灰toダイヤモンドで最後に使った色の控え。ハイ！テンションの控え（hi_tension:last_selected_member_id）とは分ける。
 *  「この曲ではこっちの色」という人がいるため（Hop決定 2026-09-20）。以前は共用で、こちらで色を替えると
 *  ハイ！テンションの色まで替わっていた。共用の控えは読みも書きも消しもしない＝ハイ！テンションの色は今のまま残る。
 *  分けた時点でこちらの控えは全員空から始まる（引き継ぎはしない。共用の色がどちらで選ばれた物か見分けられないため） */
const KEY_LAST_MEMBER = "hai_to_diamond:last_selected_member_id";

export function getLastDiamondMemberId(): string | null {
  try {
    return localStorage.getItem(KEY_LAST_MEMBER);
  } catch {
    return null;
  }
}

export function setLastDiamondMemberId(id: string): void {
  try {
    localStorage.setItem(KEY_LAST_MEMBER, id);
  } catch {
    // ignore (private mode etc.)
  }
}

/** シェアのリンクに付く絵（OGP）の構図の数。色ごとに 1=引き 2=中 3=寄り の3枚が public/ogp/hai-to-diamond/ にある。
 *  受付係の側（functions/_shared/haiToDiamondCard.ts の CARD_COMPS）と数を合わせること */
export const SHARE_CARD_COMPS = 3;

/** シェアのリンクの札の部分。選んでいる色と、くじ引きで当たった構図の番号を「/色/番号」にする。
 *  並びに無い色なら札なし（空文字）＝全員の💎の看板になる。rand は 0以上1未満を返す関数 */
export function shareLinkTag(memberId: string, rand: () => number = Math.random): string {
  if (!DIAMOND_COLOR_ORDER.includes(memberId)) return "";
  const comp = 1 + Math.min(SHARE_CARD_COMPS - 1, Math.floor(rand() * SHARE_CARD_COMPS));
  return `/${memberId}/${comp}`;
}

/** シェアのリンクに乗ってきた色の札（/hai-to-diamond/<色>/<構図> の <色>）。並びに無いIDや札なしは null */
export function memberIdFromShareLink(pathname: string): string | null {
  const m = /^\/hai-to-diamond\/([^/]+)\/[^/]+\/?$/.exec(pathname);
  return m && DIAMOND_COLOR_ORDER.includes(m[1]) ? m[1] : null;
}

/** 最初の色を決める。前回この端末で最後に使った色が第一。無ければ（または今の並びに無いIDなら）、
 *  シェアのリンクの看板と同じ色（看板とページを地続きに見せる・Hop決定 2026-09-20）。
 *  それも無ければ DIAMOND_DEFAULT_MEMBER_ID。遊んだことがある人の色を、人のシェアで上書きしない */
export function pickInitialMemberId(last: string | null, pathname: string): string {
  if (last && DIAMOND_COLOR_ORDER.includes(last)) return last;
  return memberIdFromShareLink(pathname) ?? DIAMOND_DEFAULT_MEMBER_ID;
}
