/**
 * Cloudflare Pages Function: /api/hi-sessions?video_id=...
 *
 * hi-tension の客席・歴代累計に使うセッション一覧を返す。
 * 目的は「Disk IO 節約」。各訪問者が直接 Supabase の全件を読むと、
 * アクセスが増えた時にディスク読み取りが膨らむ（hi_sessions ≈ 6MB を毎回フル走査）。
 * ここで一度読んだら CDN エッジに数十秒キャッシュし、以後の訪問者には Supabase を
 * 叩かずに配る。これで「読みの回数 = 訪問者数」が「読みの回数 ≈ 数十秒に1回」になる。
 *
 * 返すデータの形は従来のクライアント直読みと完全に同じ（HiSession[] 相当）。
 * クライアントはこのエンドポイントが失敗した時だけ直 Supabase にフォールバックする。
 *
 * ── 分割して渡す入口（後から足したもの）──
 * 全件を 1 塊で返すと本番では 7.3MB あり、読み終わるまで席が決まらず最初の✋が遅れる。
 * 席の割り当ては session_hash だけで決まるので、名簿さえ届けば席は確定する。そこで
 *   ?part=roster     … 名簿だけ（目盛り表の 2 列を抜いた全行＋挙げた回数）
 *   ?part=seg&seg=N  … N 番目の 30 秒区間のタップだけ
 * を足した。`part` を付けない今までの呼び方は 1 バイトも変えていない
 * （他の枝・本番・クライアントのフォールバックがそのまま使うため）。
 *
 * Supabase を読む回数は増やさない。全件の塊を「内部用の鍵」で同じ 45 秒だけエッジに置き、
 * roster も seg もその塊から切り出す。塊が生きている間、Supabase は一度も叩かれない。
 */

import { buildRoster, buildSegment, type HiFullRow } from './_hi-sessions-parts';

