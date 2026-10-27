// クロスワード（作る画面 /crossword/create・解く画面 /crossword/:id）。
// HarmonyPalette の src/pages/PuzzleBuilderPage.tsx を土台にした移植。構造・並び・動き・文言・数値は HarmonyPalette のまま。
// 変えた所: 見た目（docs/DESIGN.md）、アイコン（Material Symbols）、動き（framer-motion を使わず同じ式で再現）、
// 知らせ（react-hot-toast を使わず自前）、保存先（Supabase）、持ってこない物（広告・Cookie 同意・コード進行・計測・ランキング等）、
// 足した物（ジャンル・タグ・ヒント・カタカナの ゛゜小）。
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import ContactModal from "@/components/ContactModal";
import { usePageReady } from "../../lib/pageReady";
import { buildGrid } from "../../lib/crossword/engine";
import type { PuzzleData, PlacedItem } from "../../lib/crossword/types";
import { toLargeKana } from "../../../functions/_shared/crosswordKana";
import { determineNextSelection } from "../../lib/crossword/puzzleSelectionLogic";
import {
  isHiddenPuzzle,
  loadPuzzle,
  readMyPuzzles,
  withGoneMarks,
  type Genre,
  type HintRef,
  type PuzzleRecord,
} from "../../lib/crossword/puzzleStore";
import { formatTime } from "../../lib/crossword/youtubeUrl";

import { PuzzleGridMinimal } from "./components/PuzzleGridMinimal";
import { PuzzleGridRetro, type GridFx } from "./components/PuzzleGridRetro";
import { SegmentBar } from "./components/SegmentBar";
import { animateElement, buildTrack, prefersReducedMotion } from "../../lib/crossword/motion";
import { ClearEffect } from "./components/ClearEffect";
import { detectKeypadType, modifiedChar } from "./components/PuzzleKeypad";
import { StickyHintBar } from "./components/StickyHintBar";
import { PuzzleCloseupModal } from "./components/PuzzleCloseupModal";
import { FitGrid } from "./components/FitGrid";
import { Motion, Presence } from "./components/Motion";
import { useDialog } from "./components/useDialog";
import { Toaster, toast } from "./components/Toast";
import { Footer, Icon } from "./components/ui";
import { PuzzleRanking } from "./components/PuzzleRanking";
import { NameEntryModal } from "./components/NameEntryModal";
import { HintList } from "./components/HintList";
import { OtherPuzzles } from "./components/OtherPuzzles";
import { BEGINNER_LABEL } from "./components/PuzzleGalleryCard";
import { queueScore, retryQueuedScores, saveScore, ScoreError } from "../../lib/crossword/scores";
import { checkPlay, pausePlay, pausePlayBeacon, pingPlay, resumePlay, revealCell, startPlay, touchPlay, PlayError } from "../../lib/crossword/play";
import { CoachMarks, type CoachStep } from "./components/CoachMarks";
import { tutorialPuzzle, TUTORIAL_HINTS } from "../../lib/crossword/tutorial";
import { C } from "./style";
// 作る画面（/crossword/create）は別のファイル（案A「作る｜試す」。Hop 決定 2026-10-22）
import { CreatePage } from "./create/CreatePage";

// localStorage の鍵（crossword 専用の名前）
const HELP_KEY = "crossword_seen_help";
// 決まりのクイズの札。この札の問題は、始める前の扉を毎回出して免責の文を見せる（Hop 決定 2026-10-15・2026-10-16）
const RULES_TAG = "個別イベント";
// 「初めて」の印（Hop 決定 2026-10-05「止めない・読ませない・その場で1行」）。場面ごとに別々に持つ
// 解く画面の最初のマスの脈打ちと1行（マスを押したら付ける）
const FIRST_CELL_KEY = "crossword_seen_first_cell";
const TUTORIAL_KEY = "crossword_seen_tutorial";
// 練習問題の住所（棚に入れずコードの中に持つ）
const TUTORIAL_PATH = "/crossword/tutorial";
// 練習問題のハンコが薄れるまで（「本番へ」が読めるように。2026-10-06 任天堂シミュで決定）【仮】
const TUTORIAL_STAMP_FADE_MS = 2000;
// 解けた時のハンコが盤に届く時刻（ハンコのばね 300/20/1.5 が 1倍に最初に届く時刻を式から出す）。この時に盤が 250ms 沈む（Hop が見本で選んだ案 C・2026-10-21）
const STAMP_LAND_MS = (() => {
  const tr = buildTrack("scale", [3, 1], { type: "spring", stiffness: 300, damping: 20, mass: 1.5 });
  for (let ms = 0; ms < tr.durationMs; ms += 10) if (tr.sample(ms) <= 1) return ms;
  return 200;
})();
// 語のマス（"x,y" を頭から順に）
const itemCellKeys = (it: PlacedItem) =>
  Array.from({ length: it.length }, (_, i) => (it.direction === "horizontal" ? `${it.startX + i},${it.startY}` : `${it.startX},${it.startY + i}`));
const PROGRESS_PREFIX = "crossword_progress_";
const PLAYED_PREFIX = "crossword_played_";
// 解き終えた印（タイム込み）。開き直すと解けた画面をそのまま出し、新しい回は始めない（Hop 指示 2026-10-17。
// 2026-10-06 の「開き直すと新しい回で最初から」を取り消し）。期限は設けない【仮】。「もう一度解く」で外れる
const CLEARED_PREFIX = "crossword_cleared_";
// 前回の続きを開いた時に「続きから／最初から」を聞くのは、前回から30分以上空いた時だけ（Hop 決定 2026-10-04）
const RESUME_ASK_MS = 30 * 60 * 1000;
// 盤を開いている間の生存の合図の間隔（受付係はこれ＋猶予で、閉じたの合図が届かなかった回を打ち切る）
const PING_MS = 60 * 1000;
// タイマーの時計がこれ以上飛んだら、開いたまま端末が眠っていたと見なして一時停止する【仮】
const SLEEP_GAP_MS = 30 * 1000;
// タイムは m:ss（1時間を超えたら h:mm:ss）にそろえる（2026-10-06 Hop 決定）
const clock = formatTime;

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
const lsRemove = (k: string) => {
  try {
    localStorage.removeItem(k);
  } catch {
    /* 消せなくても困らない */
  }
};

// 文言（HarmonyPalette の ja.json の puzzle.builder から。問題文の呼び名は「ヒント」→「カギ」）
// 問題の読み込みを待って「いま読み込めません」を出すまでの長さ（2026-10-26）
const LOAD_SLOW_MS = 10000;

