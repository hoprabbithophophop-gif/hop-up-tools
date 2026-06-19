/**
 * Cloudflare Pages Function: /api/hi-sessions?video_id=...
 *
 * hi-tension の客席・歴代累計に使うセッション一覧を返す。
 * 目的は「Disk IO 節約」。各訪問者が直接 Supabase の全件を読むと、
 * アクセスが増えた時にディスク読み取りが膨らむ（hi_sessions ≈ 6MB を毎回フル走査）。
 * ここで一度読んだら CDN エッジに数十秒キャッシュし、以後の訪問者には Supabase を
 * 叩かずに配る。これで「読みの回数 = 訪問者数」が「読みの回数 ≈ 数十秒に1回」になる。
 *
 * 返すデータの形は従来のクライアント直読みと完全に同じ（HiSession[] 相当）。
 * クライアントはこのエンドポイントが失敗した時だけ直 Supabase にフォールバックする。
 */

interface Env {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

/** エッジキャッシュの寿命（秒）。短いほど鮮度↑/ブレーキ効果↓。累計・客席なので数十秒で気づかれない。 */
const TTL_SECONDS = 45;
/** PostgREST の1ページ上限。view が1000行超でもページングして全件返す。 */
const PAGE = 1000;
/** 従来クライアントと同じ列だけ取る（形を変えない）。 */
const SELECT =
  'session_hash,member_id,is_today,bucket_indices,bucket_indices_20,played_date,special_mode,special_event_key';

export async function onRequest(context: {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const videoId = url.searchParams.get('video_id');

  // 必要情報が無い時は「空配列」を返す（壊さない＝クライアントは0件として描画 or フォールバック）。
  if (!videoId || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    return json('[]', 0);
  }

  // --- エッジキャッシュ（訪問者をまたいで共有） ---
  // @ts-ignore caches は CF Workers/Pages のグローバル
  const cache = caches.default as Cache;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // --- キャッシュ無し: Supabase を読む ---
  const headers = {
    apikey: env.VITE_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
    Accept: 'application/json',
  };
  const all: unknown[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const endpoint =
      `${env.VITE_SUPABASE_URL}/rest/v1/hi_aggregations` +
      `?video_id=eq.${encodeURIComponent(videoId)}` +
      `&select=${SELECT}` +
      `&order=session_hash.asc` +
      `&limit=${PAGE}&offset=${offset}`;
    let res: Response;
    try {
      res = await fetch(endpoint, { headers });
    } catch {
      // 取得失敗。ここまで取れた分は返さず、クライアントを直読みフォールバックに回す（502）。
      return new Response('upstream fetch failed', { status: 502 });
    }
    if (!res.ok) return new Response('upstream error', { status: 502 });
    const rows = (await res.json()) as unknown[];
    all.push(...rows);
    if (rows.length < PAGE) break; // 最終ページ
    if (offset > 500_000) break; // 暴走ブレーキ（理論上届かない）
  }

  const out = json(JSON.stringify(all), TTL_SECONDS);
  // レスポンスを返しつつ裏でキャッシュへ保存（次の訪問者はここを読む）。
  context.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

function json(body: string, ttl: number): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': ttl > 0 ? `public, s-maxage=${ttl}` : 'no-store',
    },
  });
}
