/**
 * Cloudflare Pages Function: POST /api/crossword-update-hints
 *
 * 作った本人が、遊ばれた後でもヒントだけを差し替える受け口（Hop 決定 2026-10-19）。
 * 組み直し（crossword-update）は「遊ばれた回数 0」の時だけだが、ヒントは答えにもランキングにも触れないので、この窓口は回数を見ない。
 *
 *   1. 番号と合言葉の形を確かめる。同じ接続元からは 1 時間に 10 回まで【仮】（成否に関係なく数える。IPv6 は /64 の帯で数える）
 *   2. rpc crossword_owner_read で合言葉を照らす。合わなければ 404 not_found
 *   3. 棚にある本文を読む（隠された問題は 404）。送られてきたのは「どのカギのヒントを何に替えるか」だけで、
 *      本文はブラウザから受け取らず、棚の本文のヒント部分だけを入れ替えて組み立てる（題名・答え・カギの文はここからは変えられない）
 *   4. 替えるヒントは保存と同じ検査（cleanHint。YouTube を「リンク」として通さない決まりも同じ）。
 *      チャンネル名は保存しない（台帳に無い動画のチャンネル名は画面を開くたびに受付係 crossword-video-info が聞く。Hop 決定 2026-10-19・2026-10-21）
 *   5. rpc crossword_update_hints（合言葉が合い・隠されていない時だけ本文を書き換える）
 *
 * 送る形: { id, key, hints: { "<direction>:<clueIndex>": ヒント, ... } }
 * 返事は { ok: true }。
 */

import { readJsonLimited } from "../_shared/bodyLimit";
import { logBackground } from "../_shared/background";
import { reporterKey } from "../_shared/reporterKey";
import { cleanHint, json, sha256Hex } from "./crossword-save";

interface Env {
  VITE_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  TURNSTILE_SECRET?: string;
}

const ENDPOINT = "crossword-update-hints";
const PER_IP_PER_HOUR = 10; // 【仮】
const ID_RE = /^[A-Za-z0-9_-]{8}$/;
const MAX_BODY_BYTES = 51200; // 棚の決まり octet_length(body::text) <= 51200 と同じ
const KEY_RE = /^(horizontal|vertical):\d{1,3}$/;

interface StoredClue {
  clueIndex: number;
  direction: "horizontal" | "vertical";
  hint?: unknown;
  [k: string]: unknown;
}

