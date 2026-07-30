/**
 * hop-up-tools X投稿キュー JSONゲートウェイ（v2）
 *
 * 目的:
 *   これまでエージェント(Claude in Chrome)が「X投稿キュー」シートのセルを
 *   画面操作で読み書きしていたのを、HTTPで叩くJSON窓口に置き換える。
 *   セル操作が消えるので、本文破壊・保存漏れ・アカウント選択画面事故が構造的に無くなる。
 *
 * 役割の限定（重要）:
 *   このゲートウェイがやるのは「キューの読み出し」と「ステータス更新」だけ。
 *   ツイート本文の書き換えや予約日の計算は一切しない（それは1時のバッチ x-bot.js の担当）。
 *   x-bot.js には手を入れず、既存シート（本文A/ステータスB/予約投稿日C/書き出し日時D）を
 *   そのまま読み書きする。
 *
 * 行の指し方（id）:
 *   idは「シート内の行の位置番号（データ1行目=1）」。K番目の投稿時刻は決定論的に
 *   予約日 07:00 +(K-1)分。getQueue はその日の全行（予約済みを含む）を位置順に返し、
 *   K は全行での位置。予約済みで飛ばしても番号は詰め直さない（＝毎回同じ時刻計算になる）。
 *   時刻の分計算は呼び出し側=エージェントが k から出す。ここでは k(=id) を返すだけ。
 *
 * エンドポイント（すべてGET。ブラウザでURLを開けば動く）:
 *   ?action=getQueue&token=…
 *     → その日の全行を位置順で返す。各行に k と id(=位置番号) と status を付ける。
 *
 *   ?action=markScheduled&id=…&token=…
 *     → 指定位置の行のステータスを「予約済み」に上書き（追記しない＝誤連結しない）。
 *       冪等（2回叩いても同じ）。範囲外の位置は not_found。
 *
 *   ?action=reportRun&token=…&ok=…&scheduled=…&failed=…&note=…
 *     → 実行結果をログシート「実行ログ」に1行追記し、GAS無料メールで通知する。
 *
 * 認証:
 *   URLに token を付け、スクリプトプロパティ GATEWAY_TOKEN と一致するか照合する。
 *
 * 事前設定（スクリプトプロパティ）:
 *   GATEWAY_TOKEN : エージェントと共有する合言葉（長いランダム文字列）
 *   SHEET_ID      : 「X投稿キュー」があるスプレッドシートID（x-bot.js と同じもの）
 *   NOTIFY_EMAIL  : reportRun の通知先（省略時はオーナーのGmail）
 *
 * レスポンスは常にHTTP200のJSON。成否は本文の ok:true/false で判断する。
 * （GASのContentServiceはHTTPステータスコードを設定できないため）
 */

var QUEUE_SHEET_NAME = 'X投稿キュー';
var LOG_SHEET_NAME = '実行ログ';

/**
 * 【最初に1回だけ手で実行する関数】GATEWAY_TOKEN（合言葉）を自動生成して保存する。
 * Apps Scriptエディタでこの関数を選んで「実行」を押すだけ。
 *   - まだ未設定なら、ランダムな長い文字列を生成してスクリプトプロパティに保存し、
 *     その値を実行ログに表示する（エージェント側のURLに &token=… で付ける値）。
 *   - 既に設定済みなら上書きせず、今の値をログに表示する（再取得用）。
 * 生成も表示もGAS内で完結し、外（このやり取り）には出さない。
 */
function setupGatewayToken() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty('GATEWAY_TOKEN');
  if (existing) {
    Logger.log('GATEWAY_TOKEN は既に設定済みです。エージェントで使う値:\n' + existing);
    return existing;
  }
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  props.setProperty('GATEWAY_TOKEN', token);
  Logger.log('GATEWAY_TOKEN を新規に設定しました。エージェントで使う値（この値をURLの &token= に付ける）:\n' + token);
  return token;
}

// ヘッダー名（x-bot.js の flushSheetQueue が書き出す列名と一致させること）
var COL = {
  text: 'ツイート本文',
  status: 'ステータス',
  scheduledDate: '予約投稿日',
  writtenAt: '書き出し日時',
};
var STATUS_SCHEDULED = '予約済み';

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  // 基本はGETで完結する想定だが、POSTで来ても同じ処理にフォールバックする
  return handleRequest(e);
}

function handleRequest(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var action = params.action || '';

  // 認証（どのactionより先に照合）
  if (!checkToken(params.token)) {
    return jsonOut({ ok: false, error: 'unauthorized' });
  }

  try {
    if (action === 'getQueue') return jsonOut(getQueue());
    if (action === 'markScheduled') return jsonOut(markScheduled(params.id));
    if (action === 'reportRun') return jsonOut(reportRun(params));
    return jsonOut({ ok: false, error: 'unknown_action', action: action });
  } catch (err) {
    return jsonOut({ ok: false, error: 'exception', message: String(err && err.message || err) });
  }
}

// ===== 認証 =====
function checkToken(given) {
  var expected = PropertiesService.getScriptProperties().getProperty('GATEWAY_TOKEN');
  if (!expected) return false;          // 合言葉未設定なら全拒否（設定漏れの事故防止）
  if (!given) return false;
  // 早期リターンで長さの当たりを与えないよう、固定長比較にしておく
  if (given.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) {
    diff |= (given.charCodeAt(i) ^ expected.charCodeAt(i));
  }
  return diff === 0;
}

