// クロスワードの画面で共通に使う小物（アイコンとフッター）。
// 中身は段階1の CrosswordPage.tsx にあった物と同じ。一覧の画面でも使うためにここへ移した。
export const Icon = ({ icon, size = 20, className = "" }: { icon: string; size?: number; className?: string }) => (
  <span className={`material-symbols-outlined leading-none ${className}`} style={{ fontSize: `${size}px` }}>
    {icon}
  </span>
);

export const Footer = ({ bottomGap = false }: { bottomGap?: boolean }) => (
  <footer style={{ padding: "3rem 2rem", marginTop: "3rem", paddingBottom: bottomGap ? "6rem" : "3rem", borderTop: "1px solid rgba(198,198,198,0.2)" }}>
    <p style={{ fontSize: "0.625rem", color: "#c6c6c6", margin: 0 }}>
      非公式ファンツール。株式会社アップフロントグループとは無関係です。
    </p>
  </footer>
);
