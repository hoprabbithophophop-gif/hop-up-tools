// UIアクセント色。通常はホットピンク。6月16日（高瀬くるみ 卒業コンサートの日）限定で
// 高瀬くるみのメンバーカラーに切り替える（hop指定）。
// ※ありがとビート／ハイ！テンション（上級編）のUIアクセントだけに使う。
//   メンバーカラー選択や他ツール（/profile 等）には適用しない。
const HOTPINK = "#da1884";
const TAKASE = "#00c7b1"; // 高瀬くるみのメンバーカラー（data.ts の takase と一致）

/**
 * 今日が6/16なら高瀬くるみのメンカラ、それ以外は通常のホットピンクを返す。
 * 端末ローカルの日付で判定（日本時間想定）。6/17になれば自動でホットピンクに戻る。
 */
export function accentColor(): string {
  const d = new Date();
  return d.getMonth() === 5 && d.getDate() === 16 ? TAKASE : HOTPINK;
}

// 上の色のRGB成分（rgba() で透明度を付けて塗りつぶしに使う用）。色と必ず対で更新する。
const HOTPINK_RGB = "218,24,132"; // #da1884
const TAKASE_RGB = "0,199,177";   // #00c7b1

/** アクセント色の "R,G,B"。`rgba(${accentRgb()},0.4)` のように透明度付きで使う。 */
export function accentRgb(): string {
  const d = new Date();
  return d.getMonth() === 5 && d.getDate() === 16 ? TAKASE_RGB : HOTPINK_RGB;
}
