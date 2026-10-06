// 切り替えのボタンの並び（role="radiogroup"）を矢印キーで動かす（2026-10-06 アクセシビリティの直し）。
// Tab で止まるのは選んでいる1つだけ（tabIndex は radioTabIndex で付ける）。←↑ で前、→↓ で次を選んでフォーカスも移す。
import type React from "react";

export const radioTabIndex = (checked: boolean) => (checked ? 0 : -1);

export function radioKeyDown<K>(e: React.KeyboardEvent<HTMLElement>, keys: K[], current: K, select: (k: K) => void) {
  const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!dir) return;
  e.preventDefault();
  const i = Math.max(0, keys.indexOf(current));
  const nextIndex = (i + dir + keys.length) % keys.length;
  select(keys[nextIndex]);
  const group = e.currentTarget.closest('[role="radiogroup"]');
  requestAnimationFrame(() => group?.querySelectorAll<HTMLElement>('[role="radio"]')[nextIndex]?.focus());
}
