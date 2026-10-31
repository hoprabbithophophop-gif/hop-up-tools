/**
 * hop-up-tools X (Twitter) 投稿ボット
 *
 * 【スクリプトプロパティ（事前設定）】
 * X_API_KEY             : X API Key
 * X_API_SECRET          : X API Key Secret
 * X_ACCESS_TOKEN        : Access Token（ボットアカウント）
 * X_ACCESS_TOKEN_SECRET : Access Token Secret（ボットアカウント）
 * SUPABASE_URL          : Supabase プロジェクトURL（締切取得用）
 * SUPABASE_SERVICE_KEY  : Supabase service_role キー
 * EMAIL_NOTIFY          : "true" にするとツイートせずメールで文面を送る（試用期間用）
 * NOTIFY_EMAIL          : 送信先メールアドレス（省略時はスクリプトオーナーのGmailに送る）
 * SHEET_MODE            : "true" にするとツイートせずスプレッドシートに書き出す（Claude in Chrome連携用）
 * SHEET_ID              : 書き出し先スプレッドシートのID
 * X_DRY_RUN             : "true" にするとログ出力のみ（投稿・メール送信ともしない）
 *
 * 【トリガー設定】
 * XBmain               : 毎日 22〜23時 JST に実行（時間主導型トリガー）
 *                         → 翌日が対象。3日以内の申込締切・入金期限・当落発表を通知
 *                         SHEET_MODE では翌日と翌々日の2日分を書き出す（2026-11-01 Hop 決定・案A）。
 *                         前の晩に書いた行は消さずに照らし合わせ、増えた分だけ足す。
 *                         予約済みなのに最新の締切と合わなくなった行は「要取り消し」にする
 *                         （X からの取り消しは毎晩の予約作業の中で行い、窓口の markCancelled で
 *                         「取り消し履歴」シートに記録する。syncSheetQueue の説明を参照）
 *                         （日付は BASE_SHIFT_MS で2時間進めて判定するので、0時台のままでも動く）
 * XBguard              : 毎日 XBmain の1〜2時間後 JST に実行（時間主導型トリガー）
 *                         → 見張り役。XBmain が丸ごと落ちた日だけ、代わりに1回やり直す
 * XBredoToday          : トリガーなし（手動専用）。XBmain が落ちて予約シートが空／0件だけの日に、
 *                         「通知済み」の印を無視して同じ日の分を作り直す。22:00 JST より前に実行
 *
 * 【通知ルール（バランス案）】
 *   申込締切（apply_end）: 3日前・1日前・当日
 *   入金期限（payment）  : 1日前・当日
 *   当落発表（result）   : 当日のみ
 *   当日通知は「あとN時間」表記（24時間未満を時間単位で表示）
 *
 * 【保管庫へ移した関数（gas/archive/x-bot-debug.js にそのまま残してある）】
 * debugPromoRotation（2026-09-04。宣伝文言の順番切替の確認が済んだため）
 */

// ===== 「どの日の分か」を決める基準時刻のずらし幅 =====
// このバッチは「実行した日の分」を書き出す作りだが、実行時刻を 0時台から 22時台へ
// 前倒ししたため、素直に実行日で数えると前日の分として書き出してしまう。
// そこで日付を決めるときだけ実行時刻を2時間進めて判定する。
// 22時台に動けば翌日、0時台に動いても当日と、どちらの時刻でも正しい日付になる。
var BASE_SHIFT_MS = 2 * 60 * 60 * 1000;

// ===== メール通知キュー（EMAIL_NOTIFY=true のとき使用）=====
// 1回の実行で溜まったツイート文面をまとめて1通のメールで送る
var _emailQueue = [];

function flushEmailNotify() {
  if (_emailQueue.length === 0) return;
  var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL')
    || Session.getEffectiveUser().getEmail();
  var body = _emailQueue.map(function (item, i) {
    return '【' + (i + 1) + '】 ' + item.label + '\n\n' + item.text;
  }).join('\n\n' + '─'.repeat(30) + '\n\n');
  MailApp.sendEmail({
    to: to,
    subject: '[hop-up-tools] ツイート予定 ' + _emailQueue.length + '件 (' + new Date().toLocaleDateString('ja-JP') + ')',
    body: body,
  });
  Logger.log('[X EMAIL] メール送信: ' + _emailQueue.length + '件 → ' + to);
  _emailQueue = [];
}

