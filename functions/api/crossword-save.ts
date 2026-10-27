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
 *   4. 中身の確かめ（ブラウザ側の確かめは信用しない）。作った人の名前が運営・メンバー本人に見える時は 400 bad_name
 *   5. 保存（問題 → 削除用の合言葉の sha256）
 *
 * DB の BEFORE INSERT トリガに「1時間に全体100件」のブレーキ（errcode 53400）があり、
 * ここを全部すり抜けても最後に効く。
 *
 * 段階2b で足したもの
 *   ・初めての人向けの印（is_beginner）
 *   ・題名とカギの文・答えから、メンバー名・グループ名でグループを判定して group_tags に入れる。
 *     ジャンルはハロプロ専門のため常に hello（Hop 決定 2026-10-20。送られた genre は見ない）
 *   ・シェア画像（1200×630 の PNG）を確かめてから置き場 crossword-ogp に置く。置けなくても保存は成功にする
 */

import { detectGroups } from "../_shared/crosswordGroups";
import { CROSSWORD_GROUPS, CROSSWORD_MEMBERS } from "../_shared/crosswordMembers";
import { decodeOgpPng, uploadOgpPng } from "../_shared/crosswordOgp";
import { readJsonLimited } from "../_shared/bodyLimit";
import { logBackground } from "../_shared/background";
import { toLargeKana } from "../_shared/crosswordKana";
import { isBlankClue, stripUnsafe } from "../_shared/crosswordClue";
import { reporterKey } from "../_shared/reporterKey";
import { BAD_NAME_REASON, isReservedCreatorName, puzzleHasReservedCreatorName } from "../_shared/crosswordCreatorName";

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
/** 人間確認（Turnstile）の確かめ先を待つ上限（ミリ秒）。超えたら「確認に失敗しました」で断る */
const TURNSTILE_TIMEOUT_MS = 5000;

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
/** 1語の字数（答えのマス目）の上限（Hop 決定 2026-10-22「答えのマス目は30字まで」。前は20字の【仮】）。
 *  画面（src/pages/crossword/components/BulkEntry.tsx の MAX_CELLS）と同じ値。画面を通さない送信もここで断る（bad_request）。
 *  棚を読み直す所（解く・自分の問題・ヒントの差し替え）では確かめないので、前からある問題は字数に関わらず読める */
const MAX_ANSWER_CHARS = 30;
/** 語の数の上限【仮】 */
const MAX_CLUES = 60;
/** カギ（問題文）1つの字数の上限（Hop 決定 2026-10-22。10-21 に入れた30字は取り違えで、正しくは100字）。見た目の字数（Array.from の長さ）で数える。
 *  画面（src/pages/crossword/create/CreatePage.tsx の MAX_CLUE_CHARS）と同じ値。画面を通さない送信もここで断る（bad_request）。
 *  前からある100字を超えるカギは、棚を読み直す所では確かめないので影響しない */
const MAX_CLUE_CHARS = 100;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// YouTube の動画のことは、どこにも問い合わせない（チャンネル名も「見られるか」も聞かない。Hop 決定 2026-10-21）。
// outside は「保存の時点で台帳（youtube_videos）に無かった動画」の印。画面が台帳を確かめて付ける。
// 解く画面と自分の問題の一覧は、この印の無いハロプロの動画が台帳から消えた時だけ「見られなくなりました」を出す（Hop 決定 2026-10-04 の決め方を、台帳に無い動画も入るこの作りに合わせた）
type Hint = { kind: "youtube"; videoId: string; startSec: number; outside?: true } | { kind: "link"; url: string };
// 末尾の点（youtube.com.）を外し、頭の www. / m. / music. は重なっていても全部外してから見る
// （画面の src/lib/crossword/youtubeUrl.ts の youtubeBaseHost と同じ。直す時は両方そろえる）
const youtubeBaseHost = (hostname: string) => {
  let h = hostname.toLowerCase().replace(/\.+$/, "");
  while (/^(www|m|music)\./.test(h)) h = h.replace(/^(www|m|music)\./, "");
  return h;
};
const isYouTubeHost = (host: string) => {
  const h = youtubeBaseHost(host);
  return h === "youtu.be" || h === "youtube.com" || h === "youtube-nocookie.com";
};

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
  /** 保存するジャンル。ハロプロ専門なので、送られてきた値に関わらず常に hello（Hop 決定 2026-10-20） */
  genre: "hello";
  title: string;
  tags: string[];
  body: { version: 1; width: number; height: number; clues: CleanClue[]; creatorName?: string; rulesNote?: true };
  key: string;
  isBeginner: boolean;
  /** メンバー名・グループ名から判定したグループ（公式表記） */
  groupTags: string[];
}

const isInt = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;
const isStr = (v: unknown): v is string => typeof v === "string";
const charLen = (s: string) => Array.from(s).length;

