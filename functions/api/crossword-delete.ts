/**
 * Cloudflare Pages Function: POST /api/crossword-delete
 *
 * 作った人が自分の問題を消す受け口。問題と一緒に、置き場 crossword-ogp のシェア画像も消す。
 * 置き場の絵は秘密の鍵でしか消せないので、ブラウザから直接ではなくここを通す。
 *
 *   1. 番号と合言葉の形を確かめる
 *   2. rpc crossword_delete（合言葉の sha256 が合えば消す）を呼ぶ
 *   3. 消せたら、絵を消す
 *   4. 消せなかったが問題がもう棚に無い（持ち主のいない絵）なら、絵だけ消す
 *      （問題を消したのに絵が残っていた分の片付け。棚にある問題の絵は、合言葉が無ければ消せない）
 *
 * 返事は { ok: true, deleted: boolean }。絵を消すのに失敗しても、問題の削除の結果はそのまま返す。
 */

import { deleteOgpPng } from "../_shared/crosswordOgp";

interface Env {
  VITE_SUPABASE_URL?: string;
  /** 置き場の絵を消すのに使う。RLS を迂回するので絶対に外へ出さない。 */
  SUPABASE_SECRET_KEY?: string;
}

const ID_RE = /^[A-Za-z0-9_-]{8}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    console.error("crossword-delete: env missing");
    return json({ ok: false, reason: "server" }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, reason: "bad_request" }, 400);
  }
  const id = typeof body.id === "string" ? body.id : "";
  const key = typeof body.key === "string" ? body.key : "";
  if (!ID_RE.test(id) || key.length < 32 || key.length > 128) return json({ ok: false, reason: "bad_request" }, 400);

  const base = env.VITE_SUPABASE_URL;
  const headers = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };

  // 2. 合言葉が合えば消す
  let deleted = false;
  try {
    const res = await fetch(`${base}/rest/v1/rpc/crossword_delete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_id: id, p_key: key }),
    });
    if (!res.ok) {
      console.error("crossword-delete: rpc failed", res.status);
      return json({ ok: false, reason: "server" }, 503);
    }
    deleted = (await res.json()) === true;
  } catch {
    return json({ ok: false, reason: "server" }, 503);
  }

  // 4. 消せなかったときは、問題がまだ棚にあるか見る。あるなら絵には触らない
  let orphan = false;
  if (!deleted) {
    try {
      const res = await fetch(`${base}/rest/v1/crossword_puzzles?select=id&id=eq.${encodeURIComponent(id)}`, { headers });
      if (res.ok) orphan = ((await res.json()) as unknown[]).length === 0;
    } catch {
      /* 分からなければ絵には触らない */
    }
  }

  // 3. 絵を消す（無ければ何も起きない）
  if (deleted || orphan) {
    await deleteOgpPng(base, env.SUPABASE_SECRET_KEY, id);
  }

  return json({ ok: true, deleted });
}
