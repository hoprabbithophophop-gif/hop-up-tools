/**
 * Cloudflare Pages Function: /hai-to-diamond
 *
 * index.html の <head> に hai-to-diamond 用の OGP / Twitter Card メタタグを注入して返す。
 * 素の住所なので、全員の💎の絵の看板を出す。色と構図の札つきの住所は [[path]].ts が受ける。
 */

import { respondWithCard } from '../_shared/haiToDiamondCard';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
}

export async function onRequest(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  return respondWithCard(context.request, context.env, null);
}
