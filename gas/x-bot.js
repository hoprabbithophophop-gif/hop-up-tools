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
 * X_DRY_RUN             : "true" にするとログ出力のみ（投稿・メール送信ともしない）
 *
 * 【トリガー設定】
 * XBmain               : 毎朝9:00 JST に実行（時間主導型トリガー）
 *                         → 今日の新着チケット情報＋本日の申込・入金締切を通知
 */

// ===== メール通知キュー（EMAIL_NOTIFY=true のとき使用）=====
// 1回の実行で溜まったツイート文面をまとめて1通のメールで送る
var _emailQueue = [];

function flushEmailNotify() {
  if (_emailQueue.length === 0) return;
  var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL')
    || Session.getEffectiveUser().getEmail();
  var body = _emailQueue.map(function(item, i) {
    return '【' + (i + 1) + '】 ' + item.label + '\n\n' + item.text;
  }).join('\n\n' + '─'.repeat(30) + '\n\n');
  MailApp.sendEmail({
    to:      to,
    subject: '[hop-up-tools] ツイート予定 ' + _emailQueue.length + '件 (' + new Date().toLocaleDateString('ja-JP') + ')',
    body:    body,
  });
  Logger.log('[X EMAIL] メール送信: ' + _emailQueue.length + '件 → ' + to);
  _emailQueue = [];
}


// ===== ツイート済みUID管理（Script Properties に保存）=====
function hasBeenTweeted(uid) {
  var tweeted = JSON.parse(
    PropertiesService.getScriptProperties().getProperty('X_TWEETED_UIDS') || '[]'
  );
  return tweeted.indexOf(uid) !== -1;
}

function markAsTweeted(uid) {
  var props   = PropertiesService.getScriptProperties();
  var tweeted = JSON.parse(props.getProperty('X_TWEETED_UIDS') || '[]');
  tweeted.push(uid);
  if (tweeted.length > 500) tweeted = tweeted.slice(-500); // 上限500件
  props.setProperty('X_TWEETED_UIDS', JSON.stringify(tweeted));
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
  var todayJst    = new Date(Math.floor((now.getTime() + jstOffset) / 86400000) * 86400000 - jstOffset);
  var tomorrowJst = new Date(todayJst.getTime() + 86400000);
  var todayIso    = todayJst.toISOString();
  var tomorrowIso = tomorrowJst.toISOString();

  // ── 3日以内の申込締切・入金締切 ──
  var in3daysJst = new Date(todayJst.getTime() + 3 * 86400000);
  var dlRes = UrlFetchApp.fetch(
    supabaseUrl + '/rest/v1/fc_deadlines'
      + '?select=type,label,deadline_at,fc_news(uid,title,detail_url)'
      + '&type=in.(apply_end,payment)'
      + '&deadline_at=gte.' + todayIso
      + '&deadline_at=lt.'  + in3daysJst.toISOString()
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
    Logger.log('[X] 3日以内の締切なし');
  }
  deadlines.forEach(function(d) {
    var uid       = d.fc_news ? d.fc_news.uid        : d.type + '_' + d.deadline_at;
    var newsTitle = d.fc_news ? d.fc_news.title      : '（タイトル不明）';
    var detailUrl = d.fc_news ? d.fc_news.detail_url : '';
    // あと何日か計算
    var dlDate    = new Date(d.deadline_at);
    var daysLeft  = Math.ceil((dlDate.getTime() - todayJst.getTime()) / 86400000);
    var daysLabel = daysLeft === 0 ? '本日' : 'あと' + daysLeft + '日';
    var text = '⏰ ' + d.label + '【' + daysLabel + '】\n\n'
      + newsTitle + '\n'
      + d.label + '：' + formatJstDate(d.deadline_at) + ' ' + formatJstTime(d.deadline_at) + '\n\n'
      + (detailUrl ? '詳細 → ' + detailUrl + '\n' : '')
      + (d.type === 'apply_end' ? '#ハロプロ申込締切のお知らせ' : '#ハロプロ入金期限のお知らせ');
    var tweetKey = uid + '_' + d.type;
    if (hasBeenTweeted(tweetKey)) {
      Logger.log('[X] スキップ（通知済み）: ' + newsTitle);
      return;
    }
    try {
      postTweet(text);
      markAsTweeted(tweetKey);
      Logger.log('[X] ツイート成功: ' + newsTitle + ' (' + daysLabel + ')');
    } catch (e) {
      Logger.log('[X] ツイート失敗: ' + e.message);
    }
    Utilities.sleep(2000);
  });

  flushEmailNotify();
}

// ===== JST 日付フォーマット（"4/5(土)" 形式）=====
function formatJstDate(isoString) {
  var d   = new Date(isoString);
  var jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  var days = ['日', '月', '火', '水', '木', '金', '土'];
  return (jst.getUTCMonth() + 1) + '/' + jst.getUTCDate() + '(' + days[jst.getUTCDay()] + ')';
}

// ===== JST 時刻フォーマット（"23:59" 形式）=====
function formatJstTime(isoString) {
  var d   = new Date(isoString);
  var jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return String(jst.getUTCHours()).padStart(2, '0')
    + ':' + String(jst.getUTCMinutes()).padStart(2, '0');
}

// ===== X API v2 ツイート投稿（OAuth 1.0a）=====
function postTweet(text) {
  var props       = PropertiesService.getScriptProperties();

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

  var apiKey      = props.getProperty('X_API_KEY');
  var apiSecret   = props.getProperty('X_API_SECRET');
  var accessToken = props.getProperty('X_ACCESS_TOKEN');
  var tokenSecret = props.getProperty('X_ACCESS_TOKEN_SECRET');

  if (!apiKey || !apiSecret || !accessToken || !tokenSecret) {
    throw new Error('X API プロパティ未設定 (X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET)');
  }

  var url    = 'https://api.x.com/2/tweets';
  var method = 'POST';
  var body   = JSON.stringify({ text: text });
  var auth   = buildOAuth1Header(method, url, apiKey, apiSecret, accessToken, tokenSecret);

  var res = UrlFetchApp.fetch(url, {
    method:  method,
    headers: {
      'Authorization': auth,
      'Content-Type':  'application/json',
    },
    payload:           body,
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
    oauth_consumer_key:     apiKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        timestamp,
    oauth_token:            accessToken,
    oauth_version:          '1.0',
  };

  // ソート済みパラメータ文字列
  var paramString = Object.keys(oauthParams).sort().map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(oauthParams[k]);
  }).join('&');

  // 署名ベース文字列
  var sigBase = method.toUpperCase() + '&'
    + encodeURIComponent(url) + '&'
    + encodeURIComponent(paramString);

  // HMAC-SHA1 署名
  var sigKey = encodeURIComponent(apiSecret) + '&' + encodeURIComponent(tokenSecret);
  var sig    = Utilities.base64Encode(Utilities.computeHmacSha1Signature(sigBase, sigKey));

  oauthParams['oauth_signature'] = sig;

  return 'OAuth ' + Object.keys(oauthParams).sort().map(function(k) {
    return encodeURIComponent(k) + '="' + encodeURIComponent(oauthParams[k]) + '"';
  }).join(', ');
}
