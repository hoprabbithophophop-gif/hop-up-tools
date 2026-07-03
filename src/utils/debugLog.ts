// オンデバイス・デバッグ用の簡易ロガー。
// ?debug=1（localStorage tb_debug=1）のときだけ記録する。通常ユーザーには影響しない。
// console に出す（eruda で閲覧）＋ localStorage "tb_log" に直近200件を保存し、後から見返せる。
type Data = Record<string, unknown>;

function enabled(): boolean {
  try {
    return localStorage.getItem("tb_debug") === "1";
  } catch {
    return false;
  }
}

export function tbLog(tag: string, data?: Data): void {
  if (!enabled()) return;
  const t = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  // eslint-disable-next-line no-console
  console.log("[tb]", t, tag, data ?? "");
  try {
    const arr = JSON.parse(localStorage.getItem("tb_log") || "[]") as unknown[];
    arr.push({ t, tag, ...(data || {}) });
    if (arr.length > 200) arr.splice(0, arr.length - 200);
    localStorage.setItem("tb_log", JSON.stringify(arr));
  } catch {
    /* quota等は無視 */
  }
}
