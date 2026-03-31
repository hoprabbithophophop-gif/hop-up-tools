import { Link } from "react-router-dom";

export default function TopPage() {
  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", padding: "0 1rem", fontFamily: "'Inter','Noto Sans JP',sans-serif", textAlign: "center" }}>
      <div style={{ fontSize: "1.4rem", fontWeight: 800, background: "linear-gradient(135deg,#E5457D,#ba3cb8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: "1.5rem" }}>
        hop-up-tools
      </div>
      <div style={{ fontSize: "0.875rem", color: "#999", marginBottom: "1.5rem" }}>
        ハロプロファン向けツール集
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Link to="/profile" style={{ padding: ".75rem 1.5rem", background: "#E5457D", color: "#fff", borderRadius: 12, textDecoration: "none", fontWeight: 700, fontSize: "0.875rem" }}>
          🎤 ハロプロ プロフィール帳メーカー
        </Link>
        <Link to="/fc-ticket" style={{ padding: ".75rem 1.5rem", background: "#ba3cb8", color: "#fff", borderRadius: 12, textDecoration: "none", fontWeight: 700, fontSize: "0.875rem" }}>
          📅 FC締切リマインダー
        </Link>
        <Link to="/youtube" style={{ padding: ".75rem 1.5rem", background: "#ff4e4e", color: "#fff", borderRadius: 12, textDecoration: "none", fontWeight: 700, fontSize: "0.875rem" }}>
          ▶ ハロプロ YouTube
        </Link>
      </div>
      <div style={{ marginTop: "3rem", fontSize: "0.75rem", color: "#bbb", display: "flex", justifyContent: "center", gap: "1.5rem" }}>
        <Link to="/privacy" style={{ color: "#bbb", textDecoration: "none" }}>プライバシーポリシー</Link>
        <Link to="/terms" style={{ color: "#bbb", textDecoration: "none" }}>利用規約</Link>
        <a href="https://x.com/hop_rabbit_hop" target="_blank" rel="noopener noreferrer" style={{ color: "#bbb", textDecoration: "none" }}>お問い合わせ</a>
      </div>
      <div style={{ marginTop: "0.5rem", fontSize: "0.7rem", color: "#ddd" }}>
        非公式ファンツール・株式会社アップフロントワークスとは無関係
      </div>
    </div>
  );
}
