// お知らせ1件（/news/<記事のid>）。中身は src/data/news.json。
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { findNews, formatDate, type StatusRow } from "./news";
import { s, typeStyle, TABLE_CSS } from "./style";

/** 「対象と現状」の表。狭い画面では style.ts の指定で1件ずつの積み重ねに変わる */
function StatusTable({ rows }: { rows: StatusRow[] }) {
  if (rows.length === 0) return <p style={s.note}>該当なし</p>;
  return (
    <table className="news-table">
      <thead>
        <tr>
          <th>ツール</th>
          <th>再生の始め方</th>
          <th>再生回数</th>
          <th>状況</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.tool + r.path + r.start}>
            <td className="news-name" data-label="ツール">
              {r.tool}
              <span className="news-path">{r.path}</span>
            </td>
            <td data-label="再生の始め方">{r.start}</td>
            <td data-label="再生回数">{r.counted}</td>
            <td data-label="状況">{r.state}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

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

  const { status, changelog } = item;

  return (
    <div style={s.wrap}>
      <style>{TABLE_CSS}</style>
      <Link to="/news" style={s.back}>← お知らせ一覧へ戻る</Link>

      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.5rem" }}>
        <span style={s.meta}>{formatDate(item.date)}</span>
        <span style={typeStyle(item.type)}>{item.type}</span>
      </div>
      <h1 style={s.header}>{item.title}</h1>

      {/* 本文はもらった文章のまま出す。改行も原文どおり */}
      <div style={{ whiteSpace: "pre-wrap", margin: "1.5rem 0 0", overflowWrap: "anywhere" }}>
        {item.body}
      </div>

      {status && (
        <>
          <h2 style={s.h2}>{status.heading}</h2>
          <p style={s.p}>{status.lead}</p>

          <h3 style={s.h3}>{status.confirmedHeading}</h3>
          <StatusTable rows={status.confirmed} />

          <h3 style={s.h3}>{status.unconfirmedHeading}</h3>
          <p style={s.note}>{status.unconfirmedNote}</p>
          <StatusTable rows={status.unconfirmed} />
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
