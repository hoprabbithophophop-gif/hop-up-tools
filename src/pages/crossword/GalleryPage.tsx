// パズルの一覧（/crossword・/crossword/list）。
// HarmonyPalette の src/pages/GalleryPage.tsx の移植。並び・動き・文言は同じ
// （新着順・人気順、作成者名で検索、12件ずつ「もっと見る」、更新、検索中の表示とクリア、読み込み中・失敗・0件の表示）。
// 変えた所: 見た目（DESIGN.md）、アイコン（Material Symbols）、読み込み先（Supabase。続きは何件目からで読む）、
// 足した物（ジャンル・グループ・タグ・「初めての人向け」で絞る、作る画面へ戻る入口、ページ移動の波を待たせる、フッターの非公式の一文）。
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePageReady } from "../../lib/pageReady";
import { getPublicPuzzles, type GalleryPuzzle, type SortOption } from "../../lib/crossword/gallery";
import type { Genre } from "../../lib/crossword/puzzleStore";
import { GROUP_NAMES } from "../../lib/crossword/groupDetect";
import { PuzzleGalleryCard, BEGINNER_LABEL } from "./components/PuzzleGalleryCard";
import { Footer, Icon } from "./components/ui";
import { radioKeyDown, radioTabIndex } from "./components/radioKeys";
import { C } from "./style";

const PAGE_SIZE = 12;

// 足した物の文言
const T = {
  pageTitle: "パズルギャラリー",
  backToCreate: "トップへ戻る",
  genre: "ジャンル",
  genres: [
    { key: "all", label: "すべて" },
    { key: "hello", label: "ハロプロ" },
    { key: "other", label: "その他" },
  ] as { key: Genre | "all"; label: string }[],
  group: "グループ",
  groupAll: "すべて",
  tag: "タグ",
  tagPlaceholder: "タグで絞る",
  apply: "絞る",
  // 絞り込んだ結果が空のときの道（2026-10-06 決定）【仮】
  showAll: "すべての問題を見る",
  create: "作る",
};

