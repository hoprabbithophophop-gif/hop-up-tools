// 作る画面の1の段「まとめて入れる」（Hop 決定 2026-10-18〜10-20）。
// 行を何行でも書き、出題する語を作る人が【語】【語｜読み】で囲む（なぞって「「語」を出す」でもよい）。
// 語の切り出し・読みの下書きは機械がしない（作る人が決める）。
// データの正本は textarea の文字列1本だけ。並べた行・答え・交差できる字はそこから毎回計算する。
// 盤の組み合わせ探しは2の段（作る画面の create/CreatePage.tsx）へ移した（2026-10-20 4段の流れ）。
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { isUsableCell, toCells, UNUSABLE_KANA } from "../../../lib/crossword/cells";
import { C } from "../style";

// 答えの字数の上限と、答えの語数の上限（指示書 2026-10-18）
const MAX_CELLS = 20;
const MAX_WORDS = 60;

export interface BulkTexts {
  guide: string;
  textLabel: string;
  markSelected: (word: string) => string;
  insertBrackets: string;
  insertBracketsLabel: string;
  insertBar: string;
  insertBarLabel: string;
  insertArrow: string;
  insertArrowLabel: string;
  reading: string;
  readingOf: (word: string) => string;
  unmark: (word: string) => string;
  selectMark: (word: string) => string;
  unmarkShort: string;
  decide: string;
  closeBar: string;
  closeBarLabel: string;
  modeWrite: string;
  modeHint: string;
  modeLabel: string;
  linesLabel: string;
  legend: string;
  hinted: string;
  notHinted: string;
  traceTip: string;
  search: (n: number) => string;
  reasonLine: (surface: string, reason: string) => string;
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
  key: string; // 答えの字を並べた物。重なりの見分けと、ヒント・カギの持ち主の印に使う
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

// 各候補を「リストに追加」と同じ道具（toCells・UNUSABLE_KANA・isUsableCell）で確かめる。
// listKeys はもう一覧に入っている答え（4段の流れでは一覧は無いので空で呼ぶ）
export const evaluateCandidates = (marks: Mark[], listKeys: string[] = []): Candidate[] => {
  const inList = new Set(listKeys);
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
    else if (inList.has(key)) reason = "inList";
    else if (seen.has(key)) reason = "duplicate";
    else if (inList.size + ok >= MAX_WORDS) reason = "tooMany";
    if (!reason) {
      seen.add(key);
      ok++;
    }
    out.push({ mark, cells, key, reason });
  }
  return out;
};

// 書いた文字列から、通った答え（同じ答えは最初の1つだけ）を書いた順に出す
export const answersOf = (text: string): Candidate[] => evaluateCandidates(parseMarks(text)).filter((c) => !c.reason);

