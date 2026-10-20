/**
 * Cloudflare Pages Function: GET /api/crossword-video-info?id=<動画の番号 11字>
 *
 * クロスワードのヒントの YouTube 動画について、チャンネル名と「今も見られるか」を返す。
 * 見る人のブラウザから YouTube へ直接聞く形（鍵なしの oEmbed）をやめ、この受付係が YouTube Data API v3 の
 * videos.list に聞く（Hop 決定 2026-10-21「正式な窓口に切り替えてから出す」。oEmbed が利用規約の自動アクセスの決まりに当たるか灰色のため）。
 * YouTube の鍵には1日 10000点の枠があり、灰toダイヤモンドのコメント（hai-to-diamond-comments）と同じ鍵を使う。
 * 他人に枠を使い切られないよう、YouTube に聞く前に下の守りを順に通す。
 *
 *   1. 番号の形を確かめる。11字の英数字・_・- でなければ 400
 *   2. 呼ばれ元を確かめる。Sec-Fetch-Site が付いていて same-origin でなければ 403（よそのサイトの画像タグ等から叩かせない）。
 *      付いていない時は通す（古いブラウザ・台本のため。後ろの回数の上限で抑える）。
 *      エッジより前に置く: 見出しを見るだけで手間がかからず、エッジに有る無しで答えが変わらないようにするため
 *   3. 同じ番号の答えは CDN エッジ（caches.default）から返す。見られる答えは 6時間【仮】、見られない答えは 1時間【仮】置く。
 *      分からない答えは置かない（一時的な失敗を長く残さない）
 *   4. エッジに無い時だけ回数を数える（rate_limit_log。成否に関係なく数える。IPv6 は /64 の帯で数える）。
 *      数えは行を取ってこず、件数だけを聞く（HEAD + Prefer: count=exact の Content-Range）。
 *      a. 先に接続元ごとの直近1時間を数え、120回【仮】に達していればその場で 429。記録は書かない（攻撃で記録が膨らまないように）
 *      b. 通るなら記録を1行書き、書き終わるのを待つ
 *      c. 書いた後に、接続元ごとの直近1時間と、全員合わせた直近1時間を数え直す。自分の分を含めて
 *         接続元ごと 120回【仮】か全体 125回【仮】を超えていたら 429。同時に叩かれて a を揃って通り抜けた分をここで止める。
 *         全体の上限は、1日に使える点を 125×24＝3000点までに抑え、灰toダイヤモンドと動画集めの分を枠に残すため
 *      d. 照会・記録のどれかに失敗したら通さず 503（上限なしで YouTube に聞かせない）
 *      e. このエンドポイントの 1時間より古い記録を消す（返事の後で。他のエンドポイントの記録には触らない）
 *      1時間より古い記録は、棚全体の片付けの cron（cleanup-rate-limit-log・5分ごと）でも消える。だから数えは1時間より長くできない
 *   5. videos.list を1回呼ぶ（1点）。要る欄だけを fields で絞る
 *
 * 返事:
 *   { status: "ok", channel: "<チャンネル名 100字まで>" }
 *   { status: "gone" } … YouTube が見られないと答えた（動画が無い・非公開・埋め込み禁止・年齢制限）
 *   403 { status: "unknown" } … よそのサイトから呼ばれた
 *   429 { status: "unknown" } … 回数の上限
 *   503 { status: "unknown" } … 鍵が無い・数えの照会や記録の失敗・YouTube が 200 以外・通信の失敗。画面は見られない印を付けない
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
/** 全員合わせた直近1時間の上限【仮】。1日 10000点の枠のうち、灰toダイヤモンドと動画集めの分を残す */
const ALL_PER_HOUR = 125;
const HOUR_MS = 60 * 60 * 1000;
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

  // 1. 呼ばれ元。付いていない時だけは通す
  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null && site !== "same-origin") return reply({ status: "unknown" }, 403, 0);

  // 2. エッジ。鍵は番号だけで作り、ほかの引数を付けてエッジを素通りさせない
  // @ts-ignore caches は CF Workers/Pages のグローバル
  const cache = caches.default as Cache;
  const cacheKey = new Request(`${url.origin}/api/crossword-video-info?id=${id}`, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  if (!env.YOUTUBE_API_KEY || !env.VITE_SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.TURNSTILE_SECRET) {
    console.error("crossword-video-info: env missing");
    return reply({ status: "unknown" }, 503, 0);
  }

  // 3. 回数の上限。生の IP は残さず、秘密の値を混ぜたハッシュだけを使う。照会・記録に失敗したら通さない
  const rest = `${env.VITE_SUPABASE_URL}/rest/v1`;
  const dbHeaders = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const ipHash = await sha256Hex(`${ENDPOINT}:${reporterKey(ip)}:${env.TURNSTILE_SECRET}`);
  const since = encodeURIComponent(new Date(Date.now() - HOUR_MS).toISOString());
  const countIp = () => countRows(rest, dbHeaders, `&ip_hash=eq.${ipHash}&created_at=gt.${since}`);
  const countAll = () => countRows(rest, dbHeaders, `&created_at=gt.${since}`);

  // a. 先に接続元ごとを数える。達していれば記録を書かずに断る
  const before = await countIp();
  if (before === null) return reply({ status: "unknown" }, 503, 0);
  if (before >= PER_IP_PER_HOUR) return reply({ status: "unknown" }, 429, 0);

  // b. 記録を書き、書き終わるのを待つ
  try {
    const wrote = await fetch(`${rest}/rate_limit_log`, {
      method: "POST",
      headers: { ...dbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ ip_hash: ipHash, endpoint: ENDPOINT }),
    });
    if (!wrote.ok) {
      console.error("crossword-video-info: log write failed", wrote.status);
      return reply({ status: "unknown" }, 503, 0);
    }
  } catch {
    console.error("crossword-video-info: log write threw");
    return reply({ status: "unknown" }, 503, 0);
  }

  // e. このエンドポイントの 1時間より古い記録を消す（返事の後で）
  context.waitUntil(
    logBackground(
      ENDPOINT,
      fetch(`${rest}/rate_limit_log?endpoint=eq.${ENDPOINT}&created_at=lt.${since}`, {
        method: "DELETE",
        headers: dbHeaders,
      }),
    ),
  );

  // c. 自分の分を含めて数え直す。同時に来た分もここで数えに入る
  const [ipAfter, allAfter] = await Promise.all([countIp(), countAll()]);
  if (ipAfter === null || allAfter === null) return reply({ status: "unknown" }, 503, 0);
  if (ipAfter > PER_IP_PER_HOUR || allAfter > ALL_PER_HOUR) return reply({ status: "unknown" }, 429, 0);

  // 4. YouTube に聞く
  const answer = await askYouTube(id, env.YOUTUBE_API_KEY);
  if (answer.status === "unknown") return reply(answer, 503, 0);
  const res = reply(answer, 200, answer.status === "ok" ? OK_TTL_SECONDS : GONE_TTL_SECONDS);
  context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

// このエンドポイントの記録の件数だけを聞く（行は取ってこない）。失敗・読めない時は null
async function countRows(rest: string, headers: Record<string, string>, filter: string): Promise<number | null> {
  try {
    const res = await fetch(`${rest}/rate_limit_log?select=id&endpoint=eq.${ENDPOINT}${filter}`, {
      method: "HEAD",
      headers: { ...headers, Prefer: "count=exact" },
    });
    const m = /\/(\d+)$/.exec(res.headers.get("Content-Range") ?? "");
    if (!res.ok || !m) {
      console.error("crossword-video-info: count failed", res.status);
      return null;
    }
    return Number(m[1]);
  } catch {
    console.error("crossword-video-info: count threw");
    return null;
  }
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
