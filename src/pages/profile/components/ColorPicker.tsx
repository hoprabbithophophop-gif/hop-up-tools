"use client";

import { useState } from "react";
import { PRESET_COLORS } from "@/data/members";
import { isLight } from "@/lib/colorUtils";

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

export default function ColorPicker({ color, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          width: 18, height: 18, borderRadius: 4, background: color,
          border: isLight(color) ? "2px solid #ccc" : "2px solid #e0e0e0",
          cursor: "pointer", flexShrink: 0,
        }}
      />
      {open && (
        <div style={{
          position: "absolute", top: 24, left: 0, zIndex: 100,
          background: "#fff", borderRadius: 10, padding: 6,
          boxShadow: "0 4px 20px rgba(0,0,0,.15)",
          display: "flex", flexWrap: "wrap", gap: 3, width: 170,
        }}>
          {PRESET_COLORS.map((c) => (
            <div
              key={c}
              onClick={() => { onChange(c); setOpen(false); }}
              style={{
                width: 20, height: 20, borderRadius: 4, background: c, cursor: "pointer",
                border: c === color ? "2.5px solid #333" : isLight(c) ? "2px solid #ccc" : "2px solid #eee",
              }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => { onChange(e.target.value); setOpen(false); }}
            style={{ width: "100%", height: 24, marginTop: 3, cursor: "pointer", border: "none" }}
          />
        </div>
      )}
    </div>
  );
}
