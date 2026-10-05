/**
 * Cloudflare Pages Function: POST /api/crossword-owner-get
 *
 * 作った本人が、自分の問題を組み直すために中身（答えを含む）を受け取る受け口（Hop 決定 2026-10-05）。
 * 答えは受付係しか読めない棚（crossword_answers）にあるので、合言葉が合ったときだけ渡す。
 *
 *   1. 番号と合言葉の形を確かめる（crossword-delete と同じ検査）。同じ接続元からは 1 時間に 30 回まで【仮】
 *   2. rpc crossword_owner_read（合言葉の sha256 が合えば答えを返す）を呼ぶ
 *   3. 合えば、問題の行を秘密の鍵で読んで、答えと一緒に返す
 *
 * 合言葉が違う・番号が無い・隠された問題は、どれも 404 { ok:false, reason:"not_found" }（区別しない）。
 * 返事は { ok: true, puzzle: { id, title, genre, tags, body, is_beginner, group_tags, play_count }, answers }。
 */

import { tooLarge } from "../_shared/bodyLimit";

interface Env {
  VITE_SUPABASE_URL?: string;
  /** 接続元のハッシュに混ぜる秘密の値としてだけ使う（contact・crossword-save と同じ値）。 */
  TURNSTILE_SECRET?: string;
  /** 答えの棚と問題の棚を読むのに使う。RLS を迂回するので絶対に外へ出さない。 */
  SUPABASE_SECRET_KEY?: string;
}

const ENDPOINT = "crossword-owner-get";
const PER_IP_PER_HOUR = 30; // 【仮】
const ID_RE = /^[A-Za-z0-9_-]{8}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context: {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}): Promise<Response> {
  const { request, env } = context;
  if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.TURNSTILE_SECRET) {
    console.error("crossword-owner-get: env missing");
    return json({ ok: false, reason: "server" }, 500);
  }

  const large = tooLarge(request, 8192); // 本文を読む前に、大きさの申告で断る
  if (large) return large;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, reason: "bad_request" }, 400);
  }
  if (!body || typeof body !== "object") return json({ ok: false, reason: "bad_request" }, 400);
  const id = typeof body.id === "string" ? body.id : "";
  const key = typeof body.key === "string" ? body.key : "";
  if (!ID_RE.test(id) || key.length < 32 || key.length > 128) return json({ ok: false, reason: "bad_request" }, 400);

  const rest = `${env.VITE_SUPABASE_URL}/rest/v1`;
  const headers = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };

  // 接続元ごとの上限。生の IP は残さず、秘密の値を混ぜたハッシュだけを使う。照会に失敗したら通す
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const ipHash = await sha256Hex(`${ENDPOINT}:${ip}:${env.TURNSTILE_SECRET}`);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  try {
    const rl = await fetch(
      `${rest}/rate_limit_log?select=id&endpoint=eq.${ENDPOINT}&ip_hash=eq.${ipHash}` +
        `&created_at=gt.${encodeURIComponent(since)}&limit=${PER_IP_PER_HOUR}`,
      { headers },
    );
    if (rl.ok && ((await rl.json()) as unknown[]).length >= PER_IP_PER_HOUR) return json({ ok: false, reason: "too_many" }, 429);
  } catch {
    /* 照会に失敗したら通す */
  }
  context.waitUntil(
    Promise.all([
      fetch(`${rest}/rate_limit_log`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ ip_hash: ipHash, endpoint: ENDPOINT }),
      }),
      fetch(`${rest}/rate_limit_log?endpoint=eq.${ENDPOINT}&created_at=lt.${encodeURIComponent(since)}`, {
        method: "DELETE",
        headers,
      }),
    ]).catch(() => {}),
  );

  // 2. 合言葉が合えば答えが返る
  let answers: unknown = null;
  try {
    const res = await fetch(`${rest}/rpc/crossword_owner_read`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_id: id, p_key: key }),
    });
    if (!res.ok) {
      console.error("crossword-owner-get: rpc failed", res.status);
      return json({ ok: false, reason: "server" }, 503);
    }
    answers = await res.json();
  } catch {
    return json({ ok: false, reason: "server" }, 503);
  }
  if (!Array.isArray(answers)) return json({ ok: false, reason: "not_found" }, 404);

  // 3. 問題の行（秘密の鍵なので隠された問題も読めてしまう。隠された問題は組み直せないので無い扱いにする）
  let row: Record<string, unknown> | null = null;
  try {
    const res = await fetch(
      `${rest}/crossword_puzzles?select=id,title,genre,tags,body,is_beginner,group_tags,play_count,is_hidden&id=eq.${id}`,
      { headers },
    );
    if (!res.ok) {
      console.error("crossword-owner-get: puzzle read failed", res.status);
      return json({ ok: false, reason: "server" }, 503);
    }
    row = (((await res.json()) as Record<string, unknown>[])[0] ?? null);
  } catch {
    return json({ ok: false, reason: "server" }, 503);
  }
  if (!row || row.is_hidden === true) return json({ ok: false, reason: "not_found" }, 404);
  const { is_hidden: _hidden, ...puzzle } = row;
  void _hidden;

  return json({ ok: true, puzzle, answers });
}
