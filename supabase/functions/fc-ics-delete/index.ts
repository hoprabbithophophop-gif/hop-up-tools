import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const ipRaw = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const ipHash = await sha256(ipRaw);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count: recentCount, error: rateError } = await supabase
    .from("rate_limit_log")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("endpoint", "fc-ics-delete")
    .gte("created_at", oneHourAgo);

  if (rateError) {
    return json({ error: "Rate check failed" }, 500);
  }
  if ((recentCount ?? 0) >= 60) {
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

  const { error } = await supabase.storage.from("fc-ics").remove([`${slug}.ics`]);
  if (error) {
    return json({ error: "Delete failed: " + error.message }, 500);
  }

  // 再生成用マニフェストも削除（残すと翌日の再生成でICSが復活してしまう）。
  await supabase.from("fc_subscriptions").delete().eq("slug", slug);

  await supabase.from("rate_limit_log").insert({
    ip_hash: ipHash,
    endpoint: "fc-ics-delete",
  });

  return json({ ok: true });
});
