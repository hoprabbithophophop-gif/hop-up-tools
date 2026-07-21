// 単発の「カレンダーに追加」（1件だけの即時ダウンロード・外部カレンダーURL）用。
// ブラウザ専用のAPI（Blob / crypto.getRandomValues の対話的利用）を使う関数はここに置く。
// 純粋な組み立て部品（VALARM/GEOの行、公演グルーピング等）は ./icsCore を参照。
// 複数予定をまとめる購読用ICSの組み立ては、サーバー側 (supabase/functions/_shared/icsAssemble.ts)
// に一本化した（案1・組み立て役の一本化）。ここでは作らない。
import {
  formatIcsDate,
  DEFAULT_ALARMS,
  renderGeo,
  renderAlarms,
  cleanFcTitle,
  type IcsAlarm,
  type IcsGeo,
} from "./icsCore";

export type { IcsAlarm, IcsGeo };
export { cleanFcTitle, renderGeo, renderAlarms, DEFAULT_ALARMS };

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  dtstart: Date;
  dtend: Date;
  location?: string | null;
  // 会場座標。指定時は GEO + Apple構造化位置情報を出力（地図タップ・経路案内が効く）
  geo?: IcsGeo | null;
  // 通知。未指定→締切系デフォルト(前日+1h)でフォールバック。空配列[]→通知なし。
  alarms?: IcsAlarm[];
}

export function generateIcs(event: IcsEvent): string {
  const now = formatIcsDate(new Date());
  const start = formatIcsDate(event.dtstart);
  const end = formatIcsDate(event.dtend);

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//hop-up-tools//FC Ticket Reminder//JA",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${event.summary}`,
    `DESCRIPTION:${event.description.replace(/\n/g, "\\n")}`,
    ...(event.location ? [`LOCATION:${event.location}`] : []),
    ...renderGeo(event),
    ...renderAlarms(event.alarms),
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function generateGoogleCalendarUrl(event: IcsEvent): string {
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.summary,
    dates: `${fmt(event.dtstart)}/${fmt(event.dtend)}`,
    details: event.description,
  });
  if (event.location) params.set("location", event.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function generateYahooCalendarUrl(event: IcsEvent): string {
  // Yahoo!カレンダーは JST のローカル時刻で指定
  const fmt = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds())
    );
  };
  const params = new URLSearchParams({
    v: "60",
    TITLE: event.summary,
    ST: fmt(event.dtstart),
    ET: fmt(event.dtend),
    DESC: event.description,
  });
  if (event.location) params.set("in_loc", event.location);
  return `https://calendar.yahoo.co.jp/?${params.toString()}`;
}

/**
 * 32文字の小文字英数字スラグを生成（推測不可なURL用）
 */
export function generateSubscriptionSlug(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function downloadIcs(ics: string, filename: string): void {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
