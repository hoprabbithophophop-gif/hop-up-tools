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
 * XBmain               : 毎日 0〜1時 JST に実行（時間主導型トリガー）
 *                         → 3日以内の申込締切・入金期限・当落発表を通知
 *
 * 【通知ルール（バランス案）】
 *   申込締切（apply_end）: 3日前・1日前・当日
 *   入金期限（payment）  : 1日前・当日
 *   当落発表（result）   : 当日のみ
 *   当日通知は「あとN時間」表記（24時間未満を時間単位で表示）
 */

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
// Claude in Chrome が読み取って X に投稿する用
var _sheetQueue = [];

function flushSheetQueue() {
  var props = PropertiesService.getScriptProperties();
  // SHEET_MODE でなければ何もしない
  if (props.getProperty('SHEET_MODE') !== 'true') return;
  var sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) {
    Logger.log('[X SHEET] SHEET_ID 未設定');
    return;
  }
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName('X投稿キュー') || ss.insertSheet('X投稿キュー');

  // GAS実行時のJST日付（=予約投稿日）。GASが午前0〜1時に動く想定なので「今日」になる
  var nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  var scheduledDate = nowJst.getUTCFullYear() + '-'
    + String(nowJst.getUTCMonth() + 1).padStart(2, '0') + '-'
    + String(nowJst.getUTCDate()).padStart(2, '0');
  var nowStr = scheduledDate + ' '
    + String(nowJst.getUTCHours()).padStart(2, '0') + ':'
    + String(nowJst.getUTCMinutes()).padStart(2, '0');

  // ヘッダー処理（新規作成 / 旧3列構成 / 既に4列の3パターン対応）
  if (sheet.getLastRow() === 0) {
    // 新規：4列で作成
    sheet.appendRow(['ツイート本文', 'ステータス', '予約投稿日', '書き出し日時']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  } else {
    // 既存シート：旧3列構成なら自動で4列化
    var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headerRow[2] === '書き出し日時') {
      sheet.insertColumnBefore(3);
      sheet.getRange(1, 3).setValue('予約投稿日').setFontWeight('bold');
      Logger.log('[X SHEET] ヘッダーを3列→4列にマイグレーション完了');
    }
  }

  // 既存データ行を全削除（ヘッダーのみ残す）
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }

  // 新しいツイート文面を書き込み（C列に予約投稿日を明示）
  _sheetQueue.forEach(function (item) {
    sheet.appendRow([item.text, '未投稿', scheduledDate, nowStr]);
  });

  Logger.log('[X SHEET] スプシ書き出し: ' + _sheetQueue.length + '件 (予約投稿日: ' + scheduledDate + ')');
  _sheetQueue = [];
}


// ===== ツイート済みUID管理（Script Properties に保存）=====
function hasBeenTweeted(uid) {
  var tweeted = JSON.parse(
    PropertiesService.getScriptProperties().getProperty('X_TWEETED_UIDS') || '[]'
  );
  return tweeted.indexOf(uid) !== -1;
}

function markAsTweeted(uid) {
  var props = PropertiesService.getScriptProperties();
  var tweeted = JSON.parse(props.getProperty('X_TWEETED_UIDS') || '[]');
  tweeted.push(uid);
  if (tweeted.length > 500) tweeted = tweeted.slice(-500); // 上限500件
  props.setProperty('X_TWEETED_UIDS', JSON.stringify(tweeted));
}

// ===== 通知対象判定（バランス案）=====
// 申込締切: 3日前・1日前・当日 / 入金: 1日前・当日 / 当落: 当日のみ
function shouldNotify(type, daysLeft) {
  if (type === 'apply_end') return [0, 1, 3].indexOf(daysLeft) !== -1;
  if (type === 'payment') return [0, 1].indexOf(daysLeft) !== -1;
  if (type === 'result') return daysLeft === 0;
  return false;
}

// ===== 種類別絵文字 =====
function emojiFor(type) {
  if (type === 'apply_end') return '📝';
  if (type === 'payment') return '💰';
  if (type === 'result') return '🎯';
  return '⏰';
}

// ===== ハッシュタグ選択 =====
function hashtagFor(type) {
  if (type === 'apply_end') return '#ハロプロ申込締切のお知らせ';
  if (type === 'payment') return '#ハロプロ入金期限のお知らせ';
  if (type === 'result') return '#ハロプロ当落発表のお知らせ';
  return '';
}

