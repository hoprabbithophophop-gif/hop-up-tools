/**
 * Cloudflare Pages Function: /api/hai-to-diamond-comments?video_id=...
 *
 * 灰toダイヤモンド💎の再生中に、動画の下へ流す YouTube のコメントを返す。
 * YouTube Data API v3 の commentThreads（そのぶら下がりの返信は取らず、親コメントだけ）を呼び、
 * /api/hai-to-diamond-replay と同じく CDN エッジに置いて、訪問者ごとに YouTube を叩かないようにする。
 *
 * 返す形: [{ id, author, text, likeCount, timeSec }]
 *   text    … 元の本文のまま（改行だけ空白に畳む。省略はしない・Hop決定 2026-09-08: 読みたい人がいる）
 *   timeSec … 本文に「2:31」のような分:秒があれば、その秒数。無ければ null
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

  let raw: unknown;
  try {
    const upstream = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
    upstream.searchParams.set('part', 'snippet');
    upstream.searchParams.set('videoId', videoId);
    upstream.searchParams.set('maxResults', String(MAX_RESULTS));
    upstream.searchParams.set('order', 'relevance');
    upstream.searchParams.set('textFormat', 'plainText');
    upstream.searchParams.set('key', env.YOUTUBE_API_KEY);
    const res = await fetch(upstream.toString(), { headers: { Accept: 'application/json' } });
    // コメント無効（403）・動画が見つからない（404）・上限超え などは全部「出さない」で揃える。
    // 中身に鍵の手掛かりが混ざりうるので、返事にも記録にも中身は出さない
    if (!res.ok) return cacheAndReturn(context, cacheKey, json('[]', EMPTY_TTL_SECONDS));
    raw = await res.json();
  } catch {
    return json('[]', 0);
  }

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
    out.push({
      id: String(top.id ?? (item as any)?.id ?? ''),
      author: typeof s.authorDisplayName === 'string' ? s.authorDisplayName : '',
      text,
      likeCount: typeof s.likeCount === 'number' ? s.likeCount : 0,
      timeSec: parseTimeSec(text),
    });
  }
  return out;
}

/** 改行や続いた空白を1つの空白に畳む。極端に長いものだけ安全弁で切る。
 *  絵文字が入っていても途中で割れないよう、文字の数え方は Array.from（コードポイント単位）にする */
function flatten(src: string): string {
  const one = src.replace(/\s+/g, ' ').trim();
  const chars = Array.from(one);
  if (chars.length <= MAX_TEXT_LENGTH) return one;
  return chars.slice(0, MAX_TEXT_LENGTH).join('') + '…';
}

/** 本文の中の最初の「分:秒」を秒数に直す。無ければ null。本文そのものは変えない */
function parseTimeSec(text: string): number | null {
  const m = TIME_RE.exec(text);
  if (!m) return null;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(sec)) return null;
  return min * 60 + sec;
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
