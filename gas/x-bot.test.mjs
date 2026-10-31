// 実行: node --test gas/x-bot.test.mjs
//
// gas/x-bot.js と gas/x-gateway.js は GAS のグローバルスコープ前提のスクリプトなので、
// upfc-scraper.test.mjs と同じく Node の vm で読み込み、関数を取り出して確かめる。
// 締切のデータはテスト用に作った物だけを使う（公式ページの中身は使わない）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));

function load(file, extra = {}) {
  const props = {};
  const logs = [];
  const sandbox = {
    Logger: { log: (m) => logs.push(String(m)) },
    Utilities: { sleep: () => {}, getUuid: () => "00000000-0000-0000-0000-000000000000" },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
      }),
    },
    __logs: logs,
    __props: props,
    ...extra,
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(__dirname, file), "utf8"), sandbox, { filename: file });
  return sandbox;
}

// vm の中で作った配列・オブジェクトは別の世界の物なので、比べる前に普通の値へ写す
const plain = (v) => JSON.parse(JSON.stringify(v));

function idMaker() {
  let n = 0;
  return () => "r" + String(++n).padStart(3, "0");
}

function opts(extra = {}) {
  let promoCalls = 0;
  const o = {
    nowStr: "2026-11-01 22:10",
    newRowId: idMaker(),
    buildPromo: () => { promoCalls++; return "宣伝" + promoCalls; },
    ...extra,
  };
  o.promoCalls = () => promoCalls;
  return o;
}

const notice = (key, text = "本文" + key) => ({ kind: "notice", key, text });
const promo = { kind: "promo", key: "promo", text: null };
const none = { kind: "none", key: "none", text: "本日締切のお知らせはありません🐰" };

// 前の晩の結果を「全部予約した」状態にする（毎晩の予約作業の代わり）
const scheduleAll = (rows) => rows.map((r) => ({ ...r, status: r.status === "未投稿" ? "予約済み" : r.status }));

test("reconcileQueue: 空のシートに2日分を書くと、日ごとに 07:00 から1分刻みで並び、宣伝は最後", () => {
  const { reconcileQueue } = load("x-bot.js");
  const o = opts();
  const res = plain(reconcileQueue([], [
    { date: "2026-11-02", posts: [notice("a"), notice("b"), promo] },
    { date: "2026-11-03", posts: [none] },
  ], o));
  assert.deepEqual(res.rows.map((r) => [r.date, r.time, r.kind, r.status]), [
    ["2026-11-02", "07:00", "notice", "未投稿"],
    ["2026-11-02", "07:01", "notice", "未投稿"],
    ["2026-11-02", "07:02", "promo", "未投稿"],
    ["2026-11-03", "07:00", "none", "未投稿"],
  ]);
  assert.equal(res.rows[2].text, "宣伝1");
  assert.equal(o.promoCalls(), 1);
  assert.equal(new Set(res.rows.map((r) => r.rowId)).size, 4, "行IDは重ならない");
});

test("reconcileQueue: 次の晩、前の晩に予約済みの日は行ID・時刻・本文そのままで残り、済んだ日は外れ、新しい日だけ足される", () => {
  const { reconcileQueue } = load("x-bot.js");
  const night1 = plain(reconcileQueue([], [
    { date: "2026-11-02", posts: [notice("a"), promo] },
    { date: "2026-11-03", posts: [notice("b"), notice("c"), promo] },
  ], opts())).rows;
  const o = opts({ newRowId: () => "rNEW" + Math.random() });
  const res = plain(reconcileQueue(scheduleAll(night1), [
    { date: "2026-11-03", posts: [notice("b"), notice("c"), promo] },
    { date: "2026-11-04", posts: [none] },
  ], o));
  const day3 = res.rows.filter((r) => r.date === "2026-11-03");
  assert.deepEqual(day3, night1.filter((r) => r.date === "2026-11-03").map((r) => ({ ...r, status: "予約済み" })));
  assert.equal(res.rows.filter((r) => r.date === "2026-11-02").length, 0, "投稿が済んだ日は外れる");
  assert.deepEqual(res.rows.filter((r) => r.status === "未投稿").map((r) => r.date), ["2026-11-04"]);
  assert.equal(o.promoCalls(), 0, "宣伝の順番切替を余計に進めない");
  assert.deepEqual([res.added, res.needsCancel], [1, 0]);
});

