// クロスワードの作る画面（/crossword/create）。4つの段で進む（Hop 決定 2026-10-19 夜〜10-20・見本 v15）。
//   1 答え: 書いた行の語を【 】で囲んで答えにし、下線の語を押してヒントを付ける →「組み合わせを探す（N語）」
//   2 盤:   本番の組み合わせ探し（bulkSelect）の上位3つを「案1〜3」で並べ、選んだ盤を出す。長押しで動かす→固定・再シャッフル・固定を外す
//   3 カギ: 盤に入った答えだけにカギを書く（下書きは元の行の答えを○にした物）→「共有する」
//   4 共有: 下から出る窓で題名などを入れ、人間確認（Turnstile）を通って保存
// 中身の部品は本番の物をそのまま使う（BulkEntry・bulkSelect・MovableBoard・engine・suggest・HintField・SaveCheckModal）。
// 盤の組み立て・動かす・保存の処理は、もとの CrosswordPage.tsx の作る画面から写した（動きは同じ）。
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { BulkEntry, clueDraft, evaluateCandidates, parseMarks, type Candidate } from "../components/BulkEntry";
import { HintField } from "../components/HintField";
import { HINT_SOURCES, sourceOfUrl } from "../components/HintSourceBar";
import { FitGrid } from "../components/FitGrid";
import { MovableBoard, MOVE_MARGIN } from "../components/MovableBoard";
import { PuzzleGridRetro } from "../components/PuzzleGridRetro";
import { useDialog } from "../components/useDialog";
import { Toaster, toast } from "../components/Toast";
import { SaveCheckModal } from "../components/SaveCheckModal";
import { Footer, Icon } from "../components/ui";
import { C } from "../style";
import { BULK_TEXTS, CT, PROPOSAL_TEXTS } from "./texts";

// localStorage の鍵（名前は今までと同じ。消した札は消したまま）
const DRAFT_KEY = "crossword_draft";
const TIP_KEYS = {
  cross: "crossword_seen_tip_cross", // 1の段で答えが1つになった時
  move: "crossword_seen_tip_move", // 2の段で盤ができた時
  saved: "crossword_seen_tip_saved", // 共有の窓の中
} as const;
type TipName = keyof typeof TIP_KEYS;
// なぞる動きを見た印（公開後、初めて作る画面を開いた端末で一度だけ。Hop 決定 2026-10-20）
const TRACE_KEY = "crossword_seen_trace";
const MAX_TAGS = 10;
// カギ1つの字数の上限（Hop 決定 2026-10-21）。数え方は見た目の字数（絵文字なども1字。Array.from の長さ）。受付係 crossword-save の MAX_CLUE_CHARS と同じ値
const MAX_CLUE_CHARS = 30;
const clueChars = (s: string) => Array.from(s.trim()).length;
// 裏の探索を1回の刻みで回す長さ（ミリ秒）。描き変えの100msの合間に収める
const SEARCH_STEP_MS = 30;
// 組み立ての演出の試行の数（HarmonyPalette と同じ）
const ANIMATION_STEPS = 50;

type Step = 1 | 2 | 3 | 4;

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

const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

