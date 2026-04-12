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
 *   2. 1曲目の YouTube サムネを 1200×630 にクロップ（cf.image）
 *   3. テキストオーバーレイ SVG を draw で重ねる（cf.image.draw）
 *   4. 合成済み JPEG を返す
 *
 * cf.image が pages.dev で無効だった場合:
 *   → 元サムネ (480×360) が返るだけでフォールバックされる（500 にならない）
 *
 * フォールバック（プレイリスト不在）:
 *   → 302 で YouTube のデフォルトサムネにリダイレクト
 */

import { fetchOgpData } from '../_shared/ogp';

interface Env {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

/** YouTube が確実に持つデフォルトサムネ（プレイリスト不在時のフォールバック） */
const FALLBACK_THUMB = 'https://i.ytimg.com/vi/default/hqdefault.jpg';

export async function onRequest(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const playlistId = url.searchParams.get('p');

  if (!playlistId || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return Response.redirect(FALLBACK_THUMB, 302);
  }

  let ogp;
  try {
    ogp = await fetchOgpData(playlistId, env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  } catch {
    return Response.redirect(FALLBACK_THUMB, 302);
  }

  if (!ogp) return Response.redirect(FALLBACK_THUMB, 302);

  // テキストオーバーレイ SVG URL
  // text-svg.ts が返す SVG は 1200×630 の固定サイズ
  const textSvgUrl =
    `${url.origin}/ogp/text-svg` +
    `?title=${encodeURIComponent(ogp.displayTitle)}` +
    `&desc=${encodeURIComponent(ogp.ogDescription)}`;

  // YouTube サムネを 1200×630 にクロップしてテキストを重ねる
  // @ts-ignore – cf は CF Workers グローバル
  const imageRes = await fetch(ogp.thumbnailUrl, {
    cf: {
      image: {
        width: 1200,
        height: 630,
        fit: 'cover',      // 4:3 → 1.91:1 にセンタークロップ
        format: 'jpeg',
        quality: 85,
        draw: [
          {
            url: textSvgUrl,
            // SVG が 1200×630 で描画されるので位置指定不要（top:0, left:0 がデフォルト）
          },
        ],
      },
    } as unknown,
  });

  // cf.image が無効でも imageRes は元のサムネを返す（フォールバック許容）
  if (!imageRes.ok) {
    return Response.redirect(ogp.thumbnailUrl, 302);
  }

  return new Response(imageRes.body, {
    headers: {
      'Content-Type': imageRes.headers.get('Content-Type') ?? 'image/jpeg',
      // 1日ブラウザキャッシュ / 1週間 CF エッジキャッシュ
      // → 同じ p= への2回目以降のアクセスは変換カウントされない
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
    },
  });
}
