import { useState } from "react";
import NavButton from "./components/NavButton";
import { normalizeRoomCode, ROOM_CODE_LENGTH } from "./useHiTensionRealtime";

interface Props {
  onCreate: () => void;
  onJoin: (code: string) => void;
  onBack: () => void;
}

export default function RoomMenu({ onCreate, onJoin, onBack }: Props) {
  const [code, setCode] = useState("");
  // iOS フリック入力(IME)対策：onChange で toUpperCase 等の変換をかけて value を
  // 書き換えると、フリック変換途中の文字が毎回潰れて入力できない（何も表示されない）。
  // 生の入力値をそのまま保持し、大文字化は表示(CSS textTransform)、使用可否/送信は
  // normalizeRoomCode に任せる。これで IME と喧嘩しない。
  const canJoin = normalizeRoomCode(code).length === ROOM_CODE_LENGTH;

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
        animation: "hi-tension-fade-in 180ms ease-out",
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
          autoCorrect="off"
          spellCheck={false}
          maxLength={ROOM_CODE_LENGTH}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="合言葉"
          aria-label="部屋の合言葉"
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
          onClick={() => canJoin && onJoin(normalizeRoomCode(code))}
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

      {/* 戻る（左寄せ） */}
      <div style={{ width: "100%", maxWidth: 360, display: "flex", justifyContent: "flex-start" }}>
        <NavButton direction="back" onClick={onBack}>
          戻る
        </NavButton>
      </div>
    </div>
  );
}
