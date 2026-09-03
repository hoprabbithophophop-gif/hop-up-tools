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
  // GAS だけに存在するグローバル。抽出処理が動作ログを残すために使うので、
  // テストでは記録するだけのダミーを置く（sandbox.__logs で内容を確認できる）。
  const logs = [];
  const sandbox = { Logger: { log: (m) => logs.push(String(m)) }, __logs: logs };
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

// ─── グッズ通販の締切（2026-07-07 のFCショップ移転後の書式）────────────────

function goodsArticle(title) {
  return {
    uid: "GOODSUID",
    title,
    category: "グッズ",
    detail_url: "https://www.upfc.jp/helloproject/news_detail.php?@uid=GOODSUID",
  };
}

test("parseDeadlinesFromHtml: 移転後の個別グッズ記事(実記事)から通販開始と通販締切を両方拾える", () => {
  const { parseDeadlinesFromHtml } = loadScraper();
  const html = readFileSync(join(__dirname, "fixtures", "upfc-goods-kubota.html"), "utf8");
  const article = goodsArticle("OCHA NORMA 窪田七海バースデーイベント2026 オリジナルグッズ公開！");
  const deadlines = parseDeadlinesFromHtml(article, html);

  const start = deadlines.find((d) => d.type === "goods_sale_start");
  const end = deadlines.find((d) => d.type === "goods_sale_end");
  assert.ok(start, "通販開始(goods_sale_start)が取れていない");
  assert.ok(end, "通販締切(goods_sale_end)が取れていない");
  // 本文: 販売開始日：2026年7月17日（金）18：00 / 受付締切日：2026年8月7日（金）23：59
  assert.equal(start.deadline_at, new Date(Date.UTC(2026, 6, 17, 18 - 9, 0)).toISOString());
  assert.equal(end.deadline_at, new Date(Date.UTC(2026, 7, 7, 23 - 9, 59)).toISOString());
  // グッズ記事の締切がチケットの申込締切として登録されないこと
  assert.ok(!deadlines.some((d) => d.type === "apply_end"), "apply_end が混ざっている");
});

test("parseDeadlinesFromHtml: 移転前の月次まとめ通販(申込開始日/申込締切日)は引き続き拾える（回帰確認）", () => {
  const { parseDeadlinesFromHtml } = loadScraper();
  const html =
    "<p>申込開始日：2026年6月1日（月）18:00</p>" +
    "<p>申込締切日：2026年6月26日（金）23:59</p>";
  const article = goodsArticle("6/1(月）受付スタート 6月通販公開！");
  const deadlines = parseDeadlinesFromHtml(article, html);
  assert.equal(deadlines.length, 2);
  assert.equal(
    deadlines.find((d) => d.type === "goods_sale_start").deadline_at,
    new Date(Date.UTC(2026, 5, 1, 18 - 9, 0)).toISOString(),
  );
  assert.equal(
    deadlines.find((d) => d.type === "goods_sale_end").deadline_at,
    new Date(Date.UTC(2026, 5, 26, 23 - 9, 59)).toISOString(),
  );
});

test("parseDeadlinesFromHtml: 移転後の月次まとめ通販(販売開始日/受付締切日)も拾える", () => {
  const { parseDeadlinesFromHtml } = loadScraper();
  const html =
    "<p>販売開始日：2026年7月7日（火）18:00</p>" +
    "<p>受付締切日：2026年7月28日（火）23：59</p>";
  const article = goodsArticle("7/7(火）受付スタート 7月通販公開！");
  const deadlines = parseDeadlinesFromHtml(article, html);
  assert.equal(
    deadlines.find((d) => d.type === "goods_sale_end").deadline_at,
    new Date(Date.UTC(2026, 6, 28, 23 - 9, 59)).toISOString(),
  );
});

test("parseDeadlinesFromHtml: 26イベント分が並ぶグッズ一覧記事(実記事)は丸ごと見送る", () => {
  const { parseDeadlinesFromHtml } = loadScraper();
  const html = readFileSync(join(__dirname, "fixtures", "upfc-goods-masterlist.html"), "utf8");
  const article = goodsArticle("ファンクラブショップ 受付締切日・商品お届け予定日のお知らせ");
  const deadlines = parseDeadlinesFromHtml(article, html);
  // 先頭1件だけを「この記事の締切」として保存すると誤りになるので0件が正しい。
  // 過去には本文中の「申込締切日」が拾われて apply_end として誤登録されていた。
  assert.equal(deadlines.length, 0, `見送られていない: ${JSON.stringify(deadlines)}`);
});

// 開場時刻の名指し読み直し(UFbackfillOpenAt)は 2026-09-04 に役目を終えて gas/archive/ へ移した。
// 対象リストの整合性チェックは、また使うときに壊れていないか分かるよう保管庫側を読んで続ける。
test("UF_BACKFILL_TARGETS(保管庫): 名指し読み直しの対象は24件・重複UIDなし・タイトル欠けなし", () => {
  const sandbox = loadScraper();
  const archiveSrc = readFileSync(join(__dirname, "archive", "upfc-backfill-open-at.js"), "utf8");
  vm.runInContext(archiveSrc, sandbox, { filename: "archive/upfc-backfill-open-at.js" });
  const targets = readScraperConst(sandbox, "UF_BACKFILL_TARGETS");
  assert.equal(targets.length, 24);
  const uids = targets.map((t) => t.uid);
  assert.equal(new Set(uids).size, 24, "UIDの重複がある");
  assert.ok(targets.every((t) => t.title && t.category), "titleまたはcategoryが空の行がある");
  // (a)の抽出パターン対象(エムハロvol.10)が含まれていることの確認
  assert.ok(uids.includes("MXM2wVF970T7aaQW"));
});
