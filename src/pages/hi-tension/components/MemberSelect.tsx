import { useState, useEffect } from "react";
import { UNIT_ROWS } from "../data";
import IntroModal from "./IntroModal";

interface Props {
  initialSelectedId: string | null;
  onConfirm: (memberId: string) => void;
}

export default function MemberSelect({ initialSelectedId, onConfirm }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    document.title = "hi-tension | hop-up-tools";
  }, []);

  return (
    <div
      style={{
        height: "100dvh", // dvh で動的に viewport に合わせ + overflow hidden で iOS の rubber band も潰す
        overflow: "hidden",
        background: "#f8f9fa",
        color: "#191c1d",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "3rem 1.2rem 2rem",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
      }}
    >
      <h1
        style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: "0 0 1.6rem",
          textAlign: "center",
          color: "#000",
        }}
      >
        好きな色は？
      </h1>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1.4rem",
          alignItems: "center",
          width: "100%",
          maxWidth: 360,
        }}
      >
        {UNIT_ROWS.map((row) => (
          <div
            key={row.unit}
            style={{
              display: "flex",
              gap: "0.8rem",
              justifyContent: "center",
              flexWrap: "nowrap",
            }}
          >
            {row.members.map((m) => {
              const isSelected = selectedId === m.id;
              const baseSize = 56;
              const size = isSelected ? baseSize * 1.2 : baseSize;
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-label={`color ${m.color}`}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(m.id)}
                  style={{
                    width: size,
                    height: size,
                    borderRadius: "50%",
                    background: m.color,
                    border: isSelected ? `3px solid ${m.color}` : "none",
                    boxShadow: isSelected
                      ? `0 0 0 3px #f8f9fa inset, 0 0 0 1px rgba(0,0,0,0.08)`
                      : "0 0 0 1px rgba(0,0,0,0.08)",
                    padding: 0,
                    cursor: "pointer",
                    transition: "width 0.18s, height 0.18s, box-shadow 0.18s",
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={!selectedId}
        onClick={() => selectedId && onConfirm(selectedId)}
        style={{
          marginTop: "auto",
          marginBottom: "0.4rem",
          width: "100%",
          maxWidth: 360,
          padding: "1rem",
          background: selectedId ? "#000" : "#c6c6c6",
          color: "#fff",
          border: "none",
          fontSize: "0.875rem",
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          cursor: selectedId ? "pointer" : "not-allowed",
          transition: "background 0.12s",
        }}
      >
        はじめる
      </button>

      <p
        style={{
          fontSize: "0.625rem",
          color: "#777",
          margin: "1.6rem 0 0",
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        楽曲・映像の著作権は権利者に帰属します。
        <br />
        権利者からの申し出により直ちに公開を停止します。
      </p>

      {showIntro && <IntroModal onDismiss={() => setShowIntro(false)} />}
    </div>
  );
}