// ===== キュー読み出し =====
function getQueue() {
  var sheet = openQueueSheet();
  if (!sheet) return { ok: false, error: 'queue_sheet_missing' };

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return { ok: true, action: 'getQueue', serverDateJst: todayJst(), count: 0, items: [] };
  }

  var idx = resolveColumns(values[0]);
  if (idx.text < 0 || idx.status < 0) {
    return { ok: false, error: 'header_mismatch', header: values[0] };
  }

  var items = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    // 空行はスキップ（本文が空なら行として扱わない）
    if (String(row[idx.text]).trim() === '') continue;
    var position = items.length + 1;                       // 全行での位置(1始まり)。時刻= 07:00 +(k-1)分
    items.push({
      k: position,
      id: String(position),                                // markScheduled で使う。位置番号そのもの
      text: String(row[idx.text]),
      status: String(row[idx.status]),
      scheduledDate: idx.scheduledDate >= 0 ? formatDateCell(row[idx.scheduledDate]) : '',
    });
  }

  return {
    ok: true,
    action: 'getQueue',
    serverDateJst: todayJst(),
    count: items.length,
    items: items,
  };
}

// ===== ステータス更新（冪等）=====
// id は getQueue が返した位置番号(1始まり)。同じ数え方でシート行を割り出して更新する。
function markScheduled(id) {
  var position = parseInt(id, 10);
  if (!id || isNaN(position) || position < 1) return { ok: false, error: 'missing_id' };

  // 同時アクセスでの二重書き込みを避けるため短時間ロック
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { ok: false, error: 'busy' };
  }

  try {
    var sheet = openQueueSheet();
    if (!sheet) return { ok: false, error: 'queue_sheet_missing' };

    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return { ok: false, error: 'not_found', id: String(id) };

    var idx = resolveColumns(values[0]);
    if (idx.text < 0 || idx.status < 0) {
      return { ok: false, error: 'header_mismatch', header: values[0] };
    }

    // getQueue と同じく「本文が空でない行」を1,2,3…と数え、position番目を対象にする
    var count = 0;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][idx.text]).trim() === '') continue;
      count++;
      if (count === position) {
        var current = String(values[r][idx.status]);
        if (current === STATUS_SCHEDULED) {
          return { ok: true, action: 'markScheduled', id: String(position), status: STATUS_SCHEDULED, already: true };
        }
        // 追記ではなく上書きセット（「未投稿予約済み」のような誤連結を防ぐ）
        sheet.getRange(r + 1, idx.status + 1).setValue(STATUS_SCHEDULED);
        SpreadsheetApp.flush();
        return { ok: true, action: 'markScheduled', id: String(position), status: STATUS_SCHEDULED, already: false };
      }
    }
    return { ok: false, error: 'not_found', id: String(position) };
  } finally {
    lock.releaseLock();
  }
}

// ===== 実行結果のログ＋通知 =====
function reportRun(params) {
  var okFlag = params.ok;
  var scheduled = params.scheduled || '';
  var failed = params.failed || '';
  var note = params.note || '';

  // ログシートに追記
  var ss = openSpreadsheet();
  if (!ss) return { ok: false, error: 'spreadsheet_missing' };
  var log = ss.getSheetByName(LOG_SHEET_NAME) || ss.insertSheet(LOG_SHEET_NAME);
  if (log.getLastRow() === 0) {
    log.appendRow(['記録日時(JST)', 'ok', '予約成功数', '失敗数', 'メモ']);
    log.getRange(1, 1, 1, 5).setFontWeight('bold');
  }
  log.appendRow([nowJstStr(), okFlag, scheduled, failed, note]);

  // メール通知
  var mailed = false;
  try {
    var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL')
      || Session.getEffectiveUser().getEmail();
    if (to) {
      MailApp.sendEmail({
        to: to,
        subject: '[hop-up-tools] X予約投稿の実行結果 (' + todayJst() + ')',
        body: '結果: ' + (okFlag === 'true' || okFlag === true ? '成功' : okFlag) + '\n'
          + '予約成功数: ' + scheduled + '\n'
          + '失敗数: ' + failed + '\n'
          + 'メモ: ' + note + '\n',
      });
      mailed = true;
    }
  } catch (e) {
    // メール失敗はログ追記の成否に影響させない
  }

  return { ok: true, action: 'reportRun', logged: true, mailed: mailed };
}

// ===== 補助 =====
function openSpreadsheet() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) return null;
  return SpreadsheetApp.openById(sheetId);
}

function openQueueSheet() {
  var ss = openSpreadsheet();
  if (!ss) return null;
  return ss.getSheetByName(QUEUE_SHEET_NAME);
}

// ヘッダー行から各列の位置(0始まり)を名前で引く。列順が変わっても壊れない
function resolveColumns(header) {
  return {
    text: header.indexOf(COL.text),
    status: header.indexOf(COL.status),
    scheduledDate: header.indexOf(COL.scheduledDate),
  };
}

// 予約投稿日セルは、シート側で日付型に変換されていることがある。
// Date型なら "yyyy-MM-dd"(JST) に整える。文字列ならそのまま返す。
function formatDateCell(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(v);
}

function todayJst() {
  var nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return nowJst.getUTCFullYear() + '-'
    + String(nowJst.getUTCMonth() + 1).padStart(2, '0') + '-'
    + String(nowJst.getUTCDate()).padStart(2, '0');
}

function nowJstStr() {
  var nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return todayJst() + ' '
    + String(nowJst.getUTCHours()).padStart(2, '0') + ':'
    + String(nowJst.getUTCMinutes()).padStart(2, '0') + ':'
    + String(nowJst.getUTCSeconds()).padStart(2, '0');
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
