import { HELLO_GROUPS } from "@/data/groups";
import type { ProfileData } from "@/types/profile";
import { dc } from "@/lib/colorUtils";

interface TemplateBProps {
  data: ProfileData;
}

export default function TemplateB({ data }: TemplateBProps) {
  const gc = data.groups?.map((g) => HELLO_GROUPS.find((h) => h.name === g)?.color) ?? [];
  const c1 = gc[0] || "#E5457D";
  const first = data.oshiMembers?.[0];
  const rest = data.oshiMembers?.slice(1) || [];

  return (
    <div style={{
      width: "100%", aspectRatio: "3/4", background: "#fffbf7",
      borderRadius: 14, overflow: "hidden", position: "relative",
      fontFamily: "'Zen Maru Gothic',sans-serif",
      boxShadow: "0 3px 18px rgba(0,0,0,.07)",
      display: "flex", flexDirection: "column",
    }}>
      {[...Array(12)].map((_, i) => (
        <div key={i} style={{
          position: "absolute",
          left: `${6 + (i % 4) * 25}%`,
          top: `${4 + Math.floor(i / 4) * 33}%`,
          width: 4, height: 4, borderRadius: "50%",
          background: `${c1}${Math.min(99, 10 + i * 7)}`,
        }} />
      ))}
      {/* ヘッダー: 固定高さをやめてコンテンツに合わせる */}
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: ".6rem 1rem .4rem", position: "relative", zIndex: 1, minHeight: "28%" }}>
        <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#5a4a3a", lineHeight: 1.8 }}>
          <span style={{ color: c1, fontSize: "0.875rem" }}>♪</span>{" "}
          {data.greeting ? (
            <>{data.greeting} {data.pronoun || "わたし"}は</>
          ) : (
            <>こんにちは！{data.pronoun || "わたし"}は</>
          )}
          <span style={{ borderBottom: `2px solid ${c1}`, padding: "0 .15rem", fontWeight: 800, color: "#2a2a3e", fontSize: "1.05rem" }}>
            {data.name || "＿＿＿"}
          </span>っていいます。
        </div>
        <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#5a4a3a", lineHeight: 1.8 }}>
          いま
          <span style={{ background: `${first?.color || c1}12`, borderBottom: `2px solid ${first?.color || c1}`, padding: ".04rem .18rem", fontWeight: 800, color: dc(first?.color || c1), fontSize: "1rem" }}>
            {first?.callName || first?.name || "＿＿＿"}
          </span>
          が大好きで、毎日しあわせ<span style={{ color: c1 }}>♡</span>
        </div>
        {rest.length > 0 && (
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#7a6a5a", lineHeight: 1.8 }}>
            最近、
            {rest.map((m, i) => (
              <span key={i}>
                {i > 0 && "、"}
                <span style={{ borderBottom: `1.5px dashed ${m.color}88`, padding: "0 .1rem", color: dc(m.color), fontWeight: 700 }}>
                  {m.callName || m.name}
                </span>
              </span>
            ))}
            も気になってるんだ〜。
          </div>
        )}
        {data.groups?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: ".2rem" }}>
            {data.groups.map((g, i) => {
              const c = HELLO_GROUPS.find((h) => h.name === g)?.color || c1;
              return (
                <div key={i} style={{
                  display: "inline-flex", alignItems: "center", gap: 2,
                  background: `${c}0d`, border: `1px solid ${c}35`,
                  padding: ".1rem .4rem", borderRadius: 10,
                  fontSize: "0.75rem", fontWeight: 700, color: c,
                }}>
                  🎤 {g}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={{
        flex: 1, borderTop: "1px solid #f0e8e0", padding: ".6rem .7rem",
        background: "#faf6f0", display: "flex", flexWrap: "wrap",
        gap: ".35rem", alignContent: "flex-start", overflowY: "auto",
      }}>
        {data.freeItems?.filter((f) => f.values?.some((v) => v)).map((it, i) => (
          <div key={i} style={{ background: "#f5efe8", borderRadius: 8, padding: ".4rem .7rem", border: "1px solid #ebe0d4", fontSize: "0.875rem", lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, color: "#8a7a6a", marginBottom: 2, fontSize: "0.8rem" }}>{it.label}</div>
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
