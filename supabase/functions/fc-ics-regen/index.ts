import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assembleFromOrder, buildIcsLegacyFromEvents, type DeadlineRow } from "../_shared/icsAssemble.ts";
import type { OrderTicket, VenueGeo } from "../_shared/icsCore.ts";

// 毎回の締切データ取得（GAS・12時間ごと推奨）の直後に呼ばれる想定の見回り役。
// 「期限切れの間引き」ではなく「注文票＋最新の締切データで丸ごと作り直す」に変更した
// （案1）。これにより、選択済み公演の締切が後から訂正・追加されても、
// 次にここが回ったタイミングで購読者に自動で届く。
//
// 注文票(v=2)を持たない既存の購読（発行時に完成品スナップショットをそのまま保存していた
// 旧形式）は、互換ルート(buildIcsLegacyFromEvents)でこれまで通り動かし続ける。
// 旧形式のまま残る購読は、次にユーザーがSubscribe画面を開いて発行し直すと自然に新形式へ移る。

function isOrderTicket(events: unknown): events is OrderTicket {
  return typeof events === "object" && events !== null && (events as Record<string, unknown>).v === 2;
}

// fc_deadlines.id はUUID。UUIDの形をしていないidを問い合わせに混ぜると、
// 「UUIDとして不正」でその購読ぶんの作り直しが丸ごと失敗する（発行側と同じ守り）。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: venues } = await supabase
    .from("schedule_venues")
    .select("name, latitude, longitude")
    .not("latitude", "is", null);
  const venueGeoByName = new Map<string, VenueGeo>();
  for (const v of venues ?? []) {
    if (v.latitude == null || v.longitude == null) continue;
    venueGeoByName.set(v.name, { lat: Number(v.latitude), lon: Number(v.longitude) });
  }

  const { data: subs, error } = await supabase
    .from("fc_subscriptions")
    .select("slug, retention, events");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const now = new Date();
  let updatedOrders = 0;
  let updatedLegacy = 0;
  let failed = 0;

  for (const sub of subs ?? []) {
    try {
      let ics: string;
      if (isOrderTicket(sub.events)) {
        const order = sub.events;
        // 選択済みidの「今の」内容を読み直す。記事削除等でidが無くなった分は自然に外れる。
        const { data: deadlineRows, error: dlError } = await supabase
          .from("fc_deadlines")
          .select("id, news_uid, type, label, deadline_at, location, open_at, fc_news(title, detail_url, category)")
          .in("id", order.includedIds.filter((id) => UUID_RE.test(id)));
        if (dlError) throw new Error(dlError.message);
        ics = assembleFromOrder(order, (deadlineRows ?? []) as DeadlineRow[], venueGeoByName, now);
        updatedOrders++;
      } else {
        const events = Array.isArray(sub.events) ? sub.events : [];
        ics = buildIcsLegacyFromEvents(events, venueGeoByName, now, sub.retention);
        updatedLegacy++;
      }
      const { error: upErr } = await supabase.storage
        .from("fc-ics")
        .upload(`${sub.slug}.ics`, ics, { contentType: "text/calendar", upsert: true });
      if (upErr) throw new Error(upErr.message);
    } catch (e) {
      failed++;
      console.error(`regen failed for ${sub.slug}:`, e instanceof Error ? e.message : String(e));
    }
  }

  return new Response(
    JSON.stringify({ ok: true, subscriptions: (subs ?? []).length, updatedOrders, updatedLegacy, failed }),
    { headers: { "Content-Type": "application/json" } }
  );
});
