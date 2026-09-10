/**
 * Cloudflare Pages Function: /news/<記事のid>
 *
 * index.html の <head> に、そのお知らせ1件ぶんのカード用メタタグを差し込んで返す。
 * SNSにURLを貼った時に、サイト共通の文言ではなく記事の題名と書き出しが出るようにするもの。
 *
 * 記事の中身は /news.json から読む。これは src/data/news.json の写しで、
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
  body: string;
}

/** 説明文の長さの上限。Xのカードはこのくらいで切られる */
const DESC_MAX = 100;

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

    // 本文の1行目を説明に使う
    const firstLine = item.body.split('\n')[0].trim();
    const description =
      firstLine.length > DESC_MAX ? `${firstLine.slice(0, DESC_MAX)}…` : firstLine;

    const metaHtml = buildMetaTags({
      canonicalUrl: `${url.origin}/news/${id}`,
      title: `${item.title} | お知らせ | hop-up-tools`,
      description,
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
