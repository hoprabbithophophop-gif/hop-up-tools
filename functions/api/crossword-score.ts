/**
 * Cloudflare Pages Function: POST /api/crossword-score
 *
 * クロスワードのクリアタイムを記録する受付係。手本は functions/api/contact.ts と crossword-save.ts。
 *
 * crossword_scores には誰も直接入れられない（RLS で insert の窓口が無い）。
 * 秘密の鍵を持つこのサーバーだけが入れる。
 *
 *   1. ハニーポット（bot が隠しフィールドを埋めたら黙って捨てる）
 *   2. 同一接続元の連投チェック（rate_limit_log、endpoint = crossword-score）
 *   3. 中身の確かめ（ブラウザ側の確かめは信用しない）
 *   4. 記録。同じ人（端末の見分け用の番号の sha256）の記録は、速いときだけ書き換える
 *      （HarmonyPalette の saveScore と同じ動き。名前が空なら「名無し」〔Hop 決定 2026-10-03。HarmonyPalette は Anonymous〕、書き換えで名前が空なら前の名前のまま）
 *      見た文字数とミスの回数も、そのタイムと一緒に残す（ランキングの印。Hop 決定 2026-10-04）
 *
 * Turnstile は無し【仮】。名前は事前検査しない（DESIGN.md §4-b。見えない文字を落とすのは検査ではなく掃除）。
 * 作った本人の端末で解いた回は、画面の側で送らない（ここでは分からない）。
 */

interface Env {
  VITE_SUPABASE_URL?: string;
  /** crossword_scores への書き込み用。RLS を迂回するので絶対に外へ出さない。 */
  SUPABASE_SECRET_KEY?: string;
  /** ここでは人間の確かめには使わない。接続元のハッシュに混ぜる秘密の値としてだけ使う（contact・crossword-save と同じ値）。 */
  TURNSTILE_SECRET?: string;
}

/** 同一接続元からの上限（1時間あたり）【仮】。 */
const PER_IP_PER_HOUR = 30;
/** rate_limit_log 上でこのエンドポイントを識別する名前。 */
const ENDPOINT = "crossword-score";

const ID_RE = /^[A-Za-z0-9_-]{8}$/;
const PLAYER_KEY_RE = /^[0-9a-f]{64}$/;
const MAX_NAME = 20;
const MIN_TIME = 1;
const MAX_TIME = 86400;
const ANONYMOUS = "名無し";
const MAX_REVEALS = 1000;
const MAX_MISSES = 10000;

export interface CleanScore {
  puzzleId: string;
  /** 端末の見分け用の番号（32バイトの乱数の16進）。保存するのはこの sha256 だけ */
  playerKey: string;
  /** 空なら "" */
  name: string;
  timeSeconds: number;
  /** 1文字見るを使った数 */
  reveals: number;
  /** 答え合わせで「どこかに間違いがあります。」が出た回数 */
  misses: number;
}

/** 改行・タブを含む制御文字と、見えない文字を落とす（contact.ts の stripUnsafe と同じ範囲）。 */
function stripUnsafe(input: string): string {
  let out = "";
  for (const ch of input) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x20 || c === 0x7f) continue; // 制御文字（名前は1行なので改行・タブも落とす）
    if (c >= 0x200b && c <= 0x200f) continue; // ゼロ幅・方向マーク
    if (c >= 0x202a && c <= 0x202e) continue; // 埋め込み・上書き
    if (c >= 0x2060 && c <= 0x2064) continue; // 不可視結合子
    if (c >= 0x2066 && c <= 0x2069) continue; // 分離
    if (c === 0xfeff) continue; // BOM
    out += ch;
  }
  return out;
}

/** 受け取った中身を確かめる。だめなら null。DB には触らない（node で試せるように切り出してある）。 */
export function validateScorePayload(raw: unknown): CleanScore | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.puzzleId !== "string" || !ID_RE.test(p.puzzleId)) return null;
  if (typeof p.playerKey !== "string" || !PLAYER_KEY_RE.test(p.playerKey)) return null;
  if (typeof p.timeSeconds !== "number" || !Number.isInteger(p.timeSeconds)) return null;
  if (p.timeSeconds < MIN_TIME || p.timeSeconds > MAX_TIME) return null;
  // 見た文字数・ミスの回数。送られてこなければ 0（古い画面から来た記録のため）
  const count = (v: unknown, max: number): number | null =>
    v === undefined || v === null ? 0 : typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
  const reveals = count(p.reveals, MAX_REVEALS);
  const misses = count(p.misses, MAX_MISSES);
  if (reveals === null || misses === null) return null;
  let name = "";
  if (p.name !== undefined && p.name !== null) {
    if (typeof p.name !== "string") return null;
    name = stripUnsafe(p.name).trim();
    if (Array.from(name).length > MAX_NAME) return null;
  }
  return { puzzleId: p.puzzleId, playerKey: p.playerKey, name, timeSeconds: p.timeSeconds, reveals, misses };
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** PostgREST の失敗の中身から Postgres の errcode を読む。読めなければ ""。 */
async function pgCode(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { code?: unknown };
    return typeof j.code === "string" ? j.code : "";
  } catch {
    return "";
  }
}

