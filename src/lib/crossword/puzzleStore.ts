import { getSupabase } from "../supabase";
import type { PlacedItem } from "./types";

export type Genre = "hello" | "other";

// カギごとのヒント。YouTube はアプリ内で再生、それ以外はリンクで開く
export type HintRef =
  // gone は画面の中だけで使う印（台帳から消えた・再生できない動画）。保存はしない
  | { kind: "youtube"; videoId: string; startSec: number; gone?: boolean }
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

// ハロプロのジャンルのヒント選び。台帳の表示してよい動画を題名で探す
export async function searchCatalogVideos(query: string, limit = 8): Promise<CatalogVideo[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await getSupabase()
    .from("youtube_videos")
    .select("video_id,title,channel_name,published_at")
    .eq("is_active_content", true)
    .ilike("title", `%${q}%`)
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as CatalogVideo[] | null) ?? [];
}

// 曲名で区切りを探す。表示してよい動画（is_active_content=true）の区切りだけ返す
export async function searchCatalogChapters(query: string, limit = 12): Promise<CatalogChapter[]> {
  const q = query.trim();
  if (!q) return [];
  const sb = getSupabase();
  // 表示してよい動画に絞ると落ちる分があるので、多めに取ってから絞る
  const { data, error } = await sb
    .from("video_chapters")
    .select("video_id,seq,toc_sec,content_start_sec,song_title,group_name,venue,performed_on")
    .ilike("song_title", `%${q}%`)
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

// 自分が作った問題のうち、ヒントの動画が見られなくなった物（ハロプロのジャンルだけ。その他のジャンルの動画は台帳の外なので分からない）
export async function loadPuzzlesWithGoneHints(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await getSupabase().from("crossword_puzzles").select("id,genre,body").in("id", ids).eq("genre", "hello");
  if (error) throw error;
  const rows = (data as { id: string; body: PuzzleBody | null }[] | null) ?? [];
  const videosOf = (b: PuzzleBody | null) =>
    (b?.clues ?? []).flatMap((c) => (c.hint?.kind === "youtube" ? [c.hint.videoId] : []));
  const present = await catalogVideoIdsPresent(Array.from(new Set(rows.flatMap((r) => videosOf(r.body)))));
  return new Set(rows.filter((r) => videosOf(r.body).some((v) => !present.has(v))).map((r) => r.id));
}
