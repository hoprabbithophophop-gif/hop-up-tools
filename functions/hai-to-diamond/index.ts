/**
 * Cloudflare Pages Function: /hai-to-diamond
 *
 * index.html の <head> に hai-to-diamond 用の OGP / Twitter Card メタタグを注入して返す。
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
    canonicalUrl: `${url.origin}/hai-to-diamond`,
    title: '灰toダイヤモンド #銀河to銀河届けよ | hop-up-tools',
    // 【仮】オーナーの投稿文から。変更可
    description:
      'BEYOOOOONDS「灰toダイヤモンド」YOKOOOOOHAMA ARENA Live Edit.を見ながら💎を送って、キラキラに未来未来にしちゃおう！',
    image: `${url.origin}/ogp/hai-to-diamond.png`,
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
