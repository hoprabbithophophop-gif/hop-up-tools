import { nanoid } from "nanoid";
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

export async function savePuzzle(p: NewPuzzle): Promise<string> {
  const id = nanoid(8);
  const { error } = await getSupabase().from("crossword_puzzles").insert({ id, ...p });
  if (error) throw error;
  return id;
}

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
