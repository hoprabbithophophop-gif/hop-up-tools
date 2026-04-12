/**
 * Cloudflare Pages Function: /ogp/card
 *
 * OGP カード画像（1200×630）を動的生成して返す。
 * og:image として /youtube 系ルートが参照する。
 *
 * クエリパラメータ:
 *   p - プレイリスト共有 ID（8文字 nanoid）
 *   n - チャプター数（山札枚数決定用、省略時は 1 扱い）
 *
 * 処理フロー（Phase 2）:
 *   1. Supabase からプレイリスト情報を取得
 *   2. 1曲目の YouTube サムネを 1200×630 にセンタークロップ（cf.image）
 *   3. 山札矩形 PNG を奥から順に draw で重ねる（Phase 3: チャプター数に応じて 0〜3 枚）
 *   4. 合成済み JPEG を返す
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

/**
 * チャプター数から山札の奥に重ねる矩形枚数を決める。
 * 1 → 0枚, 2 → 1枚, 3 → 2枚, 4以上 → 3枚
 */
function stackCount(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  if (n === 3) return 2;
  return 3;
}

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

  // チャプター数は og description の "他N件" から取れないので
  // 別途 n= クエリで受け取る（og:image URL に付与するのは fetchOgpData の呼び出し元）
  const n = parseInt(url.searchParams.get('n') ?? '1', 10) || 1;
  const stacks = stackCount(n);

  // 山札矩形の draw エントリ（Phase 3）
  // 静的 PNG overlay-card.png: 1200×630 の白枠矩形（public/ に配置）
  const cardPngUrl = `${url.origin}/overlay-card.png`;
  const drawEntries = [];
  for (let i = stacks; i >= 1; i--) {
    // 奥ほど右下にずらす（i が大きいほど奥 = より大きくずれる）
    drawEntries.push({
      url: cardPngUrl,
      right: -(i * 6),  // 右方向にはみ出す
      bottom: -(i * 6), // 下方向にはみ出す
    });
  }

  // @ts-ignore – cf は CF Workers グローバル
  const imageRes = await fetch(ogp.thumbnailUrl, {
    cf: {
      image: {
        width: 1200,
        height: 630,
        fit: 'cover',
        format: 'jpeg',
        quality: 85,
        ...(drawEntries.length > 0 ? { draw: drawEntries } : {}),
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
