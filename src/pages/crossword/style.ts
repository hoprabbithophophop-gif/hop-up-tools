// クロスワードの色。docs/DESIGN.md のトークン（黒が唯一の色、面の濃淡で区切る、赤は間違いの表示だけ）
export const C = {
  black: "#000000",
  ink: "#191c1d", // on-surface
  white: "#ffffff",
  bg: "#f8f9fa", // surface
  low: "#f3f4f5", // surface-container-low
  mid: "#edeeef", // surface-container
  high: "#e7e8e9", // surface-container-high
  highest: "#e1e3e4", // surface-container-highest
  secondary: "#585f6c",
  outline: "#777777",
  ghost: "rgba(198,198,198,0.2)", // outline-variant/20
  placeholder: "#585f6c", // 空きマスの点。DESIGN.md に無い #9ca3af から secondary へ置き換え（2026-10-06 アクセシビリティの直し）
  error: "#ba1a1a",
  errorTint: "rgba(186,26,26,0.08)",
  // 盤の選択色（HarmonyPalette の黄色の置き換え）
  highlight: "#f3f4f5", // 同じ行・列
  active: "#e1e3e4", // 選んでいるマスの下地
  activeCell: "#e1e3e4", // 選んでいるマス
  // クリアのハンコ（DESIGN.md の例外。HarmonyPalette と同じ朱色）
  stamp: "#d9333f",
  modalShadow: "0 8px 24px rgba(0,0,0,0.12)",
};
