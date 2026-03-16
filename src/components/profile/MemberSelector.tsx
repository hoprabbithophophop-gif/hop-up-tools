"use client";

import { useState } from "react";
import { ALL_MEMBERS } from "@/data/members";
import { isLight } from "@/lib/colorUtils";
import type { Member } from "@/types/profile";

interface MemberSelectorProps {
  onSelect: (member: Member) => void;
  existingNames: string[];
  disabled: boolean;
}

export default function MemberSelector({ onSelect, existingNames, disabled }: MemberSelectorProps) {
  const [search, setSearch] = useState("");
  const [showList, setShowList] = useState(false);

  const filtered = ALL_MEMBERS.filter(
    (m) =>
      !existingNames.includes(m.name) &&
      (m.name.includes(search) ||
        m.group.includes(search) ||
        (m.nicks && m.nicks.some((n) => n.includes(search))))
  );

  if (disabled) {
    return (
      <div style={{
        padding: ".45rem .65rem", border: "2px solid #eee", borderRadius: 10,
        fontSize: "0.875rem", background: "#f5f5f5", color: "#bbb", boxSizing: "border-box",
      }}>
        ↓ 先に呼び名を確定してね
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        style={{
          width: "100%", padding: ".45rem .65rem", border: "2px solid #eee",
          borderRadius: 10, fontSize: "0.875rem", outline: "none",
          boxSizing: "border-box", fontFamily: "inherit",
        }}
        placeholder="メンバー名で検索"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setShowList(true); }}
        onFocus={() => setShowList(true)}
      />
      {showList && search.length > 0 && filtered.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          background: "#fff", borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,.12)",
          maxHeight: 200, overflowY: "auto", border: "1px solid #eee", marginTop: 2,
        }}>
          {filtered.slice(0, 12).map((m) => {
            const mn = m.nicks?.find((n) => n.includes(search));
            return (
              <div
                key={m.name}
                onClick={() => { onSelect(m); setSearch(""); setShowList(false); }}
                style={{
                  padding: ".4rem .7rem", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: "0.875rem", borderBottom: "1px solid #f5f5f5",
                }}
              >
                <div style={{
                  width: 14, height: 14, borderRadius: 3, background: m.color, flexShrink: 0,
                  border: isLight(m.color) ? "1.5px solid #ccc" : "none",
                }} />
                <span style={{ fontWeight: 700, color: "#333" }}>{m.name}</span>
                {mn && <span style={{ fontSize: "0.75rem", color: "#E5457D" }}>({mn})</span>}
                <span style={{ fontSize: "0.75rem", color: "#aaa", marginLeft: "auto" }}>{m.group}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
