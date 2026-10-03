// パズルの一覧（/crossword/list）と、終わりの画面の「ほかの問題」の読み込み。
// HarmonyPalette の getPublicPuzzles（新着順・人気順、作成者名で検索、12件ずつ・1件多く読んで続きの有無を知る）を Supabase で写したもの。
// 隠された問題は RLS が返さない。
import { getSupabase } from "../supabase";
import type { Genre, PuzzleBody } from "./puzzleStore";

export type SortOption = "newest" | "popular";

export interface GalleryPuzzle {
  id: string;
  title: string;
  genre: Genre;
  tags: string[];
  created_at: string;
  play_count: number;
  is_beginner: boolean;
  group_tags: string[];
  creatorName?: string;
  wordCount: number;
}

interface Row {
  id: string;
  title: string;
  genre: Genre;
  tags: string[] | null;
  created_at: string;
  play_count: number | null;
  is_beginner: boolean | null;
  group_tags: string[] | null;
  body: Pick<PuzzleBody, "clues" | "creatorName"> | null;
}

// 一覧に要るのは語の数と作成者名だけだが、body の一部だけを選ぶ書き方は使わず body ごと読む（1問 50KB まで）
const COLUMNS = "id,title,genre,tags,created_at,play_count,is_beginner,group_tags,body";

const toGallery = (r: Row): GalleryPuzzle => ({
  id: r.id,
  title: r.title,
  genre: r.genre,
  tags: r.tags ?? [],
  created_at: r.created_at,
  play_count: r.play_count ?? 0,
  is_beginner: r.is_beginner === true,
  group_tags: r.group_tags ?? [],
  creatorName: typeof r.body?.creatorName === "string" ? r.body.creatorName : undefined,
  wordCount: Array.isArray(r.body?.clues) ? r.body!.clues.length : 0,
});

export interface GalleryQuery {
  creatorName?: string;
  sortBy?: SortOption;
  genre?: Genre | "all";
  group?: string;
  tag?: string;
  beginnerOnly?: boolean;
  limitCount?: number;
  offset?: number;
}

export interface GalleryPage {
  puzzles: GalleryPuzzle[];
  hasMore: boolean;
}

// ilike の中で特別な意味を持つ字（% _ \）をただの字にする
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function getPublicPuzzles(q: GalleryQuery = {}): Promise<GalleryPage> {
  const limitCount = q.limitCount ?? 12;
  const offset = q.offset ?? 0;
  let query = getSupabase().from("crossword_puzzles").select(COLUMNS);

  if (q.genre && q.genre !== "all") query = query.eq("genre", q.genre);
  if (q.group) query = query.contains("group_tags", [q.group]);
  if (q.tag) query = query.contains("tags", [q.tag]);
  if (q.beginnerOnly) query = query.eq("is_beginner", true);
  const name = q.creatorName?.trim();
  if (name) query = query.ilike("body->>creatorName", `%${escapeLike(name)}%`);

  if (q.sortBy === "popular") query = query.order("play_count", { ascending: false }).order("created_at", { ascending: false });
  else query = query.order("created_at", { ascending: false });

  // 次があるかを知るため 1 件多く読む
  const { data, error } = await query.range(offset, offset + limitCount);
  if (error) throw error;
  const rows = (data as Row[] | null) ?? [];
  return { puzzles: rows.slice(0, limitCount).map(toGallery), hasMore: rows.length > limitCount };
}

// 終わりの画面の「ほかの問題」。同じジャンルの新しい順【仮】
export async function getOtherPuzzles(genre: Genre, excludeId: string, limitCount = 3): Promise<GalleryPuzzle[]> {
  const { data, error } = await getSupabase()
    .from("crossword_puzzles")
    .select(COLUMNS)
    .eq("genre", genre)
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    .limit(limitCount);
  if (error) throw error;
  return ((data as Row[] | null) ?? []).map(toGallery);
}