interface Env {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

/** エッジキャッシュの寿命（秒）。短いほど鮮度↑/ブレーキ効果↓。累計・客席なので数十秒で気づかれない。 */
const TTL_SECONDS = 45;
/** PostgREST の1ページ上限。view が1000行超でもページングして全件返す。 */
const PAGE = 1000;
/** 従来クライアントと同じ列だけ取る（形を変えない）。 */
const SELECT =
  'session_hash,member_id,is_today,bucket_indices,bucket_indices_20,played_date,special_mode,special_event_key';

export async function onRequest(context: {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const videoId = url.searchParams.get('video_id');
  const part = url.searchParams.get('part');

  // 名簿・区間の入口は別の道へ。今までの呼び方（part 無し）はこの下をそのまま通る。
  if (part) return handlePart(context, url, videoId, part);

  // 必要情報が無い時は「空配列」を返す（壊さない＝クライアントは0件として描画 or フォールバック）。
  if (!videoId || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    return json('[]', 0);
  }

  // --- エッジキャッシュ（訪問者をまたいで共有） ---
  // @ts-ignore caches は CF Workers/Pages のグローバル
  const cache = caches.default as Cache;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // --- キャッシュ無し: Supabase を読む ---
  const all = await loadAllRows(env, videoId);
  if (all instanceof Response) return all; // 取得失敗（502）。クライアントは直読みへ回る。

  const out = json(JSON.stringify(all), TTL_SECONDS);
  // レスポンスを返しつつ裏でキャッシュへ保存（次の訪問者はここを読む）。
  context.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

/**
 * Supabase の全行を、1000 行ずつめくって集める。
 * 失敗したら Response（502）を返す＝呼び出し側はそれをそのまま返し、
 * クライアントを直読みフォールバックへ回す。
 */
async function loadAllRows(
  env: Env,
  videoId: string,
): Promise<HiFullRow[] | Response> {
  const headers = {
    apikey: env.VITE_SUPABASE_ANON_KEY as string,
    Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
    Accept: 'application/json',
  };
  const all: HiFullRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const endpoint =
      `${env.VITE_SUPABASE_URL}/rest/v1/hi_aggregations` +
      `?video_id=eq.${encodeURIComponent(videoId)}` +
      `&select=${SELECT}` +
      `&order=session_hash.asc` +
      `&limit=${PAGE}&offset=${offset}`;
    let res: Response;
    try {
      res = await fetch(endpoint, { headers });
    } catch {
      // 取得失敗。ここまで取れた分は返さず、クライアントを直読みフォールバックに回す（502）。
      return new Response('upstream fetch failed', { status: 502 });
    }
    if (!res.ok) return new Response('upstream error', { status: 502 });
    const rows = (await res.json()) as HiFullRow[];
    all.push(...rows);
    if (rows.length < PAGE) break; // 最終ページ
    if (offset > 500_000) break; // 暴走ブレーキ（理論上届かない）
  }
  return all;
}

/**
 * 名簿（part=roster）・区間（part=seg&seg=N）を返す道。
 *
 * 大事なのは「Supabase を読む回数を増やさない」こと。名簿でも区間でも元になるのは同じ
 * 全件の塊なので、塊は part を含まない内部用の鍵（…?video_id=X&__full=1）で一度だけ
 * エッジに置く。名簿と各区間は、その塊から切り出した上で自分の URL でも別に置く。
 * 塊の鍵が part を含まないのが肝で、含めてしまうと roster と区間それぞれが
 * 自前の塊を作って Supabase を 10 回読むことになる。
 */
async function handlePart(
  context: { env: Env; waitUntil(p: Promise<unknown>): void },
  url: URL,
  videoId: string | null,
  part: string,
): Promise<Response> {
  const { env } = context;
  const segRaw = url.searchParams.get('seg');
  const seg = segRaw == null ? NaN : Number(segRaw);
  const isSeg = part === 'seg';
  if (part !== 'roster' && !isSeg) return new Response('unknown part', { status: 400 });
  if (isSeg && (!Number.isInteger(seg) || seg < 0)) {
    return new Response('bad seg', { status: 400 });
  }

  // 材料が無い時は、今までの入口と同じ考え方で「空っぽ」を返す（壊さない）。
  const emptyBody = isSeg ? '[]' : '{"sessions":[],"maxBucket":0}';
  if (!videoId || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    return json(emptyBody, 0);
  }

  // @ts-ignore caches は CF Workers/Pages のグローバル
  const cache = caches.default as Cache;
  const base = `${url.origin}${url.pathname}?video_id=${encodeURIComponent(videoId)}`;
  // この名簿／区間そのものの置き場所（param の書き順に左右されない形に揃える）。
  const partUrl = isSeg ? `${base}&part=seg&seg=${seg}` : `${base}&part=roster`;
  const partKey = new Request(partUrl, { method: 'GET' });
  const cachedPart = await cache.match(partKey);
  if (cachedPart) return cachedPart;

  // --- 元になる全件の塊を用意する ---
  const fullKey = new Request(`${base}&__full=1`, { method: 'GET' });
  let rows: HiFullRow[] | null = null;
  const cachedFull = await cache.match(fullKey);
  if (cachedFull) {
    rows = (await cachedFull.json()) as HiFullRow[];
  } else {
    // 今までの呼び方で置かれた塊（part 無しの鍵）があれば、それも使う。
    // 新旧のクライアントが混在する入れ替え期に、同じ中身を二度読まないため。
    const cachedLegacy = await cache.match(new Request(base, { method: 'GET' }));
    if (cachedLegacy) {
      rows = (await cachedLegacy.json()) as HiFullRow[];
    } else {
      const loaded = await loadAllRows(env, videoId);
      if (loaded instanceof Response) return loaded; // 502 → クライアントは全件読みへ落ちる
      rows = loaded;
      // 塊も同じ 45 秒だけ置いておく（次の区間の要求はここから切り出すだけで済む）。
      context.waitUntil(cache.put(fullKey, json(JSON.stringify(rows), TTL_SECONDS)));
    }
  }

  const body = isSeg
    ? JSON.stringify(buildSegment(rows, seg))
    : JSON.stringify(buildRoster(rows));
  const out = json(body, TTL_SECONDS);
  context.waitUntil(cache.put(partKey, out.clone()));
  return out;
}

function json(body: string, ttl: number): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': ttl > 0 ? `public, s-maxage=${ttl}` : 'no-store',
    },
  });
}