export default function GalleryPage() {
  const [puzzles, setPuzzles] = useState<GalleryPuzzle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstDone, setFirstDone] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("newest");

  // 足した絞り込み
  const [genre, setGenre] = useState<Genre | "all">("all");
  const [group, setGroup] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [appliedTag, setAppliedTag] = useState("");
  const [beginnerOnly, setBeginnerOnly] = useState(false);

  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0); // 「もっと見る」で次に読み始める位置
  const reqId = useRef(0);

  // ページ移動の波は、最初の一覧が届くまで待ってもらう
  usePageReady(firstDone);

  const fetchPuzzles = useCallback(
    async (isLoadMore = false) => {
      const id = ++reqId.current;
      try {
        if (isLoadMore) {
          setLoadingMore(true);
        } else {
          setLoading(true);
          setError(null);
        }
        const response = await getPublicPuzzles({
          creatorName: appliedSearch || undefined,
          sortBy,
          genre,
          group: group || undefined,
          tag: appliedTag || undefined,
          beginnerOnly,
          limitCount: PAGE_SIZE,
          offset: isLoadMore ? nextOffset : 0,
        });
        if (id !== reqId.current) return; // 絞り込みを変えた後に届いた古い答えは捨てる
        if (isLoadMore) setPuzzles((prev) => [...prev, ...response.puzzles]);
        else setPuzzles(response.puzzles);
        setHasMore(response.hasMore);
        setNextOffset(response.nextOffset);
      } catch (err) {
        if (id !== reqId.current) return;
        console.error("Failed to fetch puzzles:", err);
        setError("問題を読み込めませんでした");
      } finally {
        if (id === reqId.current) {
          setLoading(false);
          setLoadingMore(false);
          setFirstDone(true);
        }
      }
    },
    [appliedSearch, sortBy, genre, group, appliedTag, beginnerOnly, nextOffset]
  );

  // 初回ロードとフィルタ変更時
  useEffect(() => {
    fetchPuzzles(false);
  }, [appliedSearch, sortBy, genre, group, appliedTag, beginnerOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedSearch(searchQuery.trim());
  };

  const handleTag = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedTag(tagInput.trim());
  };

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) fetchPuzzles(true);
  };

  const handleRefresh = () => fetchPuzzles(false);

  const clearSearch = () => {
    setSearchQuery("");
    setAppliedSearch("");
  };

  // 絞り込み・検索をしているか。全部外すと「すべての問題」に戻る
  const filterActive = genre !== "all" || !!group || !!appliedTag || beginnerOnly || !!appliedSearch;
  const clearAll = () => {
    clearSearch();
    setGenre("all");
    setGroup("");
    setTagInput("");
    setAppliedTag("");
    setBeginnerOnly(false);
  };

  const selectClass = "text-base px-3 py-2 bg-surface-container-low text-on-surface focus:outline-none focus:bg-white focus:shadow-[inset_0_-2px_0_#000] cursor-pointer";
  const inputClass = "w-full px-3 py-2 text-base bg-surface-container-low text-on-surface placeholder:text-outline focus:outline-none focus:bg-white focus:shadow-[inset_0_-2px_0_#000]";

  return (
    <>
      <div className="min-h-screen bg-surface">
        <main className="max-w-6xl mx-auto px-4 py-8">
          {/* ヘッダー */}
          <div className="flex items-center gap-3 mb-6">
            <Link to="/" className="p-1.5 hover:bg-surface-container-high transition-colors" style={{ color: C.ink }} title={T.backToCreate} aria-label={T.backToCreate}>
              <Icon icon="chevron_left" />
            </Link>
            <h1 className="text-2xl font-bold" style={{ color: C.ink }}>{T.pageTitle}</h1>
            <Link to="/crossword/create" className="ml-auto text-sm font-bold inline-flex items-center gap-1 hover:text-black transition-colors" style={{ color: C.secondary }}>
              作る <span aria-hidden="true">→</span>
            </Link>
          </div>

          {/* 検索・フィルタバー */}
          <div className="bg-white p-4 mb-6 space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              {/* 検索フォーム */}
              <form onSubmit={handleSearch} className="flex-1 flex flex-wrap gap-2">
                <div className="relative flex-1 basis-40 min-w-0">
                  <Icon icon="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="作った人の名前で検索…"
                    aria-label="作った人の名前で検索"
                    className={`${inputClass} pl-10`}
                  />
                </div>
                <button type="submit" className="px-4 py-2 bg-primary text-white hover:bg-secondary transition-colors shrink-0">
                  検索
                </button>
              </form>

              {/* ソート選択 */}
              <div className="flex items-center gap-2">
                <Icon icon="sort" size={16} />
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className={selectClass} aria-label="並び替え">
                  <option value="newest">新着順</option>
                  <option value="popular">人気順</option>
                </select>
                {/* リフレッシュボタン */}
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={loading}
                  className="p-2 hover:bg-surface-container-high transition-colors disabled:opacity-50"
                  style={{ color: C.secondary }}
                  title="読み込み直す"
                  aria-label="読み込み直す"
                >
                  <Icon icon="refresh" size={16} />
                </button>
              </div>
            </div>

            {/* 足した絞り込み: ジャンル・グループ・タグ・初めての人向け */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="inline-flex flex-wrap max-w-full" role="radiogroup" aria-label={T.genre}>
                {T.genres.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    role="radio"
                    aria-checked={genre === g.key}
                    tabIndex={radioTabIndex(genre === g.key)}
                    onKeyDown={(e) => radioKeyDown(e, T.genres.map((x) => x.key), genre, setGenre)}
                    onClick={() => setGenre(g.key)}
                    className={`px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${genre === g.key ? "bg-primary text-white" : "bg-surface-container-low text-on-surface hover:bg-surface-container-high"}`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>

              {/* 文字を大きくして1行に収まらない時は、札の下へ折り返す（横スクロールを出さない。2026-10-06 アクセシビリティの直し） */}
              <label className="flex flex-wrap items-center gap-2 text-sm max-w-full min-w-0" style={{ color: C.secondary }}>
                {T.group}
                <select value={group} onChange={(e) => setGroup(e.target.value)} className={`${selectClass} max-w-full min-w-0`}>
                  <option value="">{T.groupAll}</option>
                  {GROUP_NAMES.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </label>

              <form onSubmit={handleTag} className="flex gap-2 max-w-full min-w-0">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder={T.tagPlaceholder}
                  maxLength={20}
                  aria-label={T.tag}
                  className={`${inputClass} w-40`}
                />
                <button type="submit" className="px-3 py-2 text-sm bg-surface-container-high hover:bg-surface-container-highest transition-colors shrink-0" style={{ color: C.ink }}>
                  {T.apply}
                </button>
              </form>

              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: C.ink }}>
                <input type="checkbox" checked={beginnerOnly} onChange={(e) => setBeginnerOnly(e.target.checked)} className="w-4 h-4 accent-black" />
                {BEGINNER_LABEL}
              </label>
            </div>

            {/* 検索中の表示 */}
            {(appliedSearch || appliedTag) && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm" style={{ color: C.secondary }}>絞り込み中：</span>
                {appliedSearch && (
                  <>
                    <span className="px-2 py-0.5 bg-surface-container-high text-sm" style={{ color: C.ink }}>{appliedSearch}</span>
                    <button type="button" onClick={clearSearch} className="text-xs hover:text-black" style={{ color: C.secondary }}>
                      外す
                    </button>
                  </>
                )}
                {appliedTag && (
                  <>
                    <span className="px-2 py-0.5 bg-surface-container-high text-sm" style={{ color: C.ink }}>{T.tag}：{appliedTag}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setTagInput("");
                        setAppliedTag("");
                      }}
                      className="text-xs hover:text-black"
                      style={{ color: C.secondary }}
                    >
                      外す
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* コンテンツエリア */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-black border-t-transparent motion-safe:animate-spin" />
              <span className="ml-3" style={{ color: C.secondary }}>読み込み中…</span>
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <p className="mb-4" style={{ color: C.error }}>{error}</p>
              <button type="button" onClick={handleRefresh} className="px-4 py-2 bg-primary text-white hover:bg-secondary transition-colors">
                もう一度読み込む
              </button>
            </div>
          ) : puzzles.length === 0 ? (
            <div className="text-center py-20">
              <Icon icon="extension" size={64} className="block mx-auto mb-4" />
              <p className="mb-2" style={{ color: C.secondary }}>
                {filterActive ? "条件に合う問題がありません。" : "問題がまだ公開されていません。"}
              </p>
              {appliedSearch && (
                <button type="button" onClick={clearSearch} className="hover:underline" style={{ color: C.ink }}>
                  検索を外す
                </button>
              )}
              {/* 絞り込んだ結果が空のときの道（2026-10-06 決定） */}
              {filterActive && (
                <div data-empty-ways="" className="flex flex-wrap justify-center gap-2 mt-4">
                  <button
                    type="button"
                    onClick={clearAll}
                    className="px-4 py-2 bg-primary text-white hover:bg-secondary transition-colors"
                  >
                    {T.showAll}
                  </button>
                  <Link
                    to="/crossword/create"
                    className="px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest transition-colors"
                    style={{ color: C.ink }}
                  >
                    {T.create}
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[2px]">
                {puzzles.map((puzzle) => (
                  <PuzzleGalleryCard key={puzzle.id} puzzle={puzzle} />
                ))}
              </div>

              {/* もっと読み込むボタン */}
              {hasMore && (
                <div className="text-center mt-8">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="px-6 py-3 bg-surface-container-high hover:bg-surface-container-highest transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                    style={{ color: C.ink }}
                  >
                    {loadingMore ? (
                      <>
                        <div className="w-4 h-4 border-2 border-black border-t-transparent motion-safe:animate-spin" />
                        読み込み中…
                      </>
                    ) : (
                      "もっと見る"
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>
      <Footer />
    </>
  );
}
