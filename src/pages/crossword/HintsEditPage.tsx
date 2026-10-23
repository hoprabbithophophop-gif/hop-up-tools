// ヒントだけを差し替える画面（/crossword/hints/<番号>）。Hop 決定 2026-10-19「遊ばれた後でも、本人がヒントだけは差し替えられるように」。
// 組み直し（/crossword/create?edit=）は遊ばれる前だけ。ヒントは答えにもランキングにも触れないので、この画面は遊ばれた後でも使える。
// 本文は送らない。「どのカギのヒントを何に替えるか」だけを受付係（/api/crossword-update-hints）に渡し、受付係が棚の本文のヒント部分だけを入れ替える。
// 入れるのは、この端末に合言葉が残っている問題だけ（自分が作った問題と同じ）。
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { usePageReady } from "../../lib/pageReady";
import { fetchOwnedPuzzle, readMyPuzzles, updatePuzzleHints, withOutsideMarks, SaveError, type Genre, type HintRef, type MyPuzzle } from "../../lib/crossword/puzzleStore";
import { formatTime } from "../../lib/crossword/youtubeUrl";
import { toCells } from "../../lib/crossword/cells";
import { HintField, type Selected } from "./components/HintField";
import { useHintSearch } from "./components/hintSearch";
import { Toaster, toast } from "./components/Toast";
import { Icon } from "./components/ui";
import { C } from "./style";

