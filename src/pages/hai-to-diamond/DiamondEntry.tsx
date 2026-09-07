// 入口：💎だけの入口画面。色はここでは選ばず、押した後の再生中に選ぶ（別担当）。
// 見出し・副題・歯車は色を選ぶ版(DiamondMemberSelect.tsx)と同じものをそのまま移した。
import { useEffect, useState } from "react";
import { ARENA_BG } from "../hi-tension/data";
import BouncyNumber from "../hi-tension/components/BouncyNumber";
import FacetGem from "./FacetGem";
import { SHARE_TAG } from "./HaiToDiamondPage";

const GEM_SIZE = 160;             // 大きな💎ボタンの絵の大きさ【仮】
const GEM_SIZE_LANDSCAPE = 108;   // 横向きの低い画面でも縦に収まるよう小さくする【仮】
const BUTTON_RING_GAP = 24;       // 💎の絵とボタンの白い輪との間の余白【仮】

interface Props {
  /** みんなの累計（読み込み前は null） */
  total: number | null;
  /** 💎を押した時。この呼び出しの中で同期的に動画の再生が始まるので、押した瞬間（onClick）に必ず同期で呼ぶ */
  onStart: () => void;
  /** 右上の歯車（表示設定） */
  onOpenSettings?: () => void;
  /** 動き軽減（瞬きを止める） */
  reduceMotion?: boolean;
}

export default function DiamondEntry({ total, onStart, onOpenSettings, reduceMotion = false }: Props) {
  const [isLandscape, setIsLandscape] = useState<boolean>(() => {
    try { return window.matchMedia("(orientation: landscape)").matches; } catch { return false; }
  });
  useEffect(() => {
    document.title = "灰toダイヤモンド | hop-up-tools";
  }, []);
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia("(orientation: landscape)"); } catch { return; }
    const onChange = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const gemSize = isLandscape ? GEM_SIZE_LANDSCAPE : GEM_SIZE;
  const buttonSize = gemSize + BUTTON_RING_GAP * 2;

  return (
    <div
      style={{
        height: "100dvh",
        overflow: "hidden",
        background: ARENA_BG,
        color: "#e8eaed",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: isLandscape ? "0.7rem 1rem 0.7rem" : "1.5rem 1.2rem 1.5rem",
        fontFamily: "Inter, 'Noto Sans JP', sans-serif",
        position: "relative",
      }}
    >
      {onOpenSettings && (
        <button
          type="button"
          aria-label="表示設定"
          onClick={onOpenSettings}
          style={{ position: "absolute", top: 10, right: 10, zIndex: 2, background: "none", border: "none", fontSize: "1.25rem", lineHeight: 1, color: "#9aa0a6", cursor: "pointer", padding: "0.3rem" }}
        >
          ⚙
        </button>
      )}
      <h1
        style={{
          fontSize: "clamp(1.3rem, 6.5vw, 1.6rem)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: 0,
          textAlign: "center",
          color: "#f5f7fa",
          lineHeight: 1.2,
        }}
      >
        灰toダイヤモンド
      </h1>
      <p
        style={{
          fontSize: "0.8125rem",
          fontWeight: 600,
          letterSpacing: "0.04em",
          margin: "0.3rem 0 0",
          textAlign: "center",
          color: "#aab0b6",
        }}
      >
        {SHARE_TAG}
      </p>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
        }}
      >
        <button
          type="button"
          aria-label="はじめる"
          onClick={onStart}
          style={{
            width: buttonSize,
            height: buttonSize,
            flexShrink: 0,
            borderRadius: "50%",
            background: "#2a2f3a",
            border: "3px solid #ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <FacetGem size={gemSize} color="#e8eaed" animate={!reduceMotion} />
        </button>
        {/* 数字が読めるまではラベルも出さない（ラベルだけ浮くと壊れて見える） */}
        {total !== null && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.2rem" }}>
            <span style={{ fontSize: "0.75rem", color: "#9aa0a6" }}>歴代累計</span>
            <BouncyNumber value={total} color="#f5f7fa" size="1.6rem" />
          </div>
        )}
      </div>
    </div>
  );
}
