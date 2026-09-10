// お知らせの見た目。トップページと同じ灰色だけの配色に揃えてある
// （地 #f8f9fa・文字 #191c1d・薄い文字 #777 / #c6c6c6）。
// 利用規約とプライバシーポリシーは桃色から紫への渡しを使っているが、
// あれは作り替える前の配色なので真似しない（Hop指摘 2026-09-10）。
import type { CSSProperties } from "react";

export const s = {
  wrap: {
    maxWidth: 640,
    margin: "0 auto",
    padding: "2rem 1.25rem 4rem",
    fontFamily: "'Inter','Noto Sans JP',sans-serif",
    fontSize: "0.875rem",
    lineHeight: 1.8,
    color: "#191c1d",
  } as CSSProperties,
  header: {
    fontSize: "1.25rem",
    fontWeight: 800,
    letterSpacing: "-0.01em",
    color: "#191c1d",
    margin: "0 0 0.25rem",
  } as CSSProperties,
  back: {
    display: "inline-block",
    fontSize: "0.75rem",
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "#777",
    textDecoration: "none",
    marginBottom: "1.5rem",
  } as CSSProperties,
  meta: {
    fontSize: "0.75rem",
    color: "#9a9ea1",
    letterSpacing: "0.03em",
  } as CSSProperties,
  h2: {
    fontSize: "0.9375rem",
    fontWeight: 700,
    marginTop: "2.5rem",
    marginBottom: "0.5rem",
    paddingBottom: "0.35rem",
    borderBottom: "1px solid #e3e5e6",
    color: "#191c1d",
  } as CSSProperties,
  p: {
    margin: "0 0 0.75rem",
  } as CSSProperties,
  note: {
    fontSize: "0.8125rem",
    color: "#777",
    margin: "0 0 0.75rem",
  } as CSSProperties,
  link: {
    color: "#191c1d",
    textDecoration: "underline",
    textUnderlineOffset: "0.2rem",
    overflowWrap: "anywhere" as const,
  } as CSSProperties,
};

/** 引用（原文）の枠 */
export const quote = {
  margin: "0 0 0.75rem",
  padding: "0.75rem 0.9rem",
  background: "#ffffff",
  borderLeft: "3px solid #191c1d",
  fontSize: "0.8125rem",
  lineHeight: 1.7,
  color: "#3a3d3f",
  overflowWrap: "anywhere" as const,
};

/** 一覧の1件ぶん。押せる範囲を行ぜんたいに広げる */
export const LIST_CSS = `
.news-row { display: block; text-decoration: none; color: inherit; padding: 1rem 0; border-bottom: 1px solid #e3e5e6; }
.news-row:hover { background: #f3f4f5; }
.news-title { font-size: 0.9375rem; font-weight: 700; margin: 0.35rem 0 0; line-height: 1.6; color: #191c1d; }
`;
