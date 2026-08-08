import { useEffect, useState } from "react";

/**
 * 端末の「視差効果を減らす」設定が入っているか。
 *
 * 画面が動くと気分が悪くなる人のための設定で、iPhoneなら
 * 設定 → アクセシビリティ → 動き → 視差効果を減らす。
 * これが入っている人には、飾りの動き（大きくなる・跳ねる等）を出さない。
 *
 * 止めるのは飾りだけで、内容そのものは止めない。
 * 動きを消しても、何が書いてあるかは同じように読める作りにしておくこと。
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return reduced;
}
