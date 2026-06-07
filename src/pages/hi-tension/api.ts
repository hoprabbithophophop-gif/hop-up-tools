import { getSupabase } from "@/lib/supabase";
import { VIDEO_ID } from "./data";

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: string };

export async function submitHiSession(params: {
  memberId: string;
  timestamps: number[];
  anonymousSessionId: string;
  /** スペシャル仕様(お祝い等)モードで遊んだか。練習勢と分離するためDBに記録する汎用フラグ。 */
  specialMode?: boolean;
}): Promise<SubmitResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke("submit-hi-session", {
    body: {
      video_id: VIDEO_ID,
      member_id: params.memberId,
      timestamps: params.timestamps,
      anonymous_session_id: params.anonymousSessionId,
      special_mode: params.specialMode === true,
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
  /** 0.05秒刻みのバケット番号配列(例: [119, 120] = 5.95s, 6.00s)。
   *  従来の bucket_indices(0.1秒刻み) より細かく、人間の叩くブレを潰さず再現するための列。
   *  古いビューには無いので optional（無ければ bucket_indices を2倍して近似する）。 */
  bucket_indices_20?: number[];
  played_date: string;
  /** スペシャル仕様(お祝い等)の席か。練習勢=false。古いビューには無いので optional（未定義=false扱い）。 */
  special_mode?: boolean;
};

export async function fetchHiSessions(): Promise<HiSession[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("hi_aggregations")
    .select("session_hash, member_id, is_today, bucket_indices, bucket_indices_20, played_date, special_mode")
    .eq("video_id", VIDEO_ID);
  if (error) {
    console.error("[hi-tension] fetch sessions failed:", error);
    return [];
  }
  return (data ?? []) as HiSession[];
}
