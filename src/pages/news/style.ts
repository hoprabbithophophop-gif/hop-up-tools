// お知らせの見た目。利用規約・プライバシーポリシーと同じ作りに揃えてある
// （読み物の幅640px・Inter/Noto Sans JP・行間1.8・見出しは桃色から紫への渡し）。
import type { CSSProperties } from "react";
import type { NewsType } from "./news";

export const s = {
  wrap: {
    maxWidth: 640,
    margin: "2rem auto",
    padding: "0 1.25rem 4rem",
    fontFamily: "'Inter','Noto Sans JP',sans-serif",
    fontSize: "0.875rem",
    lineHeight: 1.8,
    color: "#333",
  } as CSSProperties,
  header: {
    fontSize: "1.25rem",
    fontWeight: 800,
    background: "linear-gradient(135deg,#E5457D,#ba3cb8)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    marginBottom: "0.25rem",
  } as CSSProperties,
  back: {
    display: "inline-block",
    fontSize: "0.8rem",
    color: "#E5457D",
    textDecoration: "none",
    marginBottom: "1.5rem",
  } as CSSProperties,
  meta: {
    fontSize: "0.78rem",
    color: "#999",
  } as CSSProperties,
  h2: {
    fontSize: "1rem",
    fontWeight: 700,
    marginTop: "2.5rem",
    marginBottom: "0.5rem",
    borderBottom: "2px solid #f0f0f0",
    paddingBottom: "0.25rem",
  } as CSSProperties,
  h3: {
    fontSize: "0.875rem",
    fontWeight: 700,
    marginTop: "1.5rem",
    marginBottom: "0.5rem",
    color: "#555",
  } as CSSProperties,
  p: {
    margin: "0 0 0.75rem",
  } as CSSProperties,
  note: {
    fontSize: "0.8125rem",
    color: "#777",
    margin: "0 0 0.75rem",
  } as CSSProperties,
};

/** 種別の色。桃色と紫はサイトの他の場所と同じ2色を使う */
export function typeStyle(type: NewsType): CSSProperties {
  const color =
    type === "不具合" ? "#E5457D" : type === "更新" ? "#ba3cb8" : "#777";
  return {
    display: "inline-block",
    fontSize: "0.6875rem",
    fontWeight: 700,
    letterSpacing: "0.04em",
    color,
    border: `1px solid ${color}`,
    borderRadius: 2,
    padding: "0.1rem 0.45rem",
    lineHeight: 1.6,
    whiteSpace: "nowrap",
  };
}

/** 一覧の表。狭い画面では表の形をやめて、1件ずつの積み重ねに変える＝横にはみ出さない */
export const TABLE_CSS = `
.news-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; margin: 0 0 1rem; }
.news-table th, .news-table td { text-align: left; vertical-align: top; padding: 0.55rem 0.6rem; border-bottom: 1px solid #eee; }
.news-table th { font-weight: 700; color: #555; background: #fafafa; white-space: nowrap; }
.news-table td .news-path { color: #999; font-size: 0.75rem; display: block; }
@media (min-width: 561px) {
  /* 右の2列は短い言葉しか入らないので折り返さない。折れると「数えられませ／ん」のように見える */
  .news-table th:nth-child(3), .news-table td:nth-child(3),
  .news-table th:nth-child(4), .news-table td:nth-child(4) { white-space: nowrap; }
  .news-table th:nth-child(1), .news-table td:nth-child(1) { width: 42%; }
}
@media (max-width: 560px) {
  .news-table, .news-table tbody, .news-table tr, .news-table td { display: block; width: 100%; }
  .news-table thead { display: none; }
  .news-table tr { border: 1px solid #eee; padding: 0.6rem 0.75rem; margin-bottom: 0.6rem; }
  .news-table td { border: 0; padding: 0.15rem 0; }
  .news-table td::before { content: attr(data-label) "："; color: #999; font-size: 0.75rem; }
  .news-table td.news-name::before { content: ""; }
  .news-table td.news-name { font-weight: 700; padding-bottom: 0.3rem; }
}
.news-row { display: block; text-decoration: none; color: inherit; padding: 1rem 0; border-bottom: 1px solid #eee; }
.news-row:hover .news-title { color: #E5457D; }
.news-title { font-size: 0.9375rem; font-weight: 700; margin: 0.35rem 0 0; line-height: 1.6; }
`;
