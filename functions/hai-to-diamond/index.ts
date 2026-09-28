/**
 * Cloudflare Pages Function: /hai-to-diamond
 *
 * 【このファイルは動かないが、消してはいけない】
 * 同じフォルダに [[path]].ts がある間、素の /hai-to-diamond も [[path]].ts が先に取る
 * （Pages の振り分けは段の数が多い道を先に並べ、最初に一致した1つで打ち切る。
 *  /hai-to-diamond/:path* は段が0個でも一致する。2026-09-20 の前提監査で公式の実装を動かして確かめた）。
 * それでもこのファイルを残すのは、自動で作られる _routes.json に素の住所 /hai-to-diamond を載せ続けるため。
 * 消すと載るのが /hai-to-diamond/* だけになり、それが素の住所に当たるかは確かめられていない
 * ＝素の住所が受付係に届かず、看板の絵が出なくなるおそれがある。
 *
 * 万一こちらが動いた時も、[[path]].ts が札なしで受けた時とまったく同じ看板（全員の💎の絵）を返す。
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
