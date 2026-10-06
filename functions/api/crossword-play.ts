/**
 * Cloudflare Pages Function: POST /api/crossword-play
 *
 * クロスワードを解いている回の受付係（Hop 決定 2026-10-04「答えを渡さない作り」）。
 * 答えはブラウザに渡さず、この受付係だけが crossword_answers から読んで丸付けする。
 * 遊んでいる回（crossword_plays）には、始めた時刻・見たマス・ミス・解けた時刻をここだけが書く。
 * ランキングのタイムと印は、crossword-score がこの記録から出す（画面の申告は使わない）。
 *
 * action:
 *   start  { puzzleId }            → 回を始める。{ token, startedAt }（startedAt は受付係の時計のミリ秒）
 *   check  { token, answers }      → 全部埋まった答案を丸付けする。{ correct, answers?, timeSeconds? }
 *                                    合っていなければ、どこが違うかは返さない（Hop 2026-10-04）
 *   reveal { token, x, y }         → そのマスの字を1つ返す。{ char, reveals }
 *   touch  { token }               → 最初の1文字が入った。遊ばれた回数をこの回で1度だけ足す（同じ接続元・同じ問題は24時間に1度まで）
 *
 * 字の数×MIN_SEC_PER_CELL 秒より速く解けた回は too_fast を付け、ランキングに載せない（答えを覚えた人・機械の一気入れ対策）。
 *
 * ミスは「間違ったまま全部埋めたことがあるか」で数える（埋まったまま直している途中の丸付けは数えない）。
 * 同じ接続元から回を始められるのは 1 時間に 300 回まで。1 つの回で丸付けできるのは 2000 回まで。
 */

import { readJsonLimited } from "../_shared/bodyLimit";
import { logBackground } from "../_shared/background";
import { toLargeKana, toLargeKanaText } from "../_shared/crosswordKana";

interface Env {
  VITE_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  /** 接続元のハッシュに混ぜる秘密の値としてだけ使う（contact・crossword-save と同じ値）。 */
  TURNSTILE_SECRET?: string;
}

const ENDPOINT = "crossword-play";
const STARTS_PER_IP_PER_HOUR = 300; // 学校・会社など同じ回線で大勢が遊んでも詰まらないように（Hop 決定 2026-10-04。最初は 60）
const MAX_CHECKS_PER_PLAY = 2000;
const PLAY_KEEP_DAYS = 30;
const MIN_SEC_PER_CELL = 1; // 人間が答えを知っていても1マスにかかる下限（Hop 決定 2026-10-04）
const COUNT_ENDPOINT = "crossword-count";
const ID_RE = /^[A-Za-z0-9_-]{8}$/;
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface StoredClue {
  direction: "horizontal" | "vertical";
  startX: number;
  startY: number;
  length?: number;
}

interface Play {
  id: string;
  puzzle_id: string;
  started_at: string;
  revealed: string[];
  misses: number;
  last_wrong: boolean;
  checks: number;
  solved_at: string | null;
  counted: boolean;
  too_fast: boolean;
}

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

/** 盤のマスごとの正しい字。座標は画面の buildGrid と同じく、いちばん左上が 0,0 になるようにずらす。 */
export function expectedCells(clues: StoredClue[], answers: string[][]): Map<string, string> {
  const minX = Math.min(...clues.map((c) => c.startX));
  const minY = Math.min(...clues.map((c) => c.startY));
  const out = new Map<string, string>();
  clues.forEach((c, i) => {
    const a = answers[i] ?? [];
    a.forEach((ch, k) => {
      const x = c.startX - minX + (c.direction === "horizontal" ? k : 0);
      const y = c.startY - minY + (c.direction === "vertical" ? k : 0);
      out.set(`${x},${y}`, ch);
    });
  });
  return out;
}

