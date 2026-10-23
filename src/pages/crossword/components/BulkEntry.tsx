// 作る画面の書く欄「まとめて入れる」（Hop 決定 2026-10-18〜10-20）。
// 行を何行でも書き、出題する語を作る人が【語】【語｜読み】で囲む（欄で字を選んで「「語」を出す」でもよい）。
// 語の切り出し・読みの下書きは機械がしない（作る人が決める）。
// データの正本は textarea の文字列1本だけ。答え・カギの下書きはそこから毎回計算する。
// 2026-10-22 作る画面を案A「作る｜試す」にした時に、「書く｜ヒントを付ける」の切り替えと「ヒントを付ける」側（書いた行の一覧・下線の語・
// 読みの帯・なぞる動きの見本）と「組み合わせを探す」を外した（Hop 決定 2026-10-22。ヒントは語の一覧の行を押して出る窓の1か所で付け、盤は書くそばで育つ）。
// 残したのは「書く」側の働き全部（案内文・欄・道具の段・欄で選ぶと帯「「語」を出す」・【語】の中にカーソルで帯「「語」の囲みを外す」）
import React, { useEffect, useRef, useState } from "react";

import { isUsableCell, toCells, UNUSABLE_KANA } from "../../../lib/crossword/cells";
import { C } from "../style";

// 答えの字数の上限と、答えの語数の上限（指示書 2026-10-18）。字数は答えのマス目で30字まで（Hop 決定 2026-10-22。前は20字）。
// 受付係 crossword-save の MAX_ANSWER_CHARS と同じ値
const MAX_CELLS = 30;
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
  unmarkBar: (word: string) => string;
  insertArrowLabel: string;
  insertMaru: string;
  insertMaruLabel: string;
  reasonLine: (surface: string, reason: string) => string;
  reasons: Record<ReasonKey, string>;
  /** 答えにならず外れた行の理由（「→」に【 】が無い・中が空・組が合わない） */
  lineReasons: Record<LineProblemKey, string>;
  /** 書く欄の中身が見本の行のままの時に、欄のすぐ上に出す札 */
  sampleTag: string;
  /** 書く欄が空の時に、欄の下に出すボタン（押すと見本の行が入る） */
  insertSample: string;
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

// 書いた行のうち、答えにならず黙って外れていた形（Hop 決定 2026-10-23「書いた行が黙って消える」の直し）。
//   needBrackets: 「→」があるのに【 】が無い行／emptyMark: 【】【 】【｜】のように中が空／unpaired: 【 の閉じ忘れ・】だけ・【 の中の 【
// 「→」も【 】も無い行はメモとして黙って通す
export type LineProblemKey = "needBrackets" | "emptyMark" | "unpaired";
export interface LineProblem {
  reason: LineProblemKey;
  start: number; // 文字列の中の位置（理由の行を書いた順に並べるのに使う）
  line: number;
  head: string; // 理由の行の頭に出す、行の文の頭
}

// 理由の行の頭に出す行の文の頭（長い行は12字で切る。欄の帯の語の切り方と同じ）
const lineHead = (s: string) => {
  const t = s.trim();
  return Array.from(t).length > 12 ? `${Array.from(t).slice(0, 12).join("")}…` : t;
};

export const lineProblems = (text: string): LineProblem[] => {
  const out: LineProblem[] = [];
  const marks = parseMarks(text);
  let pos = 0;
  text.split("\n").forEach((line, lineNo) => {
    const lineStart = pos;
    pos += line.length + 1;
    if (!line.includes("【") && !line.includes("】")) {
      if (line.includes("→")) out.push({ reason: "needBrackets", start: lineStart, line: lineNo, head: lineHead(line) });
      return;
    }
    let open: number | null = null;
    let unpaired = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "【") {
        if (open !== null) unpaired = true;
        open = i;
      } else if (ch === "】") {
        if (open === null) {
          unpaired = true;
          continue;
        }
        const at = lineStart + open;
        const m = marks.find((x) => x.start === at);
        const src = m ? (m.reading?.trim() || m.surface.trim()) : "";
        if (!src) out.push({ reason: "emptyMark", start: at, line: lineNo, head: lineHead(line) });
        open = null;
      }
    }
    if (open !== null) unpaired = true;
    if (unpaired) out.push({ reason: "unpaired", start: lineStart, line: lineNo, head: lineHead(line) });
  });
  return out;
};

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

