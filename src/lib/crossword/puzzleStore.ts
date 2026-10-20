import { getSupabase } from "../supabase";
import type { PlacedItem } from "./types";

export type Genre = "hello" | "other";

// カギごとのヒント。YouTube はアプリ内で再生、それ以外はリンクで開く
export type HintRef =
  // gone は画面の中だけで使う印（台帳から消えた・再生できない動画）。保存はしない
  // channel は台帳に無い動画（外のチャンネル）だけに付く、画面の中だけの名前。保存はせず、開くたびにブラウザが YouTube に聞く（Hop 決定 2026-10-19 案1・「書き残さない形」）
  | { kind: "youtube"; videoId: string; startSec: number; channel?: string; gone?: boolean }
  | { kind: "link"; url: string };

export interface StoredClue {
  clueIndex: number;
  direction: "horizontal" | "vertical";
  startX: number;
  startY: number;
  clue: string;
  // toCells 済み（カタカナ・大きい字）。保存する時だけ入れる。棚から読んだ物には無く、代わりに length がある（答えは受付係しか読めない棚に置く）
  answer: string[];
  length?: number;
  hint: HintRef;
}

export interface PuzzleBody {
  version: 1;
  width: number;
  height: number;
  clues: StoredClue[];
  creatorName?: string; // 作る画面の「作成者名」。空なら入れない
  rulesNote?: boolean; // 公式の決まりを題材にした問題の印。入れた時だけ true
}

export interface PuzzleRecord {
  id: string;
  title: string;
  genre: Genre;
  tags: string[];
  body: PuzzleBody;
  created_at: string;
  // 段階2b。保存の受付係だけが書く
  is_beginner?: boolean;
  group_tags?: string[];
}

export interface NewPuzzle {
  title: string;
  genre: Genre;
  tags: string[];
  body: PuzzleBody;
  isBeginner?: boolean; // 初めての人向けの印
}

// 置けた語と、それぞれのヒントから保存用の中身を作る
export const toBody = (
  placed: PlacedItem[],
  width: number,
  height: number,
  hintOf: (itemId: string) => HintRef
): PuzzleBody => ({
  version: 1,
  width,
  height,
  clues: placed.map(p => ({
    clueIndex: p.clueIndex ?? 0,
    direction: p.direction,
    startX: p.startX,
    startY: p.startY,
    clue: p.question,
    answer: p.answer,
    hint: hintOf(p.id),
  })),
});

// 保存は受付係（/api/crossword-save）を通す。棚へ直接は入れられない
export class SaveError extends Error {
  constructor(public reason: string, public groups: string[] = []) {
    super(`save failed: ${reason}`);
  }
}

// ogpImage はシェア画像（1200×630 の PNG の data URL）。無くても保存できる。受付係が置けなくても保存は成功する
export async function savePuzzle(
  p: NewPuzzle,
  opts: { key: string; token: string; website: string; ogpImage?: string | null }
): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/crossword-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        puzzle: { ...p, key: opts.key },
        token: opts.token,
        website: opts.website,
        ...(opts.ogpImage ? { ogpImage: opts.ogpImage } : {}),
      }),
    });
  } catch {
    throw new SaveError("network");
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: unknown; reason?: unknown; groups?: unknown };
  if (res.ok && data.ok && typeof data.id === "string") return data.id;
  const groups = Array.isArray(data.groups) ? data.groups.filter((g): g is string => typeof g === "string") : [];
  throw new SaveError(typeof data.reason === "string" ? data.reason : "server", groups);
}

// --- 組み直し（Hop 決定 2026-10-05。作った本人の端末から、まだ遊ばれていない問題だけ） ---
export interface OwnedPuzzle {
  puzzle: PuzzleRecord & { play_count?: number };
  answers: string[][]; // カギと同じ並び。1マス1字
}

// 合言葉が合えば、答えを含む中身を受け取る。合わない・無い・隠された問題は null
export async function fetchOwnedPuzzle(id: string, key: string): Promise<OwnedPuzzle | null> {
  let res: Response;
  try {
    res = await fetch("/api/crossword-owner-get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, key }),
    });
  } catch {
    throw new SaveError("network");
  }
  if (res.status === 404) return null;
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; puzzle?: unknown; answers?: unknown; reason?: unknown };
  if (!res.ok || !data.ok || !data.puzzle || !Array.isArray(data.answers)) {
    throw new SaveError(typeof data.reason === "string" ? data.reason : "server");
  }
  return { puzzle: data.puzzle as OwnedPuzzle["puzzle"], answers: data.answers as string[][] };
}

