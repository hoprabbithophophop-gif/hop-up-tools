// パズルの一覧（/crossword/list）と、終わりの画面の「ほかの問題」の読み込み。
// HarmonyPalette の getPublicPuzzles（新着順・人気順、作成者名で検索、12件ずつ・1件多く読んで続きの有無を知る）を Supabase で写したもの。
// 隠された問題は RLS が返さない。
import { getSupabase } from "../supabase";
import type { Genre, PuzzleBody } from "./puzzleStore";
import { tagsHaveGroup } from "./groupDetect";

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
  /** 「もっと見る」で次に読み始める位置（グループで絞る時は、棚の何件目まで見たか） */
  nextOffset: number;
}

// ilike の中で特別な意味を持つ字（% _ \）をただの字にする
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// グループ以外の絞り込みと並びを付けた問い合わせ
const filtered = (columns: string, q: GalleryQuery) => {
  let query = getSupabase().from("crossword_puzzles").select(columns);
  if (q.genre && q.genre !== "all") query = query.eq("genre", q.genre);
  if (q.tag) query = query.contains("tags", [q.tag]);
  if (q.beginnerOnly) query = query.eq("is_beginner", true);
  const name = q.creatorName?.trim();
  if (name) query = query.ilike("body->>creatorName", `%${escapeLike(name)}%`);
  if (q.sortBy === "popular") query = query.order("play_count", { ascending: false }).order("created_at", { ascending: false });
  else query = query.order("created_at", { ascending: false });
  return query;
};

// グループで絞る時に、印とタグだけを先に何件ずつ見るか・1回の「読む」で見る上限【仮】
const GROUP_SCAN_CHUNK = 200;
const GROUP_SCAN_MAX = 1000;

export async function getPublicPuzzles(q: GalleryQuery = {}): Promise<GalleryPage> {
  const limitCount = q.limitCount ?? 12;
  const offset = q.offset ?? 0;
  if (q.group) return getByGroup(q.group, q, limitCount, offset);

  // 次があるかを知るため 1 件多く読む
  const { data, error } = await filtered(COLUMNS, q).range(offset, offset + limitCount);
  if (error) throw error;
  const rows = (data as unknown as Row[] | null) ?? [];
  const puzzles = rows.slice(0, limitCount).map(toGallery);
  return { puzzles, hasMore: rows.length > limitCount, nextOffset: offset + puzzles.length };
}

// グループで絞る: グループの印（group_tags）があるか、タグにグループ名がある問題（2026-10-06 決定）。
// タグの表記ゆれ（NFKC・年の有無）は棚の問い合わせでは比べられないので、印とタグだけを並び順に読み、ブラウザで比べてから、
// 合った問題の中身を読む。offset は「棚の並びで何件目まで見たか」
async function getByGroup(group: string, q: GalleryQuery, limitCount: number, offset: number): Promise<GalleryPage> {
  const matched: { id: string; at: number }[] = [];
  let pos = offset;
  let exhausted = false;
  while (matched.length <= limitCount && pos - offset < GROUP_SCAN_MAX) {
    const { data, error } = await filtered("id,group_tags,tags", q).range(pos, pos + GROUP_SCAN_CHUNK - 1);
    if (error) throw error;
    const rows = (data as unknown as { id: string; group_tags: string[] | null; tags: string[] | null }[] | null) ?? [];
    rows.forEach((r, i) => {
      if ((r.group_tags ?? []).includes(group) || tagsHaveGroup(r.tags ?? [], group)) matched.push({ id: r.id, at: pos + i });
    });
    pos += rows.length;
    if (rows.length < GROUP_SCAN_CHUNK) {
      exhausted = true;
      break;
    }
  }
  const page = matched.slice(0, limitCount);
  const hasMore = matched.length > limitCount || !exhausted;
  const nextOffset = matched.length > limitCount ? page[page.length - 1].at + 1 : pos;
  if (page.length === 0) return { puzzles: [], hasMore, nextOffset };
  const { data, error } = await getSupabase().from("crossword_puzzles").select(COLUMNS).in("id", page.map((m) => m.id));
  if (error) throw error;
  const byId = new Map(((data as unknown as Row[] | null) ?? []).map((r) => [r.id, r]));
  const puzzles = page.flatMap((m) => {
    const r = byId.get(m.id);
    return r ? [toGallery(r)] : [];
  });
  return { puzzles, hasMore, nextOffset };
}

// 終わりの画面の「ほかの問題」。同じジャンルの新しい順
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
