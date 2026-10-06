// react-hot-toast の代わりの簡単な知らせ。HarmonyPalette と同じく画面上の中央に出し、
// 表示時間は HarmonyPalette の Toaster の既定（4000ms）か、呼び出しで指定した長さ
import { useEffect, useState } from "react";

interface ToastItem {
  id: number;
  message: string;
  kind: "error" | "success";
}

let seq = 0;
let items: ToastItem[] = [];
const listeners = new Set<(list: ToastItem[]) => void>();
const emit = () => listeners.forEach((l) => l(items));

function push(kind: ToastItem["kind"], message: string, duration = 4000) {
  const id = ++seq;
  items = [...items, { id, message, kind }];
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, duration);
}

// 読み上げだけの知らせ（同じ入れ物に入れる。画面には出さない）
let said = { id: 0, text: "" };
const sayListeners = new Set<(s: { id: number; text: string }) => void>();
function announce(text: string) {
  said = { id: ++seq, text };
  sayListeners.forEach((l) => l(said));
}

export const toast = {
  error: (message: string, opts?: { duration?: number }) => push("error", message, opts?.duration),
  success: (message: string, opts?: { duration?: number }) => push("success", message, opts?.duration),
  announce,
};

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  const [spoken, setSpoken] = useState(said);
  useEffect(() => {
    listeners.add(setList);
    sayListeners.add(setSpoken);
    return () => {
      listeners.delete(setList);
      sayListeners.delete(setSpoken);
    };
  }, []);
  // 知らせの入れ物は最初から置いておき、文だけ差し替える（読み上げが入れ物の出来た瞬間を取りこぼさないように。
  // 2026-10-06 アクセシビリティの直し）。中身が無い間は何も見えない
  return (
    <div role="status" aria-live="polite" className="fixed top-4 left-0 right-0 z-[9998] flex flex-col items-center gap-2 pointer-events-none px-4">
      {list.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-2 bg-primary text-white text-sm px-3 py-2 max-w-[350px]"
          style={{ whiteSpace: "pre-line", boxShadow: "0 3px 10px rgba(0,0,0,0.12)" }}
        >
          <span aria-hidden="true" className="material-symbols-outlined leading-none shrink-0" style={{ fontSize: "20px", color: t.kind === "error" ? "#e41d27" : "#ffffff" }}>
            {t.kind === "error" ? "error" : "check_circle"}
          </span>
          <span>{t.message}</span>
        </div>
      ))}
      {/* 画面には出さず、読み上げだけで知らせる文（解けた時のタイムなど） */}
      <span className="sr-only">{spoken.text}</span>
    </div>
  );
}
