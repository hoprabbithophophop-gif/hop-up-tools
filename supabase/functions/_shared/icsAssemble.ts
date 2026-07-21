// 購読ICSの組み立て役（唯一のレシピ・サーバー側一本化）。
// fc-ics-upload（即時発行）と fc-ics-regen（毎日の作り直し）の両方が、
// このファイルを自分の files に同梱してデプロイする（デプロイのたびに同じ内容を渡す＝分岐しない）。
//
// ここより下の純粋な部品（VALARM/GEOの行、公演グルーピング、cleanFcTitle等）は
// ./icsCore.ts を参照。icsCore.ts は src/lib/icsCore.ts のコピーで、
// scripts/sync-ics-shared.mjs が同期する（手で編集しない）。
import {
  formatIcsDate,
  renderGeo,
  renderAlarms,
  cleanFcTitle,
  geoForLocation,
  mapSearchUrl,
  eventGroupKey,
  eventTwinKey,
  dedupeEventTwins,
  type IcsAlarm,
  type VenueGeo,
  type EventLeadSetting,
  type OrderTicket,
  type RetentionMode,
} from "./icsCore.ts";

// ─── サーバーが読み直す締切1件分（fc_deadlines + fc_news 由来） ───

export interface DeadlineRow {
  id: string;
  news_uid: string;
  type: string;
  label: string;
  deadline_at: string;
  location: string | null;
  open_at: string | null;
  fc_news: { title: string; detail_url: string; category: string | null };
}

const RETENTION_WINDOW_MS: Record<Exclude<RetentionMode, "forever">, number> = {
  "after-event-1m": 31 * 24 * 3600 * 1000,
  "6m": 184 * 24 * 3600 * 1000,
};

// 開場時刻が取れていない公演で「仮の開場」を見積もるための、開演からの巻き戻り分数。
// 2026-07-22時点のfc_deadlines実データ（開場・開演が両方入っている行、n=90）から、
// 種類(fc_news.category)ごとの「実測の最大の開場〜開演差分」を採用（安全側＝多めに見積もる）。
//   イベント　　: 実測 最大45分・平均37.6分・中央値40分 (n=86) → 45分を採用
//   コンサート　: 実測 最大60分・平均48.8分・中央値52.5分 (n=4、サンプル少) → 60分を採用
// 未知の種類・未対応の種類は、この中で一番安全側（大きい）の60分にフォールバックする。
// 数値がずれてきたと感じたら、ここだけ直せばよい。
const ASSUMED_DOORS_GAP_MIN: Record<string, number> = {
  "イベント": 45,
  "コンサート": 60,
};
const DEFAULT_ASSUMED_DOORS_GAP_MIN = 60;

function doorsGapMinutes(category: string | null | undefined): number {
  return ASSUMED_DOORS_GAP_MIN[category ?? ""] ?? DEFAULT_ASSUMED_DOORS_GAP_MIN;
}

// 分数 → ICSのTRIGGER値（例: 225分 → "-PT3H45M"、180分 → "-PT3H"、45分 → "-PT45M"）
function minutesToTrigger(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `-PT${m}M`;
  if (m === 0) return `-PT${h}H`;
  return `-PT${h}H${m}M`;
}

// 種類＋状況 → 通知(VALARM)配列。クライアント(旧 FcTicketPage.tsx)から移設。
// isAttending=実際に行く公演か（当選/入金済）。出発通知は行く公演にだけ出す。
function alarmsForDeadline(
  type: string,
  isFirstShowOfDay: boolean,
  eventLeadAlarms: IcsAlarm[],
  isAttending: boolean,
): IcsAlarm[] {
  switch (type) {
    case "apply_end":
      return [{ trigger: "-P1D", description: "明日が申込締切です" }, { trigger: "-PT1H", description: "まもなく申込締切です" }];
    case "payment":
      return [{ trigger: "-P1D", description: "明日が入金締切です" }, { trigger: "-PT1H", description: "まもなく入金締切です" }];
    case "sale_end":
    case "goods_sale_end":
      return [{ trigger: "-P1D", description: "明日がグッズ締切です" }];
    case "result":
      return [{ trigger: "-P1D", description: "明日 当落発表です" }];
    case "apply_start":
      return [{ trigger: "-PT1H", description: "まもなく申込開始です" }];
    case "sale_start":
      return [{ trigger: "-PT1H", description: "まもなくグッズ販売開始です" }];
    case "payment_start":
      return [{ trigger: "-PT1H", description: "まもなく入金開始です" }];
    case "event":
      // 公演＝出発通知。行く公演(当選/入金済)・その日の最初の公演だけに出す。
      if (!isAttending || !isFirstShowOfDay) return [];
      return eventLeadAlarms;
    default:
      return [{ trigger: "-P1D", description: "明日が締切です" }, { trigger: "-PT1H", description: "まもなく締切です" }];
  }
}

