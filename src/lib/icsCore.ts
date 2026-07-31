// ICSまわりの「レシピ」のうち、ブラウザにもサーバー（Supabase Edge Function）にも
// 依存しない純粋な部分だけをまとめたファイル。
//
// このファイルは scripts/sync-ics-shared.mjs で
// supabase/functions/_shared/icsCore.ts にそのままコピーされる（import拡張子だけ自動調整）。
// 直接 supabase/functions/_shared/icsCore.ts を手で編集しない（次の同期で上書きされる）。
//
// 会場名の誤字補正テーブルはスクレイパー側 (gas/upfc-scraper.js) にも
// 別の理由（保存前の正規化）で同じ内容がある。会場の誤字を直したときはそちらも確認する。

export interface IcsAlarm {
  trigger?: string; // 予定の開始からの相対指定。例: "-P1D"(前日), "-PT1H"(1時間前)
  description: string; // 通知文言
  /**
   * 絶対時刻（ISO文字列）。指定するとこの時刻ちょうどに通知する（trigger より優先）。
   * 締切時刻そのものが当てにならない種類（入金締切）で使う。
   */
  at?: string;
}

export interface IcsGeo {
  lat: number;
  lon: number;
}

export function formatIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// 旧データ(alarms無し)互換のデフォルト通知＝従来どおり前日＋1時間前の締切リマインダー
export const DEFAULT_ALARMS: IcsAlarm[] = [
  { trigger: "-P1D", description: "明日が締切です" },
  { trigger: "-PT1H", description: "1時間後が締切です" },
];

