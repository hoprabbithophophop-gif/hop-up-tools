import { getSupabase } from "@/lib/supabase";
import { VIDEO_ID } from "./data";

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: string };

export async function submitHiSession(params: {
  memberId: string;
  timestamps: number[];
  anonymousSessionId: string;
  /** どのスペシャル回(お祝い等)で遊んだか。通常練習は null。練習勢と分離するためDBに記録する。 */
  specialEventKey?: string | null;
  /** どの練習映像か。省略時は既定のLIVE映像。映像ごとに✋プールを分けるため記録する。 */
  videoId?: string;
}): Promise<SubmitResult> {
  const supabase = getSupabase();
  const eventKey = params.specialEventKey ?? null;
  const { data, error } = await supabase.functions.invoke("submit-hi-session", {
    body: {
      video_id: params.videoId ?? VIDEO_ID,
      member_id: params.memberId,
      timestamps: params.timestamps,
      anonymous_session_id: params.anonymousSessionId,
      // 新クライアント＝どの回かをキーで送る。Edge Function が未対応の間は無視される（無害）。
      special_event_key: eventKey,
      // 旧来の boolean も併送（後方互換。Edge/DB が special_mode を見続けても壊れない）。
      special_mode: eventKey != null,
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
  /** どのスペシャル回の席か（null=通常練習）。古いビューには無いので optional。
   *  客席分離は基本これで判定し、未定義なら special_mode にフォールバックする。 */
  special_event_key?: string | null;
  /** その席が何回✋を挙げたか。名簿だけ先に配る読み方（下記 fetchHiSessionRoster）では
   *  bucket_indices がまだ空なので、歴代累計はこの数で数える。全件を一度に読む
   *  従来の道では付かないので optional（無ければ bucket_indices.length を数える）。 */
  hi_count?: number;
};

// Supabase/PostgREST は1リクエストの返却行数に上限(既定1000行)がある。
// 並び順を指定せず取ると、総数が1000行を超えた時点で「返る1000行」が毎回入れ替わり、
// 客席の欠落や累計の増減（お祝い総数がフェッチごとに変動）が起きる。
// → session_hash で並びを固定し、1000行ずつ range でページングして全件取得する。
const FETCH_PAGE = 1000;
export async function fetchHiSessions(videoId: string = VIDEO_ID): Promise<HiSession[]> {
  // 本番: CDNキャッシュ済みエンドポイントを優先（訪問者ごとの全件読みでDisk IOを食わない）。
  // ローカル開発(関数が動かない)やエンドポイント障害時は、従来の直Supabaseにフォールバック。
  try {
    const res = await fetch(`/api/hi-sessions?video_id=${encodeURIComponent(videoId)}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) return (await res.json()) as HiSession[];
  } catch {
    /* フォールバックへ */
  }
  return fetchHiSessionsDirect(videoId);
}

async function fetchHiSessionsDirect(videoId: string = VIDEO_ID): Promise<HiSession[]> {
  const supabase = getSupabase();
  const all: HiSession[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from("hi_aggregations")
      .select("session_hash, member_id, is_today, bucket_indices, bucket_indices_20, played_date, special_mode, special_event_key")
      .eq("video_id", videoId)
      .order("session_hash", { ascending: true }) // セッション毎に一意（並び固定でページ境界がブレない）
      .range(from, from + FETCH_PAGE - 1);
    if (error) {
      console.error("[hi-tension] fetch sessions failed:", error);
      return all; // 途中まで取れた分は活かす（全滅させない）
    }
    const rows = (data ?? []) as HiSession[];
    all.push(...rows);
    if (rows.length < FETCH_PAGE) break;      // 最終ページ
    if (from > 500_000) break;                // 暴走ブレーキ（理論上届かない）
  }
  return all;
}

// ───────── 名簿を先に、タップの中身は 30 秒の区間ごとに ─────────
// 本番の全件は 7.3MB あり、読み終わるまで席が決まらないので最初の✋が遅れる。
// 席の割り当ては session_hash だけで決まる（HandsCanvas の sessionLayout）ので、
// 名簿（誰がいたか）さえ届けば席は確定し、タップの中身は後から足しても席は動かない。

/** 1 区間の長さ（秒）。サーバー側 _hi-sessions-parts.ts と必ず同じ値にする。 */
export const HI_SEGMENT_SECONDS = 30;
/** bucket_indices は 0.1 秒刻み ＝ 30 秒で 300 目盛り。区間数の逆算に使う。 */
const BUCKETS_PER_SEGMENT_10 = HI_SEGMENT_SECONDS * 10;

/** 区間で届く 1 行。誰の分かが分かる番号と、その 30 秒に入るタップだけ。 */
export type HiSessionSegmentRow = {
  session_hash: number;
  bucket_indices: number[];
  bucket_indices_20?: number[];
};

export type HiSessionRoster = {
  /** bucket_indices / bucket_indices_20 はまだ空（区間で後から埋める）。 */
  sessions: HiSession[];
  /** 全席を通した bucket_indices の最大値。ここから区間がいくつあるかを出す。 */
  maxBucket: number;
};

/** maxBucket から区間の数を出す。0 件でも 1 は返す。 */
export function hiSegmentCount(maxBucket: number): number {
  if (!(maxBucket >= 0)) return 1;
  return Math.floor(maxBucket / BUCKETS_PER_SEGMENT_10) + 1;
}

/**
 * 名簿だけを取る。失敗したら null（呼び出し側は全件読みへ落ちる）。
 *
 * 手元の開発サーバーでは /api/... が index.html を 200 で返してくるので、
 * 「200 だった」だけでは足りない。JSON として読めるか・形が合っているかまで見て、
 * 違えば null を返す（空っぽの客席を本物として描いてしまわないため）。
 */
export async function fetchHiSessionRoster(videoId: string = VIDEO_ID): Promise<HiSessionRoster | null> {
  try {
    const res = await fetch(`/api/hi-sessions?video_id=${encodeURIComponent(videoId)}&part=roster`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== "object") return null;
    const { sessions, maxBucket } = body as { sessions?: unknown; maxBucket?: unknown };
    if (!Array.isArray(sessions) || typeof maxBucket !== "number") return null;
    // 名簿の行には目盛り表が無いので、空の入れ物を付けてから渡す。
    // bucket_indices_20 は「まだ無い」ままにする。空配列を入れると、細かい列を
    // 持たない古い席でも「細かい列がある」と見なされ、粗い列からの読み替えが止まるため。
    return {
      sessions: (sessions as HiSession[]).map((s) => ({ ...s, bucket_indices: [] })),
      maxBucket,
    };
  } catch {
    return null;
  }
}

/** seg 番目の 30 秒区間を取る。失敗したら null。 */
export async function fetchHiSessionSegment(
  videoId: string,
  seg: number,
): Promise<HiSessionSegmentRow[] | null> {
  try {
    const res = await fetch(
      `/api/hi-sessions?video_id=${encodeURIComponent(videoId)}&part=seg&seg=${seg}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return null;
    return body as HiSessionSegmentRow[];
  } catch {
    return null;
  }
}

/**
 * 届いた区間を名簿に合流させる。
 * ・名簿に無い session_hash は捨てる（塊のキャッシュが 45 秒でずれ、名簿より後に
 *   入った席が区間にだけ現れることがある。席の数が途中で変わると席替えが起きる）。
 * ・席の集合を変えないので、この合流で誰の席も動かない。
 */
export function mergeHiSessionSegment(
  prev: HiSession[],
  rows: HiSessionSegmentRow[],
): HiSession[] {
  if (rows.length === 0) return prev;
  const byHash = new Map<number, HiSessionSegmentRow>();
  for (const r of rows) byHash.set(r.session_hash, r);
  return prev.map((s) => {
    const add = byHash.get(s.session_hash);
    if (!add) return s;
    const next: HiSession = {
      ...s,
      bucket_indices: s.bucket_indices.concat(add.bucket_indices ?? []),
    };
    // 細かい列は、区間が持ってきた時だけ足す（持っていない古い席は「無い」ままにする）。
    if (add.bucket_indices_20 != null) {
      next.bucket_indices_20 = (s.bucket_indices_20 ?? []).concat(add.bucket_indices_20);
    }
    return next;
  });
}

/**
 * 盛り上がりタイムライン（ヒートマップ）の集計をサーバー側RPCで取得する。
 * 全セッションを落として集計するのではなく、サーバーで時間ビンに畳んだ小さな配列だけ返す
 * （転送量・読み込みIOを抑える）。eventKey=null は通常練習、文字列はそのスペシャル回。
 */
export type HiHeatmap = {
  /** 各時間ビンの総タップ数（長さ=bin_count）。 */
  bins: number[];
  binSeconds: number;
  totalSessions: number;
  totalTaps: number;
};

export async function fetchHiHeatmap(
  eventKey: string | null,
  binCount = 256,
  videoId: string = VIDEO_ID,
): Promise<HiHeatmap | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("hi_heatmap", {
    p_video_id: videoId,
    p_bin_count: binCount,
    p_event_key: eventKey,
  });
  if (error) {
    console.warn("[hi-tension] heatmap fetch failed:", error.message);
    return null;
  }
  // RPC は1行（table関数）を返す。配列の先頭を取る。
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    bins: (row.bins ?? []) as number[],
    binSeconds: Number(row.bin_seconds ?? 1),
    totalSessions: Number(row.total_sessions ?? 0),
    totalTaps: Number(row.total_taps ?? 0),
  };
}

/** 複数の色（メンバー）の記録を1回でまとめて送る（灰toダイヤモンド💎用。曲中に色を替えられるので、
 *  色ごとに分けた記録を1件の送信にする。受け口は1つの回線から1分10件までなので、色の数だけ送ると溢れる） */
export async function submitHiSessions(params: {
  sessions: { memberId: string; timestamps: number[] }[];
  anonymousSessionId: string;
  videoId?: string;
}): Promise<SubmitResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke("submit-hi-session", {
    body: {
      video_id: params.videoId ?? VIDEO_ID,
      sessions: params.sessions.map((s) => ({ member_id: s.memberId, timestamps: s.timestamps })),
      anonymous_session_id: params.anonymousSessionId,
      special_event_key: null,
      special_mode: false,
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
