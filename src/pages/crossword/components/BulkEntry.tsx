// 作る画面の「まとめて入れる」（Hop 決定 2026-10-18）。
// 行を何行でも貼り、出題する語を作る人が【語】【語｜読み】で囲む（なぞって「ここを出す」でもよい）→ 盤に収まる組み合わせを
// 機械が探して上位3つを出す → 選んだ盤で一覧に入れる。語の切り出し・読みの下書きは機械がしない（作る人が決める）。
// データの正本は textarea の文字列1本だけ。並べた行・候補はそこから毎回計算する（下書きに残すのも文字列だけで済むように）。
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { PlacedItem, PuzzleItem } from "../../../lib/crossword/types";
import { isUsableCell, toCells, UNUSABLE_KANA } from "../../../lib/crossword/cells";
import { buildGrid } from "../../../lib/crossword/engine";
import { createBulkSearch, type BulkProposal } from "../../../lib/crossword/bulkSelect";
import { FitGrid } from "./FitGrid";
import { PuzzleGridRetro } from "./PuzzleGridRetro";
import { C } from "../style";

// 答えの字数の上限と、一覧＋候補の語数の上限（指示書 2026-10-18）
const MAX_CELLS = 20;
const MAX_WORDS = 60;
// 探す処理を1回に回す長さ。作る画面の組み立てと同じ刻み方にして、画面を固めない
const STEP_MS = 30;

export interface BulkTexts {
  heading: string;
  guide: string;
  textLabel: string;
  markHere: string;
  markSelected: (word: string) => string;
  insertBrackets: string;
  insertBracketsLabel: string;
  insertBar: string;
  insertBarLabel: string;
  reading: string;
  readingOf: (word: string) => string;
  unmark: (word: string) => string;
  selectMark: (word: string) => string;
  unmarkShort: string;
  candidates: string;
  search: (n: number) => string;
  searching: (n: number) => string;
  stats: (words: number, cells: number, crossings: number) => string;
  leftOut: (words: string[]) => string;
  proposal: (n: number) => string;
  noProposal: string;
  adopt: string;
  reasons: Record<ReasonKey, string>;
}

export type ReasonKey = "noReading" | "badReading" | "unusable" | "tooLong" | "inList" | "duplicate" | "tooMany";

export interface Mark {
  surface: string; // 囲んだ表記
  reading: string | null; // ｜の後ろ（無ければ null）
  start: number; // 文字列の中の【の位置
  end: number; // 】の次の位置
  line: number; // 何行目か（0から）
}

export interface Candidate {
  mark: Mark;
  cells: string[];
  key: string; // 答えの字を並べた物。重なりの見分けに使う
  reason: ReasonKey | null; // null なら通った
}

// 半角の | も受け付ける（書き戻す時だけ全角にそろえる。打っている途中に書き換えると変換中の字が崩れるため）
const MARK_RE = /【([^【】｜|\n]+)(?:[｜|]([^【】\n]*))?】/g;

export const parseMarks = (text: string): Mark[] => {
  const marks: Mark[] = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (pos: number) => {
    let l = 0;
    while (l + 1 < lineStarts.length && lineStarts[l + 1] <= pos) l++;
    return l;
  };
  for (const m of text.matchAll(MARK_RE)) {
    const start = m.index ?? 0;
    marks.push({ surface: m[1], reading: m[2] ?? null, start, end: start + m[0].length, line: lineOf(start) });
  }
  return marks;
};

const fullWidthBars = (text: string) => text.replace(/【[^【】\n]*】/g, (m) => m.replace(/\|/g, "｜"));

// 印の書き方（読みが空なら ｜ ごと付けない）
const markText = (surface: string, reading: string | null) => (reading ? `【${surface}｜${reading}】` : `【${surface}】`);