// ===== 日次通知（毎朝トリガー）=====
function XBmain() {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl || !supabaseKey) {
    Logger.log('[X] Supabase プロパティ未設定');
    return;
  }

  var headers = { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey };

  // 今日 JST の 00:00〜翌 00:00
  var now = new Date();
  var jstOffset = 9 * 60 * 60 * 1000;
  var todayJst = new Date(Math.floor((now.getTime() + jstOffset) / 86400000) * 86400000 - jstOffset);

  // ── 3日以内の申込締切・入金期限・当落発表 ──
  var in4daysJst = new Date(todayJst.getTime() + 4 * 86400000); // 3日前まで拾うため余裕をみて4日
  var dlRes = UrlFetchApp.fetch(
    supabaseUrl + '/rest/v1/fc_deadlines'
    + '?select=type,label,deadline_at,fc_news(uid,title,detail_url)'
    + '&type=in.(apply_end,payment,result)'
    + '&deadline_at=gte.' + todayJst.toISOString()
    + '&deadline_at=lt.' + in4daysJst.toISOString()
    + '&order=deadline_at.asc',
    { headers: headers, muteHttpExceptions: true }
  );
  if (dlRes.getResponseCode() !== 200) {
    Logger.log('[X] fc_deadlines 取得失敗: ' + dlRes.getContentText());
    flushEmailNotify();
    return;
  }
  var deadlines = JSON.parse(dlRes.getContentText());
  if (deadlines.length === 0) {
    Logger.log('[X] 対象期間内の締切なし');
  }

  var notifiedCount = 0;

  deadlines.forEach(function (d) {
    var uid = d.fc_news ? d.fc_news.uid : d.type + '_' + d.deadline_at;
    var newsTitle = d.fc_news ? d.fc_news.title : '（タイトル不明）';
    var detailUrl = d.fc_news ? d.fc_news.detail_url : '';

    // あと何日か（JST日付ベースで計算）
    var dlDate = new Date(d.deadline_at);
    var dlDateJst = new Date(dlDate.getTime() + jstOffset);
    var dlDayStart = new Date(Date.UTC(dlDateJst.getUTCFullYear(), dlDateJst.getUTCMonth(), dlDateJst.getUTCDate()));
    var daysLeft = Math.round((dlDayStart.getTime() - todayJst.getTime()) / 86400000);

    // バランス案の通知対象外はスキップ
    if (!shouldNotify(d.type, daysLeft)) {
      Logger.log('[X] 対象外スキップ: ' + newsTitle + ' (' + d.type + ', あと' + daysLeft + '日)');
      return;
    }

    // 日数/時間ラベル
    // 当日：「あとN時間」のみ
    // 1日前：「あと1日（あとN時間）」併記
    // 2日以上前：「あとN日」のみ
    var daysLabel;
    if (daysLeft <= 1) {
      // 朝7時（投稿時刻）基準で残り時間を切り上げ（GAS実行は0〜1時だが投稿は7時）
      var postTimeJst = new Date(todayJst.getTime() + 7 * 60 * 60 * 1000);
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

    // 通知キー：日数ごとに別にして、同じ締切を3日前/1日前/当日で別カウント
    var tweetKey = uid + '_' + d.type + '_d' + daysLeft;
    if (hasBeenTweeted(tweetKey)) {
      Logger.log('[X] スキップ（通知済み）: ' + newsTitle);
      return;
    }

    try {
      postTweet(text);
      markAsTweeted(tweetKey);
      notifiedCount++;
      Logger.log('[X] ツイート成功: ' + newsTitle + ' (' + daysLabel + ')');
    } catch (e) {
      Logger.log('[X] ツイート失敗: ' + e.message);
    }
    Utilities.sleep(2000);
  });

  // 締切ツイートがあった場合のみツール紹介を1回投稿
  if (notifiedCount > 0) {
    Utilities.sleep(2000);
    try {
      postTweet('締切管理ツールとして使えます🐰\nhttps://x.com/hop_rabbit_hop/status/2041114959590101294?s=20');
      Logger.log('[X] ツール紹介ツイート成功');
    } catch (e) {
      Logger.log('[X] ツール紹介ツイート失敗: ' + e.message);
    }
  }

  flushEmailNotify();
  flushSheetQueue();
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

  // X_DRY_RUN=true のときは投稿せずログに出すだけ
  if (props.getProperty('X_DRY_RUN') === 'true') {
    Logger.log('[X DRY RUN] --- 文面確認 ---\n' + text + '\n--- ここまで ---');
    return;
  }

  // EMAIL_NOTIFY=true のときはメールキューに積んで後でまとめて送信
  if (props.getProperty('EMAIL_NOTIFY') === 'true') {
    _emailQueue.push({ label: text.split('\n')[0], text: text });
    Logger.log('[X EMAIL] キュー追加: ' + text.split('\n')[0]);
    return;
  }

  // SHEET_MODE=true のときはスプシキューに積んで後でまとめて書き出し
  if (props.getProperty('SHEET_MODE') === 'true') {
    _sheetQueue.push({ text: text });
    Logger.log('[X SHEET] キュー追加: ' + text.split('\n')[0]);
    return;
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