// 公演の出発通知(VALARM)。前日分も「その日の最初の公演・行く公演」ルールに従う。
// extraGapMin: 開場時刻が分かっている公演は0（DTSTART=開場そのものなので調整不要）。
// 開場時刻が取れていない公演は、種類に応じた「仮の開場」ぶん(doorsGapMinutes)を
// DTSTART(=開演)からさらに巻き戻して、開場基準のつもりの通知時刻に近づける。
function eventAlarms(lead: EventLeadSetting, extraGapMin: number): IcsAlarm[] {
  const alarms: IcsAlarm[] = [];
  if (lead.dayBefore) alarms.push({ trigger: "-P1D", description: "明日が公演です" });
  if (lead.hours != null) {
    alarms.push({ trigger: minutesToTrigger(lead.hours * 60 + extraGapMin), description: "そろそろお出かけの時間です（本日公演）" });
  }
  return alarms;
}

// 公演の予定メモに入れる開場・開演の行（開場が取れている公演のみ）
// 表示はJST固定（サーバーの実行タイムゾーンに依存させない）
function doorsLine(dl: DeadlineRow): string {
  if (dl.type !== "event" || !dl.open_at) return "";
  const fmt = (d: Date) => d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });
  return "\n開場 " + fmt(new Date(dl.open_at)) + " / 開演 " + fmt(new Date(dl.deadline_at));
}

function settingsUrlFor(title: string): string {
  return "https://hop-up-tools.pages.dev/fc-ticket?tab=subscribe&focus=" + encodeURIComponent(eventGroupKey(title));
}

/** dl 1件の開始・終了時刻。公演は「開演(開場があれば開場)〜2時間」、締切類は「締切の1時間前〜締切」。 */
function computeTimes(dl: DeadlineRow): { dtstart: Date; dtend: Date; isEvent: boolean } {
  const at = new Date(dl.deadline_at);
  const isEvent = dl.type === "event";
  if (isEvent) {
    const openAt = dl.open_at ? new Date(dl.open_at) : null;
    return { dtstart: openAt ?? at, dtend: new Date(at.getTime() + 7200000), isEvent };
  }
  return { dtstart: new Date(at.getTime() - 3600000), dtend: at, isEvent };
}

