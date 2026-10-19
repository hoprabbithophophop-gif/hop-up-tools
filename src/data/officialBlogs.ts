// ハロプロの公式アメブロの ID（グループ分）。
// 出どころ: helloproject.com の各グループのページと /link/ に貼られたリンクの住所を、2026-10-19 に正規表現で機械的に拾った物
// （公式ページの本文は読んでいない。拾い方は本文でなくリンクの住所だけ）。各 ID は https://ameblo.jp/<id>/ が 200 で返ることを確かめた。
// 使い道: 作る画面の「公式ブログを探す」（Google の site: 検索へのリンク）。グループの並びは共通データのグループ順に合わせる。
// OG（卒業生）の公式ブログは /og/ に 28 本あるが、Google の検索語の上限（32語）に収まらないので今は入れていない【仮】。
import { googlePeriodWords, type SearchPeriod } from "../lib/crossword/searchPeriod";

export interface OfficialBlogGroup {
  key: string;
  label: string;
  ids: string[];
}

export const OFFICIAL_BLOGS: OfficialBlogGroup[] = [
  { key: "morningmusume", label: "モーニング娘。", ids: ["morningmusume-10ki", "mm-12ki", "morningmusume15ki", "morningmusume16ki"] },
  { key: "angerme", label: "アンジュルム", ids: ["angerme-new"] },
  { key: "juicejuice", label: "Juice=Juice", ids: ["juicejuice-official"] },
  { key: "tsubaki", label: "つばきファクトリー", ids: ["tsubaki-factory", "tsubaki-factory-new"] },
  { key: "beyooooonds", label: "BEYOOOOONDS", ids: ["beyooooonds", "beyooooonds-blog", "beyooooonds-chicatetsu", "beyooooonds-rfro"] },
  { key: "ochanorma", label: "OCHA NORMA", ids: ["ocha-norma"] },
  { key: "rosy", label: "ロージークロニクル", ids: ["rosychronicle"] },
];

// Google の site: 検索の住所。複数のブログは OR でつなぐ。
// inurl:entry で記事ページに絞ろうとすると Google が 0 件を返す（2026-10-19 に Hop の Chrome で確認。site: と組むと効かない）ので付けない
// 期間（いつごろ）は after:/before: で足す（Hop 依頼 2026-10-19）。写して使えるように、言葉そのものも返す
export function officialBlogSearchQuery(group: OfficialBlogGroup, keyword: string, period: SearchPeriod | null = null): string {
  const sites = group.ids.map((id) => `site:ameblo.jp/${id}`).join(" OR ");
  return `${keyword.trim()} (${sites})${googlePeriodWords(period)}`;
}
export function officialBlogSearchUrl(group: OfficialBlogGroup, keyword: string, period: SearchPeriod | null = null): string {
  return `https://www.google.com/search?q=${encodeURIComponent(officialBlogSearchQuery(group, keyword, period))}`;
}
