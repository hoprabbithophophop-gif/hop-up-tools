// お知らせの一覧（/news）。中身は src/data/news.json。
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { NEWS, formatDate } from "./news";
import { s, LIST_CSS } from "./style";

export default function NewsListPage() {
  useEffect(() => {
    document.title = "お知らせ | hop-up-tools";
  }, []);

  return (
    <div style={{ background: "#f8f9fa", minHeight: "100vh" }}><div style={s.wrap}>
      <style>{LIST_CSS}</style>
      <Link to="/" style={s.back}>← トップへ戻る</Link>
      <h1 style={s.header}>お知らせ</h1>

      {NEWS.length === 0 ? (
        <p style={s.note}>まだお知らせはありません。</p>
      ) : (
        <div style={{ marginTop: "1.5rem" }}>
          {NEWS.map((n) => (
            <Link key={n.id} to={`/news/${n.id}`} className="news-row">
              <span style={s.meta}>{formatDate(n.date)}</span>
              <p className="news-title">{n.title}</p>
            </Link>
          ))}
        </div>
      )}
    </div></div>
  );
}
