import { Link } from "react-router-dom";

const s = {
  wrap: {
    maxWidth: 640,
    margin: "2rem auto",
    padding: "0 1.25rem 4rem",
    fontFamily: "'Inter','Noto Sans JP',sans-serif",
    fontSize: "0.875rem",
    lineHeight: 1.8,
    color: "#333",
  } as React.CSSProperties,
  header: {
    fontSize: "1.25rem",
    fontWeight: 800,
    background: "linear-gradient(135deg,#E5457D,#ba3cb8)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    marginBottom: "0.25rem",
  } as React.CSSProperties,
  back: {
    display: "inline-block",
    fontSize: "0.8rem",
    color: "#E5457D",
    textDecoration: "none",
    marginBottom: "1.5rem",
  } as React.CSSProperties,
  updated: {
    fontSize: "0.78rem",
    color: "#999",
    marginBottom: "2rem",
  } as React.CSSProperties,
  h2: {
    fontSize: "1rem",
    fontWeight: 700,
    marginTop: "2rem",
    marginBottom: "0.5rem",
    borderBottom: "2px solid #f0f0f0",
    paddingBottom: "0.25rem",
  } as React.CSSProperties,
  p: {
    marginBottom: "0.75rem",
  } as React.CSSProperties,
  ul: {
    paddingLeft: "1.25rem",
    marginBottom: "0.75rem",
  } as React.CSSProperties,
};

export default function PrivacyPage() {
  return (
    <div style={s.wrap}>
      <Link to="/" style={s.back}>← ホームに戻る</Link>
      <div style={s.header}>プライバシーポリシー</div>
      <div style={s.updated}>最終更新日: 2026年3月30日</div>

      <p style={s.p}>
        hop-up-tools（以下「本サービス」）は、hop_rabbit（以下「運営者」）が提供するHello! Project ファン向けWebツール集です。
        本プライバシーポリシーは、本サービスにおける情報の取り扱いについて説明します。
      </p>

      <h2 style={s.h2}>1. 収集する情報</h2>
      <p style={s.p}>
        本サービスは、<strong>ユーザーの個人情報をサーバーに収集・保存しません。</strong>
      </p>
      <p style={s.p}>
        FC締切リマインダーのテキストエリアに貼り付けた内容は、お使いのブラウザ内でのみ処理されます。
        その内容がサーバーに送信されることはありません。
      </p>

      <h2 style={s.h2}>2. ブラウザへのデータ保存（localStorage）</h2>
      <p style={s.p}>本サービスは利便性のため、以下のデータをお使いのブラウザのlocalStorageに保存します。</p>
      <ul style={s.ul}>
        <li>FC締切リマインダーの入力テキスト（再訪時の自動復元用）</li>
        <li>ウォッチリストに追加した「気になる公演」のID一覧</li>
        <li>プロフィール帳メーカーで入力したプロフィール情報</li>
      </ul>
      <p style={s.p}>
        これらはお使いのブラウザにのみ保存され、運営者を含む第三者には送信されません。
        ブラウザの設定からいつでも削除できます。
      </p>

      <h2 style={s.h2}>3. アクセス解析</h2>
      <p style={s.p}>
        本サービスはCloudflare Pages上で動作しており、Cloudflareが匿名のアクセスログ（IPアドレス・ブラウザ情報等）を収集する場合があります。
        これらはCloudflareのプライバシーポリシーに従って処理されます。
        運営者がユーザーを個人として特定することはありません。
      </p>

      <h2 style={s.h2}>4. 広告（Google AdSense）</h2>
      <p style={s.p}>
        本サービスでは、Google LLC が提供する広告配信サービス「Google AdSense」を使用しています（または使用を予定しています）。
        Google AdSenseは、ユーザーの興味・関心に基づく広告を表示するためにCookieを使用する場合があります。
      </p>
      <ul style={s.ul}>
        <li>Googleによる広告Cookieの使用を無効にするには、<a href="https://adssettings.google.com/" target="_blank" rel="noopener noreferrer" style={{ color: "#E5457D" }}>広告設定ページ</a>をご利用ください。</li>
        <li>広告Cookieの詳細は<a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer" style={{ color: "#E5457D" }}>Googleのポリシーと規約</a>をご確認ください。</li>
      </ul>

      <h2 style={s.h2}>5. 第三者サービスへのリンク</h2>
      <p style={s.p}>
        本サービスはUPFC（ユナイテッドプロモーション）、e-LineUP!Mallなど外部サービスへのリンクを含みます。
        これら外部サービスのプライバシーポリシーについては、各サービスの規定をご確認ください。
        運営者はリンク先サービスの内容・取り扱いに責任を負いません。
      </p>

      <h2 style={s.h2}>6. プライバシーポリシーの変更</h2>
      <p style={s.p}>
        本ポリシーは必要に応じて変更することがあります。重要な変更がある場合は本ページに掲載します。
        最終更新日を必ずご確認ください。
      </p>

      <h2 style={s.h2}>7. お問い合わせ</h2>
      <p style={s.p}>
        本ポリシーに関するお問い合わせは、X（旧Twitter）<a href="https://x.com/hop_rabbit_hop" target="_blank" rel="noopener noreferrer" style={{ color: "#E5457D" }}>@hop_rabbit_hop</a> までDMにてご連絡ください。
      </p>
    </div>
  );
}
