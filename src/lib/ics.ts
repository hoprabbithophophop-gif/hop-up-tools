export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  dtstart: Date;
  dtend: Date;
}

function formatIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
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
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    "DESCRIPTION:明日が締切です",
    "END:VALARM",
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    "DESCRIPTION:1時間後が締切です",
    "END:VALARM",
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
  return `https://calendar.yahoo.co.jp/?${params.toString()}`;
}

/**
 * 複数イベントを1つのICSにまとめる（購読URL用）
 */
export function generateMultiIcs(events: IcsEvent[]): string {
  const now = formatIcsDate(new Date());

  const veventBlocks = events.flatMap((event) => {
    const start = formatIcsDate(event.dtstart);
    const end = formatIcsDate(event.dtend);
    return [
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${event.summary}`,
      `DESCRIPTION:${event.description.replace(/\n/g, "\\n")}`,
      "BEGIN:VALARM",
      "TRIGGER:-P1D",
      "ACTION:DISPLAY",
      "DESCRIPTION:明日が締切です",
      "END:VALARM",
      "BEGIN:VALARM",
      "TRIGGER:-PT1H",
      "ACTION:DISPLAY",
      "DESCRIPTION:1時間後が締切です",
      "END:VALARM",
      "END:VEVENT",
    ];
  });

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//hop-up-tools//FC Ticket Subscription//JA",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:FC締切リマインダー",
    ...veventBlocks,
    "END:VCALENDAR",
  ].join("\r\n");
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