test("reconcileQueue: 本文だけ変わっても（同じ内容の記事のどちらを残すかが入れ替わった等）照合キーが同じなら取り消さない", () => {
  const { reconcileQueue } = load("x-bot.js");
  const existing = [{ text: "古いリンクの本文", status: "予約済み", date: "2026-11-02", writtenAt: "x", time: "07:00", kind: "notice", key: "a", rowId: "r1", memo: "" }];
  const res = plain(reconcileQueue(existing, [{ date: "2026-11-02", posts: [notice("a", "新しいリンクの本文")] }], opts()));
  assert.equal(res.rows[0].status, "予約済み");
  assert.equal(res.rows[0].text, "古いリンクの本文", "予約済みの本文は X に入っている物のまま");
  assert.equal(res.needsCancel, 0);
});

test("reconcileQueue: 予約済みの日にあとから告知が増えたら、告知はいちばん後ろの1分後に足し、宣伝は取り消して告知の後ろへ入れ直す", () => {
  const { reconcileQueue } = load("x-bot.js");
  const night1 = scheduleAll(plain(reconcileQueue([], [{ date: "2026-11-03", posts: [notice("a"), promo] }], opts())).rows);
  const o = opts({ newRowId: idMaker() });
  o.newRowId = ((mk) => () => "x" + mk())(idMaker());
  const res = plain(reconcileQueue(night1, [{ date: "2026-11-03", posts: [notice("a"), notice("b"), promo] }], o));
  assert.deepEqual(res.rows.map((r) => [r.time, r.kind, r.status, r.text]), [
    ["07:00", "notice", "予約済み", "本文a"],
    ["07:01", "promo", "要取り消し", "宣伝1"],
    ["07:02", "notice", "未投稿", "本文b"],
    ["07:03", "promo", "未投稿", "宣伝1"],
  ]);
  assert.match(res.rows[1].memo, /順番を直す/);
  assert.equal(o.promoCalls(), 0, "入れ直す宣伝は同じ本文を使い回す");
});

test("reconcileQueue: まだ予約していない宣伝は、取り消さずに告知の後ろへ時刻だけずらす", () => {
  const { reconcileQueue } = load("x-bot.js");
  const night1 = plain(reconcileQueue([], [{ date: "2026-11-03", posts: [notice("a"), promo] }], opts())).rows;
  const res = plain(reconcileQueue(night1, [{ date: "2026-11-03", posts: [notice("a"), notice("b"), promo] }], opts({ newRowId: () => "rX" })));
  assert.deepEqual(res.rows.map((r) => [r.time, r.kind, r.status]), [
    ["07:00", "notice", "未投稿"],
    ["07:02", "notice", "未投稿"],
    ["07:03", "promo", "未投稿"],
  ]);
  assert.equal(res.needsCancel, 0);
});

test("reconcileQueue: 要らなくなった行は、予約済みなら「要取り消し」と理由、未投稿なら外す", () => {
  const { reconcileQueue } = load("x-bot.js");
  const existing = [
    { text: "A", status: "予約済み", date: "2026-11-03", writtenAt: "", time: "07:00", kind: "notice", key: "a", rowId: "r1", memo: "" },
    { text: "B", status: "未投稿", date: "2026-11-03", writtenAt: "", time: "07:01", kind: "notice", key: "b", rowId: "r2", memo: "" },
    { text: "C", status: "予約済み", date: "2026-11-03", writtenAt: "", time: "07:02", kind: "notice", key: "c", rowId: "r3", memo: "" },
    { text: "宣伝", status: "予約済み", date: "2026-11-03", writtenAt: "", time: "07:03", kind: "promo", key: "promo", rowId: "r4", memo: "" },
  ];
  const res = plain(reconcileQueue(existing, [{ date: "2026-11-03", posts: [notice("c", "C"), promo] }], opts()));
  assert.deepEqual(res.rows.map((r) => [r.rowId, r.status]), [["r1", "要取り消し"], ["r3", "予約済み"], ["r4", "予約済み"]]);
  assert.match(res.rows[0].memo, /締切/);
  assert.deepEqual([res.needsCancel, res.dropped], [1, 1]);
});

