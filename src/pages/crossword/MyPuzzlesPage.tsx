// 自分が作った問題（/crossword/mine）。この端末で作った問題だけを並べる。
// もとは作る画面の下にあった一覧を、別の画面に分けた（Hop 依頼 2026-10-03「自分が作った問題は別画面で見たい」）。
// 並び・文言・消し方は作る画面にあったときと同じ。
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { usePageReady } from "../../lib/pageReady";
import { deletePuzzle, loadPlayCounts, loadPuzzlesWithGoneHints, readMyPuzzles, removeMyPuzzle, type MyPuzzle } from "../../lib/crossword/puzzleStore";
import { applyTransferCode, makeTransferCode } from "../../lib/crossword/transfer";
import { Toaster, toast } from "./components/Toast";
import { Footer, Icon } from "./components/ui";
import { C } from "./style";

const T = {
  title: "自分が作った問題",
  backToCreate: "クロスワードパズル作成へ戻る",
  empty: "この端末で作った問題はまだありません", // 
  plays: "遊ばれた回数",
  unavailable: "非表示になっています",
  open: "開く",
  delete: "削除",
  confirm: "消す？",
  confirmYes: "消す",
  confirmNo: "やめる",
  deleteFailed: "削除できませんでした",
  goneHints: "見られなくなったヒントがあります", // Hop 決定 2026-10-04
  // 別の端末への引き継ぎ（Hop 決定 2026-10-04）
  transfer: {
    title: "別の端末へ引き継ぐ",
    lead: "作った問題と、ランキングでの自分の記録を、別の端末へ移せます。",
    show: "合言葉を出す",
    copy: "写す",
    copied: "写しました",
    warn: "この合言葉を知っている人は、あなたの問題を消せます。人に見せないでください。",
    inputLabel: "別の端末で出した合言葉",
    apply: "引き継ぐ",
    done: (n: number) => `引き継ぎました（問題 ${n} 件）`,
    bad: "合言葉を読めませんでした。もう一度写し直してください。",
  },
};

export default function MyPuzzlesPage() {
  const [myPuzzles, setMyPuzzles] = useState<MyPuzzle[]>(() => readMyPuzzles());
  const [playCounts, setPlayCounts] = useState<Record<string, number> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [goneHints, setGoneHints] = useState<Set<string>>(new Set());
  const [code, setCode] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const handleCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success(T.transfer.copied);
    } catch {
      // 写せない時は欄を選んだ状態にして、手で写せるようにする
      (document.getElementById("transfer-code") as HTMLTextAreaElement | null)?.select();
    }
  };

  const handleApply = () => {
    const r = applyTransferCode(input);
    if (!r) {
      toast.error(T.transfer.bad);
      return;
    }
    setMyPuzzles(readMyPuzzles());
    setInput("");
    toast.success(T.transfer.done(r.added));
  };

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

  // ヒントの動画が見られなくなった問題（ハロプロのジャンルだけ分かる）
  useEffect(() => {
    if (!myPuzzleIds) return;
    let alive = true;
    loadPuzzlesWithGoneHints(myPuzzleIds.split(","))
      .then((g) => alive && setGoneHints(g))
      .catch((err) => console.warn("Failed to check hint videos:", err));
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
            <Link to="/crossword/create" className="p-1.5 hover:bg-surface-container-high transition-colors" style={{ color: C.ink }} title={T.backToCreate} aria-label={T.backToCreate}>
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
                            {goneHints.has(m.id) && (
                              <div className="text-xs" style={{ color: C.secondary }}>{T.goneHints}</div>
                            )}
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

          {/* 別の端末へ引き継ぐ */}
          <div className="bg-white p-6 mt-6 space-y-4">
            <h2 className="text-base font-semibold" style={{ color: C.ink }}>{T.transfer.title}</h2>
            <p className="text-sm" style={{ color: C.secondary }}>{T.transfer.lead}</p>
            {code === null ? (
              <button
                type="button"
                onClick={() => setCode(makeTransferCode())}
                className="px-4 py-2 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors"
                style={{ color: C.ink }}
              >
                {T.transfer.show}
              </button>
            ) : (
              <div className="space-y-2">
                <textarea
                  id="transfer-code"
                  readOnly
                  value={code}
                  rows={3}
                  className="w-full px-3 py-2 text-base bg-surface-container-low break-all"
                  style={{ color: C.ink }}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <p className="text-xs" style={{ color: C.error }}>{T.transfer.warn}</p>
                <button type="button" onClick={handleCopy} className="px-4 py-2 text-sm font-bold bg-primary text-white hover:bg-secondary transition-colors">
                  {T.transfer.copy}
                </button>
              </div>
            )}
            <div className="space-y-2 pt-2" style={{ borderTop: `1px solid ${C.ghost}` }}>
              <label htmlFor="transfer-input" className="block text-sm pt-2" style={{ color: C.ink }}>{T.transfer.inputLabel}</label>
              <div className="flex gap-2">
                <input
                  id="transfer-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-2 text-base bg-surface-container-low focus:outline-none focus:bg-white focus:shadow-[inset_0_-2px_0_#000]"
                  style={{ color: C.ink }}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={!input.trim()}
                  className="px-4 py-2 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors disabled:opacity-50 shrink-0"
                  style={{ color: C.ink }}
                >
                  {T.transfer.apply}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
