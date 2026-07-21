// 実行: node --experimental-strip-types --test supabase/functions/_shared/icsAssemble.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleFromOrder, buildIcsLegacyFromEvents, type DeadlineRow } from "./icsAssemble.ts";
import type { OrderTicket } from "./icsCore.ts";

const NOW = new Date("2026-07-22T00:00:00Z");

function baseOrder(over: Partial<OrderTicket> = {}): OrderTicket {
  return {
    v: 2,
    includedIds: [],
    retention: "after-event-1m",
    eventLead: { hours: 3, dayBefore: false },
    eventLeadOverrides: {},
    attendingNewsUids: [],
    ...over,
  };
}

function deadline(over: Partial<DeadlineRow>): DeadlineRow {
  return {
    id: "d1",
    news_uid: "n1",
    type: "apply_end",
    label: "申込締切",
    deadline_at: "2026-08-01T10:00:00+09:00",
    location: null,
    open_at: null,
    fc_news: { title: "テスト公演FC2次受付のお知らせ", detail_url: "https://example.com/n1" },
    ...over,
  };
}

test("assembleFromOrder: 含めたidだけがVEVENTになる", () => {
  const dl1 = deadline({ id: "d1", news_uid: "n1" });
  const dl2 = deadline({ id: "d2", news_uid: "n2", label: "対象外" });
  const order = baseOrder({ includedIds: ["d1"] });
  const ics = assembleFromOrder(order, [dl1, dl2], new Map(), NOW);
  assert.ok(ics.includes("UID:d1@hop-up-tools"));
  assert.ok(!ics.includes("UID:d2@hop-up-tools"));
});

test("assembleFromOrder: 保持期限を過ぎた予定は除外する", () => {
  const past = deadline({ id: "d1", deadline_at: "2020-01-01T10:00:00+09:00" });
  const order = baseOrder({ includedIds: ["d1"], retention: "after-event-1m" });
  const ics = assembleFromOrder(order, [past], new Map(), NOW);
  assert.ok(!ics.includes("UID:d1@hop-up-tools"));
});

test("assembleFromOrder: forever指定なら古い予定でも残す", () => {
  const past = deadline({ id: "d1", deadline_at: "2020-01-01T10:00:00+09:00" });
  const order = baseOrder({ includedIds: ["d1"], retention: "forever" });
  const ics = assembleFromOrder(order, [past], new Map(), NOW);
  assert.ok(ics.includes("UID:d1@hop-up-tools"));
});

test("assembleFromOrder: 公演(event)は行く判定(attendingNewsUids)が無いと出発通知が付かない", () => {
  const ev = deadline({ id: "d1", news_uid: "n1", type: "event", deadline_at: "2026-08-01T18:00:00+09:00" });
  const order = baseOrder({ includedIds: ["d1"], attendingNewsUids: [] });
  const ics = assembleFromOrder(order, [ev], new Map(), NOW);
  const vevent = ics.split("BEGIN:VEVENT")[1];
  assert.ok(!vevent.includes("BEGIN:VALARM"));
});

test("assembleFromOrder: 公演でattendingNewsUidsに入っていれば出発通知(ユーザー設定の◯時間前)が付く", () => {
  const ev = deadline({ id: "d1", news_uid: "n1", type: "event", deadline_at: "2026-08-01T18:00:00+09:00" });
  const order = baseOrder({ includedIds: ["d1"], attendingNewsUids: ["n1"], eventLead: { hours: 5, dayBefore: false } });
  const ics = assembleFromOrder(order, [ev], new Map(), NOW);
  assert.ok(ics.includes("TRIGGER:-PT5H"));
});

test("assembleFromOrder: 同一公演の双子(event)は1本に畳まれる", () => {
  const a = deadline({ id: "a", news_uid: "n1", type: "event", deadline_at: "2026-08-01T18:00:00+09:00", fc_news: { title: "公演X FC2次受付のお知らせ", detail_url: "u" } });
  const b = deadline({ id: "b", news_uid: "n1", type: "event", deadline_at: "2026-08-01T18:00:00+09:00", fc_news: { title: "公演X", detail_url: "u" } });
  const order = baseOrder({ includedIds: ["a", "b"] });
  const ics = assembleFromOrder(order, [a, b], new Map(), NOW);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
});

test("assembleFromOrder: 締切の1時間前〜締切、公演は開演〜2時間の予定になる", () => {
  const dl = deadline({ id: "d1", deadline_at: "2026-08-01T10:00:00+09:00" });
  const order = baseOrder({ includedIds: ["d1"] });
  const ics = assembleFromOrder(order, [dl], new Map(), NOW);
  assert.ok(ics.includes("DTSTART:20260801T000000Z")); // 10:00 JST - 1h = 09:00 JST = 00:00 UTC
  assert.ok(ics.includes("DTEND:20260801T010000Z"));
});

test("assembleFromOrder: 会場座標が引ければGEO行が付く", () => {
  const dl = deadline({ id: "d1", location: "テスト会場（東京）" });
  const order = baseOrder({ includedIds: ["d1"] });
  const dict = new Map([["テスト会場", { lat: 35.0, lon: 139.0 }]]);
  const ics = assembleFromOrder(order, [dl], dict, NOW);
  assert.ok(ics.includes("GEO:35;139"));
});

test("buildIcsLegacyFromEvents: 旧形式(events配列)も従来通り組み立てられる", () => {
  const ics = buildIcsLegacyFromEvents(
    [{ uid: "u1@x", summary: "S", dtstart: "2026-08-01T09:00:00Z", dtend: "2026-08-01T10:00:00Z" }],
    new Map(),
    NOW,
  );
  assert.ok(ics.includes("UID:u1@x"));
  assert.ok(ics.includes("SUMMARY:S"));
});
