// クロスワード（作る画面 /crossword/create・解く画面 /crossword/:id）。
// HarmonyPalette の src/pages/PuzzleBuilderPage.tsx を土台にした移植。構造・並び・動き・文言・数値は HarmonyPalette のまま。
// 変えた所: 見た目（docs/DESIGN.md）、アイコン（Material Symbols）、動き（framer-motion を使わず同じ式で再現）、
// 知らせ（react-hot-toast を使わず自前）、保存先（Supabase）、持ってこない物（広告・Cookie 同意・コード進行・計測・ランキング等）、
// 足した物（ジャンル・タグ・ヒント・カタカナの ゛゜小）。
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import ContactModal from "@/components/ContactModal";
import { usePageReady } from "../../lib/pageReady";
import { buildGrid, generateMonteCarloSteps, createPuzzleSearch, isBetterPlacement, isConnected, moveItem, validatePlacement } from "../../lib/crossword/engine";
import { suggestForBoard, guideTexts } from "../../lib/crossword/suggest";
import type { PuzzleData, PuzzleItem, PlacedItem } from "../../lib/crossword/types";
import { isUsableCell, toCells, UNUSABLE_KANA } from "../../lib/crossword/cells";
import { toLargeKana } from "../../../functions/_shared/crosswordKana";
import { determineNextSelection } from "../../lib/crossword/puzzleSelectionLogic";
import {
  addMyPuzzle,
  catalogVideoIdsPresent,
  fetchOwnedPuzzle,
  isCatalogVideo,
  isHiddenPuzzle,
  loadPuzzle,
  makeOwnerKey,
  readMyPuzzles,
  savePuzzle,
  SaveError,
  toBody,
  updatePuzzle,
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
import { FitGrid } from "./components/FitGrid";
import { MovableBoard, MOVE_MARGIN } from "./components/MovableBoard";
import { Motion, Presence } from "./components/Motion";
import { useDialog } from "./components/useDialog";
import { radioKeyDown, radioTabIndex } from "./components/radioKeys";
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
import { checkPlay, revealCell, startPlay, touchPlay, PlayError } from "../../lib/crossword/play";
import { CoachMarks, type CoachStep } from "./components/CoachMarks";
import { tutorialPuzzle, TUTORIAL_HINTS } from "../../lib/crossword/tutorial";
import { C } from "./style";

// localStorage の鍵（crossword 専用の名前）
const HELP_KEY = "crossword_seen_help";
// 「初めて」の印（Hop 決定 2026-10-05「止めない・読ませない・その場で1行」）。場面ごとに別々に持つ
// 解く画面の最初のマスの脈打ちと1行（マスを押したら付ける）
const FIRST_CELL_KEY = "crossword_seen_first_cell";
// 作る画面の札（× で消したら付ける）
const TIP_KEYS = {
  cross: "crossword_seen_tip_cross", // 最初の語を追加した直後
  move: "crossword_seen_tip_move", // 2語目が交差して組まれた直後
  saved: "crossword_seen_tip_saved", // 共有の窓の中
} as const;
type TipName = keyof typeof TIP_KEYS;
// 「?」から開く任意の案内を終えた印（作る画面・練習問題。自動では開かないので、開いた記録として持つだけ）
const CREATE_GUIDE_KEY = "crossword_seen_create_guide";
const TUTORIAL_KEY = "crossword_seen_tutorial";
// 練習問題の住所（棚に入れずコードの中に持つ）
const TUTORIAL_PATH = "/crossword/tutorial";
// 練習問題のハンコが薄れるまで（「本番へ」が読めるように。2026-10-06 任天堂シミュで決定）【仮】
const TUTORIAL_STAMP_FADE_MS = 2000;
const PROGRESS_PREFIX = "crossword_progress_";
const PLAYED_PREFIX = "crossword_played_";
// 前回の続きを開いた時に「続きから／最初から」を聞くのは、前回から30分以上空いた時だけ（Hop 決定 2026-10-04）
const RESUME_ASK_MS = 30 * 60 * 1000;
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

// 作りかけの問題（作る画面の入力）。読み直しやブラウザを閉じても消えないよう、変えるたびに端末に残す（Hop 依頼 2026-10-03）
const DRAFT_KEY = "crossword_draft";
interface Draft {
  title: string;
  creatorName: string;
  genre: Genre;
  tags: string[];
  isBeginner: boolean;
  items: PuzzleItem[];
  hints: Record<string, HintRef>;
  input: { q: string; a: string };
}

// 文言（HarmonyPalette の ja.json の puzzle.builder から。問題文の呼び名は「ヒント」→「カギ」）
const T = {
  pageTitle: "クロスワードパズル作成",
  createNew: "新規作成",
  puzzleTitle: "題名",
  titlePlaceholder: "例：音楽なぞなぞチャレンジ！",
  creatorName: "作った人の名前（任意）",
  creatorNamePlaceholder: "空欄なら「名無し」",
  answer: "答え",
  clue: "カギ",
  cluePlaceholder: "例：ニャーと鳴く動物",
  answerPlaceholder: "ネコ",
  addToList: "リストに追加",
  reshuffle: "再シャッフル",
  saving: "保存中…",
  share: "共有する",
  close: "閉じる",
  howToPlay: "遊び方",
  howToCreate: "パズルの作り方", // 作る画面の「?」の説明（2026-10-06 Hop 決定）
  anonymous: "名無し", // 作成者名が空の時（2026-10-06 Hop 決定）
  previewTitle: "プレビュー",
  previewSubtitle: "答えとカギを追加すると、ここに盤が組み上がります。",
  errors: {
    noTitle: "題名を入力してください。",
    loadFailed: "問題の読み込みに失敗しました。",
    puzzleHidden: "この問題は非表示になっています。",
    loadError: "この問題を読み込めませんでした。URL をご確認ください。",
    saveFailed: "問題の保存に失敗しました。",
  },
  // 受付係が断った理由ごとの知らせ。ここに無い理由は errors.saveFailed
  saveReasons: {
    too_many: "保存が集中しています。時間をおいてもう一度お試しください。",
    verification: "確認に失敗しました。ページを再読み込みしてお試しください。",
    video: "ハロプロのヒントに使える YouTube は、HELLO! VIDEO に載っている動画だけです。",
    bad_request: "内容をご確認のうえ、もう一度お試しください。",
  } as Record<string, string>,
  // 答え合わせ・1文字見るを受付係に頼めなかった時（2026-10-04。答えを渡さない作りで足した）
  network: "通信できませんでした。もう一度お試しください。",
  // 前回の続きを開いた時（Hop 決定 2026-10-04）
  resume: {
    title: "前回の続きがあります",
    body: (t: string) => `タイムは始めた時から数えています（${t}）。`,
    cont: "続きから", // Hop 決定 2026-10-06
    restart: "最初から", // Hop 決定 2026-10-06
  },
  tooMany: "操作が続いています。少し待ってからもう一度お試しください。", // Hop 決定 2026-10-06
  // 解いている途中に問題が隠された・消された時／回を始める人が多すぎる時（Hop 決定 2026-10-04）
  puzzleGone: "この問題は非表示になったか、消されました。",
  busy: "混み合っています。少し待ってからもう一度お試しください。",
  // 自分が作った問題
  myPuzzles: {
    title: "自分が作った問題",
  },
  // 保存した問題の組み直し（Hop 決定 2026-10-05）。文言はすべて【仮】
  // 動かして固定した語（Hop 決定 2026-10-05・案A）
  pins: {
    release: "固定を外す", // 【仮】
    // 固定した語どうしが1つにつながらない盤（2026-10-06 レビューの直し）【仮】
    notConnected: "固定した語がつながっていません。固定を外すか、語を足してください。",
  },
  // 「リストに追加」が押せない理由（2026-10-06 任天堂シミュで決定・Hop「いいと思う」）【仮】
  addReason: {
    hello: "ヒントの動画を選ぶと追加できます。",
    other: "ヒントの URL を入れると追加できます。",
  } as Record<Genre, string>,
  // カギが空のままでは追加できない理由
  addReasonClue: "カギを入れると追加できます。",
  // ヰ・ヱ を断る知らせ（2026-10-06 レビューの直し）【仮】
  unusableKana: "「ヰ」「ヱ」は使えません。",
  // 解き終えた画面のヒントの動画の一覧を開くボタン（2026-10-06 任天堂シミュで決定）【仮】
  showHintVideos: (genre: Genre | null) => (genre === "other" ? "ヒントを見る" : "ヒントの動画を見る"),
  edit: {
    pageTitle: "クロスワードパズルの組み直し", // 【仮】
    update: "更新する", // 【仮】
    heading: "組み直し", // 入力欄の上の小見出し【仮】
    notEditable: "この問題は組み直せません。", // 【仮】
    alreadyPlayed: "もう遊ばれているので組み直せません。", // 【仮】
  },
  shareModal: {
    modalTitle: "問題を共有",
    shareLink: "共有リンク",
    postToX: "Xに投稿",
    publicNotice: "この問題を公開しました。誰でも遊べます。",
    updatedNotice: "この問題を更新しました。URL は変わりません。", // 組み直しの後（2026-10-06 Hop 決定）
  },
  creatorHelp: {
    title: "パズルの作り方",
    steps: [
      { title: "答え・カギ・ヒントを入力", description: "「答え」に語を、「カギ」にその語を当てるための問題文を書きます。「ヒント」には答えの根拠を添えます。ハロプロは HELLO! VIDEO の動画を検索して選びます。その他は URL を貼ります。" },
      { title: "リストに追加", description: "入力したら「リストに追加」ボタンを押します。5〜10語がおすすめです。" },
      { title: "問題を自動生成", description: "語を追加すると、クロスワードが自動で組み上がります。別の形にしたいときは「再シャッフル」。固定した語は動きません。" },
      { title: "保存・共有", description: "題名を入力して「共有する」を押すと、共有 URL が発行されます。SNS で共有して、みんなに遊んでもらいましょう！" },
    ],
    tipsTitle: "コツ",
    tips: [
      "共通の文字を持つ語を選ぶと、問題が組みやすくなります。",
      "短い語と長い語を混ぜると、バランスの良い問題になります。",
      "カギは簡単なものから難しいものまで、さまざまな難易度があるとより楽しめます。",
    ],
    // 2026-10-05 に足した物の説明（Hop 決定・案B）。文言はすべて【仮】
    moreTitle: "ほかにできること", // 【仮】
    more: [
      "答えはカタカナになります。ひらがなはカタカナに、小さい字（ッ・ャ など）は大きい字になります。漢字・数字・英字・記号は使えません。",
      "語が3つ以上になると、盤の下に「型の案内」が出ます。次に足すと盤に入る語の形がわかります。",
      "盤の語は長押しで動かせます。動かした語は固定され、「再シャッフル」しても動きません。「固定を外す」を押すと、すべての語を並べ直します。",
      "作りかけは、この端末に自動で残ります。閉じても続きから作れます。",
      "作った問題は「自分が作った問題」にあります。遊ばれる前なら組み直せます。",
      "「自分が作った問題」の合言葉で、作った問題を別の端末へ引き継げます。",
    ],
    guide: "案内を見る", // 【仮】
    request: "要望を送る", // 【仮】
    close: "閉じる",
  },
  // 段階2b で足した物
  stage2b: {
    toList: "パズルギャラリー",
    beginner: BEGINNER_LABEL,
    // 選ぶと得をすることを先に言う（任天堂のデザイナー視点のシミュレーションで決定・2026-10-03）
    detected: (groups: string[]) => `ハロプロのメンバー名・グループ名が入っています（${groups.join("、")}）。ハロプロにすると、ギャラリーの「ハロプロ」に並びます。`,
    toHello: "ハロプロにする",
    scoreFailed: "記録を保存できませんでした。", // HarmonyPalette と同じ文言
    scoreQueued: "通信できなかったので、記録はこの端末に預かりました。つながったら自動で送ります。", // HarmonyPalette と同じ文言
  },
  playerHelp: {
    title: "遊び方",
    steps: ["空欄のマスに文字を入力", "カギを参考に正解を推測", "最後のマスを埋めると自動で答え合わせ"],
    start: "始める！",
    createdBy: (name: string) => `作った人：${name}`, // 2026-10-06 Hop 決定
    // 練習問題の入口は「?」から開いた遊び方の窓だけ（Hop 決定 2026-10-05）
    practice: "練習する", // 【仮】
    request: "要望を送る", // 「?」の窓から問い合わせの窓を種類「要望」で開く（Hop 決定 2026-10-06）【仮】
    // 初めて解く時、盤のすぐ下の1行（最初のマスの脈打ちと一緒に出す）
    firstCell: "マスを押すと字が入ります", // 【仮】
  },
  // 練習問題の案内（Hop 決定 2026-10-05・案B）。文言はすべて【仮】
  tutorial: {
    toReal: "本番へ", // 【仮】
    next: "次へ", // 【仮】
    skip: "とばす", // 【仮】
    close: "閉じる",
    // 案内は2段だけ（Hop 決定 2026-10-05）
    cell: ["左上のマスを押してみましょう。"],
    keypad: ["文字盤で字を入れると、次のマスへ進みます。"],
  },
  // 作る画面の札（場面が初めて来た時に1回だけ・1行・幕なし。Hop 決定 2026-10-05）。文言はすべて【仮】
  tips: {
    cross: "もう1語足すと、同じ字で交差して組まれます。",
    move: "盤の語は長押しで動かせます。",
    saved: "作りかけはこの端末に自動で残ります。作った問題は「自分が作った問題」から組み直せます。",
    close: "閉じる",
  },
  // 作る画面の案内（Hop 決定 2026-10-05・案B）。文言はすべて【仮】
  createGuide: {
    answer: ["答えはひらがなかカタカナで。小さい字は大きい字になります。", "例：ネコ"],
    clue: ["カギは、答えを当てるための問題文です。", "例：ニャーと鳴く動物"],
    hint: ["ヒントは答えの根拠です。ハロプロは HELLO! VIDEO の動画から検索、その他は URL を貼ります。"],
    add: ["「リストに追加」を押します。"],
    board: ["ここに盤が組み上がります。"],
    second: ["もう1語足してみましょう。同じ字を持つ語どうしは、交差して組まれます。", "例：コアラ（カギ：ユーカリの葉を食べる動物）"],
    shape: ["語が3つ以上になると、盤の下に「型の案内」が出ます。次に足すと盤に入る語の形がわかります。"],
    move: ["盤の語は長押しで動かせます。動かした語は固定され、「再シャッフル」しても動きません。", "「固定を外す」を押すと、すべての語を並べ直します。"],
    title: ["最後に題名を入れます。"],
    share: ["「共有する」で保存すると公開され、誰でも遊べるようになります。"],
    mine: ["作りかけは、この端末に自動で残ります。", "作った問題は「自分が作った問題」から組み直せます。"],
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

const hintSummary = (h?: HintRef) => (!h ? "" : h.kind === "youtube" ? `YouTube ${formatTime(h.startSec)}` : h.url);

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
  // 文字は16px。iPhone は16pxより小さい入力欄を押すと画面を拡大するため（Hop 依頼 2026-10-03）
  "w-full bg-surface-container-low px-3 py-2 text-base text-on-surface placeholder:text-outline focus:outline-none focus:bg-white focus:shadow-[inset_0_-2px_0_#000]";

const Input = ({ id, value, onChange, placeholder, className, maxLength, onKeyDown }: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  maxLength?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) => (
  <input
    id={id}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const isDebugMode = searchParams.get("debug") === "true"; // デバッグモード
  const navigate = useNavigate();
  // 練習問題（/crossword/tutorial）。答え合わせはブラウザの中だけ・回を数えない・ランキングと X 投稿と通報を出さない
  const isTutorial = useLocation().pathname === TUTORIAL_PATH;
  // 練習の後に戻る問題の番号（?from=）
  const fromParam = searchParams.get("from");
  const tutorialFrom = isTutorial && fromParam && /^[A-Za-z0-9_-]{1,64}$/.test(fromParam) ? fromParam : null;
  const isPlayerMode = !!puzzleId || isDebugMode || isTutorial;
  // 組み直し（/crossword/create?edit=<番号>。Hop 決定 2026-10-05）。
  // checking = 中身を受け取り中、editing = 組み直し中（下書きに書かない・読まない【仮】）、none = 普通の作る画面
  const editParam = isPlayerMode ? null : searchParams.get("edit");
  const [editStatus, setEditStatus] = useState<"none" | "checking" | "editing">(editParam ? "checking" : "none");
  const [editTarget, setEditTarget] = useState<MyPuzzle | null>(null);
  const editStartedRef = useRef(false);

  // Editor State
  const [puzzleTitle, setPuzzleTitle] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [genre, setGenre] = useState<Genre>("hello"); // 最初の選択
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
  // 作りかけを戻し終わるまで残す処理を止めておく（戻す前の空の状態で上書きしないため）
  const [draftReady, setDraftReady] = useState(false);
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

  // タイマー関連
  const [startTime, setStartTime] = useState<number | null>(null);
  const [clearTime, setClearTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [gamePhase, setGamePhase] = useState<"ready" | "playing" | "cleared">("ready");
  const restoredElapsedRef = useRef(0); // デバッグ用の見本の問題だけで使う
  // 解いている回（/api/crossword-play）。localStart はこの端末の時計で回を始めた時刻。タイマーはここから壁時計で進む
  // （タイムは受付係の時計で「始めてから解けるまで」。画面を隠している間も進む。Hop 決定 2026-10-04）
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
  // 解き終えた画面のヒントの動画の一覧（畳んである）
  const [showHintVideos, setShowHintVideos] = useState(false);

  // UI States
  const [showHelp, setShowHelp] = useState(false);
  // 初めて開いた時の遊び方の窓か（その時は「始める！」だけ。「練習する」は「?」から開いた時だけ）
  const [helpFirst, setHelpFirst] = useState(false);
  // 練習問題の案内の段。0 = マスを押す、1 = 文字盤、null = 終わり（あとは案内なしで解く）
  const [tutStep, setTutStep] = useState<number | null>(isTutorial ? 0 : null);
  // 解く画面の最初のマスの脈打ちと1行（記録が空の端末だけ。マスを押したら消えて二度と出ない）
  const [firstCellHint, setFirstCellHint] = useState(() => !isTutorial && !lsGet(FIRST_CELL_KEY));
  // 作る画面の札。× で消した札（端末の記録と、この画面で消した物）
  const [tipsSeen, setTipsSeen] = useState<Record<TipName, boolean>>(() => ({
    cross: !!lsGet(TIP_KEYS.cross),
    move: !!lsGet(TIP_KEYS.move),
    saved: !!lsGet(TIP_KEYS.saved),
  }));
  const dismissTip = (name: TipName) => {
    lsSet(TIP_KEYS[name], "1");
    setTipsSeen((prev) => ({ ...prev, [name]: true }));
  };
  // 作る画面の案内の段（null = 出していない）。guideBaseRef は段に入った時の語の数（追加で進む段に使う）
  const [createGuide, setCreateGuide] = useState<number | null>(null);
  const guideBaseRef = useRef(0);
  const [showClearAnimation, setShowClearAnimation] = useState(false);
  const [showCreatorHelp, setShowCreatorHelp] = useState(false);
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

  // Share Modal
  const [showShareModal, setShowShareModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [sharedTitle, setSharedTitle] = useState("");
  const [showSaveCheck, setShowSaveCheck] = useState(false); // 保存の直前の Turnstile

  // 自分が作った問題（この端末の localStorage）
  const [myPuzzles, setMyPuzzles] = useState<MyPuzzle[]>(() => (isPlayerMode ? [] : readMyPuzzles()));

  // 窓のキーボードと読み上げの作法（2026-10-06 アクセシビリティの直し）。
  // 前回の続きは、どちらかを選んでもらう窓なので Esc では閉じない【仮】
  const helpDialog = useDialog({ active: showHelp, onClose: () => closeHelp() });
  const resumeDialog = useDialog({ active: resumeAsk !== null, closeOnEsc: false });
  const shareDialog = useDialog({ active: showShareModal, onClose: () => setShowShareModal(false) });
  const creatorHelpDialog = useDialog({ active: showCreatorHelp, onClose: () => setShowCreatorHelp(false) });

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

  // --- Initialization ---
  useEffect(() => {
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
        // ハロプロのジャンルは、台帳から消えた動画のヒントに印を付ける（見られなくなりましたと出す。Hop 決定 2026-10-04）
        if (loadedGenre === "hello") {
          const hints = loaded.hints;
          const ids = Array.from(new Set(Object.values(hints).flatMap((h) => (h.kind === "youtube" ? [h.videoId] : []))));
          catalogVideoIdsPresent(ids)
            .then((present) => {
              if (!alive || ids.every((id) => present.has(id))) return;
              setPlayerHints(Object.fromEntries(Object.entries(hints).map(([k, h]) => [k, h.kind === "youtube" && !present.has(h.videoId) ? { ...h, gone: true } : h])));
            })
            .catch((err) => console.warn("Failed to check hint videos:", err));
        }
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
              if (Number.isInteger(parsed.reveals) && parsed.reveals >= 0) setReveals(parsed.reveals);
              const pl = parsed.play;
              if (pl && typeof pl.token === "string" && typeof pl.localStart === "number") {
                playRef.current = { token: pl.token, localStart: pl.localStart };
                const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
                if (Date.now() - savedAt >= RESUME_ASK_MS && Object.keys(parsed.userAnswers).length > 0) {
                  setResumeAsk(Math.max(0, Math.floor((Date.now() - pl.localStart) / 1000)));
                }
              }
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
  }, [puzzleId, isDebugMode, isTutorial]);

  // キューイングされたスコアの再送信（ネットワーク回復時。HarmonyPalette と同じ）
  useEffect(() => {
    if (isTutorial) return; // 練習問題では受付係に何も送らない
    const retry = () => {
      retryQueuedScores().catch((e) => console.error("[Score Queue] Error processing queue:", e));
    };
    retry();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 型の案内（Hop 決定 2026-10-05・段階2）。組み上がった盤が変わった時だけ計算する。置かれた語が3つ未満では空
  // 置けなかった語があれば、語ごとにその語が入る型を1行ずつ（入力順）
  const shapeGuide = useMemo(
    () =>
      generatedPuzzle
        ? guideTexts(suggestForBoard(generatedPuzzle.items, editorItems.filter((i) => !generatedPuzzle.items.some((p) => p.id === i.id))))
        : [],
    // 盤が組み上がった時だけ計算する（語を足した直後の、組み立て前の一覧では計算しない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generatedPuzzle]
  );

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

  // 初回ヘルプ表示判定 + タイマー自動開始（遊び方を読んだことがあれば、問題が出たらすぐ始める）
  useEffect(() => {
    if (isPlayerMode && playerPuzzle) {
      // 練習問題は遊び方の窓を出さず、タイマーも動かさずに始める
      if (isTutorial) {
        if (gamePhase === "ready") setGamePhase("playing");
        return;
      }
      const hasSeenHelp = lsGet(HELP_KEY);
      if (!hasSeenHelp) {
        setHelpFirst(true);
        setShowHelp(true);
      } else if (gamePhase === "ready" && resumeAsk === null) {
        beginTiming();
      }
    }
  }, [isPlayerMode, playerPuzzle, gamePhase, resumeAsk]); // eslint-disable-line react-hooks/exhaustive-deps

  // 最初から: 入れた字を消して、新しい回として始める
  const handleResumeRestart = () => {
    setUserAnswers({});
    setReveals(0);
    playRef.current = null;
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
  }, [isPlayerMode, playerPuzzle, isCleared, showCloseup, activeCell, currentWordDirection, activeWordItem, userAnswers]);

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

  // 回を始める。続きの回（端末に番号が残っている）ならその時刻から、無ければ受付係に新しく始めてもらう
  const beginTiming = () => {
    setGamePhase("playing");
    if (isTutorial) return; // 練習問題は時間を測らない
    if (isDebugMode) {
      setStartTime(Date.now() - restoredElapsedRef.current * 1000);
      return;
    }
    if (playRef.current) {
      setStartTime(playRef.current.localStart);
      return;
    }
    setStartTime(Date.now());
    void ensurePlay();
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
        setStartTime(localStart);
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
    setActiveWordItem(item);
    setCurrentWordDirection(item.direction);
    setActiveCell({ x: item.startX, y: item.startY });
    setActiveCloseupIndex(0);
    setShowCloseup(true);
  };

  // セルをタップ → そのセルを含むワードでクローズアップモーダルを開く
  const openCloseupForCell = (x: number, y: number) => {
    if (!playerPuzzle || isCleared) return;
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

  // 1文字見る: 入力カードで選んでいるマスに正しい字を入れる（Hop 決定 2026-10-04）。もう正しい字が入っていれば数えない
  // 字は受付係から受け取る（答えはブラウザに無い）。同じマスを2度見ても数は増えない
  const handleReveal = async () => {
    if (!activeWordItem || isCleared) return;
    const index = activeCloseupIndex;
    if (isDebugMode || isTutorial) {
      setReveals((r) => r + 1);
      handleCloseupKeyPress(activeWordItem.answer[index]);
      return;
    }
    const [x, y] = closeupCellKey(index).split(",").map(Number);
    try {
      const r = await withPlay((token) => revealCell(token, x, y));
      setReveals(r.reveals);
      setUserAnswers((prev) => ({ ...prev, [`${x},${y}`]: r.char }));
      if (index < activeWordItem.length - 1) setActiveCloseupIndex(index + 1);
    } catch (err) {
      console.warn("Failed to reveal:", err);
      toast.error(playErrorOf(err));
    }
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
  const handleCloseupModifyChar = (char: string, index: number = activeCloseupIndex) => {
    if (!activeWordItem || isCleared) return;
    const key = closeupCellKey(index);
    setUserAnswers((prev) => ({ ...prev, [key]: char.toUpperCase() }));
    // 1つ前の字に効かせた時は、今のマスはそのまま（すでに進んでいる）
    if (index === activeCloseupIndex && activeCloseupIndex < activeWordItem.length - 1) setActiveCloseupIndex((prev) => prev + 1);
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

  // タイマーUI更新（ページ離脱対応）
  useEffect(() => {
    // 画面を隠している間も止めない。ランキングのタイムは受付係の時計で同じように測るため（Hop 決定 2026-10-04。HarmonyPalette は隠している間止めていた）
    if (gamePhase !== "playing" || !startTime) return;
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startTime) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [gamePhase, startTime]);

  // 遊ばれた回数は、盤に最初の1文字が入ったときに1足す（Hop 決定 2026-10-04。開いただけでは数えない）。
  // 同じ端末では1つの問題につき1回だけ。作った本人の端末では数えない。失敗しても遊ぶのは止めない。
  // 数えるのは受付係（回ごとに1度・同じ接続元と問題は24時間に1度。外から回数を足す呼び出しは使えない）
  useEffect(() => {
    if (!playerPuzzle || isDebugMode || isTutorial || Object.keys(userAnswers).length === 0) return;
    const id = playerPuzzle.id;
    if (lsGet(`${PLAYED_PREFIX}${id}`)) return;
    if (readMyPuzzles().some((m) => m.id === id)) return;
    lsSet(`${PLAYED_PREFIX}${id}`, "1");
    withPlay((token) => touchPlay(token)).catch((err) => console.warn("Play count increment failed:", err));
  }, [userAnswers, playerPuzzle, isDebugMode, isTutorial]);

  // Persist Progress (including elapsed time)
  useEffect(() => {
    if (playerPuzzle && !isTutorial && gamePhase === "playing" && Object.keys(userAnswers).length > 0) {
      lsSet(`${PROGRESS_PREFIX}${playerPuzzle.id}`, JSON.stringify({ userAnswers, elapsedSeconds, reveals, play: playRef.current, savedAt: Date.now() }));
    }
  }, [userAnswers, playerPuzzle, elapsedSeconds, gamePhase, reveals, isTutorial]);

  // 解けたら端末の途中経過を消す。開き直すと新しい回で最初から（2026-10-06 レビューの直し）
  useEffect(() => {
    if (playerPuzzle && !isTutorial && gamePhase === "cleared") lsRemove(`${PROGRESS_PREFIX}${playerPuzzle.id}`);
  }, [playerPuzzle, gamePhase, isTutorial]);

  // --- 組み直し: 端末の控えの合言葉で中身を受け取り、入力欄と盤に戻す（Hop 決定 2026-10-05） ---
  // 控えに無い・受け取れない時は知らせて普通の作る画面にする（住所の ?edit= も外す）
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
      fail(T.edit.notEditable);
      return;
    }
    fetchOwnedPuzzle(mine.id, mine.key)
      .then((owned) => {
        if (!owned) return fail(T.edit.notEditable);
        if ((owned.puzzle.play_count ?? 0) > 0) return fail(T.edit.alreadyPlayed);
        const rec = owned.puzzle;
        const clues = rec.body?.clues;
        if (!Array.isArray(clues) || clues.length !== owned.answers.length) return fail(T.edit.notEditable);
        const placed: PlacedItem[] = clues.map((c, i) => ({
          id: `c${i}`,
          uuid: `c${i}`,
          question: c.clue,
          answer: owned.answers[i],
          direction: c.direction,
          startX: c.startX,
          startY: c.startY,
          length: owned.answers[i].length,
          clueIndex: c.clueIndex,
        }));
        const restoredHints: Record<string, HintRef> = {};
        clues.forEach((c, i) => {
          if (c.hint) restoredHints[`c${i}`] = c.hint;
        });
        setGenre(rec.genre);
        setPuzzleTitle(rec.title);
        setCreatorName(rec.body.creatorName ?? "");
        setTags(Array.isArray(rec.tags) ? rec.tags : []);
        setIsBeginner(rec.is_beginner === true);
        setHints(restoredHints);
        setEditorItems(placed.map(({ id, question, answer }) => ({ id, question, answer })));
        // 盤は保存した時の形のまま組む（番号も同じ）。組み替えたい時は「再シャッフル」
        const grid = buildGrid(placed);
        grid.title = rec.title;
        setGeneratedPuzzle(grid);
        setEditTarget({ ...mine, title: rec.title });
        setEditStatus("editing");
      })
      .catch((err) => {
        console.error("Failed to load own puzzle:", err);
        fail(T.edit.notEditable);
      });
  }, [editStatus, editParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- 作りかけを戻す・残す（作る画面だけ。組み直しの間は読まない・書かない【仮】） ---
  useEffect(() => {
    if (isPlayerMode || editStatus !== "none" || draftReady) return;
    const raw = lsGet(DRAFT_KEY);
    if (raw) {
      try {
        const d = JSON.parse(raw) as Partial<Draft>;
        if (typeof d.title === "string") setPuzzleTitle(d.title);
        if (typeof d.creatorName === "string") setCreatorName(d.creatorName);
        if (d.genre === "hello" || d.genre === "other") setGenre(d.genre);
        if (Array.isArray(d.tags)) setTags(d.tags);
        if (typeof d.isBeginner === "boolean") setIsBeginner(d.isBeginner);
        if (d.input && typeof d.input.q === "string" && typeof d.input.a === "string") setCurrentInput(d.input);
        // 語ごとに形を確かめ、答えは今の字そろえ（toCells）を通し直す。だめな語は捨てる（2026-10-06 レビューの直し）
        const items: PuzzleItem[] = [];
        const seen = new Set<string>();
        for (const raw of Array.isArray(d.items) ? (d.items as unknown[]) : []) {
          const it = raw as Partial<PuzzleItem> | null;
          if (!it || typeof it.id !== "string" || !it.id || seen.has(it.id) || typeof it.question !== "string") continue;
          if (!Array.isArray(it.answer) || !it.answer.every((c) => typeof c === "string")) continue;
          const answer = toCells(it.answer.join(""));
          if (answer.length === 0 || !answer.every(isUsableCell)) continue;
          seen.add(it.id);
          items.push({ id: it.id, question: it.question, answer });
        }
        if (d.hints && typeof d.hints === "object") {
          setHints(Object.fromEntries(Object.entries(d.hints as Record<string, HintRef>).filter(([id]) => seen.has(id))));
        }
        if (items.length > 0) {
          setEditorItems(items);
          triggerGeneration(items);
        }
      } catch {
        lsRemove(DRAFT_KEY);
      }
    }
    setDraftReady(true);
  }, [isPlayerMode, editStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isPlayerMode || !draftReady || editStatus !== "none") return;
    const empty = !puzzleTitle && !creatorName && tags.length === 0 && editorItems.length === 0 && !currentInput.q && !currentInput.a;
    if (empty) {
      lsRemove(DRAFT_KEY);
      return;
    }
    const d: Draft = { title: puzzleTitle, creatorName, genre, tags, isBeginner, items: editorItems, hints, input: currentInput };
    lsSet(DRAFT_KEY, JSON.stringify(d));
  }, [isPlayerMode, draftReady, editStatus, puzzleTitle, creatorName, genre, tags, isBeginner, editorItems, hints, currentInput]);

  // --- Editor Functions ---
  const handleAddItem = () => {
    if (!currentInput.a.trim() || !currentInput.q.trim() || !pendingHint) return;
    const answerParts = toCells(currentInput.a);
    // 答えはカタカナの文字盤で打てる字だけ（ひらがなはカタカナにそろう）
    if (answerParts.some((c) => UNUSABLE_KANA.test(c))) {
      toast.error(T.unusableKana, { duration: 5000 });
      return;
    }
    if (!answerParts.every(isUsableCell)) {
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
      question: currentInput.q.trim(),
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
  // 押しても欄の選ばれ方を変えない（2026-10-03「○を押すたびに入力が出入りする」）。
  // 欄を選んでいる最中なら文字の位置に、選んでいなければ末尾に入れる。キーボードは出し入れしない
  const insertMaru = () => {
    const el = clueInputRef.current;
    const q = currentInput.q;
    const active = !!el && document.activeElement === el;
    const start = active ? el.selectionStart ?? q.length : q.length;
    const end = active ? el.selectionEnd ?? q.length : q.length;
    const next = q.slice(0, start) + "○" + q.slice(end);
    setCurrentInput({ ...currentInput, q: next });
    if (!active) return;
    requestAnimationFrame(() => el.setSelectionRange(start + 1, start + 1));
  };

  const handleRemoveItem = (itemId: string) => {
    const newItems = editorItems.filter((i) => i.id !== itemId);
    setEditorItems(newItems);
    if (itemId === editingId) resetItemInput();
    triggerGeneration(newItems);
  };

  // 裏の探索を1回の刻みで回す長さ（ミリ秒）。描き変えの100msの合間に収める
  const SEARCH_STEP_MS = 30;

  // v4 Live Generation: Monte Carlo式・全50試行アニメーション
  // 動かして固定した語を、今の語の一覧に合わせて持ち越す（消した語の固定は外す。答えを直した語は新しい答えで、
  // 置けなくなった固定は外す）。Hop 決定 2026-10-05・案A
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

  // 盤の語を指で動かした時。置けたら固定の印を付けて盤を組み直さずに置く
  const handleMoveWord = (uuid: string, startX: number, startY: number): boolean => {
    if (!generatedPuzzle || isLiveGenerating) return false;
    const moved = moveItem(generatedPuzzle.items, uuid, startX, startY);
    if (!moved) return false;
    const prev = generatedPuzzle;
    setGeneratedPuzzle({ ...buildGrid(moved), id: prev.id, title: prev.title, creatorName: prev.creatorName });
    return true;
  };

  const triggerGeneration = async (items: PuzzleItem[], isReshuffle: boolean = false, pinsOverride?: PlacedItem[]) => {
    const pinned = pinsOverride ?? carryPins(items);
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
      const generator = generateMonteCarloSteps(items, 50, pinned);
      // 演出の50回とは別に、裏で本気の探索を回す（Hop 決定 2026-10-05）。描き変えの合間に刻んで回し、画面を固めない
      const search = createPuzzleSearch(items, undefined, undefined, pinned);
      let bestPuzzle: PuzzleData | null = null;
      let bestCount = 0;
      let bestArea = Infinity;

      for (const step of generator) {
        const tickStart = performance.now();
        search.step(SEARCH_STEP_MS);
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

        // Animation wait: 100ms per attempt = 5 seconds total（裏の探索に使った分を差し引く）
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, 100 - (performance.now() - tickStart))));
      }

      // 演出が終わっても探索が終わっていなければ、時間の上限まで刻んで続ける
      while (!search.finished()) {
        if (generationIdRef.current !== currentGenId) return;
        search.step(SEARCH_STEP_MS);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (generationIdRef.current !== currentGenId) return;
      const found = search.best();
      if (found.length > 0 && isBetterPlacement(found, search.bestArea(), bestPuzzle ? bestPuzzle.items : null, bestArea)) {
        const puzzle = buildGrid(found);
        puzzle.title = puzzleTitle.trim() || "Generated Puzzle";
        bestPuzzle = puzzle;
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
    // 保存の数の上限は受付係だけが持つ（画面の「1日5個まで」は外した。2026-10-06）
    // 固定した語どうしがつながらない盤は保存しない（ボタンも押せないが、念のため）
    if (!isConnected(generatedPuzzle.items)) return;

    // --- Title Check ---（いま欄に入っている題名で確かめる）
    const title = puzzleTitle.trim();
    if (!title) {
      toast.error(T.errors.noTitle);
      return;
    }

    // --- Quality Guard ---
    if (generatedPuzzle.items.length < 2) {
      toast.error("保存するには、語を2つ以上追加してください。");
      return;
    }
    const intersectionCount = generatedPuzzle.cells.filter((c) => c.horizontalItemId && c.verticalItemId).length;
    if (intersectionCount < 1) {
      toast.error("語どうしが交差していないと保存できません。同じ字を含む語を足してみてください。", { duration: 5000 });
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
    // 組み直しは人間確認を挟まない【仮】（合言葉が本人確認を兼ねる）
    if (editTarget) {
      void updateEdited();
      return;
    }
    // 保存の直前に人間かどうかを確かめる。済んだら saveWithToken へ続く
    setShowSaveCheck(true);
  };

  // 組み直した問題で書き換える。成功したら共有の窓（URL は同じ）を出す
  const updateEdited = async () => {
    if (!generatedPuzzle || !editTarget) {
      setIsSaving(false);
      return;
    }
    const title = puzzleTitle.trim();
    try {
      const body = toBody(generatedPuzzle.items, generatedPuzzle.width, generatedPuzzle.height, (id) => hints[id]);
      if (creatorName.trim()) body.creatorName = creatorName.trim();
      const ogpImage = await drawShareImage(generatedPuzzle, title);
      await updatePuzzle(editTarget.id, editTarget.key, { title, genre, tags, body, isBeginner }, { ogpImage });
      const updated = { ...editTarget, title };
      setMyPuzzles(addMyPuzzle(updated));
      setEditTarget(updated);
      setShareUrl(`${window.location.origin}/crossword/${editTarget.id}`);
      setSharedTitle(title);
      setShowShareModal(true);
    } catch (error) {
      console.error("Failed to update puzzle:", error);
      const reason = error instanceof SaveError ? error.reason : "";
      const message =
        reason === "already_played" ? T.edit.alreadyPlayed : reason === "not_found" ? T.edit.notEditable : T.saveReasons[reason] ?? T.errors.saveFailed;
      toast.error(message, { duration: 5000 });
      // もう遊ばれていたら、普通の作る画面に戻す（Hop 決定 2026-10-05）。入力中の中身はそのまま残し、
      // 下書きを戻す処理は走らせずに、ここから下書きに書く（draftReady を先に立てる）
      if (reason === "already_played") {
        setDraftReady(true);
        setEditTarget(null);
        setEditStatus("none");
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("edit");
            return next;
          },
          { replace: true }
        );
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
      // 保存できたので作りかけの控えは消す（このあと入力を変えたら、また新しく残り始める）
      lsRemove(DRAFT_KEY);
    } catch (error) {
      console.error("Failed to save puzzle:", error);
      const reason = error instanceof SaveError ? error.reason : "";
      toast.error(T.saveReasons[reason] ?? T.errors.saveFailed, { duration: 5000 });
    } finally {
      setIsSaving(false);
    }
  };

  const chooseGenre = (g: Genre) => {
    if (genre === g) return;
    setGenre(g);
    setPendingHint(null);
    setHintResetKey((k) => k + 1);
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
  const handleClearCheck = async (silent = false) => {
    if (!playerPuzzle?.cells || isCleared) return;
    if (checking || checkingRef.current) {
      // 通信中に呼ばれた（盤が変わった）。通信の後に今の盤でもう一度丸付けする
      checkDirtyRef.current = true;
      return;
    }
    const full = playerPuzzle.cells.every((c) => !!userAnswers[`${c.x},${c.y}`]);
    if (!full) {
      if (!silent) toast.error("まだ埋まっていないマスがあります。", { duration: 4000 });
      return;
    }

    let allCorrect = false;
    let serverTime: number | null = null;
    if (isDebugMode || isTutorial) {
      // 練習問題とデバッグ用の見本は、ブラウザの中で答え合わせする（受付係を通さない）。小さい字は大きい字にそろえて比べる
      allCorrect = playerPuzzle.cells.every((c) => toLargeKana(userAnswers[`${c.x},${c.y}`] ?? "") === toLargeKana(c.value));
    } else {
      setChecking(true);
      checkingRef.current = true;
      checkDirtyRef.current = false;
      try {
        const r = await withPlay((token) => checkPlay(token, userAnswers));
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
        if (!silent) toast.error(playErrorOf(err));
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

    if (allCorrect) {
      // Stage 1: クリア演出開始
      setShowClearAnimation(true);
      setGamePhase("cleared");

      // Stage 2: タイム計算（500ms後）
      clearTimeRef.current = null;
      setTimeout(() => {
        // タイムは受付係の時計で測った物（デバッグ用の見本だけこの端末の時計）
        const timeSeconds = serverTime ?? (startTime ? Math.floor((Date.now() - startTime) / 1000) : null);
        if (timeSeconds !== null && puzzleId) {
          setClearTime(timeSeconds);
          clearTimeRef.current = timeSeconds;
        }
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
      if (!silent) toast.error("どこかに間違いがあります。", { duration: 4000 });
    }
  };

  // 最後の空きマスが埋まったら、答え合わせのボタンを押さなくても答え合わせをする（Hop 依頼 2026-10-04。HarmonyPalette には無い）。
  // 埋まった瞬間は、合っていても間違っていても答え合わせと同じ反応を返す。埋まったまま直している間は黙って見て、全部合った時だけ終える。
  // 保存してあった盤を開き直しただけでは始めない（最初の1回は今の状態を覚えるだけ）
  // 埋まった瞬間の丸付けも、黙る方と同じだけ待ってから走らせる。その間に ゛゜ で字が変われば、変わった後の盤で丸付けする
  // （最後のマスが濁る字の時に、゛ の前に答え合わせが走らないように。2026-10-06 レビューの直し）。待ちの間は入力の窓を閉じない
  const AUTO_CHECK_WAIT_MS = 400; // 【仮】
  // loud = 埋まった瞬間の反応（合否を知らせる方）をまだ返していない
  const autoCheckRef = useRef<{ ready: boolean; full: boolean; loud: boolean }>({ ready: false, full: false, loud: false });
  useEffect(() => {
    if (!playerPuzzle?.cells || isCleared || gamePhase !== "playing") return;
    const full = playerPuzzle.cells.every((c) => !!userAnswers[`${c.x},${c.y}`]);
    const wasFull = autoCheckRef.current.full;
    autoCheckRef.current.full = full;
    if (!autoCheckRef.current.ready) {
      autoCheckRef.current.ready = true;
      return;
    }
    // 答え合わせの通信中に盤が変わったら、通信の後に今の盤でもう一度丸付けする
    if (checkingRef.current) {
      checkDirtyRef.current = true;
      return;
    }
    if (!full) {
      autoCheckRef.current.loud = false;
      return;
    }
    if (!wasFull) autoCheckRef.current.loud = true;
    // 打ち終わるのを少し待ってから丸付けする（1字ごとに通信しない）
    const timer = setTimeout(() => {
      const loud = autoCheckRef.current.loud;
      autoCheckRef.current.loud = false;
      if (loud) setShowCloseup(false); // 結果が盤の上で見えるように、拡大の窓は閉じる
      void handleClearCheck(!loud);
    }, AUTO_CHECK_WAIT_MS);
    return () => clearTimeout(timer);
  }, [userAnswers, playerPuzzle, isCleared, gamePhase]); // eslint-disable-line react-hooks/exhaustive-deps

  // 通信中に盤が変わっていた時の丸付けし直し（黙る方。今の盤で）
  useEffect(() => {
    if (recheckTick === 0) return;
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
        toast.error(T.stage2b.scoreFailed);
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

  // --- 作る画面の案内（Hop 決定 2026-10-05・案B。「?」の「案内を見る」からだけ開く） ---
  // 自動では開かない。「?」の窓の「案内を見る」からだけ（Hop 決定 2026-10-05）
  function startCreateGuide() {
    guideBaseRef.current = editorItems.length;
    setCreateGuide(0);
  }
  const endCreateGuide = () => {
    lsSet(CREATE_GUIDE_KEY, "1");
    setCreateGuide(null);
  };
  const answerOk = !!currentInput.a.trim() && toCells(currentInput.a).every(isUsableCell);
  const boardReady = !!generatedPuzzle && !isLiveGenerating;
  const addedSinceStep = editorItems.length > guideBaseRef.current;
  // done は「利用者の操作で次の段へ進む」段の終わりの印（「次へ」を出さない段）
  const createSteps: (CoachStep & { done?: boolean })[] = [
    { target: '[data-coach="create-answer"]', lines: T.createGuide.answer, canNext: answerOk },
    { target: '[data-coach="create-clue"]', lines: T.createGuide.clue, canNext: !!currentInput.q.trim() },
    { target: '[data-coach="create-hint"]', lines: T.createGuide.hint, canNext: !!pendingHint },
    // ヒント欄も穴に含める（YouTube を選ぶと欄の中にプレーヤーが出る。プレーヤーを幕で覆わない）
    { target: ['[data-coach="create-hint"]', '[data-coach="create-add"]'], lines: T.createGuide.add, showNext: false, done: addedSinceStep },
    { target: '[data-coach="create-board"]', lines: T.createGuide.board, canNext: boardReady },
    { target: '[data-coach="create-entry"]', lines: T.createGuide.second, showNext: false, done: addedSinceStep },
    { target: '[data-coach="create-board"]', lines: T.createGuide.shape, canNext: boardReady },
    { target: '[data-coach="create-board"]', lines: T.createGuide.move, canNext: boardReady },
    { target: '[data-coach="create-title"]', lines: T.createGuide.title },
    { target: '[data-coach="create-share"]', lines: T.createGuide.share, holeClickable: false },
    { target: '[data-coach="create-mine"]', lines: T.createGuide.mine, nextLabel: T.tutorial.close, holeClickable: false },
  ];
  const createNext = () => {
    if (createGuide === null) return;
    if (createGuide >= createSteps.length - 1) {
      endCreateGuide();
      return;
    }
    guideBaseRef.current = editorItems.length;
    setCreateGuide(createGuide + 1);
  };
  const createStepDone = createGuide !== null && !!createSteps[createGuide]?.done;
  useEffect(() => {
    if (createStepDone) createNext();
  }, [createStepDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const clueList = (dir: "horizontal" | "vertical") =>
    playerPuzzle!.items.filter((i) => i.direction === dir).sort((a, b) => (a.clueIndex || 0) - (b.clueIndex || 0));

  // 最初のマス（1番のカギの先頭）。脈打ちと1行は、始めた後・解く前・遊び方の窓が閉じている時だけ
  const firstCellPos = (() => {
    const first = playerPuzzle?.items.reduce<PlacedItem | null>((a, b) => (!a || (b.clueIndex ?? 1e9) < (a.clueIndex ?? 1e9) ? b : a), null);
    return first ? { x: first.startX, y: first.startY } : null;
  })();
  const showFirstCellHint = firstCellHint && !isTutorial && gamePhase === "playing" && !isCleared && !showHelp && resumeAsk === null && !!firstCellPos;

  // 作る画面の札（一度に1つまで）。2語目が交差して組まれたら「交差」の札は役目を終える
  const crossedBoard = !!generatedPuzzle && !isLiveGenerating && generatedPuzzle.items.length >= 2 && generatedPuzzle.cells.some((c) => c.horizontalItemId && c.verticalItemId);
  const boardTip: TipName | null = showShareModal || createGuide !== null
    ? null
    : crossedBoard
      ? tipsSeen.move
        ? null
        : "move"
      : !!generatedPuzzle && !isLiveGenerating && generatedPuzzle.items.length >= 1 && !tipsSeen.cross
        ? "cross"
        : null;
  useEffect(() => {
    if (boardTip === "move" && !tipsSeen.cross) dismissTip("cross");
  }, [boardTip]); // eslint-disable-line react-hooks/exhaustive-deps

  // 札（白い面・1行・右端に ×）
  const Tip = ({ name, tone = "white" }: { name: TipName; tone?: "white" | "low" }) => (
    <div data-tip={name} className={`${tone === "white" ? "bg-white" : "bg-surface-container-low"} pl-4 flex items-center gap-2 text-sm`} style={{ color: C.ink }}>
      <span className="flex-1 min-w-0 py-3">{T.tips[name]}</span>
      <button type="button" onClick={() => dismissTip(name)} aria-label={T.tips.close} className="w-11 h-11 shrink-0 flex items-center justify-center hover:bg-surface-container-high transition-colors" style={{ color: C.secondary }}>
        <Icon icon="close" />
      </button>
    </div>
  );

  // --- Render ---

  if (isPlayerMode && playerPuzzle) {
    return (
      <div className="min-h-screen bg-surface">
        <Toaster />
        {/* [No.01] Sticky Header - 60px固定 */}
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
                <span className="text-lg font-mono font-bold tabular-nums" style={{ color: C.ink }}>
                  {clock(elapsedSeconds)}
                </span>
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

        {/* [No.12] プログレスバー - ヘッダー直下 */}
        {gamePhase !== "ready" && (
          <div className="sticky top-[60px] z-20 bg-white">
            <div className="h-1 bg-surface-container-high">
              <div className="h-full transition-all duration-300 bg-primary" style={{ width: `${progressPercentage}%` }} />
            </div>
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
                        <p className="text-sm" style={{ color: C.ink }}>{s}</p>
                      </div>
                    ))}
                  </div>

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

          <div className="flex justify-center items-center gap-4 mb-8">
            <p className="text-center text-sm" style={{ color: C.secondary }}>クロスワードパズル</p>
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
                  {isCleared && <ClearEffect fadeAfterMs={isTutorial ? TUTORIAL_STAMP_FADE_MS : undefined} />}
                  <div className="w-full bg-white p-6 overflow-x-auto">
                    <FitGrid width={playerPuzzle.width} height={playerPuzzle.height} userScale={scale}>
                      <PuzzleGridRetro
                        data={playerPuzzle}
                        showSolution={isCleared}
                        userAnswers={userAnswers}
                        onCellChange={(cell, val) => handleCellChange(cell, val)}
                        activeCell={activeCell}
                        activeWordId={activeWordItem?.uuid ?? null}
                        onCellClick={(x, y) => openCloseupForCell(x, y)}
                        pulseCell={showFirstCellHint ? firstCellPos : null}
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
                        title="大きさを戻す"
                        aria-label="大きさを戻す"
                        style={{ color: C.ink }}
                      >
                        {(scale * 100).toFixed(0)}%
                      </button>
                    )}
                  </div>
                </div>

                {/* 解き終えた画面（2026-10-06 任天堂シミュで決定・Hop「いいと思う」）: ハンコの直下に「Xに投稿」→ 名前の窓の後のランキング
                    → ほかの問題 → 畳んだヒントの動画の一覧 */}
                {isCleared && (
                  <div data-cleared-block="">
                    {/* 解けたことをXに投稿 */}
                    {puzzleId && (
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
                    {puzzleId && (
                      <div className="mt-6">
                        <PuzzleRanking
                          puzzleId={puzzleId}
                          currentScore={clearTime ?? undefined}
                          refreshKey={rankingRefresh}
                        />
                      </div>
                    )}
                    {/* ほかの問題と一覧への入口 */}
                    {puzzleId && playerGenre && <OtherPuzzles genre={playerGenre} puzzleId={puzzleId} />}
                    {/* ヒントの動画の一覧（畳んである。押すと開く） */}
                    {Object.keys(playerHints).length > 0 &&
                      (showHintVideos ? (
                        <HintList items={playerPuzzle.items} hints={playerHints} genre={playerGenre} />
                      ) : (
                        <div className="text-center mt-6">
                          <button
                            type="button"
                            onClick={() => setShowHintVideos(true)}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-surface-container-high hover:bg-surface-container-highest transition-colors font-medium"
                            style={{ color: C.ink }}
                          >
                            {T.showHintVideos(playerGenre)}
                          </button>
                        </div>
                      ))}
                    {/* 作成モードへ戻るリンク（練習問題では出さない） */}
                    {!isTutorial && (
                      <div className="text-center mt-4">
                        <Link
                          to="/crossword/create"
                          className="inline-flex items-center gap-2 px-6 py-3 bg-surface-container-high hover:bg-surface-container-highest transition-colors font-medium"
                          style={{ color: C.ink }}
                        >
                          <Icon icon="add" />
                          {T.createNew}
                        </Link>
                      </div>
                    )}
                  </div>
                )}

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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8 bg-surface-container-low p-6">
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

                {/* 練習問題には作成者がいないので、著作権の注意と通報は出さない */}
                {!isTutorial && (
                <div className="text-center mt-8 text-xs" style={{ color: C.secondary }}>
                  ※作成された問題の著作権および責任は作成者に帰属します。
                </div>
                )}

                {/* 不適切な問題を通報するリンク */}
                {!isTutorial && (
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
              hintText={isTutorial ? TUTORIAL_HINTS[activeWordItem.uuid] : undefined}
              onKeyPress={handleCloseupKeyPress}
              onBackspace={handleCloseupBackspace}
              onClose={() => setShowCloseup(false)}
              onComplete={handleCloseupComplete}
              onPrevCell={() => setActiveCloseupIndex((prev) => Math.max(0, prev - 1))}
              onNextCell={() => setActiveCloseupIndex((prev) => Math.min((activeWordItem?.length || 1) - 1, prev + 1))}
              onModifyChar={handleCloseupModifyChar}
              onReveal={handleReveal}
              revealUsed={reveals > 0}
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
                CLEARED!
              </Motion>
              <Motion initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="text-2xl mt-4" style={{ color: "rgba(255,255,255,0.9)" }}>
                {clearTime !== null && (
                  <span>
                    タイム：{clock(clearTime)}
                  </span>
                )}
              </Motion>
            </Motion>
          )}
        </Presence>

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

  // 問題を読み込んでいる間は何も出さない（作る画面がちらつかないように）
  if (isPlayerMode && loadState === "loading") {
    return <div className="min-h-screen bg-surface" />;
  }

  // 置けなかった語（完成の定義: どれが置けなかったかを出す）
  const unplaced = generatedPuzzle && !isLiveGenerating ? editorItems.filter((i) => !generatedPuzzle.items.some((p) => p.id === i.id)) : [];
  // 組み上がった盤が1つにつながっていない（固定した語が2つ以上で島のまま）
  const boardDisconnected = !!generatedPuzzle && !isLiveGenerating && !isConnected(generatedPuzzle.items);

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
              <span>組み立て中…</span>
            </div>
          </Motion>
        )}
      </Presence>

      <main className={`min-h-screen pt-20 pb-20 px-4 relative z-10 ${backgroundPuzzle && monteCarloProgress ? "bg-transparent" : "bg-surface"}`}>
        {/* ページ見出し */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <h1 className="text-3xl font-bold text-center" style={{ color: C.ink }}>{editTarget ? T.edit.pageTitle : T.pageTitle}</h1>
          <button
            type="button"
            onClick={() => setShowCreatorHelp(true)}
            className="transition-colors p-1.5 hover:bg-surface-container-high"
            style={{ color: C.secondary }}
            title={T.howToCreate}
            aria-label={T.howToCreate}
          >
            <Icon icon="help" />
          </button>
        </div>

        {/* 一覧への入口 */}
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mb-6">
          <Link to="/crossword" className="text-sm font-bold inline-flex items-center gap-1 hover:text-black transition-colors" style={{ color: C.secondary }}>
            {T.stage2b.toList} <span aria-hidden="true">→</span>
          </Link>
          {/* 自分が作った問題は別の画面（/crossword/mine）。別の端末から引き継げるよう、作った問題が無くても出す（2026-10-04） */}
          <Link to="/crossword/mine" data-coach="create-mine" className="text-sm font-bold inline-flex items-center gap-1 hover:text-black transition-colors" style={{ color: C.secondary }}>
            {T.myPuzzles.title} <span aria-hidden="true">→</span>
          </Link>
        </div>

        {/* ジャンル（HarmonyPalette の文字/コードの切り替えがあった場所） */}
        <div className="flex justify-center mb-6">
          <div className="inline-flex overflow-hidden" role="radiogroup" aria-label="ジャンル">
            {GENRES.map((g) => (
              <button
                key={g.key}
                type="button"
                role="radio"
                aria-checked={genre === g.key}
                tabIndex={radioTabIndex(genre === g.key)}
                onKeyDown={(e) => radioKeyDown(e, GENRES.map((x) => x.key), genre, chooseGenre)}
                onClick={() => chooseGenre(g.key)}
                className={`px-6 py-2.5 font-semibold transition-colors ${genre === g.key ? "bg-primary text-white" : "bg-white text-on-surface hover:bg-surface-container-low"}`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="container mx-auto max-w-5xl">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Input Panel（縦に並ぶ幅では 640px までにして真ん中に置く。Hop 決定 2026-10-04「PCだと入力欄めっちゃ横長」） */}
            <div className="bg-white p-6 space-y-6 w-full max-w-[640px] mx-auto lg:max-w-none">
              <div>
                <h2 className="text-base font-semibold mb-4 flex items-center gap-2 pb-2" style={{ color: C.ink }}>
                  <Icon icon="add" /> {editTarget ? T.edit.heading : T.createNew}
                </h2>

                <div className="space-y-1 mb-4" data-coach="create-title">
                  <label htmlFor="cw-title" className="text-xs font-mono font-bold" style={{ color: C.secondary }}>{T.puzzleTitle}</label>
                  <Input id="cw-title" value={puzzleTitle} onChange={setPuzzleTitle} placeholder={T.titlePlaceholder} maxLength={50} />
                </div>

                <div className="space-y-1 mb-4">
                  <label htmlFor="cw-creator" className="text-xs font-mono font-bold" style={{ color: C.secondary }}>{T.creatorName}</label>
                  <Input id="cw-creator" value={creatorName} onChange={setCreatorName} placeholder={T.creatorNamePlaceholder} maxLength={50} />
                </div>

                {/* タグ（任意・最大10） */}
                <div className="space-y-1 mb-4">
                  <label htmlFor="cw-tag" className="text-xs font-mono font-bold" style={{ color: C.secondary }}>タグ（任意・{MAX_TAGS}個まで）</label>
                  <div className="flex gap-2">
                    <Input
                      id="cw-tag"
                      value={tagInput}
                      onChange={setTagInput}
                      placeholder="入力して「追加」"
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

                {/* 初めての人向けの印 */}
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: C.ink }}>
                  <input type="checkbox" checked={isBeginner} onChange={(e) => setIsBeginner(e.target.checked)} className="w-4 h-4 accent-black" />
                  {T.stage2b.beginner}
                </label>
              </div>

              <div className="space-y-3" data-coach="create-entry">
                <div className="space-y-1" data-coach="create-answer">
                  <label htmlFor="cw-answer" className="text-xs font-mono font-bold" style={{ color: C.secondary }}>{T.answer}</label>
                  <Input id="cw-answer" value={currentInput.a} onChange={(v) => setCurrentInput({ ...currentInput, a: v })} placeholder={T.answerPlaceholder} />
                </div>
                <div className="space-y-1" data-coach="create-clue">
                  <label htmlFor="cw-clue" className="text-xs font-mono font-bold" style={{ color: C.secondary }}>{T.clue}</label>
                  <div className="flex gap-2">
                    <input
                      id="cw-clue"
                      ref={clueInputRef}
                      value={currentInput.q}
                      onChange={(e) => setCurrentInput({ ...currentInput, q: e.target.value })}
                      placeholder={T.cluePlaceholder}
                      className={`${inputClass} flex-1 min-w-0`}
                    />
                    {/* 穴あきのカギ用。今の文字の位置に「○」を1つ入れる */}
                    <button type="button" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={insertMaru} className="px-4 bg-surface-container-high hover:bg-surface-container-highest font-bold transition-colors" style={{ color: C.ink }} aria-label="○を入れる">
                      ○
                    </button>
                  </div>
                </div>
                <div className="space-y-1" data-coach="create-hint">
                  <label htmlFor="cw-hint" className="text-xs font-mono font-bold" style={{ color: C.secondary }}>ヒント</label>
                  <HintField inputId="cw-hint" genre={genre} onChange={setPendingHint} resetKey={hintResetKey} inputClassName={inputClass} initial={hintInitial} />
                </div>
                <div data-coach="create-add">
                {editingId ? (
                  <div className="flex gap-2">
                    <Button onClick={handleAddItem} disabled={!currentInput.a || !currentInput.q.trim() || !pendingHint} className="flex-1">
                      更新する
                    </Button>
                    <Button onClick={resetItemInput} variant="secondary">
                      やめる
                    </Button>
                  </div>
                ) : (
                  <Button onClick={handleAddItem} disabled={!currentInput.a || !currentInput.q.trim() || !pendingHint} className="w-full">
                    {T.addToList}
                  </Button>
                )}
                {/* 押せない理由（ヒントが未選択の時）を1行 */}
                {(!pendingHint || !currentInput.q.trim()) && (
                  <p data-add-reason="" className="text-xs mt-2" style={{ color: C.secondary }}>
                    {!pendingHint ? T.addReason[genre] : T.addReasonClue}
                  </p>
                )}
                </div>
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
                                  <span key={char} className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-primary" title={`'${char}' で他の語と交差できます`}>
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
                        <button onClick={() => handleRemoveItem(item.id)} className="p-1 ml-1 flex-shrink-0 hover:bg-primary hover:text-white transition-colors" style={{ color: C.secondary }} aria-label="消す">
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

            </div>

            {/* Preview & Output */}
            <div className="lg:col-span-2 space-y-6" id="puzzle-preview-area">
              <div data-coach="create-board" className="bg-surface-container-low min-h-[400px] flex flex-col items-center justify-center relative overflow-visible">
                {isLiveGenerating && showPreviewAnimation && backgroundPuzzle ? (
                  <div className="w-full p-4 flex flex-col items-center">
                    <FitGrid width={backgroundPuzzle.width} height={backgroundPuzzle.height}>
                      <PuzzleGridRetro data={backgroundPuzzle} showSolution={true} />
                    </FitGrid>
                    {monteCarloProgress && (
                      <div className="mt-4 bg-white px-6 py-3 font-mono text-sm font-black flex items-center gap-3" style={{ color: C.ink }}>
                        <div className="w-4 h-4 border-2 border-black border-t-transparent motion-safe:animate-spin" />
                        <span>組み立て中…</span>
                      </div>
                    )}
                  </div>
                ) : isLiveGenerating ? (
                  <div className="text-center p-8" style={{ color: C.secondary }}>
                    <div className="w-16 h-16 mx-auto mb-4 bg-white" />
                    <p className="text-lg font-black font-mono" style={{ color: C.ink }}>組み立て中…</p>
                  </div>
                ) : generatedPuzzle ? (
                  <div className="w-full p-4 flex flex-col items-center">
                    <FitGrid width={generatedPuzzle.width + 2 * MOVE_MARGIN} height={generatedPuzzle.height + 2 * MOVE_MARGIN}>
                      <MovableBoard data={generatedPuzzle} enabled={!isLiveGenerating} onDrop={handleMoveWord} />
                    </FitGrid>
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

              {/* 場面ごとの札（盤の下。Hop 決定 2026-10-05） */}
              {boardTip && <Tip name={boardTip} />}

              {/* 動かして固定した語（Hop 決定 2026-10-05・案A）。文言は【仮】 */}
              {generatedPuzzle && !isLiveGenerating && generatedPuzzle.items.some((i) => i.pinned) && (
                <div className="flex flex-col items-center text-sm" style={{ color: C.ink }}>
                  <button type="button" className="underline min-h-[44px] px-2" style={{ color: C.ink }} onClick={() => triggerGeneration(editorItems, false, [])}>
                    {T.pins.release}
                  </button>
                </div>
              )}

              {/* 置けなかった語 */}
              {unplaced.length > 0 && (
                <div className="bg-white px-4 py-3 text-sm" style={{ color: C.ink }}>
                  <span className="text-[0.6875rem] font-bold tracking-[0.1em] mr-2" style={{ color: C.error }}>置けなかった語</span>
                  {unplaced.map((i) => i.answer.join("")).join("、")}
                </div>
              )}

              {/* 型の案内 */}
              {generatedPuzzle && !isLiveGenerating && shapeGuide.length > 0 && (
                <div className="bg-white px-4 py-3 text-sm" style={{ color: C.ink }}>
                  <div className="text-[0.6875rem] font-bold tracking-[0.1em]" style={{ color: C.secondary }}>型の案内</div>
                  {shapeGuide.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}

              {/* メンバー名・グループ名が入っていたら知らせ、ジャンルは作る人が選ぶ（Hop 決定 2026-10-03） */}
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

              {/* 固定した語どうしがつながっていない盤は保存できない */}
              {boardDisconnected && (
                <div data-not-connected="" className="bg-white px-4 py-3 text-sm" style={{ color: C.error }}>
                  {T.pins.notConnected}
                </div>
              )}

              {/* 共有ボタン - パズルエリアの下 */}
              {generatedPuzzle && !isLiveGenerating && (
                <div className="flex justify-center">
                  <div data-coach="create-share">
                  <Button onClick={handleShare} disabled={isSaving || boardDisconnected} className="flex items-center gap-2">
                    {!editTarget && <Icon icon="share" />}
                    {isSaving ? T.saving : editTarget ? T.edit.update : T.share}
                  </Button>
                  </div>
                </div>
              )}

              <div className="text-center text-xs px-4 font-mono" style={{ color: C.secondary }}>
                ※作成された問題の著作権および責任は作成者に帰属します。
                <br />
                他者の権利を侵害する内容を含めないようご注意ください。
              </div>
            </div>
          </div>
        </div>

        {/* 保存の直前の確認（Turnstile） */}
        {showSaveCheck && <SaveCheckModal onPass={saveWithToken} onClose={cancelSaveCheck} />}

        {/* Share Modal */}
        {showShareModal && (
          <div ref={shareDialog} role="dialog" aria-modal="true" aria-labelledby="cw-share-title" className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
            <div className="bg-white p-6 max-w-md w-full space-y-6" style={{ boxShadow: C.modalShadow }}>
              <h2 id="cw-share-title" className="text-2xl font-black text-center pb-3" style={{ color: C.ink }}>{T.shareModal.modalTitle}</h2>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="cw-share-url" className="text-xs block font-mono font-bold" style={{ color: C.secondary }}>{T.shareModal.shareLink}</label>
                  <div className="flex gap-2">
                    <input id="cw-share-url" readOnly value={shareUrl} className="flex-1 bg-surface-container-low px-3 text-sm truncate font-mono" style={{ color: C.ink }} />
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
                {editTarget ? T.shareModal.updatedNotice : T.shareModal.publicNotice}
              </div>
              {/* 「公開されます」の近くに、作りかけと自分が作った問題の札（初めての1回だけ） */}
              {!tipsSeen.saved && !editTarget && <Tip name="saved" tone="low" />}
              <div className="flex justify-center">
                <Button onClick={() => setShowShareModal(false)} variant="secondary">
                  {T.close}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 作り方ガイドモーダル */}
        {showRequest && <ContactModal onClose={() => setShowRequest(false)} initialTool="crossword" initialKind="request" />}
        {showCreatorHelp && (
          <div ref={creatorHelpDialog} role="dialog" aria-modal="true" aria-labelledby="cw-creator-help-title" className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setShowCreatorHelp(false)}>
            <div className="bg-white max-w-lg w-full max-h-[80vh] overflow-y-auto" style={{ boxShadow: C.modalShadow }} onClick={(e) => e.stopPropagation()}>
              <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 id="cw-creator-help-title" className="text-xl font-bold" style={{ color: C.ink }}>{T.creatorHelp.title}</h2>
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
                  <h3 className="text-sm font-bold uppercase tracking-wider pb-1" style={{ color: C.ink }}>{T.creatorHelp.tipsTitle}</h3>
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

                <section className="space-y-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider pb-1" style={{ color: C.ink }}>{T.creatorHelp.moreTitle}</h3>
                  <ul className="space-y-2 text-sm list-disc pl-5" style={{ color: C.secondary }}>
                    {T.creatorHelp.more.map((line, index) => (
                      <li key={index}>{line}</li>
                    ))}
                  </ul>
                </section>

                <div className="pt-4 flex justify-end gap-2">
                  {/* 実物の上で案内する（Hop 決定 2026-10-05・案B） */}
                  <button
                    onClick={() => {
                      setShowCreatorHelp(false);
                      startCreateGuide();
                    }}
                    className="px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest font-medium transition-colors"
                    style={{ color: C.ink }}
                  >
                    {T.creatorHelp.guide}
                  </button>
                  <button onClick={() => setShowCreatorHelp(false)} className="px-4 py-2 bg-primary hover:bg-secondary text-white font-medium transition-colors">
                    {T.creatorHelp.close}
                  </button>
                </div>
                <div className="text-center mt-3">
                  <button
                    onClick={() => { setShowCreatorHelp(false); setShowRequest(true); }}
                    className="text-sm underline underline-offset-4 transition-colors hover:text-black"
                    style={{ color: C.secondary }}
                  >
                    {T.creatorHelp.request}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 作る画面の案内 */}
      {createGuide !== null && createSteps[createGuide] && (
        <CoachMarks
          step={createSteps[createGuide]}
          stepKey={createGuide}
          onNext={createNext}
          onSkip={endCreateGuide}
          skipLabel={T.tutorial.skip}
          nextDefaultLabel={T.tutorial.next}
        />
      )}

      <Footer />
    </>
  );
}
