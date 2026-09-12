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
      <div style={{ background: "#f8f9fa", minHeight: "100vh" }}><div style={s.wrap}>
        <Link to="/news" style={s.back}>← お知らせ一覧へ戻る</Link>
        <h1 style={s.header}>お知らせ</h1>
        <p style={s.p}>このお知らせは見つかりませんでした。</p>
      </div></div>
    );
  }

  const { bodyAfter, evidence, verification, changelog } = item;

  return (
    <div style={{ background: "#f8f9fa", minHeight: "100vh" }}><div style={s.wrap}>
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
              style={s.link}
            >
              {evidence.sourceLabel}
            </a>
          </p>
        </>
      )}

      {verification && (
        <>
          <h2 style={s.h2}>{verification.heading}</h2>
          <p style={s.p}>{verification.lead}</p>
          {verification.images.map((im) => (
            <figure key={im.src} style={{ margin: "0 0 1.25rem" }}>
              <img
                src={im.src}
                alt={im.alt}
                loading="lazy"
                style={{ display: "block", width: "100%", height: "auto", border: "1px solid #eee" }}
              />
              <figcaption style={{ ...s.note, margin: "0.4rem 0 0" }}>{im.caption}</figcaption>
            </figure>
          ))}
          <p style={s.note}>{verification.note}</p>
        </>
      )}

      {/* 本文の残り。根拠と検証を読んでから続きに戻る */}
      {bodyAfter && (
        <div style={{ whiteSpace: "pre-wrap", margin: "2.5rem 0 0", overflowWrap: "anywhere" }}>
          {bodyAfter}
        </div>
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
    </div></div>
  );
}
