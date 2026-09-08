/**
 * Cloudflare Pages Function: /api/hai-to-diamond-comments?video_id=...
 *
 * 灰toダイヤモンド💎の再生中に、動画の下へ流す YouTube のコメントを返す。
 * YouTube Data API v3 の commentThreads（そのぶら下がりの返信は取らず、親コメントだけ）を呼び、
 * /api/hai-to-diamond-replay と同じく CDN エッジに置いて、訪問者ごとに YouTube を叩かないようにする。
 *
 * 返す形: [{ id, author, text, likeCount, timeSec }]
 *   text    … 元の本文のまま（改行だけ空白に畳む。省略はしない・Hop決定 2026-09-08: 読みたい人がいる）
 *   timeSec … 本文に「2:31」のような分:秒があれば、その秒数。無ければ null。時刻が2つ以上ある本文は、文はそのままで時刻ごとに1件ずつ（上限3回）返す
 *
 * 決め事:
 * - 取ったコメントは画面に流すためだけに短い間エッジに置く。ファイルにも DB にも残さない。
 * - 鍵（YOUTUBE_API_KEY）が無い時・YouTube 側でコメントが無効な時・呼び出しが失敗した時は空の並びを返す。
 *   画面はそれを見て何も描かない。
 * - 鍵は上りの URL に入るので、その URL も YouTube から返ってきた中身も、返事にも記録にも出さない。
 */

interface Env {
  YOUTUBE_API_KEY?: string;
}

/** エッジキャッシュの寿命（秒）【仮】。コメントは秒単位で変わるものではないので長めに置く */
const TTL_SECONDS = 600;
/** 空の並びを返す時のキャッシュの寿命（秒）【仮】。
 *  コメントが無効な動画で毎回 YouTube を叩かないよう、空も少しだけ置いておく */
const EMPTY_TTL_SECONDS = 60;
/** 1回で取りに行くコメントの数。YouTube 側の上限が100 */
const MAX_RESULTS = 100;
/** 1件の本文の長さの上限（文字）。極端に長いものだけ止める安全弁で、通常のコメントは丸ごと流す（Hop決定 2026-09-08: 省略しない） */
const MAX_TEXT_LENGTH = 1000;
/** 取るページ数【仮】。1ページ 100 件・1点。関連度順 3 ページ＋新しい順 2 ページ＝5点・最大 500 件 */
/** 1つのコメントを時刻ごとに流す回数の上限【仮】 */
const MAX_TIMES_PER_COMMENT = 3;
/** 時刻がこれ以上並ぶコメントは案内とみなし、最初の時刻に1回だけ流す【仮】 */
const MANY_TIMES_ONCE = 5;
const RELEVANCE_PAGES = 3;
const TIME_PAGES = 2;

/** 受け付ける動画ID（白い名簿）。ここに無いIDは YouTube を叩かずに空を返す */
const ALLOWED_VIDEO_IDS = new Set([
  '_56xLKRcVYM', // YOKOOOOOHAMA ARENA Live Edit.
  'ImXkCr22kCU', // Promotion Edit
]);

/** 本文の中の「分:秒」。前後に数字やコロンが続くもの（12:31:05 や 1:5）は拾わない */
const TIME_RE = /(?<![\d:])(\d{1,2}):([0-5]\d)(?![\d:])/;

