/**
 * 棚の見張り（DBWATCHmain・10分ごとのトリガー想定）
 *
 * 2026-10-17 に Supabase の棚が 19:50〜23:04 の3時間、外からの問い合わせに一切返事をしなくなった
 * （管理画面は Unhealthy・Conns Unavailable。棚の中の cron は動いていた＝つなぎ口だけが全滅）。
 * 誰かが気づくまで止まりっぱなしだったので、機械に見張らせて、必要なら立て直させる（Hop 決定 2026-10-17）。
 *
 * 段1（鍵の追加なし）: 10分ごとに棚へ軽い問い合わせを1つ送る。返らなければ30秒後にもう一度。
 *   2回とも返らなければ「止まっている」と判断してメールで知らせる。戻ったら「戻った」と知らせる。
 * 段2（SUPABASE_ACCESS_TOKEN がある時だけ）: 管理用の窓口で棚の健康状態を聞き、棚が不調と返ってきた時だけ再起動を頼む。
 *   再起動は30分に1回まで。管理用の窓口が答えない・権限が無い・立ち上げ中の時は再起動しない（知らせるだけ）。
 *
 * スクリプトプロパティ:
 *   SUPABASE_URL           : 既存。棚の URL（https://<ref>.supabase.co）
 *   SUPABASE_SERVICE_KEY   : 既存。問い合わせに使う
 *   NOTIFY_EMAIL           : 既存。省略時はスクリプトオーナーの Gmail
 *   SUPABASE_ACCESS_TOKEN  : 任意。Supabase の管理用の合言葉（この棚だけに絞った fine-grained token。
 *                            project_admin_read と project_admin_write）。無ければ段2は動かず、知らせだけ
 *   DBWATCH_STATE          : この台本が自分で書く（止まっていると判断した時刻・最後に再起動を頼んだ時刻）。手で触らない
 *
 * トリガー: DBWATCHsetupTrigger を Apps Script エディタで1回実行すると、10分ごとのトリガーができる。
 *   作った後は、venue-setup-trigger.js と同じく DBWATCHsetupTrigger を gas/archive/ へ移す。
 */

var DBWATCH_STATE_PROP = 'DBWATCH_STATE';
var DBWATCH_RESTART_COOLDOWN_MS = 30 * 60 * 1000;
var DBWATCH_RETRY_WAIT_MS = 30 * 1000;

/** エントリポイント（10分ごとのトリガー） */
function DBWATCHmain() {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 未設定');

  var state = dbwatchReadState_(props);
  var now = Date.now();

  // 段1: 棚へ軽い問い合わせ。返らなければ30秒おいてもう一度
  var probe = dbwatchProbe_(supabaseUrl, supabaseKey);
  if (!probe.ok) {
    Utilities.sleep(DBWATCH_RETRY_WAIT_MS);
    probe = dbwatchProbe_(supabaseUrl, supabaseKey);
  }

  if (probe.ok) {
    if (state.downSince) {
      // 戻った
      var mins = Math.round((now - state.downSince) / 60000);
      dbwatchNotify_('[hop-up-tools] 棚が戻りました',
        '棚（Supabase）が返事をするようになりました。\n止まっていた時間: 約' + mins + '分（' + new Date(state.downSince).toLocaleString('ja-JP') + ' 〜）\n' +
        (state.lastRestartAt && state.lastRestartAt >= state.downSince ? '再起動を頼んだ時刻: ' + new Date(state.lastRestartAt).toLocaleString('ja-JP') + '\n' : '') +
        '問い合わせの時間: ' + probe.ms + 'ms');
      state.downSince = null;
      dbwatchWriteState_(props, state);
    }
    Logger.log('[DBWATCH] ok ' + probe.ms + 'ms');
    return;
  }

  // 2回とも返らない＝止まっている
  var firstTime = !state.downSince;
  if (firstTime) {
    state.downSince = now;
    dbwatchWriteState_(props, state);
  }

  // 段2: 管理用の窓口で健康状態を聞き、棚が不調なら再起動を頼む
  var action = dbwatchTryRestart_(props, state, now);
  if (action.restarted) {
    state.lastRestartAt = now;
    dbwatchWriteState_(props, state);
  }

  // 知らせる（止まった直後と、再起動を頼んだ時。10分ごとに毎回は送らない）
  if (firstTime || action.restarted) {
    dbwatchNotify_('[hop-up-tools] 棚が止まっています' + (action.restarted ? '（再起動を頼みました）' : ''),
      '棚（Supabase）が外からの問い合わせに返事をしません。サイトの /crossword・/youtube などが読み込めない状態です。\n' +
      '最初に気づいた時刻: ' + new Date(state.downSince).toLocaleString('ja-JP') + '\n' +
      '問い合わせの結果: ' + probe.detail + '\n' +
      '自動の立て直し: ' + action.detail + '\n' +
      (action.restarted ? '' : '手で直すなら: Supabase 管理画面 → 左下の歯車（Project Settings）→ General → Restart project\n'));
  }
  Logger.log('[DBWATCH] down: ' + probe.detail + ' / ' + action.detail);
}