// 組み直した中身で書き換える。送り方は savePuzzle に合わせる（人間確認は無し。合言葉が本人確認を兼ねる）。
// もう遊ばれていたら SaveError("already_played")、合言葉が合わなければ SaveError("not_found")
export async function updatePuzzle(id: string, key: string, p: NewPuzzle, opts: { ogpImage?: string | null } = {}): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/crossword-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        key,
        puzzle: { ...p, key },
        ...(opts.ogpImage ? { ogpImage: opts.ogpImage } : {}),
      }),
    });
  } catch {
    throw new SaveError("network");
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: unknown };
  if (res.ok && data.ok) return;
  throw new SaveError(typeof data.reason === "string" ? data.reason : "server");
}

// 遊ばれた後でもヒントだけ差し替える（Hop 決定 2026-10-19）。hints は「向き:番号」→ 新しいヒント。
// 本文は送らない。受付係が棚の本文のヒント部分だけを入れ替える。合言葉が合わなければ SaveError("not_found")
export async function updatePuzzleHints(id: string, key: string, hints: Record<string, HintRef>): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/crossword-update-hints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, key, hints }),
    });
  } catch {
    throw new SaveError("network");
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: unknown };
  if (res.ok && data.ok) return;
  throw new SaveError(typeof data.reason === "string" ? data.reason : "server");
}

// 削除用の合言葉。32 バイトの乱数を16進64字にする（受付係には sha256 だけが残る）
export const makeOwnerKey = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

export async function loadPuzzle(id: string): Promise<PuzzleRecord | null> {
  const { data, error } = await getSupabase()
    .from("crossword_puzzles")
    .select("id,title,genre,tags,body,created_at,is_beginner,group_tags")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as PuzzleRecord | null) ?? null;
}

// ハロプロのジャンルでは、台帳に載っていて表示してよい動画だけを使える
// 動画のチャンネル名を YouTube に聞く（鍵なしの oEmbed。削除・非公開・埋め込み禁止の動画は null）。画面に出すためだけに使い、保存しない
export async function lookupVideoChannel(videoId: string): Promise<string | null> {
  const r = await askVideoChannel(videoId);
  return r === "gone" || r === "unknown" ? null : r;
}