// ===== スプシ書き出しキュー（SHEET_MODE=true のとき使用）=====
// Claude in Chrome が読み取って X に予約する用。
//
// 2日分の書き出し（2026-11-01 Hop 決定・案A）:
//   毎晩、翌日と翌々日の2日分を作る。前の晩に書いた行は消さず、照合キーで照らし合わせる。
//   - 同じ照合キーの行がある → 残す（予約済みの行は本文も時刻もそのまま）
//   - 無い → 新しい行として「未投稿」で足す。時刻はその日のいちばん遅い行の1分後
//   - 前の晩の行で、今夜は要らなくなった物:
//       未投稿 → 行ごと外す（まだ X に入っていない）
//       予約済み → 「要取り消し」にして、メモに理由を書く（X から消すのは毎晩の予約作業）
//   - 予約投稿日が翌日より前の行は、もう投稿が済んでいるので外す
//   取り消した記録は、窓口（x-gateway.js）の markCancelled が「取り消し履歴」シートに残す。
//
// 行ごとの時刻と行IDは列に書いて固定する。これまでは「その日の中で何番目か」から窓口が
// 時刻を計算していたが、行が残ったり外れたりすると予約済みの行の時刻まで動いてしまうため。
var QUEUE_HEADER = ['ツイート本文', 'ステータス', '予約投稿日', '書き出し日時', '予約時刻', '種類', '照合キー', '行ID', 'メモ'];
var Q_STATUS_UNSENT = '未投稿';
var Q_STATUS_SCHEDULED = '予約済み';
var Q_STATUS_SKIPPED = '見送り';
var Q_STATUS_NEEDS_CANCEL = '要取り消し';
var Q_STATUS_CANCELLED = '取り消し済み';
var NONE_TWEET_TEXT = '本日締切のお知らせはありません🐰';

var _sheetQueue = []; // postTweet が SHEET_MODE で積む先（今は読む所が無い。誤投稿を防ぐ受け皿）

// plans: [{ date: 'YYYY-MM-DD', posts: [{ kind, key, text }] }]（日付の早い順）
function syncSheetQueue(sheetId, plans) {
  // Google スプレッドシート側の一時的な不調（"Service Spreadsheets failed while accessing
  // document" 等）で丸ごと落ちるのを防ぐため、書き出し全体を最大3回まで試す。
  // 書き出しは「読んで照らし合わせてから全部を書き直す」ので、途中で失敗した回があっても
  // 次の回で最初からやり直せば最終形は同じになる（2026-09-03 22:52 に実際に発生）。
  var lastError = null;
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      return writeSyncedQueue(sheetId, plans);
    } catch (e) {
      lastError = e;
      Logger.log('[X SHEET] 書き出し失敗(' + attempt + '回目): ' + e.message);
      if (attempt < 3) Utilities.sleep(10000);
    }
  }
  throw lastError;
}

function writeSyncedQueue(sheetId, plans) {
  // 窓口（x-gateway.js）の記帳と同時に書き換えないよう、同じ鍵をかける
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName('X投稿キュー') || ss.insertSheet('X投稿キュー');
    var existing = readQueueRows(sheet);

    var result = reconcileQueue(existing, plans, {
      nowStr: nowJstMinuteStr(),
      newRowId: function () { return 'r' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); },
      buildPromo: buildPromoTweet,
    });

    var rows = result.rows.map(function (r) {
      return [r.text, r.status, r.date, r.writtenAt, r.time, r.kind, r.key, r.rowId, r.memo];
    });
    sheet.clearContents();
    sheet.getRange(1, 1, 1, QUEUE_HEADER.length).setValues([QUEUE_HEADER]).setFontWeight('bold');
    if (rows.length > 0) {
      var body = sheet.getRange(2, 1, rows.length, QUEUE_HEADER.length);
      // 日付と時刻がシート側で日付型に変わらないよう、文字として書く
      body.setNumberFormat('@');
      body.setValues(rows);
    }
    SpreadsheetApp.flush();

    Logger.log('[X SHEET] 書き出し: 足した ' + result.added + '件 / 残した ' + result.kept
      + '件 / 要取り消し ' + result.needsCancel + '件 / 外した ' + result.dropped + '件 （対象日: '
      + plans.map(function (p) { return p.date; }).join(', ') + '）');
    return result;
  } finally {
    lock.releaseLock();
  }
}

// シートの行を読む。列は見出しの名前で引く（古い4列のシートも読める）
function readQueueRows(sheet) {
  if (sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var header = values[0];
  var c = {};
  QUEUE_HEADER.forEach(function (name) { c[name] = header.indexOf(name); });
  var cell = function (row, name) { return c[name] >= 0 ? row[c[name]] : ''; };
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var text = String(cell(row, 'ツイート本文'));
    if (text.trim() === '') continue;
    out.push({
      text: text,
      status: String(cell(row, 'ステータス')),
      date: queueDateCell(cell(row, '予約投稿日')),
      writtenAt: String(cell(row, '書き出し日時')),
      time: String(cell(row, '予約時刻')),
      kind: String(cell(row, '種類')),
      key: String(cell(row, '照合キー')),
      rowId: String(cell(row, '行ID')),
      memo: String(cell(row, 'メモ')),
    });
  }
  return out;
}

function queueDateCell(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(v);
}