export function cleanHint(h: unknown): Hint | null {
  if (!h || typeof h !== "object") return null;
  const o = h as Record<string, unknown>;
  if (o.kind === "youtube") {
    if (!isStr(o.videoId) || !VIDEO_ID_RE.test(o.videoId)) return null;
    if (!isInt(o.startSec)) return null;
    // outside は真偽値の true の時だけ残す（ほかの欄は今どおり捨てる）
    return o.outside === true
      ? { kind: "youtube", videoId: o.videoId, startSec: o.startSec, outside: true }
      : { kind: "youtube", videoId: o.videoId, startSec: o.startSec };
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
    // YouTube は「リンク」として通さない（形の崩れた住所で台帳の門をすり抜けた 2026-10-18 の抜け穴ふさぎ）
    if (isYouTubeHost(u.hostname)) return null;
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
  // 見えない字・向きを変える字を先に落とす（ランキングの名前と同じ掃除。2026-10-26 レビューの直し）。棚へは落とした後の文を渡す
  const clue = stripUnsafe(o.clue);
  if (charLen(clue) > MAX_CLUE_CHARS) return null;
  // ○・□・→ と空白だけのカギ（空も含む）は断る。画面の確かめと同じ物差し（Hop 決定 2026-10-23）
  if (isBlankClue(clue)) return null;
  if (!Array.isArray(o.answer) || o.answer.length === 0 || o.answer.length > MAX_ANSWER_CHARS) return null;
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
    clue,
    answer,
    hint,
  };
}

/**
 * 座標の上限（この値より小さい 0 以上の整数だけ通す）。2026-10-26 レビューの直し（受付係へ直接送ると100万マス離れた語の問題が作れた）。
 * 作る画面は盤の左上を 0,0 にそろえて送る（src/lib/crossword/engine.ts の buildGrid）。作る画面の決まり（1マスで交わる・同じ向きで重ねない・語を盤の外へも動かせる）では、
 * 30字の横と30字の縦を最後の字で交わらせる階段が作れ、60語で盤は 871×871 になる（scripts/verify/crossword/check-server-hardening.mjs で確かめた）。
 * つながった盤のマスは最大 60×30−59＝1741 なので、左上が 0 なら座標は必ず 1741 未満に収まる。これを上限にする（作れる最大 870 の倍の余裕）
 */
export const MAX_COORD = MAX_CLUES * (MAX_ANSWER_CHARS - 1) + 1;

/**
 * 盤の形を確かめる。次のどれかに当たれば null（2026-10-26 レビューの直しで 2〜5 を足した。作る画面からは作れない形）。
 *   1. 交わるマスで字が食い違う
 *   2. 同じ向きの語が同じマスを通る（同じ場所に2回置いた語・端で重なった語。作る画面の validatePlacement と同じ決まり）
 *   3. 同じ番号・同じ向きのカギが2つある
 *   4. マスの座標が 0〜MAX_COORD−1 の外
 *   5. 語どうしが1つにつながっていない（作る画面の isConnected と同じ。マスを共有する語どうしがつながっていると見る）
 * そうでなければ、語の並びから出した盤の大きさ（いちばん左の字からいちばん右の字までのマス数・上下も同じ）を返す。
 */
