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
 * 行の指し方（id）と時刻:
 *   2026-11-01 から x-bot.js が2日分を書き出し、前の晩の行を残すようになった。
 *   行が残ったり外れたりしても指す行と時刻が動かないよう、x-bot.js が「行ID」「予約時刻」の
 *   列を書く。id は行IDの値、scheduledTime は予約時刻の値をそのまま返す。
 *   その列が無い古い行だけは、これまで通り id＝行の位置番号（データ1行目=1）、
 *   時刻＝予約投稿日ごとに07:00から1分刻み（同じ日の中で何番目か）で計算する。
 *   呼び出し側（エージェント／ツール）は一切計算せず、返ってきた値をそのまま使う。
 *
 * エンドポイント（すべてGET。ブラウザでURLを開けば動く）:
 *   ?action=getQueue&token=…
 *     → 全行を位置順で返す。各行に k と id(=位置番号)、status、scheduledTime(=07:00起点で
 *       その日の中の順番から計算した予約時刻)を付ける。
 *   ?action=getQueue&token=…&date=YYYY-MM-DD
 *     → 指定した「予約投稿日」の行だけに絞って返す（dateを省略した場合と挙動は変えない）。
 *       絞り込んでも k/id は全行での位置のままズラさない（markScheduled が同じ位置を指せるように）。
 *
 *   ?action=markScheduled&id=…&token=…
 *     → 指定位置の行のステータスを「予約済み」に上書き（追記しない＝誤連結しない）。
 *       冪等（2回叩いても同じ）。範囲外の位置は not_found。
 *
 *   ?action=markSkipped&id=…&token=…
 *     → 指定位置の行のステータスを「見送り」に上書き。markScheduledと同じ仕組みで、
 *       「今日はもう出さない」という記帳だけを行う（投稿はしない）。
 *       getQueueがこのステータスの行を「残り」から除外するのは呼び出し側（台本）の役目。
 *
 *   ?action=markCancelled&id=…&token=…
 *     → 「要取り消し」の行を「取り消し済み」にし、「取り消し履歴」シートに1行残す
 *       （X の予約から消したあとに呼ぶ。2026-11-01 Hop 決定「消した履歴残しといて」）。
 *       要取り消し以外の行は not_needs_cancel で断る。冪等（取り消し済みなら already:true）。
 *
 *   ?action=reportRun&token=…&ok=…&scheduled=…&failed=…&note=…
 *     → 実行結果をログシート「実行ログ」に1行追記し、GAS無料メールで通知する。
 *
 * スマホ用一覧ページ（JSON窓口とは別の入口）:
 *   ?token=…（actionを付けない）でこのURLを開くと、x-queue-page.html を返す。
 *   PCのTampermonkeyが使えない時（外泊等）に、スマホのブラウザだけで一覧確認・
 *   本文コピー・「済み／見送り」の記帳ができる。ホーム画面にtoken入りのURLを
 *   ブックマークしておけば、以後はタップするだけで開く。
 *   ページ内部は google.script.run 経由で pageGetQueue/pageMarkScheduled/
 *   pageMarkSkipped を呼ぶ（URLのクエリパラメータではなくこの3関数の引数として
 *   tokenを渡す方式。ページ自体はgoogleusercontent.com経由で表示されるため、
 *   クライアント側のJavaScriptから元のURLのクエリを直接読めないことへの対処）。
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
 *
 * 【削除済み関数（必要になったらgit履歴から復元）】
 * debugTestMarkFlow（2026-08-19、見送る/済みの動作確認用。実行ログはok:true・
 * ステータス反映・後片付けまで確認済みで、確認後に削除）
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

