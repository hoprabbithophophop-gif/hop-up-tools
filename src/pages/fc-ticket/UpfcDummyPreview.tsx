/**
 * UPFCマイページ「申込状況＆利用履歴」セクションのダミープレビュー。
 * ヘルプモーダル内でコピー範囲を図示するためのモックアップ。
 */
export default function UpfcDummyPreview() {
  const UPFC_BLUE = "#008cd6";

  const entries = [
    {
      status: [{ label: "抽選前", cls: "lb_gre" }],
      title: "○○ Concert 2026 ～ツアータイトル～",
      payment: null,
    },
    {
      status: [
        { label: "当選", cls: "lb_org" },
        { label: "入金済", cls: "lb_pnk" },
      ],
      title: "△△ CONCERT TOUR 2026 SPRING",
      payment: "入金完了日：2026/03/03（火）[クレジットカード]",
    },
    {
      status: [{ label: "落選", cls: "lb_red" }],
      title: "□□ バースデーイベント2026（東京公演）",
      payment: null,
    },
  ];

  // タブ: 実際のUPFCは3タブを2カラムグリッドで表示
  const tabs = ["チケット申込状況", "ファンクラブショップ", "スペシャル会員"];

  return (
    <div data-demo-id="upfc-preview" style={{ fontFamily: "sans-serif", fontSize: 13, color: "#333", background: "#f0f8fd", borderRadius: 8, overflow: "hidden", border: "1px solid #b8d9ed" }}>
      {/* サイトヘッダー風 */}
      <div style={{ background: UPFC_BLUE, color: "#fff", padding: "8px 16px", fontSize: 11, letterSpacing: 2 }}>
        UPFC MYPAGE（イメージ）
      </div>

      <div style={{ padding: "16px" }}>
        {/* セクションタイトル: 1行目が#008cd6、2行目が白（背景上で見えないのでグレーで代替） */}
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: UPFC_BLUE }}>申込状況＆利用履歴</div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>STATUS &amp; HISTORY</div>
        </div>

        {/* タブ: 2カラムグリッド（実際のUPFCの挙動に合わせる） */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 12 }}>
          {tabs.map((label, i) => (
            <div
              key={label}
              style={{
                padding: "6px 8px",
                fontSize: 11,
                fontWeight: 700,
                textAlign: "center",
                background: i === 0 ? "#fff" : UPFC_BLUE,
                color: i === 0 ? UPFC_BLUE : "#fff",
                border: i === 0 ? `2px solid ${UPFC_BLUE}` : "2px solid transparent",
                cursor: "default",
                borderRadius: 2,
              }}
            >
              {label}
            </div>
          ))}
        </div>

        <h4 style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "#333" }}>チケット/イベント</h4>

        {/* コピー範囲ハイライト */}
        <div style={{ position: "relative" }}>
          <div style={{
            position: "absolute", inset: -6,
            border: "2.5px dashed #E5457D",
            borderRadius: 6,
            pointerEvents: "none",
            zIndex: 1,
          }} />
          <div style={{
            position: "absolute", top: -20, left: 0,
            background: "#E5457D", color: "#fff",
            fontSize: 10, fontWeight: 700, padding: "2px 8px",
            borderRadius: "4px 4px 0 0",
            zIndex: 2,
          }}>
            ここからここまでコピー
          </div>

          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {entries.map((entry, i) => (
              <li key={i} style={{ background: "#fff", border: "1px solid #c8dce8", borderRadius: 4, padding: "10px 12px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                  {entry.status.map((s) => (
                    <span
                      key={s.label}
                      style={{
                        fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                        background: s.cls === "lb_gre" ? "#4a7" : s.cls === "lb_org" ? "#e80" : s.cls === "lb_pnk" ? "#c55" : "#888",
                        color: "#fff",
                      }}
                    >
                      {s.label}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{entry.title}</div>
                {entry.payment && (
                  <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{entry.payment}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