// 作りかけ（4段の形・version 2）。ヒント・カギは答え（答えの字を並べた物）ごとに持つ。盤は語の位置と固定のまま残す
interface DraftV2 {
  version: 2;
  step: Step;
  bulkText: string;
  collapsed: boolean;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function CreatePage({ draftEnabled }: { draftEnabled: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // 組み直し（/crossword/create?edit=<番号>。Hop 決定 2026-10-05）。checking = 中身を受け取り中、editing = 組み直し中（下書きに書かない・読まない【仮】）
  const editParam = draftEnabled ? searchParams.get("edit") : null;
  const [editStatus, setEditStatus] = useState<"none" | "checking" | "editing">(editParam ? "checking" : "none");
  const [editTarget, setEditTarget] = useState<MyPuzzle | null>(null);
  const editStartedRef = useRef(false);
  // 組み直しで開いた時に棚に保存してあったヒント（保存の時に outside の印を引き継ぐのに使う。Hop 決定 2026-10-21）
  const storedHintsRef = useRef<Record<string, HintRef>>({});

  const [step, setStep] = useState<Step>(1);
  const [bulkText, setBulkText] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  // ヒント・カギは答え（答えの字を並べた物）ごとに持つ（段を行き来しても、探し直しても消えないように）
  const [hints, setHints] = useState<Record<string, HintRef>>({});
  const [hintLabels, setHintLabels] = useState<Record<string, string>>({});
  const [clues, setClues] = useState<Record<string, string>>({});
  const [puzzleTitle, setPuzzleTitle] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isBeginner, setIsBeginner] = useState(false);
  const [titleError, setTitleError] = useState(false);

  // 2の段
  const [proposals, setProposals] = useState<BulkProposal[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [generatedPuzzle, setGeneratedPuzzle] = useState<PuzzleData | null>(null);
  const [backgroundPuzzle, setBackgroundPuzzle] = useState<PuzzleData | null>(null);
  const [isLiveGenerating, setIsLiveGenerating] = useState(false);
  const generationIdRef = useRef(0);

  // ヒントの窓（1の段・3の段から）
  const [hintOpen, setHintOpen] = useState<{ key: string; surface: string; from: 1 | 3; n: number } | null>(null);
  const hintOpenCount = useRef(0);

  // 札（× で消した札は端末に残す）となぞる動き
  const [tipsSeen, setTipsSeen] = useState<Record<TipName, boolean>>(() => ({
    cross: !!lsGet(TIP_KEYS.cross),
    move: !!lsGet(TIP_KEYS.move),
    saved: !!lsGet(TIP_KEYS.saved),
  }));
  const dismissTip = (name: TipName) => {
    lsSet(TIP_KEYS[name], "1");
    setTipsSeen((prev) => ({ ...prev, [name]: true }));
  };
  const [traceAllowed, setTraceAllowed] = useState(() => !lsGet(TRACE_KEY));

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

  const headingRef = useRef<HTMLHeadingElement>(null);
  const clueRefs = useRef(new Map<string, HTMLInputElement>());

  // --- 書いた行から答えを出す ---
  const marks = useMemo(() => parseMarks(bulkText), [bulkText]);
  const answers: Candidate[] = useMemo(() => evaluateCandidates(marks).filter((c) => !c.reason), [marks]);
  const answerByKey = useMemo(() => new Map(answers.map((a) => [a.key, a])), [answers]);
  const pool: PuzzleItem[] = useMemo(() => answers.map((a) => ({ id: a.key, question: "", answer: a.cells })), [answers]);
  const clueOf = (key: string): string => {
    if (clues[key] !== undefined) return clues[key];
    const a = answerByKey.get(key);
    return a ? clueDraft(bulkText, marks, a.mark, a.cells.length) : "";
  };

  // 盤に入った答え（3の段に並べる。書いた順）
  const boardReady = !!generatedPuzzle && !isLiveGenerating;
  const placedKeys = useMemo(() => {
    if (!generatedPuzzle) return [] as string[];
    const on = new Set(generatedPuzzle.items.map((i) => i.id));
    const ordered = answers.filter((a) => on.has(a.key)).map((a) => a.key);
    for (const i of generatedPuzzle.items) if (!ordered.includes(i.id)) ordered.push(i.id);
    return ordered;
  }, [generatedPuzzle, answers]);
  const unplaced = boardReady ? pool.filter((i) => !generatedPuzzle!.items.some((p) => p.id === i.id)) : [];
  const boardDisconnected = boardReady && !isConnected(generatedPuzzle!.items);
  const missingHints = placedKeys.filter((k) => !hints[k]).length;
  const missingClues = placedKeys.filter((k) => !clueOf(k).trim()).length;
  // 30字を超えたカギ（保存する形＝前後の空白を落とした字数で数える）
  const overClues = placedKeys.filter((k) => clueChars(clueOf(k)) > MAX_CLUE_CHARS);

  // 型の案内（Hop 決定 2026-10-05・段階2）。組み上がった盤が変わった時だけ計算する
  const shapeGuide = useMemo(
    () => (generatedPuzzle ? guideTexts(suggestForBoard(generatedPuzzle.items, pool.filter((i) => !generatedPuzzle.items.some((p) => p.id === i.id)))) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generatedPuzzle]
  );

  // --- 段の行き来 ---
  const goStep = (s: Step) => {
    setStep(s);
    if (s !== 4) {
      window.scrollTo(0, 0);
      requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    }
  };

  // --- 盤の組み立て（もとの作る画面の triggerGeneration と同じ） ---
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

  // 盤の語を指で動かした時。置けたら固定の印を付けて盤を組み直さずに置く
  const handleMoveWord = (uuid: string, startX: number, startY: number): boolean => {
    if (!generatedPuzzle || isLiveGenerating) return false;
    const moved = moveItem(generatedPuzzle.items, uuid, startX, startY);
    if (!moved) return false;
    const prev = generatedPuzzle;
    setGeneratedPuzzle({ ...buildGrid(moved), id: prev.id, title: prev.title, creatorName: prev.creatorName });
    setPicked(null);
    return true;
  };

  // HarmonyPalette と同じ組み立ての動き: 50通りの試行が描き変わり、置けた語が最多で面積が最小のものに決まる。
  // 演出の50回とは別に、全部の語が置けるまで（または時間の上限まで）裏で試行を続ける（Hop 決定 2026-10-05）
  const triggerGeneration = async (items: PuzzleItem[], pinsOverride?: PlacedItem[]) => {
    const pinned = pinsOverride ?? carryPins(items);
    if (items.length === 0) {
      setGeneratedPuzzle(null);
      setBackgroundPuzzle(null);
      return;
    }
    const currentGenId = ++generationIdRef.current;
    setIsLiveGenerating(true);
    setPicked(null);
    const still = reducedMotion();
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
      if (bestPuzzle) setGeneratedPuzzle(bestPuzzle);
    } catch (error) {
      console.error("[MonteCarloAnim] Error:", error);
    } finally {
      if (generationIdRef.current === currentGenId) {
        setIsLiveGenerating(false);
        setBackgroundPuzzle(null);
      }
    }
  };

  // 案を選ぶ（選んだ案の盤をそのまま出す）。案はどれも固定した語を同じ座標に置いて組んだ物なので、固定の印はそのまま残す
  // （前は固定を外していたが、押し直しても固定を守る形にしたため。Hop 決定 2026-10-21 案A）
  const pickProposal = (i: number, list: BulkProposal[] | null = proposals) => {
    const p = list?.[i];
    if (!p) return;
    ++generationIdRef.current;
    setIsLiveGenerating(false);
    setBackgroundPuzzle(null);
    setPicked(i);
    setGeneratedPuzzle(buildGrid(p.placed));
  };

  // 「組み合わせを探す」: 2の段へ進み、組み立ての動き（50通りの試行）を見せながら本番の組み合わせ探し（bulkSelect）を回す。
  // 終わったら上位3つを案1〜3に並べ、案1の盤を出す。
  // 「2 盤」で動かして固定した語は、押し直してもその位置を守り、その語を土台に残りの語だけを組む（Hop 決定 2026-10-21 案A）。
  // 持ち越しは再シャッフルと同じ carryPins: 「1 答え」で消した語（字を変えた語も、別の答えになるので同じ）の固定は外れる
  const [noProposal, setNoProposal] = useState(false);
  const runSearch = async () => {
    const items = pool;
    if (items.length < 2) return;
    const pinned = carryPins(items);
    const base = pinned.length > 0 ? carryBase(items, pinned) : [];
    const run = ++generationIdRef.current;
    goStep(2);
    setProposals(null);
    setPicked(null);
    setNoProposal(false);
    setGeneratedPuzzle(null);
    setIsLiveGenerating(true);
    const still = reducedMotion();
    try {
      const search = createBulkSearch(items, { pinned, base });
      for (const st of generateMonteCarloSteps(items, ANIMATION_STEPS, pinned)) {
        const tickStart = performance.now();
        search.step(SEARCH_STEP_MS);
        if (generationIdRef.current !== run) return;
        if (st.placed.length > 0 && !still) setBackgroundPuzzle(buildGrid(st.placed));
        await sleep(still ? 0 : Math.max(0, 100 - (performance.now() - tickStart)));
      }
      while (!search.finished()) {
        if (generationIdRef.current !== run) return;
        search.step(SEARCH_STEP_MS);
        await sleep(0);
      }
      if (generationIdRef.current !== run) return;
      const list = search.proposals();
      setProposals(list);
      if (list.length > 0) {
        setPicked(0);
        setGeneratedPuzzle(buildGrid(list[0].placed));
      } else setNoProposal(true);
    } catch (error) {
      console.error("[BulkSearch] Error:", error);
    } finally {
      if (generationIdRef.current === run) {
        setIsLiveGenerating(false);
        setBackgroundPuzzle(null);
      }
    }
  };

  // 画面を離れたら組み立てをやめる
  useEffect(() => () => void generationIdRef.current++, []);

  // --- 組み直し: 端末の控えの合言葉で中身を受け取り、書いた行・カギ・ヒント・盤に戻す（Hop 決定 2026-10-05） ---
  // 語は1の段の書いた行（【語】の1語1行）として戻す【仮】。盤は保存した時の形のまま、2の段から始める【仮】
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
        setCollapsed(true);
        setClues(restoredClues);
        setHints(restoredHints);
        storedHintsRef.current = restoredHints;
        // 盤は保存した時の形のまま（番号も同じ）。組み替えたい時は「再シャッフル」
        setGeneratedPuzzle(buildGrid(placed));
        setEditTarget({ ...mine, title: rec.title });
        setEditStatus("editing");
        setStep(2);
      })
      .catch((err) => {
        console.error("Failed to load own puzzle:", err);
        fail(CT.edit.notEditable);
      });
  }, [editStatus, editParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- 作りかけを戻す（組み直しの間は読まない・書かない【仮】） ---
  useEffect(() => {
    if (!draftEnabled || editStatus !== "none" || draftReady) return;
    const raw = lsGet(DRAFT_KEY);
    if (raw) {
      try {
        const d = JSON.parse(raw) as Record<string, unknown>;
        const text = typeof d.bulkText === "string" ? d.bulkText : "";
        if (typeof d.title === "string") setPuzzleTitle(d.title);
        if (typeof d.creatorName === "string") setCreatorName(d.creatorName);
        if (Array.isArray(d.tags)) setTags((d.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, MAX_TAGS));
        if (typeof d.isBeginner === "boolean") setIsBeginner(d.isBeginner);
        const rawHints = d.hints && typeof d.hints === "object" ? (d.hints as Record<string, unknown>) : {};
        let nextText = text;
        let restoredHints: Record<string, HintRef> = {};
        const restoredClues: Record<string, string> = {};
        const restoredLabels: Record<string, string> = {};
        if (d.version === 2) {
          for (const [k, h] of Object.entries(rawHints)) if (isHintRef(h)) restoredHints[k] = draftHint(h);
          if (d.clues && typeof d.clues === "object") for (const [k, v] of Object.entries(d.clues as Record<string, unknown>)) if (typeof v === "string") restoredClues[k] = v;
          if (d.hintLabels && typeof d.hintLabels === "object") for (const [k, v] of Object.entries(d.hintLabels as Record<string, unknown>)) if (typeof v === "string") restoredLabels[k] = v;
        } else {
          // 古い形（段の無い下書き）: 1語ずつ入れた語は書いた行の最後に【語】の1行として足し、カギとヒントは答えごとに持ち替える。1の段から始める
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
        setBulkText(nextText);
        setHints(restoredHints);
        setClues(restoredClues);
        setHintLabels(restoredLabels);
        if (d.version === 2) {
          setCollapsed(d.collapsed === true);
          const keys = new Set(evaluateCandidates(parseMarks(nextText)).filter((c) => !c.reason).map((c) => c.key));
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
          const s = d.step === 2 || d.step === 3 || d.step === 4 ? (d.step as Step) : 1;
          if (board) {
            setGeneratedPuzzle(buildGrid(board));
            setProposals(goodProps);
            setPicked(goodProps && typeof d.picked === "number" && goodProps[d.picked] ? d.picked : null);
            setStep(s);
          } else setStep(1);
        } else {
          setCollapsed(!!nextText.trim());
          setStep(1);
        }
      } catch {
        lsRemove(DRAFT_KEY);
      }
    }
    setDraftReady(true);
  }, [draftEnabled, editStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- 作りかけを残す（変えるたびに端末へ。保存に成功した直後の中身は書かない） ---
  useEffect(() => {
    if (!draftEnabled || !draftReady || editStatus !== "none") return;
    const empty = !bulkText.trim() && !puzzleTitle && !creatorName && tags.length === 0;
    if (empty) {
      lsRemove(DRAFT_KEY);
      return;
    }
    const content = {
      bulkText,
      collapsed,
      hints,
      hintLabels,
      clues,
      board: generatedPuzzle && !isLiveGenerating ? generatedPuzzle.items.map(({ id, uuid, answer, direction, startX, startY, length, pinned }) => ({ id, uuid, question: "", answer, direction, startX, startY, length, pinned: !!pinned })) : null,
      proposals,
      picked,
      title: puzzleTitle,
      creatorName,
      tags,
      isBeginner,
    };
    const snap = JSON.stringify(content);
    if (savedSnapshotRef.current !== null) {
      if (savedSnapshotRef.current === snap) return;
      savedSnapshotRef.current = null;
    }
    if (isLiveGenerating) return; // 組み立て中の途中の盤は残さない（組み上がってから残す）
    const d: DraftV2 = { version: 2, step, ...content };
    lsSet(DRAFT_KEY, JSON.stringify(d));
  }, [draftEnabled, draftReady, editStatus, step, bulkText, collapsed, hints, hintLabels, clues, generatedPuzzle, isLiveGenerating, proposals, picked, puzzleTitle, creatorName, tags, isBeginner]);

  // --- 窓が開いている間は後ろの画面をスクロールさせない（窓の中と外で二重にスクロールしない） ---
  const anySheet = !!hintOpen || step === 4 || showShareModal;
  useEffect(() => {
    if (!anySheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [anySheet]);

  const closeHint = () => setHintOpen(null);
  const hintDialog = useDialog({ active: !!hintOpen, onClose: closeHint });
  const shareSheetDialog = useDialog({ active: step === 4 && !showSaveCheck, onClose: () => setStep(3) });
  const shareDialog = useDialog({ active: showShareModal, onClose: () => setShowShareModal(false) });

  const openHint = (key: string, surface: string, from: 1 | 3) => {
    hintOpenCount.current += 1;
    setHintOpen({ key, surface, from, n: hintOpenCount.current });
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
  // ヒントの窓の「「語」の囲みを外す」（1の段から開いた時だけ）
  const unmarkFromSheet = (key: string) => {
    const a = answerByKey.get(key);
    setHintOpen(null);
    if (!a) return;
    setBulkText(bulkText.slice(0, a.mark.start) + a.mark.surface + bulkText.slice(a.mark.end));
  };

  // カギの欄の、今の文字の位置に「○」を入れる（Hop 依頼 2026-10-03。穴あきのカギ用）。押しても欄の選ばれ方を変えない。
  // 欄を選んでいる最中なら文字の位置に、選んでいなければ末尾に入れる
  const insertMaru = (key: string) => {
    const el = clueRefs.current.get(key);
    const q = clueOf(key);
    const active = !!el && document.activeElement === el;
    const start = active ? el!.selectionStart ?? q.length : q.length;
    const end = active ? el!.selectionEnd ?? q.length : q.length;
    setClues((prev) => ({ ...prev, [key]: q.slice(0, start) + "○" + q.slice(end) }));
    if (!active) return;
    requestAnimationFrame(() => el!.setSelectionRange(start + 1, start + 1));
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

  // --- 保存（もとの作る画面の handleShare・saveWithToken・updateEdited と同じ。ジャンルは常に hello） ---
  const itemsToSave = (): PlacedItem[] => (generatedPuzzle ? generatedPuzzle.items.map((i) => ({ ...i, question: clueOf(i.id).trim() })) : []);

  const handleShare = async () => {
    if (!generatedPuzzle) return;
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
      setStep(3);
      setShowShareModal(true);
    } catch (error) {
      console.error("Failed to update puzzle:", error);
      const reason = error instanceof SaveError ? error.reason : "";
      const message = reason === "already_played" ? CT.edit.alreadyPlayed : reason === "not_found" ? CT.edit.notEditable : CT.saveReasons[reason] ?? CT.errors.saveFailed;
      toast.error(message, { duration: 5000 });
      // もう遊ばれていたら、ヒントだけ差し替えられる画面へ回す（紙「遊ばれた後の ?edit= はヒント差し替えの画面へ回す」と同じ。Hop 決定 2026-10-19）。
      // 組み直しの中身は作りかけの控えに書かない（別の作りかけを上書きしないため）
      if (reason === "already_played") {
        navigate(`/crossword/hints/${editTarget.id}`, { replace: true });
        return;
      }
    } finally {
      setIsSaving(false);
    }
  };

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
      savedSnapshotRef.current = JSON.stringify({
        bulkText, collapsed, hints, hintLabels, clues,
        board: generatedPuzzle.items.map(({ id: i, uuid, answer, direction, startX, startY, length, pinned }) => ({ id: i, uuid, question: "", answer, direction, startX, startY, length, pinned: !!pinned })),
        proposals, picked, title: puzzleTitle, creatorName, tags, isBeginner,
      });
      setStep(3);
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

  const backButton = (label: string, to: Step) => (
    <button type="button" data-step-back={to} onClick={() => goStep(to)} className="self-start min-h-11 px-3 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors" style={{ color: C.ink }}>
      {label}
    </button>
  );
  const heading = (text: string) => (
    <h2 ref={headingRef} tabIndex={-1} className="text-lg font-black focus:outline-none" style={{ color: C.ink }}>
      {text}
    </h2>
  );

  if (editStatus === "checking") {
    return (
      <div className="min-h-screen bg-surface">
        <Toaster />
      </div>
    );
  }

  const shownStep: Step = step === 4 ? 3 : step;
  const hintFor = hintOpen ? hints[hintOpen.key] : undefined;

  return (
    <div className="min-h-screen bg-surface">
      <Toaster />
      <h1 className="sr-only">{editTarget ? CT.edit.pageTitle : CT.pageTitle}</h1>
      <div className="max-w-[640px] mx-auto bg-white min-h-screen">
        {/* 段の札（上に貼り付き、下が透けないよう白で塗る。今の段だけ黒い） */}
        <nav aria-label={CT.stepsLabel} className="sticky top-0 z-20 bg-white px-4 py-2.5" style={{ boxShadow: `0 1px 0 ${C.mid}` }}>
          <ol className="grid grid-cols-4 gap-0.5">
            {CT.steps.map((name, i) => {
              const n = (i + 1) as Step;
              const now = n === step;
              return (
                <li
                  key={name}
                  data-step={n}
                  aria-current={now ? "step" : undefined}
                  className="text-xs font-bold text-center py-1.5 px-0.5 whitespace-nowrap"
                  style={now ? { background: C.black, color: C.white } : { background: C.low, color: n < step ? C.ink : C.secondary }}
                >
                  {name}
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="px-4 pt-4 pb-7 flex flex-col gap-3.5" data-create-step={shownStep}>
          {shownStep === 1 && (
            <>
              {heading(CT.headings.answers)}
              <BulkEntry
                text={bulkText}
                onText={setBulkText}
                t={BULK_TEXTS}
                textareaClassName={textareaClass}
                collapsed={collapsed}
                onCollapsed={setCollapsed}
                hinted={(k) => !!hints[k]}
                onOpenHint={(k, surface) => openHint(k, surface, 1)}
                openKey={hintOpen?.from === 1 ? hintOpen.key : null}
                onSearch={runSearch}
                tip={answers.length === 1 && !tipsSeen.cross ? <Tip name="cross" /> : null}
                trace={traceAllowed}
                onTraceShown={() => {
                  lsSet(TRACE_KEY, "1");
                  setTraceAllowed(false);
                }}
                barHidden={!!hintOpen}
              />
            </>
          )}

          {shownStep === 2 && (
            <>
              {backButton(CT.backToAnswers, 1)}
              {heading(CT.headings.board)}
              {proposals && proposals.length > 0 && (
                <div className="flex flex-col gap-0.5" role="group" aria-label={CT.headings.board}>
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
              {noProposal && (
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
                ) : generatedPuzzle ? (
                  <div className="w-full">
                    <FitGrid width={generatedPuzzle.width + 2 * MOVE_MARGIN} height={generatedPuzzle.height + 2 * MOVE_MARGIN}>
                      <MovableBoard data={generatedPuzzle} enabled={!isLiveGenerating} onDrop={handleMoveWord} />
                    </FitGrid>
                  </div>
                ) : null}
              </div>

              {boardReady && !tipsSeen.move && <Tip name="move" />}

              {boardReady && generatedPuzzle!.items.some((i) => i.pinned) && (
                <button type="button" className={`${btnGray} self-center text-sm`} style={{ color: C.ink }} onClick={() => triggerGeneration(pool, [])}>
                  {CT.pins.release}
                </button>
              )}

              {boardReady && (unplaced.length > 0 || shapeGuide.length > 0) && (
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

              <button type="button" data-reshuffle="" className={`${btnGray} w-full`} style={{ color: C.ink }} disabled={isLiveGenerating || pool.length < 2} onClick={() => triggerGeneration(pool)}>
                {CT.reshuffle}
              </button>

              <div className="flex flex-col gap-1">
                <button type="button" data-bulk-adopt="" className={btnPrimary} disabled={!boardReady || boardDisconnected} onClick={() => goStep(3)}>
                  {PROPOSAL_TEXTS.adopt}
                </button>
                {/* 固定した語どうしがつながっていない盤では進めない（押せない理由を1行） */}
                {boardDisconnected && (
                  <p data-not-connected="" className="text-xs" style={{ color: C.error }}>
                    {CT.pins.notConnected}
                  </p>
                )}
              </div>
            </>
          )}

          {shownStep === 3 && (
            <>
              {backButton(CT.backToBoard, 2)}
              {heading(CT.headings.clues)}
              <p className="text-xs leading-relaxed" style={{ color: C.secondary }}>
                {CT.cluesGuide}
              </p>
              <div className="flex flex-col gap-2">
                {placedKeys.map((key, idx) => {
                  const h = hints[key];
                  const a = answerByKey.get(key);
                  return (
                    <div key={key} data-clue-row={key} className="bg-surface-container-low p-3 flex flex-col gap-2">
                      <label htmlFor={`cw-clue-${idx}`} className="text-[15px] font-black tracking-[0.12em]" style={{ color: C.ink }}>
                        {key}
                      </label>
                      <div className="flex gap-2">
                        <input
                          id={`cw-clue-${idx}`}
                          ref={(el) => {
                            if (el) clueRefs.current.set(key, el);
                            else clueRefs.current.delete(key);
                          }}
                          value={clueOf(key)}
                          onChange={(e) => setClues((prev) => ({ ...prev, [key]: e.target.value }))}
                          placeholder={CT.cluePlaceholder}
                          className={`${inputClass} flex-1 min-w-0 bg-white`}
                        />
                        {/* 穴あきのカギ用。今の文字の位置に「○」を1つ入れる */}
                        <button
                          type="button"
                          onPointerDown={(e) => e.preventDefault()}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertMaru(key)}
                          className="shrink-0 min-w-11 min-h-11 px-3 bg-surface-container-high hover:bg-surface-container-highest font-bold transition-colors"
                          style={{ color: C.ink }}
                          aria-label={CT.maruLabel}
                        >
                          ○
                        </button>
                      </div>
                      {/* 残り字数。30字を超えたら超えた字数（Hop 決定 2026-10-21） */}
                      {(() => {
                        const left = MAX_CLUE_CHARS - clueChars(clueOf(key));
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
                      {h ? (
                        <button type="button" data-hint-state="" onClick={() => openHint(key, a?.mark.surface ?? key, 3)} className="min-h-11 text-left text-xs break-all hover:underline" style={{ color: C.secondary }}>
                          {CT.hintState(sourceLabel(h), hintLabels[key] ?? fallbackName(h))}
                        </button>
                      ) : (
                        <button type="button" data-pick-hint="" onClick={() => openHint(key, a?.mark.surface ?? key, 3)} className="min-h-11 text-left text-sm font-bold hover:underline underline-offset-2" style={{ color: C.error }}>
                          {CT.pickHint}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <p data-missing-hints="" aria-live="polite" className="text-xs" style={{ color: C.secondary }}>
                {missingHints + missingClues + overClues.length > 0
                  ? [
                      missingHints ? CT.missingHints(missingHints) : "",
                      missingClues ? CT.missingClues(missingClues) : "",
                      ...overClues.map((k) => BULK_TEXTS.reasonLine(k, CT.clueOver(clueChars(clueOf(k)) - MAX_CLUE_CHARS))),
                    ].filter(Boolean).join("　")
                  : CT.allSet}
              </p>
              <button type="button" data-open-share="" className={btnPrimary} disabled={!boardReady || boardDisconnected || missingHints + missingClues + overClues.length > 0} onClick={() => { setTitleError(false); setStep(4); }}>
                {CT.share}
              </button>
            </>
          )}

          {/* 一覧と自分が作った問題への入口（作る画面にはいつも出す）【仮】位置は段の中身の下 */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 pt-4">
            <Link to="/crossword" className="min-h-11 text-sm font-bold inline-flex items-center gap-1 hover:text-black transition-colors" style={{ color: C.secondary }}>
              {CT.toList} <span aria-hidden="true">→</span>
            </Link>
            <Link to="/crossword/mine" data-create-mine="" className="min-h-11 text-sm font-bold inline-flex items-center gap-1 hover:text-black transition-colors" style={{ color: C.secondary }}>
              {CT.myPuzzles} <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className="text-xs" style={{ color: C.secondary }}>
            {CT.copyright[0]}
            <br />
            {CT.copyright[1]}
          </p>
        </main>
      </div>

      {/* ヒントの窓（下から出る）。中身は今のヒントの道具が全部 */}
      {hintOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={(e) => e.target === e.currentTarget && closeHint()}>
          <div ref={hintDialog} role="dialog" aria-modal="true" aria-labelledby="cw-hint-sheet-title" data-hint-sheet="" className="bg-white w-full max-w-[640px] max-h-[90dvh] overflow-y-auto overscroll-contain" style={{ boxShadow: C.modalShadow }}>
            <div className="sticky top-0 z-10 bg-white flex items-center justify-between gap-2 px-4 pt-3 pb-1">
              <h2 id="cw-hint-sheet-title" className="text-lg font-black min-w-0 break-all" style={{ color: C.ink }}>
                {CT.hintSheetTitle(hintOpen.key)}
              </h2>
              <button type="button" onClick={closeHint} className={`${btnGray} shrink-0 text-sm`} style={{ color: C.ink }}>
                {CT.close}
              </button>
            </div>
            <div className="px-4 pt-1 pb-6 flex flex-col gap-3">
              <p className="text-sm" style={{ color: C.ink }}>
                {CT.hintRoot}
              </p>
              <p data-hint-guide="" className="text-xs leading-relaxed" style={{ color: C.secondary }}>
                {CT.hintOfficial}
              </p>
              <HintField
                key={hintOpen.n}
                inputId="cw-hint"
                genre="hello"
                resetKey={0}
                inputClassName={inputClass}
                initial={hintFor ? { hint: hintFor, label: hintLabels[hintOpen.key] ?? fallbackName(hintFor) } : null}
                onChange={(h, label) => setHintFor(hintOpen.key, h, label)}
                flatResults
              />
              {hintOpen.from === 1 && (
                <button type="button" data-unmark-sheet="" onClick={() => unmarkFromSheet(hintOpen.key)} className={`${btnGray} w-full min-h-12`} style={{ color: C.ink }}>
                  {CT.unmarkFull(hintOpen.surface)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4の窓「共有する」（下から出る） */}
      {step === 4 && (
        <div className="fixed inset-0 z-40 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={(e) => e.target === e.currentTarget && !isSaving && setStep(3)}>
          <div ref={shareSheetDialog} role="dialog" aria-modal="true" aria-labelledby="cw-share-sheet-title" data-share-sheet="" className="bg-white w-full max-w-[640px] max-h-[90dvh] overflow-y-auto overscroll-contain" style={{ boxShadow: C.modalShadow }}>
            <div className="px-4 pt-4 pb-6 flex flex-col gap-3">
              <h2 id="cw-share-sheet-title" className="text-lg font-black" style={{ color: C.ink }}>
                {CT.headings.share}
              </h2>
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
              <div className="flex flex-col gap-1">
                <button type="button" data-save="" className={btnPrimary} disabled={isSaving} onClick={handleShare}>
                  {isSaving ? CT.saving : editTarget ? CT.edit.update : CT.share}
                </button>
                {titleError && (
                  <p data-title-error="" role="alert" className="text-xs" style={{ color: C.error }}>
                    {CT.errors.noTitle}
                  </p>
                )}
              </div>
              <button type="button" data-step-back={3} className={`${btnGray} w-full min-h-12`} style={{ color: C.ink }} disabled={isSaving} onClick={() => setStep(3)}>
                {CT.backToClues}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 保存の直前の確認（Turnstile） */}
      {showSaveCheck && <SaveCheckModal onPass={saveWithToken} onClose={cancelSaveCheck} />}

      {/* 保存できた後の窓（本番の「問題を共有」のまま） */}
      {showShareModal && (
        <div ref={shareDialog} role="dialog" aria-modal="true" aria-labelledby="cw-share-title" className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
          <div className="bg-white p-6 max-w-md w-full space-y-6" style={{ boxShadow: C.modalShadow }}>
            <h2 id="cw-share-title" className="text-2xl font-black text-center pb-3" style={{ color: C.ink }}>
              {CT.shareModal.modalTitle}
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
            <div className="flex justify-center">
              <button type="button" onClick={() => setShowShareModal(false)} className={btnGray} style={{ color: C.ink }}>
                {CT.close}
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