const T = {
  title: "ヒントを直す", // 【仮】
  back: "自分が作った問題へ戻る", // 【仮】
  lead: "答えとカギの文はそのまま、ヒントだけ差し替えられます。遊ばれた後でも使えます。", // 【仮】
  notMine: "この端末にはこの問題の合言葉がありません。", // 【仮】
  notFound: "この問題は見つからないか、非表示になっています。", // 【仮】
  loadFailed: "読み込めませんでした。時間をおいてもう一度お試しください。", // 【仮】
  save: "ヒントを更新する", // 【仮】
  saving: "更新中…",
  saved: "ヒントを更新しました。", // 【仮】
  noChange: "変えたヒントがありません。", // 【仮】
  missing: (n: number) => `ヒントがあと${n}つ`, // 作る画面の共有ボタンと同じ言い回し
  failed: "更新できませんでした。もう一度お試しください。", // 【仮】
  // 組み直しの「更新する」の間に遊ばれて、この画面へ回ってきた時（Hop 決定 2026-10-23「直したヒントを引き継ぐ」）
  carriedLocked: "遊ばれた後は、答えとカギは変えられません。", // Hop 決定 2026-10-23
  carriedLabel: "組み直しで直した答えとカギ", // コピーの欄の名前【仮】
  copy: "コピー", // 作る画面の共有リンクの「コピー」と同じ語
  carriedHint: "組み直しで直したヒントを入れてあります。「ヒントを更新する」を押すと反映されます。", // 欄の上に出す（Hop 決定 2026-10-23）
  reasons: {
    not_found: "この問題のヒントは差し替えられません。", // この画面は組み直しでなく差し替えなので、作る画面の言葉から変えた（2026-10-21 レビューの指摘）
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

// 組み直しの画面から渡される、直した中身（画面の移動に持たせる。作りかけの控えとは別。Hop 決定 2026-10-23）
export interface EditCarry {
  kind: "edit-carry";
  id: string;
  items: { answer: string; clue: string; hint: HintRef | null }[];
}
const readCarry = (state: unknown, id: string): EditCarry | null => {
  const c = state as Partial<EditCarry> | null;
  if (!c || c.kind !== "edit-carry" || c.id !== id || !Array.isArray(c.items)) return null;
  const items = c.items.filter(
    (i): i is EditCarry["items"][number] =>
      !!i && typeof i.answer === "string" && typeof i.clue === "string" && (i.hint === null || (typeof i.hint === "object" && (i.hint.kind === "youtube" ? typeof i.hint.videoId === "string" && typeof i.hint.startSec === "number" : i.hint.kind === "link" && typeof i.hint.url === "string")))
  );
  return { kind: "edit-carry", id, items };
};
const NL = "\n"; // コピーの欄の改行
const answerKey = (s: string) => toCells(s).join("");
// コピーの欄のヒントの行き先（YouTube は開始の秒つき）
const hintUrl = (h: HintRef) => (h.kind === "youtube" ? `https://youtu.be/${h.videoId}?t=${Math.max(0, Math.floor(h.startSec))}` : h.url);

interface Row {
  key: string; // "向き:番号"（受付係に渡す鍵）
  clueIndex: number;
  direction: "horizontal" | "vertical";
  clue: string;
  answer: string;
  stored?: HintRef;
  // 組み直しから引き継いだヒント（欄に最初から入れておく物）
  initial?: HintRef;
}

// 文字は16px（iPhone は16pxより小さい入力欄を押すと画面を拡大するため。作る画面と同じ）
const inputClass =
  "w-full bg-surface-container-low px-3 py-2 text-base text-on-surface placeholder:text-outline focus:outline-none focus:bg-white focus:shadow-[inset_0_-2px_0_#000]";

export default function HintsEditPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  // 組み直しから回ってきた時に渡された中身（開いた時の1回だけ読む）
  const [carry] = useState(() => readCarry(location.state, id));
  // 問題に入れられない直し（答えとカギ）。コピーの欄に出す
  const [carriedText, setCarriedText] = useState("");
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
        // 組み直しで直したヒントは、この画面にある答えの物だけを欄に入れる（保存はまだしない。持ち主が「ヒントを更新する」を押す）。
        // この画面に無い答え・直したカギは、コピーの欄に回す
        const carried = new Map((carry?.items ?? []).map((i) => [answerKey(i.answer), i]));
        setHints(Object.fromEntries(next.map((r) => [r.key, carried.get(answerKey(r.answer))?.hint ?? r.stored ?? null])));
        if (carry) {
          const onPage = new Map(next.map((r) => [answerKey(r.answer), r]));
          const lines: string[] = [];
          for (const i of carry.items) {
            const row = onPage.get(answerKey(i.answer));
            if (row && row.clue === i.clue) continue;
            // 1行の形は作る画面の書く欄と同じ「カギ→【答え】」、ヒントは次の行に「ヒント: 行き先」【仮】
            lines.push(`${i.clue}→【${i.answer}】`);
            if (!row && i.hint) lines.push(`ヒント: ${hintUrl(i.hint)}`);
          }
          setCarriedText(lines.join(NL));
          setRows(next.map((r) => {
            const h = carried.get(answerKey(r.answer))?.hint;
            return h ? { ...r, initial: h } : r;
          }));
        }
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
                {carriedText && (
                  <div data-hints-carried="" className="mb-6">
                    <p className="text-sm mb-2" style={{ color: C.ink }}>{T.carriedLocked}</p>
                    <p id="hints-carried-label" className="text-xs font-semibold mb-1" style={{ color: C.secondary }}>{T.carriedLabel}</p>
                    <div className="flex items-start gap-1">
                      {/* 長い行も折り返して全部見せる（欄の中でスクロールさせない）。押すと全部を選ぶ */}
                      <div id="hints-carried-text" role="textbox" aria-readonly="true" aria-multiline="true" aria-labelledby="hints-carried-label" tabIndex={0} className={`${inputClass} flex-1 min-w-0 whitespace-pre-wrap break-all select-all`} style={{ color: C.ink }}>
                        {carriedText}
                      </div>
                      <button type="button" data-hints-carried-copy="" onClick={() => navigator.clipboard?.writeText(carriedText)} className="w-11 h-11 shrink-0 flex items-center justify-center bg-surface-container-high hover:bg-primary hover:text-white transition-colors" style={{ color: C.ink }} aria-label={T.copy} title={T.copy}>
                        <Icon size={16} icon="content_copy" />
                      </button>
                    </div>
                  </div>
                )}
                <ul className="space-y-6">
                  {rows.map((r) => (
                    <li key={r.key} data-hints-row={r.key}>
                      <p className="text-sm mb-2" style={{ color: C.ink }}>
                        <span className="font-bold mr-2">{r.clueIndex}</span>
                        <span className="mr-2" style={{ color: C.secondary }}>{dirLabel(r.direction)}</span>
                        <span className="font-bold mr-2">{r.answer}</span>
                        <span style={{ color: C.secondary }}>{r.clue}</span>
                      </p>
                      {/* 組み直しから引き継いだヒントが欄に入っていて、まだ反映していない間だけ（保存してあったヒントと同じなら出さない） */}
                      {r.initial && !sameHint(r.initial, r.stored) && sameHint(hints[r.key] ?? undefined, r.initial) && (
                        <p data-hints-carried-hint="" className="text-xs mb-2" style={{ color: C.secondary }}>{T.carriedHint}</p>
                      )}
                      <HintField
                        inputId={`hint-${r.key}`}
                        genre={genre}
                        resetKey={0}
                        inputClassName={inputClass}
                        initial={(r.initial ?? r.stored) ? ({ hint: (r.initial ?? r.stored)!, label: hintLabel((r.initial ?? r.stored)!) } as Selected) : null}
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
