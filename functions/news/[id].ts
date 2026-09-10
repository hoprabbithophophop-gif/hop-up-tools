/**
 * Cloudflare Pages Function: /news/<記事のid>
 *
 * index.html の <head> に、そのお知らせ1件ぶんのカード用メタタグを差し込んで返す。
 * SNSにURLを貼った時に、サイト共通の文言ではなく記事の題名が出るようにするもの。
 *
 * 出るのは題名だけにしてある。本文の書き出しを添えると、
 * 謝罪の一言目だけが切り出されて軽く見えるため（Hop指摘 2026-09-11）。
 *
 * 記事の題名は /news.json から読む。これは src/data/news.json の写しで、
 * ビルドの時に作られる（package.json の build を参照）。
 * こうしておくと、お知らせを足す時に直す場所は src/data/news.json だけで済む。
 *
 * 絵はまだ用意していないので、文字だけのカードになる。
 * 途中で何かあっても、カードが出ないだけで記事は普通に開ける作りにしてある。
 */

import { buildMetaTags } from '../_shared/ogp';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
}

interface NewsItem {
  id: string;
  title: string;
}

const SITE = 'hop-up-tools';

export async function onRequest(context: {
  request: Request;
  env: Env;
  params: { id?: string | string[] };
}): Promise<Response> {
  const { request, env, params } = context;
  const url = new URL(request.url);

  const indexRes = await env.ASSETS.fetch(
    new Request(new URL('/index.html', url.origin).toString())
  );

  try {
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!id) return indexRes;

    const res = await env.ASSETS.fetch(
      new Request(new URL('/news.json', url.origin).toString())
    );
    if (!res.ok) return indexRes;

    const all = (await res.json()) as NewsItem[];
    const item = all.find((n) => n.id === id);
    if (!item) return indexRes;

    const metaHtml = buildMetaTags({
      canonicalUrl: `${url.origin}/news/${id}`,
      title: `お知らせ | ${item.title}`,
      description: SITE,
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
    // カードは諦めて、素の index.html をそのまま返す
    return indexRes;
  }
}