// ===== 照らし合わせの本体（シートに触らない。テストはここを確かめる）=====
// existing: readQueueRows の結果 / plans: syncSheetQueue と同じ
// opts.newRowId(): 新しい行IDを返す / opts.buildPromo(): 宣伝の本文を返す（新しく作る時だけ呼ぶ）
function reconcileQueue(existing, plans, opts) {
  var firstDate = plans.length ? plans[0].date : '';
  var planDates = {};
  plans.forEach(function (p) { planDates[p.date] = true; });
  var stats = { added: 0, kept: 0, needsCancel: 0, dropped: 0 };

  // 古い4列の行（予約時刻・種類・照合キー・行IDが無い）は、本文から推し量って補う。
  // 時刻は窓口の旧計算（その日の中の順番で 07:00 から1分刻み）と同じにする。
  var rankByDate = {};
  var rows = existing.map(function (r) {
    var row = {};
    for (var k in r) row[k] = r[k];
    rankByDate[row.date] = (rankByDate[row.date] || 0) + 1;
    if (!row.time) row.time = minutesToHHmm(7 * 60 + rankByDate[row.date] - 1);
    if (!row.kind) row.kind = guessKind(row.text);
    if (!row.rowId) row.rowId = opts.newRowId();
    return row;
  });

  // 投稿が済んだ日（翌日より前）の行は外す
  rows = rows.filter(function (r) {
    if (firstDate && r.date < firstDate) { stats.dropped++; return false; }
    return true;
  });

  plans.forEach(function (plan) {
    var dayRows = rows.filter(function (r) { return r.date === plan.date; });
    var used = {};
    var hasNewNotice = false;

    // 照合キーが無い古い行は、今夜の本文と同じならそのキーを引き継ぐ
    dayRows.forEach(function (r) {
      if (r.key) return;
      if (r.kind === 'promo') { r.key = 'promo'; return; }
      if (r.kind === 'none') { r.key = 'none'; return; }
      plan.posts.forEach(function (p) { if (p.kind === 'notice' && p.text === r.text) r.key = p.key; });
    });

    plan.posts.forEach(function (p) {
      var match = null;
      dayRows.forEach(function (r) {
        if (match || used[r.rowId]) return;
        if (r.status === Q_STATUS_CANCELLED) return;   // もう X から消した行は数えない
        if (r.key === p.key) match = r;
      });
      if (match) {
        used[match.rowId] = true;
        stats.kept++;
        if (match.status === Q_STATUS_NEEDS_CANCEL) {
          // 取り消す前に元に戻った（X にはまだ入っている）
          match.status = Q_STATUS_SCHEDULED;
          match.memo = '';
        } else if (match.status === Q_STATUS_UNSENT && p.kind === 'notice') {
          // まだ X に入れていないので、本文は最新に差し替えてよい
          match.text = p.text;
        }
        return;
      }
      if (p.kind === 'notice') hasNewNotice = true;
      var row = newQueueRow(plan.date, p, rows, opts);
      rows.push(row);
      dayRows.push(row);
      used[row.rowId] = true;
      stats.added++;
    });

    // 今夜は要らなくなった行
    dayRows.forEach(function (r) {
      if (used[r.rowId]) return;
      if (r.status === Q_STATUS_UNSENT) {
        r._drop = true;
        stats.dropped++;
      } else if (r.status === Q_STATUS_SCHEDULED) {
        r.status = Q_STATUS_NEEDS_CANCEL;
        r.memo = cancelReason(r.kind);
        stats.needsCancel++;
      }
      // 見送り・要取り消し・取り消し済みは、そのまま残す
    });

    // 宣伝はその日のいちばん最後に出す（これまでと同じ並び）。
    // 宣伝より後ろに告知が足された日は、宣伝を後ろへ付け直す。
    if (hasNewNotice) {
      var live = dayRows.filter(function (r) { return !r._drop && isLiveStatus(r.status); });
      var lastNoticeTime = '';
      live.forEach(function (r) { if (r.kind === 'notice' && r.time > lastNoticeTime) lastNoticeTime = r.time; });
      live.forEach(function (r) {
        if (r.kind !== 'promo' || r.time > lastNoticeTime) return;
        if (r.status === Q_STATUS_UNSENT) {
          r.time = nextSlot(plan.date, rows);
          r.writtenAt = opts.nowStr;
        } else if (r.status === Q_STATUS_SCHEDULED) {
          r.status = Q_STATUS_NEEDS_CANCEL;
          r.memo = '順番を直すため（あとから足した告知の後ろに入れ直す）';
          stats.needsCancel++;
          stats.kept--;
          var again = newQueueRow(plan.date, { kind: 'promo', key: 'promo', text: r.text }, rows, opts);
          rows.push(again);
          stats.added++;
        }
      });
    }
  });

  rows = rows.filter(function (r) { return !r._drop; });
  rows.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.time < b.time ? -1 : (a.time > b.time ? 1 : 0);
  });
  rows.forEach(function (r) { delete r._drop; });
  return { rows: rows, added: stats.added, kept: stats.kept, needsCancel: stats.needsCancel, dropped: stats.dropped };
}

function newQueueRow(date, post, rows, opts) {
  var text = post.text;
  if (post.kind === 'promo' && !text) {
    // 前の晩の宣伝が同じ日にあればその本文を使い回す（順番切替を余計に進めない）
    rows.forEach(function (r) { if (!text && r.date === date && r.kind === 'promo') text = r.text; });
    if (!text) text = opts.buildPromo();
  }
  return {
    text: text,
    status: Q_STATUS_UNSENT,
    date: date,
    writtenAt: opts.nowStr,
    time: nextSlot(date, rows),
    kind: post.kind,
    key: post.key,
    rowId: opts.newRowId(),
    memo: '',
  };
}

