import { Link } from "react-router-dom";

export default function TopPage() {
  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", padding: "0 1rem", fontFamily: "'Zen Maru Gothic',sans-serif", textAlign: "center" }}>
      <div style={{ fontSize: "1.4rem", fontWeight: 800, background: "linear-gradient(135deg,#E5457D,#ba3cb8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: "1.5rem" }}>
        hop-up-tools
      </div>
      <div style={{ fontSize: "0.875rem", color: "#999", marginBottom: "1.5rem" }}>
        ハロプロファン向けツール集
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Link to="/profile" style={{ padding: ".75rem 1.5rem", background: "#E5457D", color: "#fff", borderRadius: 12, textDecoration: "none", fontWeight: 700, fontSize: "0.875rem" }}>
          🎤 ハロプロ プロフ帳メーカー
        </Link>
      </div>
    </div>
  );
}
