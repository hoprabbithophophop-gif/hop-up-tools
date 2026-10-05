/**
 * Cloudflare Pages Function: POST /api/crossword-save
 *
 * クロスワードの問題を保存する受付係。手本は functions/api/contact.ts。
 *
 * crossword_puzzles には誰も直接入れられない（RLS で insert の窓口が無い）。
 * 秘密の鍵を持つこのサーバーだけが入れる。関門はすべてここに集める。
 *
 *   1. ハニーポット（bot が隠しフィールドを埋めたら黙って捨てる）
 *   2. Turnstile 検証（Cloudflare に「人間か」を問い合わせる）
 *   3. 同一接続元の連投チェック（rate_limit_log）
 *   4. 中身の確かめ（ブラウザ側の確かめは信用しない）
 *   5. 保存（問題 → 削除用の合言葉の sha256）
 *
 * DB の BEFORE INSERT トリガに「1時間に全体100件」のブレーキ（errcode 53400）があり、
 * ここを全部すり抜けても最後に効く。
 *
 * 段階2b で足したもの
 *   ・初めての人向けの印（is_beginner）
 *   ・題名とカギの文・答えから、メンバー名・グループ名でグループを判定して group_tags に入れる。
 *     入れるのは、作る人が「ハロプロ」を選んだ問題だけ。ジャンルは作る人の選んだまま書き換えない
 *     （Hop 決定 2026-10-03。たまたま名前が出るだけの「その他」の問題をハロプロに分けない）
 *   ・シェア画像（1200×630 の PNG）を確かめてから置き場 crossword-ogp に置く。置けなくても保存は成功にする
 */

import { detectGroups } from "../_shared/crosswordGroups";
import { CROSSWORD_GROUPS, CROSSWORD_MEMBERS } from "../_shared/crosswordMembers";
import { decodeOgpPng, uploadOgpPng } from "../_shared/crosswordOgp";
import { tooLarge } from "../_shared/bodyLimit";
import { toLargeKana } from "../_shared/crosswordKana";

interface Env {
  VITE_SUPABASE_URL?: string;
  /** crossword_puzzles / crossword_owner_keys への書き込み用。RLS を迂回するので絶対に外へ出さない。 */
  SUPABASE_SECRET_KEY?: string;
  TURNSTILE_SECRET?: string;
}

/** 同一接続元からの上限（1時間あたり）。 */
const PER_IP_PER_HOUR = 10;
/** rate_limit_log 上でこのエンドポイントを識別する名前。 */
const ENDPOINT = "crossword-save";

const ID_RE = /^[A-Za-z0-9_-]{8}$/;
const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"; // 64字
const MAX_ID_TRIES = 5;

const MAX_TITLE = 60;
const MAX_TAGS = 10;
const MAX_TAG = 20;
const MAX_BODY_BYTES = 51200;
const MAX_CREATOR = 50;
const MIN_KEY = 32;
const MAX_KEY = 128;
const ANSWER_RE = /^[ァ-ヶー]+$/;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

type Hint = { kind: "youtube"; videoId: string; startSec: number } | { kind: "link"; url: string };

interface CleanClue {
  clueIndex: number;
  direction: "horizontal" | "vertical";
  startX: number;
  startY: number;
  clue: string;
  answer: string[];
  hint: Hint;
}

export interface CleanPuzzle {
  /** 保存するジャンル。グループが見つかったら、送られてきたのが other でも hello */
  genre: "hello" | "other";
  /** 送られてきたジャンル（断る理由の出し分けに使う） */
  requestedGenre: "hello" | "other";
  title: string;
  tags: string[];
  body: { version: 1; width: number; height: number; clues: CleanClue[]; creatorName?: string };
  key: string;
  isBeginner: boolean;
  /** メンバー名・グループ名から判定したグループ（公式表記） */
  groupTags: string[];
  /** genre=hello のとき台帳に載っているか確かめる動画番号（重なりなし） */
  helloVideoIds: string[];
}

const isInt = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;
const isStr = (v: unknown): v is string => typeof v === "string";
const charLen = (s: string) => Array.from(s).length;

