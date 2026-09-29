/**
 * 端末の記録（localStorage の "fc-" で始まる物）をファイルに書き出す・ファイルから戻す。
 * 機種変更や別の端末で開いた時に、同じ記録の続きとして使えるようにするため。
 * ファイルは利用者の端末に保存するだけで、サーバーには送らない。
 */

const APP_ID = "hop-up-tools/fc-ticket";
const BACKUP_VERSION = 1;
const PREFIX = "fc-";
/** 送信済みの印は端末ごとの物なので書き出さない・読み込みでも書かない（読み込んだ端末で必ず送り直させる） */
const EXCLUDED_KEYS = new Set(["fc-sub-last-saved-sig", "fc-sub-last-saved-at", "fc-subscription-inputs-changed"]);

interface BackupFile {
  app: typeof APP_ID;
  v: typeof BACKUP_VERSION;
  savedAt: string;
  data: Record<string, string>;
}

function ownKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && !EXCLUDED_KEYS.has(k)) keys.push(k);
    }
  } catch { /* ignore */ }
  return keys;
}

export function exportBackup() {
  const data: Record<string, string> = {};
  for (const k of ownKeys()) {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) data[k] = v;
    } catch { /* ignore */ }
  }
  const now = new Date();
  const file: BackupFile = { app: APP_ID, v: BACKUP_VERSION, savedAt: now.toISOString(), data };
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fc-ticket-backup-${ymd}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** ファイルの中身がこのツールのバックアップの形か確かめる。合えば data を返す */
export function parseBackup(text: string): Record<string, string> | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.app !== APP_ID || o.v !== BACKUP_VERSION) return null;
  if (typeof o.data !== "object" || o.data === null || Array.isArray(o.data)) return null;
  const data = o.data as Record<string, unknown>;
  for (const [k, val] of Object.entries(data)) {
    if (!k.startsWith(PREFIX) || typeof val !== "string") return null;
  }
  return data as Record<string, string>;
}

/** 今の端末の記録（送信済みの印を除く）を消してから、ファイルの内容を書き戻す */
export function replaceWithBackup(data: Record<string, string>) {
  for (const k of ownKeys()) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
  for (const [k, val] of Object.entries(data)) {
    if (EXCLUDED_KEYS.has(k)) continue;
    try { localStorage.setItem(k, val); } catch { /* ignore */ }
  }
}
