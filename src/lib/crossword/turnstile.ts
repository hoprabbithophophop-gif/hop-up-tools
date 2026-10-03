// Turnstile（人間かどうかの確かめ）の読み込み。src/components/ContactModal.tsx と同じ読み込み方・同じサイトキー。
// ContactModal 側の関数は外へ出していないので、同じ中身をここに置いている（寄せる場合は両方を1か所に）。
// window.turnstile の型は ContactModal.tsx の declare global にある。

export const TURNSTILE_SITE_KEY = "0x4AAAAAADzKF09DPiNfSXSR";
const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Turnstile のスクリプトは一度だけ読み込む。 */
export function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
  if (existing) return new Promise((res) => existing.addEventListener("load", () => res()));
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = TURNSTILE_SRC;
    s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error("turnstile load failed"));
    document.head.appendChild(s);
  });
}
