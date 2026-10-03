// クロスワード（作る画面 /crossword・解く画面 /crossword/:id）。
// HarmonyPalette の src/pages/PuzzleBuilderPage.tsx を土台にした移植。構造・並び・動き・文言・数値は HarmonyPalette のまま。
// 変えた所: 見た目（docs/DESIGN.md）、アイコン（Material Symbols）、動き（framer-motion を使わず同じ式で再現）、
// 知らせ（react-hot-toast を使わず自前）、保存先（Supabase）、持ってこない物（広告・Cookie 同意・コード進行・計測・ランキング等）、
// 足した物（ジャンル・タグ・ヒント・降参・カタカナの ゛゜小）。
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import ContactModal from "@/components/ContactModal";
import { usePageReady } from "../../lib/pageReady";
import { buildGrid, generateMonteCarloSteps } from "../../lib/crossword/engine";
import type { PuzzleData, PuzzleItem, PlacedItem } from "../../lib/crossword/types";
import { toCells } from "../../lib/crossword/cells";
import { determineNextSelection } from "../../lib/crossword/puzzleSelectionLogic";
import {
  addMyPuzzle,
  addPlay,
  deletePuzzle,
  isCatalogVideo,
  isHiddenPuzzle,
  loadPlayCounts,
  loadPuzzle,
  makeOwnerKey,
  readMyPuzzles,
  removeMyPuzzle,
  savePuzzle,
  SaveError,
  toBody,
  type Genre,
  type HintRef,
  type MyPuzzle,
  type PuzzleRecord,
} from "../../lib/crossword/puzzleStore";
import { formatTime } from "../../lib/crossword/youtubeUrl";

import { PuzzleGridMinimal } from "./components/PuzzleGridMinimal";
import { PuzzleGridRetro } from "./components/PuzzleGridRetro";
import { ClearEffect } from "./components/ClearEffect";
import { detectKeypadType } from "./components/PuzzleKeypad";
import { StickyHintBar } from "./components/StickyHintBar";
import { PuzzleCloseupModal } from "./components/PuzzleCloseupModal";
import { HintField, type Selected as HintSelected } from "./components/HintField";
import { Motion, Presence } from "./components/Motion";
import { Toaster, toast } from "./components/Toast";
import { SaveCheckModal } from "./components/SaveCheckModal";
import { Footer, Icon } from "./components/ui";
import { PuzzleRanking } from "./components/PuzzleRanking";
import { NameEntryModal } from "./components/NameEntryModal";
import { HintList } from "./components/HintList";
import { OtherPuzzles } from "./components/OtherPuzzles";
import { BEGINNER_LABEL } from "./components/PuzzleGalleryCard";
import { detectGroups } from "../../lib/crossword/groupDetect";
import { drawShareImage } from "../../lib/crossword/shareImage";
import { queueScore, retryQueuedScores, saveScore, ScoreError } from "../../lib/crossword/scores";
import { C } from "./style";

// localStorage の鍵（crossword 専用の名前）
const HELP_KEY = "crossword_seen_help";
const PROGRESS_PREFIX = "crossword_progress_";
const SAVE_COUNT_PREFIX = "crossword_save_count_";

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
    /* 保存できなくても遊べる */
  }
};

// 文言（HarmonyPalette の ja.json の puzzle.builder から。問題文の呼び名は「ヒント」→「カギ」）
const T = {
  pageTitle: "クロスワードパズル作成",
  createNew: "新規作成",
  puzzleTitle: "パズルタイトル",
  titlePlaceholder: "例: 音楽なぞなぞチャレンジ！",
  creatorName: "作成者名",
  creatorNamePlaceholder: "ペンネーム（例: パズル職人）",
  answer: "答え",
  clue: "カギ",
  cluePlaceholder: "例: 猫の鳴き声",
  answerPlaceholder: "ニャー",
  addToList: "リストに追加",
  reshuffle: "再シャッフル",
  saving: "保存中...",
  share: "共有する",
  close: "閉じる",
  howToPlay: "遊び方",
  previewTitle: "プレビュー",
  previewSubtitle: "答えとカギを追加すると、ここに盤が組み上がります",
  guidelinesNotice: "※作成されたパズルの著作権および責任は作成者に帰属します。",
  errors: {
    noTitle: "タイトルを入力してください",
    loadFailed: "パズルの読み込みに失敗しました",
    puzzleHidden: "このパズルは非表示になっています",
    loadError: "パズルデータが不正です",
    saveFailed: "パズルの保存に失敗しました",
  },
  // 受付係が断った理由ごとの知らせ【仮】。ここに無い理由は errors.saveFailed
  saveReasons: {
    too_many: "保存が集中しています。時間をおいてもう一度お試しください。",
    verification: "確認に失敗しました。ページを再読み込みしてお試しください。",
    video: "ハロプロのヒントに使える YouTube は、HELLO! VIDEO に載っている動画だけです。",
    bad_request: "内容をご確認のうえ、もう一度お試しください。",
  } as Record<string, string>,
  // 自分が作った問題【仮】
  myPuzzles: {
    title: "自分が作った問題",
    plays: "遊ばれた回数",
    unavailable: "非表示になっています",
    open: "開く",
    delete: "削除",
    confirm: "消す？",
    confirmYes: "消す",
    confirmNo: "やめる",
    deleteFailed: "削除できませんでした",
  },
  shareModal: {
    modalTitle: "パズルを共有",
    shareLink: "共有リンク",
    postToX: "Xに投稿",
    publicNotice: "このパズルは公開され、誰でもプレイできるようになります。",
    healthyContent: "健全なコンテンツの作成にご協力ください。",
  },
  creatorHelp: {
    title: "パズルの作り方",
    steps: [
      { title: "答え・カギ・ヒントを入力", description: "「答え」に単語を、「カギ」にその単語を当てるための問題文を書きます。「ヒント」には、答えの根拠になる動画やページのURLを貼ります。" },
      { title: "リストに追加", description: "入力したら「リストに追加」ボタンを押します。5〜10個の単語を追加するのがおすすめです。" },
      { title: "パズルを自動生成", description: "単語を追加すると、クロスワードパズルが自動で組み上がります。うまく組めない場合は「再シャッフル」でやり直せます。" },
      { title: "保存・共有", description: "タイトルを入力して「共有する」を押すと共有URLが発行されます。SNSでシェアしてみんなに遊んでもらいましょう！" },
    ],
    tipsTitle: "コツ",
    tips: [
      "共通の文字を持つ単語を選ぶとパズルが組みやすくなります",
      "短い単語と長い単語を混ぜるとバランスの良いパズルになります",
      "カギは簡単なものから難しいものまで、さまざまな難易度があるとより楽しめます",
    ],
    close: "閉じる",
  },
  // 段階2b で足した物【仮】
  stage2b: {
    toList: "パズルギャラリー",
    beginner: BEGINNER_LABEL,
    // 選ぶと得をすることを先に言う（任天堂のデザイナー視点のシミュレーションで決定・2026-10-03）
    detected: (groups: string[]) => `ハロプロのメンバー名・グループ名が入っています（${groups.join("、")}）。ハロプロにすると、ハロプロの一覧にも並びます。`,
    toHello: "ハロプロにする",
    scoreFailed: "スコアの保存に失敗しました", // HarmonyPalette と同じ文言
    scoreQueued: "ネットワーク接続がありません。\nスコアはローカルに保存されました。\n接続回復時に自動で送信されます。", // HarmonyPalette と同じ文言
  },
  playerHelp: {
    title: "遊び方",
    steps: ["空欄のマスに文字を入力", "カギを参考に正解を推測", "全マス正解でクリア！"],
    start: "始める！",
  },
};

// デバッグ用モックパズルデータ（?debug=true で使用。HarmonyPalette と同じ問題）
//   x=0  x=1  x=2  x=3
// y=0  ね   こ
// y=1       い   す
// y=2       ぬ   い
// y=3            か   き
const DEBUG_MOCK_PUZZLE: PuzzleData = {
  id: "debug-puzzle",
  width: 4,
  height: 4,
  title: "デバッグ用パズル",
  creatorName: "テストユーザー",
  items: [
    { id: "1", uuid: "1", answer: ["ね", "こ"], question: "動物の一種、ニャーと鳴く", direction: "horizontal", startX: 0, startY: 0, length: 2, clueIndex: 1 },
    { id: "2", uuid: "2", answer: ["こ", "い", "ぬ"], question: "犬の子供", direction: "vertical", startX: 1, startY: 0, length: 3, clueIndex: 2 },
    { id: "3", uuid: "3", answer: ["い", "す"], question: "座るための家具", direction: "horizontal", startX: 1, startY: 1, length: 2, clueIndex: 3 },
    { id: "4", uuid: "4", answer: ["す", "い", "か"], question: "夏に食べる緑と赤の果物", direction: "vertical", startX: 2, startY: 1, length: 3, clueIndex: 4 },
    { id: "5", uuid: "5", answer: ["か", "き"], question: "秋に実る橙色の果物", direction: "horizontal", startX: 2, startY: 3, length: 2, clueIndex: 5 },
  ],
  cells: [
    { x: 0, y: 0, value: "ね", clueNumber: 1 },
    { x: 1, y: 0, value: "こ", clueNumber: 2 },
    { x: 1, y: 1, value: "い", clueNumber: 3 },
    { x: 2, y: 1, value: "す", clueNumber: 4 },
    { x: 1, y: 2, value: "ぬ" },
    { x: 2, y: 2, value: "い" },
    { x: 2, y: 3, value: "か", clueNumber: 5 },
    { x: 3, y: 3, value: "き" },
  ],
};

const GENRES: { key: Genre; label: string }[] = [
  { key: "hello", label: "ハロプロ" },
  { key: "other", label: "その他" },
];
const MAX_TAGS = 10;

