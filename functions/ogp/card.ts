/**
 * Cloudflare Pages Function: /ogp/card
 *
 * 以前は YouTube のサムネイルを 1200×630 に切り抜いて返していたが、
 * サムネイルを加工して自サイトから配らないよう、YouTube の元の画像へ 302 で案内するだけにした（2026-09-28）。
 * 新しく貼られた共有URLの og:image は最初から YouTube の画像を指す（functions/youtube/*.ts）。
 * この場所は、すでに X などに貼られた古いカードが画像を取りに来るために残している。
 *
 * クエリパラメータ:
 *   p - プレイリスト共有 ID（8文字 nanoid）
 *
 * プレイリストが無い・Supabase 障害の時は YouTube のデフォルトサムネへ 302。
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

  return Response.redirect(ogp.thumbnailUrl, 302);
}
