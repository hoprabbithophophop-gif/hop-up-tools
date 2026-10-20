// ハロプロの公式サイトと関連サイトの住所（作る画面のヒントの窓「① 公式サイトを探す」の Google 検索の対象）。
// 出どころ: helloproject.com の /link/ に貼られたリンクの住所を 2026-10-20 に正規表現で機械的に拾った物（本文は読んでいない）。
// ショップ（elineupmall.com・helloshop.info・ody-books.com・helloproject.orical.jp）は事実の出どころでないので外した【仮】
import { googlePeriodWords, type SearchPeriod } from "../lib/crossword/searchPeriod";

export const OFFICIAL_SITES: string[] = [
  "helloproject.com",
  "up-front-works.jp",
  "up-front-works-sp.com",
  "upfc.jp",
  "gekijyo.jp",
  "satoyamamovement.com",
  "helloproject-mobile.com",
  "helloproject-stream.com",
  "hp-audition.com",
  "minimoni-2000.com",
  "ufg.co.jp",
  "ody-inc.com",
];

// Google の検索語は32語までと言われている（未確認の前提）。余裕を取って30語までにする。空白で区切った語（site:〜・OR・after:〜 も1語）を数える
export const GOOGLE_WORD_LIMIT = 30;
export const countSearchWords = (q: string) => q.trim().split(/\s+/).filter(Boolean).length;

// 「探す言葉 (site:a OR site:b OR …)」＋いつごろ。30語を超える時は一覧の後ろのサイトから削る（1つは必ず残す）
export function officialSiteSearchQuery(keyword: string, period: SearchPeriod | null = null): string {
  const build = (sites: string[]) => `${keyword.trim()} (${sites.map((s) => `site:${s}`).join(" OR ")})${googlePeriodWords(period)}`;
  let sites = OFFICIAL_SITES;
  let q = build(sites);
  while (countSearchWords(q) > GOOGLE_WORD_LIMIT && sites.length > 1) {
    sites = sites.slice(0, -1);
    q = build(sites);
  }
  return q;
}

export function officialSiteSearchUrl(keyword: string, period: SearchPeriod | null = null): string {
  return `https://www.google.com/search?q=${encodeURIComponent(officialSiteSearchQuery(keyword, period))}`;
}
