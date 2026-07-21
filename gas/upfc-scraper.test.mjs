// 実行: node --test gas/upfc-scraper.test.mjs
//
// gas/upfc-scraper.js は GAS(Google Apps Script) のグローバルスコープ前提のスクリプトで、
// module.exports/import を持たない（clasp push でそのまま Apps Script に渡すため、
// テストのために書き換えない）。Node の vm で GAS と同じグローバルスコープとして読み込み、
// 関数を取り出してテストする。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scraperSrc = readFileSync(join(__dirname, "upfc-scraper.js"), "utf8");

function loadScraper() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(scraperSrc, sandbox, { filename: "upfc-scraper.js" });
  return sandbox;
}

// トップレベルの const/let はサンドボックスのプロパティにならない（function宣言だけがなる）ため、
// 同じコンテキストで追加の式を評価して値を取り出す。
function readScraperConst(sandbox, name) {
  return vm.runInContext(name, sandbox);
}

function baseArticle(title) {
  return {
    uid: "TESTUID",
    title,
    category: "イベント",
    detail_url: "https://www.upfc.jp/helloproject/news_detail.php?@uid=TESTUID",
  };
}

test("parseDeadlinesFromHtml: 全角山括弧＋全角コロンの公演番号ブロック(エムハロvol.10の実記事)から開場・開演を両方拾える", () => {
  const { parseDeadlinesFromHtml } = loadScraper();
  const html = readFileSync(join(__dirname, "fixtures", "upfc-emuharo-vol10.html"), "utf8");
  const article = {
    uid: "MXM2wVF970T7aaQW",
    title: "『エムハロイベントvol.10～中島早貴×OCHA NORMA窪田七海～』当日券予約受付のお知らせ",
    category: "イベント",
    detail_url: "https://www.upfc.jp/helloproject/news_detail.php?@uid=MXM2wVF970T7aaQW",
  };
  const deadlines = parseDeadlinesFromHtml(article, html);
  const events = deadlines.filter((d) => d.type === "event");
  assert.equal(events.length, 2, "2部制なのでevent行は2件のはず");

  const p1 = events.find((e) => e.part_no === 1);
  const p2 = events.find((e) => e.part_no === 2);
  assert.ok(p1, "公演番号01（＜公演番号01＞）が取れていない");
  assert.ok(p2, "公演番号02（＜公演番号02＞）が取れていない");

  // 記事本文（全角）: ＜公演番号01＞開場 16：40/開演 17：10
  assert.equal(p1.open_at, new Date(Date.UTC(2026, 5, 11, 16 - 9, 40)).toISOString());
  assert.equal(p1.deadline_at, new Date(Date.UTC(2026, 5, 11, 17 - 9, 10)).toISOString());
  // 記事本文（全角）: ＜公演番号02＞開場 18：45/開演 19：15
  assert.equal(p2.open_at, new Date(Date.UTC(2026, 5, 11, 18 - 9, 45)).toISOString());
  assert.equal(p2.deadline_at, new Date(Date.UTC(2026, 5, 11, 19 - 9, 15)).toISOString());
});

test("parseDeadlinesFromHtml: 下ごしらえを入れても、これまで通りの半角【】表記は変わらず拾える（回帰確認）", () => {
  const { parseDeadlinesFromHtml } = loadScraper();
  const html =
    "<p>日程：2026年7月20日（月）</p>" +
    "<p>【公演番号01】開場 15:00/開演 15:30</p>";
  const article = baseArticle("★ファンクラブ会員限定イベント★「テスト太郎バースデーイベント2026」開催決定！");
  const deadlines = parseDeadlinesFromHtml(article, html);
  const events = deadlines.filter((d) => d.type === "event");
  assert.equal(events.length, 1);
  assert.equal(events[0].open_at, new Date(Date.UTC(2026, 6, 20, 15 - 9, 0)).toISOString());
  assert.equal(events[0].deadline_at, new Date(Date.UTC(2026, 6, 20, 15 - 9, 30)).toISOString());
});

test("parseDeadlinesFromHtml: 全角数字だらけの日程・公演番号・時刻でも拾える", () => {
  const { parseDeadlinesFromHtml } = loadScraper();
  const html =
    "<p>日程：２０２６年８月５日（水）</p>" +
    "<p>【公演番号０１】開場１６：００/開演１６：３０</p>";
  const article = baseArticle("★ファンクラブ会員限定イベント★「テスト花子バースデーイベント2026」開催決定！");
  const deadlines = parseDeadlinesFromHtml(article, html);
  const events = deadlines.filter((d) => d.type === "event");
  assert.equal(events.length, 1);
  assert.equal(events[0].part_no, 1);
  assert.equal(events[0].open_at, new Date(Date.UTC(2026, 7, 5, 16 - 9, 0)).toISOString());
  assert.equal(events[0].deadline_at, new Date(Date.UTC(2026, 7, 5, 16 - 9, 30)).toISOString());
});

test("parseDeadlinesFromHtml: 会場名の文字は正規化しない（照合用コピーだけを使い、棚に保存する文字は変えない）", () => {
  const { parseDeadlinesFromHtml } = loadScraper();
  const html =
    "<p>日程：2026年7月20日（月）</p>" +
    "<p>【公演番号01】開場 15:00/開演 15:30</p>" +
    "<p>会場：第１ホール （東京）</p>";
  const article = baseArticle("★ファンクラブ会員限定イベント★「テスト太郎バースデーイベント2026」開催決定！");
  const deadlines = parseDeadlinesFromHtml(article, html);
  const events = deadlines.filter((d) => d.type === "event");
  assert.equal(events.length, 1);
  // 全角の「１」がそのまま残っていること（照合用の正規化が会場名に漏れていないこと）の確認
  assert.ok(events[0].location.includes("第１ホール"), `location=${events[0].location}`);
});

test("UF_BACKFILL_TARGETS: 名指し読み直しの対象は24件・重複UIDなし・タイトル欠けなし", () => {
  const sandbox = loadScraper();
  const targets = readScraperConst(sandbox, "UF_BACKFILL_TARGETS");
  assert.equal(targets.length, 24);
  const uids = targets.map((t) => t.uid);
  assert.equal(new Set(uids).size, 24, "UIDの重複がある");
  assert.ok(targets.every((t) => t.title && t.category), "titleまたはcategoryが空の行がある");
  // (a)の抽出パターン対象(エムハロvol.10)が含まれていることの確認
  assert.ok(uids.includes("MXM2wVF970T7aaQW"));
});
