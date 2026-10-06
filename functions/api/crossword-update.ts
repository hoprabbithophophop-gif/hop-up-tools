/**
 * Cloudflare Pages Function: POST /api/crossword-update
 *
 * 作った本人が、まだ誰にも遊ばれていない問題を組み直して書き換える受け口（Hop 決定 2026-10-05）。
 * 本文の検査は保存（crossword-save）と同じ関数を使う。人間確認（Turnstile）は無し【仮】（合言葉が本人確認を兼ねる）。
 *
 *   1. 番号と合言葉の形を確かめる。同じ接続元からは 1 時間に 10 回まで【仮】（成否に関係なく数える。IPv6 は /64 の帯で数える）
 *   2. 重い検査の前に、rpc crossword_owner_read で合言葉だけを先に照らす。合わない（番号が無い・合言葉が違う）なら 404 not_found
 *   3. 本文の確かめ（validateSavePayload）・ハロプロの YouTube ヒントの台帳の確認（checkHelloVideos）
 *   4. rpc crossword_update（合言葉が合い・遊ばれた回数 0・隠されていない時だけ書き換える）
 *      false のときは合言葉と問題の行を照らし直し、合言葉が合わない・問題が無い・隠れているなら 404 not_found
 *      （合言葉の正誤を区別しない）、隠れておらず遊ばれた回数が 0 でないときだけ 409 already_played【仮】
 *   5. シェア画像を置き場に上書きする。置けなくても更新は成功にする
 *
 * 送る形: { id, key, puzzle: 保存と同じ形（crossword-save の puzzle）, ogpImage? }
 * 返事は { ok: true, id, ogp }。
 */

import { decodeOgpPng, uploadOgpPng } from "../_shared/crosswordOgp";
import { readJsonLimited } from "../_shared/bodyLimit";
import { logBackground } from "../_shared/background";
import { reporterKey } from "../_shared/reporterKey";
import { checkHelloVideos, json, pgCode, sha256Hex, toStoredBody, validateSavePayload } from "./crossword-save";

interface Env {
  VITE_SUPABASE_URL?: string;
  /** 問題の棚・答えの棚・置き場への書き込み用。RLS を迂回するので絶対に外へ出さない。 */
  SUPABASE_SECRET_KEY?: string;
  /** 接続元のハッシュに混ぜる秘密の値としてだけ使う（contact・crossword-save と同じ値）。 */
  TURNSTILE_SECRET?: string;
}

const ENDPOINT = "crossword-update";
const PER_IP_PER_HOUR = 10; // 【仮】
const ID_RE = /^[A-Za-z0-9_-]{8}$/;

