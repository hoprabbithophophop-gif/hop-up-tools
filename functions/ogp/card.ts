/**
 * Cloudflare Pages Function: /ogp/card
 *
 * OGP カード画像（1200×630）を動的生成して返す。
 * og:image として /youtube 系ルートが参照する。
 *
 * クエリパラメータ:
 *   p - プレイリスト共有 ID（8文字 nanoid）
 *
 * 処理フロー:
 *   1. Supabase からプレイリスト情報を取得
 *   2. 1曲目の YouTube サムネを 1200×630 にセンタークロップ（cf.image）して返す
 *
 * フォールバック:
 *   - プレイリスト不在: YouTube デフォルトサムネへ 302
 *   - thumbnailUrl が無効（9412 等）: thumbnailUrl へ 302
 *   - Supabase 障害: YouTube デフォルトサムネへ 302
 */

import { fetchOgpData } from '../_shared/ogp';

interface Env {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

/** YouTube が確実に持つデフォルトサムネ */
const FALLBACK = 'https://i.ytimg.com/vi/default/hqdefault.jpg';

export async function onRequest(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const playlistId = url.searchParams.get('p');

  if (!playlistId || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    return Response.redirect(FALLBACK, 302);
  }

  let ogp;
  try {
    ogp = await fetchOgpData(playlistId, env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  } catch {
    return Response.redirect(FALLBACK, 302);
  }

  if (!ogp) return Response.redirect(FALLBACK, 302);

  // @ts-ignore – cf は CF Workers グローバル
  const imageRes = await fetch(ogp.thumbnailUrl, {
    cf: {
      image: {
        width: 1200,
        height: 630,
        fit: 'cover',
        format: 'jpeg',
        quality: 85,
      },
    } as unknown,
  });

  if (!imageRes.ok || !imageRes.headers.get('content-type')?.startsWith('image/')) {
    return Response.redirect(ogp.thumbnailUrl, 302);
  }

  return new Response(imageRes.body, {
    headers: {
      'Content-Type': imageRes.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
    },
  });
}
