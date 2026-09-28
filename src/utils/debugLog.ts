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
}

// Supabase(tb_incidents)へ自動送信。RLSで anon INSERT のみ許可、閲覧は service_role(MCP)。
// 端末のlocalStorageだけだと現物を貰えないので、発生時にサーバ側へも飛ばして追跡できるようにする。
function postIncident(snap: Record<string, unknown>): void {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !key) return;
    const { log, reason, ua, ...detail } = snap;
    fetch(`${url}/rest/v1/tb_incidents`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ reason, ua, detail, log }),
    }).catch(() => { /* ネットワーク不通は無視（記録は best-effort） */ });
  } catch { /* ignore */ }
}

/** 異常発生。直近バッファ＋3秒後の追撃分をスナップショットし、localStorageとSupabaseの両方へ保存。 */
export function reportIncident(reason: string, extra?: Data): void {
  const snap = (suffix = "") => ({
    at: new Date().toISOString(),
    reason: reason + suffix,
    ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
    ...(extra || {}),
    log: RING.slice(-40),
  });
  const first = snap();
  saveIncident(first);
  postIncident(first);
  if (debugOn()) {
    // eslint-disable-next-line no-console
    console.warn("[tb] incident:", reason, extra ?? "");
  }
  // automute後に回復したか等、直後3秒の追撃スナップ
  setTimeout(() => { const s = snap(":+3s"); saveIncident(s); postIncident(s); }, 3000);
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
/** 現在メモリにあるリングバッファ（現象直後の確認用・再現不要・ページ更新で消える）。 */
export function tbDumpRing(): LogRec[] {
  return RING.slice();
}
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).tbDump = tbDumpIncidents;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).tbRing = tbDumpRing;
}
