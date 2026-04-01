/**
 * UPFC「チケット申込状況」ページのコピペテキストをパースする。
 *
 * 実際のフォーマット（ステータスが別行・複数行）:
 *   申し込み状況→抽選前
 *   Juice=Juice Concert 2026 UP TO 11 MORE！ MORE！
 *   当選
 *   入金済
 *   BEYOOOOONDS CONCERT TOUR 2026 SPRING [BEYOSCOOOOOPE]
 *   入金完了日：2026/03/03（火）[クレジットカード]
 *
 * 処理はすべてブラウザ内で完結。コピペ内容をサーバーに送信しない。
 */

// ─── 型定義 ───────────────────────────────────────────────

export interface ParsedApplication {
  /** 当選 / 落選 / 申込済 / 抽選前 等（複数の場合はスペース区切り） */
  status: string;
  /** 公演名 */
  title: string;
  /** 入金完了日 or 入金締切日（あれば） */
  paymentDate?: string;
}

export interface FcNewsRow {
  uid: string;
  title: string;
  category: string;
  detail_url: string;
}

export interface MatchResult {
  parsed: ParsedApplication;
  /** マッチした fc_news（複数記事が同一公演に紐づく場合がある） */
  matched: FcNewsRow[];
}

// ─── 定数 ────────────────────────────────────────────────

/** 1行がステータスだけのときに使うキーワード */
const STATUS_KEYWORDS = [
  "当選取消", "申込取消", "入金待ち", "入金済",
  "当選", "落選", "申込済", "受付中", "抽選前", "キャンセル",
];

/** セクションヘッダーのパターン（例: 「申し込み状況→抽選前」） */
const SECTION_HEADER_RE = /^申し込み状況[→＞>](.+)$/;

/** 日付行のパターン */
const DATE_LINE_RE = /^(?:入金完了日|入金締切日)[：:]/;

// ─── パース ──────────────────────────────────────────────

/**
 * UPFC コピペテキスト → ParsedApplication[]
 *
 * 処理の流れ:
 *  - 行ごとに「セクションヘッダー / ステータス / 日付 / タイトル」を判定
 *  - ステータス行はタイトルが来るまで蓄積
 *  - タイトル行が来たとき、蓄積済みステータスと合わせてエントリを確定
 *  - 日付行は直前のエントリに付属
 */
export function parseUpfcText(text: string): ParsedApplication[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const results: ParsedApplication[] = [];

  let pendingStatuses: string[] = [];
  let pendingTitle: string | null = null;
  let pendingDate: string | undefined;

  function emitEntry() {
    if (!pendingTitle) return;
    results.push({
      status: pendingStatuses.join(" ") || "不明",
      title: pendingTitle,
      paymentDate: pendingDate,
    });
    pendingStatuses = [];
    pendingTitle = null;
    pendingDate = undefined;
  }

  for (const line of lines) {
    if (line === "") {
      // 空行でエントリを区切る
      emitEntry();
      continue;
    }

    // セクションヘッダー（例: 「申し込み状況→抽選前」）
    const sectionMatch = line.match(SECTION_HEADER_RE);
    if (sectionMatch) {
      emitEntry();
      // セクションのステータスを次エントリに使う
      pendingStatuses = [sectionMatch[1].trim()];
      continue;
    }

    // 日付行（入金完了日 / 入金締切日）
    if (DATE_LINE_RE.test(line)) {
      const dateVal = line.replace(/^(?:入金完了日|入金締切日)[：:]\s*/, "")
                          .replace(/\[.*?\]/g, "")
                          .trim();
      if (pendingTitle) {
        // まだ emit していないエントリの日付として保持
        pendingDate = dateVal;
      } else if (results.length > 0) {
        // 直前の emit 済みエントリに付ける
        results[results.length - 1].paymentDate = dateVal;
      }
      continue;
    }

    // ステータス行（行全体がステータスキーワードだけ）
    if (isStatusLine(line)) {
      if (pendingTitle) {
        // タイトルがあるのに次のステータスが来た → タイトルを確定してリセット
        emitEntry();
      }
      pendingStatuses.push(line);
      continue;
    }

    // タイトル行
    if (pendingTitle) {
      // 前のタイトルがある → まず確定
      emitEntry();
    }
    pendingTitle = line;
  }

  // 末尾の未確定エントリ
  emitEntry();

  return results;
}

