/**
 * Cloudflare Pages Function: GET /api/crossword-video-info?id=<動画の番号 11字>
 *
 * クロスワードのヒントの YouTube 動画について、チャンネル名と「今も見られるか」を返す。
 * 見る人のブラウザから YouTube へ直接聞く形（鍵なしの oEmbed）をやめ、この受付係が YouTube Data API v3 の
 * videos.list に聞く（Hop 決定 2026-10-21「正式な窓口に切り替えてから出す」。oEmbed が利用規約の自動アクセスの決まりに当たるか灰色のため）。
 *
 *   1. 番号の形を確かめる。11字の英数字・_・- でなければ 400
 *   2. 同じ番号の答えは CDN エッジ（caches.default）から返す。見られる答えは 6時間【仮】、見られない答えは 1時間【仮】置く。
 *      分からない答えは置かない（一時的な失敗を長く残さない）
 *   3. エッジに無い時だけ、接続元ごとに 1時間 120回まで【仮】（rate_limit_log。成否に関係なく数える。IPv6 は /64 の帯で数える）。超えたら 429
 *   4. videos.list を1回呼ぶ（1点）。要る欄だけを fields で絞る
 *
 * 返事:
 *   { status: "ok", channel: "<チャンネル名 100字まで>" }
 *   { status: "gone" } … YouTube が見られないと答えた（動画が無い・非公開・埋め込み禁止・年齢制限）
 *   503 { status: "unknown" } … 鍵が無い・YouTube が 200 以外・通信の失敗。画面は見られない印を付けない
 *
 * 決め事:
 * - チャンネル名もほかの値も、DB にもファイルにも残さない。置くのはエッジの短い間だけ。
 * - 鍵（YOUTUBE_API_KEY）は上りの URL に入るので、その URL も YouTube から返ってきた中身も、返事にも記録にも出さない。
 */

import { logBackground } from "../_shared/background";
import { reporterKey } from "../_shared/reporterKey";
import { sha256Hex } from "./crossword-save";

interface Env {
  YOUTUBE_API_KEY?: string;
  VITE_SUPABASE_URL?: string;
  /** 数えの棚（rate_limit_log）への書き込み用。RLS を迂回するので絶対に外へ出さない。 */
  SUPABASE_SECRET_KEY?: string;
  /** 接続元のハッシュに混ぜる秘密の値としてだけ使う（contact・crossword-save と同じ値）。 */
  TURNSTILE_SECRET?: string;
}

const ENDPOINT = "crossword-video-info";
const PER_IP_PER_HOUR = 120; // 【仮】
/** 見られる答えをエッジに置く時間（秒）【仮】 */
const OK_TTL_SECONDS = 6 * 60 * 60;
/** 見られない答えをエッジに置く時間（秒）【仮】。見られるように戻った動画を長く「見られない」にしないよう短め */
const GONE_TTL_SECONDS = 60 * 60;
const MAX_CHANNEL_LENGTH = 100;
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

type Answer = { status: "ok"; channel: string } | { status: "gone" } | { status: "unknown" };

export async function onRequestGet(context: {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!ID_RE.test(id)) return reply({ status: "unknown" }, 400, 0);

  // 1. エッジ。鍵は番号だけで作り、ほかの引数を付けてエッジを素通りさせない
  // @ts-ignore caches は CF Workers/Pages のグローバル
  const cache = caches.default as Cache;
  const cacheKey = new Request(`${url.origin}/api/crossword-video-info?id=${id}`, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  if (!env.YOUTUBE_API_KEY || !env.VITE_SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.TURNSTILE_SECRET) {
    console.error("crossword-video-info: env missing");
    return reply({ status: "unknown" }, 503, 0);
  }

  // 2. 接続元ごとの上限。生の IP は残さず、秘密の値を混ぜたハッシュだけを使う。照会に失敗したら通す
  const rest = `${env.VITE_SUPABASE_URL}/rest/v1`;
  const dbHeaders = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const ipHash = await sha256Hex(`${ENDPOINT}:${reporterKey(ip)}:${env.TURNSTILE_SECRET}`);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  try {
    const rl = await fetch(
      `${rest}/rate_limit_log?select=id&endpoint=eq.${ENDPOINT}&ip_hash=eq.${ipHash}` +
        `&created_at=gt.${encodeURIComponent(since)}&limit=${PER_IP_PER_HOUR}`,
      { headers: dbHeaders },
    );
    if (rl.ok && ((await rl.json()) as unknown[]).length >= PER_IP_PER_HOUR) return reply({ status: "unknown" }, 429, 0);
  } catch {
    /* 照会に失敗したら通す */
  }
  context.waitUntil(
    logBackground(
      ENDPOINT,
      fetch(`${rest}/rate_limit_log`, {
        method: "POST",
        headers: { ...dbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ ip_hash: ipHash, endpoint: ENDPOINT }),
      }),
      fetch(`${rest}/rate_limit_log?endpoint=eq.${ENDPOINT}&created_at=lt.${encodeURIComponent(since)}`, {
        method: "DELETE",
        headers: dbHeaders,
      }),
    ),
  );

  // 3. YouTube に聞く
  const answer = await askYouTube(id, env.YOUTUBE_API_KEY);
  if (answer.status === "unknown") return reply(answer, 503, 0);
  const res = reply(answer, 200, answer.status === "ok" ? OK_TTL_SECONDS : GONE_TTL_SECONDS);
  context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

// videos.list を1回呼んで、答えを3つに分ける。失敗の中身には鍵入りの URL が混ざりうるので、記録には返事の番号だけを出す
async function askYouTube(id: string, key: string): Promise<Answer> {
  const upstream = new URL("https://www.googleapis.com/youtube/v3/videos");
  upstream.searchParams.set("part", "snippet,status,contentDetails");
  upstream.searchParams.set("id", id);
  upstream.searchParams.set(
    "fields",
    "items(id,snippet/channelTitle,status/privacyStatus,status/embeddable,contentDetails/contentRating/ytRating)",
  );
  upstream.searchParams.set("key", key);
  let raw: unknown;
  try {
    const res = await fetch(upstream.toString(), { headers: { Accept: "application/json" } });
    if (res.status !== 200) {
      console.error("crossword-video-info: youtube failed", res.status);
      return { status: "unknown" };
    }
    raw = await res.json();
  } catch {
    console.error("crossword-video-info: youtube threw");
    return { status: "unknown" };
  }
  return toAnswer(raw);
}

type VideoItem = {
  snippet?: { channelTitle?: unknown };
  status?: { privacyStatus?: unknown; embeddable?: unknown };
  contentDetails?: { contentRating?: { ytRating?: unknown } };
};

// YouTube の返事から答えを作る。動画が無い（items が空）・非公開・埋め込み禁止・年齢制限は見られない。
// チャンネル名が読めない時は、見られないとは言い切れないので「分からない」
function toAnswer(raw: unknown): Answer {
  const items = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0) return { status: "gone" };
  const it = (items[0] ?? {}) as VideoItem;
  if (it.status?.privacyStatus === "private") return { status: "gone" };
  if (it.status?.embeddable === false) return { status: "gone" };
  if (it.contentDetails?.contentRating?.ytRating === "ytAgeRestricted") return { status: "gone" };
  const channel = typeof it.snippet?.channelTitle === "string" ? it.snippet.channelTitle.trim().slice(0, MAX_CHANNEL_LENGTH) : "";
  return channel ? { status: "ok", channel } : { status: "unknown" };
}

function reply(body: Answer, status: number, ttl: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": ttl > 0 ? `public, s-maxage=${ttl}` : "no-store",
    },
  });
}
