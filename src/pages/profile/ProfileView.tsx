import { Link } from "react-router-dom";
import type { ProfileData } from "@/types/profile";
import TemplateA from "@/pages/profile/components/TemplateA";
import TemplateB from "@/pages/profile/components/TemplateB";
import TemplateC from "@/pages/profile/components/TemplateC";

export default function ProfileView({ data, template }: { data: ProfileData; template?: string }) {
  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", padding: "0 1rem", fontFamily: "'Zen Maru Gothic',sans-serif" }}>
      <div style={{ textAlign: "center", marginBottom: "1rem" }}>
        <div style={{ fontSize: "1rem", fontWeight: 800, background: "linear-gradient(135deg,#E5457D,#ba3cb8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          ハロプロ プロフィール帳メーカー
        </div>
      </div>
      {template === "B" ? (
        <TemplateB data={data} />
      ) : template === "C" ? (
        <TemplateC data={data} />
      ) : (
        <TemplateA data={data} />
      )}
      <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
        <Link
          to="/profile"
          style={{ fontSize: "0.875rem", color: "#E5457D", fontWeight: 700, textDecoration: "none" }}
        >
          あなたも作ってみる →
        </Link>
      </div>
    </div>
  );
}
