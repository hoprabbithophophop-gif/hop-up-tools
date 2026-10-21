// 作る画面（/crossword/create）の文言。4段の流れ（1 答え・2 盤・3 カギ・4 共有。Hop 決定 2026-10-19 夜〜10-20）。
// 本番にあった文はそのまま写し、段の札・見出し・説明は Hop が承認した文だけを足した。新しい文は発明しない。
import { BEGINNER_LABEL } from "../components/PuzzleGalleryCard";
import type { BulkTexts } from "../components/BulkEntry";

export const CT = {
  pageTitle: "クロスワードパズル作成",
  // 段の札と戻るボタン（Hop 承認 2026-10-20）
  steps: ["1 答え", "2 盤", "3 カギ", "4 共有"],
  stepsLabel: "今の段", // 読み上げ名
  backToAnswers: "← 答えへ戻る",
  backToBoard: "← 盤へ戻る",
  backToClues: "カギの段へ戻る",
  headings: {
    answers: "まとめて入れる",
    board: "盤の候補から選ぶ",
    clues: "カギを書く",
    share: "共有する",
  },
  // 3の段の説明（前の1文は「?」の案内から移した本番の文。Hop 決定 2026-10-20）
  cluesGuide: "カギは、答えを当てるための問題文です。カギには、答えがあった行が下書きとして入っています。答えの所は字数ぶんの ○ です。そのままでも、書き直してもかまいません。",
  missingHints: (n: number) => `ヒントが未選択の語が ${n} 語あります`,
  missingClues: (n: number) => `カギが空の語が ${n} 語あります`, // 【仮】
  // カギは30字まで（Hop 決定 2026-10-21。曲名なども30字以内に収まるため）。欄の下の残り字数と、超えた時の押せない理由
  clueLeft: (n: number) => `あと${n}字`, // 【仮】
  clueOver: (n: number) => `${n}字多いです。30字までにしてください。`, // 【仮】共有のボタンの上の行では、頭に「語：」を付ける（1の段の reasonLine と同じ形）
  allSet: "全部の答えにカギとヒントが付きました。",
  pickHint: "未選択 → ヒントを選ぶ",
  hintState: (source: string, name: string) => `ヒント: ${source} ${name}`,
  // ヒントの窓（下から出る）
  hintSheetTitle: (answer: string) => `「${answer}」のヒント`,
  hintRoot: "ヒントは答えの根拠です。", // 「?」の案内から移した本番の文
  hintOfficial: "ヒントはハロプロの公式の発信（YouTube・Instagram・X・アメーバブログ・公式サイト）から選んでください。解く人が正しい情報と分かるためです。",
  unmarkFull: (surface: string) => `「${surface}」の囲みを外す`,
  close: "閉じる",
  // 3の段のカギの欄
  cluePlaceholder: "例：ニャーと鳴く動物",
  maruLabel: "○を入れる",
  // 2の段（本番の文）
  reshuffle: "再シャッフル",
  building: "組み立て中…",
  unplaced: "置けなかった語",
  shapeGuide: "型の案内",
  pins: {
    release: "固定を外す", // 【仮】
    notConnected: "固定した語がつながっていません。固定を外すか、語を足してください。", // 【仮】
  },
  // 4の窓（本番の文）
  puzzleTitle: "題名",
  titlePlaceholder: "例：音楽なぞなぞチャレンジ！",
  creatorName: "作った人の名前（任意）",
  creatorNamePlaceholder: "空欄なら「名無し」",
  tagsLabel: (max: number) => `タグ（任意・${max}個まで）`,
  tagPlaceholder: "入力して「追加」",
  tagAdd: "追加",
  tagRemove: (t: string) => `${t} を外す`,
  beginner: BEGINNER_LABEL,
  share: "共有する",
  saving: "保存中…",
  toList: "パズルギャラリー",
  myPuzzles: "自分が作った問題",
  copyright: ["※作成された問題の著作権および責任は作成者に帰属します。", "他者の権利を侵害する内容を含めないようご注意ください。"],
  errors: {
    noTitle: "題名を入力してください。",
    saveFailed: "問題の保存に失敗しました。",
    tooFew: "保存するには、語を2つ以上追加してください。",
    noCrossing: "語どうしが交差していないと保存できません。同じ字を含む語を足してみてください。",
  },
  saveReasons: {
    too_many: "保存が集中しています。時間をおいてもう一度お試しください。",
    verification: "確認に失敗しました。ページを再読み込みしてお試しください。",
    bad_request: "内容をご確認のうえ、もう一度お試しください。",
  } as Record<string, string>,
  edit: {
    pageTitle: "クロスワードパズルの組み直し", // 【仮】
    update: "更新する", // 【仮】
    notEditable: "この問題は組み直せません。", // 【仮】
    alreadyPlayed: "もう遊ばれているので組み直せません。", // 【仮】
  },
  shareModal: {
    modalTitle: "問題を共有",
    shareLink: "共有リンク",
    postToX: "Xに投稿",
    publicNotice: "この問題を公開しました。誰でも遊べます。",
    updatedNotice: "この問題を更新しました。URL は変わりません。",
    copy: "コピー",
  },
  // 札（場面が初めて来た時に1回だけ・1行・幕なし。Hop 決定 2026-10-05）。文言はすべて【仮】
  tips: {
    cross: "もう1語足すと、同じ字で交差して組まれます。",
    move: "盤の語は長押しで動かせます。",
    saved: "作りかけはこの端末に自動で残ります。作った問題は「自分が作った問題」にあり、遊ばれる前なら組み直せます。",
    close: "閉じる",
  },
};

