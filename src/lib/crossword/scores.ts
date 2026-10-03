// クリアタイムのランキング。HarmonyPalette の saveScore / getPuzzleRankings の置き換え。
// 書くのは受付係（/api/crossword-score）だけ。読むのは crossword_scores を公開用の鍵で（隠された記録・問題は RLS が返さない）。
import { getSupabase } from "../supabase";

const PLAYER_KEY = "crossword_player_key";
const QUEUE_KEY = "crossword_queued_scores";

// 端末の見分け用の番号。32 バイトの乱数の16進64字。受付係はこの sha256 だけを残す
export function getPlayerKey(): string {
  try {
    const saved = localStorage.getItem(PLAYER_KEY);
    if (saved && /^[0-9a-f]{64}$/.test(saved)) return saved;
  } catch {
    /* 下で作る */
  }
  const key = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(PLAYER_KEY, key);
  } catch {
    /* 置けなくても今回は送れる（次は別の人として扱われる） */
  }
  return key;
}

export class ScoreError extends Error {
  constructor(public reason: string) {
    super(`score failed: ${reason}`);
  }
}

export async function saveScore(puzzleId: string, timeSeconds: number, name = ""): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/crossword-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ puzzleId, timeSeconds, name, playerKey: getPlayerKey() }),
    });
  } catch {
    throw new ScoreError("network");
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: unknown };
  if (res.ok && data.ok) return;
  throw new ScoreError(typeof data.reason === "string" ? data.reason : "server");
}

export interface RankingEntry {
  rank: number;
  displayName: string;
  timeSeconds: number;
  completedAt: Date;
}

export async function getPuzzleRankings(puzzleId: string, limitCount = 10): Promise<RankingEntry[]> {
  const { data, error } = await getSupabase()
    .from("crossword_scores")
    .select("display_name,time_seconds,updated_at")
    .eq("puzzle_id", puzzleId)
    .order("time_seconds", { ascending: true })
    .order("updated_at", { ascending: true })
    .limit(limitCount);
  if (error) throw error;
  // 同じ人の記録は棚で1つにまとまっている（unique）ので、HarmonyPalette の重なり除けは要らない
  return ((data as { display_name: string; time_seconds: number; updated_at: string }[] | null) ?? []).map((r, i) => ({
    rank: i + 1,
    displayName: r.display_name,
    timeSeconds: r.time_seconds,
    completedAt: new Date(r.updated_at),
  }));
}

// --- 送れなかった記録の控え（HarmonyPalette の queued_scores と同じ動き） ---
interface QueuedScore {
  puzzleId: string;
  timeSeconds: number;
  playerName: string;
  timestamp: number;
}

function readQueue(): QueuedScore[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((s): s is QueuedScore => !!s && typeof s.puzzleId === "string" && typeof s.timeSeconds === "number" && typeof s.playerName === "string")
      : [];
  } catch {
    return [];
  }
}

function writeQueue(list: QueuedScore[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list));
  } catch {
    /* 置けなければ控えない */
  }
}

export function queueScore(puzzleId: string, timeSeconds: number, playerName: string) {
  writeQueue([...readQueue(), { puzzleId, timeSeconds, playerName, timestamp: Date.now() }]);
}

export async function retryQueuedScores(): Promise<void> {
  if (!navigator.onLine) return;
  const queued = readQueue();
  if (queued.length === 0) return;
  const sent: number[] = [];
  for (let i = 0; i < queued.length; i++) {
    const s = queued[i];
    try {
      await saveScore(s.puzzleId, s.timeSeconds, s.playerName);
      sent.push(i);
    } catch (error) {
      // つながらない以外の理由（形が合わない・問題が消された）で断られた物は、何度送っても通らないので控えから外す
      if (error instanceof ScoreError && error.reason === "bad_request") sent.push(i);
      else console.error("[Score Queue] Failed to save score:", error);
    }
  }
  if (sent.length > 0) writeQueue(readQueue().filter((s) => !sent.some((i) => queued[i].timestamp === s.timestamp && queued[i].puzzleId === s.puzzleId)));
}