// 各候補を「リストに追加」と同じ道具（toCells・UNUSABLE_KANA・isUsableCell）で確かめる
export const evaluateCandidates = (marks: Mark[], editorItems: PuzzleItem[]): Candidate[] => {
  const listKeys = new Set(editorItems.map((i) => i.answer.join("")));
  const seen = new Set<string>();
  let ok = 0;
  const out: Candidate[] = [];
  for (const mark of marks) {
    const hasReading = !!mark.reading && mark.reading.trim() !== "";
    const src = hasReading ? mark.reading!.trim() : mark.surface.trim();
    if (!src) continue;
    const cells = toCells(src);
    const key = cells.join("");
    let reason: ReasonKey | null = null;
    if (cells.some((c) => UNUSABLE_KANA.test(c))) reason = "unusable";
    else if (!cells.every(isUsableCell)) reason = hasReading ? "badReading" : "noReading";
    else if (cells.length > MAX_CELLS) reason = "tooLong";
    else if (listKeys.has(key)) reason = "inList";
    else if (seen.has(key)) reason = "duplicate";
    else if (editorItems.length + ok >= MAX_WORDS) reason = "tooMany";
    if (!reason) {
      seen.add(key);
      ok++;
    }
    out.push({ mark, cells, key, reason });
  }
  return out;
};

// カギの下書き: その語の印がある行の、その印だけを答えの字数ぶんの○にし、ほかの印は表記だけ残す
export const clueDraft = (text: string, marks: Mark[], target: Mark, answerLength: number): string => {
  const lines = text.split("\n");
  let lineStart = 0;
  for (let i = 0; i < target.line; i++) lineStart += lines[i].length + 1;
  const lineEnd = lineStart + lines[target.line].length;
  let out = "";
  let pos = lineStart;
  for (const m of marks) {
    if (m.line !== target.line) continue;
    out += text.slice(pos, m.start);
    out += m === target || (m.start === target.start && m.end === target.end) ? "○".repeat(answerLength) : m.surface;
    pos = m.end;
  }
  out += text.slice(pos, lineEnd);
  return out.trim();
};

// 読みの付いた印の 答え→表記（一覧の行に「（表記）」を添えるため。PuzzleItem には足さない）
export const surfaceByAnswer = (text: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const m of parseMarks(text)) {
    if (!m.reading || !m.reading.trim()) continue;
    const key = toCells(m.reading.trim()).join("");
    if (!map.has(key)) map.set(key, m.surface.trim());
  }
  return map;
};

const newId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch {
      /* 下の作り方で作る */
    }
  }
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
};

// 並べた行の中の、なぞった範囲を文字列の位置に直す。同じ地の文の中（印をまたがない・行をまたがない）だけを受け付ける
const selectionRange = (root: HTMLElement | null): { start: number; end: number } | null => {
  if (!root) return null;
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const segOf = (node: Node | null) => {
    const el = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : null;
    return el && root.contains(el) && el.dataset.segStart !== undefined ? el : null;
  };
  const a = segOf(sel.anchorNode);
  const f = segOf(sel.focusNode);
  if (!a || !f || a !== f) return null;
  const base = Number(a.dataset.segStart);
  const s = Math.min(sel.anchorOffset, sel.focusOffset);
  const e = Math.max(sel.anchorOffset, sel.focusOffset);
  return { start: base + s, end: base + e };
};