/** 棚へ軽い問い合わせ（読むだけ。書かない）。ok と所要時間と失敗の中身を返す */
function dbwatchProbe_(supabaseUrl, supabaseKey) {
  var t0 = Date.now();
  try {
    var res = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/crossword_puzzles?select=id&limit=1', {
      headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey },
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var ms = Date.now() - t0;
    if (code === 200) return { ok: true, ms: ms, detail: '200 ' + ms + 'ms' };
    return { ok: false, ms: ms, detail: 'HTTP ' + code + ' ' + ms + 'ms ' + String(res.getContentText() || '').slice(0, 200) };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detail: '届かない: ' + String(e && e.message || e).slice(0, 200) };
  }
}

/**
 * 段2。再起動は次の全部がそろった時だけ:
 *  合言葉がある／管理用の窓口が 200 で答えた／棚（db）が healthy=false／立ち上げ中ではない／前の再起動から30分以上
 * それ以外は知らせるだけ。再起動を頼んだかどうかと理由を返す
 */
function dbwatchTryRestart_(props, state, now) {
  var token = props.getProperty('SUPABASE_ACCESS_TOKEN');
  if (!token) return { restarted: false, detail: 'しない（SUPABASE_ACCESS_TOKEN が無いので知らせるだけ）' };
  var ref = dbwatchProjectRef_(props.getProperty('SUPABASE_URL'));
  if (!ref) return { restarted: false, detail: 'しない（SUPABASE_URL から棚の番号が読めない）' };
  if (state.lastRestartAt && now - state.lastRestartAt < DBWATCH_RESTART_COOLDOWN_MS) {
    return { restarted: false, detail: 'しない（前の再起動から30分たっていない: ' + new Date(state.lastRestartAt).toLocaleString('ja-JP') + '）' };
  }

  // 健康状態を聞く
  var health;
  try {
    var hres = UrlFetchApp.fetch('https://api.supabase.com/v1/projects/' + ref + '/health?services=db,rest&timeout_ms=10000', {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true,
    });
    var hcode = hres.getResponseCode();
    if (hcode !== 200) return { restarted: false, detail: 'しない（健康状態の窓口が HTTP ' + hcode + ': ' + String(hres.getContentText() || '').slice(0, 200) + '）' };
    health = JSON.parse(hres.getContentText());
  } catch (e) {
    return { restarted: false, detail: 'しない（健康状態の窓口に届かない: ' + String(e && e.message || e).slice(0, 200) + '）' };
  }
  var db = null;
  for (var i = 0; i < health.length; i++) if (health[i].name === 'db') db = health[i];
  if (!db) return { restarted: false, detail: 'しない（健康状態の返事に db が無い: ' + JSON.stringify(health).slice(0, 200) + '）' };
  if (db.healthy) return { restarted: false, detail: 'しない（管理用の窓口では棚は healthy。つなぎ口だけの不調か、一時的な混雑）。状態: ' + db.status };
  var status = String(db.status || '').toUpperCase();
  if (status === 'COMING_UP' || status.indexOf('RESTOR') >= 0 || status.indexOf('UPGRAD') >= 0 || status.indexOf('PAUS') >= 0) {
    return { restarted: false, detail: 'しない（棚が ' + db.status + ' の最中）' };
  }

  // 再起動を頼む
  try {
    var rres = UrlFetchApp.fetch('https://api.supabase.com/v1/projects/' + ref + '/restart', {
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true,
    });
    var rcode = rres.getResponseCode();
    if (rcode === 200) return { restarted: true, detail: '再起動を頼んだ（棚の状態は ' + db.status + ' だった）。数分で戻る見込み' };
    return { restarted: false, detail: 'しない（再起動の窓口が HTTP ' + rcode + ': ' + String(rres.getContentText() || '').slice(0, 200) + '）' };
  } catch (e) {
    return { restarted: false, detail: 'しない（再起動の窓口に届かない: ' + String(e && e.message || e).slice(0, 200) + '）' };
  }
}

/** https://<ref>.supabase.co から <ref> を取り出す */
function dbwatchProjectRef_(supabaseUrl) {
  var m = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(String(supabaseUrl || ''));
  return m ? m[1] : null;
}

function dbwatchReadState_(props) {
  try {
    var s = JSON.parse(props.getProperty(DBWATCH_STATE_PROP) || '{}');
    return { downSince: s.downSince || null, lastRestartAt: s.lastRestartAt || null };
  } catch (e) {
    return { downSince: null, lastRestartAt: null };
  }
}

function dbwatchWriteState_(props, state) {
  props.setProperty(DBWATCH_STATE_PROP, JSON.stringify(state));
}

function dbwatchNotify_(subject, body) {
  var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL') || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({ to: to, subject: subject, body: body });
  Logger.log('[DBWATCH] mail → ' + to + ': ' + subject);
}

/** 10分ごとのトリガーを作る（GAS エディタから一度だけ実行。作ったら gas/archive/ へ移す） */
function DBWATCHsetupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'DBWATCHmain') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('DBWATCHmain').timeBased().everyMinutes(10).create();
  Logger.log('DBWATCHmain の10分ごとのトリガーを設定しました');
}