// その日のいちばん遅い行の1分後（行が無ければ 07:00）。取り消した行の時刻も使い回さない
function nextSlot(date, rows) {
  var max = -1;
  rows.forEach(function (r) {
    if (r.date !== date || r._drop) return;
    var m = hhmmToMinutes(r.time);
    if (m > max) max = m;
  });
  return minutesToHHmm(max < 0 ? 7 * 60 : max + 1);
}

function isLiveStatus(status) {
  return status === Q_STATUS_UNSENT || status === Q_STATUS_SCHEDULED;
}

function cancelReason(kind) {
  if (kind === 'none') return '告知が入ったため（「ありません」を取り消す）';
  if (kind === 'promo') return '告知が無くなったため（宣伝を取り消す）';
  return '最新の締切と合わなくなったため（締切の変更・記事の取り下げなど）';
}

function guessKind(text) {
  if (String(text).trim() === NONE_TWEET_TEXT) return 'none';
  if (String(text).indexOf('x.com/hop_rabbit_hop/status/') !== -1) return 'promo';
  return 'notice';
}

function hhmmToMinutes(s) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(s));
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : -1;
}

function minutesToHHmm(total) {
  return String(Math.floor(total / 60) % 24).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

function nowJstMinuteStr() {
  var nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return nowJst.getUTCFullYear() + '-'
    + String(nowJst.getUTCMonth() + 1).padStart(2, '0') + '-'
    + String(nowJst.getUTCDate()).padStart(2, '0') + ' '
    + String(nowJst.getUTCHours()).padStart(2, '0') + ':'
    + String(nowJst.getUTCMinutes()).padStart(2, '0');
}

function jstDateStrOf(utcMsOfJstMidnight) {
  var d = new Date(utcMsOfJstMidnight + 9 * 60 * 60 * 1000);
  return d.getUTCFullYear() + '-'
    + String(d.getUTCMonth() + 1).padStart(2, '0') + '-'
    + String(d.getUTCDate()).padStart(2, '0');
}


// ===== 外部取得を1回だけやり直す =====
// 相手側の一時的な不調（5xx など）で丸ごと空振りするのを防ぐ。
// 例外そのものも1回は飲み込んで、少し待ってからもう一度だけ叩く。
function fetchWithRetry(url, options) {
  for (var attempt = 1; attempt <= 2; attempt++) {
    try {
      var res = UrlFetchApp.fetch(url, options);
      if (res.getResponseCode() === 200 || attempt === 2) return res;
      Logger.log('[X] 取得やり直し(' + res.getResponseCode() + ')');
    } catch (e) {
      if (attempt === 2) {
        Logger.log('[X] 取得やり直しも失敗: ' + e.message);
        return null;
      }
      Logger.log('[X] 取得で例外、やり直します: ' + e.message);
    }
    Utilities.sleep(5000);
  }
  return null;
}

// ===== 「その日の分」を書き出した日付の記録 =====
// 見張り役(XBguard)が「今日の分がもう用意できているか」を判断するために使う。
function baseDateString() {
  var baseJst = new Date(Date.now() + 9 * 60 * 60 * 1000 + BASE_SHIFT_MS);
  return baseJst.getUTCFullYear() + '-'
    + String(baseJst.getUTCMonth() + 1).padStart(2, '0') + '-'
    + String(baseJst.getUTCDate()).padStart(2, '0');
}

// ===== 見張り役（XBmain の少し後の時刻にトリガー設定する）=====
// XBmain が Google 側の不調などで丸ごと落ちた日に、代わりに1回だけ動かし直す。
// すでに今日の分が用意できていれば何もしない（毎日空振りするのが正常な姿）。
function XBguard() {
  var props = PropertiesService.getScriptProperties();
  var today = baseDateString();
  if (props.getProperty('X_LAST_RUN_DATE') === today) {
    Logger.log('[X GUARD] 今日の分は用意済み（' + today + '）。何もしません');
    return;
  }
  Logger.log('[X GUARD] 今日の分が未実行（' + today + '）。XBmain をやり直します');
  XBmain();
}

// ===== ツイート済みUID管理（Script Properties に保存）=====
// XBredoToday() から呼ばれたときだけ true になり、「通知済み」の印を無視して作り直す
var _ignoreTweetedMarks = false;

function hasBeenTweeted(uid) {
  if (_ignoreTweetedMarks) return false;
  var tweeted = JSON.parse(
    PropertiesService.getScriptProperties().getProperty('X_TWEETED_UIDS') || '[]'
  );
  return tweeted.indexOf(uid) !== -1;
}

function markAsTweeted(uid) {
  var props = PropertiesService.getScriptProperties();
  var tweeted = JSON.parse(props.getProperty('X_TWEETED_UIDS') || '[]');
  if (tweeted.indexOf(uid) !== -1) return; // 作り直しで同じ印を二重に付けない
  tweeted.push(uid);
  if (tweeted.length > 500) tweeted = tweeted.slice(-500); // 上限500件
  props.setProperty('X_TWEETED_UIDS', JSON.stringify(tweeted));
}

// ===== 復旧用: 今日の分を「通知済み」の印を無視して作り直す =====
// XBmain が予約シートへの書き出しで落ちた日に使う（Apps Script エディタから手で実行）。
// 使いどころ: 実行数の画面で XBmain が「失敗しました」になっていて、
//   予約シートに「本日締切のお知らせはありません」しか無い／空のとき。
// 注意: 「どの日の分か」は実行時刻+2時間で決まるので、22:00 JST より前に実行すること
//   （22:00 を過ぎると翌日の分を作ってしまう）。
// 印の付け方が「書き出し成功後」に変わった今は、XBguard の自動やり直しで
// 済むはずだが、それでも復旧できなかった日の最後の手段として残す。
function XBredoToday() {
  _ignoreTweetedMarks = true;
  try {
    XBmain();
  } finally {
    _ignoreTweetedMarks = false;
  }
}

// ===== 通知対象判定（バランス案）=====
// 申込締切: 3日前・1日前・当日 / 入金: 1日前・当日 / 当落: 当日のみ
function shouldNotify(type, daysLeft) {
  if (type === 'apply_end') return [0, 1, 3].indexOf(daysLeft) !== -1;
  if (type === 'payment') return [0, 1].indexOf(daysLeft) !== -1;
  if (type === 'result') return daysLeft === 0;
  if (type === 'goods_sale_end') return [0, 1].indexOf(daysLeft) !== -1; // グッズ: 1日前・当日
  return false;
}

// ===== 重複判定用にタイトルをならす =====
// 「【8/26更新】」のような先頭の注記や、全角空白・連続する空白の違いを吸収して、
// 同じお知らせが別物として2本通ってしまうのを防ぐ。
function normalizeNoticeTitle(title) {
  return String(title || '')
    .replace(/^[\s　]*【[^】]*】[\s　]*/, '')  // 先頭の【…更新】等を落とす
    .replace(/[\s　]+/g, ' ')                   // 空白の違いをならす
    .trim();
}

// ===== 種類別絵文字 =====
function emojiFor(type) {
  if (type === 'apply_end') return '📝';
  if (type === 'payment') return '💰';
  if (type === 'result') return '🎯';
  if (type === 'goods_sale_end') return '🛍️';
  return '⏰';
}

// ===== ハッシュタグ選択 =====
function hashtagFor(type) {
  if (type === 'apply_end') return '#ハロプロ申込締切のお知らせ';
  if (type === 'payment') return '#ハロプロ入金期限のお知らせ';
  if (type === 'result') return '#ハロプロ当落発表のお知らせ';
  if (type === 'goods_sale_end') return '#ハロプログッズ締切のお知らせ';
  return '';
}

// ===== 日次通知（毎晩トリガー）=====
function XBmain() {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl || !supabaseKey) {
    Logger.log('[X] Supabase プロパティ未設定');
    return;
  }

  var headers = { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey };
  var sheetMode = props.getProperty('SHEET_MODE') === 'true';

  // 「どの日の分か」= 実行時刻を2時間進めたJST日付（BASE_SHIFT_MS の説明を参照）
  var now = new Date();
  var jstOffset = 9 * 60 * 60 * 1000;
  var baseMs = now.getTime() + BASE_SHIFT_MS;
  var todayJst = new Date(Math.floor((baseMs + jstOffset) / 86400000) * 86400000 - jstOffset);
  // SHEET_MODE では翌日と翌々日の2日分を作る（それ以外は今まで通り1日分）
  var daysToBuild = sheetMode ? 2 : 1;

  // ── 3日以内の申込締切・入金期限・当落発表・グッズ通販締切 ──
  // グッズ通販締切(goods_sale_end)は、2026年7月7日のFCショップ移転までは e-LineUP!Mall 側の
  // 商品ページからしか取れず、専用の別ブロックで elineup_goods を読んでいた。
  // 移転後は締切もUPFCのニュース記事本文に載るようになり fc_deadlines に入るため、
  // 他の締切と同じこのループで扱う（別ブロックは廃止）。
  // 3日前まで拾うため余裕をみて4日先まで。2日分作る時は、2日目から数えて4日先まで
  var untilJst = new Date(todayJst.getTime() + (3 + daysToBuild) * 86400000);
  var dlUrl = supabaseUrl + '/rest/v1/fc_deadlines'
    + '?select=type,label,deadline_at,fc_news(uid,title,detail_url,scraped_at)'
    + '&type=in.(apply_end,payment,result,goods_sale_end)'
    + '&deadline_at=gte.' + todayJst.toISOString()
    + '&deadline_at=lt.' + untilJst.toISOString()
    + '&order=deadline_at.asc';
  // 取得は1回だけやり直す（相手側の一時的な不調で丸ごと空振りするのを防ぐ）
  var dlRes = fetchWithRetry(dlUrl, { headers: headers, muteHttpExceptions: true });
  if (!dlRes || dlRes.getResponseCode() !== 200) {
    Logger.log('[X] fc_deadlines 取得失敗: ' + (dlRes ? dlRes.getContentText() : '応答なし'));
    flushEmailNotify();
    return;
  }
  var deadlines = JSON.parse(dlRes.getContentText());
  if (deadlines.length === 0) {
    Logger.log('[X] 対象期間内の締切なし');
  }

  if (sheetMode) {
    var sheetId = props.getProperty('SHEET_ID');
    if (!sheetId) {
      Logger.log('[X SHEET] SHEET_ID 未設定');
      return;
    }
    // シートの行そのものが「もう用意したか」の記録になるので、「通知済み」の印は使わない。
    // （印で飛ばすと、前の晩に翌々日分として書いた告知が、今夜の翌日分から消えてしまう）
    syncSheetQueue(sheetId, buildSheetPlans(deadlines, todayJst, daysToBuild));
    // ここまで来たら「今日の分は用意できた」と記録する（見張り役 XBguard の判断材料）
    props.setProperty('X_LAST_RUN_DATE', baseDateString());
    return;
  }

  var notifiedCount = 0;
  // 「通知済み」の印を付けるタイミング:
  //   X に直接投稿したものは、その場で印を付ける（二重投稿を防ぐため）。
  //   メール／DRY RUN に積んだだけのものは、送り終えてから印を付ける。
  //   （積んだ時点で印を付けると、途中で落ちた日に印だけ残り、やり直しても
  //   全部「通知済み」で飛ばされて空になる。2026-09-03 に実際に発生）
  var pendingMarks = [];

  buildDayPosts(deadlines, todayJst).forEach(function (n) {
    if (hasBeenTweeted(n.tweetKey)) {
      Logger.log('[X] スキップ（通知済み）: ' + n.title);
      return;
    }
    try {
      var result = postTweet(n.text);
      if (result && result.queued) {
        pendingMarks.push(n.tweetKey);   // 送り終えてから印を付ける
      } else {
        markAsTweeted(n.tweetKey);       // X に投稿済みなので即座に印を付ける
      }
      notifiedCount++;
      Logger.log('[X] ツイート成功: ' + n.title);
    } catch (e) {
      Logger.log('[X] ツイート失敗: ' + e.message);
    }
    Utilities.sleep(2000);
  });

  // 締切ツイートがあった場合のみツール紹介を1回投稿
  // 同じ文言を毎日投稿するとspam判定されやすいので、4バリエーション × 2URL の組み合わせをシーケンシャルに使う
  if (notifiedCount > 0) {
    Utilities.sleep(2000);
    try {
      postTweet(buildPromoTweet());
      Logger.log('[X] ツール紹介ツイート成功');
    } catch (e) {
      Logger.log('[X] ツール紹介ツイート失敗: ' + e.message);
    }
  } else {
    // 対象が1件も無かった日も「今日は無い」と分かる1本を用意する。
    // 空のまま終わると、バッチが動いたのか落ちたのか区別が付かないため。
    try {
      postTweet(NONE_TWEET_TEXT);
      Logger.log('[X] 0件のお知らせツイートを用意');
    } catch (e) {
      Logger.log('[X] 0件のお知らせツイート失敗: ' + e.message);
    }
  }

  flushEmailNotify();

  // 送り終えたので、積んでおいた分に「通知済み」の印を付ける
  pendingMarks.forEach(function (key) { markAsTweeted(key); });

  // ここまで来たら「今日の分は用意できた」と記録する（見張り役 XBguard の判断材料）
  props.setProperty('X_LAST_RUN_DATE', baseDateString());
}

