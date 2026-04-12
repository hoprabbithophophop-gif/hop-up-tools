/**
 * Cloudflare Pages Function: /youtube
 *
 * ?p= パラメータがある場合に Supabase からプレイリストを取得し、
 * index.html の <head> に OGP / Twitter Card メタタグを注入して返す。
 * og:image は /ogp/card?p= の合成カード画像を指す（Phase 2）。
 */

import { fetchOgpData, buildMetaTags } from '../_shared/ogp';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

export async function onRequest(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const playlistId = url.searchParams.get('p');

  const indexRes = await env.ASSETS.fetch(
    new Request(new URL('/index.html', url.origin).toString())
  );

  if (!playlistId || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return indexRes;
  }

  try {
    const ogp = await fetchOgpData(playlistId, env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
    if (!ogp) return indexRes;

    // Phase 2: 合成カード画像を og:image に使用
    const cardImageUrl = `${url.origin}/ogp/card?p=${encodeURIComponent(playlistId)}`;

    const metaHtml = buildMetaTags({
      canonicalUrl: url.toString(),
      title: ogp.ogTitle,
      description: ogp.ogDescription,
      image: cardImageUrl,
    });

    // @ts-ignore
    return new HTMLRewriter()
      .on('head', {
        element(el: { append(c: string, o: { html: boolean }): void }) {
          el.append(metaHtml, { html: true });
        },
      })
      .transform(indexRes);
  } catch {
    return indexRes;
  }
}
