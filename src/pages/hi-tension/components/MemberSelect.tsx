import { useState, useEffect } from "react";
import { UNIT_ROWS } from "../data";

interface Props {
  initialSelectedId: string | null;
  onConfirm: (memberId: string) => void;
  onWaitGlobal: (memberId: string) => void;
  onOpenRoomMenu: (memberId: string) => void;
  roomFull: boolean;
}

export default function MemberSelect({
  initialSelectedId,
  onConfirm,
  onWaitGlobal,
  onOpenRoomMenu,
  roomFull,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);

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
        padding: "1.5rem 1.2rem 1.5rem",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
        animation: "hi-tension-fade-in 180ms ease-out",
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
          gap: "0.8rem",
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
              gap: "1rem",
              justifyContent: "center",
              flexWrap: "nowrap",
            }}
          >
            {row.members.map((m) => {
              const isSelected = selectedId === m.id;
              const baseSize = 48;
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

      <div
        style={{
          marginTop: "auto",
          marginBottom: "0.5rem",
          width: "100%",
          maxWidth: 360,
          display: "flex",
          flexDirection: "column",
          gap: "0.6rem",
        }}
      >
        <button
          type="button"
          disabled={!selectedId}
          onClick={() => selectedId && onConfirm(selectedId)}
          style={{
            width: "100%",
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
          ひとりではじめる
        </button>

        {/* だれかと合わせる（グローバル待機室） */}
        {(() => {
          const globalDisabled = !selectedId || roomFull;
          return (
            <button
              type="button"
              disabled={globalDisabled}
              onClick={() => selectedId && !roomFull && onWaitGlobal(selectedId)}
              style={{
                width: "100%",
                padding: "1rem",
                background: globalDisabled ? "#c6c6c6" : "#000",
                color: "#fff",
                border: "none",
                fontSize: "0.875rem",
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                cursor: globalDisabled ? "not-allowed" : "pointer",
                transition: "background 0.12s",
              }}
            >
              {roomFull ? "満員（4人まで）" : "だれかと合わせる"}
            </button>
          );
        })()}

        {/* 合言葉の部屋（コードで集まる） */}
        <button
          type="button"
          disabled={!selectedId}
          onClick={() => selectedId && onOpenRoomMenu(selectedId)}
          style={{
            width: "100%",
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
          合言葉の部屋へ
        </button>
      </div>

    </div>
  );
}