function isStatusLine(line: string): boolean {
  return STATUS_KEYWORDS.some((kw) => line === kw || line.startsWith(kw + " "));
}

// ─── ファジーマッチング ───────────────────────────────────

/**
 * コピペ公演名リストと fc_news を照合する。
 *
 * マッチ戦略（優先順）:
 *  1. パース公演名を正規化したものが DB タイトルに含まれる
 *  2. DB タイトルのコア部分（FC受付サフィックスを除いた部分）がパース公演名に含まれる
 *  3. トークンの 60% 以上が一致
 */
export function matchApplications(
  parsed: ParsedApplication[],
  allNews: FcNewsRow[]
): MatchResult[] {
  return parsed.map((app) => ({
    parsed: app,
    matched: allNews.filter((news) => isTitleMatch(app.title, news.title)),
  }));
}

function isTitleMatch(parsedTitle: string, dbTitle: string): boolean {
  // 「チケット付き」記事はパース公演名にも「チケット付き」がある場合のみマッチ
  // （チケット付き宿泊プラン等は別商品なので、通常のFC先行申込にマッチさせない）
  if (dbTitle.includes("チケット付き") && !parsedTitle.includes("チケット付き")) return false;

  // 宿泊プラン同士: 「【チケット付き宿泊プラン】公演名」形式のパース公演名から
  // チケット付き部分を除いたコア公演名で比較（88%閾値バイパス対策）
  if (parsedTitle.includes("チケット付き") && dbTitle.includes("チケット付き")) {
    const coreA = normalize(parsedTitle.replace(/【?チケット付き\S*】?\s*/g, "").trim());
    const dbCore = normalize(stripFcSuffix(dbTitle));
    if (coreA.length >= 4 && dbCore.includes(coreA)) return true;
    if (coreA.length >= 4 && coreA.includes(dbCore) && dbCore.length >= coreA.length * 0.88) return true;
  }

  const a = normalize(parsedTitle);
  const b = normalize(dbTitle);

  if (a.length < 4) return false;

  // 戦略①: パース公演名 ⊂ DB タイトル
  if (b.includes(a)) return true;

  // 戦略②: DB タイトルのコア部分 ⊂ パース公演名
  // ただし dbCore の長さが parsed title の 88% 以上であること（短い部分一致の誤ヒット防止）
  const dbCore = normalize(stripFcSuffix(dbTitle));
  if (dbCore.length >= 4 && a.includes(dbCore) && dbCore.length >= a.length * 0.88) return true;

  // 戦略③: トークンマッチング（80% 以上一致）
  // strategy 2 と同様に dbCore の長さも確認（短すぎる記事の誤ヒット防止）
  if (dbCore.length > 0 && dbCore.length < a.length * 0.88) return false;

  const tokens = parsedTitle
    .split(/[\s　]+/)
    .map((t) => normalize(t))
    .filter((t) => t.length >= 2);

  if (tokens.length === 0) return false;
  const matchCount = tokens.filter((t) => b.includes(t)).length;
  return matchCount / tokens.length >= 0.8;
}

function stripFcSuffix(title: string): string {
  return title
    .replace(/[『』「」【】〔〕]/g, "")
    .replace(/FC\d*次?受付のお知らせ.*$/, "")
    .replace(/FC先行受付のお知らせ.*$/, "")
    .replace(/チケット付き.*$/, "")
    .replace(/開催決定.*$/, "")
    .replace(/のお知らせ.*$/, "")
    .trim();
}

function normalize(s: string): string {
  return s
    // 全角英数 → 半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    // スペース除去
    .replace(/[　\s]/g, "")
    // 括弧・記号除去
    .replace(/[『』「」【】〔〕（）()\[\]｛｝{}]/g, "")
    .replace(/[～〜~・。、．，]/g, "")
    .replace(/[''＇]/g, "'")
    .toLowerCase();
}

// ─── ユーティリティ ───────────────────────────────────────

export function filterMatched(results: MatchResult[]): MatchResult[] {
  return results.filter((r) => r.matched.length > 0);
}

export function getUnmatched(results: MatchResult[]): ParsedApplication[] {
  return results.filter((r) => r.matched.length === 0).map((r) => r.parsed);
}
