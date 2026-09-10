// お知らせの中身の受け取り口。
//
// 本文はサイトのソースの中に置いた1つのファイル（src/data/news.json）に持つ。
// データベースは使わない＝お知らせを1件足すのは、そのファイルに1件書き足すだけで済む。
//
// 1件に要るのは3つ。日付・タイトル・本文。
// 「根拠」「検証」「更新履歴」は、その回にだけ付ける任意の欄で、無くても出せる。
import raw from "@/data/news.json";

export type NewsItem = {
  /** 記事の住所に使う名前（/news/<id>） */
  id: string;
  /** 日付。YYYY-MM-DD */
  date: string;
  title: string;
  /** 本文。改行はそのまま出す */
  body: string;
  /** 任意。「根拠」。公式の文の原文・和訳・出どころへのリンク */
  evidence?: {
    heading: string;
    quote: string;
    translation: string;
    sourceLabel: string;
    sourceUrl: string;
  };
  /** 任意。「検証」。実際に試した結果の表 */
  verification?: {
    heading: string;
    rows: { video: string; start: string; before: string; after: string }[];
    /** 表の下に置く但し書き */
    note: string;
  };
  /** 任意。「更新履歴」 */
  changelog?: {
    heading: string;
    /** まだ何も無い時に出す一行 */
    empty: string;
    entries: { date: string; text: string }[];
  };
};

/** 新しいものが先。同じ日付なら、ファイルに書いた順のまま */
export const NEWS: NewsItem[] = (raw as NewsItem[])
  .slice()
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

export function findNews(id: string | undefined): NewsItem | null {
  if (!id) return null;
  return NEWS.find((n) => n.id === id) ?? null;
}

/** 2026-09-10 → 2026年9月10日 */
export function formatDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}