const dirLabel = (d: "horizontal" | "vertical") => (d === "horizontal" ? "ヨコ" : "タテ");
const hintSummary = (h?: HintRef) => (!h ? "" : h.kind === "youtube" ? `YouTube ${formatTime(h.startSec)}` : h.url);
const cellsOf = (item: PlacedItem) =>
  Array.from({ length: item.length }, (_, i) => ({
    x: item.direction === "horizontal" ? item.startX + i : item.startX,
    y: item.direction === "vertical" ? item.startY + i : item.startY,
  }));

// 保存した中身から盤を組み直す（位置は保存時のまま。番号も同じになる）
function recordToPuzzle(rec: PuzzleRecord): { puzzle: PuzzleData; hints: Record<string, HintRef> } {
  const body = rec.body;
  if (!body || !Array.isArray(body.clues)) throw new Error("bad body");
  const items: PlacedItem[] = body.clues.map((c, i) => ({
    id: `c${i}`,
    uuid: `c${i}`,
    question: c.clue,
    answer: c.answer,
    direction: c.direction,
    startX: c.startX,
    startY: c.startY,
    length: c.answer.length,
    clueIndex: c.clueIndex,
  }));
  const puzzle = buildGrid(items);
  puzzle.id = rec.id;
  puzzle.title = rec.title;
  puzzle.creatorName = body.creatorName;
  const hints: Record<string, HintRef> = {};
  body.clues.forEach((c, i) => {
    if (c.hint) hints[`c${i}`] = c.hint;
  });
  return { puzzle, hints };
}

// UI Components（HarmonyPalette の Button / Input。色と角は DESIGN.md）
const Button = ({ children, onClick, disabled, className, variant = "primary" }: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  variant?: "primary" | "secondary";
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`px-4 py-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors
      ${variant === "primary" ? "bg-primary text-white hover:bg-secondary" : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"}
      ${className ?? ""}`}
  >
    {children}
  </button>
);

const inputClass =
  "w-full bg-surface-container-low px-3 py-2 text-on-surface placeholder:text-outline focus:outline-none focus:bg-white focus:shadow-[inset_0_-2px_0_#000]";

const Input = ({ value, onChange, placeholder, className, maxLength, onKeyDown }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  maxLength?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) => (
  <input
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    maxLength={maxLength}
    onKeyDown={onKeyDown}
    className={`${inputClass} ${className ?? ""}`}
  />
);

// Icon と Footer は components/ui.tsx へ移した（一覧の画面でも使うため。中身は同じ）

