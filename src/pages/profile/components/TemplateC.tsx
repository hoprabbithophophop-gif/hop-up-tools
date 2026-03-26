import { HELLO_GROUPS } from "@/data/groups";
import type { ProfileData } from "@/types/profile";
import { dc } from "@/lib/colorUtils";
import BrainPreview from "./BrainPreview";

interface TemplateCProps {
  data: ProfileData;
}

export default function TemplateC({ data }: TemplateCProps) {
  const gc = data.groups?.map((g) => HELLO_GROUPS.find((h) => h.name === g)?.color) ?? [];
  const c1 = gc[0] || "#E5457D";
  const first = data.oshiMembers?.[0];

  const hasFreeItems = data.freeItems?.some(f => f.values?.some(v => v));

  return (
    <div style={{
      width: "100%", aspectRatio: hasFreeItems ? "3/4" : "4/3",
      borderRadius: 14, overflow: "hidden", position: "relative",
      fontFamily: "'Zen Maru Gothic',sans-serif",
      boxShadow: "0 3px 18px rgba(0,0,0,.07)",
      display: "flex", flexDirection: "column",
    }}>
      {/* 上段: 左右分割 */}
      <div style={{ display: "flex", flex: "0 0 auto" }}>

        {/* 左: 推し脳マップ */}
        <div style={{
          flex: "0 0 42%",
          background: "linear-gradient(170deg,#fdfbff,#f4f0fa 40%,#faf8ff)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: ".5rem", borderRight: "1px solid #ece4f6",
        }}>
          <BrainPreview members={data.oshiMembers} />
        </div>

        {/* 右: 挨拶・名前・グループ・推しメン */}
        <div style={{
          flex: 1, background: "#fffbf7",
          display: "flex", flexDirection: "column", justifyContent: "center",
          padding: ".6rem .8rem", gap: ".3rem", position: "relative",
        }}>
          {/* ドット装飾 */}
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{
              position: "absolute",
              right: `${8 + (i % 3) * 22}%`,
              top: `${10 + Math.floor(i / 3) * 45}%`,
              width: 4, height: 4, borderRadius: "50%",
              background: `${c1}${20 + i * 10}`,
            }} />
          ))}

          {/* 挨拶 + 名前 */}
          <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#5a4a3a", lineHeight: 1.7, zIndex: 1 }}>
            <span style={{ color: c1, fontSize: "0.8rem" }}>♪</span>{" "}
            {data.greeting || "こんにちは！"}{" "}
            <span style={{ fontWeight: 800, color: "#2a2a3e" }}>{data.pronoun || "わたし"}は</span>
            <span style={{
              borderBottom: `2px solid ${c1}`, padding: "0 .12rem",
              fontWeight: 900, color: "#2a2a3e", fontSize: "1rem",
            }}>
              {data.name || "＿＿＿"}
            </span>
            <span style={{ fontWeight: 700, color: "#5a4a3a" }}>です！</span>
          </div>

          {/* グループ */}
          {data.groups?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, zIndex: 1 }}>
              {data.groups.map((g, i) => {
                const c = HELLO_GROUPS.find((h) => h.name === g)?.color || c1;
                return (
                  <div key={i} style={{
                    background: `${c}0d`, border: `1px solid ${c}35`,
                    padding: ".05rem .35rem", borderRadius: 8,
                    fontSize: "0.7rem", fontWeight: 700, color: c,
                  }}>
                    🎤 {g}
                  </div>
                );
              })}
            </div>
          )}

          {/* 推しメン */}
          {data.oshiMembers?.filter(m => (m.percent || 0) > 0).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px", zIndex: 1 }}>
              {data.oshiMembers.filter(m => (m.percent || 0) > 0).map((m, i) => (
                <span key={i} style={{ fontSize: "0.8rem", fontWeight: 700, color: dc(m.color) }}>
                  {m.callName || m.name}
                  <span style={{ opacity: 0.5, fontSize: "0.7rem", fontWeight: 400 }}> {m.percent}%</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 下段: 自由項目（全幅） */}
      {hasFreeItems && (
        <div style={{
          flex: 1, borderTop: "1px solid #f0e8e0", padding: ".5rem .7rem",
          background: "#faf6f0", display: "flex", flexWrap: "wrap",
          gap: ".3rem", alignContent: "flex-start", overflowY: "auto",
        }}>
          {data.freeItems.filter(f => f.values?.some(v => v)).map((it, i) => (
            <div key={i} style={{
              background: "#f5efe8", borderRadius: 7, padding: ".3rem .55rem",
              border: "1px solid #ebe0d4", fontSize: "0.8rem", lineHeight: 1.6,
            }}>
              <div style={{ fontWeight: 700, color: "#8a7a6a", marginBottom: 1, fontSize: "0.72rem" }}>{it.label}</div>
              {it.values.filter(v => v).map((v, j) => (
                <div key={j} style={{ color: "#444" }}>
                  {it.ranked && <span style={{ color: c1, fontWeight: 700 }}>{j + 1}. </span>}
                  {v}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div style={{ position: "absolute", bottom: 4, right: 8, fontSize: "0.65rem", color: "#ddd" }}>
        ハロプロファンサイト
      </div>
    </div>
  );
}
