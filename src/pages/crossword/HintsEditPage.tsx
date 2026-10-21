// ヒントだけを差し替える画面（/crossword/hints/<番号>）。Hop 決定 2026-10-19「遊ばれた後でも、本人がヒントだけは差し替えられるように」。
// 組み直し（/crossword/create?edit=）は遊ばれる前だけ。ヒントは答えにもランキングにも触れないので、この画面は遊ばれた後でも使える。
// 本文は送らない。「どのカギのヒントを何に替えるか」だけを受付係（/api/crossword-update-hints）に渡し、受付係が棚の本文のヒント部分だけを入れ替える。
// 入れるのは、この端末に合言葉が残っている問題だけ（自分が作った問題と同じ）。
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usePageReady } from "../../lib/pageReady";
import { fetchOwnedPuzzle, readMyPuzzles, updatePuzzleHints, withOutsideMarks, SaveError, type Genre, type HintRef, type MyPuzzle } from "../../lib/crossword/puzzleStore";
import { formatTime } from "../../lib/crossword/youtubeUrl";
import { HintField, type Selected } from "./components/HintField";
import { useHintSearch } from "./components/hintSearch";
import { Toaster, toast } from "./components/Toast";
import { Icon } from "./components/ui";
import { C } from "./style";

const T = {
  title: "ヒントを直す", // 【仮】
  back: "自分が作った問題へ戻る", // 【仮】
  lead: "答えとカギの文はそのまま、ヒントだけ差し替えられます。遊ばれた後でも使えます。", // 【仮】
  notMine: "この端末にはこのクロスワードの合言葉がありません。", // 【仮】
  notFound: "このクロスワードは見つからないか、非表示になっています。", // 【仮】
  loadFailed: "読み込めませんでした。時間をおいてもう一度お試しください。", // 【仮】
  save: "ヒントを更新する", // 【仮】
  saving: "更新中…",
  saved: "ヒントを更新しました。", // 【仮】
  noChange: "変えたヒントがありません。", // 【仮】
  missing: (n: number) => `ヒントがあと${n}つ`, // 作る画面の共有ボタンと同じ言い回し
  failed: "更新できませんでした。もう一度お試しください。", // 【仮】
  reasons: {
    not_found: "このクロスワードのヒントは差し替えられません。", // この画面は組み直しでなく差し替えなので、作る画面の言葉から変えた（2026-10-21 レビューの指摘）
    too_many: "更新が集中しています。時間をおいてもう一度お試しください。",
  } as Record<string, string>,
};

const dirLabel = (d: "horizontal" | "vertical") => (d === "horizontal" ? "ヨコ" : "タテ");
const hintLabel = (h: HintRef) => (h.kind === "youtube" ? `YouTube ${formatTime(h.startSec)}` : h.url);
const sameHint = (a: HintRef | undefined, b: HintRef | undefined) => {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "youtube" && b.kind === "youtube") return a.videoId === b.videoId && a.startSec === b.startSec;
  if (a.kind === "link" && b.kind === "link") return a.url === b.url;
  return false;
};

interface Row {
  key: string; // "向き:番号"（受付係に渡す鍵）
  clueIndex: number;
  direction: "horizontal" | "vertical";
  clue: string;
  answer: string;
  stored?: HintRef;
}

// 文字は16px（iPhone は16pxより小さい入力欄を押すと画面を拡大するため。作る画面と同じ）
const inputClass =
  "w-full bg-surface-container-low px-3 py-2 text-base text-on-surface placeholder:text-outline focus:outline-none focus:bg-white focus:shadow-[inset_0_-2px_0_#000]";