export function boardShape(clues: CleanClue[]): { width: number; height: number } | null {
  if (clues.length === 0) return null;
  const cells = new Map<string, { ch: string; horizontal: boolean; vertical: boolean; owners: number[] }>();
  const numbers = new Set<string>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < clues.length; i++) {
    const c = clues[i];
    const num = `${c.clueIndex}:${c.direction}`;
    if (numbers.has(num)) return null;
    numbers.add(num);
    for (let k = 0; k < c.answer.length; k++) {
      const x = c.startX + (c.direction === "horizontal" ? k : 0);
      const y = c.startY + (c.direction === "vertical" ? k : 0);
      if (x >= MAX_COORD || y >= MAX_COORD) return null;
      const at = `${x},${y}`;
      const prev = cells.get(at);
      if (prev) {
        if (prev.ch !== c.answer[k]) return null;
        if (prev[c.direction]) return null;
        prev[c.direction] = true;
        prev.owners.push(i);
      } else {
        cells.set(at, { ch: c.answer[k], horizontal: c.direction === "horizontal", vertical: c.direction === "vertical", owners: [i] });
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  // つながり: マスを共有する語どうしを結んで、最初の語からたどれない語があれば断る
  const links: number[][] = clues.map(() => []);
  for (const { owners } of cells.values()) {
    for (const a of owners) for (const b of owners) if (a !== b) links[a].push(b);
  }
  const seen = new Set<number>([0]);
  const stack = [0];
  while (stack.length > 0) {
    for (const next of links[stack.pop() as number]) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  if (seen.size !== clues.length) return null;
  return { width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * 受け取った中身を確かめ、保存してよい形に整える。だめなら null。
 * Turnstile・DB には触らない（node で単体に近い形で試せるように切り出してある）。
 */
/**
 * keepName: 組み直しで、棚にすでにある名前（決まりより前に公開した名前）をそのまま使う時だけ渡す。
 * その名前と同じ時は、なりすましの決まりを当てない（2026-10-27）
 */
export function validateSavePayload(raw: unknown, keepName?: string): CleanPuzzle | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;

  if (!isStr(p.title)) return null;
  // 題名・タグ・作った人の名前も、見えない字・向きを変える字を落としてから空かどうかを見る（2026-10-26 レビューの直し）
  const title = stripUnsafe(p.title).trim();
  if (charLen(title) < 1 || charLen(title) > MAX_TITLE) return null;

  // 送られてきた genre は見ない（常に hello で保存する）

  // 初めての人向けの印。無ければ false、あれば true/false だけ
  if (p.isBeginner !== undefined && typeof p.isBeginner !== "boolean") return null;
  const isBeginner = p.isBeginner === true;

  const rawTags = p.tags ?? [];
  if (!Array.isArray(rawTags) || rawTags.length > MAX_TAGS) return null;
  const tags: string[] = [];
  for (const t of rawTags) {
    if (!isStr(t)) return null;
    const s = stripUnsafe(t).trim();
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
  if (!Array.isArray(bo.clues) || bo.clues.length < 2 || bo.clues.length > MAX_CLUES) return null;
  const clues: CleanClue[] = [];
  for (const c of bo.clues) {
    const cc = cleanClue(c);
    if (!cc) return null;
    clues.push(cc);
  }
  const board = boardShape(clues);
  if (!board) return null;
  let creatorName: string | undefined;
  if (bo.creatorName !== undefined) {
    if (!isStr(bo.creatorName)) return null;
    const name = stripUnsafe(bo.creatorName).trim();
    if (charLen(name) > MAX_CREATOR) return null;
    // 運営・メンバー本人に見える名前は断る（受付係の入口では理由 bad_name で先に断る。ここは保険）
    if (name !== keepName && isReservedCreatorName(name)) return null;
    if (name !== "") creatorName = name;
  }
  // 公式の決まりを題材にした問題の印（解く前の扉に免責の文を出す。Hop 決定 2026-10-16）。入れた時だけ残す
  if (bo.rulesNote !== undefined && typeof bo.rulesNote !== "boolean") return null;

  // 大きさは送られてきた値を信用せず、語の並びから出した値を使う（画面の buildGrid と同じく、左上の語の端から右下の語の端まで）
  const body: CleanPuzzle["body"] = { version: 1, width: board.width, height: board.height, clues };
  if (creatorName) body.creatorName = creatorName;
  if (bo.rulesNote === true) body.rulesNote = true;

  // 大きさは保存する形（整えた後）で測る。DB 側の上限 octet_length(body::text) と同じ 51200 バイト
  if (new TextEncoder().encode(JSON.stringify(body)).length > MAX_BODY_BYTES) return null;

  const genre = "hello" as const;
  const groupTags = detectGroups(
    { title, clues: clues.map((c) => c.clue), answers: clues.map((c) => c.answer.join("")) },
    { members: CROSSWORD_MEMBERS, groups: CROSSWORD_GROUPS },
  );

  return { title, genre, tags, body, key, isBeginner, groupTags };
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

  // 大きさの申告で先に断る。申告が無い送り方でも読みながら数えて断る
  const read = await readJsonLimited(request, 450000);
  if (read.response) return read.response;
  const body = read.value as Record<string, unknown>;
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
  // IPv6 は /64 の帯で丸めて数える（同じ家の回線でアドレスを変えて数え直せないように。ほかの受付係と同じ）
  const ipHash = await sha256Hex(`${ENDPOINT}:${reporterKey(ip)}:${env.TURNSTILE_SECRET}`);
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

  // 4. 中身の確かめ。作った人の名前のなりすましは、画面が知らせを出せるように理由を分けて先に断る（Hop 決定 2026-10-27）
  if (puzzleHasReservedCreatorName(body.puzzle)) return json({ ok: false, reason: BAD_NAME_REASON }, 400);
  const puzzle = validateSavePayload(body.puzzle);
  if (!puzzle) return json({ ok: false, reason: "bad_request" }, 400);

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

  return json({ ok: true, id, ogp });
}

async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  // 確かめ先が返事をしない時に待ち続けない（2026-10-26 レビューの直し。前は上限が無く「保存中…」のままになった）。
  // 上限を超えたら「確認に失敗しました」と同じ断り方（403 verification）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false; // 検証できない・時間切れなら通さない
  } finally {
    clearTimeout(timer);
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
