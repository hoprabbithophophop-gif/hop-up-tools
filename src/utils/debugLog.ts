// オンデバイス・デバッグ／ドライブレコーダー式ロガー。
// - リングバッファ(メモリ)に直近ログを常時保持（?debug不問・I/Oなしで軽い）
// - 異常(automute / JSエラー等)が起きたら前後をスナップショットして localStorage "tb_incidents" に保存
// - ?debug=1 のときは console(eruda)にも出す
// 将来公開時: reportIncident 内の sink を Supabase POST に拡張する（下の TODO 参照）。
type Data = Record<string, unknown>;
interface LogRec { t: string; tag: string; [k: string]: unknown }

const RING: LogRec[] = [];
const RING_MAX = 60;   // 常時メモリ保持する直近ログ件数
const INC_MAX = 20;    // localStorage に残すインシデント数

function nowStr(): string {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}
function debugOn(): boolean {
  try { return localStorage.getItem("tb_debug") === "1"; } catch { return false; }
}

/** 常時リングバッファに積む（?debug時は console にも）。 */
export function tbLog(tag: string, data?: Data): void {
  const rec: LogRec = { t: nowStr(), tag, ...(data || {}) };
  RING.push(rec);
  if (RING.length > RING_MAX) RING.shift();
  if (debugOn()) {
    // eslint-disable-next-line no-console
    console.log("[tb]", rec.t, tag, data ?? "");
  }
}

function saveIncident(obj: unknown): void {
  try {
    const arr = JSON.parse(localStorage.getItem("tb_incidents") || "[]") as unknown[];
    arr.push(obj);
    if (arr.length > INC_MAX) arr.splice(0, arr.length - INC_MAX);
    localStorage.setItem("tb_incidents", JSON.stringify(arr));
  } catch { /* quota等は無視 */ }
  // TODO(公開時): ここで Supabase にも POST してサーバ側で追跡する。
  //   fetch(`${SUPABASE_URL}/rest/v1/tb_incidents`, {
  //     method: "POST",
  //     headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  //     body: JSON.stringify(obj),
  //   }).catch(() => {});
}

/** 異常発生。直近バッファ＋3秒後の追撃分をスナップショットして保存。 */
export function reportIncident(reason: string, extra?: Data): void {
  const snap = (suffix = "") => ({
    at: new Date().toISOString(),
    reason: reason + suffix,
    ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
    ...(extra || {}),
    log: RING.slice(-40),
  });
  saveIncident(snap());
  if (debugOn()) {
    // eslint-disable-next-line no-console
    console.warn("[tb] incident:", reason, extra ?? "");
  }
  // automute後に回復したか等、直後3秒の追撃スナップ
  setTimeout(() => saveIncident(snap(":+3s")), 3000);
}

/** 同一 reason は既定10秒に1回だけ（乱発防止）。 */
const lastAt: Record<string, number> = {};
export function reportIncidentThrottled(reason: string, extra?: Data, minMs = 10000): void {
  const now = Date.now();
  if (lastAt[reason] && now - lastAt[reason] < minMs) return;
  lastAt[reason] = now;
  reportIncident(reason, extra);
}

/** 保存済みインシデント一覧（console から tbDump() で確認用）。 */
export function tbDumpIncidents(): unknown[] {
  try { return JSON.parse(localStorage.getItem("tb_incidents") || "[]"); } catch { return []; }
}
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).tbDump = tbDumpIncidents;
}