// ヘッダー名（x-bot.js の QUEUE_HEADER と一致させること）
var COL = {
  text: 'ツイート本文',
  status: 'ステータス',
  scheduledDate: '予約投稿日',
  writtenAt: '書き出し日時',
  time: '予約時刻',
  kind: '種類',
  rowId: '行ID',
  memo: 'メモ',
};
var STATUS_SCHEDULED = '予約済み';
var STATUS_SKIPPED = '見送り'; // 台本(xpostassistant.user.js)のSTATUS_SKIPPEDと一致させること
var STATUS_NEEDS_CANCEL = '要取り消し';
var STATUS_CANCELLED = '取り消し済み';
var HISTORY_SHEET_NAME = '取り消し履歴';

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  // actionが無いアクセスはスマホ用一覧ページを返す（JSON窓口とは別の入口）。
  // ページの外枠自体は誰でも開けるが、中の一覧データは合言葉が無いと読み込まれない
  // （中身はgoogle.script.run経由でpageGetQueue等を呼ぶ時にだけ照合する）。
  // URLに ?token=… が付いていれば、ページ側のJavaScriptが直接読めないため
  // （googleusercontent.com経由の表示なのでURLのクエリを見れない）、テンプレートで
  // サーバー側からページに埋め込む。ホーム画面に「トークン入りのURL」をブックマーク
  // しておけば、以後は毎回の手入力が要らなくなる。
  if (!params.action) {
    var template = HtmlService.createTemplateFromFile('x-queue-page');
    template.initialToken = params.token || '';
    return template.evaluate()
      .setTitle('X投稿キュー')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
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
    if (action === 'getQueue') return jsonOut(getQueue(params.date));
    if (action === 'markScheduled') return jsonOut(markScheduled(params.id));
    if (action === 'markSkipped') return jsonOut(markSkipped(params.id));
    if (action === 'markCancelled') return jsonOut(markCancelled(params.id));
    if (action === 'reportRun') return jsonOut(reportRun(params));
    return jsonOut({ ok: false, error: 'unknown_action', action: action });
  } catch (err) {
    return jsonOut({ ok: false, error: 'exception', message: String(err && err.message || err) });
  }
}

// ===== スマホ用一覧ページから呼ばれるサーバー関数（google.script.run経由）=====
// URLのクエリパラメータを介さないので、ここで個別にトークン照合する。
function pageGetQueue(token) {
  if (!checkToken(token)) return { ok: false, error: 'unauthorized' };
  return getQueue(null);
}

function pageMarkScheduled(token, id) {
  if (!checkToken(token)) return { ok: false, error: 'unauthorized' };
  return markScheduled(id);
}

function pageMarkSkipped(token, id) {
  if (!checkToken(token)) return { ok: false, error: 'unauthorized' };
  return markSkipped(id);
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
// dateFilter を渡すと「予約投稿日」がその値と一致する行だけに絞る。省略時は今まで通り全行。
// 絞り込んでも k/id は「全行での位置」のまま採番する（= markScheduled が指す位置がズレない）。
function getQueue(dateFilter) {
  var sheet = openQueueSheet();
  if (!sheet) return { ok: false, error: 'queue_sheet_missing' };

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return { ok: true, action: 'getQueue', serverDateJst: todayJst(), date: dateFilter || null, count: 0, items: [] };
  }

  var idx = resolveColumns(values[0]);
  if (idx.text < 0 || idx.status < 0) {
    return { ok: false, error: 'header_mismatch', header: values[0] };
  }

  var items = [];
  var position = 0;
  var rankByDate = {};                                      // 予約投稿日ごとの「その日の中で何番目か」カウンタ
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    // 空行はスキップ（本文が空なら行として扱わない）
    if (String(row[idx.text]).trim() === '') continue;
    position++;                                             // 全行での位置(1始まり)。行IDが無い古い行の id に使う
    var scheduledDate = idx.scheduledDate >= 0 ? formatDateCell(row[idx.scheduledDate]) : '';
    rankByDate[scheduledDate] = (rankByDate[scheduledDate] || 0) + 1;
    var rankInDay = rankByDate[scheduledDate];                // 同じ日の中での順番(1始まり)。古い行の時刻計算に使う
    if (dateFilter && scheduledDate !== dateFilter) continue; // 指定日以外は結果に含めない（位置番号は詰め直さない）
    var rowId = idx.rowId >= 0 ? String(row[idx.rowId]) : '';
    var timeCell = idx.time >= 0 ? String(row[idx.time]) : '';
    items.push({
      k: position,
      id: rowId || String(position),                       // markScheduled 等で使う。行IDがあればそれ
      text: String(row[idx.text]),
      status: String(row[idx.status]),
      scheduledDate: scheduledDate,
      // "HH:mm"。列の値があればそのまま、無い古い行は 07:00 +(その日の順番-1)分
      scheduledTime: /^\d{2}:\d{2}$/.test(timeCell) ? timeCell : computeScheduledTime(rankInDay),
      kind: idx.kind >= 0 ? String(row[idx.kind]) : '',
      memo: idx.memo >= 0 ? String(row[idx.memo]) : '',     // 要取り消しの理由など
    });
  }

  return {
    ok: true,
    action: 'getQueue',
    serverDateJst: todayJst(),
    date: dateFilter || null,
    count: items.length,
    items: items,
  };
}

