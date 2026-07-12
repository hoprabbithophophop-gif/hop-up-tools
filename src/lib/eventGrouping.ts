// 公演（イベント）単位グルーピング — フロント側MVP（案A）
//
// fc_news は「FC2次受付」「当日券販売」「開催決定」等が別レコードに分かれている。
// タイトルから受付種別・枕詞・「〜のお知らせ」等を剥がして「公演キー」を作り、
// 同じキーのレコードを1公演として束ねる。DB は変更しない。
//
// 方針:
// - 地域（＜大阪公演＞ / 東京公演 / in 名古屋 等）は剥がさない＝地域ごとに別公演。
// - 将来は案B（events 親テーブル）へ格上げ余地あり。その際もこのキーを移行の手掛かりに使える。

import { cleanFcTitle } from "./ics";

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
