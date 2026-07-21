// 会場名 → 座標の辞書（schedule_venues 会場マスタ由来）
//
// fc-ticket のデータ読込時に一度だけ取得してモジュール内に保持する。
// 画面の描画はデータ読込完了後に始まるので、参照時には辞書が揃っている。
// 会場が辞書に無い場合は null ＝ 従来どおり会場名テキストだけのカレンダー予定になる。
//
// 座標を引く純粋なロジック（geoForLocation・誤字補正表・地図検索URL）は ./icsCore に移した
// （サーバー側の購読ICS組み立てでも同じ辞書引きが必要なため）。ここでは読み込みだけを担う。
import type { SupabaseClient } from "@supabase/supabase-js";
import { geoForLocation as geoForLocationCore, mapSearchUrl, type VenueGeo } from "./icsCore";

export type { VenueGeo };
export { mapSearchUrl };

const venueGeoByName = new Map<string, VenueGeo>();

export async function loadVenueGeo(sb: SupabaseClient): Promise<void> {
  const { data } = await sb
    .from("schedule_venues")
    .select("name, latitude, longitude")
    .not("latitude", "is", null);
  for (const v of data ?? []) {
    if (v.latitude == null || v.longitude == null) continue;
    venueGeoByName.set(v.name, { lat: Number(v.latitude), lon: Number(v.longitude) });
  }
}

/** fc_deadlines.location「会場名 （都道府県）」→ 会場名で座標を引く */
export function geoForLocation(location: string | null | undefined): VenueGeo | null {
  return geoForLocationCore(location, venueGeoByName);
}