// 各候補を「リストに追加」と同じ道具（toCells・UNUSABLE_KANA・isUsableCell）で確かめる。
// listKeys はもう一覧に入っている答え（今の作る画面では一覧は無いので空で呼ぶ）
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

// 同じ行のほかの答えは字数ぶんの□で隠す（カギにほかの答えが見えないように。Hop 決定 2026-10-20）。答えにならない印（読みが無い等）は表記のまま
const hiddenOther = (m: Mark): string => {
  const src = (m.reading?.trim() || m.surface.trim());
  const cells = src ? toCells(src) : [];
  return cells.length > 0 && cells.every(isUsableCell) ? "□".repeat(cells.length) : m.surface;
};

// カギの下書き: その語の印がある行の、その印だけを答えの字数ぶんの○にし、同じ行のほかの答えは□で隠す。
// 下書きが○だけになる行（【コアラ】だけの行など）は空にする（欄の例の文と「カギがあと◯語」が働くように。Hop 決定 2026-10-22）。
// ○・□・→ と空白だけの下書き（【ネコ】【コアラ】の行・【ラクダ】→【ダチョウ】の行など）も同じく空にする。カギを書かずに公開できないようにするため（Hop 決定 2026-10-23）
export const clueDraft = (text: string, marks: Mark[], target: Mark, answerLength: number): string => {
  const draft = clueDraftRaw(text, marks, target, answerLength);
  return /^[○□→\s]*$/.test(draft) ? "" : draft;
};

const clueDraftRaw = (text: string, marks: Mark[], target: Mark, answerLength: number): string => {
  const lines = text.split("\n");
  let lineStart = 0;
  for (let i = 0; i < target.line; i++) lineStart += lines[i].length + 1;
  const lineEnd = lineStart + lines[target.line].length;
  // 行の終わりが「→【答え】」の形なら（→ の後ろが答えの印と空白だけ）、→ から後ろを消す
  // （「ニャーと鳴く動物→【ネコ】」→「ニャーと鳴く動物」、「問題文→【ネコ】【イヌ】」はどちらも「問題文」。Hop 決定 2026-10-20）
  const lineMarks = marks.filter((m) => m.line === target.line);
  const arrowAt = text.lastIndexOf("→", lineEnd - 1);
  if (arrowAt >= lineStart && target.start > arrowAt) {
    let rest = "";
    let at = arrowAt + 1;
    for (const m of lineMarks) {
      if (m.start < arrowAt + 1) continue;
      rest += text.slice(at, m.start);
      at = m.end;
    }
    rest += text.slice(at, lineEnd);
    if (!rest.trim()) {
      let head = "";
      let pos = lineStart;
      for (const m of lineMarks) {
        if (m.start >= arrowAt) continue;
        head += text.slice(pos, m.start) + hiddenOther(m);
        pos = m.end;
      }
      return (head + text.slice(pos, arrowAt)).trim();
    }
  }
  let out = "";
  let pos = lineStart;
  for (const m of marks) {
    if (m.line !== target.line) continue;
    out += text.slice(pos, m.start);
    out += m === target || (m.start === target.start && m.end === target.end) ? "○".repeat(answerLength) : hiddenOther(m);
    pos = m.end;
  }
  out += text.slice(pos, lineEnd);
  return out.trim();
};

const keepFocus = { onPointerDown: (e: React.PointerEvent) => e.preventDefault(), onMouseDown: (e: React.MouseEvent) => e.preventDefault() };

