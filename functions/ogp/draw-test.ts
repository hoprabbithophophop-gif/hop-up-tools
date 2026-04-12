/**
 * 一時テスト: /ogp/draw-test
 * cf.image.draw + SVG overlay の動作確認専用（Supabase 不要）
 * 確認後に削除する。
 */
export async function onRequest(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url);

  const thumbUrl = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'; // test.ts と同じ既知の動画ID
  // Step 2: PNG draw overlay のテスト（SVG は 9412 エラーで使えないため）
  // 1×1 半透明 PNG を 1200×630 にリピートして dark overlay を確認
  const pngOverlayUrl = `${url.origin}/overlay-dark.png`;

  // @ts-ignore
  const res = await fetch(thumbUrl, {
    cf: {
      image: {
        width: 1200,
        height: 630,
        fit: 'cover',
        format: 'jpeg',
        quality: 85,
        draw: [{ url: pngOverlayUrl, repeat: true, opacity: 0.7 }],
      },
    } as unknown,
  });

  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'image/jpeg',
      'Cache-Control': 'no-store',
      'X-Cf-Resized': res.headers.get('cf-resized') ?? 'none',
    },
  });
}
