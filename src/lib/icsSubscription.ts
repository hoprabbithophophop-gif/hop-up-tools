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