// 会場座標行を生成。GEO(標準) + X-APPLE-STRUCTURED-LOCATION(iOSの地図タップ・経路案内用)
export function renderGeo(event: { geo?: IcsGeo | null; location?: string | null }): string[] {
  const g = event.geo;
  if (!g) return [];
  // X-TITLEはパラメータ値なので壊す文字（引用符・改行）を除去して引用符で包む
  const title = (event.location ?? "").replace(/[",\n\\]/g, " ").replace(/\s+/g, " ").trim();
  return [
    `GEO:${g.lat};${g.lon}`,
    `X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-APPLE-RADIUS=200;X-TITLE="${title}":geo:${g.lat},${g.lon}`,
  ];
}

// VALARM行を生成。undefined→デフォルト、[]→通知なし。
// at があれば絶対時刻の通知、無ければ予定の開始からの相対の通知。
export function renderAlarms(alarms?: IcsAlarm[]): string[] {
  const list = alarms ?? DEFAULT_ALARMS;
  return list.flatMap((a) => {
    const triggerLine = a.at
      ? `TRIGGER;VALUE=DATE-TIME:${formatIcsDate(new Date(a.at))}`
      : a.trigger
        ? `TRIGGER:${a.trigger}`
        : null;
    if (!triggerLine) return []; // 時刻の指定が無い通知は出さない
    return [
      "BEGIN:VALARM",
      triggerLine,
      "ACTION:DISPLAY",
      `DESCRIPTION:${a.description.replace(/\n/g, "\\n")}`,
      "END:VALARM",
    ];
  });
}

/**
 * fc_news.title からカレンダー表示用にノイズを除去する
 * iOS標準カレンダー等で予定タイトルが切れた時にも要旨が分かるよう、
 * 装飾的な接頭辞・接尾辞・括弧を削る
 */
export function cleanFcTitle(title: string): string {
  return title
    .replace(/★ファンクラブ会員限定イベント★/g, "")
    .replace(/Hello! Project会員の皆様へ、/g, "")
    .replace(/のお知らせ\s*$/, "")
    .replace(/開催決定[！!]\s*$/, "")
    .replace(/[「」『』]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── 会場座標（会場名 → 座標） ─────────────────────────────

export interface VenueGeo {
  lat: number;
  lon: number;
}

// 公式記事側の誤字の補正（スクレイパー側にも同じ補正あり）。
// DBに誤字のまま残っている行でも座標が引けるようにする保険。
export const LOCATION_TYPO_FIX: Record<string, string> = {
  有楽日町朝ホール: "有楽町朝日ホール",
};

/** fc_deadlines.location「会場名 （都道府県）」→ 会場名で座標を引く */
export function geoForLocation(
  location: string | null | undefined,
  venueGeoByName: Map<string, VenueGeo>,
): VenueGeo | null {
  if (!location) return null;
  const name = location.replace(/\s*（[^）]*）\s*$/, "").trim();
  return venueGeoByName.get(LOCATION_TYPO_FIX[name] ?? name) ?? null;
}

/**
 * 座標が引けない会場の安全網: 会場名のGoogleマップ検索URL。
 * 予定メモに入れておけば、辞書整備が間に合わない公演でも当日タップで地図検索が開く。
 */
export function mapSearchUrl(location: string): string {
  const q = location.replace(/[（）()]/g, " ").replace(/\s+/g, " ").trim();
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
}

// ─── 公演（イベント）単位グルーピング ──────────────────────
//
// fc_news は「FC2次受付」「当日券販売」「開催決定」等が別レコードに分かれている。
// タイトルから受付種別・枕詞・「〜のお知らせ」等を剥がして「公演キー」を作り、
// 同じキーのレコードを1公演として束ねる。DB は変更しない。
//
// 方針:
// - 地域（＜大阪公演＞ / 東京公演 / in 名古屋 等）は剥がさない＝地域ごとに別公演。

const STRIP_PREFIX = /★ファンクラブ会員限定イベント★|Hello! Project会員の皆様へ、|[「」『』]/g;
const STRIP_ACTION =
  /(FC[0-9]*次受付|FC先行受付|NEXT先行受付|[0-9]+次受付|先行受付|FC追加受付|FC追加|当日券予約追加受付|当日券予約受付|当日券予約販売|当日券販売|当日券|のお知らせ|開催決定[！!]|受付)/g;
const STRIP_DATE_PREFIX = /^[0-9]{1,2}\/[0-9]{1,2}\([月火水木金土日]\)\s*/;

/** タイトル → 公演キー（グルーピング用・表示ラベル兼用） */
export function eventGroupKey(title: string): string {
  return title
    .replace(STRIP_PREFIX, "")
    .replace(STRIP_ACTION, "")
    .replace(STRIP_DATE_PREFIX, "")
    .replace(/[\s　]+/g, " ")
    .trim();
}

// ─── 公演(event)行の双子畳み ───────────────────────────────
//
// 同じ公演でも「開催決定」「FC2次受付」「当日券予約販売」とお知らせが出るたびに
// type='event' の行が1本ずつ生まれる（fc_deadlines は news_uid+type がキーのため）。
// 同一公演キー＋同一開演時刻の event 行を1本に畳み、表示・配信の二重化を防ぐ。

interface EventTwinLike {
  id: string;
  type: string;
  deadline_at: string;
  fc_news: { title: string };
}

/** 公演を一意に指すキー（公演キー＋開演時刻）。双子（重複event行）でも同じ値になる。
 *  公演ごとの通知設定の保存キーにも使う。 */
export const eventTwinKey = (dl: EventTwinLike) =>
  eventGroupKey(dl.fc_news.title) + "|" + new Date(dl.deadline_at).getTime();

/**
 * event行の双子を畳む。event以外はそのまま通す。
 * - 代表: タイトルのノイズが最少（cleanFcTitle後が最短）の双子 ＝ カレンダーの予定名が一番きれいに残る
 * - twinIdsByRepId: 代表id → 双子全id。チェックの判定・付け外しを双子セット全体に同期させるために使う
 */
export function dedupeEventTwins<T extends EventTwinLike>(
  deadlines: T[],
): { deduped: T[]; twinIdsByRepId: Map<string, string[]> } {
  const buckets = new Map<string, T[]>();
  for (const dl of deadlines) {
    if (dl.type !== "event") continue;
    const key = eventTwinKey(dl);
    const arr = buckets.get(key);
    if (arr) arr.push(dl);
    else buckets.set(key, [dl]);
  }
  const repByKey = new Map<string, T>();
  const twinIdsByRepId = new Map<string, string[]>();
  for (const [key, list] of buckets) {
    const rep = [...list].sort(
      (a, b) =>
        cleanFcTitle(a.fc_news.title).length - cleanFcTitle(b.fc_news.title).length ||
        a.id.localeCompare(b.id),
    )[0];
    repByKey.set(key, rep);
    twinIdsByRepId.set(rep.id, list.map((x) => x.id));
  }
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const dl of deadlines) {
    if (dl.type !== "event") {
      deduped.push(dl);
      continue;
    }
    const key = eventTwinKey(dl);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(repByKey.get(key)!);
  }
  return { deduped, twinIdsByRepId };
}

// ─── 購読の「注文票」型 ─────────────────────────────────────
//
// Subscribe画面での選択内容の控え。fc_subscriptions.events 列に保存され、
// fc-ics-upload（即時発行）・fc-ics-regen（毎日の作り直し）の両方が読む。
// v=2 が無い（＝配列そのまま）行は旧形式＝完成品スナップショットなので、
// サーバー側は互換の別ルートで扱う（buildIcsLegacyFromEvents）。

export interface EventLeadSetting {
  hours: number | null; // 当日「◯時間前」(1〜24・null=当日の通知なし)
  dayBefore: boolean; // 前日にも通知
}

export type RetentionMode = "after-event-1m" | "6m" | "forever";

export interface OrderTicket {
  v: 2;
  includedIds: string[]; // 含める fc_deadlines.id の一覧（双子は全id含む）
  retention: RetentionMode;
  eventLead: EventLeadSetting; // 公演出発通知の既定値
  eventLeadOverrides: Record<string, EventLeadSetting>; // 公演ごとの上書き（キー=eventTwinKey）
  // 「行く」と判定された news_uid の一覧（当選/入金済という判定結果だけ。
  // 貼り付けたテキストの中身は含めない＝サーバーには送らない約束を維持する）
  attendingNewsUids: string[];
  /**
   * 「入金が済んだ」と判定された news_uid の一覧。
   * attendingNewsUids は「行く公演」（当選も入金済も含む）なので、入金が済んだかどうかを
   * 見分けられない。入金締切の予定を【入金済み】に書き換えて通知を止めるために別に持つ。
   *
   * 省略可（undefined＝1件も入金済みでない）。古い注文票をサーバーが弾かないようにするため
   * 必須にしない。新旧が噛み合わないと発行が全滅するので、この形は崩さないこと。
   */
  paidNewsUids?: string[];
}
