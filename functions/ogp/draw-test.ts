/**
 * 一時テスト: /ogp/draw-test
 * Phase 3 山札PNG overlay の動作確認（Supabase 不要）
 * 確認後に削除する。
 */
export async function onRequest(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url);
  const thumbUrl = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
  const cardPngUrl = `${url.origin}/overlay-card.png`;

  // 3枚重ね（チャプター数 4 以上のケース）
  // @ts-ignore
  const res = await fetch(thumbUrl, {
    cf: {
      image: {
        width: 1200,
        height: 630,
        fit: 'cover',
        format: 'jpeg',
        quality: 85,
        draw: [
          { url: cardPngUrl, right: -18, bottom: -18 }, // 最奥
          { url: cardPngUrl, right: -12, bottom: -12 }, // 中間
          { url: cardPngUrl, right:  -6, bottom:  -6 }, // 手前
        ],
      },
    } as unknown,
  });

  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'image/jpeg',
      'Cache-Control': 'no-store',
    },
  });
}