function cleanHint(h: unknown): Hint | null {
  if (!h || typeof h !== "object") return null;
  const o = h as Record<string, unknown>;
  if (o.kind === "youtube") {
    if (!isStr(o.videoId) || !VIDEO_ID_RE.test(o.videoId)) return null;
    if (!isInt(o.startSec)) return null;
    return { kind: "youtube", videoId: o.videoId, startSec: o.startSec };
  }
  if (o.kind === "link") {
    if (!isStr(o.url)) return null;
    let u: URL;
    try {
      u = new URL(o.url);
    } catch {
      return null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (linkProblem(o.url)) return null;
    return { kind: "link", url: o.url };
  }
  return null;
}

function cleanClue(c: unknown): CleanClue | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  if (o.direction !== "horizontal" && o.direction !== "vertical") return null;
  if (!isInt(o.clueIndex) || !isInt(o.startX) || !isInt(o.startY)) return null;
  if (!isStr(o.clue)) return null;
  if (!Array.isArray(o.answer) || o.answer.length === 0) return null;
  // 答えは1マス1字の並び。各マスが1字で、つなげたものがカタカナ（と「ー」）だけ
  if (!o.answer.every((a) => isStr(a) && charLen(a) === 1)) return null;
  // 小さい字は大きい字にそろえてから棚へ入れる（Hop 決定 2026-10-05）
  const answer = (o.answer as string[]).map(toLargeKana);
  if (!ANSWER_RE.test(answer.join(""))) return null;
  const hint = cleanHint(o.hint);
  if (!hint) return null;
  return {
    clueIndex: o.clueIndex,
    direction: o.direction,
    startX: o.startX,
    startY: o.startY,
    clue: o.clue,
    answer,
    hint,
  };
}

/**
 * 受け取った中身を確かめ、保存してよい形に整える。だめなら null。
 * Turnstile・DB には触らない（node で単体に近い形で試せるように切り出してある）。
 */
export function validateSavePayload(raw: unknown): CleanPuzzle | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;

  if (!isStr(p.title)) return null;
  const title = p.title.trim();
  if (charLen(title) < 1 || charLen(title) > MAX_TITLE) return null;

  if (p.genre !== "hello" && p.genre !== "other") return null;
  const requestedGenre = p.genre;

  // 初めての人向けの印。無ければ false、あれば true/false だけ
  if (p.isBeginner !== undefined && typeof p.isBeginner !== "boolean") return null;
  const isBeginner = p.isBeginner === true;

  const rawTags = p.tags ?? [];
  if (!Array.isArray(rawTags) || rawTags.length > MAX_TAGS) return null;
  const tags: string[] = [];
  for (const t of rawTags) {
    if (!isStr(t)) return null;
    const s = t.trim();
    if (s === "" || charLen(s) > MAX_TAG) return null;
    tags.push(s);
  }

  if (!isStr(p.key) || p.key.length < MIN_KEY || p.key.length > MAX_KEY) return null;
  const key = p.key;

  const b = p.body;
  if (!b || typeof b !== "object") return null;
  const bo = b as Record<string, unknown>;
  if (bo.version !== 1) return null;
  if (!isInt(bo.width, 1) || !isInt(bo.height, 1)) return null;
  if (!Array.isArray(bo.clues) || bo.clues.length < 2) return null;
  const clues: CleanClue[] = [];
  for (const c of bo.clues) {
    const cc = cleanClue(c);
    if (!cc) return null;
    clues.push(cc);
  }
  let creatorName: string | undefined;
  if (bo.creatorName !== undefined) {
    if (!isStr(bo.creatorName) || charLen(bo.creatorName) > MAX_CREATOR) return null;
    if (bo.creatorName.trim() !== "") creatorName = bo.creatorName.trim();
  }

  const body: CleanPuzzle["body"] = { version: 1, width: bo.width, height: bo.height, clues };
  if (creatorName) body.creatorName = creatorName;

  // 大きさは保存する形（整えた後）で測る。DB 側の上限 octet_length(body::text) と同じ 51200 バイト
  if (new TextEncoder().encode(JSON.stringify(body)).length > MAX_BODY_BYTES) return null;

  const genre = requestedGenre;
  const groupTags =
    genre === "hello"
      ? detectGroups(
          { title, clues: clues.map((c) => c.clue), answers: clues.map((c) => c.answer.join("")) },
          { members: CROSSWORD_MEMBERS, groups: CROSSWORD_GROUPS },
        )
      : [];

  const helloVideoIds =
    genre === "hello"
      ? [...new Set(clues.flatMap((c) => (c.hint.kind === "youtube" ? [c.hint.videoId] : [])))]
      : [];

  return { title, genre, requestedGenre, tags, body, key, isBeginner, groupTags, helloVideoIds };
}