export async function onRequestPost(context: {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}): Promise<Response> {
  const { request, env } = context;
  if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.TURNSTILE_SECRET) {
    console.error("crossword-update: env missing");
    return json({ ok: false, reason: "server" }, 500);
  }

  // シェア画像を含むので保存と同じ上限。申告が無い送り方でも読みながら数えて断る
  const read = await readJsonLimited(request, 450000);
  if (read.response) return read.response;
  const body = read.value as Record<string, unknown>;
  if (!body || typeof body !== "object") return json({ ok: false, reason: "bad_request" }, 400);
  const id = typeof body.id === "string" ? body.id : "";
  const key = typeof body.key === "string" ? body.key : "";
  if (!ID_RE.test(id) || key.length < 32 || key.length > 128) return json({ ok: false, reason: "bad_request" }, 400);

  const rest = `${env.VITE_SUPABASE_URL}/rest/v1`;
  const dbHeaders = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };

  // 1. 接続元ごとの上限。生の IP は残さず、秘密の値を混ぜたハッシュだけを使う。照会に失敗したら通す
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

  // 合言葉が合うか（答えが返れば合う）。"server" は照会できなかった
  const ownerOk = async (): Promise<boolean | "server"> => {
    try {
      const res = await fetch(`${rest}/rpc/crossword_owner_read`, {
        method: "POST",
        headers: dbHeaders,
        body: JSON.stringify({ p_id: id, p_key: key }),
      });
      if (!res.ok) {
        console.error("crossword-update: owner read failed", res.status);
        return "server";
      }
      return Array.isArray(await res.json());
    } catch (e) {
      console.error("crossword-update: owner read threw", String(e));
      return "server";
    }
  };

  // 2. 重い検査の前に合言葉だけを照らす
  const owner = await ownerOk();
  if (owner === "server") return json({ ok: false, reason: "server" }, 503);
  if (!owner) return json({ ok: false, reason: "not_found" }, 404);

  // 3. 中身の確かめ（保存と同じ）。合言葉は外側の key を使う
  const raw = body.puzzle;
  if (!raw || typeof raw !== "object") return json({ ok: false, reason: "bad_request" }, 400);
  const puzzle = validateSavePayload({ ...(raw as Record<string, unknown>), key });
  if (!puzzle) return json({ ok: false, reason: "bad_request" }, 400);

  const catalog = await checkHelloVideos(rest, dbHeaders, puzzle.helloVideoIds, "crossword-update");
  if (catalog === "server") return json({ ok: false, reason: "server" }, 503);
  if (catalog === "video") return json({ ok: false, reason: "video" }, 400);

  // 4. 書き換え
  let updated = false;
  try {
    const res = await fetch(`${rest}/rpc/crossword_update`, {
      method: "POST",
      headers: dbHeaders,
      body: JSON.stringify({
        p_id: id,
        p_key: key,
        p_body: toStoredBody(puzzle.body),
        p_answers: puzzle.body.clues.map((c) => c.answer),
        p_title: puzzle.title,
        p_genre: puzzle.genre,
        p_tags: puzzle.tags,
        p_is_beginner: puzzle.isBeginner,
        p_group_tags: puzzle.groupTags,
      }),
    });
    if (!res.ok) {
      const code = await pgCode(res);
      console.error("crossword-update: rpc failed", res.status, code);
      if (code === "23514") return json({ ok: false, reason: "bad_request" }, 400); // 棚の決まりに合わない（保険）
      return json({ ok: false, reason: "server" }, 503);
    }
    updated = (await res.json()) === true;
  } catch {
    return json({ ok: false, reason: "server" }, 503);
  }

  if (!updated) {
    // 書き換えられなかった理由を照らし直す。合言葉が合わない・問題が無い・隠れている、はどれも 404（区別しない）。
    // 隠れておらず、遊ばれた回数が 0 でないときだけ 409
    const again = await ownerOk();
    if (again === "server") return json({ ok: false, reason: "server" }, 503);
    if (!again) return json({ ok: false, reason: "not_found" }, 404);
    let row: { play_count?: unknown; is_hidden?: unknown } | undefined;
    try {
      const res = await fetch(`${rest}/crossword_puzzles?select=play_count,is_hidden&id=eq.${id}`, { headers: dbHeaders });
      if (!res.ok) {
        console.error("crossword-update: puzzle read failed", res.status);
        return json({ ok: false, reason: "server" }, 503);
      }
      row = ((await res.json()) as { play_count?: unknown; is_hidden?: unknown }[])[0];
    } catch (e) {
      console.error("crossword-update: puzzle read threw", String(e));
      return json({ ok: false, reason: "server" }, 503);
    }
    if (!row || row.is_hidden !== false) return json({ ok: false, reason: "not_found" }, 404);
    if (row.play_count !== 0) return json({ ok: false, reason: "already_played" }, 409);
    // 合言葉が合い・隠れておらず・回数も 0 なのに書き換えられなかった（想定外）
    console.error("crossword-update: update refused without known reason");
    return json({ ok: false, reason: "server" }, 503);
  }

  // 5. シェア画像。形が合わない・置けない場合は画像なしで続ける（問題の書き換えは済んでいる）
  let ogp = false;
  const png = decodeOgpPng(body.ogpImage);
  if (png) ogp = await uploadOgpPng(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, id, png, true);
  else if (body.ogpImage !== undefined) console.warn("crossword-update: ogp image rejected");

  return json({ ok: true, id, ogp });
}
