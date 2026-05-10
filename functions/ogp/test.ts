/**
 * Cloudflare Pages Function: /ogp/test
 *
 * cf.image が pages.dev 上で動作するか確認するための最小テストエンドポイント。
 * アクセスすると YouTube のサンプルサムネを 200×200 にリサイズして返す。
 *
 * 確認方法:
 *   - 返ってきた画像が 200×200 なら cf.image は動作している
 *   - 返ってきた画像が元サイズ (480×360) のままなら cf.image は無効
 *
 * このエンドポイントは確認後に削除してよい。
 */

export async function onRequest(_context: unknown): Promise<Response> {
  const sampleThumb = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';

  // @ts-ignore
  const res = await fetch(sampleThumb, {
    cf: {
      image: {
        width: 200,
        height: 200,
        fit: 'cover',
        format: 'jpeg',
      },
    } as unknown,
  });

  const headers = new Headers({
    'Content-Type': res.headers.get('Content-Type') ?? 'image/jpeg',
    'Cache-Control': 'no-store',
    // cf.image が有効なら "cf-resized" ヘッダーが付いてくる
    'X-Cf-Resized': res.headers.get('cf-resized') ?? 'none',
    'X-Original-Content-Type': res.headers.get('Content-Type') ?? 'unknown',
  });

  return new Response(res.body, { headers });
}
