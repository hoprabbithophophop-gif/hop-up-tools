/**
 * fc-ics Edge Function 経由でICSサブスクリプションをアップロード/削除する
 */
import type { IcsEvent } from "./ics";

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
  ics: string,
  events?: IcsEvent[],
  retention?: string,
): Promise<SubscriptionUrls> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/fc-ics-upload`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    // events / retention は再生成（保持期限による自動削除）用にサーバ保存される
    body: JSON.stringify({ slug, ics, events, retention }),
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