/**
 * ハロプロのジャンルの YouTube ヒントが、台帳に表示してよい動画として載っているか。
 * 全部載っていれば "ok"、載っていない物があれば "video"、台帳に聞けなければ "server"。
 * 保存（crossword-save）と組み直し（crossword-update）の両方から使う。
 */
export async function checkHelloVideos(
  rest: string,
  headers: Record<string, string>,
  ids: string[],
  label: string,
): Promise<"ok" | "video" | "server"> {
  if (ids.length === 0) return "ok";
  try {
    const res = await fetch(
      `${rest}/youtube_videos?select=video_id&is_active_content=eq.true` + `&video_id=in.(${ids.join(",")})`,
      { headers },
    );
    if (!res.ok) {
      console.error(`${label}: catalog check failed`, res.status);
      return "server";
    }
    const rows = (await res.json()) as { video_id: string }[];
    const found = new Set(rows.map((r) => r.video_id));
    return ids.every((v) => found.has(v)) ? "ok" : "video";
  } catch {
    return "server";
  }
}

/** 誰でも読める棚に置く本文。答えの代わりに文字数だけ残す（Hop 決定 2026-10-04「答えを渡さない作り」） */
export function toStoredBody(body: CleanPuzzle["body"]) {
  return { ...body, clues: body.clues.map(({ answer, ...c }) => ({ ...c, length: answer.length })) };
}

/** 8字の問題番号。64字の表から選ぶので、1バイトの下6ビットでかたよりなく選べる。 */
export function makeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let id = "";
  for (const b of bytes) id += ID_CHARS[b & 63];
  return id;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** PostgREST の失敗の中身から Postgres の errcode を読む。読めなければ ""。 */
