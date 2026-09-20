/**
 * /hai-to-diamond の OGP（シェアのリンクに付く絵）の出し分け
 *
 * 住所が /hai-to-diamond/<色>/<構図> の形で、どちらも決まった一覧に入っている時だけ、
 * その色の💎1個の絵（public/ogp/hai-to-diamond/<色>-<構図>.jpg）を看板に出す。
 * それ以外はすべて、全員の💎の絵（public/ogp/hai-to-diamond.png）の看板にする。
 *
 * 絵は先に焼いた静的な素材を指すだけで、ここでは描かない（無料枠の1回10ミリ秒に入らないため）。
 * 個数は看板に出さない（Hop決定 2026-09-20）。
 */

import { buildMetaTags } from './ogp';

/** 看板の絵がある色。src/pages/hai-to-diamond/members.ts の DIAMOND_COLOR_ORDER と同じ14個。
 *  受付係（functions/）は src/ を読めないので、ここに写しを持つ。片方だけに足すと、その色の看板が全員の絵に落ちる。
 *  一覧と照合せずに住所の文字をそのまま絵の名前に使うと、素材の読み先を外から指定できてしまうので、必ずここを通す */
export const CARD_MEMBER_IDS: readonly string[] = [
  'nishida', 'eguchi', 'otsubo', 'sugiyama', 'maeda', 'okamura', 'kiyono',
  'kojima', 'hirai', 'kobayashi', 'satoyoshi', 'shimakura', 'takase', 'yamazaki',
];

/** 構図の番号。1=引き 2=中 3=寄り */
export const CARD_COMPS: readonly string[] = ['1', '2', '3'];

export interface CardTag {
  memberId: string;
  comp: string;
}

/** 住所の /hai-to-diamond より後ろの部分（[[path]] が配列で渡してくる）から、色と構図の札を読む。
 *  2段ちょうどで、どちらも一覧にある時だけ札として認める。それ以外は null＝全員の絵 */
export function parseCardTag(path: unknown): CardTag | null {
  if (!Array.isArray(path) || path.length !== 2) return null;
  const [memberId, comp] = path;
  if (typeof memberId !== 'string' || typeof comp !== 'string') return null;
  if (!CARD_MEMBER_IDS.includes(memberId) || !CARD_COMPS.includes(comp)) return null;
  return { memberId, comp };
}

const BASE_PATH = '/hai-to-diamond';

/** 看板に出す絵の住所と、このページの正式な住所を決める。
 *  札つきの時は正式な住所も札つきにする。素の住所にすると、正式な住所を見に行く取得役に
 *  全員の絵の看板へまとめられてしまうおそれがある（X がそう動くかは未確認） */
export function cardUrls(origin: string, tag: CardTag | null): { canonicalUrl: string; image: string } {
  if (!tag) {
    return { canonicalUrl: `${origin}${BASE_PATH}`, image: `${origin}/ogp/hai-to-diamond.png` };
  }
  return {
    canonicalUrl: `${origin}${BASE_PATH}/${tag.memberId}/${tag.comp}`,
    image: `${origin}/ogp/hai-to-diamond/${tag.memberId}-${tag.comp}.jpg`,
  };
}

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
}

/** index.html の <head> に OGP のメタタグを差し込んで返す。
 *  public/_redirects は受付係のいる住所には効かないので、ページの中身もここで返す */
export async function respondWithCard(request: Request, env: Env, tag: CardTag | null): Promise<Response> {
  const url = new URL(request.url);
  const indexRes = await env.ASSETS.fetch(
    new Request(new URL('/index.html', url.origin).toString())
  );

  const { canonicalUrl, image } = cardUrls(url.origin, tag);
  const metaHtml = buildMetaTags({
    canonicalUrl,
    title: '灰toダイヤモンド #銀河to銀河届けよ | hop-up-tools',
    // 【仮】オーナーの投稿文から。変更可
    description:
      'BEYOOOOONDS「灰toダイヤモンド」YOKOOOOOHAMA ARENA Live Edit.を見ながら💎を送って、キラキラに未来未来にしちゃおう！',
    image,
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
