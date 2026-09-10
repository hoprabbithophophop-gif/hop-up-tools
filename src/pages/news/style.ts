// お知らせの見た目。利用規約・プライバシーポリシーと同じ作りに揃えてある
// （読み物の幅640px・Inter/Noto Sans JP・行間1.8・見出しは桃色から紫への渡し）。
import type { CSSProperties } from "react";

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
  p: {
    margin: "0 0 0.75rem",
  } as CSSProperties,
  note: {
    fontSize: "0.8125rem",
    color: "#777",
    margin: "0 0 0.75rem",
  } as CSSProperties,
};

/** 一覧の1件ぶん。押せる範囲を行ぜんたいに広げる */
export const LIST_CSS = `
.news-row { display: block; text-decoration: none; color: inherit; padding: 1rem 0; border-bottom: 1px solid #eee; }
.news-row:hover .news-title { color: #E5457D; }
.news-title { font-size: 0.9375rem; font-weight: 700; margin: 0.35rem 0 0; line-height: 1.6; }
`;