export async function onRequestPost(context: {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}): Promise<Response> {
  const { request, env } = context;
  if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.TURNSTILE_SECRET) {
    console.error("crossword-play: env missing");
    return json({ ok: false, reason: "server" }, 500);
  }

  // 大きさの申告で先に断る。申告が無い送り方でも読みながら数えて断る
  const read = await readJsonLimited(request, 8192);
  if (read.response) return read.response;
  const body = read.value as Record<string, unknown>;
  if (!body || typeof body !== "object") return json({ ok: false, reason: "bad_request" }, 400);

  const rest = `${env.VITE_SUPABASE_URL}/rest/v1`;
  const dbHeaders = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
  };

  // 問題（隠されていない物だけ）と答えを読む
  const loadPuzzle = async (puzzleId: string): Promise<{ clues: StoredClue[]; answers: string[][] } | null> => {
    const [p, a] = await Promise.all([
      fetch(`${rest}/crossword_puzzles?select=body&id=eq.${puzzleId}&is_hidden=eq.false`, { headers: dbHeaders }),
      fetch(`${rest}/crossword_answers?select=answers&puzzle_id=eq.${puzzleId}`, { headers: dbHeaders }),
    ]);
    if (!p.ok || !a.ok) throw new Error(`load failed ${p.status} ${a.status}`);
    const pr = (await p.json()) as { body?: { clues?: StoredClue[] } }[];
    const ar = (await a.json()) as { answers?: string[][] }[];
    const clues = pr[0]?.body?.clues;
    const answers = ar[0]?.answers;
    if (!Array.isArray(clues) || !Array.isArray(answers) || clues.length !== answers.length) return null;
    return { clues, answers };
  };

  const loadPlay = async (token: string): Promise<Play | null> => {
    const res = await fetch(
      `${rest}/crossword_plays?select=id,puzzle_id,started_at,revealed,misses,last_wrong,checks,solved_at,counted,too_fast&id=eq.${token}`,
      { headers: dbHeaders },
    );
    if (!res.ok) throw new Error(`play load failed ${res.status}`);
    const rows = (await res.json()) as Play[];
    return rows[0] ?? null;
  };

  const patchPlay = (token: string, patch: Record<string, unknown>, extraFilter = "") =>
    fetch(`${rest}/crossword_plays?id=eq.${token}${extraFilter}`, {
      method: "PATCH",
      headers: { ...dbHeaders, Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });

  const action = body.action;
  try {
    // --- 回を始める ---
    if (action === "start") {
      const puzzleId = body.puzzleId;
      if (typeof puzzleId !== "string" || !ID_RE.test(puzzleId)) return json({ ok: false, reason: "bad_request" }, 400);

      const ip = request.headers.get("CF-Connecting-IP") ?? "";
      const ipHash = await sha256Hex(`${ENDPOINT}:${ip}:${env.TURNSTILE_SECRET}`);
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const rl = await fetch(
        `${rest}/rate_limit_log?select=id&endpoint=eq.${ENDPOINT}&ip_hash=eq.${ipHash}` +
          `&created_at=gt.${encodeURIComponent(since)}&limit=${STARTS_PER_IP_PER_HOUR}`,
        { headers: dbHeaders },
      ).catch(() => null);
      if (rl?.ok) {
        const rows = (await rl.json()) as unknown[];
        if (rows.length >= STARTS_PER_IP_PER_HOUR) return json({ ok: false, reason: "too_many" }, 429);
      }

      if (!(await loadPuzzle(puzzleId))) return json({ ok: false, reason: "not_found" }, 404);
      const ins = await fetch(`${rest}/crossword_plays`, {
        method: "POST",
        headers: { ...dbHeaders, Prefer: "return=representation" },
        body: JSON.stringify({ puzzle_id: puzzleId }),
      });
      if (!ins.ok) {
        // 全体ブレーキ（crossword_plays_rate_guard・errcode 53400）に当たった場合は「混み合っています」にする
        const code = await ins.json().then((j: { code?: unknown }) => (typeof j?.code === "string" ? j.code : "")).catch(() => "");
        console.error("crossword-play: start insert failed", ins.status, code);
        return json({ ok: false, reason: code === "53400" ? "too_many" : "server" }, 503);
      }
      const row = ((await ins.json()) as { id: string; started_at: string }[])[0];

      const old = new Date(Date.now() - PLAY_KEEP_DAYS * 86400 * 1000).toISOString();
      const idle = new Date(Date.now() - 86400 * 1000).toISOString();
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
          // 古い回の片付け（30 日より前に始めた回）
          fetch(`${rest}/crossword_plays?started_at=lt.${encodeURIComponent(old)}`, { method: "DELETE", headers: dbHeaders }),
          // 24時間より古い回数の印
          fetch(`${rest}/crossword_play_counts?created_at=lt.${encodeURIComponent(idle)}`, { method: "DELETE", headers: dbHeaders }),
          // 開いただけで何もしなかった回（丸付け・数えた印・解けた時刻が無い）は1日で片付ける（Hop 決定 2026-10-04）
          fetch(
            `${rest}/crossword_plays?started_at=lt.${encodeURIComponent(idle)}&checks=eq.0&counted=eq.false&solved_at=is.null`,
            { method: "DELETE", headers: dbHeaders },
          ),
        ),
      );
      return json({ ok: true, token: row.id, startedAt: Date.parse(row.started_at) });
    }

    // --- ここから先は回の番号が要る ---
    const token = body.token;
    if (typeof token !== "string" || !TOKEN_RE.test(token)) return json({ ok: false, reason: "bad_request" }, 400);
    const play = await loadPlay(token);
    if (!play) return json({ ok: false, reason: "no_play" }, 404);
    const puzzle = await loadPuzzle(play.puzzle_id);
    if (!puzzle) return json({ ok: false, reason: "not_found" }, 404);
    const expected = expectedCells(puzzle.clues, puzzle.answers);
    const timeOf = (solvedAt: string) => Math.max(1, Math.floor((Date.parse(solvedAt) - Date.parse(play.started_at)) / 1000));

    // --- 丸付け ---
    if (action === "check") {
      const raw = body.answers;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ ok: false, reason: "bad_request" }, 400);
      const given = raw as Record<string, unknown>;
      if (play.solved_at) {
        return json({ ok: true, correct: true, answers: puzzle.answers, timeSeconds: timeOf(play.solved_at), rankable: !play.too_fast });
      }
      // 小さい字は大きい字と同じ扱い（Hop 決定 2026-10-05）。答えの側も入力の側も大きい字にそろえて比べる
      let full = true;
      let correct = true;
      for (const [key, ch] of expected) {
        const v = given[key];
        if (typeof v !== "string" || v === "") full = false;
        if (typeof v !== "string" || toLargeKanaText(v) !== toLargeKana(ch)) correct = false;
      }
      // 回数の書き換えは「読んだ時の回数のままなら」の条件つき。同時に来て負けたら読み直して1回だけやり直す
      let cur = play;
      for (let attempt = 0; ; attempt++) {
        if (cur.solved_at) {
          return json({ ok: true, correct: true, answers: puzzle.answers, timeSeconds: timeOf(cur.solved_at), rankable: !cur.too_fast });
        }
        if (cur.checks >= MAX_CHECKS_PER_PLAY) return json({ ok: false, reason: "too_many" }, 429);
        let res: Response;
        if (correct) {
          const now = new Date().toISOString();
          const tooFast = timeOf(now) < expected.size * MIN_SEC_PER_CELL;
          // 解けた時刻は最初の1回だけ書く（同時に来ても後の方で上書きしない）
          res = await patchPlay(token, { solved_at: now, checks: cur.checks + 1, too_fast: tooFast }, `&checks=eq.${cur.checks}&solved_at=is.null`);
        } else {
          // 間違ったまま全部埋めた最初の1回だけミスに数える
          const countMiss = full && !cur.last_wrong;
          res = await patchPlay(
            token,
            {
              checks: cur.checks + 1,
              ...(full ? { last_wrong: true } : {}),
              ...(countMiss ? { misses: cur.misses + 1 } : {}),
            },
            `&checks=eq.${cur.checks}`,
          );
        }
        if (!res.ok) {
          console.error("crossword-play: check patch failed", res.status);
          return json({ ok: false, reason: "server" }, 503);
        }
        const row = ((await res.json()) as Play[])[0];
        if (row) {
          if (correct && row.solved_at) {
            return json({ ok: true, correct: true, answers: puzzle.answers, timeSeconds: timeOf(row.solved_at), rankable: !row.too_fast });
          }
          return json({ ok: true, correct: false, full });
        }
        if (attempt >= 1) {
          console.error("crossword-play: check lost to concurrent writes twice");
          return json({ ok: false, reason: "server" }, 503);
        }
        const fresh = await loadPlay(token);
        if (!fresh) return json({ ok: false, reason: "no_play" }, 404);
        cur = fresh;
      }
    }

    // --- 1文字見る ---
    if (action === "reveal") {
      const x = body.x;
      const y = body.y;
      if (!Number.isInteger(x) || !Number.isInteger(y)) return json({ ok: false, reason: "bad_request" }, 400);
      const key = `${x},${y}`;
      const found = expected.get(key);
      if (!found) return json({ ok: false, reason: "bad_request" }, 400);
      const ch = toLargeKana(found); // 返す字も大きい字にそろえる
      // 見たマスの書き換えは「読んだ時の並びのままなら」の条件つき。同時に来て負けたら読み直して1回だけやり直す
      let cur = play;
      for (let attempt = 0; ; attempt++) {
        if (cur.solved_at || cur.revealed.includes(key)) return json({ ok: true, char: ch, reveals: cur.revealed.length });
        const revealed = [...cur.revealed, key];
        const res = await patchPlay(token, { revealed }, `&revealed=eq.${encodeURIComponent(JSON.stringify(cur.revealed))}`);
        if (!res.ok) {
          console.error("crossword-play: reveal patch failed", res.status);
          return json({ ok: false, reason: "server" }, 503);
        }
        if (((await res.json()) as Play[]).length > 0) return json({ ok: true, char: ch, reveals: revealed.length });
        if (attempt >= 1) {
          console.error("crossword-play: reveal lost to concurrent writes twice");
          return json({ ok: false, reason: "server" }, 503);
        }
        const fresh = await loadPlay(token);
        if (!fresh) return json({ ok: false, reason: "no_play" }, 404);
        cur = fresh;
      }
    }

    // --- 遊ばれた回数（最初の1文字が入った時） ---
    if (action === "touch") {
      // この回でまだ数えていなければ数えた印を付ける（条件つきなので同時に来ても1度だけ）
      const res = await patchPlay(token, { counted: true }, "&counted=eq.false");
      const claimed = res.ok ? ((await res.json()) as Play[]).length > 0 : false;
      if (!claimed) return json({ ok: true, counted: false });
      // 同じ回線・同じ問題は24時間に1回だけ数える。印は crossword_play_counts に置く
      // （rate_limit_log はサイト全体の片付けで1時間しかもたないため。Hop 決定 2026-10-04）
      const ip = request.headers.get("CF-Connecting-IP") ?? "";
      const key = await sha256Hex(`${COUNT_ENDPOINT}:${play.puzzle_id}:${ip}:${env.TURNSTILE_SECRET}`);
      const day = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      // 24時間より前の自分の印は消してから入れる（入れられなければ24時間以内に数え済み）
      await fetch(`${rest}/crossword_play_counts?puzzle_id=eq.${play.puzzle_id}&ip_hash=eq.${key}&created_at=lt.${encodeURIComponent(day)}`, {
        method: "DELETE",
        headers: dbHeaders,
      }).catch(() => null);
      const mark = await fetch(`${rest}/crossword_play_counts`, {
        method: "POST",
        headers: { ...dbHeaders, Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify({ puzzle_id: play.puzzle_id, ip_hash: key }),
      });
      const fresh = mark.ok ? ((await mark.json().catch(() => [])) as unknown[]).length > 0 : false;
      if (!fresh) return json({ ok: true, counted: false });
      const add = await fetch(`${rest}/rpc/crossword_add_play`, { method: "POST", headers: dbHeaders, body: JSON.stringify({ p_id: play.puzzle_id }) });
      if (!add.ok) console.error("crossword-play: add_play failed", add.status);
      return json({ ok: true, counted: add.ok });
    }

    return json({ ok: false, reason: "bad_request" }, 400);
  } catch (e) {
    console.error("crossword-play: failed", String(e));
    return json({ ok: false, reason: "server" }, 503);
  }
}
