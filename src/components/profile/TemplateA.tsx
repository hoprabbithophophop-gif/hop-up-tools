import { HELLO_GROUPS } from "@/data/groups";
import type { ProfileData } from "@/types/profile";
import { dc } from "@/lib/colorUtils";
import BrainPreview from "./BrainPreview";

interface TemplateAProps {
  data: ProfileData;
}

export default function TemplateA({ data }: TemplateAProps) {
  const gc = data.groups?.map((g) => HELLO_GROUPS.find((h) => h.name === g)?.color) ?? [];
  const c1 = gc[0] || "#ba3cb8";

  return (
    <div style={{
      width: "100%", aspectRatio: "3/4",
      background: "linear-gradient(170deg,#fdfbff,#f4f0fa 40%,#faf8ff)",
      borderRadius: 14, overflow: "hidden", position: "relative",
      fontFamily: "'Zen Maru Gothic',sans-serif",
      boxShadow: "0 3px 18px rgba(0,0,0,.07)",
      display: "flex", flexDirection: "column",
    }}>
      {/* ヘッダー: 固定高さをやめてコンテンツに合わせる */}
      <div style={{ display: "flex", flexShrink: 0, padding: ".4rem .4rem .2rem", minHeight: "28%" }}>
        <div style={{ flex: "0 0 42%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "visible" }}>
          <BrainPreview members={data.oshiMembers} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: ".2rem .5rem .2rem 0", gap: ".25rem" }}>
          <div style={{ fontSize: "0.7rem", color: "#bbb", letterSpacing: ".1em" }}>NAME</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#2a2a3e", borderBottom: `2px solid ${c1}`, paddingBottom: 1, display: "inline-block" }}>
            {data.name || "なまえ"}
          </div>
          {data.groups?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {data.groups.map((g, i) => {
                const c = HELLO_GROUPS.find((h) => h.name === g)?.color || c1;
                return (
                  <div key={i} style={{ background: c, color: "#fff", padding: ".1rem .4rem", borderRadius: 10, fontSize: "0.75rem", fontWeight: 700 }}>
                    {g}
                  </div>
                );
              })}
            </div>
          )}
          {data.oshiMembers?.filter((m) => (m.percent || 0) > 0).length > 0 && (
            <div style={{ fontSize: "0.75rem", color: "#999", lineHeight: 1.5 }}>
              {data.oshiMembers.filter((m) => (m.percent || 0) > 0).map((m, i) => (
                <span key={i}>
                  {i > 0 && " / "}
                  <span style={{ color: dc(m.color), fontWeight: 700 }}>{m.callName || m.name}</span>
                  <span style={{ opacity: 0.5 }}> {m.percent}%</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{
        flex: 1, borderTop: "1px solid #ece4f6", padding: ".6rem .7rem",
        background: "#faf8ff", display: "flex", flexWrap: "wrap",
        gap: ".35rem", alignContent: "flex-start", overflowY: "auto",
      }}>
        {data.freeItems?.filter((f) => f.values?.some((v) => v)).map((it, i) => (
          <div key={i} style={{ background: "#f4f0fa", borderRadius: 8, padding: ".4rem .7rem", border: "1px solid #e8e0f2", fontSize: "0.875rem", lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, color: "#8a7aaa", marginBottom: 2, fontSize: "0.8rem" }}>{it.label}</div>
            {it.values.filter((v) => v).map((v, j) => (
              <div key={j} style={{ color: "#444" }}>
                {it.ranked && <span style={{ color: c1, fontWeight: 700 }}>{j + 1}. </span>}
                {v}
              </div>
            ))}
          </div>
        ))}
        {(!data.freeItems || !data.freeItems.some((f) => f.values?.some((v) => v))) && (
          <div style={{ fontSize: "0.875rem", color: "#ccc", fontStyle: "italic", width: "100%", textAlign: "center", marginTop: "2rem" }}>
            自由項目を追加してね
          </div>
        )}
      </div>
      <div style={{ position: "absolute", bottom: 4, right: 8, fontSize: "0.7rem", color: "#ddd", letterSpacing: ".08em" }}>
        ハロプロファンサイト
      </div>
    </div>
  );
}