// ===== シートに書く日ごとの予定を組み立てる =====
// 告知がある日は最後にツール紹介を1本、無い日は「ありません」の1本
// （空のまま終わると、バッチが動いたのか落ちたのか区別が付かないため）。
// 宣伝の本文はここでは作らない（照らし合わせで新しい行が要る時だけ作る＝順番切替を余計に進めない）
function buildSheetPlans(deadlines, firstDayStart, days) {
  var plans = [];
  for (var i = 0; i < days; i++) {
    var dayStart = new Date(firstDayStart.getTime() + i * 86400000);
    var notices = buildDayPosts(deadlines, dayStart);
    var posts = notices.map(function (n) { return { kind: 'notice', key: n.key, text: n.text }; });
    if (posts.length > 0) posts.push({ kind: 'promo', key: 'promo', text: null });
    else posts.push({ kind: 'none', key: 'none', text: NONE_TWEET_TEXT });
    var date = jstDateStrOf(dayStart.getTime());
    plans.push({ date: date, posts: posts });
    Logger.log('[X SHEET] ' + date + ': 告知 ' + notices.length + '件');
  }
  return plans;
}

// ===== 1日分の告知を組み立てる（投稿もシートへの書き込みもしない）=====
// dayStart: その日の JST 0時（Date）。「あと○時間」はその日の 07:00 から数える。
// 返り値: [{ key, tweetKey, text, title }]。締切の早い順。
//   key      : シートの照合キー。種類・締切時刻・ならしたタイトル・あと何日 で決める。
//              記事のuidは入れない（同じ内容の記事が2本ある時、どちらを残すかが晩ごとに
//              入れ替わっても、別の告知として取り消し・入れ直しにならないように）
//   tweetKey : 「通知済み」の印のキー（直接投稿・メールの時だけ使う）
function buildDayPosts(deadlines, dayStart) {
  var jstOffset = 9 * 60 * 60 * 1000;
  // 同じ内容のお知らせが別記事として2本立つのを防ぐ見張り。
  // UPFC側が同一内容の記事を別uidで2つ出すことがあり（2026-09-02のつばきCONCERT等）、
  // そのままだと同じ文面のツイートが2本並ぶため、1本だけを通す。
  //
  // どちらを残すかが重要。古い方の記事は、UPFCが取り下げて中身が空になっていることが
  // ある（ページは200を返すが本文が消える）。空のページへ誘導しないよう、
  // 「あとから取り込まれた方（scraped_at が新しい方）」を残す。
  var bestByNotice = {};
  deadlines.forEach(function (d) {
    var t = d.fc_news ? d.fc_news.title : '';
    var key = d.type + '|' + d.deadline_at + '|' + normalizeNoticeTitle(t);
    var scraped = (d.fc_news && d.fc_news.scraped_at) ? String(d.fc_news.scraped_at) : '';
    var cur = bestByNotice[key];
    if (!cur || scraped > cur.scraped) {
      bestByNotice[key] = { uid: d.fc_news ? d.fc_news.uid : '', scraped: scraped };
    }
  });
  var seenNotices = {};
  var out = [];

  deadlines.forEach(function (d) {
    var uid = d.fc_news ? d.fc_news.uid : d.type + '_' + d.deadline_at;
    var newsTitle = d.fc_news ? d.fc_news.title : '（タイトル不明）';
    var detailUrl = d.fc_news ? d.fc_news.detail_url : '';

    // あと何日か（JST日付ベースで計算）
    var dlDate = new Date(d.deadline_at);
    var dlDateJst = new Date(dlDate.getTime() + jstOffset);
    var dlDayStart = Date.UTC(dlDateJst.getUTCFullYear(), dlDateJst.getUTCMonth(), dlDateJst.getUTCDate()) - jstOffset;
    var daysLeft = Math.round((dlDayStart - dayStart.getTime()) / 86400000);

    // バランス案の通知対象外はスキップ
    if (!shouldNotify(d.type, daysLeft)) {
      Logger.log('[X] 対象外スキップ: ' + newsTitle + ' (' + d.type + ', あと' + daysLeft + '日)');
      return;
    }

    // 中身が同じお知らせ（種類・締切時刻・タイトルが一致）は1本だけにする。
    // 残すのは、あとから取り込まれた記事（古い方は中身が空になっていることがあるため）。
    var noticeKey = d.type + '|' + d.deadline_at + '|' + normalizeNoticeTitle(newsTitle);
    var best = bestByNotice[noticeKey];
    if (best && best.uid && uid !== best.uid) {
      Logger.log('[X] 重複スキップ（同内容で古い方の記事）: ' + newsTitle);
      return;
    }
    if (seenNotices[noticeKey]) {
      Logger.log('[X] 重複スキップ（同内容の別記事）: ' + newsTitle);
      return;
    }
    seenNotices[noticeKey] = true;

    // 日数/時間ラベル
    // 当日：「あとN時間」のみ
    // 1日前：「あと1日（あとN時間）」併記
    // 2日以上前：「あとN日」のみ
    var daysLabel;
    if (daysLeft <= 1) {
      // 朝7時（投稿時刻）基準で残り時間を切り上げ（GAS実行は前の晩だが投稿は7時）
      var postTimeJst = new Date(dayStart.getTime() + 7 * 60 * 60 * 1000);
      var hoursLeft = Math.ceil((dlDate.getTime() - postTimeJst.getTime()) / (60 * 60 * 1000));
      if (hoursLeft <= 0) {
        // 万一締切過ぎてたらスキップ（セーフティ）
        Logger.log('[X] 締切超過スキップ: ' + newsTitle);
        return;
      }
      if (daysLeft === 0) {
        daysLabel = 'あと' + hoursLeft + '時間';
      } else {
        // daysLeft === 1：併記
        daysLabel = 'あと1日（あと' + hoursLeft + '時間）';
      }
    } else {
      daysLabel = 'あと' + daysLeft + '日';
    }

    var text = emojiFor(d.type) + ' ' + d.label + '【' + daysLabel + '】\n\n'
      + newsTitle + '\n'
      + d.label + '：' + formatJstDate(d.deadline_at) + ' ' + formatJstTime(d.deadline_at) + '\n\n'
      + (detailUrl ? '詳細 → ' + detailUrl + '\n' : '')
      + hashtagFor(d.type);

    out.push({
      key: noticeKey + '|d' + daysLeft,
      // 通知キー：日数ごとに別にして、同じ締切を3日前/1日前/当日で別カウント
      tweetKey: uid + '_' + d.type + '_d' + daysLeft,
      text: text,
      title: newsTitle + ' (' + daysLabel + ')',
    });
  });
  return out;
}

