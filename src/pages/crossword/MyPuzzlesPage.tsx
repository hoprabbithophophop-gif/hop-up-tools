// 自分が作った問題（/crossword/mine【仮】）。この端末で作った問題だけを並べる。
// もとは作る画面の下にあった一覧を、別の画面に分けた（Hop 依頼 2026-10-03「自分が作った問題は別画面で見たい」）。
// 並び・文言・消し方は作る画面にあったときと同じ。
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { usePageReady } from "../../lib/pageReady";
import { deletePuzzle, loadPlayCounts, readMyPuzzles, removeMyPuzzle, type MyPuzzle } from "../../lib/crossword/puzzleStore";
import { Toaster, toast } from "./components/Toast";
import { Footer, Icon } from "./components/ui";
import { C } from "./style";

const T = {
  title: "自分が作った問題",
  backToCreate: "クロスワードパズル作成へ戻る",
  empty: "この端末で作った問題はまだありません", // 【仮】
  plays: "遊ばれた回数",
  unavailable: "非表示になっています",
  open: "開く",
  delete: "削除",
  confirm: "消す？",
  confirmYes: "消す",
  confirmNo: "やめる",
  deleteFailed: "削除できませんでした",
};

export default function MyPuzzlesPage() {
  const [myPuzzles, setMyPuzzles] = useState<MyPuzzle[]>(() => readMyPuzzles());
  const [playCounts, setPlayCounts] = useState<Record<string, number> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  usePageReady(true);

  // 遊ばれた回数を読む
  const myPuzzleIds = myPuzzles.map((m) => m.id).join(",");
  useEffect(() => {
    if (!myPuzzleIds) return;
    let alive = true;
    setPlayCounts(null); // 読み終わるまでは空欄
    loadPlayCounts(myPuzzleIds.split(","))
      .then((c) => {
        if (alive) setPlayCounts(c);
      })
      .catch((err) => {
        console.warn("Failed to load play counts:", err);
        if (alive) setPlayCounts({});
      });
    return () => {
      alive = false;
    };
  }, [myPuzzleIds]);

  const handleDelete = async (m: MyPuzzle) => {
    setDeletingId(m.id);
    try {
      const ok = await deletePuzzle(m.id, m.key);
      if (ok) {
        setMyPuzzles(removeMyPuzzle(m.id));
        setConfirmDelete(null);
      } else {
        toast.error(T.deleteFailed);
      }
    } catch (err) {
      console.error("Failed to delete puzzle:", err);
      toast.error(T.deleteFailed);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Toaster />
      <div className="min-h-screen bg-surface">
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/crossword" className="p-1.5 hover:bg-surface-container-high transition-colors" style={{ color: C.ink }} title={T.backToCreate} aria-label={T.backToCreate}>
              <Icon icon="chevron_left" />
            </Link>
            <h1 className="text-2xl font-bold" style={{ color: C.ink }}>{T.title}</h1>
          </div>

          <div className="bg-white p-6">
            {myPuzzles.length === 0 ? (
              <p className="text-sm py-8 text-center" style={{ color: C.secondary }}>{T.empty}</p>
            ) : (
              <ul>
                {[...myPuzzles].sort((a, b) => b.createdAt - a.createdAt).map((m, i) => {
                  const count = playCounts?.[m.id];
                  const known = playCounts !== null;
                  return (
                    <li key={m.id} className="py-3" style={i === 0 ? undefined : { borderTop: `1px solid ${C.ghost}` }}>
                      {confirmDelete === m.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex-1 min-w-0 text-sm truncate" style={{ color: C.ink }}>
                            「{m.title}」{T.confirm}
                          </span>
                          <button
                            onClick={() => handleDelete(m)}
                            disabled={deletingId === m.id}
                            className="px-3 py-1.5 text-sm font-bold bg-primary text-white hover:bg-secondary transition-colors disabled:opacity-50"
                          >
                            {T.confirmYes}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            disabled={deletingId === m.id}
                            className="px-3 py-1.5 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors disabled:opacity-50"
                            style={{ color: C.ink }}
                          >
                            {T.confirmNo}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold truncate" style={{ color: C.ink }}>{m.title}</div>
                            <div className="text-xs" style={{ color: C.secondary }}>
                              {!known ? "" : count === undefined ? T.unavailable : `${T.plays} ${count}`}
                            </div>
                          </div>
                          <Link
                            to={`/crossword/${m.id}`}
                            className="px-3 py-1.5 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors shrink-0"
                            style={{ color: C.ink }}
                          >
                            {T.open}
                          </Link>
                          <button
                            onClick={() => setConfirmDelete(m.id)}
                            className="px-3 py-1.5 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors shrink-0"
                            style={{ color: C.ink }}
                          >
                            {T.delete}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