test("reconcileQueue: 「ありません」の日に告知が入ったら、ありませんを取り消し、告知と宣伝を足す", () => {
  const { reconcileQueue } = load("x-bot.js");
  const existing = [{ text: "本日締切のお知らせはありません🐰", status: "予約済み", date: "2026-11-03", writtenAt: "", time: "07:00", kind: "none", key: "none", rowId: "r1", memo: "" }];
  const o = opts({ newRowId: idMaker() });
  const res = plain(reconcileQueue(existing, [{ date: "2026-11-03", posts: [notice("a"), promo] }], o));
  assert.deepEqual(res.rows.map((r) => [r.time, r.kind, r.status]), [
    ["07:00", "none", "要取り消し"],
    ["07:01", "notice", "未投稿"],
    ["07:02", "promo", "未投稿"],
  ]);
  assert.match(res.rows[0].memo, /告知が入った/);
  assert.equal(o.promoCalls(), 1);
});

test("reconcileQueue: 見送りにした行は足し直さない／取り消す前に元へ戻った行は予約済みに戻す／取り消し済みの行と同じ物が戻ったら足し直す", () => {
  const { reconcileQueue } = load("x-bot.js");
  const existing = [
    { text: "A", status: "見送り", date: "2026-11-03", writtenAt: "", time: "07:00", kind: "notice", key: "a", rowId: "r1", memo: "" },
    { text: "B", status: "要取り消し", date: "2026-11-03", writtenAt: "", time: "07:01", kind: "notice", key: "b", rowId: "r2", memo: "理由" },
    { text: "C", status: "取り消し済み", date: "2026-11-03", writtenAt: "", time: "07:02", kind: "notice", key: "c", rowId: "r3", memo: "理由" },
    { text: "宣伝", status: "予約済み", date: "2026-11-03", writtenAt: "", time: "07:03", kind: "promo", key: "promo", rowId: "r4", memo: "" },
  ];
  const res = plain(reconcileQueue(existing, [{ date: "2026-11-03", posts: [notice("a"), notice("b"), notice("c"), promo] }], opts({ newRowId: idMaker() })));
  assert.deepEqual(res.rows.map((r) => [r.time, r.key, r.status, r.memo]), [
    ["07:00", "a", "見送り", ""],
    ["07:01", "b", "予約済み", ""],
    ["07:02", "c", "取り消し済み", "理由"],
    ["07:03", "promo", "要取り消し", "順番を直すため（あとから足した告知の後ろに入れ直す）"],
    ["07:04", "c", "未投稿", ""],
    ["07:05", "promo", "未投稿", ""],
  ]);
});

test("reconcileQueue: 時刻・行ID・照合キーの無い古い4列の行は、旧来の時刻（その日の順番）と本文から補う", () => {
  const { reconcileQueue } = load("x-bot.js");
  const legacy = (text, status) => ({ text, status, date: "2026-11-02", writtenAt: "2026-11-01 22:05", time: "", kind: "", key: "", rowId: "", memo: "" });
  const existing = [
    legacy("本文a", "予約済み"),
    legacy("本文b", "予約済み"),
    legacy("FCチケットの…\nhttps://x.com/hop_rabbit_hop/status/1", "予約済み"),
  ];
  const res = plain(reconcileQueue(existing, [{ date: "2026-11-02", posts: [notice("a"), notice("b"), promo] }], opts({ newRowId: idMaker() })));
  assert.deepEqual(res.rows.map((r) => [r.time, r.kind, r.key, r.status]), [
    ["07:00", "notice", "a", "予約済み"],
    ["07:01", "notice", "b", "予約済み"],
    ["07:02", "promo", "promo", "予約済み"],
  ]);
  assert.equal(res.added + res.needsCancel, 0);
});

