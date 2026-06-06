import type { ReactNode } from "react";

interface Props {
  onClick: () => void;
  /** back=「←」を前に付けて戻る導線 / forward=「→」を後に付けて進む導線 */
  direction: "back" | "forward";
  children: ReactNode;
  /** 任意で塗り/文字色を上書き（例: 暗いアリーナでの非常口グリーン）。未指定は既定の薄グレー。 */
  background?: string;
  color?: string;
}

/**
 * 二次導線ボタン（戻る/進む）。
 * 黒のメイン CTA より一段弱く見せるため、薄グレー塗り + 角丸0 + 枠線なし（No-line rule）。
 * 矢印グリフはこのコンポーネントが付ける（back=「←」前置き / forward=「→」後置き）。
 * 配置の左右（戻る=左 / 進む=右）は呼び出し側の flex で決める。
 */
export default function NavButton({ onClick, direction, children, background, color }: Props) {
  const isBack = direction === "back";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        minHeight: 44, // タップ領域 HIG 最低 44px
        padding: "0 1rem",
        background: background ?? "#eceef0",
        color: color ?? "#191c1d",
        border: "none",
        borderRadius: 0,
        fontSize: "0.8125rem",
        fontWeight: 700,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        cursor: "pointer",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        transition: "background 0.12s",
      }}
    >
      {isBack && <span aria-hidden>←</span>}
      <span>{children}</span>
      {!isBack && <span aria-hidden>→</span>}
    </button>
  );
}
