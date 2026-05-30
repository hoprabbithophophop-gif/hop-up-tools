// 公演（イベント）単位グルーピング — フロント側MVP（案A）
//
// fc_news は「FC2次受付」「当日券販売」「開催決定」等が別レコードに分かれている。
// タイトルから受付種別・枕詞・「〜のお知らせ」等を剥がして「公演キー」を作り、
// 同じキーのレコードを1公演として束ねる。DB は変更しない。
//
// 方針:
// - 地域（＜大阪公演＞ / 東京公演 / in 名古屋 等）は剥がさない＝地域ごとに別公演。
// - 将来は案B（events 親テーブル）へ格上げ余地あり。その際もこのキーを移行の手掛かりに使える。

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