export const BulkEntry: React.FC<{
  text: string;
  onText: (v: string) => void;
  t: BulkTexts;
  textareaClassName: string;
  /** 窓が開いている間は画面の下の帯を出さない */
  barHidden?: boolean;
  /** 道具の段のすぐ下に置く物（弾いた理由の行） */
  below?: React.ReactNode;
  /** 見本の行（中身がこれと同じ間は「見本」の札を出す。空の時は「見本を入れる」で入れる） */
  sample?: string;
}> = ({ text, onText, t, textareaClassName, barHidden, below, sample }) => {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // 欄の中で選んでいる範囲（ボタンを押す瞬間に選択が消える端末のため、少し待ってから消す）
  const [areaSel, setAreaSel] = useState<{ start: number; end: number; text: string } | null>(null);
  const areaSelTimer = useRef(0);
  // 欄の中で【語】の中にカーソルがある時、その印の位置（下の帯を「「語」の囲みを外す」にする。Hop 決定 2026-10-20）
  const [areaMark, setAreaMark] = useState<number | null>(null);
  useEffect(() => () => window.clearTimeout(areaSelTimer.current), []);

  useEffect(() => {
    const onSel = () => {
      // 欄の中の選択（欄の選択は文書の選択に出ないので、欄の選択の位置で見る）
      const area = areaRef.current;
      if (!area || document.activeElement !== area) return;
      window.clearTimeout(areaSelTimer.current);
      if (area.selectionStart < area.selectionEnd) {
        setAreaSel({ start: area.selectionStart, end: area.selectionEnd, text });
        setAreaMark(null);
      } else {
        const pos = area.selectionStart;
        const inside = parseMarks(text).find((m) => pos > m.start && pos < m.end);
        if (inside) setAreaMark(inside.start);
        areaSelTimer.current = window.setTimeout(() => {
          setAreaSel(null);
          if (!inside) setAreaMark(null);
        }, 400);
      }
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [text]);

  const marks = parseMarks(text);

  // 画面の操作で文字列を書き換える時は、印の中の半角 | も全角にそろえる
  const write = (next: string) => onText(fullWidthBars(next));

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
  // 欄で字を選んでいる範囲で帯を出す（Hop 決定 2026-10-20 案C）。控えは同じ文字列の時だけ使う
  const current = pickable(areaSel && areaSel.text === text ? areaSel : null);

  const markHere = () => {
    if (!current) return;
    const live = current;
    setAreaSel(null);
    write(text.slice(0, live.start) + `【${live.picked}】` + text.slice(live.end));
    const area = areaRef.current;
    requestAnimationFrame(() => {
      if (!area) return;
      area.focus();
      area.setSelectionRange(live.end + 2, live.end + 2);
    });
  };

  // 入力欄に印を入れる。欄で文字を選んでいれば【 】で囲み、選んでいなければ【】を入れてその間にカーソルを置く。｜・→・○はカーソルの位置に入れる。
  // ○は「→」の書き方で、問題文の答えの所を○で書く時に使う（Hop 決定 2026-10-22。3 カギの欄ごとの○ボタンから移した）。
  // 欄を選んでいない時に押しても、｜・→ と同じく欄が最後に覚えているカーソルの所（一度も触っていなければ欄の末尾）に入れ、欄を選んだ状態にする
  const insert = (kind: "brackets" | "bar" | "arrow" | "maru") => {
    const area = areaRef.current;
    if (!area) return;
    const s = area.selectionStart ?? text.length;
    const e = area.selectionEnd ?? s;
    let next: string;
    let caret: number;
    if (kind === "bar" || kind === "arrow" || kind === "maru") {
      next = text.slice(0, s) + (kind === "bar" ? "｜" : kind === "arrow" ? "→" : "○") + text.slice(e);
      caret = s + 1;
    } else {
      if (s < e) {
        // 囲めない選び方（行をまたぐ・【語】を含む等）の時は、選んだ文を消さないよう何もしない
        const p = pickable({ start: s, end: e });
        if (!p) return;
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

  const areaMarkObj = areaMark === null ? null : (marks.find((m) => m.start === areaMark) ?? null);
  const barWord = current ? (current.picked.length > 12 ? `${current.picked.slice(0, 12)}…` : current.picked) : null;
  const toolBtn = "min-w-11 px-3 min-h-11 font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors";

  return (
    <section data-bulk="" className="space-y-3">
      <p id="cw-bulk-guide" className="text-xs leading-relaxed" style={{ color: C.secondary }}>
        {t.guide}
      </p>
      {/* 中身が見本の行のままの時だけ、欄のすぐ上に小さい面の札（線でなく面。Hop 決定 2026-10-23） */}
      {sample !== undefined && text === sample && (
        <p className="flex -mb-1.5">
          <span data-bulk-sample-tag="" className="inline-block px-2 py-0.5 text-xs font-bold bg-surface-container-high" style={{ color: C.ink }}>
            {t.sampleTag}
          </span>
        </p>
      )}
      <textarea
        ref={areaRef}
        id="cw-bulk-text"
        data-bulk-text=""
        data-kbd-field=""
        aria-label={t.textLabel}
        aria-describedby="cw-bulk-guide"
        value={text}
        onChange={(e) => {
          setAreaSel(null);
          setAreaMark(null);
          onText(e.target.value);
        }}
        // 半角の | は欄を離れた時に全角へそろえる（打っている途中に書き換えると変換中の字が崩れるため）
        onBlur={() => {
          // 欄を離れたら選択の帯も少し待って消す（帯のボタンを押す瞬間に欄を離れる端末のため待つ）
          window.clearTimeout(areaSelTimer.current);
          areaSelTimer.current = window.setTimeout(() => {
            setAreaSel(null);
            setAreaMark(null);
          }, 400);
          const next = fullWidthBars(text);
          if (next !== text) onText(next);
        }}
        rows={5}
        className={`${textareaClassName} resize-y min-h-[8rem] leading-relaxed`}
      />
      {/* 印を入れるボタン（Hop 2026-10-18。○は 2026-10-22） */}
      <div className="flex gap-2">
        <button type="button" data-bulk-insert="brackets" {...keepFocus} onClick={() => insert("brackets")} aria-label={t.insertBracketsLabel} className={toolBtn} style={{ color: C.ink }}>
          {t.insertBrackets}
        </button>
        <button type="button" data-bulk-insert="bar" {...keepFocus} onClick={() => insert("bar")} aria-label={t.insertBarLabel} className={toolBtn} style={{ color: C.ink }}>
          {t.insertBar}
        </button>
        <button type="button" data-bulk-insert="arrow" {...keepFocus} onClick={() => insert("arrow")} aria-label={t.insertArrowLabel} className={toolBtn} style={{ color: C.ink }}>
          {t.insertArrow}
        </button>
        <button type="button" data-bulk-insert="maru" {...keepFocus} onClick={() => insert("maru")} aria-label={t.insertMaruLabel} className={toolBtn} style={{ color: C.ink }}>
          {t.insertMaru}
        </button>
      </div>
      {/* 欄が空の時だけ、見本の行を入れるボタン（Hop 決定 2026-10-23） */}
      {sample !== undefined && text === "" && (
        <button type="button" data-bulk-insert-sample="" onClick={() => onText(sample)} className="min-h-11 px-4 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors" style={{ color: C.ink }}>
          {t.insertSample}
        </button>
      )}
      {below}

      {/* 画面の下の帯（Hop 2026-10-18 案a・2026-10-20）。欄で字を選んでいる間だけ「「語」を出す」。【語】の中にカーソルがある時は「「語」の囲みを外す」 */}
      {!barHidden &&
        (barWord ? (
          <div data-bulk-markbar="" className="fixed inset-x-0 bottom-0 z-30 bg-white" style={{ boxShadow: `0 -1px 0 ${C.mid}`, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="max-w-[640px] mx-auto px-4 py-2">
              <button type="button" {...keepFocus} onClick={markHere} className="w-full min-h-12 px-4 font-semibold bg-primary text-white hover:bg-secondary transition-colors truncate">
                {t.markSelected(barWord)}
              </button>
            </div>
          </div>
        ) : areaMarkObj ? (
          <div data-bulk-markbar="" className="fixed inset-x-0 bottom-0 z-30 bg-white" style={{ boxShadow: `0 -1px 0 ${C.mid}`, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="max-w-[640px] mx-auto px-4 py-2">
              <button
                type="button"
                data-bulk-unmarkbar=""
                {...keepFocus}
                onClick={() => {
                  const m = areaMarkObj;
                  setAreaMark(null);
                  unmark(m);
                  requestAnimationFrame(() => {
                    const area = areaRef.current;
                    if (!area) return;
                    area.focus();
                    area.setSelectionRange(m.start, m.start + m.surface.length);
                  });
                }}
                className="w-full min-h-12 px-4 font-semibold bg-primary text-white hover:bg-secondary transition-colors truncate"
              >
                {t.unmarkBar(areaMarkObj.surface.length > 12 ? `${areaMarkObj.surface.slice(0, 12)}…` : areaMarkObj.surface)}
              </button>
            </div>
          </div>
        ) : null)}
    </section>
  );
};