export const BulkEntry: React.FC<{
  text: string;
  onText: (v: string) => void;
  editorItems: PuzzleItem[];
  t: BulkTexts;
  textareaClassName: string;
  /** 選んだ盤で進む。items は新しい一覧（既存の語は id・カギをそのまま）、pins は選んだ盤の並び */
  onAdopt: (items: PuzzleItem[], pins: PlacedItem[]) => void;
}> = ({ text, onText, editorItems, t, textareaClassName, onAdopt }) => {
  const linesRef = useRef<HTMLDivElement>(null);
  const proposalsRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // なぞっている範囲。ボタンの文字に出す・押した時に選択が消える端末の控えにする（文字列が変わったら捨てる）
  const [sel, setSel] = useState<{ start: number; end: number; text: string } | null>(null);
  // 最後に触った行（なぞった・読みの欄を押した・行をタップした）。この行だけ元の大きさで、他は小さく薄くする（Hop 2026-10-19「フォーカス当たってる行以外小さく」）
  const [active, setActive] = useState<number | null>(null);
  // 押した囲みの語（位置で覚える）。下の帯に「語・読みの欄・外す」を出す（Hop 2026-10-19 案A）
  const [selMark, setSelMark] = useState<number | null>(null);
  const readingBoxRef = useRef<HTMLInputElement>(null);
  const lineOf = (pos: number) => text.slice(0, pos).split("\n").length - 1;
  // 候補の id は答えごとに固定する（描き直すたびに変わると、探した結果と結びつかなくなるため）
  const idByKey = useRef(new Map<string, string>());

  const marks = useMemo(() => parseMarks(text), [text]);
  const candidates = useMemo(() => evaluateCandidates(marks, editorItems), [marks, editorItems]);
  const passed = candidates.filter((c) => !c.reason);
  const pool: PuzzleItem[] = useMemo(() => {
    const fresh = passed.map((c) => {
      let id = idByKey.current.get(c.key);
      if (!id) {
        id = newId();
        idByKey.current.set(c.key, id);
      }
      return { id, question: "", answer: c.cells };
    });
    return [...editorItems, ...fresh];
  }, [passed.map((c) => c.key).join("|"), editorItems]); // eslint-disable-line react-hooks/exhaustive-deps
  const poolKey = pool.map((i) => `${i.id}:${i.answer.join("")}`).join("|");

  const [searching, setSearching] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [result, setResult] = useState<{ key: string; proposals: BulkProposal[] } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const runRef = useRef(0);

  // 画面を離れたら探すのをやめる
  useEffect(() => () => void runRef.current++, []);

  useEffect(() => {
    const onSel = () => {
      const r = selectionRange(linesRef.current);
      // 行の外を押しただけでは消さない（ボタンを押す時に選択が消える端末のため）。選択が無くなったのは次の書き換えで捨てる
      if (r) {
        setSel({ ...r, text });
        setActive(lineOf(r.start));
        setSelMark(null);
      }
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [text]);

  // 提案の小さな盤は右の盤と同じ部品なので、マスの id が重なる。小さな盤の id は外す（右の盤の操作と読み上げを乱さないため）
  useLayoutEffect(() => {
    proposalsRef.current?.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  });

  // 画面の操作で文字列を書き換える時は、印の中の半角 | も全角にそろえる
  const write = (next: string) => {
    setSel(null);
    onText(fullWidthBars(next));
  };

  // 範囲を囲める形に整える（前後の空白を落とす・印や改行を含む範囲・すでに囲んだ所と重なる範囲は囲めない）
  const pickable = (r: { start: number; end: number } | null) => {
    if (!r) return null;
    let { start, end } = r;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    const picked = text.slice(start, end);
    if (!picked || /[【】｜|\n]/.test(picked)) return null;
    if (marks.some((m) => start < m.end && end > m.start)) return null;
    return { start, end, picked };
  };
  // 読みが要るのに無い（または読みがカナでない）語の位置
  const needsReading = useMemo(
    () => new Set(candidates.filter((c) => c.reason === "noReading" || c.reason === "badReading").map((c) => c.mark.start)),
    [candidates]
  );
  const selected = selMark === null ? null : (marks.find((m) => m.start === selMark) ?? null);
  // 押した語の読みの欄に入る（帯に出た直後）
  useEffect(() => {
    if (selected) readingBoxRef.current?.focus();
  }, [selMark]); // eslint-disable-line react-hooks/exhaustive-deps
  // 今なぞっている範囲（控えは同じ文字列の時だけ使う）
  const current = pickable(sel && sel.text === text ? sel : null);

  const markHere = () => {
    const live = pickable(selectionRange(linesRef.current)) ?? current;
    if (!live) return;
    write(text.slice(0, live.start) + `【${live.picked}】` + text.slice(live.end));
    window.getSelection()?.removeAllRanges();
  };

  // 入力欄に印を入れる。欄で文字を選んでいれば【 】で囲み、選んでいなければ【】を入れてその間にカーソルを置く。｜はカーソルの位置に入れる
  const insert = (kind: "brackets" | "bar") => {
    const area = areaRef.current;
    if (!area) return;
    const s = area.selectionStart ?? text.length;
    const e = area.selectionEnd ?? s;
    let next: string;
    let caret: number;
    if (kind === "bar") {
      next = text.slice(0, s) + "｜" + text.slice(e);
      caret = s + 1;
    } else {
      const p = s < e ? pickable({ start: s, end: e }) : null;
      if (p) {
        next = text.slice(0, p.start) + `【${p.picked}】` + text.slice(p.end);
        caret = p.end + 2;
      } else {
        next = text.slice(0, s) + "【】" + text.slice(e);
        caret = s + 1;
      }
    }
    write(next);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(caret, caret);
    });
  };
  const keepFocus = { onPointerDown: (e: React.PointerEvent) => e.preventDefault(), onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

  const unmark = (m: Mark) => write(text.slice(0, m.start) + m.surface + text.slice(m.end));
  const setReading = (m: Mark, reading: string) => write(text.slice(0, m.start) + markText(m.surface, reading || null) + text.slice(m.end));

  const startSearch = () => {
    const run = ++runRef.current;
    const key = poolKey;
    const search = createBulkSearch(pool);
    setSearching(true);
    setAttempts(0);
    setResult(null);
    setPicked(null);
    const tick = () => {
      if (runRef.current !== run) return;
      search.step(STEP_MS);
      setAttempts(search.attempts());
      if (search.finished()) {
        setResult({ key, proposals: search.proposals() });
        setSearching(false);
        return;
      }
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  };

  // 語が変わった提案は出さない（選んだ時に一覧と食い違わないように）
  const proposals = result && result.key === poolKey ? result.proposals : null;

  const adopt = () => {
    if (!proposals || picked === null || !proposals[picked]) return;
    const p = proposals[picked];
    const placedIds = new Set(p.placed.map((x) => x.id));
    const byKey = new Map(passed.map((c) => [c.key, c]));
    const kept = editorItems.filter((i) => placedIds.has(i.id));
    const keptIds = new Set(kept.map((i) => i.id));
    const fresh: PuzzleItem[] = p.placed
      .filter((x) => !keptIds.has(x.id))
      .map((x) => {
        const c = byKey.get(x.answer.join(""));
        return { id: x.id, question: c ? clueDraft(text, marks, c.mark, x.answer.length) : "", answer: x.answer };
      });
    const items = [...kept, ...fresh];
    const byId = new Map(items.map((i) => [i.id, i]));
    const pins: PlacedItem[] = p.placed.map((x) => ({ ...x, question: byId.get(x.id)?.question ?? x.question, pinned: true }));
    runRef.current++;
    setResult(null);
    setPicked(null);
    onAdopt(items, pins);
  };

  // 並べた行（文字列から描く）。地の文は位置の印を持つ span、囲んだ語は押すと外れるボタン＋読みの欄
  const lines = useMemo(() => {
    const out: { line: number; parts: ({ kind: "text"; start: number; value: string } | { kind: "mark"; mark: Mark; index: number })[] }[] = [];
    const raw = text.split("\n");
    let offset = 0;
    let mi = 0;
    raw.forEach((l, line) => {
      const parts: (typeof out)[number]["parts"] = [];
      let pos = offset;
      const end = offset + l.length;
      while (mi < marks.length && marks[mi].start < end) {
        const m = marks[mi];
        if (m.start > pos) parts.push({ kind: "text", start: pos, value: text.slice(pos, m.start) });
        parts.push({ kind: "mark", mark: m, index: mi });
        pos = m.end;
        mi++;
      }
      if (end > pos) parts.push({ kind: "text", start: pos, value: text.slice(pos, end) });
      if (l.trim()) out.push({ line, parts });
      offset = end + 1;
    });
    return out;
  }, [text, marks]);

  const label = "text-xs font-mono font-bold";

  return (
    <section data-bulk="" className="space-y-3" aria-labelledby="cw-bulk-heading">
      <h3 id="cw-bulk-heading" className={label} style={{ color: C.secondary }}>
        {t.heading}
      </h3>
      <p id="cw-bulk-guide" className="text-xs" style={{ color: C.secondary }}>
        {t.guide}
      </p>
      {/* 印を入れるボタン（Hop 2026-10-18「【】と|を入れる用のボタンが欲しい」。欄の真上・右寄せ） */}
      <div className="flex justify-end gap-2 -mb-1">
        <button
          type="button"
          data-bulk-insert="brackets"
          {...keepFocus}
          onClick={() => insert("brackets")}
          aria-label={t.insertBracketsLabel}
          className="px-3 min-h-10 font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors"
          style={{ color: C.ink }}
        >
          {t.insertBrackets}
        </button>
        <button
          type="button"
          data-bulk-insert="bar"
          {...keepFocus}
          onClick={() => insert("bar")}
          aria-label={t.insertBarLabel}
          className="px-3 min-h-10 font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors"
          style={{ color: C.ink }}
        >
          {t.insertBar}
        </button>
      </div>
      <textarea
        ref={areaRef}
        id="cw-bulk-text"
        data-bulk-text=""
        aria-label={t.textLabel}
        aria-describedby="cw-bulk-guide"
        value={text}
        onChange={(e) => {
          setSel(null);
          setSelMark(null);
          onText(e.target.value);
        }}
        // 半角の | は欄を離れた時に全角へそろえる（打っている途中に書き換えると変換中の字が崩れるため）
        onBlur={() => {
          const next = fullWidthBars(text);
          if (next !== text) onText(next);
        }}
        rows={4}
        className={`${textareaClassName} resize-y min-h-[6rem]`}
      />

      {lines.length > 0 && (
        <div className="space-y-2">
          <div ref={linesRef} data-bulk-lines="" className="bg-surface-container-low p-3 space-y-3 leading-loose break-words">
            {lines.map(({ line, parts }) => {
              const on = active === null || active === line;
              return (
                <div
                  key={line}
                  data-bulk-line={line}
                  data-bulk-active={on ? "" : undefined}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest("[data-bulk-mark]")) return;
                    setActive(line);
                    setSelMark(null);
                  }}
                  className={on ? "text-base leading-loose" : "text-[10px] leading-normal"}
                  style={{ color: on ? C.ink : C.secondary }}
                >
                  {parts.map((p) =>
                    p.kind === "text" ? (
                      <span key={`t${p.start}`} data-seg-start={p.start}>
                        {p.value}
                      </span>
                    ) : (
                      // 囲んだ語は下線だけ（箱にしない）。読みはルビで上に。読みが要るのに無い語は点線。押すと下の帯に読みの欄と「外す」が出る
                      <button
                        key={`m${p.index}`}
                        type="button"
                        data-bulk-mark={p.mark.surface}
                        data-bulk-mark-selected={selMark === p.mark.start ? "" : undefined}
                        onClick={() => {
                          setActive(line);
                          setSelMark(p.mark.start);
                        }}
                        aria-label={t.selectMark(p.mark.surface)}
                        className={`inline font-bold p-0 mx-0.5 border-b-2 ${needsReading.has(p.mark.start) ? "border-dashed" : "border-solid"} border-current ${selMark === p.mark.start ? "bg-surface-container-high" : "bg-transparent"}`}
                        style={{ color: "inherit", lineHeight: "inherit" }}
                      >
                        {p.mark.reading && on ? (
                          <ruby>
                            {p.mark.surface}
                            <rt className="text-[10px] font-normal" style={{ color: C.secondary }}>
                              {p.mark.reading}
                            </rt>
                          </ruby>
                        ) : (
                          p.mark.surface
                        )}
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 画面の下に貼り付く帯（Hop 2026-10-18 案a）。長押しのメニューから離し、なぞった文字をボタンに出す。なぞっていない時は押せない */}
      {lines.length > 0 && (
        <div
          data-bulk-markbar=""
          className="sticky bottom-0 z-10 bg-white py-2"
          style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }}
        >
          {selected && !current ? (
            <div data-bulk-readingbar="" className="flex items-stretch gap-2">
              <span className="self-center font-bold whitespace-nowrap max-w-[8em] truncate" style={{ color: C.ink }}>
                {selected.surface}
              </span>
              {/* 文字は16px（iPhone は16pxより小さい入力欄を押すと画面を拡大するため） */}
              <input
                ref={readingBoxRef}
                value={selected.reading ?? ""}
                onChange={(e) => setReading(selected, e.target.value)}
                placeholder={t.reading}
                aria-label={t.readingOf(selected.surface)}
                className="flex-1 min-w-0 h-10 bg-surface-container-low px-2 text-base leading-normal placeholder:text-outline focus:outline-none focus:shadow-[inset_0_-2px_0_#000]"
                style={{ color: C.ink }}
              />
              <button
                type="button"
                onClick={() => {
                  unmark(selected);
                  setSelMark(null);
                }}
                aria-label={t.unmark(selected.surface)}
                className="px-4 min-h-10 font-semibold bg-surface-container-high hover:bg-surface-container-highest transition-colors"
                style={{ color: C.ink }}
              >
                {t.unmarkShort}
              </button>
            </div>
          ) : (
            <button
              type="button"
              {...keepFocus}
              onClick={markHere}
              disabled={!current}
              className="w-full px-4 min-h-10 font-semibold bg-surface-container-high hover:bg-surface-container-highest transition-colors disabled:hover:bg-surface-container-high truncate"
              style={{ color: current ? C.ink : C.secondary }}
            >
              {current ? t.markSelected(current.picked.length > 12 ? `${current.picked.slice(0, 12)}…` : current.picked) : t.markHere}
            </button>
          )}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="space-y-1">
          <div className={label} style={{ color: C.secondary }}>
            {t.candidates}
          </div>
          <ul data-bulk-candidates="" className="bg-surface-container-low p-2 space-y-1 max-h-60 overflow-y-auto">
            {candidates.map((c, i) => (
              <li key={`${c.mark.start}-${i}`} data-bulk-candidate={c.reason ? "ng" : "ok"} className="px-1 py-0.5" style={c.reason ? { color: C.secondary } : undefined}>
                <div className="font-mono text-sm font-bold truncate" style={{ color: C.ink }}>
                  {c.reason === "noReading" || c.reason === "badReading" ? c.mark.surface : c.cells.join(" ")}
                  {c.mark.reading && c.reason !== "badReading" && (
                    <span className="text-xs font-normal ml-1" style={{ color: C.secondary }}>
                      （{c.mark.surface}）
                    </span>
                  )}
                </div>
                {c.reason && (
                  <div data-bulk-reason={c.reason} className="text-xs" style={{ color: C.secondary }}>
                    {t.reasons[c.reason]}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {passed.length > 0 && (
        <button
          type="button"
          data-bulk-search=""
          onClick={startSearch}
          disabled={searching}
          className="w-full px-4 py-2 font-semibold bg-primary text-white hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {t.search(pool.length)}
        </button>
      )}
      {searching && (
        <p data-bulk-progress="" className="text-xs font-mono" style={{ color: C.secondary }} aria-live="polite">
          {t.searching(attempts)}
        </p>
      )}

      {proposals && !searching && (
        <div className="space-y-2">
          {proposals.length === 0 && (
            <p className="text-xs" style={{ color: C.secondary }}>
              {t.noProposal}
            </p>
          )}
          <div ref={proposalsRef} className="space-y-2">
            {proposals.map((p, i) => (
              <ProposalCard key={i} index={i} proposal={p} selected={picked === i} onPick={() => setPicked(i)} t={t} />
            ))}
          </div>
          {proposals.length > 0 && (
            <button
              type="button"
              data-bulk-adopt=""
              onClick={adopt}
              disabled={picked === null}
              className="w-full px-4 py-2 font-semibold bg-primary text-white hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t.adopt}
            </button>
          )}
        </div>
      )}
    </section>
  );
};

const ProposalCard: React.FC<{ index: number; proposal: BulkProposal; selected: boolean; onPick: () => void; t: BulkTexts }> = ({
  index,
  proposal,
  selected,
  onPick,
  t,
}) => {
  const grid = useMemo(() => buildGrid(proposal.placed), [proposal]);
  return (
    <div
      data-bulk-proposal={index}
      data-width={proposal.width}
      data-height={proposal.height}
      onClick={onPick}
      className={`p-3 space-y-2 cursor-pointer ${selected ? "bg-white border-b-2 border-black" : "bg-surface-container-low border-b-2 border-transparent"}`}
    >
      {/* overflow-hidden: FitGrid が幅を測って縮めるまでの一瞬、盤が実寸で出て画面幅を押し広げないように */}
      <div aria-hidden="true" className="max-w-[240px] mx-auto pointer-events-none overflow-hidden">
        <FitGrid width={grid.width} height={grid.height}>
          <PuzzleGridRetro data={grid} showSolution={true} />
        </FitGrid>
      </div>
      <button
        type="button"
        aria-pressed={selected}
        onClick={(e) => {
          e.stopPropagation();
          onPick();
        }}
        className="w-full text-left text-sm font-bold hover:text-black transition-colors"
        style={{ color: selected ? C.black : C.ink }}
      >
        <span className="mr-2" style={{ color: C.secondary }}>
          {t.proposal(index + 1)}
        </span>
        <span data-bulk-stats="">{t.stats(proposal.placed.length, proposal.cells, proposal.crossings)}</span>
      </button>
      {proposal.leftOut.length > 0 && (
        <div data-bulk-leftout="" className="text-xs" style={{ color: C.secondary }}>
          {t.leftOut(proposal.leftOut.map((i) => i.answer.join("")))}
        </div>
      )}
    </div>
  );
};
