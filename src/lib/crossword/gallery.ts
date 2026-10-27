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
  /** 同じ中身かどうかの印（盤の大きさと、カギごとの向き・置き場所・字数・カギの文）。読めない時は空 */
  contentKey: string;
  /** 同じ中身のもっと古い問題を棚に問い合わせる時に使う、一番長いカギの文（保存されたままの字） */
  probeClue: string;
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
  body: Pick<PuzzleBody, "clues" | "creatorName" | "width" | "height"> | null;
}

// 同じ中身の問題をまとめるための印（Hop 決定 2026-10-27: 公開は断らず、ギャラリーでは一番古い1つ＝最初に公開した問題だけを出す。
// 新しい方を出すと、丸写しして公開した人の問題が出て、最初に作った人の問題が隠れるため）。
// 棚から読める中身には答えの字そのものが無い（受付係しか読めない棚にある）ので、答えは字数で比べる。
// カギの文・向き・置き場所・字数と盤の大きさが全部同じなら、答えも同じ並びとみなす
export const contentKeyOf = (body: Row["body"]): string => {
  if (!body || !Array.isArray(body.clues) || body.clues.length === 0) return "";
  const parts = body.clues
    .map((c) => {
      const len = typeof c.length === "number" ? c.length : Array.isArray(c.answer) ? c.answer.length : 0;
      return JSON.stringify([c.direction, c.startX, c.startY, len, typeof c.clue === "string" ? c.clue.trim() : ""]);
    })
    .sort();
  return JSON.stringify([body.width, body.height, parts]);
};

// 一番長いカギの文（棚への問い合わせで候補を絞るため。長い文ほど、たまたま同じになることが少ない）
const probeClueOf = (body: Row["body"]): string =>
  Array.isArray(body?.clues) ? body!.clues.reduce((best, c) => (typeof c.clue === "string" && c.clue.length > best.length ? c.clue : best), "") : "";

// 同じ印の問題が並びの中にあったら、一番古い物だけを残す。残した物は、その物がもともと並んでいた場所に置く
// （一番古い物の場所のまま。写しの方の場所へは動かさない。動かすと、写しを公開するたびに元の問題が上に来て、写しが「上げる」道具になるため）
export const dedupeGallery = (list: GalleryPuzzle[]): GalleryPuzzle[] => {
  const oldest = new Map<string, GalleryPuzzle>();
  for (const p of list) {
    if (!p.contentKey) continue;
    const o = oldest.get(p.contentKey);
    if (!o || p.created_at < o.created_at || (p.created_at === o.created_at && p.id < o.id)) oldest.set(p.contentKey, p);
  }
  return list.filter((p) => !p.contentKey || oldest.get(p.contentKey) === p);
};

// 並びに出す前に、同じ中身でもっと古い問題が棚にある物を外す（その古い問題は、続きを読めば自分の場所に出てくる）。
// 隠された問題は RLS が返さないので、元の問題が隠されていれば写しの方が出る。問い合わせに失敗した時は外さない（一覧を出せなくしない）
async function dropCopies(list: GalleryPuzzle[]): Promise<GalleryPuzzle[]> {
  const checks = await Promise.all(
    list.map(async (p) => {
      if (!p.contentKey || !p.probeClue) return false;
      const { data, error } = await getSupabase()
        .from("crossword_puzzles")
        .select("id,created_at,body")
        .contains("body", { clues: [{ clue: p.probeClue }] })
        .lte("created_at", p.created_at)
        .neq("id", p.id)
        .limit(50);
      if (error) return false;
      const rows = (data as unknown as { id: string; created_at: string; body: Row["body"] }[] | null) ?? [];
      return rows.some((r) => contentKeyOf(r.body) === p.contentKey && (r.created_at < p.created_at || (r.created_at === p.created_at && r.id < p.id)));
    })
  );
  return list.filter((_, i) => !checks[i]);
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
  contentKey: contentKeyOf(r.body),
  probeClue: probeClueOf(r.body),
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

// 同じ中身をまとめて減った分を埋めるために、続けて読む回数の上限【仮】
const DEDUPE_EXTRA_READS = 3;

// 同じ中身の問題は一番古い1つだけを出し、写しの方は外す。外して減った分は続きを読んで埋める（上限 DEDUPE_EXTRA_READS 回）
export async function getPublicPuzzles(q: GalleryQuery = {}): Promise<GalleryPage> {
  const limitCount = q.limitCount ?? 12;
  let offset = q.offset ?? 0;
  const got: GalleryPuzzle[] = [];
  let hasMore = false;
  for (let round = 0; round <= DEDUPE_EXTRA_READS; round++) {
    const page = await getRawPage(q, limitCount, offset);
    got.push(...(await dropCopies(dedupeGallery(page.puzzles))));
    hasMore = page.hasMore;
    offset = page.nextOffset;
    if (dedupeGallery(got).length >= limitCount || !hasMore || page.puzzles.length === 0) break;
  }
  return { puzzles: dedupeGallery(got), hasMore, nextOffset: offset };
}

async function getRawPage(q: GalleryQuery, limitCount: number, offset: number): Promise<GalleryPage> {
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
