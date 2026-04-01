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
  warning: {
    background: "#fff3f6",
    border: "1px solid #E5457D",
    borderRadius: 8,
    padding: "0.75rem 1rem",
    marginBottom: "1.5rem",
    fontSize: "0.85rem",
  } as React.CSSProperties,
};

export default function TermsPage() {
  return (
    <div style={s.wrap}>
      <Link to="/" style={s.back}>← ホームに戻る</Link>
      <div style={s.header}>利用規約</div>
      <div style={s.updated}>最終更新日: 2026年3月30日</div>

      <div style={s.warning}>
        ⚠️ 本サービスは<strong>非公式のファンツール</strong>です。株式会社アップフロントワークス、ハロー！プロジェクト、UPFC（ユナイテッドプロモーション）、e-LineUP!Mallとは一切関係ありません。
      </div>

      <p style={s.p}>
        hop-up-tools（以下「本サービス」）をご利用いただく前に、以下の利用規約をよくお読みください。
        本サービスをご利用になった場合、本規約に同意したものとみなします。
      </p>

      <h2 style={s.h2}>1. サービスの性質</h2>
      <p style={s.p}>
        本サービスは、Hello! Project ファンが個人利用を目的として作成した非公式ツールです。
        アーティスト・グループ名、公演名等の情報は事実情報として引用しており、各権利者への帰属を主張するものではありません。
      </p>

      <h2 style={s.h2}>2. 情報の正確性・最新性について</h2>
      <p style={s.p}>
        本サービスに表示される公演・締切情報は、UPFC（<a href="https://www.upfc.jp/helloproject/" target="_blank" rel="noopener noreferrer" style={{ color: "#E5457D" }}>https://www.upfc.jp/helloproject/</a>）および e-LineUP!Mall（<a href="https://www.elineupmall.com/" target="_blank" rel="noopener noreferrer" style={{ color: "#E5457D" }}>https://www.elineupmall.com/</a>）の公開ページから自動取得したものです。
      </p>
      <ul style={s.ul}>
        <li>情報の正確性・完全性・最新性を保証しません。</li>
        <li>データ取得のタイミングにより、実際の締切と差異が生じる場合があります。</li>
        <li>チケット申込・入金の期限は、必ず公式サービスでご確認ください。</li>
      </ul>

      <h2 style={s.h2}>3. 免責事項</h2>
      <p style={s.p}>
        本サービスの利用は自己責任でお願いします。本サービスの利用によって生じたいかなる損害（チケット申込の機会損失・入金遅延等を含む）についても、運営者は一切の責任を負いません。
      </p>

      <h2 style={s.h2}>4. 禁止事項</h2>
      <ul style={s.ul}>
        <li>本サービスを通じて取得した情報の商業利用</li>
        <li>本サービスへの不正アクセス・過度な負荷をかける行為</li>
        <li>法令または公序良俗に反する利用</li>
        <li>その他、運営者が不適切と判断する行為</li>
      </ul>

      <h2 style={s.h2}>5. サービスの変更・終了</h2>
      <p style={s.p}>
        運営者は予告なく本サービスの内容を変更・停止・終了する場合があります。
        第三者サービス（UPFC等）の仕様変更により、機能が正常に動作しなくなる可能性があります。
      </p>

      <h2 style={s.h2}>6. 著作権・知的財産権</h2>
      <p style={s.p}>
        本サービスのコード・デザインの著作権は運営者に帰属します。
        ハロー！プロジェクトおよび各アーティストに関する権利は、それぞれの権利者に帰属します。
        本サービスは公式の許諾を受けておらず、公式コンテンツ（画像・文章等）の無断転載は行っていません。
      </p>

      <h2 style={s.h2}>7. 準拠法・管轄</h2>
      <p style={s.p}>
        本規約は日本法に準拠します。本サービスに関する紛争は、東京地方裁判所を第一審の専属的合意管轄裁判所とします。
      </p>

      <h2 style={s.h2}>8. お問い合わせ</h2>
      <p style={s.p}>
        本規約に関するお問い合わせは、X（旧Twitter）<a href="https://x.com/hop_rabbit_hop" target="_blank" rel="noopener noreferrer" style={{ color: "#E5457D" }}>@hop_rabbit_hop</a> までDMにてご連絡ください。
      </p>
    </div>
  );
}
