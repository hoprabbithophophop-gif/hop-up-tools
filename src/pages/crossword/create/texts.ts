// 作る画面（/crossword/create）の文言。案A「作る｜試す」（Hop 決定 2026-10-22。前の4段の流れ 1 答え・2 盤・3 カギ・4 共有は取りやめ）。
// 本番にあった文はそのまま写し、Hop が承認した文と見本（案A）の文だけを足した。新しい文は【仮】の印を付けて置く（作り直しの報告で一覧にする）。
import { BEGINNER_LABEL } from "../components/PuzzleGalleryCard";
import type { BulkTexts } from "../components/BulkEntry";

export const CT = {
  pageTitle: "クロスワードパズル作成",
  // 見出しの右の切り替えと、下の貼り付けの段（見本の案A。Hop が選んだ形 2026-10-22）
  modes: { make: "作る", try: "試す" },
  modesLabel: "作る・試す", // 切り替えの読み上げ名【仮】
  tryIt: "試しに解く",
  toShare: "公開の準備", // Hop 決定 2026-10-22（見本の「共有へ」から変えた）
  // 初めて開いた時に入っている見本の4行。道具の段のボタン（【 】・｜・→・○）を全部使い、1行に答え1つ（1行に2つだとカギがぼやけるため）。書き換えられる普通の文（Hop 決定 2026-10-22）
  sample: ["【ラジオ】で新曲が初めて流れた", "【本気｜マジ】で応援している", "ニャーと鳴く動物→【ネコ】", "○○○はユーカリを食べる→【コアラ】"].join("\n"),
  // 小さい盤（見本の案A）
  expand: "解く人の視点", // Hop 決定 2026-10-22（見本の「広げる」から変えた）
  boardTitle: "盤", // 広げた盤の画面の見出し【仮】
  // 語の一覧（見本の案A）
  wordsLabel: "語の一覧", // 読み上げ名【仮】
  // 足りない物だけを言葉で出し、済んだら何も出さない（Hop 決定 2026-10-22。●○の印と凡例はやめた）
  wordNoClue: "カギがまだ", // 【仮】
  wordNoHint: "ヒントがまだ", // 【仮】
  // 語の窓（語の一覧の行を押すと下から出る。「次の語 →」は無い。Hop 決定 2026-10-22「好きな順番で解かせろ」）
  wordSheetTitle: (answer: string) => `「${answer}」のカギとヒント`, // 【仮】
  clueLabel: "カギ", // カギの欄の名前【仮】
  clueAbout: "カギは、答えを当てるための問題文です。", // 語の窓のカギの欄の説明（4段の 3 カギの説明文の1文目をそのまま戻した。Hop 決定 2026-10-22）
  // 足りない物（共有の窓の押せない理由の先頭。Hop 決定 2026-10-22。途中は止めず、共有の直前にだけ出す）
  missing: (clue: number, hint: number) => [clue ? `カギがあと${clue}語` : "", hint ? `ヒントがあと${hint}語` : ""].filter(Boolean).join("・"), // 【仮】
  // カギ（問題文）は100字まで（Hop 決定 2026-10-22。10-21 の30字は取り違えだった）。欄の下の残り字数と、超えた時の押せない理由
  clueLeft: (n: number) => `あと${n}字`, // 【仮】
  clueOver: (n: number) => `${n}字多いです。100字までにしてください。`, // 【仮】共有のボタンの上の行では、頭に「語：」を付ける（書く欄の reasonLine と同じ形）
  allSet: "全部の答えにカギとヒントが付きました。",
  hintState: (source: string, name: string) => `ヒント: ${source} ${name}`,
  hintRoot: "ヒントは答えの根拠です。", // 「?」の案内から移した本番の文
  // 2文目は Hop 決定 2026-10-22
  hintOfficial: "ヒントはハロプロの公式の発信（YouTube・Instagram・X・アメーバブログ・公式サイト）から選んでください。解く人が出どころを確かめられるようにするためです。",
  close: "閉じる",
  cluePlaceholder: "例：ニャーと鳴く動物",
  // 盤（本番の文）
  reshuffle: "再シャッフル",
  building: "組み立て中…",
  unplaced: "置けなかった語",
  shapeGuide: "型の案内",
  pins: {
    release: "固定を外す", // 【仮】
    notConnected: "固定した語がつながっていません。固定を外すか、語を足してください。", // 【仮】
  },
  // 共有の窓（本番の文）
  shareTitle: "共有する",
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
  // 共有の窓の「共有する」のボタンの上に出す（Hop 決定 2026-10-22）
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

// 書く欄（BulkEntry）の文言。本番の T.bulk に、Hop が承認した文を足した物
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
  // ○は 3 カギの欄ごとのボタンから移した（Hop 決定 2026-10-22）
  insertMaru: "○",
  insertMaruLabel: "○を入れる",
  unmarkBar: (w: string) => `「${w}」の囲みを外す`,
  reasonLine: (surface: string, reason: string) => `${surface}：${reason}`,
  reasons: {
    noReading: "読みが未入力",
    badReading: "読みはひらがな・カタカナで", // 【仮】
    unusable: "使えない字（ヰ・ヱ）",
    tooLong: "答えは30字までです。", // 【仮】答えのマス目は30字まで（Hop 決定 2026-10-22。前は20字）
    inList: "一覧に入っています", // 【仮】
    duplicate: "同じ答えがあります",
    tooMany: "60語まで",
  },
};

// 広げた盤の案の並び（本番の T.bulk から）
export const PROPOSAL_TEXTS = {
  proposal: (n: number) => `案${n}`, // 【仮】
  stats: (n: number, m: number, k: number) => `${n}語・${m}マス・交差${k}`,
  noProposal: "組み合わせが見つかりませんでした。", // 【仮】
};
