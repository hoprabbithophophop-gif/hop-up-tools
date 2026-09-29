import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 前に発行した同期URL（slug）から、サーバーに保管した設定（注文票）を読み戻す。
// 機種変更や別の端末で開いた時に、同じ同期ファイルの続きとして使えるようにするため。
// 作法は fc-ics-upload と揃える（CORS・IPのハッシュ・1時間あたりの回数制限・service role）。

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 1時間あたりの上限。引き継ぎは端末ごとに1回あれば足りるので、保存（60回）より少なくする */
const RATE_LIMIT_PER_HOUR = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const ipRaw = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  // IP は秘密の値（サービス用の鍵）を混ぜてから変換する（fc-ics-upload と同じ形）
  const ipHash = await sha256(`fc-ics-restore:${ipRaw}:${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count: recentCount, error: rateError } = await supabase
    .from("rate_limit_log")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("endpoint", "fc-ics-restore")
    .gte("created_at", oneHourAgo);

  if (rateError) {
    return json({ error: "Rate check failed" }, 500);
  }
  if ((recentCount ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return json({ error: "Rate limit exceeded. Please try again later." }, 429);
  }

  let body: { slug?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { slug } = body;
  if (typeof slug !== "string" || !/^[a-z0-9]{32}$/.test(slug)) {
    return json({ error: "Invalid slug format" }, 400);
  }

  const { data: row, error: selectError } = await supabase
    .from("fc_subscriptions")
    .select("events")
    .eq("slug", slug)
    .maybeSingle();
  if (selectError) {
    return json({ error: "Failed to load subscription" }, 500);
  }
  if (!row) {
    return json({ error: "not_found" }, 404);
  }

  const events = row.events as Record<string, unknown> | null;
  // 注文票の形（v:2）より前に発行された同期は、端末へ戻せる材料を持っていない
  if (!events || typeof events !== "object" || events.v !== 2) {
    return json({ error: "legacy" }, 404);
  }

  // 端末へ戻すのに要る項目だけを返す（更新日時などサーバー側の管理情報は出さない）
  const order = {
    v: events.v,
    includedIds: events.includedIds,
    retention: events.retention,
    eventLead: events.eventLead,
    eventLeadOverrides: events.eventLeadOverrides,
    attendingNewsUids: events.attendingNewsUids,
    paidNewsUids: events.paidNewsUids,
    watchNewsUids: events.watchNewsUids,
  };

  await supabase.from("rate_limit_log").insert({
    ip_hash: ipHash,
    endpoint: "fc-ics-restore",
  });

  return json({ order });
});
