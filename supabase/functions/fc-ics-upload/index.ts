import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assembleFromOrder, type DeadlineRow } from "../_shared/icsAssemble.ts";
import type { OrderTicket, EventLeadSetting, VenueGeo } from "../_shared/icsCore.ts";

// 「注文票」を受け取り、その場で最新の締切データと突き合わせてICSを組み立てて棚に置く。
// 中身の組み立て方は毎日の見回り(fc-ics-regen)と同じレシピ(../_shared/icsAssemble.ts)を使う
// ＝発行した直後と翌朝で中身がズレることがない（案1・組み立て役の一本化）。

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

const RETENTION_VALUES = ["after-event-1m", "6m", "forever"];
const MAX_INCLUDED = 1000; // 悪意あるリクエストで巨大な注文票を送られないための上限

function isEventLeadSetting(v: unknown): v is EventLeadSetting {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const hoursOk = o.hours === null || (typeof o.hours === "number" && o.hours >= 1 && o.hours <= 24);
  return hoursOk && typeof o.dayBefore === "boolean";
}

function validateOrder(order: unknown): order is OrderTicket {
  if (typeof order !== "object" || order === null) return false;
  const o = order as Record<string, unknown>;
  if (o.v !== 2) return false;
  if (!Array.isArray(o.includedIds) || o.includedIds.length === 0 || o.includedIds.length > MAX_INCLUDED) return false;
  if (!o.includedIds.every((id) => typeof id === "string")) return false;
  if (typeof o.retention !== "string" || !RETENTION_VALUES.includes(o.retention)) return false;
  if (!isEventLeadSetting(o.eventLead)) return false;
  if (typeof o.eventLeadOverrides !== "object" || o.eventLeadOverrides === null) return false;
  if (!Object.values(o.eventLeadOverrides as Record<string, unknown>).every(isEventLeadSetting)) return false;
  if (!Array.isArray(o.attendingNewsUids) || !o.attendingNewsUids.every((u) => typeof u === "string")) return false;
  // paidNewsUids は省略可。必須にすると、古い画面から送られた注文票を弾いてしまい発行が全滅する
  // （2026-08-01に同種の噛み合わせで実際に起きた）。無ければ「1件も入金済みでない」として扱う。
  if (o.paidNewsUids !== undefined) {
    if (!Array.isArray(o.paidNewsUids) || !o.paidNewsUids.every((u) => typeof u === "string")) return false;
  }
  return true;
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
    .eq("endpoint", "fc-ics-upload")
    .gte("created_at", oneHourAgo);

  if (rateError) {
    return json({ error: "Rate check failed" }, 500);
  }
  if ((recentCount ?? 0) >= 60) {
    return json({ error: "Rate limit exceeded. Please try again later." }, 429);
  }

  let body: { slug?: unknown; order?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { slug, order } = body;

  if (typeof slug !== "string" || !/^[a-z0-9]{32}$/.test(slug)) {
    return json({ error: "Invalid slug format" }, 400);
  }
  if (!validateOrder(order)) {
    return json({ error: "Invalid order format" }, 400);
  }

  // 最新の締切データを注文票のidぶんだけ読み直す（ここが「作り置き」→「作り直し」の要）。
  // fc_deadlines.id はUUIDなので、UUIDの形をしていないidは問い合わせ前に落とす。
  // 画面には過去にe-LineUP由来の疑似的な行（id="goods:イベント名|日時"）が並んでいた時期があり、
  // その選択がブラウザに残っていると、そのまま問い合わせて「UUIDとして不正」で丸ごと失敗し、
  // 発行そのものができなくなる（2026-08-01に発生）。存在しないidは元々自然に外れる仕組みなので、
  // ここで落としても取りこぼしは増えない。
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const wantedIds = order.includedIds.filter((id) => UUID_RE.test(id));
  const droppedIds = order.includedIds.length - wantedIds.length;
  if (droppedIds > 0) {
    console.warn(`skipped ${droppedIds} non-uuid id(s) in order for ${slug}`);
  }
  if (wantedIds.length === 0) {
    return json({ error: "配信できる予定がありません（選択した予定が見つかりませんでした）" }, 400);
  }

  const { data: deadlineRows, error: dlError } = await supabase
    .from("fc_deadlines")
    .select("id, news_uid, type, label, deadline_at, location, open_at, fc_news(title, detail_url, category)")
    .in("id", wantedIds);
  if (dlError) {
    return json({ error: "Failed to load deadlines: " + dlError.message }, 500);
  }

  const { data: venues } = await supabase
    .from("schedule_venues")
    .select("name, latitude, longitude")
    .not("latitude", "is", null);
  const venueGeoByName = new Map<string, VenueGeo>();
  for (const v of venues ?? []) {
    if (v.latitude == null || v.longitude == null) continue;
    venueGeoByName.set(v.name, { lat: Number(v.latitude), lon: Number(v.longitude) });
  }

  const ics = assembleFromOrder(order, (deadlineRows ?? []) as DeadlineRow[], venueGeoByName, new Date());
  if (ics.length > 1048576) {
    return json({ error: "Content too large (>1MB)" }, 413);
  }
  if (!ics.includes("BEGIN:VEVENT")) {
    return json({ error: "配信できる予定がありません（選択した予定が見つかりませんでした）" }, 400);
  }

  const { error: uploadError } = await supabase.storage
    .from("fc-ics")
    .upload(`${slug}.ics`, ics, {
      contentType: "text/calendar",
      upsert: true,
    });
  if (uploadError) {
    return json({ error: "Upload failed: " + uploadError.message }, 500);
  }

  // 注文票そのものを控えとして保存（毎日の見回りが最新データで作り直す材料）。
  // 旧方式では控えは補助情報だったが、作り直し方式では控えが本体。
  // ここが失敗したまま成功を返すと、URLは生きているのに毎日の作り直しの対象から外れ、
  // 二度と更新されない置き去りのカレンダーができてしまう。必ず失敗として返す。
  // （配信ファイルの保存は上書き方式なので、利用者がやり直せば同じ内容で作り直される）
  const { error: manifestError } = await supabase
    .from("fc_subscriptions")
    .upsert({ slug, retention: order.retention, events: order, updated_at: new Date().toISOString() });
  if (manifestError) {
    console.error("manifest upsert failed:", manifestError.message);
    return json({ error: "設定の保存に失敗しました。もう一度お試しください。" }, 500);
  }

  await supabase.from("rate_limit_log").insert({
    ip_hash: ipHash,
    endpoint: "fc-ics-upload",
  });

  const url = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/fc-ics/${slug}.ics`;
  return json({ url, slug });
});
