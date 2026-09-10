// お知らせの中身の受け取り口。
//
// 本文はサイトのソースの中に置いた1つのファイル（src/data/news.json）に持つ。
// データベースは使わない＝お知らせを1件足すのは、そのファイルに1件書き足すだけで済む。
//
// 1件に必ず要るのは4つ。日付・タイトル・本文・種別。
// 「対象と現状」の一覧と「更新履歴」は、その回にだけ付ける任意の欄で、無くても出せる。
import raw from "@/data/news.json";

/** お知らせの種別。表示の色分けにも使う */
export type NewsType = "お知らせ" | "不具合" | "更新";

/** 「対象と現状」の1行 */
export type StatusRow = {
  /** ツールの名前 */
  tool: string;
  /** サイトの中の場所（/youtube など） */
  path: string;
  /** 再生の始め方 */
  start: string;
  /** 再生回数に数えられるか */
  counted: string;
  /** 状況（対応予定／確認中／対応済み） */
  state: string;
};

export type NewsItem = {
  /** 記事の住所に使う名前（/news/<id>） */
  id: string;
  /** 日付。YYYY-MM-DD */
  date: string;
  type: NewsType;
  title: string;
  /** 本文。改行はそのまま出す */
  body: string;
  /** 任意。「対象と現状」の一覧 */
  status?: {
    heading: string;
    lead: string;
    confirmedHeading: string;
    confirmed: StatusRow[];
    unconfirmedHeading: string;
    unconfirmedNote: string;
    unconfirmed: StatusRow[];
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