function calendarWrap(veventBlocks: string[]): string {
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
 * 注文票＋最新の締切データから、購読ICSを丸ごと組み立てる（作り直し方式の本体）。
 * - deadlineRows は order.includedIds に対応する fc_deadlines の「今の」内容（呼び出し側が都度SELECTする）
 * - 保持期限を過ぎた予定・存在しなくなった予定（記事削除等）は自然に除外される
 */
export function assembleFromOrder(
  order: OrderTicket,
  deadlineRows: DeadlineRow[],
  venueGeoByName: Map<string, VenueGeo>,
  now: Date,
): string {
  const includedSet = new Set(order.includedIds);
  const rows = deadlineRows.filter((dl) => includedSet.has(dl.id));

  const { deduped } = dedupeEventTwins(rows);

  const windowMs = order.retention === "forever" ? null : RETENTION_WINDOW_MS[order.retention];
  const kept = deduped.filter((dl) => {
    if (windowMs == null) return true;
    const { dtend } = computeTimes(dl);
    return dtend.getTime() + windowMs >= now.getTime();
  });

  // 同日の公演のうち最も早い1件だけ出発通知の対象に（2部以降は会場に居るので通知なし）
  const firstEventByDate = new Map<string, string>();
  for (const dl of kept) {
    if (dl.type !== "event") continue;
    const d = new Date(dl.deadline_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const cur = firstEventByDate.get(key);
    if (!cur || new Date(dl.deadline_at) < new Date(kept.find((x) => x.id === cur)!.deadline_at)) {
      firstEventByDate.set(key, dl.id);
    }
  }
  const firstEventIds = new Set(firstEventByDate.values());

  const attending = new Set(order.attendingNewsUids);
  const leadAlarmsFor = (dl: DeadlineRow) => {
    const lead = order.eventLeadOverrides[eventTwinKey(dl)] ?? order.eventLead;
    const extraGapMin = dl.open_at ? 0 : doorsGapMinutes(dl.fc_news.category);
    return eventAlarms(lead, extraGapMin);
  };

  const now_ = formatIcsDate(now);
  const veventBlocks = kept.flatMap((dl) => {
    const { dtstart, dtend, isEvent } = computeTimes(dl);
    const geo = geoForLocation(dl.location, venueGeoByName);
    const alarms = alarmsForDeadline(
      dl.type,
      isEvent && firstEventIds.has(dl.id),
      leadAlarmsFor(dl),
      attending.has(dl.news_uid),
    );
    const description =
      dl.fc_news.title +
      doorsLine(dl) +
      "\n" +
      dl.fc_news.detail_url +
      (dl.location && !geo ? "\n地図で探す: " + mapSearchUrl(dl.location) : "") +
      "\n\n通知の変更: " + settingsUrlFor(dl.fc_news.title);
    return [
      "BEGIN:VEVENT",
      `UID:${dl.id}@hop-up-tools`,
      `DTSTAMP:${now_}`,
      `DTSTART:${formatIcsDate(dtstart)}`,
      `DTEND:${formatIcsDate(dtend)}`,
      `SUMMARY:【${dl.label}】${cleanFcTitle(dl.fc_news.title)}`,
      `DESCRIPTION:${description.replace(/\n/g, "\\n")}`,
      ...(dl.location ? [`LOCATION:${dl.location}`] : []),
      ...renderGeo({ geo, location: dl.location }),
      ...renderAlarms(alarms),
      "END:VEVENT",
    ];
  });

  return calendarWrap(veventBlocks);
}

// ─── 旧形式（発行時にブラウザが完成品を焼き込んだ events 配列）互換ルート ───
//
// v=2（注文票）が無い既存の購読はこちらで組み立てる。新しい発行では二度と作らない。
// 中身は移行前の fc-ics-regen の buildIcs と同じ（座標の後追い補完のみ行う）。

interface LegacyEv {
  uid: string;
  summary: string;
  description?: string;
  dtstart: string;
  dtend: string;
  location?: string | null;
  geo?: VenueGeo | null;
  alarms?: IcsAlarm[];
}

export function buildIcsLegacyFromEvents(
  events: LegacyEv[],
  venueGeoByName: Map<string, VenueGeo>,
  now: Date,
): string {
  const now_ = formatIcsDate(now);
  const blocks = events.flatMap((e) => {
    const geo = (e.geo && typeof e.geo.lat === "number") ? e.geo : geoForLocation(e.location, venueGeoByName);
    return [
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${now_}`,
      `DTSTART:${formatIcsDate(new Date(e.dtstart))}`,
      `DTEND:${formatIcsDate(new Date(e.dtend))}`,
      `SUMMARY:${e.summary}`,
      `DESCRIPTION:${String(e.description ?? "").replace(/\n/g, "\\n")}`,
      ...(e.location ? [`LOCATION:${e.location}`] : []),
      ...renderGeo({ geo, location: e.location }),
      ...renderAlarms(e.alarms),
      "END:VEVENT",
    ];
  });
  return calendarWrap(blocks);
}

export type { OrderTicket, EventLeadSetting, RetentionMode, VenueGeo, IcsAlarm };
