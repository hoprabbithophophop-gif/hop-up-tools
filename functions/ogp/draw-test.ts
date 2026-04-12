/**
 * 一時テスト: /ogp/draw-test
 * cf.image.draw + SVG overlay の動作確認専用（Supabase 不要）
 * 確認後に削除する。
 */
export async function onRequest(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url);

  const thumbUrl = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'; // test.ts と同じ既知の動画ID
  const textSvgUrl =
    `${url.origin}/ogp/text-svg` +
    `?title=${encodeURIComponent('TRIMテスト共有（修正後）')}` +
    `&desc=${encodeURIComponent('ハロ！ステ#537 他2チャプター')}`;

  // Step 1: draw なしでリサイズのみ（SVG draw 問題を切り分け）
  // @ts-ignore
  const res = await fetch(thumbUrl, {
    cf: {
      image: {
        width: 1200,
        height: 630,
        fit: 'cover',
        format: 'jpeg',
        quality: 85,
        // draw: [{ url: textSvgUrl }],  // ← SVG draw が 9412 エラーになるため一時無効
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
