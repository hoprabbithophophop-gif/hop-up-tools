// 実行: node --experimental-strip-types --test src/lib/icsCore.test.ts
// （このリポジトリには単体テストの実行環境が無かったため、Node組み込みの
//  node:test + 型ストリッピングだけで動かせるようにしている＝新しい依存を増やさない）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderAlarms,
  renderGeo,
  cleanFcTitle,
  DEFAULT_ALARMS,
  geoForLocation,
  mapSearchUrl,
  eventGroupKey,
  eventTwinKey,
  dedupeEventTwins,
  LOCATION_TYPO_FIX,
} from "./icsCore.ts";

test("renderAlarms: undefinedはデフォルト(前日+1h)になる", () => {
  const lines = renderAlarms(undefined);
  assert.equal(lines.filter((l) => l === "BEGIN:VALARM").length, DEFAULT_ALARMS.length);
  assert.ok(lines.some((l) => l === "TRIGGER:-P1D"));
  assert.ok(lines.some((l) => l === "TRIGGER:-PT1H"));
});

test("renderAlarms: 空配列は通知なし", () => {
  assert.deepEqual(renderAlarms([]), []);
});

test("renderAlarms: 改行はICSのエスケープに変換される", () => {
  const lines = renderAlarms([{ trigger: "-PT1H", description: "1行目\n2行目" }]);
  assert.ok(lines.includes("DESCRIPTION:1行目\\n2行目"));
});

test("renderGeo: geo無しは何も出さない", () => {
  assert.deepEqual(renderGeo({ geo: null, location: "武道館" }), []);
});

test("renderGeo: geoありでGEOとAppleの構造化位置情報を出す", () => {
  const lines = renderGeo({ geo: { lat: 35.1, lon: 139.7 }, location: "会場名（東京）" });
  assert.equal(lines[0], "GEO:35.1;139.7");
  assert.ok(lines[1].startsWith("X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-APPLE-RADIUS=200;X-TITLE=\"会場名（東京）\""));
});

test("renderGeo: X-TITLEを壊す文字（引用符・改行）は除去する", () => {
  const lines = renderGeo({ geo: { lat: 1, lon: 2 }, location: 'あ"い\nう' });
  assert.ok(lines[1].includes('X-TITLE="あ い う"'));
});

test("cleanFcTitle: 装飾的な接頭辞・接尾辞・括弧を削る", () => {
  assert.equal(
    cleanFcTitle("★ファンクラブ会員限定イベント★「テスト公演」開催決定！"),
    "テスト公演",
  );
});

test("geoForLocation: 都道府県括弧を除いて辞書引きする", () => {
  const dict = new Map([["有楽町朝日ホール", { lat: 1, lon: 2 }]]);
  assert.deepEqual(geoForLocation("有楽町朝日ホール（東京）", dict), { lat: 1, lon: 2 });
});

test("geoForLocation: 既知の誤字は補正してから辞書引きする", () => {
  const dict = new Map([["有楽町朝日ホール", { lat: 1, lon: 2 }]]);
  assert.deepEqual(geoForLocation("有楽日町朝ホール", dict), { lat: 1, lon: 2 });
  assert.ok(LOCATION_TYPO_FIX["有楽日町朝ホール"] === "有楽町朝日ホール");
});

test("geoForLocation: 辞書に無ければnull", () => {
  assert.equal(geoForLocation("知らない会場", new Map()), null);
});

test("mapSearchUrl: 会場名をGoogleマップ検索URLにする", () => {
  const url = mapSearchUrl("横浜アリーナ（神奈川）");
  assert.ok(url.startsWith("https://www.google.com/maps/search/?api=1&query="));
});

test("eventGroupKey: 受付種別・のお知らせ等を剥がす", () => {
  assert.equal(eventGroupKey("公演タイトル FC2次受付のお知らせ"), "公演タイトル");
});

test("eventTwinKey: 同じ公演キー＋同じ開演時刻なら同じ値", () => {
  const a = { id: "a", type: "event", fc_news: { title: "公演A FC2次受付" }, deadline_at: "2026-08-01T10:00:00+09:00" };
  const b = { id: "b", type: "event", fc_news: { title: "公演A 当日券販売のお知らせ" }, deadline_at: "2026-08-01T10:00:00+09:00" };
  assert.equal(eventTwinKey(a), eventTwinKey(b));
});

test("dedupeEventTwins: 同一公演の重複event行を1本に畳む（タイトルが一番短い方を代表に）", () => {
  const rows = [
    { id: "id-long", type: "event", deadline_at: "2026-08-01T10:00:00+09:00", fc_news: { title: "公演A FC2次受付のお知らせ" } },
    { id: "id-short", type: "event", deadline_at: "2026-08-01T10:00:00+09:00", fc_news: { title: "公演A" } },
    { id: "id-other", type: "apply_end", deadline_at: "2026-07-01T10:00:00+09:00", fc_news: { title: "公演B" } },
  ];
  const { deduped, twinIdsByRepId } = dedupeEventTwins(rows);
  assert.equal(deduped.length, 2); // event代表1件 + apply_end 1件
  const rep = deduped.find((d) => d.type === "event")!;
  assert.equal(rep.id, "id-short");
  assert.deepEqual(new Set(twinIdsByRepId.get("id-short")), new Set(["id-long", "id-short"]));
});
