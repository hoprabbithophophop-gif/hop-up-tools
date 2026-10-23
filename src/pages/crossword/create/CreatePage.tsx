// クロスワードの作る画面（/crossword/create）。案A「作る｜試す」（Hop 決定 2026-10-22。前の4段の流れ 1 答え・2 盤・3 カギ・4 共有は取りやめ）。
//   上:     見出しと「作る｜試す」の切り替え（44px・上に貼り付き）
//   作る:   小さい盤（約110px・上に貼り付き。書くそばで育つ。押すと広げた盤の画面）→ 書く欄 → 語の一覧（行を押すと下から語の窓。カギとヒントを書く）
//   試す:   今の盤を解く画面の本物の部品で解く（受付係・棚には何も送らない。?debug= の見本と同じくブラウザの中だけで答え合わせ）
//   下:     貼り付けの段（60px）「試しに解く」「共有へ」。共有の窓で題名などを入れ、人間確認（Turnstile）を通って保存
// 細かい所から全体へ一方向に進み、途中では止めない。足りない物は共有の直前に「カギがあと◯語・ヒントがあと◯語」とだけ出す（Hop 決定 2026-10-22）。
// 中身の部品は本番の物をそのまま使う（BulkEntry・bulkSelect・MovableBoard・engine・suggest・HintField・SaveCheckModal・解く画面）。
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { buildGrid, createPuzzleSearch, generateMonteCarloSteps, isBetterPlacement, isConnected, moveItem, validatePlacement } from "../../../lib/crossword/engine";
import { createBulkSearch, type BulkProposal } from "../../../lib/crossword/bulkSelect";
import { suggestForBoard, guideTexts } from "../../../lib/crossword/suggest";
import type { PuzzleData, PuzzleItem, PlacedItem } from "../../../lib/crossword/types";
import { isUsableCell, toCells } from "../../../lib/crossword/cells";
import {
  addMyPuzzle,
  fetchOwnedPuzzle,
  makeOwnerKey,
  readMyPuzzles,
  savePuzzle,
  SaveError,
  toBody,
  updatePuzzle,
  withOutsideMarks,
  type HintRef,
  type MyPuzzle,
} from "../../../lib/crossword/puzzleStore";
import { drawShareImage } from "../../../lib/crossword/shareImage";
import { detectGroups } from "../../../lib/crossword/groupDetect";
import { linkProblem } from "../../../lib/crossword/youtubeUrl";
import { animateElement, prefersReducedMotion } from "../../../lib/crossword/motion";
import { BulkEntry, clueDraft, evaluateCandidates, lineProblems, parseMarks, type Candidate } from "../components/BulkEntry";
import { HintField } from "../components/HintField";
import { useHintSearch } from "../components/hintSearch";
import { HINT_SOURCES, sourceOfUrl } from "../components/HintSourceBar";
import { FitGrid } from "../components/FitGrid";
import { MovableBoard, MOVE_MARGIN } from "../components/MovableBoard";
import { PuzzleGridRetro, type GridFx } from "../components/PuzzleGridRetro";
import { Motion, Presence } from "../components/Motion";
import { useDialog } from "../components/useDialog";
import { Toaster, toast } from "../components/Toast";
import { SaveCheckModal } from "../components/SaveCheckModal";
import { Footer, Icon } from "../components/ui";
import { C } from "../style";
import type { TrialPlay } from "../CrosswordPage";
import type { EditCarry } from "../HintsEditPage";
import { BULK_TEXTS, CT, PROPOSAL_TEXTS } from "./texts";

// localStorage の鍵（名前は今までと同じ。消した札は消したまま）
const DRAFT_KEY = "crossword_draft";
const TIP_KEYS = {
  cross: "crossword_seen_tip_cross", // 答えが1つになった時
  move: "crossword_seen_tip_move", // 広げた盤に盤が出た時
  saved: "crossword_seen_tip_saved", // 共有の窓の中
} as const;
type TipName = keyof typeof TIP_KEYS;
const MAX_TAGS = 10;
// カギ（問題文）1つの字数の上限。数え方は見た目の字数（絵文字なども1字。Array.from の長さ）。受付係 crossword-save の MAX_CLUE_CHARS と同じ値。
// 2026-10-21 に入れた30字は取り違えで、正しくは問題文100字（答えのマス目が30字。Hop 決定 2026-10-22）
const MAX_CLUE_CHARS = 100;
// 「あと◯字」を、欄を選んでいなくても出す残りの字数（Hop 決定 2026-10-22「フォーカス中か、残り10字以下の時だけ」）
const CLUE_LEFT_ALWAYS = 10;
const clueChars = (s: string) => Array.from(s.trim()).length;
// 裏の探索を1回の刻みで回す長さ（ミリ秒）。刻みの合間に入力を受けるので、打つのを待たせない
const SEARCH_STEP_MS = 30;
// 組み立ての演出の試行の数（HarmonyPalette と同じ）。広げた盤の「再シャッフル」で使う
const ANIMATION_STEPS = 50;
// 書く欄の答えが変わってから、裏で盤を組み直し始めるまでの待ち（打っている間は組み直さない。Hop 決定 2026-10-22「短い待ちの後に結果を出す」）【仮】
const AUTO_SEARCH_WAIT_MS = 250;
// 見出しと「作る｜試す」の高さ・小さい盤の高さ・下の貼り付けの段の高さ（見本の案A と同じ）
const HEAD_H = 44;
const MINI_H = 110;
const DOCK_H = 60;
const DOCK_GAP = `calc(${DOCK_H}px + env(safe-area-inset-bottom, 0px))`;
// 動きの強弱（Hop 決定 2026-10-22）。無いと何が変わったか分からない動き（盤に増えたマス・足りない言葉が消える・下線）は今の強さ、
// それ以外（窓が出る・文が替わる・試すへの切り替え・盤を広げる／閉じる・文字盤で隠れる／戻る）は短く小さく目立たない形（0.15秒・ずれ 4px・0.97倍）
const WEAK = { duration: 0.15, ease: "easeOut" as const };
// 文字盤が出て小さい盤と下の段が隠れる・戻る時の動き（予定表の帯と同じ曲線。弱い組なので 120ms）
const HIDE_MS = 120;
const EASE_STANDARD = "cubic-bezier(0.4, 0, 0.2, 1)";
// 答えの並びの見出し。盤を組んだ時と同じなら組み直さない
const poolSignature = (items: PuzzleItem[]) => items.map((p) => `${p.id}:${p.answer.join("")}`).sort().join("|");
// 盤の形の見出し（「試す」で入れた字を、同じ盤の時だけ戻すのに使う）
const boardSignature = (p: PuzzleData) => p.items.map((i) => `${i.id}@${i.startX},${i.startY}${i.direction[0]}`).sort().join("|");

const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 残せなくても作れる */
  }
};
const lsRemove = (k: string) => {
  try {
    localStorage.removeItem(k);
  } catch {
    /* 消せなくても困らない */
  }
};

// 作りかけ（案A の形・version 3）。ヒント・カギは答え（答えの字を並べた物）ごとに持つ。盤は語の位置と固定のまま残す。
// 前の版（4段の版の version 2・段の無い古い形）も開ける（version 2 の段と畳んだ印は使わない）
interface DraftV3 {
  version: 3;
  bulkText: string;
  hints: Record<string, HintRef>;
  hintLabels: Record<string, string>;
  clues: Record<string, string>;
  board: PlacedItem[] | null;
  proposals: BulkProposal[] | null;
  picked: number | null;
  title: string;
  creatorName: string;
  tags: string[];
  isBeginner: boolean;
  // 盤を組んだ時と最後に探した時の答えの並びの見出し（poolSignature）
  boardSig: string | null;
  searchedSig: string | null;
}

// 作りかけから戻したヒントは、動画の番号・開始の秒・outside の印だけにする（前の版の作りかけに残っているほかの欄は捨てる。
// YouTube の動画のことはどこにも問い合わせない。Hop 決定 2026-10-21「チャンネル名を出さない」）
const draftHint = (h: HintRef): HintRef =>
  h.kind === "youtube"
    ? h.outside === true
      ? { kind: "youtube", videoId: h.videoId, startSec: h.startSec, outside: true }
      : { kind: "youtube", videoId: h.videoId, startSec: h.startSec }
    : { kind: "link", url: h.url };

const isHintRef = (h: unknown): h is HintRef => {
  if (!h || typeof h !== "object") return false;
  const x = h as Record<string, unknown>;
  if (x.kind === "youtube") return typeof x.videoId === "string" && typeof x.startSec === "number";
  if (x.kind === "link") return typeof x.url === "string";
  return false;
};

// 下書きの盤の語を確かめる（形が崩れていれば null）
const validPlaced = (raw: unknown): PlacedItem | null => {
  const it = raw as Partial<PlacedItem> | null;
  if (!it || typeof it.id !== "string" || !it.id) return null;
  if (!Array.isArray(it.answer) || !it.answer.every((c) => typeof c === "string")) return null;
  const answer = toCells(it.answer.join(""));
  if (answer.length === 0 || !answer.every(isUsableCell) || answer.join("") !== it.id) return null;
  if (it.direction !== "horizontal" && it.direction !== "vertical") return null;
  if (!Number.isInteger(it.startX) || !Number.isInteger(it.startY)) return null;
  return {
    id: it.id,
    uuid: typeof it.uuid === "string" && it.uuid ? it.uuid : it.id,
    question: "",
    answer,
    direction: it.direction,
    startX: it.startX as number,
    startY: it.startY as number,
    length: answer.length,
    pinned: it.pinned === true,
  };
};
const validBoard = (raw: unknown, keys: Set<string>): PlacedItem[] | null => {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: PlacedItem[] = [];
  for (const r of raw) {
    const p = validPlaced(r);
    if (!p || !keys.has(p.id) || out.some((o) => o.id === p.id || o.uuid === p.uuid)) return null;
    out.push(p);
  }
  return out;
};

// 盤のマスごとの「語の番号:何字目」の印（新しく増えたマスを見分けるのに使う）
const cellIdsOf = (p: PuzzleData): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const it of p.items) {
    for (let i = 0; i < it.length; i++) {
      const key = it.direction === "horizontal" ? `${it.startX + i},${it.startY}` : `${it.startX},${it.startY + i}`;
      out.set(key, [...(out.get(key) ?? []), `${it.id}:${i}`]);
    }
  }
  return out;
};

const inputClass =
  // 文字は16px。iPhone は16pxより小さい入力欄を押すと画面を拡大するため（Hop 依頼 2026-10-03）
  "w-full h-11 bg-surface-container-low px-3 text-base text-on-surface placeholder:text-outline focus:outline-none focus:bg-white focus:shadow-[inset_0_-2px_0_#000]";
const textareaClass =
  "w-full bg-surface-container-low px-3 py-2 text-base text-on-surface placeholder:text-outline focus:outline-none focus:bg-white focus:shadow-[inset_0_-2px_0_#000]";
const btnPrimary = "w-full min-h-12 px-4 font-semibold bg-primary text-white hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
const btnGray = "min-h-11 px-4 font-semibold bg-surface-container-high hover:bg-surface-container-highest disabled:opacity-40 disabled:cursor-not-allowed transition-colors";

