export default function NotFoundPage() {
  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col items-center justify-center gap-6 px-6">
      <p className="text-xs uppercase tracking-widest text-outline">404</p>
      <p className="text-base font-bold">ページが見つかりません</p>
      <a
        href="/"
        className="text-xs uppercase tracking-widest text-primary border border-primary px-6 py-2 hover:bg-primary hover:text-on-primary transition-colors"
      >
        トップへ戻る
      </a>
    </div>
  );
}
