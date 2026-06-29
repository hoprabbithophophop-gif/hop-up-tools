// The Ballad ビューア共通の見た目トークン（docs/DESIGN.md 準拠：角丸0・グレースケール・ゴーストボーダー）
export const C = {
  bg: "#f8f9fa",
  card: "#ffffff",
  cardHover: "#f3f4f5",
  ink: "#000000",
  body: "#191c1d",
  meta: "#585f6c",
  faint: "#777777",
  hair: "#c6c6c6",
  line: "rgba(198,198,198,0.4)",
} as const;

export const labelStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: C.faint,
  margin: 0,
};