// ===== 1日分の告知の組み立て =====
const jstMidnight = (ymd) => new Date(Date.parse(ymd + "T00:00:00+09:00"));
const dl = (type, label, at, uid, title, scraped = "2026-10-01T00:00:00+00:00") => ({
  type, label, deadline_at: at,
  fc_news: { uid, title, detail_url: "https://example.test/news?uid=" + uid, scraped_at: scraped },
});

test("buildDayPosts: 翌々日の分は翌々日の 07:00 から残り時間を数え、照合キーに記事のuidを入れない", () => {
  const { buildDayPosts } = load("x-bot.js");
  const deadlines = [dl("apply_end", "申込締切", "2026-11-03T23:59:00+09:00", "U1", "テスト公演 申込のお知らせ")];
  const d2 = plain(buildDayPosts(deadlines, jstMidnight("2026-11-03")));
  assert.equal(d2.length, 1);
  assert.match(d2[0].text, /【あと17時間】/);   // 11/3 07:00 → 23:59 は 16時間59分 → 切り上げて17
  assert.equal(d2[0].key, "apply_end|2026-11-03T23:59:00+09:00|テスト公演 申込のお知らせ|d0");
  const d1 = plain(buildDayPosts(deadlines, jstMidnight("2026-11-02")));
  assert.match(d1[0].text, /【あと1日（あと41時間）】/);
  assert.match(d1[0].key, /\|d1$/);
  assert.equal(plain(buildDayPosts(deadlines, jstMidnight("2026-11-01"))).length, 0, "申込締切の2日前は通知しない");
});

test("buildDayPosts: 同じ内容の記事が2本ある時は、あとから取り込まれた方を1本だけ出し、照合キーはどちらでも同じ", () => {
  const { buildDayPosts } = load("x-bot.js");
  const a = dl("payment", "入金期限", "2026-11-02T21:00:00+09:00", "OLD", "【11/1更新】テスト 入金のお知らせ", "2026-10-01T00:00:00+00:00");
  const b = dl("payment", "入金期限", "2026-11-02T21:00:00+09:00", "NEW", "テスト 入金のお知らせ", "2026-10-05T00:00:00+00:00");
  const out1 = plain(buildDayPosts([a, b], jstMidnight("2026-11-02")));
  assert.equal(out1.length, 1);
  assert.match(out1[0].text, /uid=NEW/);
  const out2 = plain(buildDayPosts([{ ...a, fc_news: { ...a.fc_news, scraped_at: "2026-10-09T00:00:00+00:00" } }, b], jstMidnight("2026-11-02")));
  assert.match(out2[0].text, /uid=OLD/);
  assert.equal(out1[0].key, out2[0].key);
});

test("2晩続けて回すと、2晩目は前の晩に書いた翌日分に何も足さず、翌々日分だけ足す（通知済みの印は使わない）", () => {
  const sb = load("x-bot.js");
  const deadlines = [
    dl("apply_end", "申込締切", "2026-11-03T23:59:00+09:00", "U1", "公演A"),
    dl("payment", "入金期限", "2026-11-04T21:00:00+09:00", "U2", "公演B"),
  ];
  const o = opts({ newRowId: idMaker() });
  const night1 = plain(sb.reconcileQueue([], sb.buildSheetPlans(deadlines, jstMidnight("2026-11-02"), 2), o)).rows;
  const night2 = plain(sb.reconcileQueue(scheduleAll(night1), sb.buildSheetPlans(deadlines, jstMidnight("2026-11-03"), 2), o));
  const kept = night2.rows.filter((r) => r.date === "2026-11-03");
  assert.deepEqual(kept, night1.filter((r) => r.date === "2026-11-03").map((r) => ({ ...r, status: "予約済み" })));
  assert.equal(night2.needsCancel, 0);
  assert.deepEqual(night2.rows.filter((r) => r.status === "未投稿").map((r) => [r.date, r.kind]), [
    ["2026-11-04", "notice"],
    ["2026-11-04", "promo"],
  ]);
  assert.equal(sb.__props.X_TWEETED_UIDS, undefined, "通知済みの印を付けていない");
});