const T = {
  pageTitle: "クロスワードパズル作成",
  createNew: "新規作成",
  playAgain: "もう一度解く", // 解き終えた問題を開き直した時（Hop 指示 2026-10-17）【仮】
  howToPlay: "遊び方",
  anonymous: "名無し", // 作成者名が空の時（2026-10-06 Hop 決定）
  errors: {
    noTitle: "題名を入力してください。",
    loadFailed: "問題の読み込みに失敗しました。",
    puzzleHidden: "この問題は非表示になっています。",
    loadError: "この問題を読み込めませんでした。URL をご確認ください。",
    saveFailed: "問題の保存に失敗しました。",
  },
  // 問題を読み込んでいる間（ギャラリーと同じ文）と、10秒待っても来ない時（2026-10-26）
  loading: "読み込み中…",
  loadSlow: "いま読み込めません。少し待って開き直してください。",
  // 答え合わせ・1文字見るを受付係に頼めなかった時（2026-10-04。答えを渡さない作りで足した）
  network: "通信できませんでした。もう一度お試しください。",
  // 前回の続きを開いた時（Hop 決定 2026-10-04）
  resume: {
    title: "前回の続きがあります",
    // タイムは盤を開いていた時間なので、止まっている今の値を見せる（2026-10-07）
    body: (t: string) => `ここまでのタイムは ${t} です。`,
    cont: "続きから", // Hop 決定 2026-10-06
    restart: "最初から", // Hop 決定 2026-10-06
  },
  tooMany: "操作が続いています。少し待ってからもう一度お試しください。", // Hop 決定 2026-10-06
  // 解いている途中に問題が隠された・消された時／回を始める人が多すぎる時（Hop 決定 2026-10-04）
  puzzleGone: "この問題は非表示になったか、消されました。",
  busy: "混み合っています。少し待ってからもう一度お試しください。",
  // 解き終えた画面のヒントの動画の一覧を開くボタン（2026-10-06 任天堂シミュで決定）【仮】
  showHintVideos: (_genre: Genre | null) => "ヒントを見る", // ヒントは動画以外のリンクもあるので、ジャンルを問わずこの形（2026-10-24）
  shareModal: {
    postToX: "Xに投稿",
  },
  // 段階2b で足した物
  stage2b: {
    scoreFailed: "記録を保存できませんでした。", // HarmonyPalette と同じ文言
    scoreQueued: "通信できなかったので、記録はこの端末に預かりました。つながったら自動で送ります。", // HarmonyPalette と同じ文言
    scoreLimit: "この問題の記録は、少し時間をおいてから送れます。", // 受付係が続けての記録を断った時（score_limit。2026-10-27）【仮】
  },
  playerHelp: {
    title: "遊び方",
    steps: ["空欄のマスに文字を入力", "カギを参考に正解を推測", "最後のマスを埋めると自動で答え合わせ", "タイムは問題を開いている間だけ進みます。"], // 4つ目は Hop 決定 2026-10-07
    // 項目に添える入力の決まり。390px で語の途中で折れないよう、きりのいい所で改行する（番号は steps の並び。Hop 2026-10-16「入力時のルールを併記」。文字盤に「小」が無いため）
    stepNotes: { 0: ["小さい字（ッ・ャ など）は\n大きい字で入れます", "゛゜は字のあとに押します"] } as Record<number, string[]>,
    start: "始める！",
    rulesNote: "公式のものではありません。内容が正しいとは限らないので、行く前に必ず公式の案内で確かめてください。",
    createdBy: (name: string) => `作った人：${name}`, // 2026-10-06 Hop 決定
    // 練習問題の入口は「?」から開いた遊び方の窓だけ（Hop 決定 2026-10-05）
    practice: "練習する", // 【仮】
    request: "要望を送る", // 「?」の窓から問い合わせの窓を種類「要望」で開く（Hop 決定 2026-10-06）【仮】
    // 初めて解く時、盤のすぐ下の1行（最初のマスの脈打ちと一緒に出す）
    firstCell: "マスを押すと、字を入れられます。",
  },
  // 練習問題の案内（Hop 決定 2026-10-05・案B）。文言はすべて【仮】
  tutorial: {
    toReal: "本番へ", // 【仮】
    next: "次へ", // 【仮】
    skip: "スキップ",
    close: "閉じる",
    // 案内は2段だけ（Hop 決定 2026-10-05）
    cell: ["左上のマスを押してみましょう。"],
    keypad: ["文字盤で字を入れると、次のマスへ進みます。"],
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

// プレビューで触って確かめるための見本（?debug=big・?debug=dakuten。2026-10-21 Hop 依頼）。保存先には書かず、ブラウザの中だけで答え合わせする
// big = 進み具合の帯が細かく区切られる・1本の帯に替わる所を見る大きい盤（横15字の語1つと、そこから下がる縦13字の語8つ。111マス）。字は意味の無い並び
const debugItem = (id: number, answer: string, direction: "horizontal" | "vertical", startX: number, startY: number, question: string): PlacedItem => ({
  id: String(id), uuid: String(id), answer: Array.from(answer), question, direction, startX, startY, length: Array.from(answer).length, clueIndex: 0,
});
const DEBUG_BIG_PUZZLE: PuzzleData = (() => {
  const kana = Array.from("アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワ");
  const top = Array.from({ length: 15 }, (_, i) => kana[i % kana.length]).join("");
  const items = [debugItem(1, top, "horizontal", 0, 0, "見本の横の語（15字）")];
  for (let x = 0; x < 15; x += 2) {
    const down = top[x] + Array.from({ length: 12 }, (_, i) => kana[(x * 3 + i + 7) % kana.length]).join("");
    items.push(debugItem(items.length + 1, down, "vertical", x, 0, `見本の縦の語（13字・${x / 2 + 1}本目）`));
  }
  return { ...buildGrid(items), id: "debug-big", title: "見本・大きい問題", creatorName: "テストユーザー" };
})();
// dakuten = 最後が ゛ を付ける字で終わる見本。「スズ」の「ズ」を「ス」→「゛」で入れると、答え合わせまで2秒待つのを触って確かめられる
const DEBUG_DAKUTEN_PUZZLE: PuzzleData = {
  ...buildGrid([
    debugItem(1, "カバン", "horizontal", 0, 0, "荷物を入れて持ち歩く物"),
    debugItem(2, "バス", "vertical", 1, 0, "大勢を乗せて走る車"),
    debugItem(3, "スズ", "horizontal", 1, 1, "鳴らすとチリンと音が出る"),
  ]),
  id: "debug-dakuten",
  title: "見本・最後が濁る字",
  creatorName: "テストユーザー",
};
const DEBUG_SAMPLES: Record<string, PuzzleData> = { true: DEBUG_MOCK_PUZZLE, big: DEBUG_BIG_PUZZLE, dakuten: DEBUG_DAKUTEN_PUZZLE };

// 保存した中身から盤を組み直す（位置は保存時のまま。番号も同じになる）
function recordToPuzzle(rec: PuzzleRecord): { puzzle: PuzzleData; hints: Record<string, HintRef> } {
  const body = rec.body;
  if (!body || !Array.isArray(body.clues)) throw new Error("bad body");
  const items: PlacedItem[] = body.clues.map((c, i) => ({
    id: `c${i}`,
    uuid: `c${i}`,
    question: c.clue,
    // 答えはブラウザに来ない（受付係しか読めない棚にある）。解けた時に受付係から受け取って入れる
    answer: Array.from({ length: c.length ?? c.answer?.length ?? 0 }, () => ""),
    direction: c.direction,
    startX: c.startX,
    startY: c.startY,
    length: c.length ?? c.answer?.length ?? 0,
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

// UI Components（HarmonyPalette の Button。色と角は DESIGN.md）
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

// Icon と Footer は components/ui.tsx へ移した（一覧の画面でも使うため。中身は同じ）

// 作る画面の「試す」（Hop 決定 2026-10-22・案A）。作る画面が今の盤をこの画面の部品に渡して、その場で解けるようにする。
// ?debug= の見本と同じく、受付係・棚には何も送らず、ブラウザの中だけで答え合わせする。端末にも途中経過・解き終えた印を残さない。
// 見出し（題名・タイム・一時停止・リセット）・遊び方の窓・解き終えた画面の「Xに投稿」とランキングとほかの問題・著作権の1行・通報・名前を入れる窓は出さない
export interface TrialPlay {
  puzzle: PuzzleData;
  hints: Record<string, HintRef>;
  /** 前に「試す」で入れた字（同じ盤の時だけ作る画面が持っていて渡す） */
  answers?: Record<string, string>;
  /** 字が変わった時・解けた時に作る画面へ知らせる（作る画面が持って、次に「試す」を開いた時に戻す） */
  onAnswers?: (answers: Record<string, string>, cleared: boolean) => void;
  /** 上に貼り付く作る画面の見出しの高さ（進み具合の帯をその下に貼り付ける） */
  stickyTop: number;
  /** 画面の下の貼り付けの段の高さ（カギの帯をその上に出す） */
  dockGap: string;
}

export default function CrosswordPage({ trial }: { trial?: TrialPlay } = {}) {
  const isTrial = !!trial;
  const { id: puzzleId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const debugSample = DEBUG_SAMPLES[searchParams.get("debug") ?? ""] ?? null; // デバッグモードの見本（true・big・dakuten）
  const isDebugMode = debugSample !== null; // デバッグモード
  const navigate = useNavigate();
  // 練習問題（/crossword/tutorial）。答え合わせはブラウザの中だけ・回を数えない・ランキングと X 投稿と通報を出さない
  const isTutorial = useLocation().pathname === TUTORIAL_PATH;
  // 練習の後に戻る問題の番号（?from=）
  const fromParam = searchParams.get("from");
  const tutorialFrom = isTutorial && fromParam && /^[A-Za-z0-9_-]{1,64}$/.test(fromParam) ? fromParam : null;
  const isPlayerMode = !!puzzleId || isDebugMode || isTutorial || isTrial;
  // 練習問題と見本と作る画面の「試す」は受付係を通らない（タイムはこの端末の時計だけで測る）
  const isLocalTiming = isTutorial || isDebugMode || isTrial;
  // Player State
  const [loadState, setLoadState] = useState<"loading" | "done">(isPlayerMode ? "loading" : "done");
  // 問題を読み込み始めてから長く待っている（棚が返事をしない時。2026-10-26 前は真っ白のまま待ち続けた）。来れば今までどおり問題を出す
  const [slowLoad, setSlowLoad] = useState(false);
  useEffect(() => {
    if (!isPlayerMode || loadState !== "loading") {
      setSlowLoad(false);
      return;
    }
    const t = window.setTimeout(() => setSlowLoad(true), LOAD_SLOW_MS);
    return () => window.clearTimeout(t);
  }, [isPlayerMode, loadState]);
  const [playerPuzzle, setPlayerPuzzle] = useState<PuzzleData | null>(null);
  const [playerHints, setPlayerHints] = useState<Record<string, HintRef>>({});
  const [playerGenre, setPlayerGenre] = useState<Genre | null>(null); // 終わりの画面の「ほかの問題」用
  const [isRulesQuiz, setIsRulesQuiz] = useState(false);
  const [isAssemblyAnimating, setIsAssemblyAnimating] = useState(false);
  const [isCleared, setIsCleared] = useState(false);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [activeCell, setActiveCell] = useState<{ x: number; y: number } | null>(null);
  const [currentWordDirection, setCurrentWordDirection] = useState<"horizontal" | "vertical">("horizontal");
  const [activeWordItem, setActiveWordItem] = useState<PlacedItem | null>(null);
  const [showCloseup, setShowCloseup] = useState(false);
  const [activeCloseupIndex, setActiveCloseupIndex] = useState(0);

  // タイマー関連
  const [clearTime, setClearTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [gamePhase, setGamePhase] = useState<"ready" | "playing" | "cleared">("ready");
  // 端末に残した途中経過のタイム（秒）。表示の初期値にだけ使い、受付係の返事で上書きする
  const restoredElapsedRef = useRef(0);
  // タイムは「盤を開いていた時間」（Hop 決定 2026-10-07）。activeMs = 受付係が返した開いていた時間の合計、
  // openedAt = この端末で盤を開いた時刻（閉じている・一時停止の間は null）。表示は activeMs ＋（開いていれば 今 − openedAt）
  // 練習問題と見本は受付係を通らないので、この端末の時計だけで同じ動きにする
  const [timing, setTimingState] = useState<{ activeMs: number; openedAt: number | null } | null>(null);
  const timingRef = useRef(timing);
  const setTiming = (t: { activeMs: number; openedAt: number | null } | null) => {
    timingRef.current = t;
    setTimingState(t);
  };
  const activeMsNow = (t = timingRef.current, now = Date.now()) => (t ? t.activeMs + (t.openedAt !== null ? Math.max(0, now - t.openedAt) : 0) : 0);
  // 一時停止の幕。画面を隠した時・閉じた時も自動でかかる。戻った時は自動では外さない
  const [paused, setPausedState] = useState(false);
  const pausedRef = useRef(false);
  const setPaused = (p: boolean) => {
    pausedRef.current = p;
    setPausedState(p);
  };
  const [resuming, setResuming] = useState(false); // 「再開」の返事待ち
  // 開く・閉じるの順番。後から届いた古い返事で表示を戻さない
  const timingSeqRef = useRef(0);
  // 最後にタイマーが進んだ時刻（端末の眠りで時計が飛んだのを見分ける）
  const lastTickRef = useRef(0);
  const resumeButtonRef = useRef<HTMLButtonElement | null>(null);
  // 解いている回（/api/crossword-play）。localStart はこの端末の時計で回を始めた時刻（「前回の続き」の窓の数字に使う）
  const playRef = useRef<{ token: string; localStart: number } | null>(null);
  const playErrorRef = useRef(""); // 回を始められなかった理由（知らせの出し分けに使う）
  // 前回の続きを開いた時に聞く（値は始めてからの秒数）。答えるまでタイマーは動かさない
  const [resumeAsk, setResumeAsk] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  // 回を始める呼び出しの返事待ち（2度目以降は同じ返事を待つ。回が二重に始まらないように。2026-10-06 レビューの直し）
  const playPendingRef = useRef<Promise<string | null> | null>(null);
  // 答え合わせの通信中か（見張りの中で今の値を見るため ref でも持つ）。通信中に盤が変わったら dirty を立て、
  // 通信の後に今の盤で1度だけ黙って丸付けし直す（2026-10-06 レビューの直し）
  const checkingRef = useRef(false);
  const checkDirtyRef = useRef(false);
  const [recheckTick, setRecheckTick] = useState(0);
  // 全部埋まった後の状態を盤の下に出す（Hop 2026-10-07。特大の盤で「黙る方の丸付け」が見えず、直しても何も起きないように見えた）
  //   wrong = 全部埋まっているがどこかが違う ／ failed = 丸付けの通信に失敗した（少し待ってもう一度試す）
  const [boardStatus, setBoardStatus] = useState<"wrong" | "failed" | null>(null);
  const retryRef = useRef(0);
  // 解き終えた画面のヒントの動画の一覧（畳んである）
  const [showHintVideos, setShowHintVideos] = useState(false);

  // UI States
  const [showHelp, setShowHelp] = useState(false);
  // 初めて開いた時の遊び方の窓か（その時は「始める！」だけ。「練習する」は「?」から開いた時だけ）
  const [helpFirst, setHelpFirst] = useState(false);
  // 練習問題の案内の段。0 = マスを押す、1 = 文字盤、null = 終わり（あとは案内なしで解く）
  const [tutStep, setTutStep] = useState<number | null>(isTutorial ? 0 : null);
  // 解く画面の最初のマスの脈打ちと1行（記録が空の端末だけ。マスを押したら消えて二度と出ない）
  // 作る画面の「試す」では出さない（印も付けない。本物の問題を初めて解く時に出るように）
  const [firstCellHint, setFirstCellHint] = useState(() => !isTutorial && !isTrial && !lsGet(FIRST_CELL_KEY));
  const [showClearAnimation, setShowClearAnimation] = useState(false);
  const [restoredCleared, setRestoredCleared] = useState(false); // 開き直しで解けた画面を出している（「もう一度解く」を出す）
  const [scale, setScale] = useState(1);
  const [showContact, setShowContact] = useState(false);
  const [showRequest, setShowRequest] = useState(false); // 「?」の窓からの要望（種類「要望」入りで問い合わせの窓を開く）

  // ランキング（HarmonyPalette の Ranking & Name Entry）
  const [showNameEntry, setShowNameEntry] = useState(false);
  const [rankingRefresh, setRankingRefresh] = useState(0);
  const clearTimeRef = useRef<number | null>(null);
  const rankableRef = useRef(true); // 人間には無理な速さで解けた回は false（名前を入れる窓を出さない）
  // 1文字見るを使った数。確かめを出すかどうかに使う（ランキングの印の数は受付係が数える）
  const [reveals, setReveals] = useState(0);

  // 盤の動き（Hop が見本で選んだ案。2026-10-21）。動きの判断に答えや正誤は使わない（どのマスが埋まったかだけ）。動きの間も入力は止めない
  const [gridFx, setGridFx] = useState<GridFx>({ id: 0 });
  const fxIdRef = useRef(0);
  // 字を入れたマス（文字盤・1文字見る）。入った後の盤で「字を入れた時」と「1語・交差が埋まった時」の動きを決める
  const pendingInputRef = useRef<string | null>(null);
  const prevAnswersRef = useRef(userAnswers);
  // 盤の白い面（間違いの時に揺れ、解けた時にハンコを受け止めて沈む）
  const boardBoxRef = useRef<HTMLDivElement>(null);
  // 下の「マスを押すと、ここにカギが出ます」の帯が、開いた時（一番上まで送った時）にズームのボタンとヨコのカギの見出しに重ならないようにする（2026-10-23）。
  //   盤の高さの上限: 盤の下からズームのボタンまでを足しても帯の上に収まる高さ（縮めすぎる時は付けない）
  //   帯の分の余白: カギの一覧の見出しが帯の下に入る時だけ、一覧の上に帯の下端までの余白を足す
  const zoomRef = useRef<HTMLDivElement>(null);
  const clueListRef = useRef<HTMLDivElement>(null);
  const [boardMaxH, setBoardMaxH] = useState<number | null>(null);
  const [barSpacer, setBarSpacer] = useState(0);
  const barSpacerRef = useRef(0);
  barSpacerRef.current = barSpacer;
  // 押したマスから語の並びの濃淡を1マス25msずつ遅らせて付ける
  const emitPress = (word: PlacedItem, x: number, y: number) => {
    const keys = itemCellKeys(word);
    const i0 = Math.max(0, keys.indexOf(`${x},${y}`));
    const press: Record<string, number> = {};
    keys.forEach((k, i) => (press[k] = Math.abs(i - i0) * 25));
    setGridFx({ id: ++fxIdRef.current, press });
  };
  // 埋まった語の跳ね（1語は語の頭から1字25ms、2語以上は key のマスからの距離1マス30ms）。どのマスを何ms遅らせるか
  const wordsFxOf = (done: PlacedItem[], key: string): Record<string, number> | undefined => {
    if (done.length === 1) {
      const w: Record<string, number> = {};
      itemCellKeys(done[0]).forEach((k, i) => (w[k] = i * 25));
      return w;
    }
    if (done.length > 1) {
      const w: Record<string, number> = {};
      const [x0, y0] = key.split(",").map(Number);
      done.forEach((it) =>
        itemCellKeys(it).forEach((k) => {
          if (k in w) return;
          const [x, y] = k.split(",").map(Number);
          w[k] = (Math.abs(x - x0) + Math.abs(y - y0)) * 30;
        })
      );
      return w;
    }
    return undefined;
  };
  // 入力の窓が盤を隠している間に埋まった語は、その場では跳ねさせずに覚えておき、窓が消えて盤が見えた時にまとめて跳ねさせる
  // （Hop 決定 2026-10-21「窓を閉じた時に盤で動かす」。iPhone SE では窓が盤を全部隠して跳ねが見えなかった）。
  // 覚えるのは埋まった語と最後に字を入れたマスだけ（正誤は使わない）
  const heldWordsRef = useRef<{ ids: Set<string>; lastKey: string | null }>({ ids: new Set(), lastKey: null });
  // 帯と重ならない並びを測って決める（帯が出ている時だけ測る。窓が開いて帯が消えている間は前の値のまま）
  const layoutBarRef = useRef(() => {});
  layoutBarRef.current = () => {
    const bar = document.querySelector<HTMLElement>("[data-sticky-bar]");
    const board = boardBoxRef.current;
    const zoom = zoomRef.current;
    const list = clueListRef.current;
    if (!bar || !board || !zoom || !list) return;
    const y = window.scrollY;
    const b = bar.getBoundingClientRect();
    // 帯は画面に貼り付いているので、画面の中の位置がそのまま「一番上まで送った時」の位置
    const barTop0 = b.top;
    const barBottom0 = b.bottom;
    const pad = 24; // 盤の白い面の p-6
    const boxR = board.getBoundingClientRect();
    const boardTop = boxR.top + y + pad;
    const boardBottom = boxR.bottom + y - pad;
    const zoomBottom = zoom.getBoundingClientRect().bottom + y;
    const below = zoomBottom - boardBottom;
    const maxH = Math.floor(barTop0 - 8 - below - boardTop);
    // 盤が小さくなりすぎる時（160px 未満）は上限を付けない
    const nextMax = maxH >= 160 ? maxH : null;
    setBoardMaxH((prev) => (prev === nextMax ? prev : nextMax));
    const head = list.querySelector("h2");
    if (!head) return;
    const hr = head.getBoundingClientRect();
    const headTop = hr.top + y - barSpacerRef.current;
    const headBottom = hr.bottom + y - barSpacerRef.current;
    const need = headBottom > barTop0 && headTop < barBottom0 + 8 ? Math.ceil(barBottom0 + 8 - headTop) : 0;
    setBarSpacer((prev) => (Math.abs(prev - need) <= 1 ? prev : need));
  };
  // 盤・中身の大きさ・画面の大きさが変わった時に測り直す。解けた後は帯が無いので余白を外す（盤の大きさはそのまま）
  useEffect(() => {
    if (!playerPuzzle) return;
    if (isCleared) {
      setBarSpacer(0);
      return;
    }
    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => layoutBarRef.current());
    };
    run();
    // 出てくる動き（拡大・ずれ）の間は帯の位置が動きの途中なので、動きが終わった後にも測り直す
    const timers = [450, 1200].map((ms) => window.setTimeout(run, ms));
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(run) : null;
    ro?.observe(document.body);
    window.addEventListener("resize", run);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach((t) => window.clearTimeout(t));
      ro?.disconnect();
      window.removeEventListener("resize", run);
    };
  }, [playerPuzzle, isCleared, showCloseup, paused]);
  // 盤が窓に隠れているか: 盤の白い面のうち画面に入っている所が、全部入力の窓の中に収まっていれば隠れている。
  // 窓の上や横に盤が少しでも見えていれば、今どおりその場で跳ねる
  const boardHiddenBySheet = () => {
    const box = boardBoxRef.current;
    const sheet = document.querySelector<HTMLElement>("[data-closeup-sheet]");
    if (!box || !sheet) return false;
    const b = box.getBoundingClientRect();
    const s = sheet.getBoundingClientRect();
    const top = Math.max(b.top, 0);
    const bottom = Math.min(b.bottom, window.innerHeight);
    const left = Math.max(b.left, 0);
    const right = Math.min(b.right, window.innerWidth);
    if (top >= bottom || left >= right) return false; // 盤が画面の外（窓に隠れているのではない）
    return s.top <= top && s.bottom >= bottom && s.left <= left && s.right >= right;
  };
  // 字が入った後: 字をぽんと置き、その字で埋まった語があれば語の字を順に小さく跳ねさせる（1語は語の頭から1字25ms、2語以上は入れたマスからの距離1マス30ms。Hop 2026-10-21 灰の帯から変更）
  useLayoutEffect(() => {
    const prev = prevAnswersRef.current;
    prevAnswersRef.current = userAnswers;
    const key = pendingInputRef.current;
    pendingInputRef.current = null;
    if (!key || !userAnswers[key] || !playerPuzzle) return;
    const done = playerPuzzle.items.filter((it) => {
      const keys = itemCellKeys(it);
      return keys.includes(key) && !keys.every((k) => !!prev[k]) && keys.every((k) => !!userAnswers[k]);
    });
    if (boardHiddenBySheet()) {
      const held = heldWordsRef.current;
      done.forEach((it) => held.ids.add(it.uuid));
      if (held.ids.size > 0) held.lastKey = key;
      setGridFx({ id: ++fxIdRef.current, input: key });
      return;
    }
    setGridFx({ id: ++fxIdRef.current, input: key, words: wordsFxOf(done, key) });
  }, [userAnswers]); // eslint-disable-line react-hooks/exhaustive-deps

  // 窓のキーボードと読み上げの作法（2026-10-06 アクセシビリティの直し）。
  // 前回の続きは、どちらかを選んでもらう窓なので Esc では閉じない【仮】
  const helpDialog = useDialog({ active: showHelp, onClose: () => closeHelp() });
  const resumeDialog = useDialog({ active: resumeAsk !== null, closeOnEsc: false });

  // ページ移動の波は、問題が届くまで（または届かないと分かるまで）待ってもらう
  usePageReady(loadState === "done");

  // [No.12] プログレスバー: 埋まったマスの数（合っているかは数えない）。帯はマスの数で区切る（Hop が見本で選んだ案 B・2026-10-21）
  const filledCount = useMemo(() => {
    if (!playerPuzzle) return 0;
    let n = 0;
    playerPuzzle.cells.forEach((cell) => {
      const val = userAnswers[`${cell.x},${cell.y}`];
      if (typeof val === "string" && val.trim() !== "") n++;
    });
    return n;
  }, [playerPuzzle, userAnswers]);

  // --- Initialization ---
  useEffect(() => {
    // 作る画面の「試す」は、作る画面から受け取った盤をそのまま使う（棚から読まない・台帳も確かめない・組み上がりの演出も挟まない）。
    // ジャンルはハロプロ（作る画面はハロプロだけ。Hop 決定 2026-10-20）。前に入れた字があれば戻す
    if (trial) {
      setPlayerPuzzle(trial.puzzle);
      setPlayerHints(trial.hints);
      setPlayerGenre("hello");
      if (trial.answers) setUserAnswers(trial.answers);
      setLoadState("done");
      return;
    }
    // 練習問題は棚から読まない（コードの中の問題）。組み上がりの演出も挟まない
    if (isTutorial) {
      setPlayerPuzzle(tutorialPuzzle());
      setPlayerHints({});
      setLoadState("done");
      return;
    }
    if (!puzzleId && !isDebugMode) return;
    let alive = true;
    (async () => {
      let loaded: { puzzle: PuzzleData; hints: Record<string, HintRef> } | null = null;
      let failMessage = "";
      let loadedGenre: Genre | null = null;
      // ヒントの見た目を確かめるため、1 と 2 にだけ見本のヒントを付ける（デバッグ用・HarmonyPalette には無い）
      if (debugSample) loaded = { puzzle: debugSample, hints: { "1": { kind: "youtube", videoId: "dQw4w9WgXcQ", startSec: 83 }, "2": { kind: "link", url: "https://example.com/" } } };
      else try {
        const rec = await loadPuzzle(puzzleId!);
        if (!rec) {
          // 読めなかったときだけ、運営に隠された問題かを聞く（聞けなければ今まで通りの知らせ）
          const hidden = await isHiddenPuzzle(puzzleId!).catch(() => false);
          failMessage = hidden ? T.errors.puzzleHidden : T.errors.loadFailed;
        } else {
          loaded = recordToPuzzle(rec);
          setPlayerGenre(rec.genre);
          setIsRulesQuiz(Array.isArray(rec.tags) && rec.tags.includes(RULES_TAG)); // 棚に残る rulesNote の印は見ない（2026-10-19）
          loadedGenre = rec.genre;
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
        // ハロプロのジャンルは、台帳から消えた動画のヒントに印を付ける（見られなくなりましたと出す。Hop 決定 2026-10-04）。
        // 保存の時点で台帳に無かった動画（outside の印）には付けない（Hop 決定 2026-10-21）
        if (loadedGenre === "hello") {
          withGoneMarks(loaded.hints, loadedGenre)
            .then((next) => alive && next !== loaded.hints && setPlayerHints(next))
            .catch((err) => console.warn("Failed to check hint videos:", err));
        }
        setIsAssemblyAnimating(true);
        setTimeout(() => setIsAssemblyAnimating(false), 2000);

        // Load progress from localStorage
        let hasProgress = false;
        try {
          const saved = lsGet(`${PROGRESS_PREFIX}${puzzleToLoad.id}`);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.userAnswers && typeof parsed.userAnswers === "object") {
              hasProgress = true;
              setUserAnswers(parsed.userAnswers);
              if (typeof parsed.elapsedSeconds === "number") restoredElapsedRef.current = parsed.elapsedSeconds;
              if (Number.isInteger(parsed.reveals) && parsed.reveals >= 0) setReveals(parsed.reveals);
              const pl = parsed.play;
              if (pl && typeof pl.token === "string" && typeof pl.localStart === "number") {
                playRef.current = { token: pl.token, localStart: pl.localStart };
                const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
                if (Date.now() - savedAt >= RESUME_ASK_MS && Object.keys(parsed.userAnswers).length > 0) {
                  // 閉じていた間は進まないので、保存してあった「開いていた時間」をそのまま見せる
                  setResumeAsk(Math.max(0, Math.floor(restoredElapsedRef.current)));
                }
              }
            }
          }
        } catch (e) {
          console.error("Failed to load progress:", e);
        }
        // 解き終えた印があれば（解き直しの途中が残っていない時）、解けた画面をそのまま出す。回は始めない（Hop 指示 2026-10-17）
        if (!hasProgress && !isTutorial && !isDebugMode) {
          const key = `${CLEARED_PREFIX}${puzzleToLoad.id}`;
          try {
            const mark = lsGet(key);
            if (mark) {
              const parsed = JSON.parse(mark);
              const answers = parsed.userAnswers && typeof parsed.userAnswers === "object" ? (parsed.userAnswers as Record<string, string>) : null;
              // 作った本人が解いた後に組み直した問題は盤が変わっている。今の盤のマスが全部埋まる印だけ使い、合わなければ捨てる
              if (!answers || !puzzleToLoad.cells.every((c) => !!answers[`${c.x},${c.y}`])) {
                lsRemove(key);
              } else {
                setClearTime(typeof parsed.clearTime === "number" ? parsed.clearTime : null);
                setUserAnswers(answers);
                setGamePhase("cleared");
                setIsCleared(true);
                setRestoredCleared(true);
              }
            }
          } catch {
            lsRemove(key);
          }
        }
      }
      setLoadState("done");
    })();
    return () => {
      alive = false;
    };
  }, [puzzleId, isDebugMode, isTutorial]);

  // キューイングされたスコアの再送信（ネットワーク回復時。HarmonyPalette と同じ）
  useEffect(() => {
    if (isTutorial || isTrial) return; // 練習問題と作る画面の「試す」では受付係に何も送らない
    const retry = () => {
      retryQueuedScores().catch((e) => console.error("[Score Queue] Error processing queue:", e));
    };
    retry();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 初回ヘルプ表示判定 + タイマー自動開始（遊び方を読んだことがあれば、問題が出たらすぐ始める）
  useEffect(() => {
    if (isPlayerMode && playerPuzzle) {
      // 解き終えた問題を開き直した時は、窓も出さず回も始めない（解けた画面がそのまま出ている）
      if (gamePhase === "cleared") return;
      // 練習問題と作る画面の「試す」は遊び方の窓を出さずに始める（タイムは出さないが、一時停止の動きは同じ。端末の時計だけで測る）
      if (isTutorial || isTrial) {
        if (gamePhase === "ready") beginTiming();
        return;
      }
      const hasSeenHelp = lsGet(HELP_KEY);
      // 決まりのクイズは、遊び方を読んだことがあっても始める前に毎回扉を出す（続きの確認が先に出ている間は待つ）
      if (!hasSeenHelp || (isRulesQuiz && gamePhase === "ready" && resumeAsk === null)) {
        setHelpFirst(true);
        setShowHelp(true);
      } else if (gamePhase === "ready" && resumeAsk === null) {
        beginTiming();
      }
    }
  }, [isPlayerMode, playerPuzzle, gamePhase, resumeAsk, isRulesQuiz]); // eslint-disable-line react-hooks/exhaustive-deps

  // 最初から: 入れた字を消して、新しい回として始める
  const handleResumeRestart = () => {
    setUserAnswers({});
    setReveals(0);
    playRef.current = null;
    restoredElapsedRef.current = 0;
    setResumeAsk(null);
  };

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
    // 一時停止の幕の間はキーを受けない
    if (!isPlayerMode || !playerPuzzle || isCleared || showCloseup || paused) return;

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
          // 盤のマスにフォーカスがある時は、フォーカスも一緒に動かす
          if (target.id.startsWith("cell-")) document.getElementById(`cell-${nextX}-${nextY}`)?.focus();
        }
      }

      // 英字（A〜Z）は盤に入れない。答えはカタカナだけなので、入れても必ず間違いになる（2026-10-06 レビューの直し。HarmonyPalette の名残）

      if (e.key === "Backspace" && activeCell) {
        e.preventDefault();
        handleKeypadBackspace();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // userAnswers: Backspace が今の盤の字を見るため（古い盤のまま消さない）
  }, [isPlayerMode, playerPuzzle, isCleared, showCloseup, paused, activeCell, currentWordDirection, activeWordItem, userAnswers]);

  // 遊び方を閉じたらタイマー開始（HarmonyPalette の Cookie 同意の後の開始の置き換え）
  const closeHelp = () => {
    setShowHelp(false);
    setHelpFirst(false);
    lsSet(HELP_KEY, "true");
    handleStartGame();
  };

  // 練習問題へ（「?」から開いた遊び方の窓の「練習する」）。解いていた問題には練習の後に戻る（?from=）
  const goPractice = () => {
    setShowHelp(false);
    setHelpFirst(false);
    navigate(puzzleId ? `${TUTORIAL_PATH}?from=${encodeURIComponent(puzzleId)}` : TUTORIAL_PATH);
  };

  // 練習問題から本番へ（来た問題が無ければ一覧へ）
  const goReal = () => {
    navigate(tutorialFrom ? `/crossword/${tutorialFrom}` : "/crossword");
  };

  // 練習問題の案内を終える（×・とばす・幕のタップ・Esc も同じ）
  const endTutorial = () => {
    lsSet(TUTORIAL_KEY, "1");
    setTutStep(null);
  };

  // タイマー開始。遊んでいる途中に遊び方を開き直しても、時間は巻き戻さない
  const handleStartGame = () => {
    if (gamePhase !== "ready") return;
    beginTiming();
  };

  // 回を始める。続きの回（端末に番号が残っている）なら受付係に「開いた」を送り、返事の開いていた時間から進める。
  // 無ければ受付係に新しく始めてもらう（始めた瞬間から盤は開いている扱い）
  const beginTiming = () => {
    setGamePhase("playing");
    setPaused(false);
    const now = Date.now();
    if (isLocalTiming) {
      setTiming({ activeMs: restoredElapsedRef.current * 1000, openedAt: now });
      return;
    }
    if (playRef.current) {
      // 表示の初期値は端末に残した途中経過。受付係の返事が来たら上書きする
      setTiming({ activeMs: restoredElapsedRef.current * 1000, openedAt: now });
      const token = playRef.current.token;
      const seq = ++timingSeqRef.current;
      resumePlay(token)
        .then((r) => {
          if (seq === timingSeqRef.current && !pausedRef.current && playRef.current?.token === token) setTiming({ activeMs: r.activeMs, openedAt: Date.now() });
        })
        .catch((err) => console.warn("Failed to resume play:", err));
      return;
    }
    setTiming({ activeMs: 0, openedAt: now });
    void ensurePlay();
  };

  // 一時停止（ボタン・画面を隠した時・閉じた時・端末が眠っていた時）。幕をかけ、入力カードは閉じる。
  // beacon = 返事を待てない時（画面を隠す・閉じる）。at = 時計を止める時刻（眠っていた分を数えないように、眠る前の時刻で止める）
  const pauseBoard = (opts: { beacon?: boolean; at?: number } = {}) => {
    if (pausedRef.current) return;
    const seq = ++timingSeqRef.current;
    setTiming({ activeMs: activeMsNow(timingRef.current, opts.at ?? Date.now()), openedAt: null });
    setPaused(true);
    setShowCloseup(false);
    if (isLocalTiming) return;
    // 回を始める返事待ちの間は送れない（返事が来た時に ensurePlay の中で送る）
    const token = playRef.current?.token;
    if (!token) return;
    if (opts.beacon) {
      pausePlayBeacon(token);
      return;
    }
    pausePlay(token)
      .then((r) => {
        if (seq === timingSeqRef.current && pausedRef.current) setTiming({ activeMs: r.activeMs, openedAt: null });
      })
      .catch((err) => console.warn("Failed to pause play:", err));
  };

  // 幕の「再開」。受付係に「開いた」を送り、返事の開いていた時間に合わせてから幕を外す。
  // 送れなかった時は幕をかけたまま知らせる（受付係では閉じたままなのに、画面の時計だけ進まないように）
  const resumeBoard = async () => {
    if (!pausedRef.current || resuming) return;
    const seq = ++timingSeqRef.current;
    const token = isLocalTiming ? null : playRef.current?.token;
    if (!token) {
      setTiming({ activeMs: activeMsNow(), openedAt: Date.now() });
      setPaused(false);
      return;
    }
    setResuming(true);
    try {
      const r = await resumePlay(token);
      if (seq !== timingSeqRef.current) return;
      setTiming({ activeMs: r.activeMs, openedAt: Date.now() });
      setPaused(false);
    } catch (err) {
      console.warn("Failed to resume play:", err);
      if (err instanceof PlayError && err.reason === "no_play") {
        // 回の記録が片付いていた。幕は外し、次に受付係を使う時に新しい回として始め直す（withPlay）
        setTiming({ activeMs: activeMsNow(), openedAt: Date.now() });
        setPaused(false);
      } else {
        toast.error(playErrorOf(err));
      }
    } finally {
      setResuming(false);
    }
  };

  const ensurePlay = (): Promise<string | null> => {
    if (playRef.current) return Promise.resolve(playRef.current.token);
    if (!puzzleId) return Promise.resolve(null);
    // 返事待ちの間に呼ばれたら、新しく始めずに同じ返事を待つ
    if (playPendingRef.current) return playPendingRef.current;
    const pending = (async () => {
      try {
        const p = await startPlay(puzzleId);
        const localStart = Date.now();
        playRef.current = { token: p.token, localStart };
        // 受付係では始めた瞬間から開いている。返事待ちの間に一時停止していたら、ここで閉じる
        ++timingSeqRef.current;
        if (pausedRef.current) {
          setTiming({ activeMs: 0, openedAt: null });
          pausePlay(p.token).catch((err) => console.warn("Failed to pause play:", err));
        } else {
          setTiming({ activeMs: 0, openedAt: localStart });
        }
        return p.token;
      } catch (err) {
        console.warn("Failed to start play:", err);
        playErrorRef.current = err instanceof PlayError ? err.reason : "network";
        return null;
      }
    })();
    playPendingRef.current = pending;
    void pending.then(() => {
      if (playPendingRef.current === pending) playPendingRef.current = null;
    });
    return pending;
  };

  // 受付係に断られた理由ごとの知らせ
  const playErrorText = (reason: string, during: "start" | "check" = "check") =>
    reason === "not_found" ? T.puzzleGone : reason === "too_many" ? (during === "start" ? T.busy : T.tooMany) : T.network;

  // 回の番号を使う呼び出し。回の記録が無くなっていたら（30 日で片付く）新しい回として始め直して1度だけやり直す。
  // 入れた字はそのまま。タイマーは始め直した時から
  const withPlay = async <R,>(run: (token: string) => Promise<R>): Promise<R> => {
    const token = await ensurePlay();
    if (!token) throw new PlayError(playErrorRef.current || "network");
    try {
      return await run(token);
    } catch (err) {
      if (!(err instanceof PlayError) || err.reason !== "no_play") throw err;
      playRef.current = null;
      const fresh = await ensurePlay();
      if (!fresh) throw new PlayError(playErrorRef.current || "network");
      return run(fresh);
    }
  };
  const playErrorOf = (err: unknown) => {
    const reason = err instanceof PlayError ? err.reason : "network";
    return playErrorText(reason, reason === "too_many" && !playRef.current ? "start" : "check");
  };

  // カギクリック → クローズアップモーダルを開く
  const focusCellByItem = (item: PlacedItem) => {
    if (pausedRef.current) return; // 一時停止の幕の間は開かない
    // 解けた瞬間から解き終えた画面に替わるまでは開かない（前は幕が受け止めていた）
    if (gamePhase === "cleared" && !isCleared) return;
    emitPress(item, item.startX, item.startY);
    setActiveWordItem(item);
    setCurrentWordDirection(item.direction);
    setActiveCell({ x: item.startX, y: item.startY });
    setActiveCloseupIndex(0);
    setShowCloseup(true);
  };

  // セルをタップ → そのセルを含むワードでクローズアップモーダルを開く
  const openCloseupForCell = (x: number, y: number) => {
    if (!playerPuzzle || isCleared || pausedRef.current) return;
    // 解けた瞬間から解き終えた画面に替わるまでは開かない（前は幕が受け止めていた）
    if (gamePhase === "cleared") return;
    // 最初のマスの脈打ちと1行は、どこかのマスを押した瞬間に消して二度と出さない
    if (firstCellHint) {
      lsSet(FIRST_CELL_KEY, "1");
      setFirstCellHint(false);
    }
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
      emitPress(word, x, y);
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
  // activeCloseupIndex は縦線（マスの左端に立つ）の位置。0〜語の長さ。語の長さ＝最後のマスの右（Hop 決定 2026-10-07）
  // 字は縦線の右のマスに入り、縦線が1つ右へ進む。最後のマスの右にいる時は入らない
  const handleCloseupKeyPress = (char: string) => {
    if (!activeWordItem || isCleared) return;
    if (activeCloseupIndex >= activeWordItem.length) return;
    const key = closeupCellKey(activeCloseupIndex);
    pendingInputRef.current = key;
    setUserAnswers((prev) => ({ ...prev, [key]: char.toUpperCase() }));
    setActiveCloseupIndex(activeCloseupIndex + 1);
  };

  // 1文字見る: 入力カードで選んでいるマスに正しい字を入れる（Hop 決定 2026-10-04）。もう正しい字が入っていれば数えない
  // 字は受付係から受け取る（答えはブラウザに無い）。同じマスを2度見ても数は増えない
  // 見るマスは縦線の右のマス。縦線が最後のマスの右にいる時は最後のマス。見た後は縦線がそのマスの右へ
  const handleReveal = async () => {
    if (!activeWordItem || isCleared) return;
    const index = Math.min(activeCloseupIndex, activeWordItem.length - 1);
    const [x, y] = closeupCellKey(index).split(",").map(Number);
    if (isDebugMode || isTutorial || isTrial) {
      setReveals((r) => r + 1);
      pendingInputRef.current = `${x},${y}`;
      setUserAnswers((prev) => ({ ...prev, [`${x},${y}`]: activeWordItem.answer[index].toUpperCase() }));
      setActiveCloseupIndex(index + 1);
      return;
    }
    try {
      const r = await withPlay((token) => revealCell(token, x, y));
      setReveals(r.reveals);
      pendingInputRef.current = `${x},${y}`;
      setUserAnswers((prev) => ({ ...prev, [`${x},${y}`]: r.char }));
      setActiveCloseupIndex(index + 1);
    } catch (err) {
      console.warn("Failed to reveal:", err);
      toast.error(playErrorOf(err));
    }
  };

  // 消す: 縦線の左のマスを空にして、縦線を1つ左へ。縦線が先頭にいる時は何もしない
  const handleCloseupBackspace = () => {
    if (!activeWordItem || isCleared) return;
    if (activeCloseupIndex <= 0) return;
    const prevIndex = activeCloseupIndex - 1;
    const prevKey = closeupCellKey(prevIndex);
    setActiveCloseupIndex(prevIndex);
    setUserAnswers((prev) => {
      const newAnswers = { ...prev };
      delete newAnswers[prevKey];
      return newAnswers;
    });
  };

  const handleCloseupComplete = () => {
    setShowCloseup(false);
  };

  // クローズアップモーダル内での文字変換（濁音・半濁音）。index は効かせるマス（縦線の左のマス）。縦線は動かさない
  const handleCloseupModifyChar = (char: string, index: number) => {
    if (!activeWordItem || isCleared) return;
    if (index < 0 || index >= activeWordItem.length) return;
    const key = closeupCellKey(index);
    setUserAnswers((prev) => ({ ...prev, [key]: char.toUpperCase() }));
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

  // タイマーの表示。盤を開いている間だけ進む（Hop 決定 2026-10-07。前は画面を隠している間も進めていた）
  // 開いたまま端末が眠った時（画面を隠した合図が来ないまま時計が飛んだ時）は、眠る前の時刻で一時停止する
  useEffect(() => {
    if (gamePhase !== "playing" || !timing) return;
    lastTickRef.current = Date.now();
    const tick = () => {
      const now = Date.now();
      // 作る画面の「試す」はタイムを出さないので、時計が飛んでも止めない（幕で盤を隠さない）
      if (timing.openedAt !== null && now - lastTickRef.current > SLEEP_GAP_MS && !isTrial) {
        pauseBoard({ at: lastTickRef.current });
        return;
      }
      lastTickRef.current = now;
      // 全部埋まってから答え合わせが走るまでは、表示を待ち始めた時の値で止める（Hop 決定 2026-10-21。その待ちはタイムに入れない）
      const hold = autoCheckRef.current.holdMs;
      const shown = hold !== null ? Math.min(hold, activeMsNow(timing, now)) : activeMsNow(timing, now);
      setElapsedSeconds(Math.max(0, Math.floor(shown / 1000)));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [gamePhase, timing]); // eslint-disable-line react-hooks/exhaustive-deps

  // 画面を隠した時・閉じた時は自動で一時停止する（返事は待てないので sendBeacon）。戻っても自動では再開しない
  // 作る画面の「試す」はタイムを出さないので、画面を隠しても止めない（幕で盤を隠さない）
  useEffect(() => {
    if (gamePhase !== "playing" || isCleared || isTrial) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") pauseBoard({ beacon: true });
    };
    const onPageHide = () => pauseBoard({ beacon: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [gamePhase, isCleared]); // eslint-disable-line react-hooks/exhaustive-deps

  // 開いている間は60秒ごとに生存の合図を送る（幕の間・解けた後は送らない）
  useEffect(() => {
    if (gamePhase !== "playing" || isCleared || paused || isLocalTiming) return;
    const interval = setInterval(() => {
      const token = playRef.current?.token;
      if (!token || pausedRef.current) return;
      // 眠りから覚めた直後は合図を送らず、一時停止にする（眠っていた分を受付係に数えさせない）
      if (Date.now() - lastTickRef.current > SLEEP_GAP_MS) {
        pauseBoard({ at: lastTickRef.current });
        return;
      }
      const seq = timingSeqRef.current;
      pingPlay(token)
        .then((r) => {
          if (r.open && seq === timingSeqRef.current && !pausedRef.current) setTiming({ activeMs: r.activeMs, openedAt: Date.now() });
        })
        .catch((err) => console.warn("Failed to ping play:", err));
    }, PING_MS);
    return () => clearInterval(interval);
  }, [gamePhase, isCleared, paused, isLocalTiming]); // eslint-disable-line react-hooks/exhaustive-deps

  // 解く画面から別の画面へ移る時（この画面が消える時）も、開いていれば閉じる
  const liveRef = useRef({ phase: gamePhase, cleared: isCleared });
  liveRef.current = { phase: gamePhase, cleared: isCleared };
  useEffect(
    () => () => {
      const token = playRef.current?.token;
      if (isLocalTiming || !token || pausedRef.current) return;
      if (liveRef.current.phase === "playing" && !liveRef.current.cleared) pausePlayBeacon(token);
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // 幕がかかったら「再開」にフォーカスを移す
  useEffect(() => {
    if (paused) resumeButtonRef.current?.focus();
  }, [paused]);

  // 遊ばれた回数は、盤に最初の1文字が入ったときに1足す（Hop 決定 2026-10-04。開いただけでは数えない）。
  // 同じ端末では1つの問題につき1回だけ。作った本人の端末では数えない。失敗しても遊ぶのは止めない。
  // 数えるのは受付係（回ごとに1度・同じ接続元と問題は24時間に1度。外から回数を足す呼び出しは使えない）
  // 解き終えた画面を開き直した時（入れた字を戻しただけ）は数えない・回も始めない
  useEffect(() => {
    if (!playerPuzzle || isDebugMode || isTutorial || isTrial || gamePhase !== "playing" || Object.keys(userAnswers).length === 0) return;
    const id = playerPuzzle.id;
    if (lsGet(`${PLAYED_PREFIX}${id}`)) return;
    if (readMyPuzzles().some((m) => m.id === id)) return;
    lsSet(`${PLAYED_PREFIX}${id}`, "1");
    withPlay((token) => touchPlay(token)).catch((err) => console.warn("Play count increment failed:", err));
  }, [userAnswers, playerPuzzle, isDebugMode, isTutorial, gamePhase]);

  // Persist Progress (including elapsed time)
  useEffect(() => {
    if (playerPuzzle && !isTutorial && !isTrial && gamePhase === "playing" && Object.keys(userAnswers).length > 0) {
      lsSet(`${PROGRESS_PREFIX}${playerPuzzle.id}`, JSON.stringify({ userAnswers, elapsedSeconds, reveals, play: playRef.current, savedAt: Date.now() }));
    }
  }, [userAnswers, playerPuzzle, elapsedSeconds, gamePhase, reveals, isTutorial, isTrial]);

  // 作る画面の「試す」: 入れた字と解けたかを作る画面へ知らせる（端末には残さない。作る画面が画面を開いている間だけ持つ）
  const onTrialAnswersRef = useRef(trial?.onAnswers);
  onTrialAnswersRef.current = trial?.onAnswers;
  useEffect(() => {
    if (isTrial && playerPuzzle) onTrialAnswersRef.current?.(userAnswers, gamePhase === "cleared");
  }, [userAnswers, gamePhase, playerPuzzle, isTrial]);

  // 解けたら端末の途中経過を消す（2026-10-06 レビューの直し）。開き直した時の見え方は解き終えた印（CLEARED_PREFIX）が決める（Hop 指示 2026-10-17）
  useEffect(() => {
    if (playerPuzzle && !isTutorial && !isTrial && gamePhase === "cleared") lsRemove(`${PROGRESS_PREFIX}${playerPuzzle.id}`);
  }, [playerPuzzle, gamePhase, isTutorial, isTrial]);

  // --- Player Functions ---
  const handleCellChange = (cell: { x: number; y: number }, val: string) => {
    setUserAnswers((prev) => ({ ...prev, [`${cell.x},${cell.y}`]: val }));
  };

  // リセットはマスを空にするだけで、回は続ける（タイム・見た数・ミスはその回のまま）。
  // 「途中まで埋めたが合わない所が出たので消す」が動機なので、時間は継続加算（Hop 決定 2026-10-06）
  const handleReset = () => {
    if (confirm("入力をすべて消す？ タイムはそのまま続きます。")) {
      setUserAnswers({});
      setIsCleared(false);
    }
  };

  // 丸付け。空きマスがあればその場で知らせ、全部埋まっていれば受付係に丸付けしてもらう。
  // silent は、埋まったまま直している途中の丸付け（合っていた時だけ終える。違っていても何も言わない）
  // waitedMs は自動の答え合わせが走るまで待った時間。受付係に添えて、解けた時のタイムから引いてもらう
  const handleClearCheck = async (silent = false, waitedMs = 0) => {
    if (!playerPuzzle?.cells || isCleared) return;
    if (checking || checkingRef.current) {
      // 通信中に呼ばれた（盤が変わった）。通信の後に今の盤でもう一度丸付けする
      checkDirtyRef.current = true;
      return;
    }
    const full = playerPuzzle.cells.every((c) => !!userAnswers[`${c.x},${c.y}`]);
    if (!full) {
      setBoardStatus(null);
      if (!silent) toast.error("まだ埋まっていないマスがあります。", { duration: 4000 });
      return;
    }
    let allCorrect = false;
    let serverTime: number | null = null;
    if (isDebugMode || isTutorial || isTrial) {
      // 練習問題とデバッグ用の見本と作る画面の「試す」は、ブラウザの中で答え合わせする（受付係を通さない）。小さい字は大きい字にそろえて比べる
      allCorrect = playerPuzzle.cells.every((c) => toLargeKana(userAnswers[`${c.x},${c.y}`] ?? "") === toLargeKana(c.value));
    } else {
      setChecking(true);
      checkingRef.current = true;
      checkDirtyRef.current = false;
      try {
        const r = await withPlay((token) => checkPlay(token, userAnswers, waitedMs));
        allCorrect = r.correct;
        if (r.correct && r.answers) {
          // 解けたので答えを受け取って盤に入れる（終わりの画面の答えの表示に使う）
          const answers = r.answers;
          setPlayerPuzzle((prev) => {
            if (!prev) return prev;
            const items = prev.items.map((it, i) => ({ ...it, answer: answers[i] ?? it.answer }));
            return { ...buildGrid(items), id: prev.id, title: prev.title, creatorName: prev.creatorName };
          });
          serverTime = typeof r.timeSeconds === "number" ? r.timeSeconds : null;
          rankableRef.current = r.rankable !== false;
        }
      } catch (err) {
        console.warn("Failed to check:", err);
        // 黙る方でも失敗は隠さない。盤が変わらないと丸付けし直されないので、少し待って自動でもう一度試す（3回まで）
        setBoardStatus("failed");
        autoCheckRef.current.holdMs = null; // 止めていたタイマーの表示を戻す
        if (!silent) toast.error(playErrorOf(err));
        if (retryRef.current < 3) {
          retryRef.current += 1;
          setTimeout(() => setRecheckTick((t) => t + 1), 3000);
        }
        return;
      } finally {
        setChecking(false);
        checkingRef.current = false;
        // 通信中に盤が変わっていて、まだ解けていなければ、今の盤で1度だけ黙って丸付けし直す
        if (checkDirtyRef.current) {
          checkDirtyRef.current = false;
          if (!allCorrect) setRecheckTick((t) => t + 1);
        }
      }
    }

    retryRef.current = 0;
    // 止めていたタイマーの表示は、解けなかった時だけ戻す（解けた時は止めたまま終わりの画面へ。通信の間に表示が進んで見えないように）
    if (!allCorrect) autoCheckRef.current.holdMs = null;
    setBoardStatus(allCorrect ? null : "wrong");
    if (allCorrect) {
      // 解けたら幕は出さない（通信の間に幕がかかっていた時のため）
      setPaused(false);
      // Stage 1: クリア演出開始。ハンコをすぐ盤に押し、ハンコが届いた時に盤が沈む（Hop が見本で選んだ案 C「幕なし」・2026-10-21。前は幕＋CLEARED! の後にハンコ）。
      // ハンコが見えるよう、入力の窓は閉じる
      setShowClearAnimation(true);
      setGamePhase("cleared");
      heldWordsRef.current = { ids: new Set(), lastKey: null }; // 窓に隠れている間に埋まった語の跳ねは出さず、ハンコを優先する
      setShowCloseup(false);
      if (!prefersReducedMotion()) {
        window.setTimeout(() => {
          const box = boardBoxRef.current;
          if (box) animateElement(box, {}, { scale: [1, 0.97, 1] }, { duration: 0.25, ease: "easeOut" });
        }, STAMP_LAND_MS);
      }

      // Stage 2: タイム計算（500ms後）
      clearTimeRef.current = null;
      setTimeout(() => {
        // タイムは受付係の時計で測った物（デバッグ用の見本だけこの端末の時計）
        const timeSeconds = serverTime ?? (timingRef.current ? Math.floor(activeMsNow() / 1000) : null);
        if (timeSeconds !== null && puzzleId) {
          setClearTime(timeSeconds);
          clearTimeRef.current = timeSeconds;
        }
        // 解き終えた印を端末に残す。開き直した時はこの画面をそのまま出す（Hop 指示 2026-10-17）
        // 答えは受付係だけが持っていてブラウザには届かないので、盤に出す字は解いた本人が入れた字（全部合っている）を残す
        if (playerPuzzle && !isTutorial && !isDebugMode && !isTrial) lsSet(`${CLEARED_PREFIX}${playerPuzzle.id}`, JSON.stringify({ clearTime: timeSeconds, userAnswers, clearedAt: Date.now() }));
        // 読み上げで知らせる（画面には出さない。練習問題はタイムを測らないので文だけ）
        toast.announce(timeSeconds !== null && !isTutorial ? `解けました。タイム ${clock(timeSeconds)}` : "解けました。");
      }, 500);

      // Stage 3: クリア状態確定（1000ms後）
      setTimeout(() => setIsCleared(true), 1000);

      // Stage 4: アニメーション終了・名前入力の窓（2000ms後）
      // 作った本人の端末で解いた回も記録しない（Hop 決定 2026-10-04。答えを知っている人で一番上が埋まらないように）
      setTimeout(() => {
        setShowClearAnimation(false);
        const isOwn = !!puzzleId && readMyPuzzles().some((m) => m.id === puzzleId);
        if (puzzleId && !isOwn && rankableRef.current && clearTimeRef.current !== null && clearTimeRef.current >= 1) {
          setShowNameEntry(true);
        }
      }, 2000);
    } else {
      // どこが違うかは示さない。どれが間違っているかを自分で考え直すのが楽しいので（Hop 2026-10-04。HarmonyPalette の赤枠は外した）。
      // 文言は埋まっていないマスがあるかで分ける（Hop が任せた文言・2026-10-04）
      // ミスは受付係が数える（間違ったまま全部埋めたことがあるか）
      if (!silent) {
        toast.error("どこかに間違いがあります。", { duration: 4000 });
        // 盤が小さく横に揺れる（400ms。Hop が見本で選んだ案 C・2026-10-21）。どこが違うかは示さない
        const box = boardBoxRef.current;
        if (box) animateElement(box, {}, { x: [0, -6, 6, -4, 4, 0] }, { duration: 0.4, ease: "easeOut" });
      }
    }
  };

  // 最後の空きマスが埋まったら、答え合わせのボタンを押さなくても答え合わせをする（Hop 依頼 2026-10-04。HarmonyPalette には無い）。
  // 埋まった瞬間は、合っていても間違っていても答え合わせと同じ反応を返す。埋まったまま直している間は黙って見て、全部合った時だけ終える。
  // 保存してあった盤を開き直しただけでは始めない（最初の1回は今の状態を覚えるだけ）
  // 埋まった瞬間の丸付けも、黙る方と同じだけ待ってから走らせる。その間に ゛゜ で字が変われば、変わった後の盤で丸付けする
  // （最後のマスが濁る字の時に、゛ の前に答え合わせが走らないように。2026-10-06 レビューの直し）。待ちの間は入力の窓を閉じない
  const AUTO_CHECK_WAIT_MS = 400; // Hop 決定 2026-10-21
  // 最後に字が変わったマスの字が ゛゜ を付けられる字なら、゛゜ を押すのを待つ（Hop 決定 2026-10-21）。
  // 付けられるかは文字盤の ゛゜ の働き（押すと別の字になるか）で決める。バ→パのように行き来できる字も入る
  // 1文字見るで入った字も同じ規則。複数のマスが一度に変わった時は1つでも付けられる字なら 2000ms
  const AUTO_CHECK_MARK_WAIT_MS = 2000; // Hop 決定 2026-10-21
  const canTakeMark = (ch: string | undefined) => !!ch && (!!modifiedChar("dakuten", ch) || !!modifiedChar("handakuten", ch));
  // loud = 埋まった瞬間の反応（合否を知らせる方）をまだ返していない
  // holdMs = 答え合わせ待ちを始めた時（最後に字が変わった時）の開いていた時間（ミリ秒）。待っている間はタイマーの表示をこの値で止め、待った分を受付係に添える
  // prev = 前に見た盤（どのマスの字が変わったかを見る）。waitMs = 最後に字が変わった時に決めた待ち時間
  // pending = まだ走っていない答え合わせがある（一時停止で取り消した待ちも含む。再開した時に待ち直して走らせる）
  // dueAt = 答え合わせを走らせる時刻（端末の時計。待ちを始めた時に決める）
  const autoCheckRef = useRef<{ ready: boolean; full: boolean; loud: boolean; holdMs: number | null; prev: Record<string, string>; waitMs: number; pending: boolean; dueAt: number }>({
    ready: false,
    full: false,
    loud: false,
    holdMs: null,
    prev: {},
    waitMs: AUTO_CHECK_WAIT_MS,
    pending: false,
    dueAt: 0,
  });
  useEffect(() => {
    const prev = autoCheckRef.current.prev;
    autoCheckRef.current.prev = userAnswers;
    if (!playerPuzzle?.cells || isCleared || gamePhase !== "playing") return;
    const full = playerPuzzle.cells.every((c) => !!userAnswers[`${c.x},${c.y}`]);
    const wasFull = autoCheckRef.current.full;
    autoCheckRef.current.full = full;
    if (!autoCheckRef.current.ready) {
      autoCheckRef.current.ready = true;
      return;
    }
    const changed = Object.keys(userAnswers).filter((k) => userAnswers[k] !== prev[k]);
    // 答え合わせの通信中に盤が変わったら、通信の後に今の盤でもう一度丸付けする（一時停止の切り替えだけで見張りが動いた時は、盤が同じなので印を立てない）
    if (checkingRef.current) {
      if (changed.length > 0) {
        checkDirtyRef.current = true;
        autoCheckRef.current.holdMs = null; // この後の丸付けし直しは待たずに走るので、表示も止めない
      }
      return;
    }
    if (!full) {
      autoCheckRef.current.loud = false;
      autoCheckRef.current.holdMs = null;
      autoCheckRef.current.pending = false;
      setBoardStatus(null);
      return;
    }
    if (!wasFull) autoCheckRef.current.loud = true;
    // 字が変わったマスがあれば待ち時間を決め直す（字が変わっていない時は前に決めた待ち時間のまま）
    if (changed.length > 0) autoCheckRef.current.waitMs = changed.some((k) => canTakeMark(userAnswers[k])) ? AUTO_CHECK_MARK_WAIT_MS : AUTO_CHECK_WAIT_MS;
    // 走らせる答え合わせが無ければ何もしない（盤が変わらずに見直しが走った時に、同じ盤を何度も丸付けしない）
    if (changed.length === 0 && wasFull && !autoCheckRef.current.pending) return;
    autoCheckRef.current.pending = true;
    // 一時停止の幕の間・画面を隠している間は走らせない（Hop 指示 2026-10-21）。待ちは取り消し、再開した時にその盤で待ち直す
    if (paused) {
      autoCheckRef.current.holdMs = null;
      return;
    }
    // 待ち始めは最後に字が変わった時（゛゜ で字が変わった時もそこから止め直す。Hop 決定 2026-10-21）。
    // 表示を止めた分＝受付係に添える待った時間、になるようにそろえる
    if (changed.length > 0 || autoCheckRef.current.holdMs === null) {
      autoCheckRef.current.holdMs = activeMsNow();
      autoCheckRef.current.dueAt = Date.now() + autoCheckRef.current.waitMs;
    }
    // 打ち終わるのを少し待ってから丸付けする（1字ごとに通信しない）。
    // 同じ字を入れ直すなど盤が変わらずに見張りが動いた時は、待ちを最初からやり直さず残りだけ待つ（止めた表示と待った時間がずれないように）
    const timer = setTimeout(() => {
      // 止めた直後、描き直しで待ちが取り消される前に鳴った時も走らせない（pending のまま、再開した時に待ち直す）
      if (pausedRef.current) {
        autoCheckRef.current.holdMs = null;
        return;
      }
      autoCheckRef.current.pending = false;
      const loud = autoCheckRef.current.loud;
      autoCheckRef.current.loud = false;
      const hold = autoCheckRef.current.holdMs;
      autoCheckRef.current.holdMs = null;
      // 待った時間は開いていた時間で測る（待ちの間に一時停止していた分は入れない）
      const waitedMs = hold !== null ? Math.max(0, Math.round(activeMsNow() - hold)) : 0;
      if (loud) {
        heldWordsRef.current = { ids: new Set(), lastKey: null }; // 窓に隠れている間に埋まった語の跳ねは出さず、ハンコか揺れを優先する
        setShowCloseup(false); // 結果が盤の上で見えるように、拡大の窓は閉じる
      }
      void handleClearCheck(!loud, waitedMs);
    }, Math.max(0, autoCheckRef.current.dueAt - Date.now()));
    return () => clearTimeout(timer);
  }, [userAnswers, playerPuzzle, isCleared, gamePhase, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // 窓に隠れている間に埋まった語を、盤が見えた時にまとめて跳ねさせる（入力の窓が消え終わった時・幕を外した時）。
  // 1語なら語の頭から1字25ms、2語以上なら最後に字を入れたマスからの距離1マス30ms。閉じるまでに字を消されて埋まっていない語は跳ねさせない。
  // 自動の答え合わせが待っている・走っている時は、続くハンコ（解けた時）か揺れ（間違いの時）を優先して跳ねは出さない
  const flushHeldWords = () => {
    const held = heldWordsRef.current;
    if (held.ids.size === 0) return;
    if (pausedRef.current) return; // 幕の間は盤が見えないので覚えたまま。幕を外した時に跳ねさせる
    const ids = held.ids;
    const lastKey = held.lastKey;
    heldWordsRef.current = { ids: new Set(), lastKey: null };
    if (!playerPuzzle || !lastKey || isCleared || gamePhase !== "playing") return;
    if (autoCheckRef.current.pending || checkingRef.current) return;
    const done = playerPuzzle.items.filter((it) => ids.has(it.uuid) && itemCellKeys(it).every((k) => !!userAnswers[k]));
    const words = wordsFxOf(done, lastKey);
    if (words) setGridFx({ id: ++fxIdRef.current, words });
  };
  const flushHeldRef = useRef(flushHeldWords);
  flushHeldRef.current = flushHeldWords;
  useEffect(() => {
    if (!paused && !showCloseup) flushHeldRef.current();
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // もう一度解く: 解き終えた印を外し、新しい回として最初から。開いた時と同じ流れ（遊び方の窓・決まりのクイズの扉）を通る
  const handlePlayAgain = () => {
    if (playerPuzzle) lsRemove(`${CLEARED_PREFIX}${playerPuzzle.id}`);
    setRestoredCleared(false);
    setIsCleared(false);
    setClearTime(null);
    clearTimeRef.current = null;
    rankableRef.current = true;
    setBoardStatus(null);
    setShowHintVideos(false);
    setActiveCell(null);
    setActiveWordItem(null);
    setUserAnswers({});
    setReveals(0);
    playRef.current = null;
    restoredElapsedRef.current = 0;
    autoCheckRef.current = { ready: false, full: false, loud: false, holdMs: null, prev: {}, waitMs: AUTO_CHECK_WAIT_MS, pending: false, dueAt: 0 };
    setGamePhase("ready");
  };

  // 通信中に盤が変わっていた時の丸付けし直し（黙る方。今の盤で）
  useEffect(() => {
    if (recheckTick === 0) return;
    // 止まっている間は走らせず、再開した時に待ち直して走らせる（上の見張りが pending を見る）
    if (pausedRef.current) {
      autoCheckRef.current.pending = true;
      return;
    }
    void handleClearCheck(true);
  }, [recheckTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Submit Score Logic with Network Protection（HarmonyPalette の handleSubmitScore と同じ動き） ---
  const handleSubmitScore = async (name: string) => {
    const t = clearTimeRef.current;
    const token = playRef.current?.token;
    if (!puzzleId || t === null || !token) return;
    try {
      await saveScore(token, name);
      setShowNameEntry(false);
      setRankingRefresh((k) => k + 1);
    } catch (error) {
      console.error("Failed to save score:", error);
      const isNetworkError = (error instanceof ScoreError && error.reason === "network") || !navigator.onLine;
      if (isNetworkError) {
        queueScore(token, name);
        toast.success(T.stage2b.scoreQueued, { duration: 6000 });
        setShowNameEntry(false);
      } else {
        // 続けて送りすぎた時は、控えずに知らせるだけ（時間をおけば送れる。2026-10-27）
        toast.error(error instanceof ScoreError && error.reason === "score_limit" ? T.stage2b.scoreLimit : T.stage2b.scoreFailed);
      }
    }
  };

  // スキップしたら記録しない（Hop 決定 2026-10-03。HarmonyPalette は名前なしで記録していた）
  const handleSkipScore = () => {
    setShowNameEntry(false);
  };

  // --- 練習問題の案内（Hop 決定 2026-10-05。2段だけ。あとは案内なしで解き、ハンコの後に「本番へ」） ---
  // 0 マスを押す → 1 文字盤（字を入れたら「閉じる」で終える）
  useEffect(() => {
    if (!isTutorial || tutStep === null) return;
    if (isCleared) {
      endTutorial();
      return;
    }
    if (tutStep === 0 && showCloseup) setTutStep(1);
    // 文字盤に印を付けている間に窓が閉じたら、マスを押す段へ戻る
    else if (tutStep === 1 && !showCloseup) setTutStep(0);
  }, [isTutorial, tutStep, showCloseup, isCleared]); // eslint-disable-line react-hooks/exhaustive-deps

  const tutorialSteps: CoachStep[] = [
    { target: "#cell-0-0", lines: T.tutorial.cell, showNext: false },
    // 窓の中に印がある段は、吹き出しを画面の上に出す（窓のマスや文字盤を隠さない）
    { target: ['[data-coach="closeup-cells"]', '[data-coach="keypad"]'], lines: T.tutorial.keypad, canNext: Object.keys(userAnswers).length > 0, placement: "top", nextLabel: T.tutorial.close },
  ];
  const tutorialNext = () => {
    if (tutStep === null) return;
    if (tutStep >= tutorialSteps.length - 1) endTutorial();
    else setTutStep(tutStep + 1);
  };

  const clueList = (dir: "horizontal" | "vertical") =>
    playerPuzzle!.items.filter((i) => i.direction === dir).sort((a, b) => (a.clueIndex || 0) - (b.clueIndex || 0));

  // 最初のマス（1番のカギの先頭）。脈打ちと1行は、始めた後・解く前・遊び方の窓が閉じている時だけ
  const firstCellPos = (() => {
    const first = playerPuzzle?.items.reduce<PlacedItem | null>((a, b) => (!a || (b.clueIndex ?? 1e9) < (a.clueIndex ?? 1e9) ? b : a), null);
    return first ? { x: first.startX, y: first.startY } : null;
  })();
  const showFirstCellHint = firstCellHint && !isTutorial && gamePhase === "playing" && !isCleared && !paused && !showHelp && resumeAsk === null && !!firstCellPos;

  // --- Render ---

  if (isPlayerMode && playerPuzzle) {
    return (
      <div data-trial={isTrial ? "" : undefined} className={isTrial ? "bg-surface" : "min-h-screen bg-surface"}>
        {/* 作る画面の「試す」では知らせの入れ物と見出しは作る画面の物を使う */}
        {!isTrial && <Toaster />}
        {/* [No.01] Sticky Header - 60px固定 */}
        {!isTrial && (
        <header className="sticky top-0 z-30 bg-surface h-[60px] flex items-center px-4" style={{ borderBottom: `1px solid ${C.ghost}` }}>
          <div className="container mx-auto max-w-4xl flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* Issue 5: ゲーム中（playing）はギャラリーへのリンクを非表示 */}
              {/* 練習問題では解いている間も隠さない。押すと元の問題（無ければ一覧）へ戻る（Hop 2026-10-05「離脱不可能なチュートリアルやめてほしい」） */}
              {isTutorial && (
                <button type="button" onClick={goReal} className="p-1.5 hover:bg-surface-container-high transition-colors" style={{ color: C.ink }} title={T.tutorial.toReal} aria-label={T.tutorial.toReal}>
                  <Icon icon="chevron_left" />
                </button>
              )}
              {gamePhase !== "playing" && !isTutorial && (
                <Link to="/crossword" className="p-1.5 hover:bg-surface-container-high transition-colors" style={{ color: C.ink }} title="ギャラリーへ戻る" aria-label="ギャラリーへ戻る">
                  <Icon icon="chevron_left" />
                </Link>
              )}
              {/* [No.02] Title & Author - 縦積み、truncate */}
              <div className="flex flex-col min-w-0 flex-1">
                <h1 className="text-base font-bold truncate" style={{ color: C.ink }}>{playerPuzzle.title || "無題の問題"}</h1>
                {!isTutorial && <p className="text-xs truncate" style={{ color: C.secondary }}>{playerPuzzle.creatorName || T.anonymous}</p>}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {gamePhase === "playing" && !isTutorial && (
                <span data-timer="" className="text-lg font-mono font-bold tabular-nums" style={{ color: C.ink }}>
                  {clock(elapsedSeconds)}
                </span>
              )}
              {/* 一時停止（Hop 決定 2026-10-07）。解けた後は出さない。幕の間は押せない（幕の「再開」で戻る） */}
              {gamePhase === "playing" && !isCleared && (
                <button
                  type="button"
                  onClick={() => pauseBoard()}
                  disabled={paused}
                  className="p-1.5 hover:bg-surface-container-high disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  style={{ color: C.ink }}
                  title="一時停止"
                  aria-label="一時停止"
                >
                  <Icon icon="pause" />
                </button>
              )}
              {/* 解けた後は ↻ を出さない（2026-10-06 レビューの直し） */}
              {gamePhase !== "cleared" && !isCleared && (
                <button onClick={handleReset} className="p-1.5 hover:bg-surface-container-high transition-colors" style={{ color: C.ink }} title="リセット" aria-label="リセット">
                  <Icon icon="restart_alt" />
                </button>
              )}
            </div>
          </div>
        </header>
        )}

        {/* [No.12] プログレスバー - ヘッダー直下（作る画面の「試す」では作る画面の見出しの下） */}
        {gamePhase !== "ready" && (
          <div className="sticky z-20 bg-white" style={{ top: isTrial ? trial!.stickyTop : 60 }}>
            <SegmentBar filled={filledCount} total={playerPuzzle.cells.length} />
          </div>
        )}

        <main className="container mx-auto max-w-2xl px-4 py-4">
          {/* --- Start Overlay / Help Modal --- */}
          <Presence>
            {showHelp && (
              <Motion
                ref={helpDialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="cw-help-title"
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
                    <h2 id="cw-help-title" className="text-2xl font-bold mb-2" style={{ color: C.ink }}>{T.playerHelp.title}</h2>
                    <p className="text-sm" style={{ color: C.secondary }}>{T.playerHelp.createdBy(playerPuzzle.creatorName || T.anonymous)}</p>
                  </div>

                  <div className="space-y-4 mb-8">
                    {T.playerHelp.steps.map((s, i) => (
                      <div key={i} className="flex gap-4 items-start bg-surface-container-low p-3">
                        <span className="bg-primary text-white font-bold w-6 h-6 flex items-center justify-center text-sm flex-shrink-0">{i + 1}</span>
                        <p className="text-sm" style={{ color: C.ink }}>
                          {s}
                          {T.playerHelp.stepNotes[i]?.map((n) => <span key={n} className="block text-xs mt-1 whitespace-pre-line" style={{ color: C.secondary }}>{n}</span>)}
                        </p>
                      </div>
                    ))}
                  </div>

                  {isRulesQuiz && (
                    <p className="text-sm mb-4 bg-surface-container-low p-3" style={{ color: C.ink }}>{T.playerHelp.rulesNote}</p>
                  )}

                  <div className="space-y-2">
                    <button
                      // 回を始めるのは closeHelp の中の1回だけ（2026-10-06 レビューの直し。前は2度呼んでいた）
                      onClick={closeHelp}
                      className="w-full bg-primary hover:bg-secondary text-white font-bold py-4 text-lg flex items-center justify-center gap-2 transition-colors"
                    >
                      <Icon icon="play_arrow" />
                      {T.playerHelp.start}
                    </button>
                    {/* 練習問題の入口は「?」から開いた時だけ（初めて開いた時は「始める！」だけ。Hop 決定 2026-10-05） */}
                    {!helpFirst && (
                      <button
                        onClick={goPractice}
                        className="w-full bg-surface-container-high hover:bg-surface-container-highest font-bold py-3 flex items-center justify-center gap-2 transition-colors"
                        style={{ color: C.ink }}
                      >
                        {T.playerHelp.practice}
                      </button>
                    )}
                    {!helpFirst && (
                      <button
                        onClick={() => { setShowHelp(false); setShowRequest(true); }}
                        className="w-full py-2 text-sm underline underline-offset-4 transition-colors hover:text-black"
                        style={{ color: C.secondary }}
                      >
                        {T.playerHelp.request}
                      </button>
                    )}
                  </div>
                </Motion>
              </Motion>
            )}
          </Presence>

          {!isTrial && (
          <div className="flex justify-center items-center gap-4 mb-8">
            <p className="text-center text-sm" style={{ color: C.secondary }}>クロスワード</p>
            <button
              onClick={() => (isTutorial ? !isCleared && setTutStep(0) : setShowHelp(true))}
              className="transition-colors hover:text-black"
              style={{ color: C.outline }}
              title={T.howToPlay}
              aria-label={T.howToPlay}
            >
              <Icon icon="help" />
            </button>
          </div>
          )}

          <Presence>
            {isAssemblyAnimating ? (
              <Motion initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center p-12" style={{ color: C.secondary }}>
                {/* Skeleton Grid */}
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {[...Array(25)].map((_, i) => (
                    <div key={i} className="h-12 w-12 bg-surface-container-high motion-safe:animate-pulse" style={{ animationDelay: `${i * 30}ms` }} />
                  ))}
                </div>
                <p className="text-sm">読み込み中…</p>
              </Motion>
            ) : (
              <Motion initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="space-y-8">
                {/* パズル描画エリア（ハンコはこの上に押す。すぐ下に「Xに投稿」が来るように） */}
                <div data-board-area="" className="mb-8 w-full relative">
                  {(isCleared || showClearAnimation) && <ClearEffect fadeAfterMs={isTutorial ? TUTORIAL_STAMP_FADE_MS : undefined} />}
                  {/* 一時停止の幕。盤の領域を全部覆い、中身は「再開」だけ（Hop 決定 2026-10-07） */}
                  {paused && !isCleared && (
                    <div data-pause-curtain="" className="absolute inset-0 z-10 flex items-center justify-center bg-surface-container-high">
                      <button
                        ref={resumeButtonRef}
                        type="button"
                        onClick={() => void resumeBoard()}
                        disabled={resuming}
                        aria-label="再開"
                        className="px-8 py-3 bg-primary hover:bg-secondary text-white font-bold disabled:opacity-50 transition-colors"
                      >
                        再開
                      </button>
                    </div>
                  )}
                  {/* 幕の間は盤を見えなくし、押せなくする */}
                  <div inert={paused} style={paused ? { visibility: "hidden" } : undefined}>
                  <div ref={boardBoxRef} data-board-box="" className="w-full bg-white p-6 overflow-x-auto">
                    <FitGrid width={playerPuzzle.width} height={playerPuzzle.height} userScale={scale} maxHeight={boardMaxH}>
                      <PuzzleGridRetro
                        data={playerPuzzle}
                        showSolution={isCleared}
                        userAnswers={userAnswers}
                        onCellChange={(cell, val) => handleCellChange(cell, val)}
                        activeCell={activeCell}
                        activeWordId={activeWordItem?.uuid ?? null}
                        onCellClick={(x, y) => openCloseupForCell(x, y)}
                        pulseCell={showFirstCellHint ? firstCellPos : null}
                        fx={gridFx}
                      />
                    </FitGrid>
                  </div>
                  {/* 初めて解く時だけ、盤のすぐ下に1行（幕は無し・操作は奪わない） */}
                  {showFirstCellHint && (
                    <p data-first-cell-hint="" className="text-sm text-center mt-2" style={{ color: C.secondary }}>
                      {T.playerHelp.firstCell}
                    </p>
                  )}

                  {/* Zoom Controls - 中央下に配置 */}
                  <div ref={zoomRef} data-zoom="" className="flex justify-center gap-2 mt-4">
                    <button
                      onClick={() => setScale((prev) => Math.min(2.0, prev + 0.1))}
                      disabled={scale >= 2.0}
                      className="w-11 h-11 flex items-center justify-center bg-surface-container-high hover:bg-surface-container-highest disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      aria-label="ズームイン"
                      title="拡大"
                      style={{ color: C.ink }}
                    >
                      <Icon icon="zoom_in" />
                    </button>
                    <button
                      onClick={() => setScale((prev) => Math.max(0.5, prev - 0.1))}
                      disabled={scale <= 0.5}
                      className="w-11 h-11 flex items-center justify-center bg-surface-container-high hover:bg-surface-container-highest disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      aria-label="ズームアウト"
                      title="縮小"
                      style={{ color: C.ink }}
                    >
                      <Icon icon="zoom_out" />
                    </button>
                    {scale !== 1 && (
                      <button
                        onClick={() => setScale(1)}
                        className="min-w-11 h-11 px-2 bg-surface-container-high hover:bg-surface-container-highest transition-colors text-xs font-bold"
                        title="大きさを戻す"
                        aria-label="大きさを戻す"
                        style={{ color: C.ink }}
                      >
                        {(scale * 100).toFixed(0)}%
                      </button>
                    )}
                  </div>
                  {/* 全部埋まった後の状態（解けるまで出しっぱなし。吹き出しは埋まった瞬間の1回だけなので、ここで状態を示す） */}
                  {!isCleared && (boardStatus || checking) && (
                    <p role="status" className="mt-3 text-center" style={{ fontSize: "0.875rem", color: C.secondary }}>
                      {checking ? "答え合わせ中…" : boardStatus === "wrong" ? "全部埋まっていますが、どこかに間違いがあります。" : "答え合わせできませんでした。通信を確かめてください。しばらくして自動でもう一度試します。"}
                    </p>
                  )}
                  </div>
                </div>

                {/* 解き終えた画面（2026-10-06 任天堂シミュで決定・Hop「いいと思う」）: ハンコの直下に「Xに投稿」→ 名前の窓の後のランキング
                    → ほかの問題 → 畳んだヒントの動画の一覧 */}
                {isCleared && (
                  <div data-cleared-block="">
                    {/* 解けたことをXに投稿 */}
                    {puzzleId && !isTrial && (
                      <div>
                        <a
                          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`解けた！　${playerPuzzle.title}`)}&url=${encodeURIComponent(`${window.location.origin}/crossword/${puzzleId}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2 w-full py-3 bg-primary hover:bg-secondary text-white font-black font-mono transition-colors"
                        >
                          <Icon size={16} icon="share" /> {T.shareModal.postToX}
                        </a>
                      </div>
                    )}
                    {/* ランキング（名前の窓はこの上に出る） */}
                    {puzzleId && !isTrial && (
                      <div className="mt-6">
                        <PuzzleRanking
                          puzzleId={puzzleId}
                          currentScore={clearTime ?? undefined}
                          refreshKey={rankingRefresh}
                          href={`/crossword/${puzzleId}/ranking`}
                        />
                      </div>
                    )}
                    {/* ほかの問題と一覧への入口 */}
                    {puzzleId && !isTrial && playerGenre && <OtherPuzzles genre={playerGenre} puzzleId={puzzleId} />}
                    {/* ヒントの動画の一覧（畳んである。押すと開く） */}
                    {Object.keys(playerHints).length > 0 &&
                      (showHintVideos ? (
                        <HintList items={playerPuzzle.items} hints={playerHints} genre={playerGenre} />
                      ) : (
                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={() => setShowHintVideos(true)}
                            className="w-full sm:max-w-xs mx-auto flex items-center justify-center gap-2 px-6 py-3 bg-surface-container-high hover:bg-surface-container-highest transition-colors font-medium"
                            style={{ color: C.ink }}
                          >
                            {T.showHintVideos(playerGenre)}
                          </button>
                        </div>
                      ))}
                    {/* もう一度解く（解き終えた問題を開き直した時だけ。Hop 指示 2026-10-17） */}
                    {restoredCleared && (
                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={handlePlayAgain}
                          className="w-full sm:max-w-xs mx-auto flex items-center justify-center gap-2 px-6 py-3 bg-surface-container-high hover:bg-surface-container-highest transition-colors font-medium"
                          style={{ color: C.ink }}
                        >
                          {T.playAgain}
                        </button>
                      </div>
                    )}
                    {/* 作成モードへ戻るリンク（練習問題と作る画面の「試す」では出さない） */}
                    {!isTutorial && !isTrial && (
                      <div className="mt-4">
                        <Link
                          to="/crossword/create"
                          className="w-full sm:max-w-xs mx-auto flex items-center justify-center gap-2 px-6 py-3 bg-surface-container-high hover:bg-surface-container-highest transition-colors font-medium"
                          style={{ color: C.ink }}
                        >
                          {T.createNew} <span aria-hidden="true">→</span>
                        </Link>
                      </div>
                    )}
                  </div>
                )}

                {/* Sticky Hint Bar - モーダルが閉じている時のみ表示 */}
                {!isCleared && !showCloseup && !paused && (
                  <StickyHintBar
                    bottom={isTrial ? trial!.dockGap : undefined}
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
                        emitPress(newWord, activeCell.x, activeCell.y);
                        setCurrentWordDirection(newDirection);
                        setActiveWordItem(newWord);
                      }
                    }}
                  />
                )}

                {/* Controls。「答え合わせ」ボタンは外した（最後のマスを埋めた瞬間に合否が出るため。Hop 決定 2026-10-06） */}
                <div className="flex justify-center gap-4">
                  {/* 練習問題から本番へ（解く前でも押せる） */}
                  {isTutorial && (
                    <div data-coach="tutorial-done">
                      <Button onClick={goReal} variant={isCleared ? "primary" : "secondary"}>{T.tutorial.toReal}</Button>
                    </div>
                  )}
                </div>

                {/* Clue List */}
                {/* 幕の間はカギの一覧も見えなくする（考えられないように）。下の帯が開いた時にヨコのカギの見出しに重なる時だけ、一覧の上に帯の分の余白を足す */}
                <div ref={clueListRef} data-bar-spacer={barSpacer || undefined} inert={paused} className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8 bg-surface-container-low p-6" style={{ ...(paused ? { visibility: "hidden" as const } : {}), ...(barSpacer > 0 ? { paddingTop: 24 + barSpacer } : {}) }}>
                  {(["horizontal", "vertical"] as const).map((dir) => (
                    <div key={dir}>
                      <h2 className="font-bold mb-4 pb-2" style={{ color: C.ink }}>
                        {dir === "horizontal" ? "→ ヨコのカギ" : "↓ タテのカギ"}
                      </h2>
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

                {/* 練習問題には作成者がいないので、著作権の注意と通報は出さない（作る画面の「試す」も、まだ公開していないので出さない） */}
                {!isTutorial && !isTrial && (
                <div className="text-center mt-8 text-xs" style={{ color: C.secondary }}>
                  ※作成された問題の著作権および責任は作成者に帰属します。
                </div>
                )}

                {/* 不適切な問題を通報するリンク */}
                {!isTutorial && !isTrial && (
                <div className="text-center mt-2">
                  <button
                    onClick={() => setShowContact(true)}
                    className="text-xs transition-colors inline-flex items-center gap-1 hover:text-black"
                    style={{ color: C.secondary }}
                  >
                    <Icon size={12} icon="flag" />
                    不適切な問題を通報する
                  </button>
                </div>
                )}

              </Motion>
            )}
          </Presence>
        </main>

        {/* Closeup Modal - セルまたはカギをタップした時に表示 */}
        <Presence>
          {showCloseup && activeWordItem && (
            <PuzzleCloseupModal
              wordItem={activeWordItem}
              userAnswers={userAnswers}
              activeIndex={activeCloseupIndex}
              keypadType={isDebugMode ? detectKeypadType(playerPuzzle.items.map((item) => item.answer.join(""))) : "katakana"} // 保存できる答えはカタカナだけ
              hint={playerHints[activeWordItem.uuid]}
              genre={playerGenre}
              hintText={isTutorial ? TUTORIAL_HINTS[activeWordItem.uuid] : undefined}
              onKeyPress={handleCloseupKeyPress}
              onBackspace={handleCloseupBackspace}
              onClose={() => setShowCloseup(false)}
              onExited={() => flushHeldRef.current()}
              onComplete={handleCloseupComplete}
              onPrevCell={() => setActiveCloseupIndex((prev) => Math.max(0, prev - 1))}
              onNextCell={() => setActiveCloseupIndex((prev) => Math.min(activeWordItem?.length || 1, prev + 1))}
              onModifyChar={handleCloseupModifyChar}
              onReveal={handleReveal}
              revealUsed={reveals > 0}
              inputFx={gridFx.input ? { id: gridFx.id, key: gridFx.input } : null}
            />
          )}
        </Presence>

        {/* 解けた時の幕（CLEARED! とタイム）はやめた。ハンコを盤に押す（Hop が見本で選んだ案 C・2026-10-21） */}

        {/* Name Entry Modal for Ranking */}
        {resumeAsk !== null && (
          <div ref={resumeDialog} role="dialog" aria-modal="true" aria-labelledby="cw-resume-title" className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
            <Motion initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white p-6 max-w-sm w-full" style={{ boxShadow: C.modalShadow }}>
              <h2 id="cw-resume-title" className="text-xl font-bold mb-2" style={{ color: C.ink }}>{T.resume.title}</h2>
              <p className="text-sm mb-4" style={{ color: C.secondary }}>{T.resume.body(clock(resumeAsk))}</p>
              <div className="flex gap-2">
                <button onClick={handleResumeRestart} className="flex-1 py-2 bg-surface-container-high hover:bg-surface-container-highest transition-colors" style={{ color: C.secondary }}>
                  {T.resume.restart}
                </button>
                <button data-autofocus="" onClick={() => setResumeAsk(null)} className="flex-1 py-2 bg-primary hover:bg-secondary text-white font-bold transition-colors">
                  {T.resume.cont}
                </button>
              </div>
            </Motion>
          </div>
        )}

        {showNameEntry && clearTime !== null && (
          <NameEntryModal clearTime={clearTime} onSubmit={handleSubmitScore} onSkip={handleSkipScore} />
        )}

        {showContact && <ContactModal onClose={() => setShowContact(false)} initialTool="crossword" puzzleId={puzzleId} />}
        {showRequest && <ContactModal onClose={() => setShowRequest(false)} initialTool="crossword" initialKind="request" />}

        {/* 練習問題の案内（自由に解く間は出さない） */}
        {isTutorial && tutStep !== null && tutorialSteps[tutStep] && (
          <CoachMarks
            step={tutorialSteps[tutStep]}
            stepKey={tutStep}
            onNext={tutorialNext}
            onSkip={endTutorial}
            skipLabel={T.tutorial.skip}
            nextDefaultLabel={T.tutorial.next}
          />
        )}

        <Footer bottomGap={!isCleared && !showCloseup} />
      </div>
    );
  }

  // 問題を読み込んでいる間は、ギャラリーと同じ「読み込み中…」を出す（作る画面は出さない。2026-10-26 前は真っ白だった）。
  // 10秒待っても来なければ、待っている事と次にする事を出す（来れば問題を出す）
  if (isPlayerMode && loadState === "loading") {
    return (
      <div className="min-h-screen bg-surface">
        <div data-solve-loading={slowLoad ? "slow" : ""} role="status" className="flex items-center justify-center py-20 px-4">
          {slowLoad ? (
            <p className="text-sm text-center [text-wrap:balance]" style={{ color: C.secondary }}>{T.loadSlow}</p>
          ) : (
            <>
              <div className="w-6 h-6 border-2 border-black border-t-transparent motion-safe:animate-spin" />
              <span className="ml-3" style={{ color: C.secondary }}>{T.loading}</span>
            </>
          )}
        </div>
      </div>
    );
  }

  // 作る画面（案A「作る｜試す」・create/CreatePage.tsx）。問題を読み込めなかった時も今までどおり作る画面を出す（その時は下書きを読まない・書かない）。
  // 「試す」はこの画面の部品をそのまま使う（作る画面がこの画面を読み込むと互いに読み込み合うので、描き方だけを渡す）
  return <CreatePage draftEnabled={!isPlayerMode} renderTrial={(t) => <CrosswordPage trial={t} />} />;
}
