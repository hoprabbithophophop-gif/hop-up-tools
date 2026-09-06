// 入口：メンバーカラーを選ぶ。ハイ！テンションの入口と同じ並び（ユニット3段＋新メンバー1段）と
// 同じ手触り（選ぶと背景の大きなアイコンがその色に染まって跳ねる）。文言も同じものだけを使う。
import { useEffect, useState } from "react";
import { faGem } from "@fortawesome/free-solid-svg-icons";
import FaIcon from "../hi-tension/components/FaIcon";
import { ARENA_BG, findMember, type HiTensionMember } from "../hi-tension/data";
import { SHARE_TAG } from "./HaiToDiamondPage";

// 色の並び（Hop指定 2026-09-06）。新メンバーが各ユニットに加入した後の並びで、高瀬さんは卒業のため入れない。
// 1行目: ホットピンク・デイジー・ライトグリーン・レッド / 2行目: シーブルー・ピンク・オレンジ・ホワイト / 3行目: パープル・グリーン・ミディアムブルー
const ROW_IDS: readonly string[][] = [
  ["nishida", "eguchi", "otsubo", "sugiyama"],
  ["maeda", "okamura", "kiyono", "kojima"],
  ["hirai", "kobayashi", "satoyoshi"],
];
const DIAMOND_ROWS: { unit: string; members: HiTensionMember[] }[] = ROW_IDS.map((ids, i) => ({
  unit: `row${i + 1}`,
  members: ids.map((id) => findMember(id)).filter((m): m is HiTensionMember => m != null),
}));

interface Props {
  initialSelectedId: string | null;
  onConfirm: (memberId: string) => void;
  /** 右上の歯車（表示設定）。 */
  onOpenSettings?: () => void;
}

export default function DiamondMemberSelect({ initialSelectedId, onConfirm, onOpenSettings }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [popTick, setPopTick] = useState(0);
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

  const selectedColor = findMember(selectedId)?.color ?? null;
  const rows = isLandscape
    ? [{ unit: "all", members: DIAMOND_ROWS.flatMap((r) => r.members) }]
    : DIAMOND_ROWS;
  const circleSize = isLandscape ? "clamp(44px, 14dvh, 52px)" : "clamp(44px, 7.5dvh, 56px)";

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
        isolation: "isolate",
      }}
    >
      <style>{`
        @keyframes hai-to-diamond-pop {
          0%   { transform: translate(-50%, -50%) scaleX(1.06) scaleY(0.9); }
          45%  { transform: translate(-50%, -50%) scaleX(0.97) scaleY(1.05); }
          100% { transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>

      {/* 版番号。main 以外の枝のプレビューでだけ出る（vite.config の __SHOW_VERSION__）。ハイ！テンションと同じ */}
      {__SHOW_VERSION__ && (
        <span style={{ position: "absolute", bottom: 4, right: 8, fontSize: "0.5rem", color: "#c6c6c6", letterSpacing: "0.02em", pointerEvents: "none" }}>
          v.{__COMMIT_SHA__}
        </span>
      )}
      {/* 表示設定を開く歯車。右上に控えめに（ハイ！テンションと同じ） */}
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
      {/* 見出しと副題（Hop指定 2026-09-06） */}
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
          width: "100%",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          key={`${selectedId ?? "none"}-${popTick}`}
          aria-hidden
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            mixBlendMode: "screen",
            opacity: selectedColor ? 0.7 : 0.13,
            pointerEvents: "none",
            zIndex: -1,
            animation: "hai-to-diamond-pop 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          <FaIcon icon={faGem} size="min(100vw, 70vh)" color={selectedColor ?? "#cfd6de"} />
        </div>
        <p style={{ fontSize: "0.95rem", fontWeight: 500, margin: isLandscape ? "0 0 0.6rem" : "0 0 1rem", textAlign: "center", color: "#c6ccd2", position: "relative", zIndex: 1 }}>
          好きな色は？
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", alignItems: "center", width: "100%", maxWidth: isLandscape ? 640 : 360, position: "relative", zIndex: 1 }}>
          {rows.map((row) => (
            <div key={row.unit} style={{ display: "flex", gap: isLandscape ? "0.5rem" : "1rem", justifyContent: "center", flexWrap: "nowrap" }}>
              {row.members.map((m) => {
                const isSelected = selectedId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-label={`color ${m.color}`}
                    aria-pressed={isSelected}
                    onClick={() => { setSelectedId(m.id); setPopTick((t) => t + 1); }}
                    style={{
                      width: circleSize,
                      height: circleSize,
                      borderRadius: "50%",
                      background: m.color,
                      border: "none",
                      boxShadow: isSelected ? `0 0 0 3px #f8f9fa, 0 0 0 5px ${m.color}` : "0 0 0 1px rgba(0,0,0,0.08)",
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

      <div style={{ marginBottom: "0.5rem", width: "100%", maxWidth: 360 }}>
        <button
          type="button"
          disabled={!selectedId}
          onClick={() => selectedId && onConfirm(selectedId)}
          style={{
            width: "100%",
            padding: "1rem",
            // ハイ！テンションの入口と同じ色
            background: selectedId ? "#f1f3f5" : "#2a2f37",
            color: selectedId ? "#0e1016" : "#6b7178",
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
      </div>
      <div style={{ fontSize: "0.6875rem", color: "#9aa0a6", marginBottom: "0.3rem" }}>
        <span>公式動画 </span>
        <a href="https://youtu.be/ImXkCr22kCU" target="_blank" rel="noopener noreferrer" style={{ color: "#9aa0a6", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: "0.2rem" }}>
          ▶ Promotion Edit
        </a>
      </div>
    </div>
  );
}
