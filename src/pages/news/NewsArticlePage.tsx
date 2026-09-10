// お知らせ1件（/news/<記事のid>）。中身は src/data/news.json。
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { findNews, formatDate } from "./news";
import { s, quote, LIST_CSS } from "./style";

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

  const { evidence, verification, changelog } = item;

  return (
    <div style={s.wrap}>
      <style>{LIST_CSS}</style>
      <Link to="/news" style={s.back}>← お知らせ一覧へ戻る</Link>

      <p style={{ ...s.meta, margin: "0 0 0.5rem" }}>{formatDate(item.date)}</p>
      <h1 style={s.header}>{item.title}</h1>

      {/* 本文はもらった文章のまま出す。改行も原文どおり */}
      <div style={{ whiteSpace: "pre-wrap", margin: "1.5rem 0 0", overflowWrap: "anywhere" }}>
        {item.body}
      </div>

      {evidence && (
        <>
          <h2 style={s.h2}>{evidence.heading}</h2>
          {/* 原文をそのまま。訳と混ざらないよう枠で分ける */}
          <p style={quote} lang="en">{evidence.quote}</p>
          <p style={s.p}>{evidence.translation}</p>
          <p style={s.note}>
            <a
              href={evidence.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#E5457D", overflowWrap: "anywhere" }}
            >
              {evidence.sourceLabel}
            </a>
          </p>
        </>
      )}

      {verification && (
        <>
          <h2 style={s.h2}>{verification.heading}</h2>
          <table className="news-check">
            <thead>
              <tr>
                <th>動画</th>
                <th>始め方</th>
                <th>押す前</th>
                <th>押した後</th>
              </tr>
            </thead>
            <tbody>
              {verification.rows.map((r) => (
                <tr key={r.video}>
                  <td>{r.video}</td>
                  <td data-label="始め方">{r.start}</td>
                  <td data-label="押す前">{r.before}</td>
                  <td data-label="押した後">{r.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={s.note}>{verification.note}</p>
        </>
      )}

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
