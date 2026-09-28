import { useEffect, useRef } from "react";

const goBack = () => window.history.back();

// モーダル/オーバーレイをブラウザバック（戻る）で閉じられるようにする。
// マウント時に履歴を1つ積み、popstate（戻る）で onClose を呼ぶ。
// 返り値の close() を UI の閉じる操作（✕/Esc/背景クリック）に使うと、常に history.back() 経由で
// 閉じるため履歴と表示状態が一致する（StrictMode の二重実行でも破綻しない）。
export function useBackClose(onClose: () => void): () => void {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    window.history.pushState({ overlay: true }, "");
    const onPop = () => cb.current();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return goBack;
}
