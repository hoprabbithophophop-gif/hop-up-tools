"use client";

import type { ProfileData } from "@/types/profile";
import TemplateA from "@/components/profile/TemplateA";
import TemplateB from "@/components/profile/TemplateB";
import TemplateC from "@/components/profile/TemplateC";

export default function ProfileView({ data, template }: { data: ProfileData; template?: string }) {
  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", padding: "0 1rem", fontFamily: "'Zen Maru Gothic',sans-serif" }}>
      <div style={{ textAlign: "center", marginBottom: "1rem" }}>
        <div style={{ fontSize: "1rem", fontWeight: 800, background: "linear-gradient(135deg,#E5457D,#ba3cb8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          ハロプロ プロフ帳メーカー
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
        <a
          href="/"
          style={{ fontSize: "0.875rem", color: "#E5457D", fontWeight: 700, textDecoration: "none" }}
        >
          あなたも作ってみる →
        </a>
      </div>
    </div>
  );
}
