// 西田汐里さん バースデースペシャル（6/7）。
// 6月7日(ローカル時刻=JST想定)に自動でお祝いモードON、6/8 0時で自動的に通常へ戻る。
// 確認用に URL へ ?nishida を付けると日付に関わらず強制的にONにできる（本番プレビュー用）。
export const NISHIDA_COLOR = "#da1884"; // 西田汐里さんのメンバーカラー

export function isNishidaBirthday(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has("nishida")) return true;
  } catch {
    /* SSR/権限なし等は無視 */
  }
  const d = new Date();
  return d.getMonth() === 5 && d.getDate() === 7; // getMonth: 0始まり → 5 = 6月
}