export async function pgCode(res: Response): Promise<string> {
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
    console.error("crossword-save: env missing");
    return json({ ok: false, reason: "server" }, 500);
  }

  const large = tooLarge(request, 450000); // 本文を読む前に、大きさの申告で断る
  if (large) return large;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, reason: "bad_request" }, 400);
  }
  if (!body || typeof body !== "object") return json({ ok: false, reason: "bad_request" }, 400);

  // 1. ハニーポット。埋まっていたら bot なので「成功した」と見せずに黙って断る
  //    （番号を返すと存在しない問題のリンクになるので、ここは contact.ts と違い ok:false の普通の失敗に見せる）。
  if (typeof body.website === "string" && body.website !== "") {
    return json({ ok: false, reason: "bad_request" }, 400);
  }

  // 2. Turnstile。ここを通らないと以降の処理に進まない（失敗時は閉じる方に倒す）。
  const token = typeof body.token === "string" ? body.token : "";
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET, token, ip))) {
    return json({ ok: false, reason: "verification" }, 403);
  }

  const rest = `${env.VITE_SUPABASE_URL}/rest/v1`;
  const dbHeaders = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };

  // 3. 連投チェック。生の IP は保存せず、秘密の値を混ぜたハッシュだけを残す。
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
    // 照会に失敗した場合は通す。全体ブレーキ（1時間100件）が最後に効く。
  } catch {
    /* 同上 */
  }

  // 4. 中身の確かめ。
  const puzzle = validateSavePayload(body.puzzle);
  if (!puzzle) return json({ ok: false, reason: "bad_request" }, 400);

  // ハロプロのジャンルの YouTube ヒントは、台帳に表示してよい動画として載っているものだけ。
  const catalog = await checkHelloVideos(rest, dbHeaders, puzzle.helloVideoIds, "crossword-save");
  if (catalog === "server") return json({ ok: false, reason: "server" }, 503);
  if (catalog === "video") return json({ ok: false, reason: "video" }, 400);

  // 5. 保存。番号が重なったら作り直す。
  let id = "";
  for (let i = 0; i < MAX_ID_TRIES; i++) {
    const candidate = makeId();
    const insert = await fetch(`${rest}/crossword_puzzles`, {
      method: "POST",
      headers: { ...dbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        id: candidate,
        title: puzzle.title,
        genre: puzzle.genre,
        tags: puzzle.tags,
        // 誰でも読める棚には答えを置かない。答えの代わりに文字数だけ残す（Hop 決定 2026-10-04「答えを渡さない作り」）
        body: toStoredBody(puzzle.body),
        is_beginner: puzzle.isBeginner,
        group_tags: puzzle.groupTags,
      }),
    });
    if (insert.ok) {
      id = candidate;
      break;
    }
    const code = await pgCode(insert);
    if (code === "23505") continue; // 番号の重なり
    console.error("crossword-save: insert failed", insert.status, code);
    if (code === "53400") return json({ ok: false, reason: "too_many" }, 503); // 全体ブレーキ
    if (code === "23514") return json({ ok: false, reason: "bad_request" }, 400); // 棚の決まりに合わない（保険）
    return json({ ok: false, reason: "server" }, 503);
  }
  if (!id) {
    console.error("crossword-save: id collisions exhausted");
    return json({ ok: false, reason: "server" }, 503);
  }

  // 削除用の合言葉。元に戻せない形（sha256 の16進）だけを置く。
  const keyHash = await sha256Hex(puzzle.key);
  let keyOk = false;
  try {
    const res = await fetch(`${rest}/crossword_owner_keys`, {
      method: "POST",
      headers: { ...dbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ puzzle_id: id, key_hash: keyHash }),
    });
    keyOk = res.ok;
    if (!res.ok) console.error("crossword-save: owner key insert failed", res.status, await pgCode(res));
  } catch (e) {
    console.error("crossword-save: owner key insert threw", String(e));
  }
  if (!keyOk) {
    // 合言葉の無い問題は誰にも消せなくなるので、問題ごと取り消す。
    try {
      const del = await fetch(`${rest}/crossword_puzzles?id=eq.${id}`, { method: "DELETE", headers: dbHeaders });
      if (!del.ok) console.error("crossword-save: rollback failed", id, del.status);
    } catch (e) {
      console.error("crossword-save: rollback threw", id, String(e));
    }
    return json({ ok: false, reason: "server" }, 503);
  }

  // 答えは受付係しか読めない棚（crossword_answers）に置く。置けなければ、誰にも解けない問題になるので問題ごと取り消す。
  let answersOk = false;
  try {
    const res = await fetch(`${rest}/crossword_answers`, {
      method: "POST",
      headers: { ...dbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ puzzle_id: id, answers: puzzle.body.clues.map((c) => c.answer) }),
    });
    answersOk = res.ok;
    if (!res.ok) console.error("crossword-save: answers insert failed", res.status, await pgCode(res));
  } catch (e) {
    console.error("crossword-save: answers insert threw", String(e));
  }
  if (!answersOk) {
    try {
      const del = await fetch(`${rest}/crossword_puzzles?id=eq.${id}`, { method: "DELETE", headers: dbHeaders });
      if (!del.ok) console.error("crossword-save: rollback failed", id, del.status);
    } catch (e) {
      console.error("crossword-save: rollback threw", id, String(e));
    }
    return json({ ok: false, reason: "server" }, 503);
  }

  // シェア画像。形が合わない・置けない場合は画像なしで続ける（問題の保存は済んでいる）
  let ogp = false;
  const png = decodeOgpPng(body.ogpImage);
  if (png) ogp = await uploadOgpPng(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, id, png);
  else if (body.ogpImage !== undefined) console.warn("crossword-save: ogp image rejected");

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

  return json({ ok: true, id, ogp });
}

async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false; // 検証できないなら通さない
  }
}

// リンクのヒントに使える住所か（Hop 決定 2026-10-04）。使えなければ理由を返す。
// https だけ・ユーザー名やパスワード入りは不可・IP アドレスだけの住所は不可・ドメインに「.」が要る・500 字まで
function linkProblem(url: string): string | null {
  if (url.length > 500) return "long";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "bad";
  }
  if (u.protocol !== "https:") return "https";
  if (u.username || u.password) return "userinfo";
  const host = u.hostname;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return "ip";
  if (!host.includes(".")) return "host";
  return null;
}