export async function onRequest(context: {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const videoId = url.searchParams.get('video_id');

  if (!videoId || !ALLOWED_VIDEO_IDS.has(videoId) || !env.YOUTUBE_API_KEY) {
    return json('[]', 0);
  }

  // @ts-ignore caches は CF Workers/Pages のグローバル
  const cache = caches.default as Cache;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // 上位100件だけだと毎回同じ顔ぶれになる（順番は画面側で混ぜている）ので、続きのページも取って 500 件ほど集める。
  // 関連度順（いいねや返信の多さ等・YouTube の並べ方）だけだと新しいコメントが入りにくいので、
  // 一部は新しい順でも取って混ぜる。1ページ＝1点。合わせて5点（Hop決定 2026-09-08）
  const collected: unknown[] = [];
  const seen = new Set<string>();
  const fetchPages = async (order: 'relevance' | 'time', pages: number): Promise<boolean> => {
    let pageToken: string | null = null;
    for (let page = 0; page < pages; page++) {
      const upstream = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
      upstream.searchParams.set('part', 'snippet');
      upstream.searchParams.set('videoId', videoId);
      upstream.searchParams.set('maxResults', String(MAX_RESULTS));
      upstream.searchParams.set('order', order);
      upstream.searchParams.set('textFormat', 'plainText');
      upstream.searchParams.set('key', env.YOUTUBE_API_KEY as string);
      if (pageToken) upstream.searchParams.set('pageToken', pageToken);
      const res = await fetch(upstream.toString(), { headers: { Accept: 'application/json' } });
      // コメント無効（403）・動画が見つからない（404）・上限超え などは全部「出さない」で揃える。
      // 中身に鍵の手掛かりが混ざりうるので、返事にも記録にも中身は出さない
      if (!res.ok) return false;
      const raw = (await res.json()) as { items?: unknown[]; nextPageToken?: string } | null;
      for (const it of raw?.items ?? []) {
        const id = (it as { id?: unknown } | null)?.id;
        if (typeof id === 'string' && seen.has(id)) continue;   // 関連度順と新しい順で重なった分は1つに
        if (typeof id === 'string') seen.add(id);
        collected.push(it);
      }
      pageToken = raw?.nextPageToken ?? null;
      if (!pageToken) break;
    }
    return true;
  };
  try {
    const ok = await fetchPages('relevance', RELEVANCE_PAGES);
    if (!ok && collected.length === 0) return cacheAndReturn(context, cacheKey, json('[]', EMPTY_TTL_SECONDS));
    await fetchPages('time', TIME_PAGES);   // 途中で失敗しても取れたぶんで続ける
  } catch {
    if (collected.length === 0) return json('[]', 0);
  }
  const raw: unknown = { items: collected };

  const out = json(JSON.stringify(toComments(raw)), TTL_SECONDS);
  return cacheAndReturn(context, cacheKey, out);
}

/** YouTube の返事から、画面が要るところだけを取り出す */
function toComments(raw: unknown): { id: string; author: string; text: string; likeCount: number; timeSec: number | null }[] {
  const items = (raw as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: { id: string; author: string; text: string; likeCount: number; timeSec: number | null }[] = [];
  for (const item of items) {
    const top = (item as any)?.snippet?.topLevelComment;
    const s = top?.snippet;
    if (!s) continue;
    // plainText を頼んでいるので textOriginal も textDisplay も素の文。念のため両方見る
    const text = flatten(typeof s.textOriginal === 'string' ? s.textOriginal : typeof s.textDisplay === 'string' ? s.textDisplay : '');
    if (!text) continue;
    const id = String(top.id ?? (item as any)?.id ?? '');
    const author = typeof s.authorDisplayName === 'string' ? s.authorDisplayName : '';
    const likeCount = typeof s.likeCount === 'number' ? s.likeCount : 0;
    // 1つのコメントに「0:20 ここ好き 1:05 ここも」のように時刻がいくつも並ぶ人がいる。
    // 本文を切って別々の文にするのは YouTube の「そのまま見せる」決まりから外れる恐れがあるので、
    // 文は丸ごと変えずに、時刻の数だけ（上限あり）その時刻に流す形にする（Hop決定 2026-09-08）
    const times = allTimeSecs(text);
    if (times.length <= 1 || times.length >= MANY_TIMES_ONCE) {
      // 時刻が無い・1つ・または「x:xx x:xx x:xx 西田さん…」のように時刻が並ぶ案内のコメントは、最初の時刻に1回だけ。
      // 長い案内が時刻ごとに何度も流れるより、1回で読める方が親切（Hop決定 2026-09-08）
      out.push({ id, author, text, likeCount, timeSec: times[0] ?? null });
    } else {
      times.slice(0, MAX_TIMES_PER_COMMENT).forEach((sec, k) => {
        out.push({ id: `${id}#${k}`, author, text, likeCount, timeSec: sec });
      });
    }
  }
  return out;
}

/** 本文に含まれる時刻（分:秒）を、出てくる順に全部秒数で返す。無ければ空 */
function allTimeSecs(text: string): number[] {
  const re = new RegExp(TIME_RE.source, 'g');
  const secs: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const sec = Number(m[1]) * 60 + Number(m[2]);
    if (!secs.includes(sec)) secs.push(sec);
  }
  return secs;
}

/** 改行や続いた空白を1つの空白に畳む。極端に長いものだけ安全弁で切る。
 *  絵文字が入っていても途中で割れないよう、文字の数え方は Array.from（コードポイント単位）にする */
function flatten(src: string): string {
  const one = src.replace(/\s+/g, ' ').trim();
  const chars = Array.from(one);
  if (chars.length <= MAX_TEXT_LENGTH) return one;
  return chars.slice(0, MAX_TEXT_LENGTH).join('') + '…';
}


function cacheAndReturn(
  context: { waitUntil(p: Promise<unknown>): void },
  cacheKey: Request,
  res: Response,
): Response {
  context.waitUntil((caches as any).default.put(cacheKey, res.clone()));
  return res;
}

function json(body: string, ttl: number): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': ttl > 0 ? `public, s-maxage=${ttl}` : 'no-store',
    },
  });
}
