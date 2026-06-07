// 西田汐里さん バースデースペシャル（6/7）。
// 6月7日(ローカル時刻=JST想定)に自動でお祝いモードON、6/8 0時で自動的に通常へ戻る。
// 確認用に URL へ ?nishida を付けると日付に関わらず強制的にONにできる（本番プレビュー用）。
export const NISHIDA_COLOR = "#da1884"; // 西田汐里さんのメンバーカラー

export function isNishidaBirthday(): boolean {
  try {
    // プレビュー用パラメータ（本番には無害。付けた本人だけ効く・タブ内で記憶）：
    //   ?nishida        → 強制ON（お祝い表示の確認）
    //   ?nishida=off    → 強制OFF（日付が変わった後の"通常日"表示の確認。誕生日中でも素の通常に）
    const params = new URLSearchParams(window.location.search);
    if (params.has("nishida")) {
      const v = params.get("nishida");
      if (v === "off" || v === "0" || v === "false") {
        sessionStorage.setItem("nishida_force_off", "1");
        sessionStorage.removeItem("nishida_preview");
        return false;
      }
      sessionStorage.removeItem("nishida_force_off");
      sessionStorage.setItem("nishida_preview", "1");
      return true;
    }
    if (sessionStorage.getItem("nishida_force_off") === "1") return false;
    if (sessionStorage.getItem("nishida_preview") === "1") return true;
  } catch {
    /* SSR/権限なし等は無視 */
  }
  const d = new Date();
  return d.getMonth() === 5 && d.getDate() === 7; // getMonth: 0始まり → 5 = 6月
}

// ユーザーの表示選択：誕生日中でも「通常表示」に切り替えられる（推しの色で遊びたい人向け）。
// 既定はお祝い表示ON。localStorage に "off" を保存している間だけ通常表示。
const DISPLAY_PREF_KEY = "nishida_display";
export function readBirthdayDisplayPref(): boolean {
  try {
    return localStorage.getItem(DISPLAY_PREF_KEY) !== "off";
  } catch {
    return true;
  }
}
export function writeBirthdayDisplayPref(on: boolean): void {
  try {
    localStorage.setItem(DISPLAY_PREF_KEY, on ? "on" : "off");
  } catch {
    /* 権限なし等は無視 */
  }
}
