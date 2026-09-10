// お知らせ1件（/news/<記事のid>）。中身は src/data/news.json。
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { findNews, formatDate } from "./news";
import { s } from "./style";

export default function NewsArticlePage() {
  const { id } = useParams();
  const item = findNews(id);

  useEffect(() => {
    document.title = item ? `${item.title} | お知らせ | hop-up-tools` : "お知らせ | hop-up-tools";
  }, [item]);

  if (!item) {
    return (
      <div style={s.wrap}>
        <Link to="/news" style={s.back}>← お知らせ一覧へ戻る</Link>
        <h1 style={s.header}>お知らせ</h1>
        <p style={s.p}>このお知らせは見つかりませんでした。</p>
      </div>
    );
  }

  const { changelog } = item;

  return (
    <div style={s.wrap}>
      <Link to="/news" style={s.back}>← お知らせ一覧へ戻る</Link>

      <p style={{ ...s.meta, margin: "0 0 0.5rem" }}>{formatDate(item.date)}</p>
      <h1 style={s.header}>{item.title}</h1>

      {/* 本文はもらった文章のまま出す。改行も原文どおり */}
      <div style={{ whiteSpace: "pre-wrap", margin: "1.5rem 0 0", overflowWrap: "anywhere" }}>
        {item.body}
      </div>

      {changelog && (
        <>
          <h2 style={s.h2}>{changelog.heading}</h2>
          {changelog.entries.length === 0 ? (
            <p style={s.note}>{changelog.empty}</p>
          ) : (
            <ul style={{ paddingLeft: "1.25rem", margin: 0 }}>
              {changelog.entries.map((e) => (
                <li key={e.date + e.text} style={{ marginBottom: "0.4rem" }}>
                  <span style={s.meta}>{formatDate(e.date)}</span>　{e.text}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
