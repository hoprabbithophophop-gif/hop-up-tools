// ハロプロの公式アメブロの ID（グループ・期のブログ。今の14本と、更新が止まった8本）。
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
  { key: "morningmusume", label: "モーニング娘。", ids: ["morningmusume-9ki", "morningmusume-10ki", "mm-12ki", "morningm-13ki", "morningmusume15ki", "morningmusume16ki"] },
  { key: "angerme", label: "アンジュルム", ids: ["angerme-new", "angerme-ss-shin", "angerme-amerika", "smileage-submember"] },
  { key: "juicejuice", label: "Juice=Juice", ids: ["juicejuice-official"] },
  { key: "tsubaki", label: "つばきファクトリー", ids: ["tsubaki-factory", "tsubaki-factory-new"] },
  { key: "beyooooonds", label: "BEYOOOOONDS", ids: ["beyooooonds", "beyooooonds-blog", "beyooooonds-chicatetsu", "beyooooonds-rfro"] },
  { key: "ochanorma", label: "OCHA NORMA", ids: ["ocha-norma"] },
  { key: "rosy", label: "ロージークロニクル", ids: ["rosychronicle"] },
  // 活動を終えたグループの公式ブログ（Hop 決定 2026-10-21。並びの名前は【仮】）
  { key: "ended", label: "活動を終えたグループ", ids: ["kobushi-factory", "countrygirls", "c-ute-official"] },
];

// 各ブログに記事がある期間（最初の記事の年月〜最後の記事の年月。null は更新中）。
// 出どころ: 各ブログの記事一覧のページに出ている日付を 2026-10-21 に正規表現で機械的に拾った物（本文は読んでいない。記事の総数がアメブロの表示と一致することを確かめた）。
// 過去のブログの ID は、インターネットの記録庫（Wayback Machine）にある helloproject.com の過去の写しに貼られていたアメブロの住所から拾った。
// 最初と最後しか測っていないので、途中で長く休んでいた期間は分からない（その間の年月にも出る）
export const BLOG_PERIODS: Record<string, { from: string; to: string | null }> = {
  "morningmusume-9ki": { from: "2012-09", to: "2025-07" },
  "morningmusume-10ki": { from: "2012-09", to: null },
  "mm-12ki": { from: "2014-12", to: null },
  "morningm-13ki": { from: "2017-01", to: "2025-12" },
  "morningmusume15ki": { from: "2019-07", to: null },
  "morningmusume16ki": { from: "2022-07", to: null },
  "angerme-new": { from: "2019-01", to: null },
  "angerme-ss-shin": { from: "2014-12", to: "2025-06" },
  "angerme-amerika": { from: "2014-12", to: "2023-06" },
  "smileage-submember": { from: "2011-09", to: "2014-12" },
  "juicejuice-official": { from: "2013-04", to: null },
  "tsubaki-factory": { from: "2015-05", to: null },
  "tsubaki-factory-new": { from: "2024-04", to: null },
  "beyooooonds": { from: "2019-01", to: null },
  "beyooooonds-blog": { from: "2026-06", to: null },
  "beyooooonds-chicatetsu": { from: "2018-10", to: null },
  "beyooooonds-rfro": { from: "2018-10", to: null },
  "ocha-norma": { from: "2021-12", to: null },
  "rosychronicle": { from: "2024-07", to: null },
  "kobushi-factory": { from: "2015-03", to: "2020-03" },
  "countrygirls": { from: "2015-01", to: "2019-12" },
  "c-ute-official": { from: "2015-03", to: "2017-06" },
};

