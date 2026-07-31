// 実行: TZ=UTC node --experimental-strip-types --test supabase/functions/_shared/icsAssemble.test.ts
//
// TZ=UTC を付けること。Edge Function は世界標準時で動くため、
// 日本時間の開発機で動かすと「日付の切れ目」のずれを見逃す
// （ローカル時刻に依存した書き方をしても、日本時間の機械では偶然通ってしまう）。
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
    fc_news: { title: "テスト公演FC2次受付のお知らせ", detail_url: "https://example.com/n1", category: null },
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
  // 開場時刻が分かっている公演は、これまで通りユーザー設定の時間そのままでよい
  const ev = deadline({ id: "d1", news_uid: "n1", type: "event", deadline_at: "2026-08-01T18:00:00+09:00", open_at: "2026-08-01T17:30:00+09:00" });
  const order = baseOrder({ includedIds: ["d1"], attendingNewsUids: ["n1"], eventLead: { hours: 5, dayBefore: false } });
  const ics = assembleFromOrder(order, [ev], new Map(), NOW);
  assert.ok(ics.includes("TRIGGER:-PT5H"));
});

test("assembleFromOrder: 開場時刻が無い「イベント」種別は、種類の見積もり(45分)ぶん多めに巻き戻す", () => {
  const ev = deadline({
    id: "d1", news_uid: "n1", type: "event", deadline_at: "2026-08-01T18:00:00+09:00", open_at: null,
    fc_news: { title: "テスト", detail_url: "u", category: "イベント" },
  });
  const order = baseOrder({ includedIds: ["d1"], attendingNewsUids: ["n1"], eventLead: { hours: 3, dayBefore: false } });
  const ics = assembleFromOrder(order, [ev], new Map(), NOW);
  // 3時間 + 45分 = 3時間45分
  assert.ok(ics.includes("TRIGGER:-PT3H45M"));
});

test("assembleFromOrder: 開場時刻が無い「コンサート」種別は、種類の見積もり(60分)ぶん多めに巻き戻す", () => {
  const ev = deadline({
    id: "d1", news_uid: "n1", type: "event", deadline_at: "2026-08-01T18:00:00+09:00", open_at: null,
    fc_news: { title: "テスト", detail_url: "u", category: "コンサート" },
  });
  const order = baseOrder({ includedIds: ["d1"], attendingNewsUids: ["n1"], eventLead: { hours: 3, dayBefore: false } });
  const ics = assembleFromOrder(order, [ev], new Map(), NOW);
  // 3時間 + 60分 = 4時間（キリよく巻き戻る）
  assert.ok(ics.includes("TRIGGER:-PT4H"));
});

test("assembleFromOrder: 開場時刻が無く種類も不明な公演は、安全側(60分)にフォールバックする", () => {
  const ev = deadline({
    id: "d1", news_uid: "n1", type: "event", deadline_at: "2026-08-01T18:00:00+09:00", open_at: null,
    fc_news: { title: "テスト", detail_url: "u", category: null },
  });
  const order = baseOrder({ includedIds: ["d1"], attendingNewsUids: ["n1"], eventLead: { hours: 1, dayBefore: false } });
  const ics = assembleFromOrder(order, [ev], new Map(), NOW);
  // 1時間 + 60分 = 2時間
  assert.ok(ics.includes("TRIGGER:-PT2H"));
});

test("assembleFromOrder: 同じ日の2部以降には出発通知が付かない（日本時間で日付を切る）", () => {
  // 朝9時前(JST)開演の公演は、世界標準時で日付を切ると前日扱いになり、
  // 同じ日の2部にも「その日の最初」として出発通知が付いてしまう。
  // JST 2026-08-01 08:00開演（= UTCでは 7/31 23:00）と同日 13:00開演の2本で確認する。
  const p1 = deadline({
    id: "p1", news_uid: "n1", type: "event", deadline_at: "2026-08-01T08:00:00+09:00",
    fc_news: { title: "テスト公演 1部", detail_url: "u", category: "イベント" },
  });
  const p2 = deadline({
    id: "p2", news_uid: "n1", type: "event", deadline_at: "2026-08-01T13:00:00+09:00",
    fc_news: { title: "テスト公演 2部", detail_url: "u", category: "イベント" },
  });
  const order = baseOrder({ includedIds: ["p1", "p2"], attendingNewsUids: ["n1"], eventLead: { hours: 2, dayBefore: false } });
  const ics = assembleFromOrder(order, [p1, p2], new Map(), NOW);
  // 出発通知は1本だけ（＝その日の最初の公演のみ）
  assert.equal((ics.match(/そろそろお出かけの時間です/g) ?? []).length, 1);
});

