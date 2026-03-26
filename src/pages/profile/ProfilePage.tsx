import { useState, useEffect } from "react";
import { HELLO_GROUPS } from "@/data/groups";
import { FREE_SUGGESTIONS } from "@/data/members";
import { dc, parseRanked } from "@/lib/colorUtils";
import type { ProfileData, OshiMember, FreeItem } from "@/types/profile";
import type { Member } from "@/types/profile";
import BrainPreview from "@/pages/profile/components/BrainPreview";
import ColorPicker from "@/pages/profile/components/ColorPicker";
import MemberSelector from "@/pages/profile/components/MemberSelector";
import TemplateA from "@/pages/profile/components/TemplateA";
import TemplateB from "@/pages/profile/components/TemplateB";
import TemplateC from "@/pages/profile/components/TemplateC";

const STORAGE_KEY = "hp-prof-v6";

export default function ProfilePage() {
  const [step, setStep] = useState<"input" | "preview">("input");
  const [template, setTemplate] = useState<"A" | "B" | "C" | null>(null);
  const [data, setData] = useState<ProfileData>({ name: "", greeting: "", pronoun: "わたし", oshiMembers: [], groups: [], freeItems: [] });
  const [newItemLabel, setNewItemLabel] = useState("");

  useEffect(() => {
    try {
      const s = localStorage?.getItem?.(STORAGE_KEY);
      if (s) {
        const parsed = JSON.parse(s);
        setData({ greeting: "", pronoun: "わたし", ...parsed });
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    try {
      localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
  }, [data]);

  const gcs = data.groups.map((g) => HELLO_GROUPS.find((h) => h.name === g)?.color || "#ba3cb8");
  const groupColor = gcs[0] || "#ba3cb8";
  const totalPct = data.oshiMembers.reduce((s, m) => s + (m.percent || 0), 0);
  const hasUnconfirmedOshi = data.oshiMembers.some((m) => !m.confirmed);

  const toggleGroup = (n: string) =>
    setData((d) => ({ ...d, groups: d.groups.includes(n) ? d.groups.filter((g) => g !== n) : [...d.groups, n] }));

  const addMember = (member: Member) => {
    if (data.oshiMembers.length >= 8 || data.oshiMembers.find((m) => m.name === member.name)) return;
    setData((d) => ({
      ...d,
      oshiMembers: [
        ...d.oshiMembers,
        {
          name: member.name,
          callName: "",
          percent: Math.max(5, Math.round(100 / (d.oshiMembers.length + 1))),
          color: member.color,
          confirmed: false,
        },
      ],
    }));
  };

  const confirmOshi = (i: number) =>
    setData((d) => ({ ...d, oshiMembers: d.oshiMembers.map((m, idx) => idx === i ? { ...m, confirmed: true, callName: m.callName || m.name } : m) }));

  const editOshi = (i: number) =>
    setData((d) => ({ ...d, oshiMembers: d.oshiMembers.map((m, idx) => idx === i ? { ...m, confirmed: false } : m) }));

  const updateOshi = (i: number, u: Partial<OshiMember>) =>
    setData((d) => ({ ...d, oshiMembers: d.oshiMembers.map((m, idx) => idx === i ? { ...m, ...u } : m) }));

  const removeOshi = (i: number) =>
    setData((d) => ({ ...d, oshiMembers: d.oshiMembers.filter((_, idx) => idx !== i) }));

  const addFreeItem = (l: string) => {
    if (data.freeItems.find((f) => f.label === l)) return;
    const r = parseRanked(l);
    setData((d) => ({
      ...d,
      freeItems: [...d.freeItems, { label: l, values: r > 0 ? Array(r).fill("") : [""], ranked: r > 0, confirmed: false }],
    }));
  };

  const updateFreeValue = (fi: number, vi: number, val: string) =>
    setData((d) => ({ ...d, freeItems: d.freeItems.map((f, i) => i === fi ? { ...f, values: f.values.map((v, j) => j === vi ? val : v) } : f) }));

  const confirmFree = (fi: number) =>
    setData((d) => ({ ...d, freeItems: d.freeItems.map((f, i) => i === fi ? { ...f, confirmed: true } : f) }));

  const editFree = (fi: number) =>
    setData((d) => ({ ...d, freeItems: d.freeItems.map((f, i) => i === fi ? { ...f, confirmed: false } : f) }));

  const removeFreeItem = (i: number) =>
    setData((d) => ({ ...d, freeItems: d.freeItems.filter((_, idx) => idx !== i) }));

  const addCustomItem = () => {
    if (newItemLabel.trim()) { addFreeItem(newItemLabel.trim()); setNewItemLabel(""); }
  };

  const S = {
    app: { maxWidth: 680, margin: "0 auto", padding: ".6rem", fontFamily: "'Zen Maru Gothic','Hiragino Kaku Gothic Pro',sans-serif", color: "#2a2a3e" },
    hdr: { textAlign: "center" as const, marginBottom: ".8rem" },
    ttl: { fontSize: "1.4rem", fontWeight: 800, background: "linear-gradient(135deg,#E5457D,#ba3cb8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
    sub: { fontSize: "0.875rem", color: "#999", marginTop: 3 },
    card: { background: "#fff", borderRadius: 12, padding: ".75rem", marginBottom: ".6rem", boxShadow: "0 1px 8px rgba(0,0,0,.04)", border: "1px solid #f0eef4" },
    lbl: { fontSize: "0.875rem", fontWeight: 700, color: "#666", marginBottom: ".3rem", display: "flex", alignItems: "center", gap: 5 },
    hint: { fontSize: "0.875rem", color: "#bbb", marginBottom: 6 },
    inp: { width: "100%", padding: ".45rem .65rem", border: "2px solid #eee", borderRadius: 10, fontSize: "0.875rem", outline: "none", boxSizing: "border-box" as const, fontFamily: "inherit" },
    cw: { display: "flex", flexWrap: "wrap" as const, gap: 4 },
    ch: (active: boolean, color: string) => ({
      padding: ".22rem .6rem", borderRadius: 16, fontSize: "0.825rem", fontWeight: 600, cursor: "pointer",
      border: `1.5px solid ${active ? color : "#e0e0e0"}`,
      background: active ? `${color}15` : "#fafafa",
      color: active ? color : "#888",
    }),
    btn: (primary: boolean) => ({
      padding: primary ? ".6rem 1.5rem" : ".45rem .8rem", borderRadius: 10, fontWeight: 700, fontSize: "0.875rem", cursor: "pointer",
      fontFamily: "inherit", background: primary ? groupColor : "#fff", color: primary ? "#fff" : "#666",
      border: primary ? "none" : "1.5px solid #e0e0e0",
    }),
    sm: { padding: ".35rem .6rem", borderRadius: 8, background: groupColor, color: "#fff", border: "none", fontWeight: 700, fontSize: "0.875rem", cursor: "pointer", fontFamily: "inherit" },
    rx: { background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: "#ccc", padding: "0 4px", lineHeight: 1 },
    oRow: { display: "flex", alignItems: "center", gap: 5, padding: ".3rem .4rem", background: "#faf8ff", borderRadius: 8, marginBottom: 4 },
    tBtn: (active: boolean) => ({
      flex: 1, padding: ".5rem", borderRadius: 10, border: `1.5px solid ${active ? groupColor : "#e0e0e0"}`,
      background: active ? `${groupColor}10` : "#fafafa", cursor: "pointer", textAlign: "center" as const,
      fontFamily: "inherit", fontWeight: 700, fontSize: "0.875rem", color: active ? groupColor : "#999",
    }),
  };

  // ===== INPUT =====
  if (step === "input") {
    return (
      <div style={S.app}>
        <div style={S.hdr}>
          <div style={S.ttl}>ハロプロ プロフ帳メーカー</div>
          <div style={S.sub}>プロフィールカードを作ってXでシェアしよう</div>
        </div>

        <div style={S.card}>
          <div style={S.lbl}>🎨 テンプレートを選ぼう</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.tBtn(template === "A")} onClick={() => setTemplate("A")}>🧠 推し脳マップ</button>
            <button style={S.tBtn(template === "B")} onClick={() => setTemplate("B")}>💌 プロフィール帳</button>
            <button style={S.tBtn(template === "C")} onClick={() => setTemplate("C")}>✨ どっちも</button>
          </div>
        </div>

        <div style={S.card}>
          <div style={S.lbl}>✏️ なまえ</div>
          <input
            style={S.inp}
            placeholder="ニックネームを入力"
            value={data.name}
            onChange={(e) => setData((d) => ({ ...d, name: e.target.value }))}
          />
        </div>

        {(template === "B" || template === "C") && <div style={S.card}>
          <div style={S.lbl}>💬 最初の挨拶文</div>
          <div style={S.hint}>自由に作ってね。メンバーの挨拶を参考にしてもOK！</div>
          <input
            style={S.inp}
            placeholder={`こんにちは！${data.name || "〇〇"}です！`}
            value={data.greeting ?? ""}
            onChange={(e) => setData((d) => ({ ...d, greeting: e.target.value }))}
          />
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: "0.8rem", color: "#bbb", marginBottom: 4 }}>一人称</div>
            <div style={S.cw}>
              {["わたし", "あたし", "ぼく", "おれ", "うち", "自分", data.name || "（名前）"].map((p) => {
                const val = p === (data.name || "（名前）") ? (data.name || "") : p;
                const active = (data.pronoun ?? "わたし") === val;
                return (
                  <div key={p} style={{ ...S.ch(active, groupColor), cursor: "pointer" }} onClick={() => setData((d) => ({ ...d, pronoun: val }))}>
                    {p}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: "0.8rem", color: "#bbb", marginBottom: 4 }}>💡 メンバーの挨拶から参考にする</div>
            <div style={S.cw}>
              {[
                "こんにちもっち〜",
                "こんばんワラビー🦘",
                "やふぞう",
                "やあ",
                "どもー",
                "こんにちは！",
                "こんばんは！",
                "皆さんへ",
              ].map((ex) => (
                <div
                  key={ex}
                  style={{ ...S.ch(data.greeting === ex, groupColor), cursor: "pointer" }}
                  onClick={() => setData((d) => ({ ...d, greeting: ex }))}
                >
                  {ex}
                </div>
              ))}
            </div>
          </div>
        </div>}

        <div style={S.card}>
          <div style={S.lbl}>🎤 推しグループ（複数OK）</div>
          <div style={S.cw}>
            {HELLO_GROUPS.map((g) => (
              <div key={g.name} style={S.ch(data.groups.includes(g.name), g.color)} onClick={() => toggleGroup(g.name)}>
                {g.name}
              </div>
            ))}
          </div>
        </div>

        <div style={S.card}>
          <div style={S.lbl}>💖 好きなメンバーと脳内を占める割合</div>
          <div style={S.hint}>メンバーを選択 → 呼び名を確定 → スライダーで割合を調整</div>
          <MemberSelector onSelect={addMember} existingNames={data.oshiMembers.map((m) => m.name)} disabled={hasUnconfirmedOshi} />
          <div style={{ marginTop: 8 }}>
            {data.oshiMembers.map((m, i) => (
              <div key={i} style={{ ...S.oRow, flexWrap: "wrap", border: !m.confirmed ? `2px solid ${dc(m.color)}44` : "1px solid transparent" }}>
                {!m.confirmed ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, width: "100%" }}>
                    <ColorPicker color={m.color} onChange={(c) => updateOshi(i, { color: c })} />
                    <div style={{ fontWeight: 700, fontSize: "0.875rem", color: dc(m.color), flexShrink: 0 }}>{m.name}</div>
                    <div style={{ fontSize: "0.875rem", color: "#bbb" }}>→</div>
                    <input
                      style={{ ...S.inp, flex: 1, padding: ".25rem .45rem", fontSize: "0.875rem" }}
                      placeholder="呼び名を入力"
                      value={m.callName}
                      onChange={(e) => updateOshi(i, { callName: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && confirmOshi(i)}
                      autoFocus
                    />
                    <button style={{ ...S.sm, padding: ".25rem .5rem" }} onClick={() => confirmOshi(i)}>確定</button>
                    <button style={S.rx} onClick={() => removeOshi(i)}>×</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, width: "100%" }}>
                    <ColorPicker color={m.color} onChange={(c) => updateOshi(i, { color: c })} />
                    <div style={{ display: "flex", flexDirection: "column", minWidth: 50, flexShrink: 0, cursor: "pointer" }} onClick={() => editOshi(i)}>
                      <div style={{ fontWeight: 700, fontSize: "0.875rem", color: dc(m.color), lineHeight: 1.2 }}>
                        {i === 0 && "👑 "}{m.callName || m.name}
                      </div>
                      {m.callName && m.callName !== m.name && (
                        <div style={{ fontSize: "0.75rem", color: "#bbb" }}>{m.name}</div>
                      )}
                    </div>
                    <input
                      type="range" min="0" max="200" value={m.percent || 0}
                      onChange={(e) => updateOshi(i, { percent: parseInt(e.target.value) })}
                      style={{ flex: 1, height: 4, cursor: "pointer", accentColor: m.color }}
                    />
                    <div style={{ fontSize: "0.875rem", fontWeight: 800, color: dc(m.color), minWidth: 36, textAlign: "right" }}>
                      {m.percent || 0}%
                    </div>
                    <button style={S.rx} onClick={() => removeOshi(i)}>×</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {data.oshiMembers.length > 0 && (
            <div style={{ fontSize: "0.8rem", textAlign: "right", marginTop: 2, color: "#aaa" }}>合計 {totalPct}%</div>
          )}
        </div>

        <div style={S.card}>
          <div style={S.lbl}>📝 もっと語る（自由項目）</div>
          <div style={S.hint}>候補をタップして追加。「TOP3」等が含まれる項目は順位入力欄になります</div>
          <div style={S.cw}>
            {FREE_SUGGESTIONS.filter((l) => !data.freeItems.find((f) => f.label === l)).map((l) => (
              <div key={l} style={{ ...S.ch(false, groupColor), cursor: "pointer" }} onClick={() => addFreeItem(l)}>
                + {l}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {data.freeItems.map((item, fi) => (
              <div key={fi} style={{ background: "#faf8ff", borderRadius: 10, padding: ".5rem .6rem", border: !item.confirmed ? `2px solid ${groupColor}44` : "1px solid #ece4f6" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ fontSize: "0.875rem", fontWeight: 700, color: groupColor }}>{item.label}</div>
                  <button style={S.rx} onClick={() => removeFreeItem(fi)}>×</button>
                </div>
                {!item.confirmed ? (
                  <div>
                    {item.values.map((v, vi) => (
                      <div key={vi} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                        {item.ranked && (
                          <div style={{ fontSize: "0.875rem", fontWeight: 800, color: groupColor, minWidth: 24 }}>{vi + 1}位</div>
                        )}
                        <input
                          style={{ ...S.inp, flex: 1, padding: ".35rem .5rem" }}
                          placeholder={item.ranked ? `${vi + 1}位を入力` : `${item.label}を書いてね`}
                          value={v}
                          onChange={(e) => updateFreeValue(fi, vi, e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && vi === item.values.length - 1 && confirmFree(fi)}
                        />
                      </div>
                    ))}
                    <button style={{ ...S.sm, marginTop: 4, width: "100%", padding: ".3rem" }} onClick={() => confirmFree(fi)}>確定</button>
                  </div>
                ) : (
                  <div style={{ cursor: "pointer" }} onClick={() => editFree(fi)}>
                    {item.values.filter((v) => v).map((v, j) => (
                      <div key={j} style={{ fontSize: "0.875rem", color: "#555", lineHeight: 1.6 }}>
                        {item.ranked && <span style={{ color: groupColor, fontWeight: 700 }}>{j + 1}. </span>}
                        {v}
                      </div>
                    ))}
                    {item.values.every((v) => !v) && (
                      <div style={{ fontSize: "0.8rem", color: "#ccc", fontStyle: "italic" }}>（タップして編集）</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input
              style={{ ...S.inp, flex: 1 }}
              placeholder="オリジナル項目名（例: 神セトリTOP5）"
              value={newItemLabel}
              onChange={(e) => setNewItemLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomItem()}
            />
            <button style={S.sm} onClick={addCustomItem}>追加</button>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: ".8rem" }}>
          <button style={S.btn(true)} onClick={() => setStep("preview")}>プレビューを見る →</button>
        </div>
      </div>
    );
  }

  // ===== PREVIEW =====
  return (
    <div style={S.app}>
      <div style={S.hdr}>
        <div style={S.ttl}>プレビュー</div>
        <div style={S.sub}>テンプレートを選んでね</div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: ".6rem" }}>
        <button style={S.tBtn(template === "A")} onClick={() => setTemplate("A")}>🧠 推し脳マップ</button>
        <button style={S.tBtn(template === "B")} onClick={() => setTemplate("B")}>💌 プロフィール帳</button>
        <button style={S.tBtn(template === "C")} onClick={() => setTemplate("C")}>✨ どっちも</button>
      </div>
      <div style={{ maxWidth: 440, margin: "0 auto .8rem" }}>
        {(template ?? "A") === "A" ? <TemplateA data={data} /> : (template === "C" ? <TemplateC data={data} /> : <TemplateB data={data} />)}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        <button style={S.btn(false)} onClick={() => setStep("input")}>← 編集に戻る</button>
        <button
          style={S.btn(true)}
          onClick={async () => {
            try {
              const { compressToEncodedURIComponent } = await import("lz-string");
              const { getSupabase } = await import("@/lib/supabase");
              const supabase = getSupabase();
              const { generateSlug } = await import("@/lib/slug");
              const payload = {
                name: data.name,
                greeting: data.greeting,
                pronoun: data.pronoun,
                groups: data.groups,
                oshiMembers: data.oshiMembers.map((m) => ({
                  name: m.name, callName: m.callName, percent: m.percent, color: m.color,
                })),
                freeItems: data.freeItems.filter(f => f.values?.some(v => v)).map(f => ({
                  label: f.label, values: f.values, ranked: f.ranked,
                })),
              };
              const encoded = compressToEncodedURIComponent(JSON.stringify(payload));
              const slug = generateSlug();
              const { error } = await supabase.from("short_urls").insert({ slug, data: encoded, template });
              const shareUrl = error
                ? `${location.origin}/profile?d=${encoded}`
                : `${location.origin}/p/${slug}`;
              window.open(
                `https://twitter.com/intent/tweet?text=${encodeURIComponent("わたしのハロプロプロフ帳できた！🎤✨\n#ハロプロプロフ帳 #ハロプロ")}&url=${encodeURIComponent(shareUrl)}`,
                "_blank"
              );
            } catch (e) {
              window.open(
                `https://twitter.com/intent/tweet?text=${encodeURIComponent("わたしのハロプロプロフ帳できた！🎤✨\n#ハロプロプロフ帳 #ハロプロ")}`,
                "_blank"
              );
            }
          }}
        >
          𝕏 でシェアする
        </button>
      </div>
      <div style={{ textAlign: "center", marginTop: "1rem" }}>
        <button
          style={{ background: "none", border: "none", color: "#ccc", fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}
          onClick={() => {
            if (confirm("入力内容をすべてリセットしますか？")) {
              setData({ name: "", greeting: "", pronoun: "わたし", oshiMembers: [], groups: [], freeItems: [] });
              setStep("input");
              try { localStorage?.removeItem?.(STORAGE_KEY); } catch (e) {}
            }
          }}
        >
          🗑 データをリセット
        </button>
      </div>
    </div>
  );
}