// ブログごとの表示名（Hop 依頼 2026-10-21「全部からも細かくも選べると嬉しい」）。
// 出どころ: 各ブログのページの題名（<title>）を 2026-10-21 に機械で拾い、「オフィシャルブログ」を外した物。本文は読んでいない。
// つばきファクトリーの2つは題名がほぼ同じで見分けられないので、住所の名前のまま【仮】
export const BLOG_NAMES: Record<string, string> = {
  "morningmusume-9ki": "Q期",
  "morningmusume-10ki": "天気組",
  "mm-12ki": "12期",
  "morningm-13ki": "13期",
  "morningmusume15ki": "15期",
  "morningmusume16ki": "16期17期18期",
  "angerme-new": "メンバー",
  "angerme-ss-shin": "メンバー",
  "angerme-amerika": "アメリカにっき",
  "smileage-submember": "スマイレージ二期メンバー",
  "kobushi-factory": "こぶしファクトリー",
  "countrygirls": "カントリー・ガールズ",
  "c-ute-official": "℃-ute",
  // つばきファクトリーの2つ（7人の方・4人の方）の呼び名（Hop 決定 2026-10-21）
  "tsubaki-factory": "〜リトキャメ",
  "tsubaki-factory-new": "ひなーず〜",
  "beyooooonds": "SeasoningS",
  "beyooooonds-blog": "BEYOOOOONDS",
  "beyooooonds-chicatetsu": "CHICA#TETSU",
  "beyooooonds-rfro": "雨ノ森 川海",
};

// 更新が止まったブログには期間を添える（例「Q期（2012〜2025）」。Hop 決定 2026-10-21）
export function blogLabel(id: string): string {
  const name = BLOG_NAMES[id] ?? id;
  const p = BLOG_PERIODS[id];
  return p && p.to ? `${name}（${p.from.slice(0, 4)}〜${p.to.slice(0, 4)}）` : name;
}

// 選んだ「いつごろ」に記事があるブログだけ（いつごろを選んでいなければ全部）
export function blogsInPeriod(group: OfficialBlogGroup, period: SearchPeriod | null): string[] {
  if (!period) return group.ids;
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${period.year}-${pad(period.month ?? 1)}`;
  const end = `${period.year}-${pad(period.month ?? 12)}`;
  return group.ids.filter((id) => {
    const p = BLOG_PERIODS[id];
    if (!p) return true;
    return p.from <= end && (p.to === null || p.to >= start);
  });
}

// 選択欄の値: "g:グループの key"（そのグループの、選んだ期間に記事があるブログ全部）か "b:ブログの ID"（1つだけ）。探す対象をグループの形で返す
export function blogChoiceTarget(choice: string, period: SearchPeriod | null = null): OfficialBlogGroup {
  if (choice.startsWith("b:")) {
    const id = choice.slice(2);
    const group = OFFICIAL_BLOGS.find((g) => g.ids.includes(id));
    if (group) return { key: group.key, label: `${group.label} ${blogLabel(id)}`, ids: [id] };
  }
  const key = choice.startsWith("g:") ? choice.slice(2) : choice;
  const group = OFFICIAL_BLOGS.find((g) => g.key === key) ?? OFFICIAL_BLOGS[0];
  const ids = blogsInPeriod(group, period);
  return { ...group, ids: ids.length > 0 ? ids : group.ids };
}

// 選択欄に並べる物（選んだ期間に記事があるブログだけ）。複数あるグループは「〇〇（全部）」と各ブログ、1つだけならその1つ
export interface BlogOption {
  value: string;
  label: string;
}
export interface BlogOptionGroup {
  label: string | null; // null は見出し（optgroup）なし
  options: BlogOption[];
}
export function blogOptions(period: SearchPeriod | null): BlogOptionGroup[] {
  const out: BlogOptionGroup[] = [];
  for (const g of OFFICIAL_BLOGS) {
    const ids = blogsInPeriod(g, period);
    if (ids.length === 0) continue;
    if (ids.length === 1) {
      out.push({ label: null, options: [g.ids.length === 1 ? { value: `g:${g.key}`, label: g.label } : { value: `b:${ids[0]}`, label: `${g.label} ${blogLabel(ids[0])}` }] });
    } else {
      out.push({ label: g.label, options: [{ value: `g:${g.key}`, label: `${g.label}（全部）` }, ...ids.map((id) => ({ value: `b:${id}`, label: blogLabel(id) }))] });
    }
  }
  return out;
}

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
