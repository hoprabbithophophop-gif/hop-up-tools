/**
 * Cloudflare Pages Function: /crossword/<8字の問題番号>
 *
 * 問題が読めて隠されていなければ、index.html の <head> に、その問題の題名とシェア画像のカード用メタタグを差し込んで返す。
 * 手本は functions/hai-to-diamond/[[path]].ts・functions/_shared/haiToDiamondCard.ts・functions/news/[id].ts。
 *
 * /crossword/list・形の合わない番号・隠された問題・無い問題・読み込みの失敗は、何も差し込まずに index.html を返す。
 * どの場合も番号は 200。404 を返さない（受付係のある住所は Pages の既定の SPA の動きに乗らないので、
 * ここで index.html を返さないとページが開けなくなる。public/_redirects の頭の説明を参照）。
 *
 * 問題は公開用の鍵（anon）で読む。RLS が隠された問題を返さないので、「無い」と「隠された」は同じ扱いになる。
 * 画像の住所は保存の受付係が置く場所。置けていなかった・通報で消された問題は、先に HEAD で確かめて、無ければ絵の無い札にする。
 */

import { buildMetaTags } from '../_shared/ogp';
import { ogpPublicUrl } from '../_shared/crosswordOgp';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

const ID_RE = /^[A-Za-z0-9_-]{8}$/;
/** カードの説明文 */
const DESCRIPTION = 'クロスワード | hop-up-tools';

/** 画像が置かれているか。失敗・例外は「無い」扱い */
async function imageExists(imageUrl: string): Promise<boolean> {
  try {
    return (await fetch(imageUrl, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

export async function onRequest(context: {
  request: Request;
  env: Env;
  params: { id?: string | string[] };
}): Promise<Response> {
  const { request, env, params } = context;
  const url = new URL(request.url);

  const indexRes = await env.ASSETS.fetch(new Request(new URL('/index.html', url.origin).toString()));

  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!id || !ID_RE.test(id)) return indexRes;
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) return indexRes;

  try {
    const res = await fetch(
      `${env.VITE_SUPABASE_URL}/rest/v1/crossword_puzzles?id=eq.${id}&select=title&limit=1`,
      {
        headers: {
          apikey: env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
          Accept: 'application/json',
        },
      },
    );
    if (!res.ok) return indexRes;
    const rows = (await res.json()) as { title?: unknown }[];
    const title = rows[0]?.title;
    if (typeof title !== 'string' || title === '') return indexRes;

    const imageUrl = ogpPublicUrl(env.VITE_SUPABASE_URL, id);
    const metaHtml = buildMetaTags({
      canonicalUrl: `${url.origin}/crossword/${id}`,
      title,
      description: DESCRIPTION,
      image: (await imageExists(imageUrl)) ? imageUrl : undefined,
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
