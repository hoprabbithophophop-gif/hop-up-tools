// クロスワードの画面で共通に使う小物（アイコンとフッター）。
// 中身は段階1の CrosswordPage.tsx にあった物と同じ。一覧の画面でも使うためにここへ移した。
export const Icon = ({ icon, size = 20, className = "" }: { icon: string; size?: number; className?: string }) => (
  <span className={`material-symbols-outlined leading-none ${className}`} style={{ fontSize: `${size}px` }}>
    {icon}
  </span>
);

// クロスワードには非公式の一文を出さない（Hop 決定 2026-10-03・DESIGN.md §1 の例外）。
// クロスワードはハロプロ以外の問題も作れる道具で、アップフロントが権利を持つ物ではないため。
// 画面下のカギの帯に中身が隠れないよう、下の余白だけ残す
export const Footer = ({ bottomGap = false }: { bottomGap?: boolean }) => (
  <div aria-hidden="true" style={{ height: bottomGap ? "9rem" : "6rem" }} />
);