// 同じく聞くが、答えを3つに分ける。名前／"gone"＝YouTube が見られないと答えた（429 以外の 4xx）／"unknown"＝混み合い・通信の失敗で分からない
// 見られない印は "gone" の時だけ付ける（一時的な失敗を「見られなくなりました」と出さない）
async function askVideoChannel(videoId: string): Promise<string | "gone" | "unknown"> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`);
    if (res.status >= 400 && res.status < 500 && res.status !== 429) return "gone";
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { author_name?: unknown };
    return typeof data.author_name === "string" && data.author_name.trim() ? data.author_name.trim().slice(0, 100) : "gone";
  } catch {
    return "unknown";
  }
}

export async function isCatalogVideo(videoId: string): Promise<boolean> {
  const { count, error } = await getSupabase()
    .from("youtube_videos")
    .select("video_id", { count: "exact", head: true })
    .eq("video_id", videoId)
    .eq("is_active_content", true);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export interface CatalogVideo {
  video_id: string;
  title: string;
  channel_name: string | null;
  published_at: string | null;
}

// 動画の中の曲・場面の区切り（video_chapters）。親の動画の題名とチャンネル名を付けてある
export interface CatalogChapter {
  video_id: string;
  seq: number;
  song_title: string;
  group_name: string | null;
  venue: string | null;
  performed_on: string | null;
  startSec: number; // content_start_sec、無ければ toc_sec
  videoTitle: string;
  channel_name: string | null;
}

// 探す言葉を空白で区切る（全角の空白も）。棚への問い合わせの書き方を壊す字（, ( ) " \）は外す
const searchTerms = (query: string): string[] =>
  query
    .split(/[\s\u3000]+/)
    .map((t) => t.replace(/[,()"\\]/g, "").trim())
    .filter(Boolean)
    .slice(0, 5);
// どの言葉も、いずれかの欄に含まれる物（言葉ごとに「欄のどれか」、言葉どうしは「全部」）
const everyTermInAny = (terms: string[], columns: string[]) => terms.map((t) => columns.map((c) => `${c}.ilike."%${t}%"`).join(","));

// ハロプロのジャンルのヒント選び。台帳の表示してよい動画を、題名とチャンネル名で探す。
// 言葉を空白で区切ると、全部を含む物だけ出す（2026-10-20 Hop「台帳の動画が見つからない」: ひと続きの一致・8件だけで古い動画が埋もれていた）
export async function searchCatalogVideos(query: string, limit = 20): Promise<CatalogVideo[]> {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  let req = getSupabase()
    .from("youtube_videos")
    .select("video_id,title,channel_name,published_at")
    .eq("is_active_content", true);
  for (const cond of everyTermInAny(terms, ["title", "channel_name"])) req = req.or(cond);
  const { data, error } = await req.order("published_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data as CatalogVideo[] | null) ?? [];
}

// 曲名で区切りを探す。表示してよい動画（is_active_content=true）の区切りだけ返す
export async function searchCatalogChapters(query: string, limit = 12): Promise<CatalogChapter[]> {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const sb = getSupabase();
  // 表示してよい動画に絞ると落ちる分があるので、多めに取ってから絞る。言葉は曲名・グループ名・会場のどれかに含まれればよい
  let req = sb
    .from("video_chapters")
    .select("video_id,seq,toc_sec,content_start_sec,song_title,group_name,venue,performed_on");
  for (const cond of everyTermInAny(terms, ["song_title", "group_name", "venue"])) req = req.or(cond);
  const { data, error } = await req
    .order("performed_on", { ascending: false, nullsFirst: false })
    .limit(limit * 4);
  if (error) throw error;
  const rows =
    (data as {
      video_id: string;
      seq: number;
      toc_sec: number | null;
      content_start_sec: number | null;
      song_title: string;
      group_name: string | null;
      venue: string | null;
      performed_on: string | null;
    }[] | null) ?? [];
  if (rows.length === 0) return [];
  const ids = Array.from(new Set(rows.map((r) => r.video_id)));
  const { data: vids, error: vErr } = await sb
    .from("youtube_videos")
    .select("video_id,title,channel_name")
    .eq("is_active_content", true)
    .in("video_id", ids);
  if (vErr) throw vErr;
  const byId = new Map(
    ((vids as { video_id: string; title: string; channel_name: string | null }[] | null) ?? []).map((v) => [v.video_id, v])
  );
  const out: CatalogChapter[] = [];
  for (const r of rows) {
    const v = byId.get(r.video_id);
    if (!v) continue;
    out.push({
      video_id: r.video_id,
      seq: r.seq,
      song_title: r.song_title,
      group_name: r.group_name,
      venue: r.venue,
      performed_on: r.performed_on,
      startSec: Math.max(0, Math.floor(r.content_start_sec ?? r.toc_sec ?? 0)),
      videoTitle: v.title,
      channel_name: v.channel_name,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// 運営に隠された問題かどうか（中身は返らない）
export async function isHiddenPuzzle(id: string): Promise<boolean> {
  const { data, error } = await getSupabase().rpc("crossword_is_hidden", { p_id: id });
  if (error) throw error;
  return data === true;
}

// 合言葉が合えば消す。合わなければ false
// 問題と一緒にシェア画像も消すため、秘密の鍵を持つ受付係（/api/crossword-delete）を通す
export async function deletePuzzle(id: string, key: string): Promise<boolean> {
  const res = await fetch("/api/crossword-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, key }),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; deleted?: boolean } | null;
  if (!res.ok || !data?.ok) throw new Error(`crossword-delete failed: ${res.status}`);
  return data.deleted === true;
}

// 自分が作った問題の遊ばれた回数。隠された・消された問題は返ってこない（その id は含まれない）
export async function loadPlayCounts(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const { data, error } = await getSupabase().from("crossword_puzzles").select("id,play_count").in("id", ids);
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of (data as { id: string; play_count: number }[] | null) ?? []) out[r.id] = r.play_count;
  return out;
}

// --- 自分が作った問題（この端末の localStorage だけに置く） ---
export interface MyPuzzle {
  id: string;
  title: string;
  key: string;
  createdAt: number;
}

const MY_PUZZLES_KEY = "crossword_my_puzzles";

export function readMyPuzzles(): MyPuzzle[] {
  try {
    const raw = localStorage.getItem(MY_PUZZLES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is MyPuzzle =>
        !!m && typeof m.id === "string" && typeof m.title === "string" && typeof m.key === "string" && typeof m.createdAt === "number"
    );
  } catch {
    return [];
  }
}

function writeMyPuzzles(list: MyPuzzle[]): void {
  try {
    localStorage.setItem(MY_PUZZLES_KEY, JSON.stringify(list));
  } catch {
    /* 置けなくても保存そのものは済んでいる */
  }
}

export function addMyPuzzle(m: MyPuzzle): MyPuzzle[] {
  const list = [...readMyPuzzles().filter((x) => x.id !== m.id), m];
  writeMyPuzzles(list);
  return list;
}

export function removeMyPuzzle(id: string): MyPuzzle[] {
  const list = readMyPuzzles().filter((x) => x.id !== id);
  writeMyPuzzles(list);
  return list;
}

// ハロプロのジャンルのヒントの動画のうち、今も台帳（youtube_videos）にある物の番号。
// 台帳は削除・非公開になった動画を行ごと消す（gas/youtube-scraper.js の checkVideoAvailability）ので、無い物は見られなくなった動画
export async function catalogVideoIdsPresent(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await getSupabase().from("youtube_videos").select("video_id").in("video_id", ids);
  if (error) throw error;
  return new Set(((data as { video_id: string }[] | null) ?? []).map((r) => r.video_id));
}

// 台帳に無い動画ごとの YouTube の答え。一度に聞くのは 6 件まで【仮】（作った問題の一覧は問題の数だけ増えるため）
async function askOutsideChannels(ids: string[]): Promise<Map<string, string>> {
  const answers = new Map<string, string>();
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      answers.set(id, await askVideoChannel(id));
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker));
  return answers;
}

// 開いた問題の YouTube のヒントに、台帳に無い動画だけチャンネル名か見られない印を付ける（どちらも画面の中だけ）
// ハロプロ: 台帳にあればそのまま。無ければチャンネル名を聞き、YouTube が見られないと答えたら見られない印（Hop 決定 2026-10-04）。分からない時はそのまま
// その他: 台帳を見ずに全部チャンネル名を聞く。聞けなければそのまま（再生側が知らせる）
export async function withVideoChannels(hints: Record<string, HintRef>, genre: Genre): Promise<Record<string, HintRef>> {
  const ids = Array.from(new Set(Object.values(hints).flatMap((h) => (h.kind === "youtube" ? [h.videoId] : []))));
  if (ids.length === 0) return hints;
  const present = genre === "hello" ? await catalogVideoIdsPresent(ids) : new Set<string>();
  const answers = await askOutsideChannels(ids.filter((id) => !present.has(id)));
  return Object.fromEntries(
    Object.entries(hints).map(([k, h]) => {
      if (h.kind !== "youtube" || present.has(h.videoId)) return [k, h];
      const a = answers.get(h.videoId);
      if (a === "gone") return [k, genre === "hello" ? { ...h, gone: true } : h];
      if (!a || a === "unknown") return [k, h];
      return [k, { ...h, channel: a }];
    }),
  );
}

// 自分が作った問題のうち、ヒントの動画が見られなくなった物（ハロプロのジャンルだけ。その他のジャンルの動画は台帳の外なので分からない）
// 台帳に無い動画は、YouTube が見られないと答えた時だけ見られない物に数える（チャンネル名は保存していない。分からない時は数えない）
export async function loadPuzzlesWithGoneHints(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await getSupabase().from("crossword_puzzles").select("id,genre,body").in("id", ids).eq("genre", "hello");
  if (error) throw error;
  const rows = (data as { id: string; body: PuzzleBody | null }[] | null) ?? [];
  const videosOf = (b: PuzzleBody | null) => (b?.clues ?? []).flatMap((c) => (c.hint?.kind === "youtube" ? [c.hint.videoId] : []));
  const all = Array.from(new Set(rows.flatMap((r) => videosOf(r.body))));
  const present = await catalogVideoIdsPresent(all);
  const answers = await askOutsideChannels(all.filter((v) => !present.has(v)));
  return new Set(rows.filter((r) => videosOf(r.body).some((v) => !present.has(v) && answers.get(v) === "gone")).map((r) => r.id));
}
