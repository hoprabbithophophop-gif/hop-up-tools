import { useState, useEffect } from "react";
import { UNIT_ROWS, findMember } from "../data";
import HandIcon from "./HandIcon";

interface Props {
  initialSelectedId: string | null;
  onConfirm: (memberId: string) => void;
  onOpenRoomMenu: (memberId: string) => void;
}

export default function MemberSelect({
  initialSelectedId,
  onConfirm,
  onOpenRoomMenu,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);

  useEffect(() => {
    document.title = "ハイ！テンション✋ Practice ver. | hop-up-tools";
  }, []);

  // 選択中のメンバーカラー。背景の✋モチーフの着色に使う。
  const selectedColor = findMember(selectedId)?.color ?? null;

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
        position: "relative",
        isolation: "isolate", // ✋モチーフ(zIndex:-1)を背景の前・全コンテンツの背面に固定する
      }}
    >
      {__SHOW_VERSION__ && (
        <span
          style={{
            position: "absolute",
            bottom: 4,
            right: 8,
            fontSize: "0.5rem",
            color: "#c6c6c6",
            letterSpacing: "0.02em",
            pointerEvents: "none",
          }}
        >
          v.{__COMMIT_SHA__}
        </span>
      )}

      {/* ヘッダー：メインタイトル＋小さな副題（狭い画面でも折り返さない） */}
      <h1
        style={{
          fontSize: "clamp(1.3rem, 6.5vw, 1.6rem)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: 0,
          textAlign: "center",
          color: "#000",
          lineHeight: 1.2,
        }}
      >
        ハイ！テンション
      </h1>
      <p
        style={{
          fontSize: "0.8125rem",
          fontWeight: 600,
          letterSpacing: "0.04em",
          margin: "0.3rem 0 0",
          textAlign: "center",
          color: "#777",
        }}
      >
        ✋ Practice ver.
      </p>

      {/* 中央：背景の✋モチーフに重ねて、色選択を縦中央に置く */}
      <div
        style={{
          flex: 1,
          width: "100%",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* 背景に薄い✋（このツールの核アイコン）。選んだ色で着色して「自分の色の手」を示唆 */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            opacity: selectedColor ? 0.14 : 0.06,
            pointerEvents: "none",
            zIndex: -1,
          }}
        >
          <HandIcon size={250} color={selectedColor ?? "#000"} />
        </div>

        <p
          style={{
            fontSize: "0.95rem",
            fontWeight: 500,
            margin: "0 0 1rem",
            textAlign: "center",
            color: "#474747",
            position: "relative",
            zIndex: 1,
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
            position: "relative",
            zIndex: 1,
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
              // 画面の高さに応じて 44〜56px の範囲で自動調整。
              // 大画面では押しやすい 56px、iPhone SE 1st gen 等では HIG 最低の 44px。
              const baseSize = "clamp(44px, 7.5dvh, 56px)";
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-label={`color ${m.color}`}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(m.id)}
                  style={{
                    // 選択時は transform: scale で拡大するだけなので、
                    // 行の高さも他の丸の位置も動かない。
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
      </div>

      <div
        style={{
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