// 選んだヒントの出どころ（「ヒント: 出どころ 名前」の出どころ）
const sourceLabel = (h: HintRef) => (h.kind === "youtube" ? "YouTube" : (HINT_SOURCES.find((s) => s.key === sourceOfUrl(h.url))?.label ?? "リンク"));
const fallbackName = (h: HintRef) => (h.kind === "youtube" ? `https://youtu.be/${h.videoId}` : h.url);
// 語の窓の「ヒント: 出どころ 名前」を押した時に別のタブで開く行き先（Hop 決定 2026-10-22）。YouTube は開始の秒つき、リンクは保存した URL。
// 行き先がおかしい・危ない形（https でない・長すぎる・IP の住所など。ヒントの欄と同じ linkProblem で見る）はリンクにしない
const hintHref = (h: HintRef): string | null => {
  const url = h.kind === "youtube" ? `https://youtu.be/${encodeURIComponent(h.videoId)}?t=${Math.max(0, Math.floor(h.startSec))}` : h.url;
  return linkProblem(url) ? null : url;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 指で触る端末か（文字盤が出る端末。小さい盤と下の段を隠すかの見分けに使う）
const coarsePointer = () => {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
};

// 作りかけのうち人が書いた所（文・カギ・ヒント・題名など）の見出し。別のタブの中身と比べるのに使う（欄の並び順に左右されないよう、鍵を並べ替えて作る）
const sortedEntries = <T,>(o: Record<string, T>) => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const authoredSig = (a: { bulkText: string; hints: Record<string, HintRef>; hintLabels: Record<string, string>; clues: Record<string, string>; title: string; creatorName: string; tags: string[]; isBeginner: boolean }) =>
  JSON.stringify([a.bulkText, sortedEntries(a.hints).map(([k, h]) => [k, draftHint(h)]), sortedEntries(a.hintLabels), sortedEntries(a.clues), a.title, a.creatorName, a.tags, a.isBeginner]);

// 端末に残した作りかけを読み取った形。読めない時は parseDraft が null を返す
interface ParsedDraft {
  bulkText: string;
  hints: Record<string, HintRef>;
  clues: Record<string, string>;
  hintLabels: Record<string, string>;
  title?: string;
  creatorName?: string;
  tags?: string[];
  isBeginner?: boolean;
  board: { items: PlacedItem[]; proposals: BulkProposal[] | null; picked: number | null; boardSig: string; searchedSig: string } | null;
}

// 作りかけの文字列を読み取る（開いた時と、別のタブで書き換えられた時の両方で使う）
const parseDraft = (raw: string): ParsedDraft | null => {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (!d || typeof d !== "object") return null;
    const text = typeof d.bulkText === "string" ? d.bulkText : "";
    const out: ParsedDraft = { bulkText: text, hints: {}, clues: {}, hintLabels: {}, board: null };
    if (typeof d.title === "string") out.title = d.title;
    if (typeof d.creatorName === "string") out.creatorName = d.creatorName;
    if (Array.isArray(d.tags)) out.tags = (d.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, MAX_TAGS);
    if (typeof d.isBeginner === "boolean") out.isBeginner = d.isBeginner;
    const rawHints = d.hints && typeof d.hints === "object" ? (d.hints as Record<string, unknown>) : {};
    let nextText = text;
    const restoredHints: Record<string, HintRef> = {};
    const restoredClues: Record<string, string> = {};
    const restoredLabels: Record<string, string> = {};
    // version 3（案A）と version 2（4段の版）は同じ持ち方（version 2 の段と畳んだ印は使わない）
    const boardKind = d.version === 3 || d.version === 2;
    if (boardKind) {
      for (const [k, h] of Object.entries(rawHints)) if (isHintRef(h)) restoredHints[k] = draftHint(h);
      if (d.clues && typeof d.clues === "object") for (const [k, v] of Object.entries(d.clues as Record<string, unknown>)) if (typeof v === "string") restoredClues[k] = v;
      if (d.hintLabels && typeof d.hintLabels === "object") for (const [k, v] of Object.entries(d.hintLabels as Record<string, unknown>)) if (typeof v === "string") restoredLabels[k] = v;
    } else {
      // 古い形（段の無い下書き）: 1語ずつ入れた語は書いた行の最後に【語】の1行として足し、カギとヒントは答えごとに持ち替える
      const keys = new Set(evaluateCandidates(parseMarks(text)).filter((c) => !c.reason).map((c) => c.key));
      const extra: string[] = [];
      for (const rawItem of Array.isArray(d.items) ? (d.items as unknown[]) : []) {
        const it = rawItem as Partial<PuzzleItem> | null;
        if (!it || typeof it.id !== "string" || !Array.isArray(it.answer) || !it.answer.every((c) => typeof c === "string")) continue;
        const cells = toCells(it.answer.join(""));
        if (cells.length === 0 || !cells.every(isUsableCell)) continue;
        const key = cells.join("");
        if (!keys.has(key)) {
          keys.add(key);
          extra.push(`【${key}】`);
        }
        if (typeof it.question === "string" && it.question.trim()) restoredClues[key] = it.question;
        const h = rawHints[it.id];
        if (isHintRef(h)) restoredHints[key] = draftHint(h);
      }
      if (extra.length > 0) nextText = [text.replace(/\s+$/, ""), ...extra].filter(Boolean).join("\n");
    }
    out.bulkText = nextText;
    out.hints = restoredHints;
    out.clues = restoredClues;
    out.hintLabels = restoredLabels;
    if (boardKind) {
      const valid = evaluateCandidates(parseMarks(nextText)).filter((c) => !c.reason);
      const keys = new Set(valid.map((c) => c.key));
      // 盤が残っていれば組み直さずにそのまま並べる（2026-10-19 Hop 発見「別のタブを開いて戻ると組み立て中が始まる」の直し）
      const board = validBoard(d.board, keys);
      const props = Array.isArray(d.proposals)
        ? (d.proposals as unknown[]).map((p) => {
            const pp = p as Partial<BulkProposal> | null;
            const placedOk = pp ? validBoard(pp.placed, keys) : null;
            return pp && placedOk ? ({ ...pp, placed: placedOk, leftOut: Array.isArray(pp.leftOut) ? pp.leftOut : [] } as BulkProposal) : null;
          })
        : [];
      const goodProps = props.every(Boolean) && props.length > 0 ? (props as BulkProposal[]) : null;
      const restoredSig = poolSignature(valid.map((c) => ({ id: c.key, question: "", answer: c.cells })));
      if (board) {
        // 残してあった見出しがあればそれを使う（答えを変えた後の古い盤は、開き直すと組み直す）
        out.board = {
          items: board,
          searchedSig: typeof d.searchedSig === "string" ? d.searchedSig : restoredSig,
          boardSig: typeof d.boardSig === "string" ? d.boardSig : restoredSig,
          proposals: goodProps,
          picked: goodProps && typeof d.picked === "number" && goodProps[d.picked] ? d.picked : null,
        };
      }
    }
    return out;
  } catch {
    return null;
  }
};

