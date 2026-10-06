// 窓（遊び方・前回の続き・名前・共有・作り方・問い合わせ・保存の確かめ・解く画面の入力カード）で共通に使う、
// キーボードと読み上げのための小さな仕組み（2026-10-06 アクセシビリティの直し）。
// - 開いたらフォーカスを窓の中へ（[data-autofocus] があればそこ、無ければ最初に押せる物）
// - Tab・Shift+Tab は窓の中だけで回る（フォーカストラップ）
// - Esc で閉じる（closeOnEsc が false の窓は閉じない）
// - 閉じたら、開く前にフォーカスがあった要素へ戻す
// 窓が重なった時は、いちばん後に開いた窓だけがキーを受け取る。
// 窓の外にあっても一緒に回したい物（練習問題の案内の吹き出し）は [data-dialog-companion] を付ける。
// 見た目には何も足さない。
import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

// 窓の中で、今押せて見えている物（並びは画面の並び）
export function focusablesIn(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest('[aria-hidden="true"]')
  );
}

const stack: symbol[] = [];

interface Options {
  /** 開いているか（Presence の中で消えていく途中は false にする） */
  active?: boolean;
  onClose?: () => void;
  /** Esc で閉じてよい窓か */
  closeOnEsc?: boolean;
}

export function useDialog<T extends HTMLElement = HTMLDivElement>({ active = true, onClose, closeOnEsc = true }: Options = {}) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const escRef = useRef(closeOnEsc);
  escRef.current = closeOnEsc;

  useEffect(() => {
    if (!active) return;
    const id = Symbol("dialog");
    stack.push(id);
    const prev = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;

    // 開いた直後は描き終わるのを1コマ待ってから中へ
    let tries = 0;
    let raf = 0;
    const focusIn = () => {
      const el = ref.current;
      if (!el) {
        if (tries++ < 10) raf = requestAnimationFrame(focusIn);
        return;
      }
      if (el.contains(document.activeElement)) return;
      const auto = el.querySelector<HTMLElement>("[data-autofocus]");
      const target = auto ?? focusablesIn(el)[0];
      if (target) target.focus({ preventScroll: true });
      else {
        if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
        el.focus({ preventScroll: true });
      }
    };
    raf = requestAnimationFrame(focusIn);

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      const el = ref.current;
      if (!el) return;
      if (e.key === "Escape") {
        if (escRef.current && onCloseRef.current) {
          e.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const companions = Array.from(document.querySelectorAll("[data-dialog-companion]")).flatMap((c) => focusablesIn(c));
      const list = [...focusablesIn(el), ...companions.filter((c) => !el.contains(c))];
      e.preventDefault();
      if (list.length === 0) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === -1 || i === list.length - 1 ? 0 : i + 1;
      list[next].focus();
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      cancelAnimationFrame(raf);
      const at = stack.indexOf(id);
      if (at >= 0) stack.splice(at, 1);
      document.removeEventListener("keydown", onKey, true);
      // 閉じたら元へ。元の要素が消えていれば何もしない
      if (prev && prev.isConnected) prev.focus({ preventScroll: true });
    };
  }, [active]);

  return ref;
}
