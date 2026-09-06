/**
 * Cloudflare Pages Function: /api/hai-to-diamond-replay?video_id=...
 *
 * 灰toダイヤモンド💎の「みんなの💎を降らせる」ための集計を返す。
 * 中身は Supabase の RPC hi_diamond_replay（時刻0.05秒刻み×メンバーごとの個数）で、
 * /api/hi-sessions と同じく CDN エッジに数十秒キャッシュして、訪問者ごとに DB を叩かない。
 *
 * 返す形: [{ member_id, buckets: number[], counts: number[] }, ...]
 * クライアントはこのエンドポイントが失敗した時だけ直 Supabase の RPC にフォールバックする。
 */

interface Env {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

/** エッジキャッシュの寿命（秒）。/api/hi-sessions と同じ。 */
const TTL_SECONDS = 45;

export async function onRequest(context: {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const videoId = url.searchParams.get('video_id');

  if (!videoId || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    return json('[]', 0);
  }

  // @ts-ignore caches は CF Workers/Pages のグローバル
  const cache = caches.default as Cache;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let res: Response;
  try {
    res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/hi_diamond_replay`, {
      method: 'POST',
      headers: {
        apikey: env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ p_video_id: videoId }),
    });
  } catch {
    return new Response('upstream fetch failed', { status: 502 });
  }
  if (!res.ok) return new Response('upstream error', { status: 502 });

  const out = json(await res.text(), TTL_SECONDS);
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