// 1の段（BulkEntry）の文言。本番の T.bulk に、Hop が承認した文を足した物
export const BULK_TEXTS: BulkTexts = {
  guide: "出す語を【 】で囲む。読みは｜の後に（例: 【本気｜マジ】）。カタカナだけの語は読み不要。答えが問題文に無い時は、後ろに「→」で区切って書く（例: ニャーと鳴く動物→【ネコ】）。",
  textLabel: "まとめて入れる文", // 欄の読み上げ名【仮】
  markSelected: (w: string) => `「${w}」を出す`,
  insertBrackets: "【 】",
  insertBracketsLabel: "【 】で囲む", // 読み上げ名【仮】
  insertBar: "｜",
  insertBarLabel: "｜を入れる", // 読み上げ名【仮】
  insertArrow: "→",
  insertArrowLabel: "→を入れる", // 読み上げ名【仮】
  unmarkBar: (w: string) => `「${w}」の囲みを外す`, // ヒントの窓の「囲みを外す」と同じ言葉
  reading: "読み",
  readingOf: (w: string) => `${w} の読み`, // 読みの欄の読み上げ名【仮】
  unmark: (w: string) => `${w} の囲みを外す`, // 帯の「外す」の読み上げ名【仮】
  selectMark: (w: string) => `${w} を選ぶ`, // 下線の語の読み上げ名【仮】
  unmarkShort: "外す",
  decide: "決める",
  closeBar: "×",
  closeBarLabel: "帯を閉じる", // 読み上げ名
  modeWrite: "書く",
  modeHint: "ヒントを付ける",
  modeLabel: "書く・ヒントを付ける", // 切り替えの読み上げ名【仮】
  linesLabel: "書いた行（下線が答え。押すとヒントを付けられます）",
  legend: "黒い字＝ほかの答えと交差できる字　● ヒント済み　○ まだ",
  hinted: "ヒント済み", // ●の読み上げ名
  notHinted: "まだ", // ○の読み上げ名
  traceTip: "字をなぞると答えにできます", // 【仮】
  search: (n: number) => `組み合わせを探す（${n}語）`,
  reasonLine: (surface: string, reason: string) => `${surface}：${reason}`,
  reasons: {
    noReading: "読みが未入力",
    badReading: "読みはひらがな・カタカナで", // 【仮】
    unusable: "使えない字（ヰ・ヱ）",
    tooLong: "20字まで",
    inList: "一覧に入っています", // 【仮】
    duplicate: "同じ答えがあります",
    tooMany: "60語まで",
  },
};

// 2の段の案の並び（本番の T.bulk から）
export const PROPOSAL_TEXTS = {
  proposal: (n: number) => `案${n}`, // 【仮】
  stats: (n: number, m: number, k: number) => `${n}語・${m}マス・交差${k}`,
  noProposal: "組み合わせが見つかりませんでした。", // 【仮】
  adopt: "この盤で進む",
};
