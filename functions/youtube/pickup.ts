/**
 * Cloudflare Pages Function: /youtube/pickup
 *
 * createPlaylistShare() が生成する共有URL `/youtube/pickup?p=xxx` の
 * OGP 注入エントリポイント。ロジックは /youtube (index.ts) と同一。
 */

import { fetchOgpData, buildMetaTags } from '../_shared/ogp';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
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

  if (!playlistId || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    return indexRes;
  }

  try {
    const ogp = await fetchOgpData(playlistId, env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    if (!ogp) return indexRes;

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