// ===== 宣伝ツイートのシーケンシャル切替 =====
// 同じ定型文の連投を避けるため、4文言 × 2URLの4ペアを順番に使い回す
function buildPromoTweet() {
  var VARIANTS = [
    { text: 'FCチケットの申込・入金期限、まとめて確認できるツールあるよ🐰', url: 'https://x.com/hop_rabbit_hop/status/2041114959590101294' },
    { text: 'ガントチャートで申込期間と入金期間を可視化してます🐰', url: 'https://x.com/hop_rabbit_hop/status/2058673226100936928' },
    { text: 'UPFCの申込状況を貼り付けるだけで締切一覧化できるツール、こちら🐰', url: 'https://x.com/hop_rabbit_hop/status/2041114959590101294' },
    { text: 'スマホ標準カレンダーと自動同期できる機能を追加しました🐰', url: 'https://x.com/hop_rabbit_hop/status/2058673226100936928' },
  ];
  var props = PropertiesService.getScriptProperties();
  var lastIndex = parseInt(props.getProperty('X_PROMO_LAST_INDEX') || '-1', 10);
  if (isNaN(lastIndex)) lastIndex = -1;
  var nextIndex = (lastIndex + 1) % VARIANTS.length;
  props.setProperty('X_PROMO_LAST_INDEX', String(nextIndex));
  var v = VARIANTS[nextIndex];
  return v.text + '\n' + v.url;
}

