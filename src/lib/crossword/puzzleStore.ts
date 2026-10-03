import { getSupabase } from "../supabase";
import type { PlacedItem } from "./types";

export type Genre = "hello" | "other";

// カギごとのヒント。YouTube はアプリ内で再生、それ以外はリンクで開く
export type HintRef =
  | { kind: "youtube"; videoId: string; startSec: number }
  | { kind: "link"; url: string };

export interface StoredClue {
  clueIndex: number;
  direction: "horizontal" | "vertical";
  startX: number;
  startY: number;
  clue: string;
  answer: string[]; // toCells 済み（カタカナ・大きい字）
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
}

export interface NewPuzzle {
  title: string;
  genre: Genre;
  tags: string[];
  body: PuzzleBody;
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
  constructor(public reason: string) {
    super(`save failed: ${reason}`);
  }
}

export async function savePuzzle(
  p: NewPuzzle,
  opts: { key: string; token: string; website: string }
): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/crossword-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ puzzle: { ...p, key: opts.key }, token: opts.token, website: opts.website }),
    });
  } catch {
    throw new SaveError("network");
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: unknown; reason?: unknown };
  if (res.ok && data.ok && typeof data.id === "string") return data.id;
  throw new SaveError(typeof data.reason === "string" ? data.reason : "server");
}

// 削除用の合言葉。32 バイトの乱数を16進64字にする（受付係には sha256 だけが残る）
export const makeOwnerKey = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

export async function loadPuzzle(id: string): Promise<PuzzleRecord | null> {
  const { data, error } = await getSupabase()
    .from("crossword_puzzles")
    .select("id,title,genre,tags,body,created_at")
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
}

// ハロプロのジャンルのヒント選び。台帳の表示してよい動画を題名で探す
export async function searchCatalogVideos(query: string, limit = 10): Promise<CatalogVideo[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await getSupabase()
    .from("youtube_videos")
    .select("video_id,title,channel_name")
    .eq("is_active_content", true)
    .ilike("title", `%${q}%`)
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as CatalogVideo[] | null) ?? [];
}

// 遊ばれた回数を1足す。失敗しても遊ぶのは止めない
export async function addPlay(id: string): Promise<void> {
  const { error } = await getSupabase().rpc("crossword_add_play", { p_id: id });
  if (error) throw error;
}

// 運営に隠された問題かどうか（中身は返らない）
export async function isHiddenPuzzle(id: string): Promise<boolean> {
  const { data, error } = await getSupabase().rpc("crossword_is_hidden", { p_id: id });
  if (error) throw error;
  return data === true;
}

// 合言葉が合えば消す。合わなければ false
export async function deletePuzzle(id: string, key: string): Promise<boolean> {
  const { data, error } = await getSupabase().rpc("crossword_delete", { p_id: id, p_key: key });
  if (error) throw error;
  return data === true;
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