test("assembleFromOrder: 入金締切の通知は締切日の21時(JST)と前日21時に固定される", () => {
  // 記事に入金締切の時刻が書かれていないことが多く、23:59は既定値でしかない。
  // 相対指定だと締切時刻のブレが通知時刻に伝わるため、21時固定にしている。
  const dl = deadline({ id: "d1", type: "payment", label: "入金締切", deadline_at: "2026-08-05T23:59:00+09:00" });
  const order = baseOrder({ includedIds: ["d1"], retention: "forever" });
  const ics = assembleFromOrder(order, [dl], new Map(), NOW);
  // 21:00 JST = 12:00 UTC
  assert.ok(ics.includes("TRIGGER;VALUE=DATE-TIME:20260804T120000Z"), "前日21時の通知が無い");
  assert.ok(ics.includes("TRIGGER;VALUE=DATE-TIME:20260805T120000Z"), "当日21時の通知が無い");
  assert.ok(ics.includes("本日が入金締切です"));
  assert.ok(ics.includes("明日が入金締切です"));
});

test("assembleFromOrder: 入金締切が昼など21時に間に合わない場合は従来の相対指定に戻す", () => {
  const dl = deadline({ id: "d1", type: "payment", label: "入金締切", deadline_at: "2026-08-05T12:00:00+09:00" });
  const order = baseOrder({ includedIds: ["d1"], retention: "forever" });
  const ics = assembleFromOrder(order, [dl], new Map(), NOW);
  assert.ok(ics.includes("TRIGGER;VALUE=DATE-TIME:20260804T120000Z"), "前日21時の通知は出るはず");
  assert.ok(!ics.includes("TRIGGER;VALUE=DATE-TIME:20260805T120000Z"), "締切を過ぎた時刻に通知してはいけない");
  assert.ok(ics.includes("TRIGGER:-PT1H"), "当日分の代わりの相対通知が無い");
});

test("assembleFromOrder: 申込締切・当落確認は記事に実時刻があるので相対指定のまま", () => {
  const dl = deadline({ id: "d1", type: "apply_end", label: "申込締切", deadline_at: "2026-08-05T17:00:00+09:00" });
  const order = baseOrder({ includedIds: ["d1"], retention: "forever" });
  const ics = assembleFromOrder(order, [dl], new Map(), NOW);
  assert.ok(ics.includes("TRIGGER:-P1D"));
  assert.ok(ics.includes("TRIGGER:-PT1H"));
  assert.ok(!ics.includes("TRIGGER;VALUE=DATE-TIME"), "絶対時刻の通知が混ざっている");
});

test("assembleFromOrder: 同一公演の双子(event)は1本に畳まれる", () => {
  const a = deadline({ id: "a", news_uid: "n1", type: "event", deadline_at: "2026-08-01T18:00:00+09:00", fc_news: { title: "公演X FC2次受付のお知らせ", detail_url: "u", category: null } });
  const b = deadline({ id: "b", news_uid: "n1", type: "event", deadline_at: "2026-08-01T18:00:00+09:00", fc_news: { title: "公演X", detail_url: "u", category: null } });
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
    "after-event-1m",
  );
  assert.ok(ics.includes("UID:u1@x"));
  assert.ok(ics.includes("SUMMARY:S"));
});

test("buildIcsLegacyFromEvents: 旧形式でも保持期限を過ぎた予定は落とす（注文票ルートと同じ扱い）", () => {
  // これが無いと、購読者のカレンダーに終わった予定が全部戻ってしまう（2026-08-01に実際に起きた）
  const ics = buildIcsLegacyFromEvents(
    [
      { uid: "old@x", summary: "終わった予定", dtstart: "2020-01-01T09:00:00Z", dtend: "2020-01-01T10:00:00Z" },
      { uid: "new@x", summary: "これからの予定", dtstart: "2026-08-01T09:00:00Z", dtend: "2026-08-01T10:00:00Z" },
    ],
    new Map(),
    NOW,
    "after-event-1m",
  );
  assert.ok(!ics.includes("UID:old@x"), "保持期限を過ぎた予定が残っている");
  assert.ok(ics.includes("UID:new@x"));
});

test("buildIcsLegacyFromEvents: forever指定なら旧形式でも古い予定を残す", () => {
  const ics = buildIcsLegacyFromEvents(
    [{ uid: "old@x", summary: "終わった予定", dtstart: "2020-01-01T09:00:00Z", dtend: "2020-01-01T10:00:00Z" }],
    new Map(),
    NOW,
    "forever",
  );
  assert.ok(ics.includes("UID:old@x"));
});
