import { useEffect } from "react";

export default function NotFoundPage() {
  // 実在しない住所でも、サーバーはトップページを「在るページ」の番号（200）で返す
  // （Cloudflare Pages が、直下に 404.html の無いサイトを1枚で全部の住所を受けるサイトと見なすため）。
  // 検索の取得役に「無いページ」だと伝える手段が番号では無くなるので、この画面が出ている間だけ
  // 「検索に載せない」の印を head に差す（Google の公式が挙げている手当ての1つ）。ほかの画面へ移ったら外す
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);

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
