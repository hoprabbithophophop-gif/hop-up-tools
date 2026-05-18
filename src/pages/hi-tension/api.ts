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

/**
 * 過去セッションを「席」単位で取得する。
 * 1 行 = 1 セッション = 1 つの「席」。
 * bucket_indices は 0.1秒刻みのバケット番号配列(例: [59, 60, 63] = 5.9s, 6.0s, 6.3s に押した)。
 */
export type HiSession = {
  session_hash: number;
  member_id: string;
  is_today: boolean;
  bucket_indices: number[];
  played_date: string;
};

export async function fetchHiSessions(): Promise<HiSession[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("hi_aggregations")
    .select("session_hash, member_id, is_today, bucket_indices, played_date")
    .eq("video_id", VIDEO_ID);
  if (error) {
    console.error("[hi-tension] fetch sessions failed:", error);
    return [];
  }
  return (data ?? []) as HiSession[];
}
