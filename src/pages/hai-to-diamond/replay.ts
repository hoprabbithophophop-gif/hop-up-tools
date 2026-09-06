// みんなの記録（集計）の取得。
// 本番は CDN キャッシュ付きの /api/hai-to-diamond-replay を読み、失敗時だけ直 Supabase の RPC に落ちる。
import { getSupabase } from "@/lib/supabase";

export type ReplayRow = {
  member_id: string;
  /** 0.05秒刻みの時刻番号（昇順） */
  buckets: number[];
  /** buckets と同じ並びの、その時刻に押された個数 */
  counts: number[];
};

export async function fetchReplay(videoId: string): Promise<ReplayRow[]> {
  try {
    const res = await fetch(`/api/hai-to-diamond-replay?video_id=${encodeURIComponent(videoId)}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) return (await res.json()) as ReplayRow[];
  } catch {
    /* フォールバックへ */
  }
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("hi_diamond_replay", { p_video_id: videoId });
  if (error) {
    console.warn("[hai-to-diamond] replay fetch failed:", error.message);
    return [];
  }
  return (data ?? []) as ReplayRow[];
}
