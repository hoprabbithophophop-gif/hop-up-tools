/**
 * fc-ics Edge Function 経由でICS購読の「注文票」をアップロード/削除する。
 * ICSの中身そのものはブラウザでは作らない。サーバー側(fc-ics-upload)が
 * 注文票と最新の締切データを突き合わせて組み立てる（案1・組み立て役の一本化）。
 */
import type { OrderTicket } from "./icsCore";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export interface SubscriptionUrls {
  https: string;
  webcal: string;
}

export function subscriptionUrls(slug: string): SubscriptionUrls {
  const httpsUrl = `${SUPABASE_URL}/storage/v1/object/public/fc-ics/${slug}.ics`;
  const webcalUrl = httpsUrl.replace(/^https:/, "webcal:");
  return { https: httpsUrl, webcal: webcalUrl };
}

export async function uploadSubscriptionIcs(
  slug: string,
  order: OrderTicket,
): Promise<SubscriptionUrls> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/fc-ics-upload`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slug, order }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }

  return subscriptionUrls(slug);
}

export async function deleteSubscriptionIcs(slug: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/fc-ics-delete`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slug }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete failed (${res.status}): ${text}`);
  }
}

/** サーバーから読み戻した設定。項目は fc-ics-restore が返す物だけ */
export type RestoredOrder = Pick<
  OrderTicket,
  "v" | "includedIds" | "retention" | "eventLead" | "eventLeadOverrides" | "attendingNewsUids" | "paidNewsUids" | "watchNewsUids"
>;

export type RestoreResult =
  | { ok: true; order: RestoredOrder }
  | { ok: false; code: "not_found" | "legacy" | "other" };

/** 前に発行した同期URLの設定を読み戻す（機種変更・別の端末での引き継ぎ用） */
export async function restoreSubscription(slug: string): Promise<RestoreResult> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/fc-ics-restore`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slug }),
    });
  } catch {
    return { ok: false, code: "other" };
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* ignore */ }
  const b = (body ?? {}) as { order?: RestoredOrder; error?: unknown };
  if (!res.ok) {
    if (res.status === 404 && (b.error === "not_found" || b.error === "legacy")) return { ok: false, code: b.error };
    return { ok: false, code: "other" };
  }
  if (!b.order || b.order.v !== 2) return { ok: false, code: "other" };
  return { ok: true, order: b.order };
}