export default function HintsEditPage() {
  const { id = "" } = useParams();
  const mine: MyPuzzle | undefined = useMemo(() => readMyPuzzles().find((m) => m.id === id), [id]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  // 「① 探す」所の選択と言葉は全部の語の欄で1つを使う（作る画面と同じ。Hop 決定 2026-10-22）。言葉といつごろはこの画面を開いている間だけ、グループの選択はブラウザに覚える
  const hintSearch = useHintSearch();
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState<Genre>("hello");
  const [rows, setRows] = useState<Row[]>([]);
  const [hints, setHints] = useState<Record<string, HintRef | null>>({});
  const [saving, setSaving] = useState(false);
  usePageReady(status !== "loading");

  useEffect(() => {
    let alive = true;
    if (!mine) {
      setError(T.notMine);
      setStatus("error");
      return;
    }
    fetchOwnedPuzzle(mine.id, mine.key)
      .then((owned) => {
        if (!alive) return;
        if (!owned) {
          setError(T.notFound);
          setStatus("error");
          return;
        }
        const clues = owned.puzzle.body?.clues;
        if (!Array.isArray(clues) || clues.length !== owned.answers.length) {
          setError(T.loadFailed);
          setStatus("error");
          return;
        }
        const next: Row[] = clues.map((c, i) => ({
          key: `${c.direction}:${c.clueIndex}`,
          clueIndex: c.clueIndex,
          direction: c.direction,
          clue: c.clue,
          answer: owned.answers[i].join(""),
          stored: c.hint,
        }));
        setTitle(owned.puzzle.title);
        setGenre(owned.puzzle.genre);
        setRows(next);
        setHints(Object.fromEntries(next.map((r) => [r.key, r.stored ?? null])));
        setStatus("ready");
      })
      .catch((err) => {
        console.error("Failed to load own puzzle:", err);
        if (!alive) return;
        setError(T.loadFailed);
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [mine]);

  const missing = rows.filter((r) => !hints[r.key]).length;
  const changed = rows.filter((r) => hints[r.key] && !sameHint(hints[r.key] ?? undefined, r.stored));
  const canSave = status === "ready" && !saving && missing === 0 && changed.length > 0;
  const reason = missing > 0 ? T.missing(missing) : changed.length === 0 ? T.noChange : "";

  const handleSave = async () => {
    if (!mine || !canSave) return;
    setSaving(true);
    try {
      // 送る直前に、替える YouTube のヒントへ outside の印を台帳で確かめて付け直す（作る画面の共有と同じ。Hop 決定 2026-10-21 チャンネル名を出さない）。
      // 保存してあった動画と同じ番号なら印を引き継ぐ（時刻だけ替えた時に、台帳から消えた動画の印を消さないため）。台帳を確かめられなければ投げて送らない。
      // 画面の中だけの印（gone など）はここで落ちる
      const payload = await withOutsideMarks(
        Object.fromEntries(changed.map((r) => [r.key, hints[r.key]!])),
        rows.map((r) => r.stored),
      );
      await updatePuzzleHints(mine.id, mine.key, payload);
      setRows((prev) => prev.map((r) => (payload[r.key] ? { ...r, stored: payload[r.key] } : r)));
      toast.success(T.saved);
    } catch (err) {
      console.error("Failed to update hints:", err);
      const r = err instanceof SaveError ? err.reason : "";
      toast.error(T.reasons[r] ?? T.failed, { duration: 5000 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Toaster />
      <div className="min-h-screen bg-surface">
        <main className="max-w-2xl mx-auto px-4 py-8 pb-24">
          <div className="flex items-center gap-3 mb-2">
            <Link to="/crossword/mine" className="p-1.5 hover:bg-surface-container-high transition-colors" style={{ color: C.ink }} title={T.back} aria-label={T.back}>
              <Icon icon="chevron_left" />
            </Link>
            <h1 className="text-2xl font-bold" style={{ color: C.ink }}>{T.title}</h1>
          </div>
          <p className="text-sm mb-6 pl-11" style={{ color: C.secondary }}>{T.lead}</p>

          <div className="bg-white p-6" data-hints-edit="">
            {status === "loading" && <p className="text-sm py-8 text-center" style={{ color: C.secondary }}>読み込み中…</p>}
            {status === "error" && <p className="text-sm py-8 text-center" style={{ color: C.secondary }}>{error}</p>}
            {status === "ready" && (
              <>
                <h2 className="text-base font-semibold mb-4" style={{ color: C.ink }}>{title}</h2>
                <ul className="space-y-6">
                  {rows.map((r) => (
                    <li key={r.key} data-hints-row={r.key}>
                      <p className="text-sm mb-2" style={{ color: C.ink }}>
                        <span className="font-bold mr-2">{r.clueIndex}</span>
                        <span className="mr-2" style={{ color: C.secondary }}>{dirLabel(r.direction)}</span>
                        <span className="font-bold mr-2">{r.answer}</span>
                        <span style={{ color: C.secondary }}>{r.clue}</span>
                      </p>
                      <HintField
                        inputId={`hint-${r.key}`}
                        genre={genre}
                        resetKey={0}
                        inputClassName={inputClass}
                        initial={r.stored ? ({ hint: r.stored, label: hintLabel(r.stored) } as Selected) : null}
                        onChange={(h) => setHints((prev) => (prev[r.key] === h ? prev : { ...prev, [r.key]: h }))}
                        search={hintSearch}
                      />
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!canSave}
                    className="w-full py-3 font-bold transition-opacity disabled:opacity-40"
                    style={{ background: C.black, color: C.white }}
                  >
                    {saving ? T.saving : T.save}
                  </button>
                  {reason && (
                    <p className="text-xs mt-2" style={{ color: C.secondary }}>{reason}</p>
                  )}
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