export function CreatePage({ draftEnabled, renderTrial }: { draftEnabled: boolean; renderTrial?: (t: TrialPlay) => React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // 組み直し（/crossword/create?edit=<番号>。Hop 決定 2026-10-05）。checking = 中身を受け取り中、editing = 組み直し中（下書きに書かない・読まない【仮】）
  const editParam = draftEnabled ? searchParams.get("edit") : null;
  const [editStatus, setEditStatus] = useState<"none" | "checking" | "editing">(editParam ? "checking" : "none");
  const [editTarget, setEditTarget] = useState<MyPuzzle | null>(null);
  const editStartedRef = useRef(false);
  // 組み直しで開いた時に棚に保存してあったヒント（保存の時に outside の印を引き継ぐのに使う。Hop 決定 2026-10-21）
  const storedHintsRef = useRef<Record<string, HintRef>>({});

  // 作る｜試す（Hop 決定 2026-10-22）。作りかけには残さない（開き直すといつも「作る」から）
  const [mode, setMode] = useState<"make" | "try">("make");
  // 広げた盤の画面・語の窓・共有の窓
  const [expanded, setExpanded] = useState(false);
  const [wordSheet, setWordSheet] = useState<{ key: string; n: number } | null>(null);
  const wordSheetCount = useRef(0);
  const [shareOpen, setShareOpen] = useState(false);

  const [bulkText, setBulkText] = useState("");
  // ヒント・カギは答え（答えの字を並べた物）ごとに持つ（盤を組み直しても消えないように）
  const [hints, setHints] = useState<Record<string, HintRef>>({});
  const [hintLabels, setHintLabels] = useState<Record<string, string>>({});
  const [clues, setClues] = useState<Record<string, string>>({});
  const [puzzleTitle, setPuzzleTitle] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isBeginner, setIsBeginner] = useState(false);
  const [titleError, setTitleError] = useState(false);

  // 盤
  const [proposals, setProposals] = useState<BulkProposal[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [generatedPuzzle, setGeneratedPuzzle] = useState<PuzzleData | null>(null);
  const [backgroundPuzzle, setBackgroundPuzzle] = useState<PuzzleData | null>(null);
  // 広げた盤の「再シャッフル」の組み立ての動きの間
  const [isLiveGenerating, setIsLiveGenerating] = useState(false);
  // 書く欄の答えが変わった後、裏で組み合わせを探している間（盤は前の盤のまま見せる）
  const [searching, setSearching] = useState(false);
  const [noProposal, setNoProposal] = useState(false);
  const generationIdRef = useRef(0);
  // 最後に組み合わせを探した時の答えの並びの見出し（poolSignature）。作りかけ・組み直しで盤を戻した時は、戻した答えで埋める
  const searchedSigRef = useRef<string | null>(null);
  // 今の盤を組んだ時の答えの並びの見出し。今の答えと違えば、盤は「無い」扱いにする（答えを変えた後の古い盤で共有しないように。Hop 決定 2026-10-22）
  const [boardSig, setBoardSig] = useState<string | null>(null);

  // ヒントの欄の「① 探す」所の選択と言葉。窓は開くたびに作り直すので、この画面が持って渡す（Hop 決定 2026-10-22「グループはずっと・言葉は問題の間」）。
  // 言葉といつごろはこの画面を開いている間だけ（作りかけの控えには入れない。開き直すと空から）。グループの選択はブラウザに覚える
  const hintSearch = useHintSearch();

  // 札（× で消した札は端末に残す）
  const [tipsSeen, setTipsSeen] = useState<Record<TipName, boolean>>(() => ({
    cross: !!lsGet(TIP_KEYS.cross),
    move: !!lsGet(TIP_KEYS.move),
    saved: !!lsGet(TIP_KEYS.saved),
  }));
  const dismissTip = (name: TipName) => {
    lsSet(TIP_KEYS[name], "1");
    setTipsSeen((prev) => ({ ...prev, [name]: true }));
  };

  // 保存
  const [draftReady, setDraftReady] = useState(false);
  const savedSnapshotRef = useRef<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // 共有を押した時に outside の印を付け直したヒント（保存の送信はこれを使う）
  const saveHintsRef = useRef<Record<string, HintRef> | null>(null);
  const [showSaveCheck, setShowSaveCheck] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [sharedTitle, setSharedTitle] = useState("");

  // 語の窓のカギの欄を選んでいるか。「あと◯字」はこの間か、残りが少ない時だけ出す（Hop 決定 2026-10-22）
  const [clueFocused, setClueFocused] = useState(false);

  // 「試す」で入れた字（同じ盤の時だけ、次に「試す」を開いた時に戻す。解けた後は空から。端末には残さない）
  const trialRef = useRef<{ sig: string; answers: Record<string, string>; cleared: boolean } | null>(null);

  // --- 文字盤が出ている間（書く欄・カギの欄を選んでいる間）は小さい盤と下の段を隠す（Hop 決定 2026-10-22） ---
  // 文字盤が出る端末（指で触る端末か、見える高さが縮んだ時）だけ隠す。パソコンで書いている間は盤が目の前で育つのを見られるように隠さない
  const [fieldFocused, setFieldFocused] = useState(false);
  const [viewportShrunk, setViewportShrunk] = useState(false);
  const [coarse] = useState(coarsePointer);
  useEffect(() => {
    const isField = (el: EventTarget | null) => el instanceof HTMLElement && !!el.closest("[data-kbd-field]");
    const onIn = (e: FocusEvent) => setFieldFocused(isField(e.target));
    const onOut = (e: FocusEvent) => setFieldFocused(isField(e.relatedTarget));
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    const vv = window.visualViewport;
    const onResize = () => setViewportShrunk(!!vv && vv.height < window.innerHeight * 0.75);
    vv?.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
      vv?.removeEventListener("resize", onResize);
    };
  }, []);
  const keyboardUp = fieldFocused && (coarse || viewportShrunk);

  // --- 書いた行から答えを出す ---
  const marks = useMemo(() => parseMarks(bulkText), [bulkText]);
  const candidates: Candidate[] = useMemo(() => evaluateCandidates(marks), [marks]);
  const answers: Candidate[] = useMemo(() => candidates.filter((c) => !c.reason), [candidates]);
  const answerByKey = useMemo(() => new Map(answers.map((a) => [a.key, a])), [answers]);
  // 弾いた理由の行（答えにならない印と、答えにならず外れた行）。書いた順に並べ、書く欄の道具の段のすぐ下に出す（Hop 決定 2026-10-23）
  const reasonRows = useMemo(
    () =>
      [
        ...candidates.filter((c) => c.reason).map((c) => ({ key: `m${c.mark.start}`, start: c.mark.start, kind: c.reason as string, text: BULK_TEXTS.reasonLine(c.mark.surface, BULK_TEXTS.reasons[c.reason!]) })),
        ...lineProblems(bulkText).map((p) => ({ key: `l${p.reason}${p.start}`, start: p.start, kind: p.reason as string, text: BULK_TEXTS.reasonLine(p.head, BULK_TEXTS.lineReasons[p.reason]) })),
      ].sort((a, b) => a.start - b.start),
    [candidates, bulkText]
  );
  const pool: PuzzleItem[] = useMemo(() => answers.map((a) => ({ id: a.key, question: "", answer: a.cells })), [answers]);
  const poolSig = useMemo(() => poolSignature(pool), [pool]);
  const clueOf = (key: string): string => {
    if (clues[key] !== undefined) return clues[key];
    const a = answerByKey.get(key);
    return a ? clueDraft(bulkText, marks, a.mark, a.cells.length) : "";
  };

  // 盤（組み上がっていて、今の答えで組んだ物）。無い時は共有を押せなくし、理由を出す（Hop 決定 2026-10-22）
  const boardReady = !!generatedPuzzle && !isLiveGenerating;
  const hasBoard = boardReady && boardSig === poolSig;
  const placedKeys = useMemo(() => {
    if (!generatedPuzzle) return [] as string[];
    const on = new Set(generatedPuzzle.items.map((i) => i.id));
    const ordered = answers.filter((a) => on.has(a.key)).map((a) => a.key);
    for (const i of generatedPuzzle.items) if (!ordered.includes(i.id)) ordered.push(i.id);
    return ordered;
  }, [generatedPuzzle, answers]);
  const placedSet = useMemo(() => new Set(placedKeys), [placedKeys]);
  const unplaced = hasBoard ? pool.filter((i) => !placedSet.has(i.id)) : [];
  const boardDisconnected = boardReady && !isConnected(generatedPuzzle!.items);
  // カギとヒントを数える答え。盤がある時は盤に入った答え、無い時は答え全部（カギとヒントは答えごとに持つので、盤ができた後もそのまま使える）
  const neededKeys = hasBoard ? placedKeys : pool.map((i) => i.id);
  const hasClue = (k: string) => clueOf(k).trim() !== "";
  const missingClues = neededKeys.filter((k) => !hasClue(k)).length;
  const missingHints = neededKeys.filter((k) => !hints[k]).length;
  // 100字を超えたカギ（保存する形＝前後の空白を落とした字数で数える）
  const overClues = neededKeys.filter((k) => clueChars(clueOf(k)) > MAX_CLUE_CHARS);
  // 盤が無い・足りない時の理由。語が2つ未満・組み合わせを探している間・見つからなかった時・交差が無い時（どれも前からある文）
  const boardBlock =
    pool.length < 2
      ? CT.errors.tooFew
      : !hasBoard
        ? noProposal && !searching
          ? PROPOSAL_TEXTS.noProposal
          : CT.building
        : generatedPuzzle!.items.length < 2
          ? CT.errors.tooFew
          : generatedPuzzle!.cells.filter((c) => c.horizontalItemId && c.verticalItemId).length < 1
            ? CT.errors.noCrossing
            : "";
  // 共有を押せない理由の並び。足りない物を先頭に（Hop 決定 2026-10-22）
  const shareBlocks = [
    missingClues || missingHints ? CT.missing(missingClues, missingHints) : "",
    boardBlock,
    hasBoard && boardDisconnected ? CT.pins.notConnected : "",
    ...overClues.map((k) => BULK_TEXTS.reasonLine(k, CT.clueOver(clueChars(clueOf(k)) - MAX_CLUE_CHARS))),
  ].filter(Boolean);
  const canShare = shareBlocks.length === 0;

  // 型の案内（Hop 決定 2026-10-05・段階2）。組み上がった盤が変わった時だけ計算する
  const shapeGuide = useMemo(
    () => (generatedPuzzle ? guideTexts(suggestForBoard(generatedPuzzle.items, pool.filter((i) => !generatedPuzzle.items.some((p) => p.id === i.id)))) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generatedPuzzle]
  );

  // --- 盤の組み立て ---
  // 動かして固定した語を、今の語の一覧に合わせて持ち越す（消した語の固定は外す。置けなくなった固定は外す）。Hop 決定 2026-10-05・案A
  const carryPins = (items: PuzzleItem[]): PlacedItem[] => {
    const kept: PlacedItem[] = [];
    for (const p of generatedPuzzle?.items.filter((i) => i.pinned) ?? []) {
      const it = items.find((i) => i.id === p.id);
      if (!it) continue;
      const pin: PlacedItem = { ...p, question: it.question, answer: it.answer, length: it.answer.length, pinned: true };
      if (validatePlacement(pin, kept)) kept.push(pin);
    }
    return kept;
  };

  // 探し直す前の盤の、固定していない語の位置（今の語の一覧にある物だけ。固定した語は外す）。
  // 組み合わせ探しでつながった盤が見つからなかった時の候補に使う（Hop 決定 2026-10-21 案A の「固定を守る」に合わせて）。
  // 置ける条件は確かめ直さない: どれも同じ盤に一緒に置けていた語で、答えの字が変われば別の語になるので位置が食い違うことは無い。
  // validatePlacement で確かめ直すと、確かめる順によっては置けていた語まで外れる（2語に続けて交わる語が、後から確かめると断られる）
  const carryBase = (items: PuzzleItem[], pins: PlacedItem[]): PlacedItem[] => {
    const pinIds = new Set(pins.map((p) => p.id));
    const kept: PlacedItem[] = [];
    for (const p of generatedPuzzle?.items.filter((i) => !pinIds.has(i.id)) ?? []) {
      const it = items.find((i) => i.id === p.id);
      if (it) kept.push({ ...p, question: it.question, answer: it.answer, length: it.answer.length, pinned: false });
    }
    return kept;
  };

  // 広げた盤の動き（再シャッフルで盤が決まった瞬間に、決まった盤の字が左上から順に置かれる。Hop が見本で選んだ案 C・2026-10-21）
  const [placeFx, setPlaceFx] = useState<GridFx | null>(null);
  const placeFxId = useRef(0);

  // 盤の語を指で動かした時。置けたら固定の印を付けて盤を組み直さずに置く
  const handleMoveWord = (uuid: string, startX: number, startY: number): boolean => {
    if (!generatedPuzzle || isLiveGenerating || searching) return false;
    const moved = moveItem(generatedPuzzle.items, uuid, startX, startY);
    if (!moved) return false;
    const prev = generatedPuzzle;
    setPlaceFx(null);
    setGeneratedPuzzle({ ...buildGrid(moved), id: prev.id, title: prev.title, creatorName: prev.creatorName });
    setPicked(null);
    return true;
  };

  // 「再シャッフル」と「固定を外す」: HarmonyPalette と同じ組み立ての動き（50通りの試行が描き変わり、置けた語が最多で面積が最小のものに決まる）。
  // 演出の50回とは別に、全部の語が置けるまで（または時間の上限まで）裏で試行を続ける（Hop 決定 2026-10-05）
  const triggerGeneration = async (items: PuzzleItem[], pinsOverride?: PlacedItem[]) => {
    const pinned = pinsOverride ?? carryPins(items);
    if (items.length === 0) {
      setGeneratedPuzzle(null);
      setBackgroundPuzzle(null);
      return;
    }
    const currentGenId = ++generationIdRef.current;
    const sig = poolSignature(items);
    setIsLiveGenerating(true);
    setSearching(false);
    setPicked(null);
    setPlaceFx(null);
    const still = prefersReducedMotion();
    try {
      const generator = generateMonteCarloSteps(items, ANIMATION_STEPS, pinned);
      const search = createPuzzleSearch(items, undefined, undefined, pinned);
      let bestPuzzle: PuzzleData | null = null;
      let bestCount = 0;
      let bestArea = Infinity;
      for (const st of generator) {
        const tickStart = performance.now();
        search.step(SEARCH_STEP_MS);
        if (generationIdRef.current !== currentGenId) return;
        if (st.placed.length > 0) {
          const puzzle = buildGrid(st.placed);
          if (!still) setBackgroundPuzzle(puzzle);
          const area = puzzle.width * puzzle.height;
          if (st.placed.length > bestCount || (st.placed.length === bestCount && area < bestArea)) {
            bestCount = st.placed.length;
            bestArea = area;
            bestPuzzle = puzzle;
          }
        }
        // 1回100ms（50回で5秒）。「動きを減らす」設定では待たずに進める
        await sleep(still ? 0 : Math.max(0, 100 - (performance.now() - tickStart)));
      }
      while (!search.finished()) {
        if (generationIdRef.current !== currentGenId) return;
        search.step(SEARCH_STEP_MS);
        await sleep(0);
      }
      if (generationIdRef.current !== currentGenId) return;
      const found = search.best();
      if (found.length > 0 && isBetterPlacement(found, search.bestArea(), bestPuzzle ? bestPuzzle.items : null, bestArea)) bestPuzzle = buildGrid(found);
      if (bestPuzzle) {
        setGeneratedPuzzle(bestPuzzle);
        setBoardSig(sig);
        searchedSigRef.current = sig;
        setPlaceFx({ id: ++placeFxId.current, place: true });
      }
    } catch (error) {
      console.error("[MonteCarloAnim] Error:", error);
    } finally {
      if (generationIdRef.current === currentGenId) {
        setIsLiveGenerating(false);
        setBackgroundPuzzle(null);
      }
    }
  };

  // 案を選ぶ（選んだ案の盤をそのまま出す）。案はどれも固定した語を同じ座標に置いて組んだ物なので、固定の印はそのまま残す（Hop 決定 2026-10-21 案A）
  const pickProposal = (i: number) => {
    const p = proposals?.[i];
    if (!p) return;
    ++generationIdRef.current;
    setIsLiveGenerating(false);
    setSearching(false);
    setBackgroundPuzzle(null);
    setPlaceFx(null);
    setPicked(i);
    setGeneratedPuzzle(buildGrid(p.placed));
    // 案は最後に探した時の答えで組んだ物
    setBoardSig(searchedSigRef.current);
  };

  // 書く欄の答えが変わった時: 裏で本番の組み合わせ探し（bulkSelect）を回し、上位3つを案1〜3にして案1の盤を出す（Hop 決定 2026-10-22「言葉を足すと盤が目の前で育つ」）。
  // 組み立ての動き（試行が描き変わる）は見せない。探している間も前の盤を出したままにし、打つのを待たせない（刻んで回す）。
  // 動かして固定した語は、その位置を守り、その語を土台に残りの語だけを組む（Hop 決定 2026-10-21 案A）。消した語・字を変えた語の固定は外れる
  const autoSearch = async (items: PuzzleItem[]) => {
    const pinned = carryPins(items);
    const base = pinned.length > 0 ? carryBase(items, pinned) : [];
    const run = ++generationIdRef.current;
    const sig = poolSignature(items);
    adoptedUnsettledRef.current = false;
    setIsLiveGenerating(false);
    setBackgroundPuzzle(null);
    setSearching(true);
    setNoProposal(false);
    try {
      const search = createBulkSearch(items, { pinned, base });
      while (!search.finished()) {
        if (generationIdRef.current !== run) return;
        search.step(SEARCH_STEP_MS);
        await sleep(0);
      }
      if (generationIdRef.current !== run) return;
      const list = search.proposals();
      searchedSigRef.current = sig;
      setProposals(list);
      setPlaceFx(null);
      if (list.length > 0) {
        setPicked(0);
        setGeneratedPuzzle(buildGrid(list[0].placed));
        setBoardSig(sig);
      } else {
        setPicked(null);
        setNoProposal(true);
      }
    } catch (error) {
      console.error("[BulkSearch] Error:", error);
    } finally {
      if (generationIdRef.current === run) setSearching(false);
    }
  };

  // 作りかけ・組み直しを読み終えてから組み始める（読み終える前に見本や空の答えで組まない）
  const loaded = editStatus === "editing" || (editStatus === "none" && (draftReady || !draftEnabled));
  useEffect(() => {
    if (!loaded) return;
    if (pool.length === 0) {
      ++generationIdRef.current;
      setSearching(false);
      setIsLiveGenerating(false);
      setNoProposal(false);
      setProposals(null);
      setPicked(null);
      setGeneratedPuzzle(null);
      setBoardSig(null);
      searchedSigRef.current = poolSig;
      return;
    }
    if (poolSig === boardSig || poolSig === searchedSigRef.current) return;
    const items = pool;
    const t = window.setTimeout(() => void autoSearch(items), AUTO_SEARCH_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [loaded, poolSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // 画面を離れたら組み立てをやめる
  useEffect(() => () => void generationIdRef.current++, []);

  // --- 組み直し: 端末の控えの合言葉で中身を受け取り、書いた行・カギ・ヒント・盤に戻す（Hop 決定 2026-10-05） ---
  // 語は書く欄の【語】の1語1行として戻す【仮】。盤は保存した時の形のまま「作る」から始める【仮】
  useEffect(() => {
    if (editStatus !== "checking" || !editParam || editStartedRef.current) return;
    editStartedRef.current = true;
    const fail = (message: string) => {
      toast.error(message, { duration: 5000 });
      setEditStatus("none");
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("edit");
          return next;
        },
        { replace: true }
      );
    };
    const mine = readMyPuzzles().find((m) => m.id === editParam);
    if (!mine) {
      fail(CT.edit.notEditable);
      return;
    }
    fetchOwnedPuzzle(mine.id, mine.key)
      .then((owned) => {
        if (!owned) return fail(CT.edit.notEditable);
        // 遊ばれた後は組み直せないが、ヒントだけは差し替えられる画面へ回す（Hop 決定 2026-10-19）
        if ((owned.puzzle.play_count ?? 0) > 0) {
          navigate(`/crossword/hints/${mine.id}`, { replace: true });
          return;
        }
        const rec = owned.puzzle;
        const saved = rec.body?.clues;
        if (!Array.isArray(saved) || saved.length !== owned.answers.length) return fail(CT.edit.notEditable);
        const placed: PlacedItem[] = [];
        const restoredHints: Record<string, HintRef> = {};
        const restoredClues: Record<string, string> = {};
        const lines: string[] = [];
        saved.forEach((c, i) => {
          const answer = toCells(owned.answers[i].join(""));
          const key = answer.join("");
          if (placed.some((p) => p.id === key)) return;
          placed.push({ id: key, uuid: key, question: "", answer, direction: c.direction, startX: c.startX, startY: c.startY, length: answer.length, clueIndex: c.clueIndex });
          if (c.hint) restoredHints[key] = c.hint;
          restoredClues[key] = c.clue;
          lines.push(`【${key}】`);
        });
        setPuzzleTitle(rec.title);
        setCreatorName(rec.body.creatorName ?? "");
        setTags(Array.isArray(rec.tags) ? rec.tags : []);
        setIsBeginner(rec.is_beginner === true);
        setBulkText(lines.join("\n"));
        setClues(restoredClues);
        setHints(restoredHints);
        storedHintsRef.current = restoredHints;
        // 盤は保存した時の形のまま（番号も同じ）。組み替えたい時は広げた盤の「再シャッフル」
        setGeneratedPuzzle(buildGrid(placed));
        searchedSigRef.current = poolSignature(placed);
        setBoardSig(searchedSigRef.current);
        setEditTarget({ ...mine, title: rec.title });
        setEditStatus("editing");
      })
      .catch((err) => {
        console.error("Failed to load own puzzle:", err);
        fail(CT.edit.notEditable);
      });
  }, [editStatus, editParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- 作りかけを戻す（組み直しの間は読まない・書かない【仮】）。作りかけが無い時だけ見本の3行で始める（Hop 決定 2026-10-22） ---
  // 別のタブの組んでいる途中の中身に入れ替えて、このタブでは組まずに待っている間
  const adoptedUnsettledRef = useRef(false);
  // 読み取った作りかけを画面に入れる。replace = 別のタブで書き換えられた中身に入れ替える時（無い欄は空に戻し、盤が無ければ盤も外す）
  const applyDraft = (d: ParsedDraft, replace: boolean) => {
    if (d.title !== undefined || replace) setPuzzleTitle(d.title ?? "");
    if (d.creatorName !== undefined || replace) setCreatorName(d.creatorName ?? "");
    if (d.tags !== undefined || replace) setTags(d.tags ?? []);
    if (d.isBeginner !== undefined || replace) setIsBeginner(d.isBeginner ?? false);
    setBulkText(d.bulkText);
    setHints(d.hints);
    setClues(d.clues);
    setHintLabels(d.hintLabels);
    if (replace) {
      // 組み立ての動き・裏の組み合わせ探しは止める（入れ替えた中身で必要なら組み直す）
      ++generationIdRef.current;
      setIsLiveGenerating(false);
      setSearching(false);
      setBackgroundPuzzle(null);
      setNoProposal(false);
      setPlaceFx(null);
    }
    if (d.board) {
      setGeneratedPuzzle(buildGrid(d.board.items));
      searchedSigRef.current = d.board.searchedSig;
      setBoardSig(d.board.boardSig);
      setProposals(d.board.proposals);
      setPicked(d.board.picked);
    } else if (replace) {
      setGeneratedPuzzle(null);
      setBoardSig(null);
      setProposals(null);
      setPicked(null);
      searchedSigRef.current = null;
    }
    if (replace) {
      // 別のタブがまだ盤を組んでいる途中の中身なら、このタブでは組み始めない（両方で組むと、組んだ盤を互いに書き合う）。
      // 別のタブの組み上がった盤が届けばそれに合わせる。届かないままこのタブに戻った時は、このタブで組む
      const sig = poolSignature(evaluateCandidates(parseMarks(d.bulkText)).filter((c) => !c.reason).map((c) => ({ id: c.key, question: "", answer: c.cells })));
      const settled = !!d.board && d.board.boardSig === sig;
      adoptedUnsettledRef.current = !settled && sig !== poolSignature([]);
      if (!settled) searchedSigRef.current = sig;
    }
  };
  useEffect(() => {
    if (editStatus !== "none" || draftReady) return;
    if (!draftEnabled) {
      setBulkText(CT.sample);
      return;
    }
    const raw = lsGet(DRAFT_KEY);
    const d = raw ? parseDraft(raw) : null;
    if (raw && !d) lsRemove(DRAFT_KEY);
    if (d) applyDraft(d, false);
    else setBulkText(CT.sample);
    setDraftReady(true);
  }, [draftEnabled, editStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- 作りかけを残す（変えるたびに端末へ。保存に成功した直後の中身は書かない） ---
  const boardForDraft = generatedPuzzle && !isLiveGenerating ? generatedPuzzle.items.map(({ id, uuid, answer, direction, startX, startY, length, pinned }) => ({ id, uuid, question: "", answer, direction, startX, startY, length, pinned: !!pinned })) : null;
  const draftContent = () => ({
    bulkText,
    hints,
    hintLabels,
    clues,
    board: boardForDraft,
    proposals,
    picked,
    boardSig,
    searchedSig: searchedSigRef.current,
    title: puzzleTitle,
    creatorName,
    tags,
    isBeginner,
  });
  // 最後に残した組み上がった盤の分（組み立て中・探している間に書いた物を残す時に使う）
  const stableBoardRef = useRef<Pick<DraftV3, "board" | "proposals" | "picked" | "boardSig" | "searchedSig"> | null>(null);
  // 別のタブで書き換えられた作りかけに入れ替えた直後の中身（同じ中身のままの間は書き戻さない。2つのタブで書き合いを続けないため）。
  // "" = 入れ替えた直後で、まだ中身を控えていない
  const adoptedSnapRef = useRef<string | null>(null);
  const [adoptTick, setAdoptTick] = useState(0);
  // 「別のタブで書いた中身に合わせました。」を出したか（このタブを見ている間は1回だけ。このタブで書くか、離れて戻ると出し直せる）
  const otherTabNoticeRef = useRef(false);
  useEffect(() => {
    if (!draftEnabled || !draftReady || editStatus !== "none") return;
    const empty = !bulkText.trim() && !puzzleTitle && !creatorName && tags.length === 0;
    const content = draftContent();
    const snap = JSON.stringify(content);
    if (adoptedSnapRef.current !== null) {
      if (adoptedSnapRef.current === "") {
        adoptedSnapRef.current = snap;
        if (!isLiveGenerating && !searching) stableBoardRef.current = { board: content.board, proposals: content.proposals, picked: content.picked, boardSig: content.boardSig, searchedSig: content.searchedSig };
        return;
      }
      if (adoptedSnapRef.current === snap) return;
      adoptedSnapRef.current = null;
    }
    if (empty) {
      lsRemove(DRAFT_KEY);
      return;
    }
    if (savedSnapshotRef.current !== null) {
      if (savedSnapshotRef.current === snap) return;
      savedSnapshotRef.current = null;
    }
    otherTabNoticeRef.current = false;
    // 組み立て中・探している間の途中の盤は残さない（組み上がってから残す）。その間に書いた文・カギ・ヒント・題名などは、
    // 最後に残した組み上がった盤と一緒に残す（再シャッフルの直後に書いてすぐ閉じても消えないように。Hop 決定 2026-10-23）
    if (isLiveGenerating || searching) {
      const d: DraftV3 = { version: 3, ...content, ...(stableBoardRef.current ?? {}) };
      lsSet(DRAFT_KEY, JSON.stringify(d));
      return;
    }
    stableBoardRef.current = { board: content.board, proposals: content.proposals, picked: content.picked, boardSig: content.boardSig, searchedSig: content.searchedSig };
    const d: DraftV3 = { version: 3, ...content };
    lsSet(DRAFT_KEY, JSON.stringify(d));
  }, [draftEnabled, draftReady, editStatus, bulkText, hints, hintLabels, clues, generatedPuzzle, isLiveGenerating, searching, proposals, picked, boardSig, puzzleTitle, creatorName, tags, isBeginner, adoptTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- 別のタブで作りかけが書き換えられたら、このタブの中身もそれに入れ替える（Hop 決定 2026-10-23）。組み直し（?edit=）の間は作りかけを使わないので見ない ---
  // 人が書いた所（文・カギ・ヒント・題名など）が違う時だけ「別のタブで書いた中身に合わせました。」を出す。盤だけ違う時は黙って合わせる。
  // 作りかけが消された時（別のタブで公開した・空にした）は、このタブの中身はそのまま残す【仮】
  // このタブに戻った時に、組まずに待っていた盤を組む（最新の答えで）
  const resumeSearchRef = useRef(() => {});
  resumeSearchRef.current = () => {
    if (pool.length === 0 || poolSig === boardSig) return;
    void autoSearch(pool);
  };
  const authoredRef = useRef("");
  authoredRef.current = authoredSig({ bulkText, hints, hintLabels, clues, title: puzzleTitle, creatorName, tags, isBeginner });
  const boardPartRef = useRef("");
  boardPartRef.current = JSON.stringify(boardForDraft);
  const wordSheetRef = useRef(wordSheet);
  wordSheetRef.current = wordSheet;
  const hintsRef = useRef(hints);
  hintsRef.current = hints;
  useEffect(() => {
    if (!draftEnabled || !draftReady || editStatus !== "none") return;
    let noticeLater = false;
    const notice = () => {
      if (otherTabNoticeRef.current) return;
      otherTabNoticeRef.current = true;
      toast.success(CT.otherTabSynced, { duration: 5000 });
    };
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea !== localStorage || e.key !== DRAFT_KEY || e.newValue === null) return;
      const d = parseDraft(e.newValue);
      if (!d) return;
      const authoredChanged = authoredSig({ ...d, title: d.title ?? "", creatorName: d.creatorName ?? "", tags: d.tags ?? [], isBeginner: d.isBeginner ?? false }) !== authoredRef.current;
      const boardChanged = JSON.stringify(d.board ? d.board.items.map(({ id, uuid, answer, direction, startX, startY, length, pinned }) => ({ id, uuid, question: "", answer, direction, startX, startY, length, pinned: !!pinned })) : null) !== boardPartRef.current;
      if (!authoredChanged && !boardChanged) return;
      adoptedSnapRef.current = "";
      savedSnapshotRef.current = null;
      applyDraft(d, true);
      setAdoptTick((n) => n + 1);
      // 開いている語の窓は、その答えが無くなったら閉じ、ヒントが替わったら開き直して新しいヒントを見せる
      const ws = wordSheetRef.current;
      if (ws) {
        const keys = new Set(evaluateCandidates(parseMarks(d.bulkText)).filter((c) => !c.reason).map((c) => c.key));
        if (!keys.has(ws.key)) setWordSheet(null);
        else if (JSON.stringify(d.hints[ws.key] ?? null) !== JSON.stringify(hintsRef.current[ws.key] ? draftHint(hintsRef.current[ws.key]) : null)) {
          wordSheetCount.current += 1;
          setWordSheet({ key: ws.key, n: wordSheetCount.current });
        }
      }
      if (!authoredChanged) return;
      // 見ていないタブ（隠れている・ほかの窓を使っている）では、このタブに戻った時に出す
      if (looking()) notice();
      else noticeLater = true;
    };
    const looking = () => document.visibilityState === "visible" && document.hasFocus();
    const onBack = () => {
      if (!looking()) return;
      if (adoptedUnsettledRef.current) {
        adoptedUnsettledRef.current = false;
        resumeSearchRef.current();
      }
      if (!noticeLater) return;
      noticeLater = false;
      notice();
    };
    // このタブを離れたら、次に戻った時にはまた知らせを出せるようにする
    const onAway = () => {
      if (!looking()) otherTabNoticeRef.current = false;
    };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onBack);
    document.addEventListener("visibilitychange", onAway);
    window.addEventListener("focus", onBack);
    window.addEventListener("blur", onAway);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onBack);
      document.removeEventListener("visibilitychange", onAway);
      window.removeEventListener("focus", onBack);
      window.removeEventListener("blur", onAway);
    };
  }, [draftEnabled, draftReady, editStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- 窓が開いている間は後ろの画面をスクロールさせない（窓の中と外で二重にスクロールしない） ---
  const anySheet = !!wordSheet || shareOpen || showShareModal || expanded;
  useEffect(() => {
    if (!anySheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [anySheet]);

  const closeWordSheet = () => setWordSheet(null);
  const closeShare = () => {
    if (!isSaving) setShareOpen(false);
  };
  const wordDialog = useDialog({ active: !!wordSheet, onClose: closeWordSheet });
  const boardDialog = useDialog({ active: expanded, onClose: () => setExpanded(false) });
  const shareSheetDialog = useDialog({ active: shareOpen && !showSaveCheck, onClose: closeShare });
  const shareDialog = useDialog({ active: showShareModal, onClose: () => closeSaved() });

  const openWordSheet = (key: string) => {
    wordSheetCount.current += 1;
    setClueFocused(false);
    setWordSheet({ key, n: wordSheetCount.current });
  };
  const setHintFor = (key: string, h: HintRef | null, label?: string) => {
    setHints((prev) => {
      if (!h) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: h };
    });
    if (h && label) setHintLabels((prev) => (prev[key] === label ? prev : { ...prev, [key]: label }));
  };

  const switchMode = (m: "make" | "try") => {
    if (m === mode) return;
    setExpanded(false);
    setWordSheet(null);
    setShareOpen(false);
    setMode(m);
    window.scrollTo(0, 0);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t || tags.length >= MAX_TAGS || tags.includes(t)) {
      setTagInput("");
      return;
    }
    setTags([...tags, t]);
    setTagInput("");
  };

  // --- 動き（Hop「モーションも付けれるだけ付けたろ」2026-10-22）。どれも「動きを減らす」設定では止まり、入力は止めない ---

  // 小さい盤が育つ時: 新しく増えたマスだけが置かれる（全部を並べ直さない）。動きは決まった盤の字が置かれる動きと同じ（透明・0.6倍から 0.2秒。1マス20msずつ）。
  // 文字盤で隠れている間・広げた盤を開いている間に育った分は、小さい盤が見えた時に置く（最後に見せた盤と比べる）
  const miniPuzzle = generatedPuzzle && pool.length > 0 && !(noProposal && !searching) ? generatedPuzzle : null;
  const miniVisible = mode === "make" && !keyboardUp && !expanded;
  const [miniFx, setMiniFx] = useState<GridFx | null>(null);
  const miniFxId = useRef(0);
  const lastSeenIdsRef = useRef<Set<string> | null>(null);
  useLayoutEffect(() => {
    if (!miniVisible || !miniPuzzle) return;
    const byCell = cellIdsOf(miniPuzzle);
    const last = lastSeenIdsRef.current;
    lastSeenIdsRef.current = new Set([...byCell.values()].flat());
    if (last === null) return; // 開いた時の盤はそのまま出す
    const fresh = [...byCell.entries()].filter(([, ids]) => !ids.some((id) => last.has(id))).map(([k]) => k);
    if (fresh.length === 0) return;
    const [x0, y0] = fresh
      .map((k) => k.split(",").map(Number))
      .reduce((a, b) => (b[0] + b[1] < a[0] + a[1] ? b : a));
    const placeKeys: Record<string, number> = {};
    fresh.forEach((k) => {
      const [x, y] = k.split(",").map(Number);
      placeKeys[k] = (Math.abs(x - x0) + Math.abs(y - y0)) * 20;
    });
    setMiniFx({ id: ++miniFxId.current, placeKeys });
  }, [miniPuzzle, miniVisible]);

  // 語の一覧（下線の動きで行を探す）
  const listRef = useRef<HTMLDivElement>(null);

  // 弾いた理由の行が増えた時: 下の段に隠れていたら見える所まで送る（Hop 決定 2026-10-23「理由の行が下の段に隠れる」の直し）。
  // 打つたびには送らず、理由の行の並びが変わった時だけ。窓が開いている間・「試す」の間は送らない
  const reasonsRef = useRef<HTMLDivElement>(null);
  const reasonSig = reasonRows.map((r) => r.kind + r.text).join("|");
  // 開いた時（作りかけ・組み直しを読み終えた時）にある理由の行では送らない
  const prevReasonKeys = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const prev = prevReasonKeys.current;
    const now = new Set(reasonRows.map((r) => r.kind + r.text));
    prevReasonKeys.current = now;
    if (prev === null || ![...now].some((k) => !prev.has(k)) || mode !== "make" || anySheet) return;
    const el = reasonsRef.current;
    if (!el) return;
    // 小さい盤と下の段が隠れる・戻る動き（120ms）の後で測る
    const t = window.setTimeout(() => el.scrollIntoView({ block: "nearest" }), HIDE_MS + 30);
    return () => window.clearTimeout(t);
  }, [reasonSig, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  // 文字盤を閉じて小さい盤と下の段が戻った時も、理由の行が下の段に隠れたら見える所まで送る（小さい盤の 110px ぶん下へずれるため）
  const prevKeyboardUp = useRef(keyboardUp);
  useEffect(() => {
    const was = prevKeyboardUp.current;
    prevKeyboardUp.current = keyboardUp;
    if (!was || keyboardUp || reasonRows.length === 0 || mode !== "make" || anySheet) return;
    const t = window.setTimeout(() => {
      const el = reasonsRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top > window.innerHeight - DOCK_H - 8 || r.bottom > window.innerHeight - DOCK_H) el.scrollIntoView({ block: "nearest" });
    }, HIDE_MS + 30);
    return () => window.clearTimeout(t);
  }, [keyboardUp]); // eslint-disable-line react-hooks/exhaustive-deps

  // 【 】で囲んだ瞬間: 語の一覧に増えた語の答えの下に、下線が左から引かれる（400ms・cubic-bezier(0.4,0,0.2,1)。モーションの枝の作り・Hop が見本で選んだ案 B）。
  // 案A では書く欄に下線が無いので、語の一覧の行で引く。引き終えたら 180ms で消す（一覧の行に下線は残さない）。
  // 打っている途中の答え（【ライ】→【ライブ】）で何度も引かないよう、答えが落ち着いてから（盤を組み始めるのと同じ待ちの後に）増えた語だけ。
  // 文字盤が出ている間・行が画面の外にある間は覚えておき、行が見えた時に引く
  const settledKeysRef = useRef<Set<string> | null>(null);
  const pendingLinesRef = useRef<Set<string>>(new Set());
  const answerKeysSig = answers.map((a) => a.key).join("|");
  const drawUnderline = (key: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-word-row="${CSS.escape(key)}"] [data-word-line]`);
    if (!el || prefersReducedMotion() || typeof el.animate !== "function") return true;
    const r = el.getBoundingClientRect();
    if (r.bottom < HEAD_H || r.top > window.innerHeight - DOCK_H) return false;
    el.animate(
      [
        { transform: "scaleX(0)", opacity: 1, offset: 0 },
        { transform: "scaleX(1)", opacity: 1, offset: 400 / 580 },
        { transform: "scaleX(1)", opacity: 0, offset: 1 },
      ],
      { duration: 580, easing: EASE_STANDARD }
    );
    return true;
  };
  const flushUnderlines = () => {
    if (mode !== "make" || keyboardUp || anySheet) return;
    for (const key of [...pendingLinesRef.current]) if (drawUnderline(key)) pendingLinesRef.current.delete(key);
  };
  const flushUnderlinesRef = useRef(flushUnderlines);
  flushUnderlinesRef.current = flushUnderlines;
  useEffect(() => {
    if (!loaded) return;
    const keys = answerKeysSig ? answerKeysSig.split("|") : [];
    const t = window.setTimeout(() => {
      const prev = settledKeysRef.current;
      settledKeysRef.current = new Set(keys);
      if (prev === null) return; // 開いた時の語には引かない
      for (const k of keys) if (!prev.has(k)) pendingLinesRef.current.add(k);
      for (const k of [...pendingLinesRef.current]) if (!keys.includes(k)) pendingLinesRef.current.delete(k);
      flushUnderlinesRef.current();
    }, AUTO_SEARCH_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [answerKeysSig, loaded]);
  useEffect(() => {
    flushUnderlinesRef.current();
  }, [keyboardUp, anySheet, mode]);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (pendingLinesRef.current.size === 0) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => flushUnderlinesRef.current());
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // 足りない物が全部そろった時: 共有の窓の文がふわっと替わる（Hop が見本で選んだ案 B・2026-10-21。そろった状態で開いた時は動かさない）。
  // 「共有へ」で窓を開いた時に足りない物が出る時も、同じ動きで少し遅れて出す
  const blocksRef = useRef<HTMLParagraphElement>(null);
  const prevCanShare = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    const prev = prevCanShare.current;
    prevCanShare.current = shareOpen ? canShare : null;
    const el = blocksRef.current;
    if (!shareOpen || !el) return;
    if (prev === null) {
      if (!canShare) animateElement(el, { opacity: 0, y: 2 }, { opacity: 1, y: 0 }, { ...WEAK, delay: 0.1 });
      return;
    }
    if (!prev && canShare) animateElement(el, { opacity: 0, y: 2 }, { opacity: 1, y: 0 }, WEAK);
  }, [canShare, shareOpen]);

  // --- 保存（もとの作る画面の handleShare・saveWithToken・updateEdited と同じ。ジャンルは常に hello） ---
  const itemsToSave = (): PlacedItem[] => (generatedPuzzle ? generatedPuzzle.items.map((i) => ({ ...i, question: clueOf(i.id).trim() })) : []);

  const handleShare = async () => {
    // 盤が無い・足りない物がある時は保存しない（押せない理由を出している。Hop 決定 2026-10-22）
    if (!generatedPuzzle || !hasBoard || !canShare) return;
    if (!isConnected(generatedPuzzle.items)) return;
    if (generatedPuzzle.items.some((i) => !hints[i.id] || !clueOf(i.id).trim() || clueChars(clueOf(i.id)) > MAX_CLUE_CHARS)) return;
    const title = puzzleTitle.trim();
    if (!title) {
      setTitleError(true);
      return;
    }
    if (generatedPuzzle.items.length < 2) {
      toast.error(CT.errors.tooFew);
      return;
    }
    if (generatedPuzzle.cells.filter((c) => c.horizontalItemId && c.verticalItemId).length < 1) {
      toast.error(CT.errors.noCrossing, { duration: 5000 });
      return;
    }
    setIsSaving(true);
    // 保存の直前に、盤に入った答えの YouTube のヒントへ outside の印を台帳で確かめて付け直す（もとの作る画面と同じ。Hop 決定 2026-10-21 チャンネル名を出さない）。
    // 組み直しでは、保存してあった動画と同じ番号なら印を引き継ぐ（台帳から消えた動画の「見られなくなりました」が黙って消えないように）。
    // 台帳を確かめられなければ保存を止めて知らせる
    let marked: Record<string, HintRef>;
    try {
      const placedHints = Object.fromEntries(generatedPuzzle.items.map((i) => [i.id, hints[i.id]!]));
      marked = await withOutsideMarks(placedHints, editTarget ? Object.values(storedHintsRef.current) : []);
    } catch (error) {
      console.error("Failed to check hint videos:", error);
      toast.error(CT.errors.saveFailed, { duration: 5000 });
      setIsSaving(false);
      return;
    }
    saveHintsRef.current = marked;
    // 組み直しは人間確認を挟まない【仮】（合言葉が本人確認を兼ねる）
    if (editTarget) {
      void updateEdited(marked);
      return;
    }
    setShowSaveCheck(true);
  };

  const updateEdited = async (savedHints: Record<string, HintRef>) => {
    if (!generatedPuzzle || !editTarget) {
      setIsSaving(false);
      return;
    }
    const title = puzzleTitle.trim();
    try {
      const body = toBody(itemsToSave(), generatedPuzzle.width, generatedPuzzle.height, (id) => savedHints[id]);
      if (creatorName.trim()) body.creatorName = creatorName.trim();
      const ogpImage = await drawShareImage(generatedPuzzle, title);
      await updatePuzzle(editTarget.id, editTarget.key, { title, genre: "hello", tags, body, isBeginner }, { ogpImage });
      const updated = { ...editTarget, title };
      addMyPuzzle(updated);
      setEditTarget(updated);
      setShareUrl(`${window.location.origin}/crossword/${editTarget.id}`);
      setSharedTitle(title);
      setShareOpen(false);
      setShowShareModal(true);
    } catch (error) {
      console.error("Failed to update puzzle:", error);
      const reason = error instanceof SaveError ? error.reason : "";
      const message = reason === "already_played" ? CT.edit.alreadyPlayed : reason === "not_found" ? CT.edit.notEditable : CT.saveReasons[reason] ?? CT.errors.saveFailed;
      toast.error(message, { duration: 5000 });
      // もう遊ばれていたら、ヒントだけ差し替えられる画面へ回す（紙「遊ばれた後の ?edit= はヒント差し替えの画面へ回す」と同じ。Hop 決定 2026-10-19）。
      // 組み直しで直した答え・カギ・ヒントは、画面の移動に持たせて渡す（Hop 決定 2026-10-23「直したヒントを引き継ぐ」）。
      // 組み直しの中身は作りかけの控えに書かない（別の作りかけを上書きしないため）
      if (reason === "already_played") {
        const carry: EditCarry = {
          kind: "edit-carry",
          id: editTarget.id,
          items: generatedPuzzle.items.map((i) => ({ answer: i.id, clue: clueOf(i.id).trim(), hint: hints[i.id] ? draftHint(hints[i.id]) : null })),
        };
        navigate(`/crossword/hints/${editTarget.id}`, { replace: true, state: carry });
        return;
      }
    } finally {
      setIsSaving(false);
    }
  };

  // 公開できた後の窓を閉じる。「次の問題を作る」を押さずに閉じた時は、題名とタグだけを空にする（書いた文・カギ・ヒントは残す。Hop 決定 2026-10-23）。
  // 組み直しの更新の後は何も空にしない
  const closeSaved = () => {
    setShowShareModal(false);
    if (editTarget) return;
    setPuzzleTitle("");
    setTags([]);
    setTagInput("");
  };
  // 次の問題を作る: 作りかけの書いた文・カギ・ヒント・題名・タグ・初めての人向けを空にする。作った人の名前だけ残す。書く欄は見本でなく空（Hop 決定 2026-10-23）
  const bulkAreaFocusRef = useRef(false);
  const startNextPuzzle = () => {
    setShowShareModal(false);
    setBulkText("");
    setClues({});
    setHints({});
    setHintLabels({});
    setPuzzleTitle("");
    setTags([]);
    setTagInput("");
    setIsBeginner(false);
    setTitleError(false);
    trialRef.current = null;
    savedSnapshotRef.current = null;
    setMode("make");
    setExpanded(false);
    setWordSheet(null);
    window.scrollTo(0, 0);
    // 窓を閉じた後に書く欄から始める（窓の作法がフォーカスを戻した後で、書く欄へ移す）
    bulkAreaFocusRef.current = true;
  };
  useEffect(() => {
    if (showShareModal || !bulkAreaFocusRef.current) return;
    bulkAreaFocusRef.current = false;
    const t = window.setTimeout(() => document.querySelector<HTMLTextAreaElement>("[data-bulk-text]")?.focus({ preventScroll: true }), 50);
    return () => window.clearTimeout(t);
  }, [showShareModal]);

  const cancelSaveCheck = () => {
    setShowSaveCheck(false);
    setIsSaving(false);
  };

  const saveWithToken = async (token: string, website: string) => {
    setShowSaveCheck(false);
    if (!generatedPuzzle) {
      setIsSaving(false);
      return;
    }
    const savedHints = saveHintsRef.current;
    if (!savedHints) {
      setIsSaving(false);
      return;
    }
    const title = puzzleTitle.trim();
    try {
      const body = toBody(itemsToSave(), generatedPuzzle.width, generatedPuzzle.height, (id) => savedHints[id]);
      if (creatorName.trim()) body.creatorName = creatorName.trim();
      const key = makeOwnerKey();
      const ogpImage = await drawShareImage(generatedPuzzle, title);
      // ジャンルは「ハロプロ」だけ（Hop 決定 2026-10-20）
      const id = await savePuzzle({ title, genre: "hello", tags, body, isBeginner }, { key, token, website, ogpImage });
      addMyPuzzle({ id, title, key, createdAt: Date.now() });
      setShareUrl(`${window.location.origin}/crossword/${id}`);
      setSharedTitle(title);
      // 保存できたので作りかけの控えは消す（このあと中身を変えたら、また新しく残り始める）
      lsRemove(DRAFT_KEY);
      savedSnapshotRef.current = JSON.stringify(draftContent());
      setShareOpen(false);
      setShowShareModal(true);
    } catch (error) {
      console.error("Failed to save puzzle:", error);
      const reason = error instanceof SaveError ? error.reason : "";
      toast.error(CT.saveReasons[reason] ?? CT.errors.saveFailed, { duration: 5000 });
    } finally {
      setIsSaving(false);
    }
  };

  // --- 札（1行・右端に ×・幕なし） ---
  const Tip = ({ name }: { name: TipName }) => (
    <div data-tip={name} className="bg-surface-container-low pl-3 flex items-center gap-2 text-sm" style={{ color: C.ink }}>
      <span className="flex-1 min-w-0 py-3">{CT.tips[name]}</span>
      <button type="button" onClick={() => dismissTip(name)} aria-label={CT.tips.close} className="w-11 h-11 shrink-0 flex items-center justify-center hover:bg-surface-container-high transition-colors" style={{ color: C.secondary }}>
        <Icon icon="close" />
      </button>
    </div>
  );

  if (editStatus === "checking") {
    return (
      <div className="min-h-screen bg-surface">
        <Toaster />
      </div>
    );
  }

  const sheetEntry = wordSheet ? wordSheet.key : null;
  const sheetHint = sheetEntry ? hints[sheetEntry] : undefined;
  const sheetClue = sheetEntry ? clueOf(sheetEntry) : "";
  const stats = hasBoard && generatedPuzzle ? PROPOSAL_TEXTS.stats(generatedPuzzle.items.length, generatedPuzzle.cells.length, generatedPuzzle.cells.filter((c) => (c.wordIds?.length ?? 0) >= 2).length) : "";

  // 「試す」に渡す盤（盤に入った答えと、今のカギ・ヒント）。カギが空の語は空のまま解ける
  const trialPlay = (): TrialPlay | null => {
    if (!hasBoard || !generatedPuzzle) return null;
    const sig = boardSignature(generatedPuzzle);
    const prev = trialRef.current;
    const items = generatedPuzzle.items.map((i) => ({ ...i, question: clueOf(i.id).trim() }));
    const trialHints: Record<string, HintRef> = {};
    for (const i of items) if (hints[i.id]) trialHints[i.uuid] = hints[i.id];
    return {
      puzzle: { ...buildGrid(items), id: "trial", title: puzzleTitle.trim(), creatorName: creatorName.trim() },
      hints: trialHints,
      answers: prev && prev.sig === sig && !prev.cleared ? prev.answers : undefined,
      onAnswers: (a, cleared) => {
        trialRef.current = { sig, answers: a, cleared };
      },
      stickyTop: HEAD_H,
      dockGap: DOCK_GAP,
    };
  };
  const trial = mode === "try" ? trialPlay() : null;

  // 小さい盤の大きさ（高さ94px・横は数字の分を除いた幅に収める）
  const miniBoard = miniPuzzle ? (
    <MiniGrid puzzle={miniPuzzle} fx={miniFx} />
  ) : (
    <span data-mini-status="" className="text-xs" style={{ color: C.secondary }}>
      {boardBlock || CT.building}
    </span>
  );

  return (
    <div className="min-h-screen bg-surface">
      <Toaster />
      <div className="max-w-[640px] mx-auto bg-white min-h-screen">
        {/* 見出しと「作る｜試す」（44px）と小さい盤（110px）。上に貼り付き、下が透けないよう白で塗る（Hop 決定 2026-10-22・見本の案A） */}
        <div data-create-top="" className="sticky top-0 z-20 bg-white" style={{ boxShadow: `0 1px 0 ${C.mid}` }}>
          <div data-create-head="" className="flex items-center justify-between gap-2 pl-4" style={{ height: HEAD_H }}>
            <h1 className="text-sm font-black whitespace-nowrap overflow-hidden text-ellipsis min-w-0" style={{ color: C.ink }}>
              {editTarget ? CT.edit.pageTitle : CT.pageTitle}
            </h1>
            <div role="group" aria-label={CT.modesLabel} className="flex gap-0.5 shrink-0" style={{ height: HEAD_H }}>
              {(["make", "try"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  data-mode-tab={m}
                  aria-pressed={mode === m}
                  onClick={() => switchMode(m)}
                  className="min-w-16 px-3 text-sm font-bold transition-colors"
                  style={mode === m ? { background: C.black, color: C.white } : { background: C.low, color: C.secondary }}
                >
                  {CT.modes[m]}
                </button>
              ))}
            </div>
          </div>
          {mode === "make" && (
            <div
              data-mini=""
              aria-hidden={keyboardUp ? true : undefined}
              inert={keyboardUp}
              className="overflow-hidden"
              style={{ height: keyboardUp ? 0 : MINI_H, opacity: keyboardUp ? 0 : 1, transition: prefersReducedMotion() ? "none" : `height ${HIDE_MS}ms ${EASE_STANDARD}, opacity ${HIDE_MS}ms ${EASE_STANDARD}` }}
            >
              <div className="px-4 py-2" style={{ height: MINI_H }}>
                {/* 盤のマスはボタンなので、押す所は盤の上に重ねた透明のボタン（ボタンの中にボタンを入れない） */}
                <div className="relative w-full h-full bg-surface-container-low hover:bg-surface-container-high transition-colors flex items-center gap-3 px-2.5 py-1.5">
                  <span data-mini-board="" className="flex-1 min-w-0 h-full flex items-center justify-center overflow-hidden">
                    {!expanded && miniBoard}
                  </span>
                  <span className="shrink-0 flex flex-col items-end gap-0.5 text-xs" style={{ color: C.secondary }}>
                    <span data-mini-stats="">{stats}</span>
                    <span className="font-bold" style={{ color: C.ink }}>
                      {CT.expand}
                    </span>
                  </span>
                  <button type="button" data-mini-open="" aria-label={CT.expand} onClick={() => setExpanded(true)} className="absolute inset-0 w-full h-full" />
                </div>
              </div>
            </div>
          )}
        </div>

        <Presence>
          {mode === "make" ? (
            <Motion key="make" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={WEAK}>
              <main className="px-4 pt-4 pb-7 flex flex-col gap-3.5" data-create-mode="make">
                <BulkEntry
                  text={bulkText}
                  onText={setBulkText}
                  t={BULK_TEXTS}
                  textareaClassName={textareaClass}
                  barHidden={anySheet}
                  below={
                    reasonRows.length > 0 && (
                      // 下の段（と上の貼り付き）に隠れないよう、増えた時は見える所まで送る（scroll-margin で段の高さぶん空ける）
                      <div ref={reasonsRef} data-bulk-reasons="" className="flex flex-col gap-0.5" style={{ scrollMarginTop: HEAD_H + (keyboardUp ? 0 : MINI_H) + 8, scrollMarginBottom: keyboardUp ? 8 : DOCK_H + 8 }}>
                        {reasonRows.map((r) => (
                          <div key={r.key} data-bulk-reason={r.kind} className="min-h-8 flex items-center px-3 text-xs bg-surface-container-low break-all" style={{ color: C.secondary }}>
                            {r.text}
                          </div>
                        ))}
                      </div>
                    )
                  }
                />
                {answers.length === 1 && !tipsSeen.cross && <Tip name="cross" />}

                {/* 語の一覧（1語1行・44px 以上）。行を押すと語の窓（Hop 決定 2026-10-22「好きな語を好きな順に」） */}
                {answers.length > 0 && (
                  <div ref={listRef} data-word-list="" role="group" aria-label={CT.wordsLabel} className="flex flex-col gap-0.5">
                    {candidates.map((c) => {
                      if (c.reason) return null;
                      if (answerByKey.get(c.key)?.mark.start !== c.mark.start) return null;
                      const clueOn = hasClue(c.key);
                      const hintOn = !!hints[c.key];
                      const off = hasBoard && !placedSet.has(c.key);
                      return (
                        <button
                          key={`w${c.key}`}
                          type="button"
                          data-word-row={c.key}
                          onClick={() => openWordSheet(c.key)}
                          aria-haspopup="dialog"
                          className="w-full min-h-11 flex items-center gap-2 px-3 text-left bg-surface-container-low hover:bg-surface-container-high transition-colors"
                          style={{ color: C.ink }}
                        >
                          <span className="relative flex-1 min-w-0">
                            <span className="block text-[15px] font-black tracking-[0.12em] whitespace-nowrap overflow-hidden text-ellipsis">{c.key}</span>
                            <span data-word-line="" aria-hidden="true" className="absolute left-0 right-0 pointer-events-none" style={{ bottom: -1, height: 2, background: C.ink, transform: "scaleX(0)", transformOrigin: "left center" }} />
                          </span>
                          {off && (
                            <span data-word-unplaced="" className="text-[11px] font-bold whitespace-nowrap" style={{ color: C.error }}>
                              {CT.unplaced}
                            </span>
                          )}
                          {/* 足りない物だけを言葉で出す（Hop 決定 2026-10-22）。そろった言葉は消える動きで消える */}
                          <span className="flex items-center gap-2 text-xs whitespace-nowrap" style={{ color: C.secondary }}>
                            <MissingWord kind="clue" show={!clueOn} text={CT.wordNoClue} />
                            <MissingWord kind="hint" show={!hintOn} text={CT.wordNoHint} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 一覧と自分が作った問題への入口（作る画面にはいつも出す）【仮】位置は語の一覧の下 */}
                <div className="flex flex-wrap gap-x-6 gap-y-1 pt-4">
                  <Link to="/crossword" className="min-h-11 text-sm font-bold inline-flex items-center gap-1 hover:text-black transition-colors" style={{ color: C.secondary }}>
                    {CT.toList} <span aria-hidden="true">→</span>
                  </Link>
                  <Link to="/crossword/mine" data-create-mine="" className="min-h-11 text-sm font-bold inline-flex items-center gap-1 hover:text-black transition-colors" style={{ color: C.secondary }}>
                    {CT.myPuzzles} <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </main>
            </Motion>
          ) : (
            <Motion key="try" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={WEAK}>
              <div data-create-mode="try">
                {trial && renderTrial ? (
                  <React.Fragment key={boardSignature(trial.puzzle)}>{renderTrial(trial)}</React.Fragment>
                ) : (
                  // 盤が無い時の知らせ（盤が無い理由と同じ文。語が2つ未満・探している間・見つからなかった時）【仮】
                  <p data-trial-empty="" className="px-4 py-8 text-sm" style={{ color: C.secondary }}>
                    {boardBlock || CT.building}
                  </p>
                )}
              </div>
            </Motion>
          )}
        </Presence>
      </div>

      {/* 下の貼り付けの段（60px）「試しに解く」「共有へ」（見本の案A）。文字盤が出ている間は下へ隠す */}
      <div
        data-dock=""
        aria-hidden={keyboardUp ? true : undefined}
        inert={keyboardUp}
        className="fixed inset-x-0 bottom-0 z-[25] bg-white"
        style={{
          boxShadow: `0 -1px 0 ${C.mid}`,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          transform: keyboardUp ? "translateY(100%)" : "none",
          transition: prefersReducedMotion() ? "none" : `transform ${HIDE_MS}ms ${EASE_STANDARD}`,
        }}
      >
        <div className="max-w-[640px] mx-auto px-4 py-1.5 flex gap-2" style={{ height: DOCK_H }}>
          <button
            type="button"
            data-dock-try=""
            aria-pressed={mode === "try"}
            onClick={() => switchMode(mode === "try" ? "make" : "try")}
            className="flex-1 min-h-12 font-bold text-[15px] bg-surface-container-high hover:bg-surface-container-highest transition-colors"
            style={{ color: C.ink, boxShadow: mode === "try" ? "inset 0 -2px 0 #000" : undefined }}
          >
            {CT.tryIt}
          </button>
          <button
            type="button"
            data-dock-share=""
            onClick={() => {
              setTitleError(false);
              setWordSheet(null);
              setExpanded(false);
              setShareOpen(true);
            }}
            data-strong={canShare ? "" : undefined}
            // 足りない物（カギ・ヒント・盤）があるうちは控えめの灰、全部そろったら強い黒（押せなくはしない。押すと足りない物が出る。Hop 決定 2026-10-22）
            className={`flex-1 min-h-12 font-bold text-[15px] transition-colors ${canShare ? "bg-primary text-white hover:bg-secondary" : "bg-surface-container-high hover:bg-surface-container-highest"}`}
            style={canShare ? undefined : { color: C.ink }}
          >
            {CT.toShare}
          </button>
        </div>
      </div>

      {/* 広げた盤の画面（全画面）。中身は前の「2 盤」の働き全部（案1〜3・再シャッフル・置けなかった語・長押しで動かす・固定・固定を外す） */}
      <Presence>
        {expanded && (
          <Motion
            key="board"
            ref={boardDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cw-board-title"
            data-board-sheet=""
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={WEAK}
            exitTransition={{ duration: 0.12, ease: "easeOut" }}
            className="fixed inset-0 z-40 bg-white flex flex-col"
          >
            <div className="max-w-[640px] w-full mx-auto flex flex-col min-h-0 h-full">
              <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-1 shrink-0">
                <h2 id="cw-board-title" className="text-lg font-black" style={{ color: C.ink }}>
                  {CT.boardTitle}
                </h2>
                <button type="button" data-board-close="" onClick={() => setExpanded(false)} className={`${btnGray} shrink-0 text-sm`} style={{ color: C.ink }}>
                  {CT.close}
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-2 pb-6 flex flex-col gap-3">
                {proposals && proposals.length > 0 && !searching && (
                  <div className="flex flex-col gap-0.5" role="group" aria-label={CT.boardTitle}>
                    {proposals.map((p, i) => (
                      <button
                        key={i}
                        type="button"
                        data-bulk-proposal={i}
                        aria-pressed={picked === i}
                        onClick={() => pickProposal(i)}
                        className={`min-h-12 px-3 flex items-center justify-between text-left transition-colors ${picked === i ? "bg-surface-container-highest font-bold" : "bg-surface-container-low hover:bg-surface-container-high"}`}
                        style={{ color: C.ink }}
                      >
                        <span>{PROPOSAL_TEXTS.proposal(i + 1)}</span>
                        <span data-bulk-stats="" className="text-xs font-normal" style={{ color: C.secondary }}>
                          {PROPOSAL_TEXTS.stats(p.placed.length, p.cells, p.crossings)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {noProposal && !searching && (
                  <p className="text-sm" style={{ color: C.secondary }}>
                    {PROPOSAL_TEXTS.noProposal}
                  </p>
                )}

                <div data-create-board="" className="relative bg-surface-container-low p-4 min-h-[200px] flex items-center justify-center overflow-hidden">
                  {isLiveGenerating ? (
                    <>
                      {backgroundPuzzle && (
                        <div className="w-full opacity-20" aria-hidden="true">
                          <FitGrid width={backgroundPuzzle.width} height={backgroundPuzzle.height}>
                            <PuzzleGridRetro data={backgroundPuzzle} showSolution={true} />
                          </FitGrid>
                        </div>
                      )}
                      <div className="absolute inset-0 flex items-center justify-center" role="status">
                        <span className="bg-white px-4 py-2 text-sm font-bold flex items-center gap-2" style={{ color: C.ink }}>
                          <span className="w-4 h-4 border-2 border-black border-t-transparent motion-safe:animate-spin" aria-hidden="true" />
                          {CT.building}
                        </span>
                      </div>
                    </>
                  ) : generatedPuzzle && pool.length > 0 ? (
                    <>
                      <div className="w-full" style={searching ? { opacity: 0.2 } : undefined} aria-hidden={searching ? true : undefined}>
                        <FitGrid width={generatedPuzzle.width + 2 * MOVE_MARGIN} height={generatedPuzzle.height + 2 * MOVE_MARGIN}>
                          <MovableBoard data={generatedPuzzle} enabled={!isLiveGenerating && !searching} onDrop={handleMoveWord} fx={placeFx} />
                        </FitGrid>
                      </div>
                      {searching && (
                        <div className="absolute inset-0 flex items-center justify-center" role="status">
                          <span className="bg-white px-4 py-2 text-sm font-bold flex items-center gap-2" style={{ color: C.ink }}>
                            <span className="w-4 h-4 border-2 border-black border-t-transparent motion-safe:animate-spin" aria-hidden="true" />
                            {CT.building}
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm" style={{ color: C.secondary }}>
                      {boardBlock}
                    </p>
                  )}
                </div>

                {hasBoard && <p data-board-stats="" className="text-xs" style={{ color: C.secondary }}>{stats}</p>}

                {boardReady && !searching && !tipsSeen.move && <Tip name="move" />}

                {boardReady && !searching && generatedPuzzle!.items.some((i) => i.pinned) && (
                  <button type="button" data-pins-release="" className={`${btnGray} self-center text-sm`} style={{ color: C.ink }} onClick={() => triggerGeneration(pool, [])}>
                    {CT.pins.release}
                  </button>
                )}

                {hasBoard && (unplaced.length > 0 || shapeGuide.length > 0) && (
                  <div className="bg-surface-container-low px-3 py-3 text-sm flex flex-col gap-1" style={{ color: C.ink }}>
                    {unplaced.length > 0 && (
                      <div data-unplaced="">
                        <span className="text-xs font-bold tracking-[0.1em] mr-2" style={{ color: C.error }}>
                          {CT.unplaced}
                        </span>
                        {unplaced.map((i) => i.answer.join("")).join("、")}
                      </div>
                    )}
                    {shapeGuide.length > 0 && (
                      <>
                        <div className="text-xs font-bold tracking-[0.1em]" style={{ color: C.secondary }}>
                          {CT.shapeGuide}
                        </div>
                        {shapeGuide.map((line, i) => (
                          <div key={i} data-shape-guide="">
                            {line}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}

                <button type="button" data-reshuffle="" className={`${btnGray} w-full`} style={{ color: C.ink }} disabled={isLiveGenerating || searching || pool.length < 2} onClick={() => triggerGeneration(pool)}>
                  {CT.reshuffle}
                </button>
                {/* 固定した語どうしがつながっていない盤では共有できない（押せない理由を1行） */}
                {boardDisconnected && (
                  <p data-not-connected="" className="text-xs" style={{ color: C.error }}>
                    {CT.pins.notConnected}
                  </p>
                )}
              </div>
            </div>
          </Motion>
        )}
      </Presence>

      {/* 語の窓（語の一覧の行を押すと下から出る）。カギの欄とヒントの道具が全部。「閉じる」だけ（「次の語 →」は無い。Hop 決定 2026-10-22） */}
      <Presence>
        {wordSheet && sheetEntry && (
          <Motion
            key={`word-${wordSheet.n}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={WEAK}
            exitTransition={{ duration: 0.12, ease: "easeOut" }}
            className="fixed inset-0 z-40 flex items-end justify-center"
            style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={(e) => e.target === e.currentTarget && closeWordSheet()}
          >
            {/* 下を起点に少しだけ小さい所から出る（窓が出る動きは弱い組。Hop 決定 2026-10-22。前は名前を入れる窓と同じ 0.9倍） */}
            <Motion
              ref={wordDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="cw-word-sheet-title"
              data-word-sheet={sheetEntry}
              data-hint-sheet=""
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={WEAK}
              className="bg-white w-full max-w-[640px] max-h-[90dvh] overflow-y-auto overscroll-contain"
              style={{ boxShadow: C.modalShadow, transformOrigin: "bottom center" }}
            >
              <div className="sticky top-0 z-10 bg-white flex items-center justify-between gap-2 px-4 pt-3 pb-1">
                <h2 id="cw-word-sheet-title" className="text-lg font-black min-w-0 break-all" style={{ color: C.ink }}>
                  {CT.wordSheetTitle(sheetEntry)}
                </h2>
                <button type="button" data-word-close="" onClick={closeWordSheet} className={`${btnGray} shrink-0 text-sm`} style={{ color: C.ink }}>
                  {CT.close}
                </button>
              </div>
              <div className="px-4 pt-1 pb-6 flex flex-col gap-2">
                <label htmlFor="cw-clue" className="text-xs font-bold" style={{ color: C.secondary }}>
                  {CT.clueLabel}
                </label>
                <p data-clue-about="" className="text-xs" style={{ color: C.secondary }}>
                  {CT.clueAbout}
                </p>
                {/* カギは複数行で見える欄（改行は入れない。保存する問題文は1行）。100字まで */}
                <textarea
                  id="cw-clue"
                  data-clue-input=""
                  data-kbd-field=""
                  value={sheetClue}
                  rows={3}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\r?\n/g, "");
                    setClues((prev) => ({ ...prev, [sheetEntry]: v }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
                  }}
                  onFocus={() => setClueFocused(true)}
                  onBlur={() => setClueFocused(false)}
                  placeholder={CT.cluePlaceholder}
                  className={`${textareaClass} resize-none leading-relaxed`}
                />
                {/* 残り字数は欄を選んでいる間か残り10字以下の時だけ。100字を超えたら超えた字数をいつも出す（Hop 決定 2026-10-21・10-22）。
                    出さない間も1行ぶんの高さは空けておく（欄を離れた瞬間に下がずれて、押した所を外さないように） */}
                {(() => {
                  const left = MAX_CLUE_CHARS - clueChars(sheetClue);
                  if (left >= 0 && !clueFocused && left > CLUE_LEFT_ALWAYS) {
                    return (
                      <p aria-hidden="true" className="text-xs invisible">
                        {" "}
                      </p>
                    );
                  }
                  return left >= 0 ? (
                    <p data-clue-left={left} className="text-xs" style={{ color: C.secondary }}>
                      {CT.clueLeft(left)}
                    </p>
                  ) : (
                    <p data-clue-over={-left} className="text-xs" style={{ color: C.error }}>
                      {CT.clueOver(-left)}
                    </p>
                  );
                })()}
                <p className="text-sm pt-1" style={{ color: C.ink }}>
                  {CT.hintRoot}
                </p>
                <p data-hint-guide="" className="text-xs leading-relaxed" style={{ color: C.secondary }}>
                  {CT.hintOfficial}
                </p>
                {/* ヒントが付いている時は、行き先を別のタブで開くリンク（Hop 決定 2026-10-22。語の窓でも） */}
                {sheetHint &&
                  (() => {
                    const href = hintHref(sheetHint);
                    const text = CT.hintState(sourceLabel(sheetHint), hintLabels[sheetEntry] ?? fallbackName(sheetHint));
                    return href ? (
                      <a data-hint-state="" href={href} target="_blank" rel="noopener noreferrer" className="min-h-11 flex items-center text-xs break-all hover:underline" style={{ color: C.secondary }}>
                        {text}
                      </a>
                    ) : (
                      <span data-hint-state="" className="min-h-11 flex items-center text-xs break-all" style={{ color: C.secondary }}>
                        {text}
                      </span>
                    );
                  })()}
                <HintField
                  key={wordSheet.n}
                  inputId="cw-hint"
                  genre="hello"
                  resetKey={0}
                  inputClassName={inputClass}
                  initial={sheetHint ? { hint: sheetHint, label: hintLabels[sheetEntry] ?? fallbackName(sheetHint) } : null}
                  onChange={(h, label) => setHintFor(sheetEntry, h, label)}
                  search={hintSearch}
                  flatResults
                />
              </div>
            </Motion>
          </Motion>
        )}
      </Presence>

      {/* 共有の窓（下から出る）。中身は前の「4 共有」の窓と同じ */}
      <Presence>
        {shareOpen && (
          <Motion
            key="share"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={WEAK}
            exitTransition={{ duration: 0.12, ease: "easeOut" }}
            className="fixed inset-0 z-40 flex items-end justify-center"
            style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={(e) => e.target === e.currentTarget && closeShare()}
          >
            <Motion
              ref={shareSheetDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="cw-share-sheet-title"
              data-share-sheet=""
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={WEAK}
              className="bg-white w-full max-w-[640px] max-h-[90dvh] overflow-y-auto overscroll-contain"
              style={{ boxShadow: C.modalShadow, transformOrigin: "bottom center" }}
            >
              <div className="sticky top-0 z-10 bg-white flex items-center justify-between gap-2 px-4 pt-3 pb-1">
                <h2 id="cw-share-sheet-title" className="text-lg font-black" style={{ color: C.ink }}>
                  {CT.shareTitle}
                </h2>
                <button type="button" data-share-close="" onClick={closeShare} disabled={isSaving} className={`${btnGray} shrink-0 text-sm`} style={{ color: C.ink }}>
                  {CT.close}
                </button>
              </div>
              <div className="px-4 pt-1 pb-6 flex flex-col gap-3">
                {!tipsSeen.saved && !editTarget && <Tip name="saved" />}
                <div className="flex flex-col gap-1">
                  <label htmlFor="cw-title" className="text-xs font-bold" style={{ color: C.secondary }}>
                    {CT.puzzleTitle}
                  </label>
                  <input id="cw-title" value={puzzleTitle} maxLength={50} onChange={(e) => { setPuzzleTitle(e.target.value); setTitleError(false); }} placeholder={CT.titlePlaceholder} className={inputClass} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="cw-creator" className="text-xs font-bold" style={{ color: C.secondary }}>
                    {CT.creatorName}
                  </label>
                  <input id="cw-creator" value={creatorName} maxLength={50} onChange={(e) => setCreatorName(e.target.value)} placeholder={CT.creatorNamePlaceholder} className={inputClass} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="cw-tag" className="text-xs font-bold" style={{ color: C.secondary }}>
                    {CT.tagsLabel(MAX_TAGS)}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="cw-tag"
                      value={tagInput}
                      maxLength={20}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      placeholder={CT.tagPlaceholder}
                      className={`${inputClass} flex-1 min-w-0`}
                    />
                    <button type="button" onClick={addTag} disabled={!tagInput.trim() || tags.length >= MAX_TAGS} className={`${btnGray} shrink-0`} style={{ color: C.ink }}>
                      {CT.tagAdd}
                    </button>
                  </div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {tags.map((t) => (
                        <span key={t} className="inline-flex items-center gap-1 pl-2 text-xs bg-surface-container-high" style={{ color: C.ink }}>
                          {t}
                          <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={CT.tagRemove(t)} className="w-11 h-11 flex items-center justify-center leading-none">
                            <Icon size={14} icon="close" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-2 min-h-11 text-sm cursor-pointer" style={{ color: C.ink }}>
                  <input type="checkbox" checked={isBeginner} onChange={(e) => setIsBeginner(e.target.checked)} className="w-5 h-5 accent-black" />
                  {CT.beginner}
                </label>
                {/* この問題が載るグループ（保存の時と同じ判定で、題名・盤に入った答えのカギ・答えから。選び直しはできない。Hop 決定 2026-10-23） */}
                {(() => {
                  const items = generatedPuzzle && hasBoard ? generatedPuzzle.items : [];
                  const found = detectGroups({ title: puzzleTitle.trim(), clues: items.map((i) => clueOf(i.id).trim()), answers: items.map((i) => i.answer.join("")) });
                  return (
                    <p data-share-groups={found.join("・")} className="text-sm" style={{ color: C.ink }}>
                      {found.length > 0 ? CT.groups(found) : CT.noGroup}
                    </p>
                  );
                })()}
                {/* 盤に置けなかった語（見本の案A の共有の窓。この語は問題に入らない） */}
                {unplaced.length > 0 && (
                  <p data-share-unplaced="" className="text-sm bg-surface-container-low px-3 py-2" style={{ color: C.ink }}>
                    <span className="text-xs font-bold tracking-[0.1em] mr-2" style={{ color: C.error }}>
                      {CT.unplaced}
                    </span>
                    {unplaced.map((i) => i.answer.join("")).join("、")}
                  </p>
                )}
                {/* 著作権の2行・押せない理由・「共有する」は窓の下に貼り付ける（iPhone SE の高さでも、足りない物と押す所がいつも見えるように） */}
                <div data-share-foot="" className="sticky bottom-0 -mx-4 -mb-6 px-4 pt-2 pb-4 bg-white flex flex-col gap-1" style={{ boxShadow: `0 -1px 0 ${C.mid}` }}>
                  {/* 公開するとどうなるか（組み直しはもう公開している問題なので出さない。Hop 決定 2026-10-23） */}
                  {!editTarget && (
                    <p data-publish-note="" className="text-xs" style={{ color: C.ink }}>
                      {CT.publishNote}
                    </p>
                  )}
                  {/* 著作権の2行は「共有する」のボタンの上（Hop 決定 2026-10-22） */}
                  <p data-copyright="" className="text-xs" style={{ color: C.secondary }}>
                    {CT.copyright[0]}
                    <br />
                    {CT.copyright[1]}
                  </p>
                  {/* 押せない理由（足りない物が先頭）。そろったら「全部の答えにカギとヒントが付きました。」に替わる */}
                  <p ref={blocksRef} data-share-blocks={canShare ? "ok" : ""} aria-live="polite" className="text-xs" style={{ color: canShare ? C.secondary : C.error }}>
                    {canShare ? CT.allSet : shareBlocks.join("　")}
                  </p>
                  <button type="button" data-save="" className={btnPrimary} disabled={isSaving || !canShare} onClick={handleShare}>
                    {isSaving ? CT.saving : editTarget ? CT.edit.update : CT.share}
                  </button>
                  {titleError && (
                    <p data-title-error="" role="alert" className="text-xs" style={{ color: C.error }}>
                      {CT.errors.noTitle}
                    </p>
                  )}
                </div>
              </div>
            </Motion>
          </Motion>
        )}
      </Presence>

      {/* 保存の直前の確認（Turnstile） */}
      {showSaveCheck && <SaveCheckModal onPass={saveWithToken} onClose={cancelSaveCheck} />}

      {/* 保存できた後の窓（本番の「問題を共有」のまま） */}
      {showShareModal && (
        <div ref={shareDialog} role="dialog" aria-modal="true" aria-labelledby="cw-share-title" className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
          {/* 窓が出る動きは弱い組（Hop 決定 2026-10-22。前は名前を入れる窓と同じ 0.9倍） */}
          <Motion initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={WEAK} className="bg-white p-6 max-w-md w-full space-y-6" style={{ boxShadow: C.modalShadow }}>
            <h2 id="cw-share-title" className="text-2xl font-black text-center pb-3" style={{ color: C.ink }}>
              {editTarget ? CT.shareModal.updatedTitle : CT.shareModal.modalTitle}
            </h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="cw-share-url" className="text-xs block font-bold" style={{ color: C.secondary }}>
                  {CT.shareModal.shareLink}
                </label>
                <div className="flex gap-2">
                  <input id="cw-share-url" readOnly value={shareUrl} className="flex-1 min-w-0 bg-surface-container-low px-3 text-base truncate" style={{ color: C.ink }} />
                  <button onClick={() => navigator.clipboard?.writeText(shareUrl)} className="w-11 h-11 flex items-center justify-center bg-surface-container-high hover:bg-primary hover:text-white transition-colors" style={{ color: C.ink }} aria-label={CT.shareModal.copy}>
                    <Icon size={16} icon="content_copy" />
                  </button>
                </div>
              </div>
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(sharedTitle)}&url=${encodeURIComponent(shareUrl)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full min-h-12 bg-primary hover:bg-secondary text-white font-black transition-colors"
              >
                <Icon size={16} icon="share" /> {CT.shareModal.postToX}
              </a>
            </div>
            <div className="text-xs text-center leading-relaxed pt-4" style={{ color: C.secondary }}>
              {editTarget ? CT.shareModal.updatedNotice : CT.shareModal.publicNotice}
            </div>
            <div className="flex flex-col items-center gap-2">
              {/* 次の問題を作る（公開の後だけ。組み直しの更新の後は出さない。Hop 決定 2026-10-23） */}
              {!editTarget && (
                <button type="button" data-next-puzzle="" onClick={startNextPuzzle} className={`${btnGray} w-full`} style={{ color: C.ink }}>
                  {CT.shareModal.nextPuzzle}
                </button>
              )}
              <button type="button" data-saved-close="" onClick={closeSaved} className={btnGray} style={{ color: C.ink }}>
                {CT.close}
              </button>
            </div>
          </Motion>
        </div>
      )}

      <Footer />
      {/* 下の貼り付けの段の分の余白（ページの一番下が段に隠れないように） */}
      <div aria-hidden="true" style={{ height: DOCK_GAP }} />
    </div>
  );
}

// 語の一覧の行の足りない言葉（「カギがまだ」など）。そろって消える時は、その場で小さくなって消える（0.2秒。決まった盤の字が置かれる動きの逆）。
// 消えた事が分からないと何が済んだか分からないので、強めの動きの組（Hop 決定 2026-10-22「動きに強弱」）。出る時は動かさない
function MissingWord({ kind, show, text }: { kind: "clue" | "hint"; show: boolean; text: string }) {
  const [shown, setShown] = useState(show);
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (show) {
      setShown(true);
      return;
    }
    if (!shown) return;
    const el = ref.current;
    if (!el || prefersReducedMotion()) {
      setShown(false);
      return;
    }
    const h = animateElement(el, { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.6 }, { duration: 0.2, ease: "easeOut" });
    let alive = true;
    void h.finished.then(() => alive && setShown(false));
    return () => {
      alive = false;
      h.cancel();
    };
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  return (
    <span ref={ref} data-word-missing={kind} data-leaving={show ? undefined : ""} className="inline-block">
      {text}
    </span>
  );
}

// 小さい盤（高さ94px と横の幅に収まる大きさに縮めて置く。押す・動かすはできない。読み上げは広げた盤で）
const MINI_INNER_H = MINI_H - 16 - 12;
const CELL = 48;
function MiniGrid({ puzzle, fx }: { puzzle: PuzzleData; fx: GridFx | null }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const [avail, setAvail] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = boxRef.current?.parentElement;
    if (!el) return;
    const measure = () => setAvail({ w: el.clientWidth, h: el.clientHeight || MINI_INNER_H });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const w = puzzle.width * CELL;
  const h = puzzle.height * CELL;
  const s = avail ? Math.min(1, (avail.w - 1) / w, (Math.min(avail.h, MINI_INNER_H) - 1) / h) : 0;
  return (
    <span ref={boxRef} aria-hidden="true" inert className="relative block" style={{ width: w * s, height: h * s }}>
      <span className="absolute left-0 top-0 block" style={{ transform: `scale(${s})`, transformOrigin: "top left" }}>
        <PuzzleGridRetro data={puzzle} showSolution={true} fx={fx} />
      </span>
    </span>
  );
}