// ===== ステータス更新（冪等）=====
// id は getQueue が返した位置番号(1始まり)。同じ数え方でシート行を割り出して更新する。
function markScheduled(id) {
  return setRowStatus(id, STATUS_SCHEDULED, 'markScheduled');
}

// 「今日はもう出さない」の記帳。markScheduledと同じ位置指定・同じ上書き方式で、
// ステータスだけ「見送り」にする（投稿は一切しない）。
function markSkipped(id) {
  return setRowStatus(id, STATUS_SKIPPED, 'markSkipped');
}

// 予約から消したあとの記帳。要取り消しの行だけを取り消し済みにし、取り消し履歴に1行残す
function markCancelled(id) {
  return setRowStatus(id, STATUS_CANCELLED, 'markCancelled', {
    onlyFrom: STATUS_NEEDS_CANCEL,
    afterSet: appendCancelHistory,
  });
}

function appendCancelHistory(ss, rowValues, idx) {
  var hist = ss.getSheetByName(HISTORY_SHEET_NAME) || ss.insertSheet(HISTORY_SHEET_NAME);
  if (hist.getLastRow() === 0) {
    hist.appendRow(['取り消した日時(JST)', '予約投稿日', '予約時刻', '種類', '理由', 'ツイート本文', '行ID']);
    hist.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
  var cell = function (i) { return i >= 0 ? String(rowValues[i]) : ''; };
  var line = [nowJstStr(), idx.scheduledDate >= 0 ? formatDateCell(rowValues[idx.scheduledDate]) : '',
    cell(idx.time), cell(idx.kind), cell(idx.memo), cell(idx.text), cell(idx.rowId)];
  var range = hist.getRange(hist.getLastRow() + 1, 1, 1, line.length);
  range.setNumberFormat('@');   // 日付・時刻をシート側で日付型に変えさせない
  range.setValues([line]);
}

// opts.onlyFrom: この状態の行だけ書き換える（違えば断る）/ opts.afterSet: 書き換えた直後に呼ぶ
function setRowStatus(id, targetStatus, actionName, opts) {
  opts = opts || {};
  if (!id) return { ok: false, error: 'missing_id' };

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

    var r = findRowIndex(values, idx, String(id));
    if (r < 0) return { ok: false, error: 'not_found', id: String(id) };

    var current = String(values[r][idx.status]);
    if (current === targetStatus) {
      return { ok: true, action: actionName, id: String(id), status: targetStatus, already: true };
    }
    if (opts.onlyFrom && current !== opts.onlyFrom) {
      return { ok: false, error: 'not_needs_cancel', id: String(id), status: current };
    }
    // 追記ではなく上書きセット（「未投稿予約済み」のような誤連結を防ぐ）
    sheet.getRange(r + 1, idx.status + 1).setValue(targetStatus);
    if (opts.afterSet) opts.afterSet(sheet.getParent(), values[r], idx);
    SpreadsheetApp.flush();
    return { ok: true, action: actionName, id: String(id), status: targetStatus, already: false };
  } finally {
    lock.releaseLock();
  }
}

// id が指すシートの行の番号(values の添字)を返す。見つからなければ -1。
// 行IDの列に同じ値があればその行。無ければ、getQueue と同じく「本文が空でない行」を
// 1,2,3…と数えた位置番号として探す（行IDの無い古い行・古い呼び出し側のため）。
function findRowIndex(values, idx, id) {
  var r;
  if (idx.rowId >= 0) {
    for (r = 1; r < values.length; r++) {
      if (String(values[r][idx.rowId]) === id && String(values[r][idx.text]).trim() !== '') return r;
    }
  }
  if (!/^\d+$/.test(id)) return -1;
  var position = parseInt(id, 10);
  var count = 0;
  for (r = 1; r < values.length; r++) {
    if (String(values[r][idx.text]).trim() === '') continue;
    count++;
    if (count === position) return r;
  }
  return -1;
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
    time: header.indexOf(COL.time),
    kind: header.indexOf(COL.kind),
    rowId: header.indexOf(COL.rowId),
    memo: header.indexOf(COL.memo),
  };
}

// 予約投稿日の中でrankInDay番目(1始まり)の投稿時刻を "HH:mm" で返す。
// 決まり: 07:00始まりで1分刻み（同じ日の中でだけ数える。日をまたいでも07:00に戻る）。
function computeScheduledTime(rankInDay) {
  var totalMinutes = 7 * 60 + (rankInDay - 1);
  var hh = Math.floor(totalMinutes / 60) % 24;
  var mm = totalMinutes % 60;
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
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