export async function onRequestPost(context: {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}): Promise<Response> {
  const { request, env } = context;
  if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.TURNSTILE_SECRET) {
    console.error(`${ENDPOINT}: env missing`);
    return json({ ok: false, reason: "server" }, 500);
  }

  // ヒントの一覧だけなので小さい。60 語 × 500 字のリンクでも 16KB に収まらないことはあるが、通常はこれで足りる【仮】
  const read = await readJsonLimited(request, 65536);
  if (read.response) return read.response;
  const body = read.value as Record<string, unknown>;
  if (!body || typeof body !== "object") return json({ ok: false, reason: "bad_request" }, 400);
  const id = typeof body.id === "string" ? body.id : "";
  const key = typeof body.key === "string" ? body.key : "";
  if (!ID_RE.test(id) || key.length < 32 || key.length > 128) return json({ ok: false, reason: "bad_request" }, 400);
  const hintsIn = body.hints;
  if (!hintsIn || typeof hintsIn !== "object" || Array.isArray(hintsIn)) return json({ ok: false, reason: "bad_request" }, 400);
  const entries = Object.entries(hintsIn as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 60) return json({ ok: false, reason: "bad_request" }, 400);

  const rest = `${env.VITE_SUPABASE_URL}/rest/v1`;
  const dbHeaders = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };

  // 1. 接続元ごとの上限（crossword-update と同じ流儀）
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const ipHash = await sha256Hex(`${ENDPOINT}:${reporterKey(ip)}:${env.TURNSTILE_SECRET}`);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  try {
    const rl = await fetch(
      `${rest}/rate_limit_log?select=id&endpoint=eq.${ENDPOINT}&ip_hash=eq.${ipHash}` +
        `&created_at=gt.${encodeURIComponent(since)}&limit=${PER_IP_PER_HOUR}`,
      { headers: dbHeaders },
    );
    if (rl.ok && ((await rl.json()) as unknown[]).length >= PER_IP_PER_HOUR) return json({ ok: false, reason: "too_many" }, 429);
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

  // 2. 合言葉を照らす（答えが返れば合う）
  try {
    const res = await fetch(`${rest}/rpc/crossword_owner_read`, {
      method: "POST",
      headers: dbHeaders,
      body: JSON.stringify({ p_id: id, p_key: key }),
    });
    if (!res.ok) {
      console.error(`${ENDPOINT}: owner read failed`, res.status);
      return json({ ok: false, reason: "server" }, 503);
    }
    if (!Array.isArray(await res.json())) return json({ ok: false, reason: "not_found" }, 404);
  } catch (e) {
    console.error(`${ENDPOINT}: owner read threw`, String(e));
    return json({ ok: false, reason: "server" }, 503);
  }

  // 3. 棚の本文を読む
  let row: { body?: unknown; is_hidden?: unknown } | undefined;
  try {
    const res = await fetch(`${rest}/crossword_puzzles?select=body,is_hidden&id=eq.${id}`, { headers: dbHeaders });
    if (!res.ok) {
      console.error(`${ENDPOINT}: puzzle read failed`, res.status);
      return json({ ok: false, reason: "server" }, 503);
    }
    row = ((await res.json()) as { body?: unknown; is_hidden?: unknown }[])[0];
  } catch (e) {
    console.error(`${ENDPOINT}: puzzle read threw`, String(e));
    return json({ ok: false, reason: "server" }, 503);
  }
  if (!row || row.is_hidden !== false) return json({ ok: false, reason: "not_found" }, 404);
  const stored = row.body as { clues?: unknown } | null;
  if (!stored || typeof stored !== "object" || !Array.isArray(stored.clues)) return json({ ok: false, reason: "server" }, 503);
  const clues = stored.clues as StoredClue[];

  // 4. 替えるヒントを検査して、棚の本文のヒント部分だけ入れ替える
  const replaced = new Map<string, ReturnType<typeof cleanHint>>();
  for (const [k, h] of entries) {
    if (!KEY_RE.test(k)) return json({ ok: false, reason: "bad_request" }, 400);
    const hint = cleanHint(h);
    if (!hint) return json({ ok: false, reason: "bad_request" }, 400);
    replaced.set(k, hint);
  }
  const keysInBody = new Set(clues.map((c) => `${c.direction}:${c.clueIndex}`));
  for (const k of replaced.keys()) if (!keysInBody.has(k)) return json({ ok: false, reason: "bad_request" }, 400);

  const nextClues = clues.map((c) => {
    const k = `${c.direction}:${c.clueIndex}`;
    const h = replaced.get(k);
    if (!h) return c; // 触らないカギは棚の中身そのまま
    return { ...c, hint: h };
  });
  if (nextClues.some((c) => !c.hint)) return json({ ok: false, reason: "bad_request" }, 400);
  const nextBody = { ...(stored as Record<string, unknown>), clues: nextClues };
  if (new TextEncoder().encode(JSON.stringify(nextBody)).length > MAX_BODY_BYTES) return json({ ok: false, reason: "bad_request" }, 400);

  // 5. 書き換え
  try {
    const res = await fetch(`${rest}/rpc/crossword_update_hints`, {
      method: "POST",
      headers: dbHeaders,
      body: JSON.stringify({ p_id: id, p_key: key, p_body: nextBody }),
    });
    if (!res.ok) {
      console.error(`${ENDPOINT}: rpc failed`, res.status);
      return json({ ok: false, reason: "server" }, 503);
    }
    const updated = (await res.json()) as unknown;
    if (updated !== true) return json({ ok: false, reason: "not_found" }, 404);
  } catch (e) {
    console.error(`${ENDPOINT}: rpc threw`, String(e));
    return json({ ok: false, reason: "server" }, 503);
  }
  return json({ ok: true });
}
