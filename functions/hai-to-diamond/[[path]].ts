/**
 * Cloudflare Pages Function: /hai-to-diamond/<色>/<構図>
 *
 * シェアのリンクに乗った色と構図の札を読んで、その色の💎1個の絵を OGP に出す。
 * 札が決まりに合わない住所（段の数が違う・一覧に無い色や番号）は、全員の💎の絵の看板にする。
 * 素の /hai-to-diamond は index.ts が受ける。
 */

import { parseCardTag, respondWithCard } from '../_shared/haiToDiamondCard';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
}

export async function onRequest(context: {
  request: Request;
  env: Env;
  params: { path?: string | string[] };
}): Promise<Response> {
  const { request, env, params } = context;
  return respondWithCard(request, env, parseCardTag(params.path));
}
