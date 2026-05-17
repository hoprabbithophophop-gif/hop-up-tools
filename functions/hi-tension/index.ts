/**
 * Cloudflare Pages Function: /hi-tension
 *
 * index.html の <head> に hi-tension 用の OGP / Twitter Card メタタグを注入して返す。
 * 動的データ取得は不要なため、常に静的 OGP を注入する。
 */

import { buildMetaTags } from '../_shared/ogp';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
}

export async function onRequest(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);

  const indexRes = await env.ASSETS.fetch(
    new Request(new URL('/index.html', url.origin).toString())
  );

  const metaHtml = buildMetaTags({
    canonicalUrl: `${url.origin}/hi-tension`,
    title: 'ハイ！テンション✋ Practice ver. | hop-up-tools',
    description: 'ハイ！テンションに合わせて✋を叩こう。ハロプロファン向け非公式ツール。',
    image: `${url.origin}/ogp/hi-tension.png`,
  });

  // @ts-ignore
  return new HTMLRewriter()
    .on('head', {
      element(el: { append(c: string, o: { html: boolean }): void }) {
        el.append(metaHtml, { html: true });
      },
    })
    .transform(indexRes);
}
