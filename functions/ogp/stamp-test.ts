/**
 * 【試作】Cloudflare Pages Function: /ogp/stamp-test?n=1234
 *
 * OGP の絵の中に「◯個 降らせました」の数字を押して返せるかを、無料枠（1回の作業時間10ミリ秒）の上で確かめる口。
 * 下絵と判子は public/ogp/dyn/ に先に置いてある。ここでは数字の所だけ点を書き換える（functions/_shared/ogpStamp.ts）。
 * 本番のどこからも参照していない。確かめ終わったら消すか、本採用の形に作り直す。
 */
import { stamp, type GlyphMeta, type StampMeta } from '../_shared/ogpStamp';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const raw = Number(url.searchParams.get('n') ?? '0');
  const n = Number.isFinite(raw) ? Math.max(0, Math.min(9_999_999, Math.floor(raw))) : 0;   // 上限を決めて丸める

  const get = (p: string) => env.ASSETS.fetch(new Request(new URL(p, url.origin).toString()));
  const [pngRes, metaRes, sheetRes, gmRes] = await Promise.all([
    get('/ogp/dyn/base.png'), get('/ogp/dyn/base.json'), get('/ogp/dyn/glyphs.a8'), get('/ogp/dyn/glyphs.json'),
  ]);
  if (!pngRes.ok || !metaRes.ok || !sheetRes.ok || !gmRes.ok) {
    return new Response('assets missing', { status: 500 });
  }
  const png = new Uint8Array(await pngRes.arrayBuffer());
  const meta = (await metaRes.json()) as StampMeta;
  const sheet = new Uint8Array(await sheetRes.arrayBuffer());
  const gm = (await gmRes.json()) as GlyphMeta;

  const parts = [...n.toLocaleString('en-US'), '個 降らせました'];
  const out = stamp(png, meta, sheet, gm, parts, 600, 432, [245, 247, 250]);

  return new Response(out, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=300',
      'x-stamp-n': String(n),
    },
  });
}
