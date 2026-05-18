import { useState } from "react";
import { normalizeRoomCode, ROOM_CODE_LENGTH } from "./useHiTensionRealtime";

interface Props {
  onCreate: () => void;
  onJoin: (code: string) => void;
  onBack: () => void;
}

export default function RoomMenu({ onCreate, onJoin, onBack }: Props) {
  const [code, setCode] = useState("");
  const canJoin = code.length === ROOM_CODE_LENGTH;

  return (
    <div
      style={{
        height: "100dvh",
        overflow: "hidden",
        background: "#f8f9fa",
        color: "#191c1d",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1.2rem",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
        gap: "1.5rem",
      }}
    >
      <h2
        style={{
          fontSize: "1.125rem",
          fontWeight: 700,
          margin: 0,
          color: "#000",
          textAlign: "center",
        }}
      >
        合言葉の部屋
      </h2>

      {/* 部屋を作る */}
      <button
        type="button"
        onClick={onCreate}
        style={{
          width: "100%",
          maxWidth: 360,
          padding: "1rem",
          background: "#000",
          color: "#fff",
          border: "none",
          fontSize: "0.875rem",
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        部屋を作る
      </button>

      <p style={{ fontSize: "0.8125rem", color: "#777", margin: 0 }}>または</p>

      {/* コードで入る */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.75rem",
          width: "100%",
          maxWidth: 360,
        }}
      >
        <input
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          value={code}
          onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
          placeholder="コード"
          aria-label="部屋のコード"
          style={{
            width: "100%",
            padding: "0.85rem",
            background: "#fff",
            border: "1px solid #c6c6c6",
            color: "#191c1d",
            fontSize: "1.25rem",
            fontWeight: 700,
            letterSpacing: "0.3em",
            textAlign: "center",
            textTransform: "uppercase",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
        <button
          type="button"
          disabled={!canJoin}
          onClick={() => canJoin && onJoin(code)}
          style={{
            width: "100%",
            padding: "1rem",
            background: canJoin ? "#000" : "#c6c6c6",
            color: "#fff",
            border: "none",
            fontSize: "0.875rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            cursor: canJoin ? "pointer" : "not-allowed",
            transition: "background 0.12s",
          }}
        >
          入る
        </button>
      </div>

      {/* 戻る */}
      <button
        type="button"
        onClick={onBack}
        style={{
          background: "none",
          border: "none",
          fontSize: "0.8125rem",
          color: "#777",
          cursor: "pointer",
          padding: "0.25rem 0",
        }}
      >
        ← 戻る
      </button>
    </div>
  );
}