export async function onRequestPost(context: {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}): Promise<Response> {
  const { request, env } = context;

  if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.TURNSTILE_SECRET) {
    console.error("crossword-score: env missing");
    return json({ ok: false, reason: "server" }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, reason: "bad_request" }, 400);
  }
  if (!body || typeof body !== "object") return json({ ok: false, reason: "bad_request" }, 400);

  // 1. ハニーポット。埋まっていたら bot なので、記録したふりをして捨てる（contact.ts と同じ）。
  if (typeof body.website === "string" && body.website !== "") {
    return json({ ok: true, updated: false });
  }

  const rest = `${env.VITE_SUPABASE_URL}/rest/v1`;
  const dbHeaders = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };

  // 2. 連投チェック。生の IP は保存せず、秘密の値を混ぜたハッシュだけを残す。
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const ipHash = await sha256Hex(`${ENDPOINT}:${ip}:${env.TURNSTILE_SECRET}`);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  try {
    const res = await fetch(
      `${rest}/rate_limit_log?select=id&endpoint=eq.${ENDPOINT}` +
        `&ip_hash=eq.${ipHash}&created_at=gt.${encodeURIComponent(since)}&limit=${PER_IP_PER_HOUR}`,
      { headers: dbHeaders },
    );
    if (res.ok) {
      const rows = (await res.json()) as unknown[];
      if (rows.length >= PER_IP_PER_HOUR) return json({ ok: false, reason: "too_many" }, 429);
    }
    // 照会に失敗した場合は通す（記録が1件増えるだけで、壊れる物は無い）。
  } catch {
    /* 同上 */
  }

  // 3. 中身の確かめ。
  const score = validateScorePayload(body);
  if (!score) return json({ ok: false, reason: "bad_request" }, 400);
  const playerHash = await sha256Hex(score.playerKey);

  // 4. 記録。まず新しく入れてみて、同じ人の記録が既にあれば（23505）速いときだけ書き換える。
  let updated = false;
  const insert = await fetch(`${rest}/crossword_scores`, {
    method: "POST",
    headers: { ...dbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({
      puzzle_id: score.puzzleId,
      player_hash: playerHash,
      display_name: score.name || ANONYMOUS,
      time_seconds: score.timeSeconds,
      reveals: score.reveals,
      misses: score.misses,
    }),
  });
  if (insert.ok) {
    updated = true;
  } else {
    const code = await pgCode(insert);
    if (code === "23503") return json({ ok: false, reason: "bad_request" }, 400); // 問題が無い（消された）
    if (code !== "23505") {
      console.error("crossword-score: insert failed", insert.status, code);
      if (code === "23514") return json({ ok: false, reason: "bad_request" }, 400); // 棚の決まりに合わない（保険）
      return json({ ok: false, reason: "server" }, 503);
    }
    // 既にある。今の記録より速いときだけ書き換える（条件つきの書き換えなので、同時に来ても遅い方で上書きしない）。
    const patch: Record<string, unknown> = {
      time_seconds: score.timeSeconds,
      reveals: score.reveals, // 印はそのタイムを出した回のもの
      misses: score.misses,
      updated_at: new Date().toISOString(),
    };
    if (score.name) patch.display_name = score.name; // 名前が空なら前の名前のまま
    const res = await fetch(
      `${rest}/crossword_scores?puzzle_id=eq.${score.puzzleId}&player_hash=eq.${playerHash}` +
        `&time_seconds=gt.${score.timeSeconds}`,
      {
        method: "PATCH",
        headers: { ...dbHeaders, Prefer: "return=representation" },
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) {
      console.error("crossword-score: update failed", res.status, await pgCode(res));
      return json({ ok: false, reason: "server" }, 503);
    }
    const rows = (await res.json().catch(() => [])) as unknown[];
    updated = Array.isArray(rows) && rows.length > 0;
  }

  context.waitUntil(
    fetch(`${rest}/rate_limit_log`, {
      method: "POST",
      headers: { ...dbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ ip_hash: ipHash, endpoint: ENDPOINT }),
    }).catch(() => {}),
  );
  context.waitUntil(
    fetch(`${rest}/rate_limit_log?endpoint=eq.${ENDPOINT}&created_at=lt.${encodeURIComponent(since)}`, {
      method: "DELETE",
      headers: dbHeaders,
    }).catch(() => {}),
  );

  return json({ ok: true, updated });
}
