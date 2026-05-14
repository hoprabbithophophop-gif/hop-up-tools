import { getSupabase } from "@/lib/supabase";
import { VIDEO_ID } from "./data";

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: string };

export async function submitHiSession(params: {
  memberId: string;
  timestamps: number[];
  anonymousSessionId: string;
}): Promise<SubmitResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke("submit-hi-session", {
    body: {
      video_id: VIDEO_ID,
      member_id: params.memberId,
      timestamps: params.timestamps,
      anonymous_session_id: params.anonymousSessionId,
    },
  });
  if (error) {
    console.error("[hi-tension] submit failed:", error);
    return { ok: false, error: error.message ?? "unknown" };
  }
  if (data && typeof data === "object" && "error" in data) {
    return { ok: false, error: String((data as { error: unknown }).error) };
  }
  return { ok: true };
}

export type AggregationBucket = {
  bucket_decisec: number;   // 0.1秒刻みのバケットIDX (例: 24 = 2.4秒)
  member_id: string;
  is_today: boolean;
  hi_count: number;
};

export async function fetchHiAggregations(): Promise<AggregationBucket[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("hi_aggregations")
    .select("bucket_decisec, member_id, is_today, hi_count")
    .eq("video_id", VIDEO_ID);
  if (error) {
    console.error("[hi-tension] fetch aggregations failed:", error);
    return [];
  }
  return (data ?? []) as AggregationBucket[];
}
