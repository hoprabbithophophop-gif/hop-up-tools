import { useEffect } from "react";
import { Link } from "react-router-dom";
import HandIcon from "./hi-tension/components/HandIcon";
import FaIcon from "./hi-tension/components/FaIcon";
import { faBullhorn } from "@fortawesome/free-solid-svg-icons";

const TOOLS: { to: string; num: string; section: string; title: string; desc: string; wip?: boolean }[] = [
  {
    to:      "/fc-ticket",
    num:     "01",
    section: "FC TICKET",
    title:   "FC 締切リマインダー",
    desc:    "申込・入金締切をカレンダーに追加",
  },
  {
    to:      "/youtube",
    num:     "02",
    section: "YOUTUBE",
    title:   "HELLO! VIDEO",
    desc:    "公式 MV・ライブ・バラエティを検索",
  },
  {
    to:      "/the-ballad",
    num:     "03",
    section: "THE BALLAD",
    title:   "The Balladデータベース",
    desc:    "2020 The Ballad 公演の歌唱曲・歌唱者・公式映像を検索",
  },
];

export default function TopPage() {
  useEffect(() => { document.title = "hop-up-tools"; }, []);
  // 「どの公演のふるさと？」全問正解を localStorage に記録済みなら、The Ballad カードを特別表示にする
  const balladCleared = (() => { try { return localStorage.getItem("the-ballad.furusato-cleared") === "1"; } catch { return false; } })();

  return (
    <div style={{ background: "#f8f9fa", minHeight: "100vh", fontFamily: "Inter, 'Noto Sans JP', sans-serif", color: "#191c1d" }}>

      {/* ヘッダー */}
      <header style={{ padding: "3rem 2rem 2.4rem" }}>
        <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#777", margin: "0 0 0.5rem" }}>
          Fan Tools
        </p>
        <h1 style={{ fontSize: "3.5rem", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, color: "#000", margin: 0 }}>
          HOP-UP<br />TOOLS
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#585f6c", margin: "1rem 0 0", lineHeight: 1.4 }}>
          Hello! Project ファン向けツール集
        </p>
      </header>

      {/* ツールリスト */}
      <main style={{ maxWidth: 640 }}>
        <p style={{ padding: "0 2rem", fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#777", margin: "0 0 0.8rem" }}>
          Tools
        </p>

        {TOOLS.map((t) =>
          t.wip ? (
            <div key={t.to} style={{ opacity: 0.4, cursor: "not-allowed" }}>
              <ToolRow {...t} wip />
            </div>
          ) : (
            <Link key={t.to} to={t.to} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
              <ToolRow {...t} shine={balladCleared && t.to === "/the-ballad"} />
            </Link>
          )
        )}
      </main>

      <div style={{ display: "flex", justifyContent: "center", gap: "1.5rem", padding: "1.6rem 0 0.4rem" }}>
        <Link
          to="/hi-tension"
          aria-label="ハイ！テンション Practice"
          style={{ display: "inline-flex", padding: "0.8rem", textDecoration: "none" }}
        >
          <HandIcon size={36} color="#191c1d" />
        </Link>
        <Link
          to="/arigato-beat"
          aria-label="ありがとビート"
          style={{ display: "inline-flex", padding: "0.8rem", textDecoration: "none" }}
        >
          <FaIcon icon={faBullhorn} size={36} color="#191c1d" />
        </Link>
      </div>

      {/* フッター */}
      <footer style={{ padding: "3rem 2rem", marginTop: "3rem", borderTop: "1px solid rgba(198,198,198,0.2)" }}>
        <p style={{ fontSize: "0.625rem", color: "#c6c6c6", margin: "0 0 1rem" }}>
          非公式ファンツール。株式会社アップフロントワークスとは無関係です。
        </p>
        <div style={{ display: "flex", gap: "1.5rem" }}>
          <Link to="/privacy"     style={{ color: "#777", textDecoration: "none", fontSize: "0.6875rem" }}>プライバシーポリシー</Link>
          <Link to="/terms"       style={{ color: "#777", textDecoration: "none", fontSize: "0.6875rem" }}>利用規約</Link>
          <a href="https://x.com/hop_rabbit_hop" target="_blank" rel="noopener noreferrer"
             style={{ color: "#777", textDecoration: "none", fontSize: "0.6875rem" }}>お問い合わせ</a>
        </div>
        <p style={{ fontSize: "0.625rem", color: "#c6c6c6", margin: "1.2rem 0 0" }}>
          Hand icon by Font Awesome (CC BY 4.0)
        </p>
      </footer>

    </div>
  );
}

function ToolRow({ num, section, title, desc, wip, shine }: { num: string; section: string; title: string; desc: string; wip?: boolean; shine?: boolean }) {
  return (
    <div
      className="group"
      style={{
        display: "grid",
        gridTemplateColumns: "2.8rem 1fr 1.5rem",
        gap: "0 1rem",
        padding: "1.4rem 2rem",
        background: "#ffffff",
        marginBottom: 2,
        cursor: "pointer",
        transition: "background 0.12s",
        position: "relative",
        overflow: "hidden",
      }}
      // Tailwind group-hover は Link 親に付けられないので CSS-in-JS で代替
      onMouseEnter={(e) => { if (!wip) e.currentTarget.style.background = "#f3f4f5"; }}
      onMouseLeave={(e) => { if (!wip) e.currentTarget.style.background = "#ffffff"; }}
    >
      {/* クリア済みの光沢: 数秒ごとに白い光沢が横切る（何度も見に来たくなるご褒美演出。DESIGN.md準拠でモノクロ） */}
      {shine && (
        <>
          <style>{`@keyframes tb-card-shine { 0% { transform: translateX(-140%) skewX(-16deg); } 55%, 100% { transform: translateX(360%) skewX(-16deg); } }`}</style>
          <span aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "45%", background: "linear-gradient(105deg, transparent 20%, rgba(255,255,255,0.95) 48%, rgba(206,210,216,0.45) 56%, transparent 82%)", animation: "tb-card-shine 4.5s ease-in-out infinite", pointerEvents: "none", zIndex: 2 }} />
        </>
      )}

      {/* インデックス番号 */}
      <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#c6c6c6", paddingTop: "0.15rem", letterSpacing: "0.05em" }}>
        {num}
      </div>

      {/* テキスト */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#777", margin: 0 }}>
            {section}
          </p>
          {wip && (
            <span style={{ fontSize: "0.5625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#777", border: "1px solid #c6c6c6", padding: "0 0.3rem", lineHeight: "1.6" }}>
              準備中
            </span>
          )}
        </div>
        <p style={{ fontSize: "1rem", fontWeight: 700, letterSpacing: "-0.02em", margin: "0.2rem 0 0.3rem", color: "#000" }}>
          {title}
        </p>
        <p style={{ fontSize: "0.75rem", color: "#585f6c", margin: 0, lineHeight: 1.4 }}>
          {desc}
        </p>
      </div>

      {/* 矢印 */}
      <div style={{ display: "flex", alignItems: "center", color: "#c6c6c6", fontSize: "0.875rem" }}>
        →
      </div>
    </div>
  );
}
