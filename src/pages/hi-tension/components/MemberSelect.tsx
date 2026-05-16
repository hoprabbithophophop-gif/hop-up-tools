import { useState, useEffect } from "react";
import { UNIT_ROWS } from "../data";
import IntroModal from "./IntroModal";
import type { HiMode } from "../HiTensionPage";

interface Props {
  initialSelectedId: string | null;
  mode: HiMode;
  showModeToggle: boolean;
  onModeChange: (mode: HiMode) => void;
  onConfirm: (memberId: string) => void;
}

export default function MemberSelect({ initialSelectedId, mode, showModeToggle, onModeChange, onConfirm }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    document.title = "ハイ！テンション✋ Practice ver. | hop-up-tools";
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
        padding: "2rem 1.2rem 1.5rem",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
      }}
    >
      <h1
        style={{
          fontSize: "1.375rem",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: "0 0 0.4rem",
          textAlign: "center",
          color: "#000",
          lineHeight: 1.3,
        }}
      >
        ハイ！テンション✋ Practice ver.
      </h1>
      <p
        style={{
          fontSize: "0.95rem",
          fontWeight: 500,
          margin: "0 0 1.2rem",
          textAlign: "center",
          color: "#474747",
        }}
      >
        好きな色は？
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1.1rem",
          alignItems: "center",
          width: "100%",
          maxWidth: 360,
          marginBottom: "1.4rem",
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
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-label={`color ${m.color}`}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(m.id)}
                  style={{
                    // box サイズは常に baseSize 固定。選択時は transform: scale で
                    // その場で拡大するだけなので、行の高さも他の丸の位置も動かない。
                    width: baseSize,
                    height: baseSize,
                    borderRadius: "50%",
                    background: m.color,
                    border: "none",
                    // リングは box-shadow(レイアウトに影響しない)で表現
                    boxShadow: isSelected
                      ? `0 0 0 3px #f8f9fa, 0 0 0 5px ${m.color}`
                      : "0 0 0 1px rgba(0,0,0,0.08)",
                    padding: 0,
                    cursor: "pointer",
                    transform: isSelected ? "scale(1.2)" : "scale(1)",
                    transition: "transform 0.18s, box-shadow 0.18s",
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      {showModeToggle ? (
        <div
          style={{
            marginTop: "auto",
            width: "100%",
            maxWidth: 360,
            display: "flex",
            gap: "0.4rem",
            marginBottom: "0.8rem",
          }}
        >
          <button
            type="button"
            onClick={() => onModeChange("solo")}
            style={{
              flex: 1,
              padding: "0.6rem",
              background: mode === "solo" ? "#000" : "transparent",
              color: mode === "solo" ? "#fff" : "#474747",
              border: `1px solid ${mode === "solo" ? "#000" : "#c6c6c6"}`,
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.12s, color 0.12s",
            }}
          >
            一人で
          </button>
          <button
            type="button"
            onClick={() => onModeChange("crowd")}
            style={{
              flex: 1,
              padding: "0.6rem",
              background: mode === "crowd" ? "#000" : "transparent",
              color: mode === "crowd" ? "#fff" : "#474747",
              border: `1px solid ${mode === "crowd" ? "#000" : "#c6c6c6"}`,
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.12s, color 0.12s",
            }}
          >
            みんなで
          </button>
        </div>
      ) : (
        <p
          style={{
            marginTop: "auto",
            width: "100%",
            maxWidth: 360,
            marginBottom: "0.8rem",
            fontSize: "0.8125rem",
            color: "#777",
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          まずは一人で、自分のタイミングで。
        </p>
      )}

      <button
        type="button"
        disabled={!selectedId}
        onClick={() => selectedId && onConfirm(selectedId)}
        style={{
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