// ===== JST 日付フォーマット（"4/5(土)" 形式）=====
function formatJstDate(isoString) {
  var d = new Date(isoString);
  var jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  var days = ['日', '月', '火', '水', '木', '金', '土'];
  return (jst.getUTCMonth() + 1) + '/' + jst.getUTCDate() + '(' + days[jst.getUTCDay()] + ')';
}

// ===== JST 時刻フォーマット（"23:59" 形式）=====
function formatJstTime(isoString) {
  var d = new Date(isoString);
  var jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return String(jst.getUTCHours()).padStart(2, '0')
    + ':' + String(jst.getUTCMinutes()).padStart(2, '0');
}

// ===== X API v2 ツイート投稿（OAuth 1.0a）=====
function postTweet(text) {
  var props = PropertiesService.getScriptProperties();

  // 返り値: { queued: true } = キューに積んだだけ（まだ外に出ていない）
  //         X API の応答オブジェクト = 実際に X へ投稿した
  // 呼び出し側（XBmain）はこの違いで「通知済み」の印を付けるタイミングを変える。

  // X_DRY_RUN=true のときは投稿せずログに出すだけ
  if (props.getProperty('X_DRY_RUN') === 'true') {
    Logger.log('[X DRY RUN] --- 文面確認 ---\n' + text + '\n--- ここまで ---');
    return { queued: true };
  }

  // EMAIL_NOTIFY=true のときはメールキューに積んで後でまとめて送信
  if (props.getProperty('EMAIL_NOTIFY') === 'true') {
    _emailQueue.push({ label: text.split('\n')[0], text: text });
    Logger.log('[X EMAIL] キュー追加: ' + text.split('\n')[0]);
    return { queued: true };
  }

  // SHEET_MODE=true のときは X に出さない。XBmain はシートへ syncSheetQueue で直接書くので
  // ここは通らないが、ほかの所から呼ばれても誤って投稿しないよう、積むだけにしておく
  if (props.getProperty('SHEET_MODE') === 'true') {
    _sheetQueue.push({ text: text });
    Logger.log('[X SHEET] キュー追加: ' + text.split('\n')[0]);
    return { queued: true };
  }

  var apiKey = props.getProperty('X_API_KEY');
  var apiSecret = props.getProperty('X_API_SECRET');
  var accessToken = props.getProperty('X_ACCESS_TOKEN');
  var tokenSecret = props.getProperty('X_ACCESS_TOKEN_SECRET');

  if (!apiKey || !apiSecret || !accessToken || !tokenSecret) {
    throw new Error('X API プロパティ未設定 (X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET)');
  }

  var url = 'https://api.x.com/2/tweets';
  var method = 'POST';
  var body = JSON.stringify({ text: text });
  var auth = buildOAuth1Header(method, url, apiKey, apiSecret, accessToken, tokenSecret);

  var res = UrlFetchApp.fetch(url, {
    method: method,
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
    },
    payload: body,
    muteHttpExceptions: true,
  });

  var code = res.getResponseCode();
  if (code !== 201) {
    throw new Error('X API エラー(' + code + '): ' + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}

// ===== OAuth 1.0a 署名ヘッダー生成 =====
function buildOAuth1Header(method, url, apiKey, apiSecret, accessToken, tokenSecret) {
  var nonce = Utilities.base64Encode(
    Utilities.newBlob(Math.random().toString(36) + Math.random().toString(36)).getBytes()
  ).replace(/[^a-zA-Z0-9]/g, '');
  var timestamp = Math.floor(Date.now() / 1000).toString();

  var oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: '1.0',
  };

  // ソート済みパラメータ文字列
  var paramString = Object.keys(oauthParams).sort().map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(oauthParams[k]);
  }).join('&');

  // 署名ベース文字列
  var sigBase = method.toUpperCase() + '&'
    + encodeURIComponent(url) + '&'
    + encodeURIComponent(paramString);

  // HMAC-SHA1 署名
  var sigKey = encodeURIComponent(apiSecret) + '&' + encodeURIComponent(tokenSecret);
  var sig = Utilities.base64Encode(Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, sigBase, sigKey));

  oauthParams['oauth_signature'] = sig;

  return 'OAuth ' + Object.keys(oauthParams).sort().map(function (k) {
    return encodeURIComponent(k) + '="' + encodeURIComponent(oauthParams[k]) + '"';
  }).join(', ');
}