export default function CrosswordPage() {
  const { id: puzzleId } = useParams();
  const [searchParams] = useSearchParams();
  const isDebugMode = searchParams.get("debug") === "true"; // デバッグモード
  const isPlayerMode = !!puzzleId || isDebugMode;

  // Editor State
  const [puzzleTitle, setPuzzleTitle] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [genre, setGenre] = useState<Genre>("hello"); // 【仮】最初の選択
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isBeginner, setIsBeginner] = useState(false); // 初めての人向けの印

  const [editorItems, setEditorItems] = useState<PuzzleItem[]>([]);
  const [hints, setHints] = useState<Record<string, HintRef>>({});
  const [currentInput, setCurrentInput] = useState({ q: "", a: "" });
  const [pendingHint, setPendingHint] = useState<HintRef | null>(null);
  const [hintResetKey, setHintResetKey] = useState(0);
  // 登録済みのカギを直している間はその id（Hop 依頼 2026-10-03。HarmonyPalette は削除だけ）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hintInitial, setHintInitial] = useState<HintSelected | null>(null);
  const clueInputRef = useRef<HTMLInputElement>(null);
  const [generatedPuzzle, setGeneratedPuzzle] = useState<PuzzleData | null>(null);

  // v4 Live Generation State
  const generationIdRef = useRef(0);
  const [isLiveGenerating, setIsLiveGenerating] = useState(false);

  // Monte Carlo Animation State
  const [monteCarloProgress, setMonteCarloProgress] = useState<{ current: number; total: number; bestCount: number } | null>(null);
  const [backgroundPuzzle, setBackgroundPuzzle] = useState<PuzzleData | null>(null);
  const [showPreviewAnimation, setShowPreviewAnimation] = useState(false);

  // Player State
  const [loadState, setLoadState] = useState<"loading" | "done">(isPlayerMode ? "loading" : "done");
  const [playerPuzzle, setPlayerPuzzle] = useState<PuzzleData | null>(null);
  const [playerHints, setPlayerHints] = useState<Record<string, HintRef>>({});
  const [playerGenre, setPlayerGenre] = useState<Genre | null>(null); // 終わりの画面の「ほかの問題」用
  const [isAssemblyAnimating, setIsAssemblyAnimating] = useState(false);
  const [isCleared, setIsCleared] = useState(false);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [activeCell, setActiveCell] = useState<{ x: number; y: number } | null>(null);
  const [currentWordDirection, setCurrentWordDirection] = useState<"horizontal" | "vertical">("horizontal");
  const [activeWordItem, setActiveWordItem] = useState<PlacedItem | null>(null);
  const [showCloseup, setShowCloseup] = useState(false);
  const [activeCloseupIndex, setActiveCloseupIndex] = useState(0);

  // 降参（案C）
  const [surrendered, setSurrendered] = useState<string[]>([]); // 降参したカギの uuid
  const [unsolved, setUnsolved] = useState<string[] | null>(null); // 答え合わせで合っていなかったカギ
  const [confirmSurrender, setConfirmSurrender] = useState<string | null>(null);

  // タイマー関連
  const [startTime, setStartTime] = useState<number | null>(null);
  const [clearTime, setClearTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pausedTime, setPausedTime] = useState(0);
  const [gamePhase, setGamePhase] = useState<"ready" | "playing" | "cleared">("ready");
  const restoredElapsedRef = useRef(0);

  // UI States
  const [showHelp, setShowHelp] = useState(false);
  const [showClearAnimation, setShowClearAnimation] = useState(false);
  const [wrongCells, setWrongCells] = useState<Set<string>>(new Set());
  const [showCreatorHelp, setShowCreatorHelp] = useState(false);
  const [scale, setScale] = useState(1);
  const [showContact, setShowContact] = useState(false);

  // ランキング（HarmonyPalette の Ranking & Name Entry）
  const [showNameEntry, setShowNameEntry] = useState(false);
  const [rankingRefresh, setRankingRefresh] = useState(0);
  const clearTimeRef = useRef<number | null>(null);
  const surrenderedRef = useRef<string[]>([]);

  // Share Modal
  const [showShareModal, setShowShareModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [sharedTitle, setSharedTitle] = useState("");
  const [showSaveCheck, setShowSaveCheck] = useState(false); // 保存の直前の Turnstile

  // 自分が作った問題（この端末の localStorage）と遊ばれた回数
  const [myPuzzles, setMyPuzzles] = useState<MyPuzzle[]>(() => (isPlayerMode ? [] : readMyPuzzles()));
  const [playCounts, setPlayCounts] = useState<Record<string, number> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ページ移動の波は、問題が届くまで（または届かないと分かるまで）待ってもらう
  usePageReady(loadState === "done");

  // [No.12] プログレスバー: 回答率を計算
  const progressPercentage = useMemo(() => {
    if (!playerPuzzle) return 0;
    const totalCells = playerPuzzle.cells.length;
    let filledCount = 0;
    playerPuzzle.cells.forEach((cell) => {
      const val = userAnswers[`${cell.x},${cell.y}`];
      if (typeof val === "string" && val.trim() !== "") filledCount++;
    });
    return totalCells > 0 ? Math.round((filledCount / totalCells) * 100) : 0;
  }, [playerPuzzle, userAnswers]);

  // 交差候補マーキング: 単語リスト内で交差可能な文字を検出（色は黒にそろえた）
  const intersectionMarks = useMemo(() => {
    if (editorItems.length < 2) return new Map<string, Set<string>>();
    const charOccurrences = new Map<string, string[]>();
    editorItems.forEach((item) => {
      const chars = new Set(item.answer.map((a) => a.toUpperCase()));
      chars.forEach((char) => {
        if (!charOccurrences.has(char)) charOccurrences.set(char, []);
        charOccurrences.get(char)!.push(item.id);
      });
    });
    const intersectableChars = new Set<string>();
    charOccurrences.forEach((itemIds, char) => {
      if (itemIds.length >= 2) intersectableChars.add(char);
    });
    const result = new Map<string, Set<string>>();
    editorItems.forEach((item) => {
      const chars = new Set<string>();
      item.answer.forEach((a) => {
        const upperChar = a.toUpperCase();
        if (intersectableChars.has(upperChar)) chars.add(upperChar);
      });
      if (chars.size > 0) result.set(item.id, chars);
    });
    return result;
  }, [editorItems]);

  // 降参したカギのマス
  const faintCells = useMemo(() => {
    const s = new Set<string>();
    if (!playerPuzzle) return s;
    playerPuzzle.items.filter((i) => surrendered.includes(i.uuid)).forEach((i) => cellsOf(i).forEach((c) => s.add(`${c.x},${c.y}`)));
    return s;
  }, [playerPuzzle, surrendered]);

  // --- Initialization ---
  useEffect(() => {
    if (!puzzleId && !isDebugMode) return;
    let alive = true;
    (async () => {
      let loaded: { puzzle: PuzzleData; hints: Record<string, HintRef> } | null = null;
      let failMessage = "";
      // ヒントの見た目を確かめるため、1 と 2 にだけ見本のヒントを付ける（デバッグ用・HarmonyPalette には無い）
      if (isDebugMode) loaded = { puzzle: DEBUG_MOCK_PUZZLE, hints: { "1": { kind: "youtube", videoId: "dQw4w9WgXcQ", startSec: 83 }, "2": { kind: "link", url: "https://example.com/" } } };
      else try {
        const rec = await loadPuzzle(puzzleId!);
        if (!rec) {
          // 読めなかったときだけ、運営に隠された問題かを聞く（聞けなければ今まで通りの知らせ）
          const hidden = await isHiddenPuzzle(puzzleId!).catch(() => false);
          failMessage = hidden ? T.errors.puzzleHidden : T.errors.loadFailed;
        } else {
          loaded = recordToPuzzle(rec);
          setPlayerGenre(rec.genre);
          // 遊ばれた回数を1足す（HarmonyPalette の incrementPlayCount と同じ時機。失敗しても止めない）
          addPlay(rec.id).catch((err) => console.warn("Play count increment failed:", err));
        }
      } catch (error) {
        console.error("Failed to load puzzle:", error);
        failMessage = T.errors.loadError;
      }
      if (!alive) return;
      if (failMessage) toast.error(failMessage);
      if (loaded) {
        const puzzleToLoad = loaded.puzzle;
        setPlayerPuzzle(puzzleToLoad);
        setPlayerHints(loaded.hints);
        setIsAssemblyAnimating(true);
        setTimeout(() => setIsAssemblyAnimating(false), 2000);

        // Load progress from localStorage
        try {
          const saved = lsGet(`${PROGRESS_PREFIX}${puzzleToLoad.id}`);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.userAnswers && typeof parsed.userAnswers === "object") {
              setUserAnswers(parsed.userAnswers);
              if (typeof parsed.elapsedSeconds === "number") restoredElapsedRef.current = parsed.elapsedSeconds;
              if (Array.isArray(parsed.surrendered)) setSurrendered(parsed.surrendered.filter((u: unknown) => typeof u === "string"));
            }
          }
        } catch (e) {
          console.error("Failed to load progress:", e);
        }
      }
      setLoadState("done");
    })();
    return () => {
      alive = false;
    };
  }, [puzzleId, isDebugMode]);

  // キューイングされたスコアの再送信（ネットワーク回復時。HarmonyPalette と同じ）
  useEffect(() => {
    const retry = () => {
      retryQueuedScores().catch((e) => console.error("[Score Queue] Error processing queue:", e));
    };
    retry();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  // 名前入力の窓を出すかを決める時に、今の降参の状態を読む
  useEffect(() => {
    surrenderedRef.current = surrendered;
  }, [surrendered]);

  // メンバー名・グループ名での自動判定（保存の受付係と同じ判定を先に出して知らせる）
  const detectedGroups = useMemo(
    () =>
      detectGroups({
        title: puzzleTitle.trim(),
        clues: editorItems.map((i) => i.question),
        answers: editorItems.map((i) => i.answer.join("")),
      }),
    [puzzleTitle, editorItems]
  );

  // 自分が作った問題の遊ばれた回数を読む（作る画面だけ）
  const myPuzzleIds = myPuzzles.map((m) => m.id).join(",");
  useEffect(() => {
    if (isPlayerMode || !myPuzzleIds) return;
    let alive = true;
    setPlayCounts(null); // 読み終わるまでは空欄（新しく足した問題を「表示できません」と見せないため）
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
  }, [isPlayerMode, myPuzzleIds]);

  const handleDeleteMine = async (m: MyPuzzle) => {
    setDeletingId(m.id);
    try {
      const ok = await deletePuzzle(m.id, m.key);
      if (ok) {
        setMyPuzzles(removeMyPuzzle(m.id));
        setConfirmDelete(null);
      } else {
        toast.error(T.myPuzzles.deleteFailed);
      }
    } catch (err) {
      console.error("Failed to delete puzzle:", err);
      toast.error(T.myPuzzles.deleteFailed);
    } finally {
      setDeletingId(null);
    }
  };

  // 初回ヘルプ表示判定 + タイマー自動開始（遊び方を読んだことがあれば、問題が出たらすぐ始める）
  useEffect(() => {
    if (isPlayerMode && playerPuzzle) {
      const hasSeenHelp = lsGet(HELP_KEY);
      if (!hasSeenHelp) {
        setShowHelp(true);
      } else if (gamePhase === "ready") {
        setGamePhase("playing");
        const restoredMs = restoredElapsedRef.current * 1000;
        setStartTime(Date.now() - restoredMs);
      }
    }
  }, [isPlayerMode, playerPuzzle, gamePhase]);

  // 古いLocalStorageデータの自動削除（7日経過）
  useEffect(() => {
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(PROGRESS_PREFIX));
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      keys.forEach((k) => {
        const data = localStorage.getItem(k);
        if (data) {
          try {
            const parsed = JSON.parse(data);
            if (parsed.savedAt && now - parsed.savedAt > sevenDaysMs) localStorage.removeItem(k);
          } catch {
            localStorage.removeItem(k);
          }
        }
      });
    } catch (e) {
      console.error("[LocalStorage Cleanup] Error:", e);
    }
  }, []);

  // [PC/Desktop] キーボード操作 - 物理キーボードでの直接入力
  useEffect(() => {
    if (!isPlayerMode || !playerPuzzle || isCleared || showCloseup) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key.startsWith("Arrow") && activeCell) {
        e.preventDefault();
        let nextX = activeCell.x;
        let nextY = activeCell.y;
        switch (e.key) {
          case "ArrowUp": nextY--; break;
          case "ArrowDown": nextY++; break;
          case "ArrowLeft": nextX--; break;
          case "ArrowRight": nextX++; break;
        }
        const exists = playerPuzzle.cells.some((c) => c.x === nextX && c.y === nextY);
        if (exists) {
          setActiveCell({ x: nextX, y: nextY });
          const word = findWordAtCell(nextX, nextY, currentWordDirection);
          if (word) setActiveWordItem(word);
        }
      }

      if (/^[a-zA-Z]$/.test(e.key) && activeCell) {
        e.preventDefault();
        handleKeypadInput(e.key.toUpperCase());
      }

      if (e.key === "Backspace" && activeCell) {
        e.preventDefault();
        handleKeypadBackspace();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlayerMode, playerPuzzle, isCleared, showCloseup, activeCell, currentWordDirection, activeWordItem]);

  // 遊び方を閉じたらタイマー開始（HarmonyPalette の Cookie 同意の後の開始の置き換え）
  const closeHelp = () => {
    setShowHelp(false);
    lsSet(HELP_KEY, "true");
    handleStartGame();
  };

  // タイマー開始。遊んでいる途中に遊び方を開き直しても、時間は巻き戻さない
  const handleStartGame = () => {
    if (gamePhase !== "ready") return;
    setGamePhase("playing");
    const restoredMs = restoredElapsedRef.current * 1000;
    setStartTime(Date.now() - restoredMs);
  };

  // カギクリック → クローズアップモーダルを開く
  const focusCellByItem = (item: PlacedItem) => {
    setActiveWordItem(item);
    setCurrentWordDirection(item.direction);
    setActiveCell({ x: item.startX, y: item.startY });
    setActiveCloseupIndex(0);
    setShowCloseup(true);
  };

  // セルをタップ → そのセルを含むワードでクローズアップモーダルを開く
  const openCloseupForCell = (x: number, y: number) => {
    if (!playerPuzzle || isCleared) return;
    const selection = determineNextSelection({
      puzzle: playerPuzzle,
      clickedX: x,
      clickedY: y,
      currentActiveCell: activeCell,
      currentDirection: currentWordDirection,
    });
    if (selection) {
      const { item: word, direction } = selection;
      const index = word.direction === "horizontal" ? x - word.startX : y - word.startY;
      setActiveWordItem(word);
      setCurrentWordDirection(direction);
      setActiveCell({ x, y });
      setActiveCloseupIndex(index);
      setShowCloseup(true);
    }
  };

  const closeupCellKey = (index: number) => {
    const w = activeWordItem!;
    const x = w.direction === "horizontal" ? w.startX + index : w.startX;
    const y = w.direction === "vertical" ? w.startY + index : w.startY;
    return `${x},${y}`;
  };

  // クローズアップモーダル内での入力ハンドラー
  const handleCloseupKeyPress = (char: string) => {
    if (!activeWordItem || isCleared) return;
    const key = closeupCellKey(activeCloseupIndex);
    setUserAnswers((prev) => ({ ...prev, [key]: char.toUpperCase() }));
    if (activeCloseupIndex < activeWordItem.length - 1) setActiveCloseupIndex((prev) => prev + 1);
  };

  const handleCloseupBackspace = () => {
    if (!activeWordItem || isCleared) return;
    const key = closeupCellKey(activeCloseupIndex);
    if (userAnswers[key]) {
      setUserAnswers((prev) => {
        const newAnswers = { ...prev };
        delete newAnswers[key];
        return newAnswers;
      });
    } else if (activeCloseupIndex > 0) {
      const prevIndex = activeCloseupIndex - 1;
      const prevKey = closeupCellKey(prevIndex);
      setActiveCloseupIndex(prevIndex);
      setUserAnswers((prev) => {
        const newAnswers = { ...prev };
        delete newAnswers[prevKey];
        return newAnswers;
      });
    }
  };

  const handleCloseupComplete = () => {
    setShowCloseup(false);
  };

  // クローズアップモーダル内での文字変換（濁音・半濁音・小文字）
  const handleCloseupModifyChar = (char: string) => {
    if (!activeWordItem || isCleared) return;
    const key = closeupCellKey(activeCloseupIndex);
    setUserAnswers((prev) => ({ ...prev, [key]: char.toUpperCase() }));
    if (activeCloseupIndex < activeWordItem.length - 1) setActiveCloseupIndex((prev) => prev + 1);
  };

  // スマートナビゲーション: 指定セルを含むワードを取得
  const findWordAtCell = (x: number, y: number, direction: "horizontal" | "vertical"): PlacedItem | null => {
    if (!playerPuzzle) return null;
    return (
      playerPuzzle.items.find((item) => {
        if (item.direction !== direction) return false;
        if (direction === "horizontal") return y === item.startY && x >= item.startX && x < item.startX + item.length;
        return x === item.startX && y >= item.startY && y < item.startY + item.length;
      }) || null
    );
  };

  // スマートナビゲーション: 次の空きセルを探索
  const findNextEmptyCell = (x: number, y: number, direction: "horizontal" | "vertical", wordItem: PlacedItem | null): { x: number; y: number } | null => {
    if (!wordItem || !playerPuzzle) return null;
    for (let i = 0; i < wordItem.length; i++) {
      const cx = direction === "horizontal" ? wordItem.startX + i : wordItem.startX;
      const cy = direction === "vertical" ? wordItem.startY + i : wordItem.startY;
      const isAfterCurrent = direction === "horizontal" ? cx > x : cy > y;
      if (isAfterCurrent && !userAnswers[`${cx},${cy}`]) return { x: cx, y: cy };
    }
    for (let i = 0; i < wordItem.length; i++) {
      const cx = direction === "horizontal" ? wordItem.startX + i : wordItem.startX;
      const cy = direction === "vertical" ? wordItem.startY + i : wordItem.startY;
      if (!userAnswers[`${cx},${cy}`]) return { x: cx, y: cy };
    }
    return null;
  };

  // キーパッド入力ハンドラー（スマートナビゲーション付き）
  const handleKeypadInput = (char: string) => {
    if (!activeCell || !playerPuzzle || isCleared) return;
    const key = `${activeCell.x},${activeCell.y}`;
    setUserAnswers((prev) => ({ ...prev, [key]: char.toUpperCase() }));
    const nextCell = findNextEmptyCell(activeCell.x, activeCell.y, currentWordDirection, activeWordItem);
    if (nextCell) setActiveCell(nextCell);
    else moveToNextClue();
  };

  // キーパッドBackspaceハンドラー
  const handleKeypadBackspace = () => {
    if (!activeCell || !playerPuzzle || isCleared) return;
    const key = `${activeCell.x},${activeCell.y}`;
    if (userAnswers[key]) {
      setUserAnswers((prev) => {
        const newAnswers = { ...prev };
        delete newAnswers[key];
        return newAnswers;
      });
    } else if (activeWordItem) {
      const idx = currentWordDirection === "horizontal" ? activeCell.x - activeWordItem.startX : activeCell.y - activeWordItem.startY;
      if (idx > 0) {
        const prevX = currentWordDirection === "horizontal" ? activeCell.x - 1 : activeCell.x;
        const prevY = currentWordDirection === "vertical" ? activeCell.y - 1 : activeCell.y;
        setActiveCell({ x: prevX, y: prevY });
        const prevKey = `${prevX},${prevY}`;
        setUserAnswers((prev) => {
          const newAnswers = { ...prev };
          delete newAnswers[prevKey];
          return newAnswers;
        });
      }
    }
  };

  // 次のカギへ移動
  const moveToNextClue = () => {
    if (!playerPuzzle || !activeWordItem) return;
    const allItems = [...playerPuzzle.items].sort((a, b) => (a.clueIndex || 0) - (b.clueIndex || 0));
    const currentIdx = allItems.findIndex((i) => i.uuid === activeWordItem.uuid);
    if (currentIdx < allItems.length - 1) focusCellByItem(allItems[currentIdx + 1]);
  };

  // タイマーUI更新（ページ離脱対応）
  useEffect(() => {
    if (gamePhase !== "playing" || !startTime) return;
    let lastVisibleTime = Date.now();
    const handleVisibilityChange = () => {
      if (document.hidden) lastVisibleTime = Date.now();
      else {
        const pauseDuration = Date.now() - lastVisibleTime;
        setPausedTime((prev) => prev + pauseDuration);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime - pausedTime) / 1000));
    }, 1000);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [gamePhase, startTime, pausedTime]);

  // Persist Progress (including elapsed time)
  useEffect(() => {
    if (playerPuzzle && gamePhase === "playing" && Object.keys(userAnswers).length > 0) {
      lsSet(`${PROGRESS_PREFIX}${playerPuzzle.id}`, JSON.stringify({ userAnswers, elapsedSeconds, surrendered, savedAt: Date.now() }));
    }
  }, [userAnswers, playerPuzzle, elapsedSeconds, gamePhase, surrendered]);

  // --- Editor Functions ---
  const handleAddItem = () => {
    if (!currentInput.a.trim() || !pendingHint) return;
    const answerParts = toCells(currentInput.a);
    // 答えはカタカナの文字盤で打てる字だけ（ひらがなはカタカナにそろう）
    if (!answerParts.every((c) => /^[ァ-ヶー]$/.test(c))) {
      toast.error("答えは、ひらがな・カタカナ・「ー」で入れてください。\n漢字・数字・英字・記号は使えません。", { duration: 5000 });
      return;
    }

    const generateUUID = () => {
      if (typeof crypto !== "undefined" && crypto.randomUUID) {
        try {
          return crypto.randomUUID();
        } catch {
          /* 下の作り方で作る */
        }
      }
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    };

    const newItem: PuzzleItem = {
      id: editingId ?? generateUUID(),
      question: currentInput.q || "（カギなし）",
      answer: answerParts,
    };

    // 直している最中なら、そのカギを入れ替える（並びはそのまま）
    const newItems = editingId ? editorItems.map((i) => (i.id === editingId ? newItem : i)) : [...editorItems, newItem];
    setEditorItems(newItems);
    setHints((prev) => ({ ...prev, [newItem.id]: pendingHint }));
    resetItemInput();

    triggerGeneration(newItems);
  };

  // 入力欄を空に戻し、直している状態もやめる
  const resetItemInput = () => {
    setCurrentInput({ q: "", a: "" });
    setPendingHint(null);
    setEditingId(null);
    setHintInitial(null);
    setHintResetKey((k) => k + 1);
  };

  // 登録済みのカギを入力欄に戻して直せるようにする
  const handleEditItem = (item: PuzzleItem) => {
    const h = hints[item.id];
    setCurrentInput({ a: item.answer.join(""), q: item.question === "（カギなし）" ? "" : item.question });
    setEditingId(item.id);
    setHintInitial(h ? { hint: h, label: hintSummary(h) } : null);
    setHintResetKey((k) => k + 1);
  };

  // カギの欄の、今の文字の位置に「○」を入れる（Hop 依頼 2026-10-03。「音大卒○○○の伝道師」のような穴あきのカギ用）
  const insertMaru = () => {
    const el = clueInputRef.current;
    const q = currentInput.q;
    const start = el?.selectionStart ?? q.length;
    const end = el?.selectionEnd ?? q.length;
    const next = q.slice(0, start) + "○" + q.slice(end);
    setCurrentInput({ ...currentInput, q: next });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + 1, start + 1);
    });
  };

  const handleRemoveItem = (itemId: string) => {
    const newItems = editorItems.filter((i) => i.id !== itemId);
    setEditorItems(newItems);
    if (itemId === editingId) resetItemInput();
    triggerGeneration(newItems);
  };

  // v4 Live Generation: Monte Carlo式・全50試行アニメーション
  const triggerGeneration = async (items: PuzzleItem[], isReshuffle: boolean = false) => {
    setShowPreviewAnimation(isReshuffle);

    if (items.length === 0) {
      setGeneratedPuzzle(null);
      setBackgroundPuzzle(null);
      setMonteCarloProgress(null);
      return;
    }

    const currentGenId = ++generationIdRef.current;
    setIsLiveGenerating(true);
    setMonteCarloProgress({ current: 0, total: 50, bestCount: 0 });

    try {
      const generator = generateMonteCarloSteps(items, 50);
      let bestPuzzle: PuzzleData | null = null;
      let bestCount = 0;
      let bestArea = Infinity;

      for (const step of generator) {
        if (generationIdRef.current !== currentGenId) return;

        if (step.placed.length > 0) {
          const puzzle = buildGrid(step.placed);
          puzzle.title = puzzleTitle.trim() || "Generated Puzzle";
          setBackgroundPuzzle(puzzle);

          // Track best result: 単語数最大 → 面積最小 の優先順位
          const currentArea = puzzle.width * puzzle.height;
          if (step.placed.length > bestCount || (step.placed.length === bestCount && currentArea < bestArea)) {
            bestCount = step.placed.length;
            bestArea = currentArea;
            bestPuzzle = puzzle;
          }
        }

        setMonteCarloProgress({ current: step.attempt, total: step.total, bestCount: step.bestSoFar.length });

        // Animation wait: 100ms per attempt = 5 seconds total
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (bestPuzzle) setGeneratedPuzzle(bestPuzzle);
      setBackgroundPuzzle(null);
    } catch (error) {
      console.error("[MonteCarloAnim] Error:", error);
    } finally {
      if (generationIdRef.current === currentGenId) {
        setIsLiveGenerating(false);
        setMonteCarloProgress(null);
      }
    }
  };

  const handleShare = async () => {
    if (!generatedPuzzle) return;

    // --- Rate Limit Check (Client-side) ---
    const today = new Date().toISOString().split("T")[0];
    const limitKey = `${SAVE_COUNT_PREFIX}${today}`;
    const savedCount = parseInt(lsGet(limitKey) || "0", 10);
    if (savedCount >= 5) {
      toast.error("1日に作成・保存できるパズルは5個までです。\nサーバーの負荷軽減にご協力ください。明日また作成をお願いします！", { duration: 5000 });
      return;
    }

    // --- Title Check ---（いま欄に入っている題名で確かめる）
    const title = puzzleTitle.trim();
    if (!title) {
      toast.error(T.errors.noTitle);
      return;
    }

    // --- Quality Guard ---
    if (generatedPuzzle.items.length < 2) {
      toast.error("パズルを保存するには、最低2つの単語を登録してください。");
      return;
    }
    const intersectionCount = generatedPuzzle.cells.filter((c) => c.horizontalItemId && c.verticalItemId).length;
    if (intersectionCount < 1) {
      toast.error("クロスワードパズルとして保存するには、単語同士が交差している必要があります。\n（コツ：同じ文字を含む単語を追加してみてください）", { duration: 5000 });
      return;
    }

    setIsSaving(true);
    try {
      // ハロプロのジャンルでは、YouTube のヒントが台帳にある動画か確かめる（その他で選んだ後にジャンルを変えた場合など）
      if (genre === "hello") {
        const ng: string[] = [];
        for (const item of generatedPuzzle.items) {
          const h = hints[item.id];
          if (h?.kind === "youtube" && !(await isCatalogVideo(h.videoId))) ng.push(item.answer.join(""));
        }
        if (ng.length > 0) {
          toast.error(`${T.saveReasons.video}\n（${ng.join("、")}）`, { duration: 5000 });
          setIsSaving(false);
          return;
        }
      }
    } catch (error) {
      console.error("Failed to save puzzle:", error);
      toast.error(T.errors.saveFailed);
      setIsSaving(false);
      return;
    }
    // 保存の直前に人間かどうかを確かめる。済んだら saveWithToken へ続く
    setShowSaveCheck(true);
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
    const today = new Date().toISOString().split("T")[0];
    const limitKey = `${SAVE_COUNT_PREFIX}${today}`;
    const savedCount = parseInt(lsGet(limitKey) || "0", 10);
    const title = puzzleTitle.trim();
    try {
      const body = toBody(generatedPuzzle.items, generatedPuzzle.width, generatedPuzzle.height, (id) => hints[id]);
      if (creatorName.trim()) body.creatorName = creatorName.trim();
      const key = makeOwnerKey();
      // シェア画像。描けなければ画像なしで保存する
      const ogpImage = await drawShareImage(generatedPuzzle, title);
      const id = await savePuzzle({ title, genre, tags, body, isBeginner }, { key, token, website, ogpImage });
      setMyPuzzles(addMyPuzzle({ id, title, key, createdAt: Date.now() }));
      const url = `${window.location.origin}/crossword/${id}`;
      setShareUrl(url);
      setSharedTitle(title);
      setShowShareModal(true);
      lsSet(limitKey, String(savedCount + 1));
    } catch (error) {
      console.error("Failed to save puzzle:", error);
      const reason = error instanceof SaveError ? error.reason : "";
      toast.error(T.saveReasons[reason] ?? T.errors.saveFailed, { duration: 5000 });
    } finally {
      setIsSaving(false);
    }
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

  // --- Player Functions ---
  const handleCellChange = (cell: { x: number; y: number }, val: string) => {
    setUserAnswers((prev) => ({ ...prev, [`${cell.x},${cell.y}`]: val }));
  };

  const handleReset = () => {
    if (confirm("入力をすべて消去しますか？")) {
      setUserAnswers({});
      setIsCleared(false);
      setStartTime(Date.now());
      setElapsedSeconds(0);
      setPausedTime(0);
      setWrongCells(new Set());
      setSurrendered([]);
      setUnsolved(null);
      setConfirmSurrender(null);
    }
  };

  const handleClearCheck = async () => {
    if (!playerPuzzle?.cells) return;

    let allCorrect = true;
    const wrong = new Set<string>();
    for (const cell of playerPuzzle.cells) {
      const userVal = userAnswers[`${cell.x},${cell.y}`];
      if (userVal !== cell.value) {
        allCorrect = false;
        wrong.add(`${cell.x},${cell.y}`);
      }
    }

    if (allCorrect) {
      setWrongCells(new Set());
      setUnsolved(null);
      setConfirmSurrender(null);

      // Stage 1: クリア演出開始
      setShowClearAnimation(true);
      setGamePhase("cleared");

      // Stage 2: タイム計算（500ms後）
      clearTimeRef.current = null;
      setTimeout(() => {
        if (startTime && puzzleId) {
          const timeSeconds = Math.floor((Date.now() - startTime - pausedTime) / 1000);
          setClearTime(timeSeconds);
          clearTimeRef.current = timeSeconds;
        }
      }, 500);

      // Stage 3: クリア状態確定（1000ms後）
      setTimeout(() => setIsCleared(true), 1000);

      // Stage 4: アニメーション終了・名前入力の窓（2000ms後）
      // 降参したカギがある回は記録しない【仮】ので、窓も出さない
      setTimeout(() => {
        setShowClearAnimation(false);
        if (puzzleId && clearTimeRef.current !== null && clearTimeRef.current >= 1 && surrenderedRef.current.length === 0) {
          setShowNameEntry(true);
        }
      }, 2000);
    } else {
      setWrongCells(wrong);
      // 合っていないカギの一覧（降参の入口）
      const sorted = [...playerPuzzle.items].sort((a, b) => (a.clueIndex || 0) - (b.clueIndex || 0));
      setUnsolved(sorted.filter((i) => !surrendered.includes(i.uuid) && cellsOf(i).some((c) => wrong.has(`${c.x},${c.y}`))).map((i) => i.uuid));
      setConfirmSurrender(null);
      toast.error("まだ間違いがあるか、未入力のマスがあります。\n赤枠のマスを確認してください。", { duration: 5000 });
      setTimeout(() => setWrongCells(new Set()), 3000);
    }
  };

  // --- Submit Score Logic with Network Protection（HarmonyPalette の handleSubmitScore と同じ動き） ---
  const handleSubmitScore = async (name: string) => {
    const t = clearTimeRef.current;
    if (!puzzleId || t === null) return;
    try {
      await saveScore(puzzleId, t, name);
      setShowNameEntry(false);
      setRankingRefresh((k) => k + 1);
    } catch (error) {
      console.error("Failed to save score:", error);
      const isNetworkError = (error instanceof ScoreError && error.reason === "network") || !navigator.onLine;
      if (isNetworkError) {
        queueScore(puzzleId, t, name);
        toast.success(T.stage2b.scoreQueued, { duration: 6000 });
        setShowNameEntry(false);
      } else {
        toast.error(T.stage2b.scoreFailed);
      }
    }
  };

  // スキップしたら記録しない（Hop 決定 2026-10-03。HarmonyPalette は名前なしで記録していた）
  const handleSkipScore = () => {
    setShowNameEntry(false);
  };

  // 降参: そのカギの答えをマスに入れ、薄い色で区別する
  const handleSurrender = (uuid: string) => {
    const item = playerPuzzle?.items.find((i) => i.uuid === uuid);
    if (!item) return;
    setUserAnswers((prev) => {
      const next = { ...prev };
      cellsOf(item).forEach((c, i) => {
        next[`${c.x},${c.y}`] = item.answer[i];
      });
      return next;
    });
    setSurrendered((prev) => (prev.includes(uuid) ? prev : [...prev, uuid]));
    setUnsolved((prev) => (prev ? prev.filter((u) => u !== uuid) : prev));
    setConfirmSurrender(null);
  };

  const clueList = (dir: "horizontal" | "vertical") =>
    playerPuzzle!.items.filter((i) => i.direction === dir).sort((a, b) => (a.clueIndex || 0) - (b.clueIndex || 0));

  // --- Render ---

  if (isPlayerMode && playerPuzzle) {
    const unsolvedItems = (unsolved ?? []).map((u) => playerPuzzle.items.find((i) => i.uuid === u)).filter((i): i is PlacedItem => !!i);
    const surrenderedItems = playerPuzzle.items
      .filter((i) => surrendered.includes(i.uuid))
      .sort((a, b) => (a.clueIndex || 0) - (b.clueIndex || 0));
    return (
      <div className="min-h-screen bg-surface">
        <Toaster />
        {/* [No.01] Sticky Header - 60px固定 */}
        <header className="sticky top-0 z-30 bg-surface h-[60px] flex items-center px-4" style={{ borderBottom: `1px solid ${C.ghost}` }}>
          <div className="container mx-auto max-w-4xl flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* Issue 5: ゲーム中（playing）は作成モードへのリンクを非表示 */}
              {gamePhase !== "playing" && (
                <Link to="/crossword" className="p-1.5 hover:bg-surface-container-high transition-colors" style={{ color: C.ink }} title="作成モードへ戻る">
                  <Icon icon="chevron_left" />
                </Link>
              )}
              {/* [No.02] Title & Author - 縦積み、truncate */}
              <div className="flex flex-col min-w-0 flex-1">
                <h1 className="text-base font-bold truncate" style={{ color: C.ink }}>{playerPuzzle.title || "クロスワードパズル"}</h1>
                {playerPuzzle.creatorName && (
                  <p className="text-xs truncate" style={{ color: C.secondary }}>{playerPuzzle.creatorName}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {gamePhase === "playing" && (
                <span className="text-lg font-mono font-bold tabular-nums" style={{ color: C.ink }}>
                  {String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:{String(elapsedSeconds % 60).padStart(2, "0")}
                </span>
              )}
              <button onClick={handleReset} className="p-1.5 hover:bg-surface-container-high transition-colors" style={{ color: C.ink }} title="リセット">
                <Icon icon="restart_alt" />
              </button>
            </div>
          </div>
        </header>

        {/* [No.12] プログレスバー - ヘッダー直下 */}
        {gamePhase !== "ready" && (
          <div className="sticky top-[60px] z-20 bg-white">
            <div className="h-1 bg-surface-container-high">
              <div className="h-full transition-all duration-300 bg-primary" style={{ width: `${progressPercentage}%` }} />
            </div>
          </div>
        )}

        <div className="container mx-auto max-w-2xl px-4 py-4">
          {/* --- Start Overlay / Help Modal --- */}
          <Presence>
            {showHelp && (
              <Motion
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4"
                style={{ background: "rgba(0,0,0,0.7)" }}
              >
                <Motion
                  initial={{ scale: 0.9, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  className="bg-white p-8 max-w-md w-full relative overflow-hidden"
                  style={{ boxShadow: C.modalShadow }}
                >
                  <div className="absolute top-0 left-0 w-full h-1 bg-primary" />

                  <div className="text-center mb-6">
                    <h2 className="text-2xl font-bold mb-2" style={{ color: C.ink }}>{T.playerHelp.title}</h2>
                    <p className="text-sm" style={{ color: C.secondary }}>Created by {playerPuzzle.creatorName || "Anonymous"}</p>
                  </div>

                  <div className="space-y-4 mb-8">
                    {T.playerHelp.steps.map((s, i) => (
                      <div key={i} className="flex gap-4 items-start bg-surface-container-low p-3">
                        <span className="bg-primary text-white font-bold w-6 h-6 flex items-center justify-center text-sm flex-shrink-0">{i + 1}</span>
                        <p className="text-sm" style={{ color: C.ink }}>{s}</p>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => {
                      closeHelp();
                      handleStartGame();
                    }}
                    className="w-full bg-primary hover:bg-secondary text-white font-bold py-4 text-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    <Icon icon="play_arrow" />
                    {T.playerHelp.start}
                  </button>
                </Motion>
              </Motion>
            )}
          </Presence>

          <div className="flex justify-center items-center gap-4 mb-8">
            <p className="text-center text-sm" style={{ color: C.secondary }}>クロスワードパズル</p>
            <button onClick={() => setShowHelp(true)} className="transition-colors hover:text-black" style={{ color: C.outline }} title={T.howToPlay}>
              <Icon icon="help" />
            </button>
          </div>

          <Presence>
            {isAssemblyAnimating ? (
              <Motion initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center p-12" style={{ color: C.secondary }}>
                {/* Skeleton Grid */}
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {[...Array(25)].map((_, i) => (
                    <div key={i} className="h-12 w-12 bg-surface-container-high motion-safe:animate-pulse" style={{ animationDelay: `${i * 30}ms` }} />
                  ))}
                </div>
                <p className="text-sm">パズルを構築中...</p>
              </Motion>
            ) : (
              <Motion initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="space-y-8">
                {/* パズル描画エリア */}
                <div className="mb-8 w-full">
                  <div
                    className="w-full bg-white p-6 flex justify-center items-center overflow-hidden"
                    style={{ minHeight: (playerPuzzle.height * 48 + 48) * scale }}
                  >
                    <div style={{ transform: `scale(${scale})`, transformOrigin: "center center", transition: "transform 0.2s ease-out" }}>
                      <PuzzleGridRetro
                        data={playerPuzzle}
                        showSolution={isCleared}
                        userAnswers={userAnswers}
                        onCellChange={(cell, val) => handleCellChange(cell, val)}
                        activeCell={activeCell}
                        onCellFocus={(x, y) => openCloseupForCell(x, y)}
                        onCellClick={(x, y) => openCloseupForCell(x, y)}
                        wrongCells={wrongCells}
                        faintCells={faintCells}
                      />
                    </div>
                  </div>

                  {/* Zoom Controls - 中央下に配置 */}
                  <div className="flex justify-center gap-2 mt-4">
                    <button
                      onClick={() => setScale((prev) => Math.min(2.0, prev + 0.1))}
                      disabled={scale >= 2.0}
                      className="p-2 bg-surface-container-high hover:bg-surface-container-highest disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      aria-label="ズームイン"
                      title="拡大"
                      style={{ color: C.ink }}
                    >
                      <Icon icon="zoom_in" />
                    </button>
                    <button
                      onClick={() => setScale((prev) => Math.max(0.5, prev - 0.1))}
                      disabled={scale <= 0.5}
                      className="p-2 bg-surface-container-high hover:bg-surface-container-highest disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      aria-label="ズームアウト"
                      title="縮小"
                      style={{ color: C.ink }}
                    >
                      <Icon icon="zoom_out" />
                    </button>
                    {scale !== 1 && (
                      <button
                        onClick={() => setScale(1)}
                        className="px-2 py-1 bg-surface-container-high hover:bg-surface-container-highest transition-colors text-xs font-bold"
                        title="リセット"
                        style={{ color: C.ink }}
                      >
                        {(scale * 100).toFixed(0)}%
                      </button>
                    )}
                  </div>
                </div>

                {/* Sticky Hint Bar - モーダルが閉じている時のみ表示 */}
                {!isCleared && !showCloseup && (
                  <StickyHintBar
                    currentHint={activeWordItem ? { number: activeWordItem.clueIndex || 0, direction: activeWordItem.direction, hint: activeWordItem.question } : null}
                    onPrevHint={() => {
                      if (!playerPuzzle || !activeWordItem) return;
                      const allItems = [...playerPuzzle.items].sort((a, b) => (a.clueIndex || 0) - (b.clueIndex || 0));
                      const currentIdx = allItems.findIndex((i) => i.uuid === activeWordItem.uuid);
                      if (currentIdx > 0) focusCellByItem(allItems[currentIdx - 1]);
                    }}
                    onNextHint={() => moveToNextClue()}
                    onToggleDirection={() => {
                      if (!activeCell || !playerPuzzle) return;
                      const newDirection = currentWordDirection === "horizontal" ? "vertical" : "horizontal";
                      const newWord = findWordAtCell(activeCell.x, activeCell.y, newDirection);
                      if (newWord) {
                        setCurrentWordDirection(newDirection);
                        setActiveWordItem(newWord);
                      }
                    }}
                  />
                )}

                {/* Controls */}
                <div className="flex justify-center gap-4">
                  <Button onClick={handleClearCheck} variant="primary">答え合わせ</Button>
                </div>

                {/* 合っていないカギ（答え合わせで間違い・未入力があった時だけ出る。降参の入口） */}
                {!isCleared && unsolvedItems.length > 0 && (
                  <div className="bg-white p-4">
                    <h3 className="text-[0.6875rem] font-bold tracking-[0.1em] mb-2" style={{ color: C.secondary }}>合っていないカギ</h3>
                    <ul>
                      {unsolvedItems.map((item) => (
                        <li key={item.uuid} className="py-2" style={{ borderTop: `1px solid ${C.ghost}` }}>
                          {confirmSurrender === item.uuid ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="flex-1 text-sm" style={{ color: C.ink }}>
                                {item.clueIndex}（{dirLabel(item.direction)}）の答えを見る？
                                {/* 降参すると記録されないことを、選ぶ時に知らせる（任天堂のデザイナー視点のシミュレーションで決定・2026-10-03）【仮】 */}
                                {puzzleId && (
                                  <span className="block text-xs mt-0.5" style={{ color: C.secondary }}>ランキングには記録されなくなります。</span>
                                )}
                              </span>
                              <button onClick={() => handleSurrender(item.uuid)} className="px-3 py-1.5 text-sm font-bold bg-primary text-white hover:bg-secondary transition-colors">
                                降参する
                              </button>
                              <button onClick={() => setConfirmSurrender(null)} className="px-3 py-1.5 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors" style={{ color: C.ink }}>
                                やめる
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button onClick={() => focusCellByItem(item)} className="flex-1 text-left text-sm" style={{ color: C.ink }}>
                                <span className="font-bold mr-2">{item.clueIndex}.</span>
                                <span className="mr-2" style={{ color: C.secondary }}>{dirLabel(item.direction)}</span>
                                {item.question}
                              </button>
                              <button onClick={() => setConfirmSurrender(item.uuid)} className="px-3 py-1.5 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors" style={{ color: C.ink }}>
                                降参
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Clue List */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8 bg-surface-container-low p-6">
                  {(["horizontal", "vertical"] as const).map((dir) => (
                    <div key={dir}>
                      <h3 className="font-bold mb-4 pb-2" style={{ color: C.ink }}>
                        {dir === "horizontal" ? "→ ヨコのカギ" : "↓ タテのカギ"}
                      </h3>
                      <ul className="space-y-2">
                        {clueList(dir).map((item) => (
                          <li
                            key={item.uuid}
                            onClick={() => focusCellByItem(item)}
                            className="text-sm cursor-pointer hover:bg-surface-container-high p-2 transition-colors"
                            style={{ color: C.ink }}
                          >
                            <span className="font-bold mr-2">{item.clueIndex}.</span>
                            {item.question}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="text-center mt-8 text-xs" style={{ color: C.secondary }}>
                  ※作成されたパズルの著作権および責任は作成者に帰属します。
                </div>

                {/* 不適切なパズルを通報するリンク */}
                <div className="text-center mt-2">
                  <button
                    onClick={() => setShowContact(true)}
                    className="text-xs transition-colors inline-flex items-center gap-1 hover:text-black"
                    style={{ color: C.secondary }}
                  >
                    <Icon size={12} icon="flag" />
                    不適切なパズルを通報する
                  </button>
                </div>

                {isCleared && (
                  <>
                    <ClearEffect />
                    {/* 解けなかったカギ（降参したカギ） */}
                    {surrenderedItems.length > 0 && (
                      <div className="bg-white p-4 mt-6">
                        <h3 className="text-[0.6875rem] font-bold tracking-[0.1em] mb-2" style={{ color: C.secondary }}>解けなかった</h3>
                        <ul className="space-y-1">
                          {surrenderedItems.map((item) => (
                            <li key={item.uuid} className="text-sm" style={{ color: C.ink }}>
                              <span className="font-bold mr-2">{item.clueIndex}.</span>
                              <span className="mr-2" style={{ color: C.secondary }}>{dirLabel(item.direction)}</span>
                              {item.question}
                              <span className="ml-2 font-bold">{item.answer.join("")}</span>
                            </li>
                          ))}
                        </ul>
                        {/* 降参した回は記録しないことを知らせる（Hop 決定 2026-10-03）【仮】 */}
                        {puzzleId && (
                          <p className="text-xs mt-3" style={{ color: C.secondary }}>降参したカギがあるので、ランキングには記録されません。</p>
                        )}
                      </div>
                    )}
                    {/* ランキング（降参したカギがある回は今回のタイムを出さない） */}
                    {puzzleId && (
                      <div className="mt-6">
                        <PuzzleRanking
                          puzzleId={puzzleId}
                          currentScore={surrendered.length === 0 && clearTime !== null ? clearTime : undefined}
                          refreshKey={rankingRefresh}
                        />
                      </div>
                    )}
                    {/* ヒントの動画の一覧 */}
                    <HintList items={playerPuzzle.items} hints={playerHints} />
                    {/* ほかの問題と一覧への入口 */}
                    {puzzleId && playerGenre && <OtherPuzzles genre={playerGenre} puzzleId={puzzleId} />}
                    {/* 作成モードへ戻るリンク */}
                    <div className="text-center mt-4">
                      <Link
                        to="/crossword"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-surface-container-high hover:bg-surface-container-highest transition-colors font-medium"
                        style={{ color: C.ink }}
                      >
                        <Icon icon="add" />
                        {T.createNew}
                      </Link>
                    </div>
                  </>
                )}
              </Motion>
            )}
          </Presence>
        </div>

        {/* Closeup Modal - セルまたはカギをタップした時に表示 */}
        <Presence>
          {showCloseup && activeWordItem && (
            <PuzzleCloseupModal
              wordItem={activeWordItem}
              userAnswers={userAnswers}
              activeIndex={activeCloseupIndex}
              keypadType={detectKeypadType(playerPuzzle.items.map((item) => item.answer.join("")))}
              hint={playerHints[activeWordItem.uuid]}
              onKeyPress={handleCloseupKeyPress}
              onBackspace={handleCloseupBackspace}
              onClose={() => setShowCloseup(false)}
              onComplete={handleCloseupComplete}
              onPrevCell={() => setActiveCloseupIndex((prev) => Math.max(0, prev - 1))}
              onNextCell={() => setActiveCloseupIndex((prev) => Math.min((activeWordItem?.length || 1) - 1, prev + 1))}
              onModifyChar={handleCloseupModifyChar}
            />
          )}
        </Presence>

        {/* Clear Animation Overlay */}
        <Presence>
          {showClearAnimation && (
            <Motion
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 flex flex-col items-center justify-center z-50"
              style={{ background: "rgba(0,0,0,0.7)" }}
            >
              <Motion initial={{ scale: 0 }} animate={{ scale: [0, 1.2, 1] }} transition={{ duration: 0.5 }} className="text-6xl font-black text-white">
                CLEAR!
              </Motion>
              <Motion initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="text-2xl mt-4" style={{ color: "rgba(255,255,255,0.9)" }}>
                {clearTime !== null && (
                  <span>
                    タイム: {String(Math.floor(clearTime / 60)).padStart(2, "0")}:{String(clearTime % 60).padStart(2, "0")}
                  </span>
                )}
              </Motion>
            </Motion>
          )}
        </Presence>

        {/* Name Entry Modal for Ranking */}
        {showNameEntry && clearTime !== null && (
          <NameEntryModal clearTime={clearTime} onSubmit={handleSubmitScore} onSkip={handleSkipScore} />
        )}

        {showContact && <ContactModal onClose={() => setShowContact(false)} initialTool="crossword" puzzleId={puzzleId} />}

        <Footer bottomGap={!isCleared && !showCloseup} />
      </div>
    );
  }

  // 問題を読み込んでいる間は何も出さない（作る画面がちらつかないように）
  if (isPlayerMode && loadState === "loading") {
    return <div className="min-h-screen bg-surface" />;
  }

  // 置けなかった語（完成の定義: どれが置けなかったかを出す）
  const unplaced = generatedPuzzle && !isLiveGenerating ? editorItems.filter((i) => !generatedPuzzle.items.some((p) => p.id === i.id)) : [];

  // Editor View
  return (
    <>
      <Toaster />
      {/* Monte Carlo背景アニメーション: 全試行を背景に高速描画 */}
      <Presence>
        {backgroundPuzzle && monteCarloProgress && (
          <Motion initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-20 pointer-events-none overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center opacity-50 scale-125">
              <PuzzleGridMinimal data={backgroundPuzzle} />
            </div>
            {/* 進捗表示オーバーレイ（アニメーションのみ、試行回数非表示） */}
            <div
              className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-white px-6 py-3 text-sm font-semibold z-30 flex items-center gap-3"
              style={{ color: C.ink, boxShadow: C.modalShadow }}
            >
              <div className="w-4 h-4 border-2 border-black border-t-transparent motion-safe:animate-spin" />
              <span>最適化中...</span>
            </div>
          </Motion>
        )}
      </Presence>

      <div className={`min-h-screen pt-20 pb-20 px-4 relative z-10 ${backgroundPuzzle && monteCarloProgress ? "bg-transparent" : "bg-surface"}`}>
        {/* ページ見出し */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <h1 className="text-3xl font-bold text-center" style={{ color: C.ink }}>{T.pageTitle}</h1>
          <button
            type="button"
            onClick={() => setShowCreatorHelp(true)}
            className="transition-colors p-1.5 hover:bg-surface-container-high"
            style={{ color: C.secondary }}
            title={T.howToPlay}
          >
            <Icon icon="help" />
          </button>
        </div>

        {/* 一覧への入口【仮】 */}
        <div className="flex justify-center mb-6">
          <Link to="/crossword/list" className="text-sm font-bold inline-flex items-center gap-1 hover:text-black transition-colors" style={{ color: C.secondary }}>
            {T.stage2b.toList} <span aria-hidden="true">→</span>
          </Link>
        </div>

        {/* ジャンル（HarmonyPalette の文字/コードの切り替えがあった場所） */}
        <div className="flex justify-center mb-6">
          <div className="inline-flex overflow-hidden" role="radiogroup" aria-label="ジャンル">
            {GENRES.map((g) => (
              <button
                key={g.key}
                role="radio"
                aria-checked={genre === g.key}
                onClick={() => {
                  if (genre === g.key) return;
                  setGenre(g.key);
                  setPendingHint(null);
                  setHintResetKey((k) => k + 1);
                }}
                className={`px-6 py-2.5 font-semibold transition-colors ${genre === g.key ? "bg-primary text-white" : "bg-white text-on-surface hover:bg-surface-container-low"}`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="container mx-auto max-w-5xl">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Input Panel */}
            <div className="bg-white p-6 space-y-6">
              <div>
                <h2 className="text-base font-semibold mb-4 flex items-center gap-2 pb-2" style={{ color: C.ink }}>
                  <Icon icon="add" /> {T.createNew}
                </h2>

                <div className="space-y-1 mb-4">
                  <label className="text-xs font-mono font-bold" style={{ color: C.secondary }}>{T.puzzleTitle}</label>
                  <Input value={puzzleTitle} onChange={setPuzzleTitle} placeholder={T.titlePlaceholder} maxLength={50} />
                </div>

                <div className="space-y-1 mb-4">
                  <label className="text-xs font-mono font-bold" style={{ color: C.secondary }}>{T.creatorName}</label>
                  <Input value={creatorName} onChange={setCreatorName} placeholder={T.creatorNamePlaceholder} maxLength={50} />
                </div>

                {/* タグ（任意・最大10） */}
                <div className="space-y-1 mb-4">
                  <label className="text-xs font-mono font-bold" style={{ color: C.secondary }}>タグ（任意・{MAX_TAGS}個まで）</label>
                  <div className="flex gap-2">
                    <Input
                      value={tagInput}
                      onChange={setTagInput}
                      placeholder="入力して Enter"
                      maxLength={20}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                    />
                    <Button onClick={addTag} disabled={!tagInput.trim() || tags.length >= MAX_TAGS} variant="secondary" className="shrink-0">
                      追加
                    </Button>
                  </div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {tags.map((t) => (
                        <span key={t} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-surface-container-high" style={{ color: C.ink }}>
                          {t}
                          <button onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`${t} を外す`} className="leading-none">
                            <Icon size={14} icon="close" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 初めての人向けの印【仮】 */}
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: C.ink }}>
                  <input type="checkbox" checked={isBeginner} onChange={(e) => setIsBeginner(e.target.checked)} className="w-4 h-4 accent-black" />
                  {T.stage2b.beginner}
                </label>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-mono font-bold" style={{ color: C.secondary }}>{T.answer}</label>
                  <Input value={currentInput.a} onChange={(v) => setCurrentInput({ ...currentInput, a: v })} placeholder={T.answerPlaceholder} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono font-bold" style={{ color: C.secondary }}>{T.clue}</label>
                  <div className="flex gap-2">
                    <input
                      ref={clueInputRef}
                      value={currentInput.q}
                      onChange={(e) => setCurrentInput({ ...currentInput, q: e.target.value })}
                      placeholder={T.cluePlaceholder}
                      className={`${inputClass} flex-1 min-w-0`}
                    />
                    {/* 穴あきのカギ用。今の文字の位置に「○」を1つ入れる */}
                    <button type="button" onClick={insertMaru} className="px-4 bg-surface-container-high hover:bg-surface-container-highest font-bold transition-colors" style={{ color: C.ink }} aria-label="○を入れる">
                      ○
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono font-bold" style={{ color: C.secondary }}>ヒント</label>
                  <HintField genre={genre} onChange={setPendingHint} resetKey={hintResetKey} inputClassName={inputClass} initial={hintInitial} />
                </div>
                {editingId ? (
                  <div className="flex gap-2">
                    <Button onClick={handleAddItem} disabled={!currentInput.a || !pendingHint} className="flex-1">
                      更新する
                    </Button>
                    <Button onClick={resetItemInput} variant="secondary">
                      やめる
                    </Button>
                  </div>
                ) : (
                  <Button onClick={handleAddItem} disabled={!currentInput.a || !pendingHint} className="w-full">
                    {T.addToList}
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
                  {editorItems.map((item) => {
                    const chars = intersectionMarks.get(item.id);
                    return (
                      <div key={item.id} className={`flex justify-between items-center p-2 ${editingId === item.id ? "bg-surface-container-highest" : "bg-surface-container-low"}`}>
                        <div className="overflow-hidden flex-1">
                          <div className="font-mono text-sm font-bold truncate flex items-center gap-1" style={{ color: C.ink }}>
                            <span>{item.answer.join(" ")}</span>
                            {/* 交差候補マーク: 共通文字をバッジで表示 */}
                            {chars && chars.size > 0 && (
                              <span className="flex gap-0.5 ml-1">
                                {Array.from(chars).map((char) => (
                                  <span key={char} className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-primary" title={`'${char}' で他の単語と交差可能`}>
                                    {char}
                                  </span>
                                ))}
                              </span>
                            )}
                          </div>
                          <div className="text-xs truncate" style={{ color: C.secondary }}>{item.question}</div>
                          <div className="text-xs truncate" style={{ color: C.outline }}>{hintSummary(hints[item.id])}</div>
                        </div>
                        <button onClick={() => handleEditItem(item)} className="p-1 ml-2 flex-shrink-0 hover:bg-primary hover:text-white transition-colors" style={{ color: C.secondary }} aria-label="編集">
                          <Icon size={16} icon="edit" />
                        </button>
                        <button onClick={() => handleRemoveItem(item.id)} className="p-1 ml-1 flex-shrink-0 hover:bg-primary hover:text-white transition-colors" style={{ color: C.secondary }} aria-label="削除">
                          <Icon size={16} icon="delete" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Button onClick={() => triggerGeneration(editorItems, true)} disabled={editorItems.length < 2 || isLiveGenerating} className="w-full py-4 text-lg">
                {T.reshuffle}
              </Button>

              <div className="text-xs leading-relaxed pt-4 font-mono" style={{ color: C.secondary }}>
                {T.guidelinesNotice}
              </div>
            </div>

            {/* Preview & Output */}
            <div className="lg:col-span-2 space-y-6" id="puzzle-preview-area">
              <div className="bg-surface-container-low min-h-[400px] flex flex-col items-center justify-center relative overflow-visible">
                {isLiveGenerating && showPreviewAnimation && backgroundPuzzle ? (
                  <div className="w-full p-4 flex flex-col items-center">
                    <PuzzleGridRetro data={backgroundPuzzle} showSolution={true} />
                    {monteCarloProgress && (
                      <div className="mt-4 bg-white px-6 py-3 font-mono text-sm font-black flex items-center gap-3" style={{ color: C.ink }}>
                        <div className="w-4 h-4 border-2 border-black border-t-transparent motion-safe:animate-spin" />
                        <span>最適化中...</span>
                      </div>
                    )}
                  </div>
                ) : isLiveGenerating ? (
                  <div className="text-center p-8" style={{ color: C.secondary }}>
                    <div className="w-16 h-16 mx-auto mb-4 bg-white" />
                    <p className="text-lg font-black font-mono" style={{ color: C.ink }}>構築中...</p>
                    <p className="text-sm mt-2 font-mono">背景で試行錯誤中</p>
                  </div>
                ) : generatedPuzzle ? (
                  <div className="w-full p-4 flex flex-col items-center">
                    <PuzzleGridRetro data={generatedPuzzle} showSolution={true} />
                  </div>
                ) : (
                  <div className="text-center p-8" style={{ color: C.secondary }}>
                    <Icon size={64} className="mx-auto mb-4 block" icon="play_arrow" />
                    <p className="font-mono">
                      {T.previewTitle}
                      <br />
                      {T.previewSubtitle}
                    </p>
                  </div>
                )}
              </div>

              {/* 置けなかった語 */}
              {unplaced.length > 0 && (
                <div className="bg-white px-4 py-3 text-sm" style={{ color: C.ink }}>
                  <span className="text-[0.6875rem] font-bold tracking-[0.1em] mr-2" style={{ color: C.error }}>置けなかった語</span>
                  {unplaced.map((i) => i.answer.join("")).join("、")}
                </div>
              )}

              {/* メンバー名・グループ名が入っていたら知らせ、ジャンルは作る人が選ぶ（Hop 決定 2026-10-03）【仮】 */}
              {genre !== "hello" && detectedGroups.length > 0 && (
                <div className="bg-white px-4 py-3 text-sm flex flex-wrap items-center gap-3" style={{ color: C.ink }}>
                  <span className="flex-1 min-w-0">{T.stage2b.detected(detectedGroups)}</span>
                  <Button
                    onClick={() => {
                      setGenre("hello");
                      setPendingHint(null);
                      setHintResetKey((k) => k + 1);
                    }}
                    variant="secondary"
                  >
                    {T.stage2b.toHello}
                  </Button>
                </div>
              )}

              {/* 共有ボタン - パズルエリアの下 */}
              {generatedPuzzle && !isLiveGenerating && (
                <div className="flex justify-center">
                  <Button onClick={handleShare} disabled={isSaving} className="flex items-center gap-2">
                    <Icon icon="share" />
                    {isSaving ? T.saving : T.share}
                  </Button>
                </div>
              )}

              <div className="text-center text-xs px-4 font-mono" style={{ color: C.secondary }}>
                ※作成されたパズルの著作権および責任は作成者に帰属します。
                <br />
                他者の権利を侵害する内容を含めないようご注意ください。
              </div>
            </div>
          </div>

          {/* 自分が作った問題（この端末で作った問題だけ） */}
          {myPuzzles.length > 0 && (
            <div className="bg-white p-6 mt-6">
              <h2 className="text-base font-semibold mb-4 flex items-center gap-2 pb-2" style={{ color: C.ink }}>
                {T.myPuzzles.title}
              </h2>
              <ul>
                {[...myPuzzles].sort((a, b) => b.createdAt - a.createdAt).map((m) => {
                  const count = playCounts?.[m.id];
                  const known = playCounts !== null;
                  return (
                    <li key={m.id} className="py-3" style={{ borderTop: `1px solid ${C.ghost}` }}>
                      {confirmDelete === m.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex-1 min-w-0 text-sm truncate" style={{ color: C.ink }}>
                            「{m.title}」{T.myPuzzles.confirm}
                          </span>
                          <button
                            onClick={() => handleDeleteMine(m)}
                            disabled={deletingId === m.id}
                            className="px-3 py-1.5 text-sm font-bold bg-primary text-white hover:bg-secondary transition-colors disabled:opacity-50"
                          >
                            {T.myPuzzles.confirmYes}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            disabled={deletingId === m.id}
                            className="px-3 py-1.5 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors disabled:opacity-50"
                            style={{ color: C.ink }}
                          >
                            {T.myPuzzles.confirmNo}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold truncate" style={{ color: C.ink }}>{m.title}</div>
                            <div className="text-xs" style={{ color: C.secondary }}>
                              {!known ? "" : count === undefined ? T.myPuzzles.unavailable : `${T.myPuzzles.plays} ${count}`}
                            </div>
                          </div>
                          <Link
                            to={`/crossword/${m.id}`}
                            className="px-3 py-1.5 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors shrink-0"
                            style={{ color: C.ink }}
                          >
                            {T.myPuzzles.open}
                          </Link>
                          <button
                            onClick={() => setConfirmDelete(m.id)}
                            className="px-3 py-1.5 text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors shrink-0"
                            style={{ color: C.ink }}
                          >
                            {T.myPuzzles.delete}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* 保存の直前の確認（Turnstile） */}
        {showSaveCheck && <SaveCheckModal onPass={saveWithToken} onClose={cancelSaveCheck} />}

        {/* Share Modal */}
        {showShareModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
            <div className="bg-white p-6 max-w-md w-full space-y-6" style={{ boxShadow: C.modalShadow }}>
              <h3 className="text-2xl font-black text-center pb-3" style={{ color: C.ink }}>{T.shareModal.modalTitle}</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs block font-mono font-bold" style={{ color: C.secondary }}>{T.shareModal.shareLink}</label>
                  <div className="flex gap-2">
                    <input readOnly value={shareUrl} className="flex-1 bg-surface-container-low px-3 text-sm truncate font-mono" style={{ color: C.ink }} />
                    <button
                      onClick={() => navigator.clipboard?.writeText(shareUrl)}
                      className="p-2 bg-surface-container-high hover:bg-primary hover:text-white transition-colors"
                      style={{ color: C.ink }}
                      aria-label="コピー"
                    >
                      <Icon size={16} icon="content_copy" />
                    </button>
                  </div>
                </div>
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(sharedTitle)}&url=${encodeURIComponent(shareUrl)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 bg-primary hover:bg-secondary text-white font-black font-mono transition-colors"
                >
                  <Icon size={16} icon="share" /> {T.shareModal.postToX}
                </a>
              </div>
              <div className="text-xs text-center leading-relaxed pt-4 font-mono" style={{ color: C.secondary }}>
                {T.shareModal.publicNotice}
              </div>
              <div className="flex justify-center">
                <Button onClick={() => setShowShareModal(false)} variant="secondary">
                  {T.close}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 作り方ガイドモーダル */}
        {showCreatorHelp && (
          <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setShowCreatorHelp(false)}>
            <div className="bg-white max-w-lg w-full max-h-[80vh] overflow-y-auto" style={{ boxShadow: C.modalShadow }} onClick={(e) => e.stopPropagation()}>
              <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold" style={{ color: C.ink }}>{T.creatorHelp.title}</h3>
                  <button onClick={() => setShowCreatorHelp(false)} className="transition-colors p-2 hover:bg-surface-container-high" style={{ color: C.secondary }} aria-label={T.creatorHelp.close}>
                    <Icon icon="close" />
                  </button>
                </div>

                <section className="space-y-3">
                  <ul className="space-y-4 text-sm" style={{ color: C.secondary }}>
                    {T.creatorHelp.steps.map((step, index) => (
                      <li key={index} className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-6 h-6 bg-primary text-white flex items-center justify-center font-bold text-xs">{index + 1}</div>
                        <div>
                          <span className="font-semibold block" style={{ color: C.ink }}>{step.title}</span>
                          <span>{step.description}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="space-y-3">
                  <h4 className="text-sm font-bold uppercase tracking-wider pb-1" style={{ color: C.ink }}>{T.creatorHelp.tipsTitle}</h4>
                  <ul className="space-y-2 text-sm" style={{ color: C.secondary }}>
                    {T.creatorHelp.tips.map((tip, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <div className="p-1 bg-surface-container-low mt-0.5" style={{ color: C.ink }}>
                          <Icon size={14} icon="lightbulb" />
                        </div>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <div className="pt-4 flex justify-end">
                  <button onClick={() => setShowCreatorHelp(false)} className="px-4 py-2 bg-primary hover:bg-secondary text-white font-medium transition-colors">
                    {T.creatorHelp.close}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <Footer />
    </>
  );
}