// ===== 窓口（x-gateway.js）=====
// シートを真似る小さな作り物。getDataRange().getValues() と getRange(r,c).setValue と、取り消し履歴の追記だけ
function fakeSpreadsheet(queueValues) {
  const sheets = {};
  const makeSheet = (values) => {
    const sh = {
      values,
      getDataRange: () => ({ getValues: () => sh.values.map((r) => r.slice()) }),
      getLastRow: () => sh.values.length,
      appendRow: (row) => { sh.values.push(row.slice()); },
      getRange: (r, c, nr = 1, nc = 1) => ({
        setValue: (v) => { sh.values[r - 1][c - 1] = v; },
        setValues: (rows) => { rows.forEach((row, i) => { sh.values[r - 1 + i] = row.slice(); }); },
        setNumberFormat: () => {},
        setFontWeight: () => {},
      }),
      getParent: () => ss,
    };
    return sh;
  };
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet([])),
  };
  sheets["X投稿キュー"] = makeSheet(queueValues);
  return { ss, sheets };
}

function loadGateway(queueValues) {
  const fake = fakeSpreadsheet(queueValues);
  const sb = load("x-gateway.js", {
    SpreadsheetApp: { openById: () => fake.ss, flush: () => {} },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  });
  sb.__props.SHEET_ID = "dummy";
  return { sb, fake };
}

const HEADER = ["ツイート本文", "ステータス", "予約投稿日", "書き出し日時", "予約時刻", "種類", "照合キー", "行ID", "メモ"];

test("窓口 getQueue: 行IDと予約時刻の列の値をそのまま返す（並びや外れた行に左右されない）", () => {
  const { sb } = loadGateway([
    HEADER,
    ["A", "予約済み", "2026-11-02", "", "07:00", "notice", "a", "r1", ""],
    ["B", "未投稿", "2026-11-02", "", "07:05", "notice", "b", "r2", ""],
  ]);
  const q = plain(sb.getQueue(null));
  assert.deepEqual(q.items.map((i) => [i.id, i.scheduledTime, i.kind]), [["r1", "07:00", "notice"], ["r2", "07:05", "notice"]]);
});

test("窓口 getQueue / markScheduled: 古い4列のシートでは今まで通り位置番号と順番の時刻", () => {
  const { sb, fake } = loadGateway([
    ["ツイート本文", "ステータス", "予約投稿日", "書き出し日時"],
    ["A", "未投稿", "2026-11-02", ""],
    ["B", "未投稿", "2026-11-02", ""],
  ]);
  assert.deepEqual(plain(sb.getQueue(null)).items.map((i) => [i.id, i.scheduledTime]), [["1", "07:00"], ["2", "07:01"]]);
  assert.equal(sb.markScheduled("2").ok, true);
  assert.equal(fake.sheets["X投稿キュー"].values[2][1], "予約済み");
});

test("窓口 markCancelled: 要取り消しの行だけ取り消し済みにし、取り消し履歴に理由つきで1行残す。2回目は already", () => {
  const { sb, fake } = loadGateway([
    HEADER,
    ["A", "要取り消し", "2026-11-03", "", "07:01", "promo", "promo", "r1", "順番を直すため"],
    ["B", "予約済み", "2026-11-03", "", "07:02", "notice", "b", "r2", ""],
  ]);
  const res = plain(sb.markCancelled("r1"));
  assert.deepEqual([res.ok, res.already], [true, false]);
  assert.equal(fake.sheets["X投稿キュー"].values[1][1], "取り消し済み");
  const hist = fake.sheets["取り消し履歴"].values;
  assert.equal(hist.length, 2);
  assert.deepEqual(plain(hist[1].slice(1)), ["2026-11-03", "07:01", "promo", "順番を直すため", "A", "r1"]);
  assert.equal(plain(sb.markCancelled("r1")).already, true);
  assert.equal(fake.sheets["取り消し履歴"].values.length, 2, "2回目は履歴を増やさない");
  const refused = plain(sb.markCancelled("r2"));
  assert.deepEqual([refused.ok, refused.error], [false, "not_needs_cancel"]);
  assert.equal(fake.sheets["X投稿キュー"].values[2][1], "予約済み");
  assert.equal(plain(sb.markCancelled("r9")).error, "not_found");
});