// カギの下書き: その語の印がある行の、その印だけを答えの字数ぶんの○にし、ほかの印は表記だけ残す
export const clueDraft = (text: string, marks: Mark[], target: Mark, answerLength: number): string => {
  const lines = text.split("\n");
  let lineStart = 0;
  for (let i = 0; i < target.line; i++) lineStart += lines[i].length + 1;
  const lineEnd = lineStart + lines[target.line].length;
  // 行の最後の答えの前に「→」があれば、「→」と答えを消す（「ニャーと鳴く動物→【ネコ】」→「ニャーと鳴く動物」。Hop 決定 2026-10-20）
  if (!text.slice(target.end, lineEnd).trim()) {
    const before = text.slice(lineStart, target.start);
    const arrow = before.search(/→\s*$/);
    if (arrow >= 0) {
      let head = "";
      let at = lineStart;
      for (const m of marks) {
        if (m.line !== target.line || m.start >= lineStart + arrow) continue;
        head += text.slice(at, m.start) + m.surface;
        at = m.end;
      }
      return (head + text.slice(at, lineStart + arrow)).trim();
    }
  }
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

// 交差候補マーキング（本番の intersectionMarks と同じ考え方）: 2つ以上の答えに出てくる字を、答えごとに出てきた順で
export const intersectionMarks = (answers: { key: string; cells: string[] }[]): Map<string, string[]> => {
  const count = new Map<string, number>();
  answers.forEach((a) => new Set(a.cells).forEach((c) => count.set(c, (count.get(c) ?? 0) + 1)));
  const out = new Map<string, string[]>();
  answers.forEach((a) => {
    const chars = [...new Set(a.cells)].filter((c) => (count.get(c) ?? 0) >= 2);
    if (chars.length > 0) out.set(a.key, chars);
  });
  return out;
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

// なぞる動きの見本の長さ（見本 v15 と同じ）
const TRACE_SWEEP_MS = 900;
const TRACE_BAR_AT_MS = 1000;
const TRACE_END_MS = 4500;
const TRACE_STILL_END_MS = 3000;

interface TraceBox {
  left: number;
  top: number;
  width: number;
  height: number;
  word: string;
  still: boolean;
}

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

const keepFocus = { onPointerDown: (e: React.PointerEvent) => e.preventDefault(), onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

export const BulkEntry: React.FC<{
  text: string;
  onText: (v: string) => void;
  t: BulkTexts;
  textareaClassName: string;
  /** 欄を畳んでいるか（畳んだ所は「行を書き足す・直す」のボタン） */
  collapsed: boolean;
  onCollapsed: (v: boolean) => void;
  /** ヒントが付いている答え（答えの字を並べた物） */
  hinted: (key: string) => boolean;
  /** 下線の語を押した（ヒントの窓を開く） */
  onOpenHint: (key: string, surface: string) => void;
  /** ヒントの窓を開いている答え */
  openKey: string | null;
  /** 「組み合わせを探す」 */
  onSearch: () => void;
  /** 一覧の下に出す札（「もう1語足すと…」） */
  tip?: React.ReactNode;
  /** なぞる動きを見せてよいか（この端末で初めての時だけ true） */
  trace: boolean;
  /** なぞる動きを見せ始めた（端末に印を付ける） */
  onTraceShown: () => void;
  /** 窓が開いている間は画面の下の帯を出さない */
  barHidden?: boolean;
}> = ({ text, onText, t, textareaClassName, collapsed, onCollapsed, hinted, onOpenHint, openKey, onSearch, tip, trace, onTraceShown, barHidden }) => {
  const linesRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // なぞっている範囲。ボタンの文字に出す・押した時に選択が消える端末の控えにする（文字列が変わったら捨てる）
  const [sel, setSel] = useState<{ start: number; end: number; text: string } | null>(null);
  // 最後に触った行（なぞった・下線の語を押した・行をタップした）。この行だけ 16px、他は 10px の薄い字で1行に切る（Hop 決定 2026-10-19・10-20）
  const [active, setActive] = useState<number | null>(null);
  // 押した囲みの語（位置で覚える）。読みが要るのに無い語などは、下の帯に「語・読みの欄・決める・外す・×」を出す
  const [selMark, setSelMark] = useState<number | null>(null);
  // 欄の中で選んでいる範囲（ボタンを押す瞬間に選択が消える端末のため、少し待ってから消す）
  const [areaSel, setAreaSel] = useState<{ start: number; end: number; text: string } | null>(null);
  const areaSelTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(areaSelTimer.current), []);
  const [readingDraft, setReadingDraft] = useState("");
  const readingBoxRef = useRef<HTMLInputElement>(null);
  const lineOf = (pos: number) => text.slice(0, pos).split("\n").length - 1;
  // なぞる動きの見本（一度だけ）
  const [traceBox, setTraceBox] = useState<TraceBox | null>(null);
  const [traceSwept, setTraceSwept] = useState(false);
  const [traceBar, setTraceBar] = useState<string | null>(null);
  const traceStartedRef = useRef(false);
  // なぞる字が画面の外にある間は、スクロールのたびに見直す
  const [, setScrollTick] = useState(0);
  useEffect(() => {
    if (!trace) return;
    let raf = 0;
    const onScroll = () => {
      if (traceStartedRef.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setScrollTick((n) => n + 1));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [trace]);

  const marks = useMemo(() => parseMarks(text), [text]);
  const candidates = useMemo(() => evaluateCandidates(marks), [marks]);
  const candByStart = useMemo(() => new Map(candidates.map((c) => [c.mark.start, c])), [candidates]);
  const passed = useMemo(() => candidates.filter((c) => !c.reason), [candidates]);
  const crossChars = useMemo(() => intersectionMarks(passed), [passed]);

  useEffect(() => {
    let clearTimer = 0;
    const onSel = () => {
      // 欄の中の選択（欄の選択は文書の選択に出ないので、欄の選択の位置で見る）
      const area = areaRef.current;
      if (area && document.activeElement === area) {
        window.clearTimeout(areaSelTimer.current);
        if (area.selectionStart < area.selectionEnd) {
          setAreaSel({ start: area.selectionStart, end: area.selectionEnd, text });
          setSelMark(null);
        } else {
          areaSelTimer.current = window.setTimeout(() => setAreaSel(null), 400);
        }
        return;
      }
      const r = selectionRange(linesRef.current);
      window.clearTimeout(clearTimer);
      if (r) {
        setSel({ ...r, text });
        setActive(lineOf(r.start));
        setSelMark(null);
      } else {
        const s = window.getSelection();
        // 選択が無くなった（なぞるのをやめた）ら帯を消す（帯はなぞっている間だけ。Hop 決定 2026-10-20）。
        // ただしボタンを押す瞬間に選択が消える端末があるので、少し待ってから消す
        if (!s || s.isCollapsed) {
          clearTimer = window.setTimeout(() => {
            const now = window.getSelection();
            if (!now || now.isCollapsed) setSel(null);
          }, 400);
        }
      }
    };
    document.addEventListener("selectionchange", onSel);
    return () => {
      window.clearTimeout(clearTimer);
      document.removeEventListener("selectionchange", onSel);
    };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!selected) return;
    setReadingDraft(selected.reading ?? "");
    requestAnimationFrame(() => readingBoxRef.current?.focus());
  }, [selMark]); // eslint-disable-line react-hooks/exhaustive-deps
  // 今なぞっている範囲（控えは同じ文字列の時だけ使う）。欄で文字を選んでいる時もその範囲で帯を出す（Hop 決定 2026-10-20 案C）
  const current = pickable(sel && sel.text === text ? sel : null) ?? pickable(areaSel && areaSel.text === text ? areaSel : null);

  const markHere = () => {
    const live = pickable(selectionRange(linesRef.current)) ?? current;
    if (!live) return;
    setAreaSel(null);
    write(text.slice(0, live.start) + `【${live.picked}】` + text.slice(live.end));
    window.getSelection()?.removeAllRanges();
  };

  // 入力欄に印を入れる。欄で文字を選んでいれば【 】で囲み、選んでいなければ【】を入れてその間にカーソルを置く。｜はカーソルの位置に入れる
  const insert = (kind: "brackets" | "bar" | "arrow") => {
    const area = areaRef.current;
    if (!area) return;
    const s = area.selectionStart ?? text.length;
    const e = area.selectionEnd ?? s;
    let next: string;
    let caret: number;
    if (kind === "bar" || kind === "arrow") {
      next = text.slice(0, s) + (kind === "bar" ? "｜" : "→") + text.slice(e);
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

  const unmark = (m: Mark) => write(text.slice(0, m.start) + m.surface + text.slice(m.end));
  const setReading = (m: Mark, reading: string) => write(text.slice(0, m.start) + markText(m.surface, reading.trim() || null) + text.slice(m.end));

  // 並べた行（文字列から描く）。地の文は位置の印を持つ span、囲んだ語は押せる下線の語
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

  // --- なぞる動きの見本（公開後、初めて作る画面を開いた端末で一度だけ。Hop 決定 2026-10-20） ---
  // 最初に出てきた、囲んでいない2字以上の地の文の頭の2〜3字をなぞって見せる【仮】
  useLayoutEffect(() => {
    if (!trace || traceStartedRef.current || barHidden) return;
    const root = linesRef.current;
    if (!root) return;
    // まだ何も囲んでいない行の頭を先に選ぶ（語の途中の切れ端をなぞらないように）
    const segs = Array.from(root.querySelectorAll<HTMLElement>("[data-seg-start]")).filter((el) => (el.textContent ?? "").trim().length >= 2);
    const seg = segs.find((el) => !el.parentElement?.querySelector("[data-bulk-mark]")) ?? segs[0];
    if (!seg || !seg.firstChild) return;
    const value = seg.textContent ?? "";
    const lead = value.length - value.trimStart().length;
    const len = Math.min(3, value.trim().length);
    const range = document.createRange();
    range.setStart(seg.firstChild, lead);
    range.setEnd(seg.firstChild, lead + len);
    const r = range.getBoundingClientRect();
    const base = root.getBoundingClientRect();
    // なぞる字が画面に見えている時だけ始める（見えるまでスクロールを待つ）
    if (r.width === 0 || r.top < 0 || r.bottom + 60 > window.innerHeight) return;
    traceStartedRef.current = true;
    onTraceShown();
    const still = prefersReducedMotion();
    const word = value.slice(lead, lead + len);
    setTraceBox({ left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height, word, still });
    setTraceSwept(still);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // 見本の時間の流れ（始まった時に1回だけ組む）
  const traceRunning = !!traceBox;
  useEffect(() => {
    if (!traceBox) return;
    const { word, still } = traceBox;
    const timers: number[] = [];
    const stop = () => {
      setTraceBox(null);
      setTraceBar(null);
    };
    if (still) {
      setTraceBar(word);
      timers.push(window.setTimeout(stop, TRACE_STILL_END_MS));
    } else {
      timers.push(window.setTimeout(() => setTraceSwept(true), 30));
      timers.push(window.setTimeout(() => setTraceBar(word), TRACE_BAR_AT_MS));
      timers.push(window.setTimeout(stop, TRACE_END_MS));
    }
    // 見本の途中で利用者が触ったら（なぞった・押した）すぐ消す
    const root = linesRef.current;
    root?.addEventListener("pointerdown", stop, { once: true });
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      root?.removeEventListener("pointerdown", stop);
    };
  }, [traceRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  const showEditor = !collapsed || !text.trim();
  const barWord = current ? (current.picked.length > 12 ? `${current.picked.slice(0, 12)}…` : current.picked) : traceBar;
  const searchable = passed.length >= 2;

  return (
    <section data-bulk="" className="space-y-3">
      {/* 「書く｜ヒントを付ける」の切り替え（Hop 決定 2026-10-20 案B）。同じ文が2か所に並ばないよう、どちらか一方だけを出す */}
      {lines.length > 0 && (
        <div role="group" aria-label={t.modeLabel} data-bulk-mode={showEditor ? "write" : "hint"} className="grid grid-cols-2 gap-0.5">
          {([["write", t.modeWrite], ["hint", t.modeHint]] as const).map(([m, label]) => {
            const on = (m === "write") === showEditor;
            return (
              <button
                key={m}
                type="button"
                data-bulk-mode-button={m}
                aria-pressed={on}
                onClick={() => {
                  onCollapsed(m === "hint");
                  if (m === "write") requestAnimationFrame(() => areaRef.current?.focus());
                }}
                className={`min-h-11 px-3 text-sm font-bold transition-colors ${on ? "bg-primary text-white" : "bg-surface-container-low hover:bg-surface-container-high"}`}
                style={on ? undefined : { color: C.ink }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {showEditor ? (
        <>
          <p id="cw-bulk-guide" className="text-xs leading-relaxed" style={{ color: C.secondary }}>
            {t.guide}
          </p>
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
              setAreaSel(null);
              onText(e.target.value);
            }}
            // 半角の | は欄を離れた時に全角へそろえる（打っている途中に書き換えると変換中の字が崩れるため）
            onBlur={() => {
              // 欄を離れたら選択の帯も少し待って消す（帯のボタンを押す瞬間に欄を離れる端末のため待つ）
              window.clearTimeout(areaSelTimer.current);
              areaSelTimer.current = window.setTimeout(() => setAreaSel(null), 400);
              const next = fullWidthBars(text);
              if (next !== text) onText(next);
            }}
            rows={5}
            className={`${textareaClassName} resize-y min-h-[8rem] leading-relaxed`}
          />
          {/* 印を入れるボタン（Hop 2026-10-18）と「畳む」 */}
          <div className="flex gap-2">
            <button
              type="button"
              data-bulk-insert="brackets"
              {...keepFocus}
              onClick={() => insert("brackets")}
              aria-label={t.insertBracketsLabel}
              className="px-3 min-h-11 font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors"
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
              className="min-w-11 px-3 min-h-11 font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors"
              style={{ color: C.ink }}
            >
              {t.insertBar}
            </button>
            <button
              type="button"
              data-bulk-insert="arrow"
              {...keepFocus}
              onClick={() => insert("arrow")}
              aria-label={t.insertArrowLabel}
              className="min-w-11 px-3 min-h-11 font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors"
              style={{ color: C.ink }}
            >
              {t.insertArrow}
            </button>
          </div>
        </>
      ) : null}

      {lines.length > 0 && !showEditor && (
        <div className="space-y-2">
          <p className="text-xs font-bold" style={{ color: C.secondary }}>
            {t.linesLabel}
          </p>
          <div ref={linesRef} data-bulk-lines="" className="relative bg-surface-container-low">
            {lines.map(({ line, parts }) => {
              const on = active === null || active === line;
              const rowOpen = parts.some((p) => p.kind === "mark" && openKey !== null && candByStart.get(p.mark.start)?.key === openKey && !candByStart.get(p.mark.start)?.reason);
              // 行の下: 交差できる字の黒い札とヒントの印（答えの字の並びは出さない。Hop 決定 2026-10-20）。弾いた語は理由を1行
              const info: React.ReactNode[] = [];
              for (const p of parts) {
                if (p.kind !== "mark") continue;
                const c = candByStart.get(p.mark.start);
                if (!c) continue;
                if (!c.reason) {
                  const has = hinted(c.key);
                  info.push(
                    <span key={`i${p.index}`} data-bulk-answer={c.key} className="inline-flex items-center gap-1">
                      {(crossChars.get(c.key) ?? []).map((ch) => (
                        <span
                          key={ch}
                          title={`'${ch}' で他の語と交差できます`}
                          className={`inline-flex items-center justify-center font-bold ${on ? "w-5 h-5 text-xs" : "w-3.5 h-3.5 text-[10px]"}`}
                          style={{ background: C.black, color: C.white }}
                        >
                          {ch}
                        </span>
                      ))}
                      <span data-bulk-hint={has ? "on" : "off"} aria-label={has ? t.hinted : t.notHinted} style={{ color: C.ink }}>
                        {has ? "●" : "○"}
                      </span>
                    </span>
                  );
                } else {
                  info.push(
                    <span key={`i${p.index}`} data-bulk-reason={c.reason}>
                      {t.reasonLine(p.mark.surface, t.reasons[c.reason])}
                    </span>
                  );
                }
              }
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
                  className={`${on ? "px-3 py-2" : "px-3 py-1"} ${rowOpen ? "bg-surface-container-highest" : ""}`}
                >
                  <div
                    className={on ? "text-base leading-[1.9] break-words" : "text-[10px] leading-normal whitespace-nowrap overflow-hidden text-ellipsis"}
                    style={{ color: on ? C.ink : C.secondary }}
                  >
                    {parts.map((p) => {
                      if (p.kind === "text") {
                        return (
                          <span key={`t${p.start}`} data-seg-start={p.start}>
                            {p.value}
                          </span>
                        );
                      }
                      const c = candByStart.get(p.mark.start);
                      const ok = !!c && !c.reason;
                      const isOpen = ok && openKey === c!.key;
                      // 囲んだ語は下線だけ（箱にしない）。読みはルビで上に。読みが要るのに無い語は点線
                      return (
                        <button
                          key={`m${p.index}`}
                          type="button"
                          data-bulk-mark={p.mark.surface}
                          data-bulk-mark-selected={selMark === p.mark.start || isOpen ? "" : undefined}
                          onClick={() => {
                            setActive(line);
                            if (ok) {
                              setSelMark(null);
                              onOpenHint(c!.key, p.mark.surface);
                            } else setSelMark(p.mark.start);
                          }}
                          aria-label={t.selectMark(p.mark.surface)}
                          className={`inline font-bold ${on ? "py-2 -my-2 px-0.5" : "px-px"} ${isOpen || selMark === p.mark.start ? "bg-surface-container-high" : "bg-transparent"}`}
                          style={{
                            color: "inherit",
                            lineHeight: "inherit",
                            textDecorationLine: "underline",
                            textDecorationStyle: needsReading.has(p.mark.start) ? "dashed" : "solid",
                            textDecorationThickness: on ? 2 : 1,
                            textUnderlineOffset: on ? 4 : 2,
                          }}
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
                      );
                    })}
                  </div>
                  {info.length > 0 && (
                    <div
                      className={on ? "flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs" : "flex items-center gap-x-2 text-[10px] whitespace-nowrap overflow-hidden"}
                      style={{ color: C.secondary }}
                    >
                      {info}
                    </div>
                  )}
                </div>
              );
            })}

            {/* なぞる動きの見本（なぞる印・指・吹き出し）。吹き出しはなぞる字の下に出し、上の行に重ねない */}
            {traceBox && (
              <div aria-hidden="true" className="pointer-events-none">
                <div
                  data-trace-mark=""
                  className="absolute"
                  style={{
                    left: traceBox.left,
                    top: traceBox.top,
                    height: traceBox.height,
                    width: traceSwept ? traceBox.width : 0,
                    background: C.highest,
                    mixBlendMode: "multiply",
                    transition: traceBox.still ? "none" : `width ${TRACE_SWEEP_MS}ms ease-in-out`,
                  }}
                />
                <div
                  data-trace-finger=""
                  className="absolute"
                  style={{
                    left: traceBox.left - 14,
                    top: traceBox.top + traceBox.height - 6,
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: C.black,
                    opacity: 0.55,
                    transform: traceSwept ? `translateX(${traceBox.width}px)` : "none",
                    transition: traceBox.still ? "none" : `transform ${TRACE_SWEEP_MS}ms ease-in-out`,
                  }}
                />
                <div
                  data-trace-tip=""
                  className="absolute text-xs font-bold px-2.5 py-1.5 whitespace-nowrap"
                  style={{ left: Math.max(8, traceBox.left - 20), top: traceBox.top + traceBox.height + 26, background: C.black, color: C.white }}
                >
                  {t.traceTip}
                </div>
              </div>
            )}
          </div>
          <p data-bulk-legend="" className="text-xs whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: C.ink }}>
            {t.legend}
          </p>
        </div>
      )}

      {tip}

      <button
        type="button"
        data-bulk-search=""
        onClick={onSearch}
        disabled={!searchable}
        className="w-full min-h-12 px-4 font-semibold bg-primary text-white hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {t.search(passed.length)}
      </button>

      {/* 画面の下の帯（Hop 2026-10-18 案a・2026-10-20）。なぞっている間だけ「「語」を出す」。読みの要る語を押した時は「語・読みの欄・決める・外す・×」 */}
      {!barHidden && (selected && !current ? (
        <div data-bulk-markbar="" className="fixed inset-x-0 bottom-0 z-30 bg-white" style={{ boxShadow: `0 -1px 0 ${C.mid}`, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div data-bulk-readingbar="" className="max-w-[640px] mx-auto flex items-center gap-2 px-4 py-2">
            <label htmlFor="cw-bulk-reading" className="font-bold whitespace-nowrap max-w-[7em] truncate" style={{ color: C.ink }}>
              {selected.surface}
            </label>
            {/* 文字は16px（iPhone は16pxより小さい入力欄を押すと画面を拡大するため） */}
            <input
              ref={readingBoxRef}
              id="cw-bulk-reading"
              value={readingDraft}
              onChange={(e) => setReadingDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (readingDraft.trim()) {
                    setReading(selected, readingDraft);
                    setSelMark(null);
                  }
                } else if (e.key === "Escape") setSelMark(null);
              }}
              placeholder={t.reading}
              aria-label={t.readingOf(selected.surface)}
              className="flex-1 min-w-0 h-11 bg-surface-container-low px-2 text-base leading-normal placeholder:text-outline focus:outline-none focus:shadow-[inset_0_-2px_0_#000]"
              style={{ color: C.ink }}
            />
            <button
              type="button"
              data-bulk-decide=""
              disabled={!readingDraft.trim()}
              onClick={() => {
                setReading(selected, readingDraft);
                setSelMark(null);
              }}
              className="shrink-0 px-3 min-h-11 text-sm font-bold bg-primary text-white hover:bg-secondary disabled:opacity-40 transition-colors"
            >
              {t.decide}
            </button>
            <button
              type="button"
              onClick={() => {
                unmark(selected);
                setSelMark(null);
              }}
              aria-label={t.unmark(selected.surface)}
              className="shrink-0 px-3 min-h-11 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors"
              style={{ color: C.ink }}
            >
              {t.unmarkShort}
            </button>
            <button
              type="button"
              onClick={() => setSelMark(null)}
              aria-label={t.closeBarLabel}
              className="shrink-0 min-w-11 min-h-11 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors"
              style={{ color: C.ink }}
            >
              {t.closeBar}
            </button>
          </div>
        </div>
      ) : barWord ? (
        <div data-bulk-markbar="" className="fixed inset-x-0 bottom-0 z-30 bg-white" style={{ boxShadow: `0 -1px 0 ${C.mid}`, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="max-w-[640px] mx-auto px-4 py-2">
            <button
              type="button"
              {...keepFocus}
              onClick={current ? markHere : undefined}
              aria-hidden={current ? undefined : true}
              tabIndex={current ? undefined : -1}
              className="w-full min-h-12 px-4 font-semibold bg-primary text-white hover:bg-secondary transition-colors truncate"
            >
              {t.markSelected(barWord)}
            </button>
          </div>
        </div>
      ) : null)}
    </section>
  );
};
