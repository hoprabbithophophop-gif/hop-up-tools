/**
 * hop-up-tools YouTube スクレイパー
 *
 * 【トリガー設定】
 * - YTmain: 1日1回（新着動画取り込み）
 * - checkVideoAvailability: 週1回（直近6ヶ月の削除/非公開検出）
 * - checkVideoAvailabilityFull: 日次（全件巡回、500件ずつ）
 * - syncMembers: 週1回（メンバーの加入・卒業を検出。2026-08-05 復活）
 * - syncMemberColors: 月1回（メンバーカラーを控える。卒業すると公式サイトから消えて
 *   二度と取れなくなるので、在籍中に控えておく。変わったら履歴を残してから書き換える）
 *
 * 【スクリプトプロパティ（事前設定）】
 * YOUTUBE_API_KEY  : YouTube Data API v3 のAPIキー
 * SUPABASE_URL     : Supabase プロジェクトURL
 * SUPABASE_SERVICE_KEY : Supabase service_role キー
 *
 * グループ定義・タグ判定ロジックは hello-groups.js を参照。
 *
 * 【削除済み関数（必要になったらgit履歴から復元）】
 * retagVideos, updateDescriptions, backfillActiveContent,
 * backfillShorts(v1), backfillShortsV2, resolveChannelIds, showChannelIds
 *
 * 【保管庫へ移した関数（gas/archive/ にそのまま残してある）】
 * backfillDuration → archive/youtube-backfill-duration.js（2026-09-04。再生時間の穴埋めが済んだため）
 *
 * ※ syncMembers / parseMemberNames は 2026-04-30 に「不要関数」として削除されたが、
 *   実際には週1回動かし続ける必要があるものだった（消えて以降、名簿が更新されていない）。
 *   2026-08-05 に事故らない形へ直したうえで復活させた。
 */

// ===== チャンネル定義 =====
var CHANNELS = [
  // 判明済み
  { key: 'hello_station',    channelId: 'UCnoYhOtV0IXZ6lv2R-ZnB_Q', name: 'ハロ！ステ',           handle: '@helloprojectstation' },
  { key: 'upfront',          channelId: 'UCjXGuJZhvCwBSl7dwUJDJdg', name: 'アップフロントチャンネル', handle: '@upfrontchannel' },
  { key: 'morning_musume',   channelId: 'UCoKXb95K5h3sME3c9OCBaeA', name: 'モーニング娘。',         handle: '@morningmusume' },
  { key: 'tsubaki',          channelId: 'UCXTsCXNGHmePgo3a47hnsAA', name: 'つばきファクトリー',      handle: '@tsubakifactory' },
  { key: 'rosy',             channelId: 'UCaAqTsMF-VcHxaLpjDGOtcg', name: 'ロージークロニクル',     handle: '@rosychronicle' },

  // スクリプトプロパティから取得
  { key: 'angerme',          channelId: '', name: 'アンジュルム',       handle: '@angerme' },
  { key: 'juicejuice',       channelId: '', name: 'Juice=Juice',         handle: '@juicejuice' },
  { key: 'beyooooonds',      channelId: '', name: 'BEYOOOOONDS',         handle: '@beyooooonds' },
  { key: 'ochanorma',        channelId: '', name: 'OCHA NORMA',          handle: '@ochanorma' },
  { key: 'kenshusei',        channelId: 'UCrFu9o-a6yWxsWP0AtDVycw', name: 'ハロプロ研修生',      handle: '@HelloProKenshusei' },
  { key: 'omake',            channelId: '', name: 'OMAKE CHANNEL',       handle: '@omake' },
  { key: 'uf_fanclub',       channelId: '', name: 'UFfanclub',           handle: '@uffanclub' },
  { key: 'uf_goods',         channelId: '', name: 'UF Goods Land',       handle: '@ufgoodsland' },
  { key: 'mline_music',      channelId: '', name: 'M-line Music',        handle: '@mlinemusic' },
  { key: 'upcomi',           channelId: 'UCm7S9NqpjZcB3OQ1-2zAghA', name: 'アプカミ',           handle: '@upcomi' },

  // 外部公式チャンネル（ハロプロ出演動画のみ取り込み）
  { key: 'famitsu_game',     channelId: '', name: 'ファミ通ゲーム実況',  handle: '@famitsugamelive' },
  { key: 'first_take',       channelId: '', name: 'THE FIRST TAKE',      handle: '@The_FirstTake' },
  { key: 'yanmaga',          channelId: '', name: 'ヤンマガch',           handle: '@ヤンマガch' },
  { key: 'douhaji',          channelId: '', name: '動画はじめてみました', handle: '@douhaji' },
  { key: 'mementomori',      channelId: '', name: 'メメントモリ公式',     handle: '@mementomori_boi' },

  // ハロプロ関連公式チャンネル（グループ専用・ユニット・ムーブメント）
  { key: 'hapisugo',         channelId: '', name: 'happyに過ごそうよ',   handle: '@hapisugo' },
  { key: 'beyonobi',         channelId: '', name: 'ビヨーンズの伸びしろ', handle: '@beyonobi' },
  { key: 'satoyama',         channelId: '', name: 'SATOYAMA&SATOUMI',    handle: '@satoyamachannel' },
  { key: 'anison',           channelId: '', name: 'ハロー!アニソン部',    handle: '@ハローアニソン部' },
  { key: 'tinytiny',         channelId: '', name: 'tiny tiny',           handle: '@tinytinytiny' },

  // 活動終了グループの公式チャンネル
  { key: 'kobushi',          channelId: '', name: 'こぶしファクトリー',   handle: '@kobushifactory' },
  { key: 'berryz',           channelId: '', name: 'Berryz工房',          handle: '@berryzkobo' },
  { key: 'cute',             channelId: '', name: '℃-ute',               handle: '@cute' },
  { key: 'countrygirls',     channelId: '', name: 'カントリー・ガールズ', handle: '@countrygirlschannel' },
  { key: 'buono',            channelId: '', name: 'Buono!',              handle: '@buonochannel' },
  { key: 'kimitsuta',        channelId: '', name: 'ハロプロちょっと面白い話', handle: '@kimitsuta' },
];

// GROUP_PAGES / ACTIVE_GROUPS / CHANNEL_GROUP_MAP / GROUP_KEYWORDS は
// hello-groups.js で定義（GAS は同一スコープで実行されるため参照可）

// ===== 動画種別判定キーワード =====
var VIDEO_TYPE_KEYWORDS = {
  'variety': ['ハロ！ステ', 'ハロ!ステ', 'アプカミ', 'M-line Music', 'OMAKE', 'おまけ', 'MUSIC+', 'ダンスレッスン', 'レッスン'],
  'behind':  ['メイキング', 'Making', '密着', 'オフショット', '裏側', 'Behind'],
  'cover':   ['COVERS', 'カバー', '歌ってみた', 'カバーでしょ'],
  'dance':   ['Dance Shot', 'Dance Practice', 'Dance Ver', '踊ってみた', '振付動画'],
  'mv':      ['MV', 'Music Video', 'ミュージックビデオ', 'Promotion Edit', 'Promotion Video'],
  'live':    ['LIVE', 'ライブ', 'コンサート', 'Concert', 'CONCERT', 'ツアー'],
  'talk':    ['トーク', '対談', 'インタビュー', 'Q&A', '質問コーナー', 'フリートーク'],
};

// ===== メイン処理 =====
function YTmain() {
  var hourJST = (new Date().getUTCHours() + 9) % 24;
  var activeHours = [10, 12, 15, 17, 18, 19, 20, 21, 22];
  if (activeHours.indexOf(hourJST) === -1) return;

  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('YOUTUBE_API_KEY');
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');

  if (!apiKey || !supabaseUrl || !supabaseKey) {
    throw new Error('スクリプトプロパティが設定されていません。YOUTUBE_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_KEY を確認してください。');
  }

  CHANNELS.forEach(function(channel) {
    var channelId = channel.channelId || props.getProperty('CH_' + channel.key);
    if (!channelId) {
      Logger.log('[SKIP] ' + channel.name + ': チャンネルIDが未設定');
      return;
    }

    Logger.log('[START] ' + channel.name);
    try {
      var videos = fetchNewVideos(apiKey, channelId, channel.name, supabaseUrl, supabaseKey);
      if (videos.length > 0) {
        upsertToSupabase(supabaseUrl, supabaseKey, videos);
        Logger.log('[DONE] ' + channel.name + ': ' + videos.length + '件 upsert');
      } else {
        Logger.log('[SKIP] ' + channel.name + ': 新着なし');
      }
    } catch(e) {
      Logger.log('[ERROR] ' + channel.name + ': ' + e.message);
    }

    Utilities.sleep(500);
  });

  reactivateFormerUpcoming(apiKey, supabaseUrl, supabaseKey);
}

// ===== 動画取得（差分のみ） =====
function fetchNewVideos(apiKey, channelId, channelName, supabaseUrl, supabaseKey) {
  var chRes = UrlFetchApp.fetch(
    'https://www.googleapis.com/youtube/v3/channels?key=' + apiKey
    + '&id=' + channelId + '&part=contentDetails',
    { muteHttpExceptions: true }
  );
  var chJson = JSON.parse(chRes.getContentText());
  if (!chJson.items || chJson.items.length === 0) {
    throw new Error('チャンネル情報取得失敗: ' + channelId);
  }
  var playlistId = chJson.items[0].contentDetails.relatedPlaylists.uploads;
  var latestDate = getLatestPublishedAt(supabaseUrl, supabaseKey, channelId);

  var videos = [];
  var nextPageToken = '';
  var done = false;

  do {
    var url = 'https://www.googleapis.com/youtube/v3/playlistItems'
      + '?key=' + apiKey
      + '&playlistId=' + playlistId
      + '&part=snippet&maxResults=50'
      + (nextPageToken ? '&pageToken=' + nextPageToken : '');

    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('YouTube API エラー: ' + res.getContentText());
    }
    var json = JSON.parse(res.getContentText());

    json.items.forEach(function(item) {
      var snippet = item.snippet;
      var publishedAt = snippet.publishedAt;

      if (latestDate && new Date(publishedAt) <= new Date(latestDate)) {
        done = true;
        return;
      }

      var videoId = snippet.resourceId.videoId;
      var title = snippet.title || '';
      var description = snippet.description || '';
      var thumbnail = snippet.thumbnails && snippet.thumbnails.high
        ? snippet.thumbnails.high.url : '';

      var groupTags = detectGroups(channelId, title, description);
      if (!CHANNEL_GROUP_MAP[channelId] && groupTags.length === 0) return;

      videos.push({
        video_id:          videoId,
        channel_id:        channelId,
        channel_name:      channelName,
        title:             title,
        published_at:      publishedAt,
        thumbnail_url:     thumbnail,
        is_active_content: isActiveContent(groupTags),
        description_short: description,
        group_tags:        groupTags,
        video_type:        detectVideoType(title),
        is_short:          null,
      });
    });

    nextPageToken = json.nextPageToken;
  } while (nextPageToken && !done);

  // ショート判定: m.youtube.com/shorts/{id} に200が返ればショート
  videos.forEach(function(v) {
    try {
      var ytRes = UrlFetchApp.fetch('https://m.youtube.com/shorts/' + v.video_id, {
        muteHttpExceptions: true,
        followRedirects: false,
      });
      v.is_short = ytRes.getResponseCode() === 200;
    } catch (e) {
      v.is_short = false;
    }
    Utilities.sleep(500);
  });

  // 再生時間を取得
  if (videos.length > 0) {
    var durationMap = fetchDurations(apiKey, videos.map(function(v) { return v.video_id; }));
    videos.forEach(function(v) {
      if (durationMap[v.video_id] != null) {
        v.duration_seconds = durationMap[v.video_id];
      }
    });
  }

  // 配信予定（upcoming）の動画を非表示にする
  if (videos.length > 0) {
    var videoIds = videos.map(function(v) { return v.video_id; });
    var upcomingIds = getUpcomingVideoIds(apiKey, videoIds);
    if (upcomingIds.length > 0) {
      videos.forEach(function(v) {
        if (upcomingIds.indexOf(v.video_id) !== -1) {
          v.is_active_content = false;
          Logger.log('[UPCOMING] ' + v.title);
        }
      });
    }
  }

  return videos;
}

// ===== 配信予定（upcoming）動画の判定 =====
function getUpcomingVideoIds(apiKey, videoIds) {
  var upcomingIds = [];
  var chunkSize = 50;
  for (var i = 0; i < videoIds.length; i += chunkSize) {
    var chunk = videoIds.slice(i, i + chunkSize);
    var url = 'https://www.googleapis.com/youtube/v3/videos'
      + '?key=' + apiKey
      + '&id=' + chunk.join(',')
      + '&part=snippet&maxResults=50&fields=items(id,snippet/liveBroadcastContent)';
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) continue;
    var json = JSON.parse(res.getContentText());
    (json.items || []).forEach(function(item) {
      if (item.snippet && item.snippet.liveBroadcastContent === 'upcoming') {
        upcomingIds.push(item.id);
      }
    });
    Utilities.sleep(1000);
  }
  return upcomingIds;
}

// ===== 再生時間の取得 =====
function parseISO8601Duration(iso) {
  var m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

function fetchDurations(apiKey, videoIds) {
  var map = {};
  var chunkSize = 50;
  for (var i = 0; i < videoIds.length; i += chunkSize) {
    var chunk = videoIds.slice(i, i + chunkSize);
    var url = 'https://www.googleapis.com/youtube/v3/videos'
      + '?key=' + apiKey
      + '&id=' + chunk.join(',')
      + '&part=contentDetails&fields=items(id,contentDetails/duration)';
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) continue;
    var json = JSON.parse(res.getContentText());
    (json.items || []).forEach(function(item) {
      var seconds = parseISO8601Duration(item.contentDetails.duration);
      if (seconds != null) map[item.id] = seconds;
    });
    Utilities.sleep(500);
  }
  return map;
}

// ===== Supabaseから各チャンネルの最新公開日を取得 =====
function getLatestPublishedAt(supabaseUrl, supabaseKey, channelId) {
  var url = supabaseUrl + '/rest/v1/youtube_videos'
    + '?channel_id=eq.' + encodeURIComponent(channelId)
    + '&order=published_at.desc&limit=1&select=published_at';

  var res = UrlFetchApp.fetch(url, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': 'Bearer ' + supabaseKey,
    },
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) return null;
  var rows = JSON.parse(res.getContentText());
  return rows.length > 0 ? rows[0].published_at : null;
}

// ===== Supabaseへ upsert =====
function upsertToSupabase(supabaseUrl, supabaseKey, videos) {
  var chunkSize = 50;
  for (var i = 0; i < videos.length; i += chunkSize) {
    var chunk = videos.slice(i, i + chunkSize);
    var res = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/youtube_videos', {
      method: 'post',
      headers: {
        'apikey':          supabaseKey,
        'Authorization':   'Bearer ' + supabaseKey,
        'Content-Type':    'application/json',
        'Prefer':          'resolution=merge-duplicates',
      },
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true,
    });

    if (res.getResponseCode() >= 300) {
      throw new Error('Supabase upsert エラー: ' + res.getContentText());
    }
  }
}

// detectGroups() は hello-groups.js で定義
// isActiveContent() は hello-groups.js で定義

// ===== 削除/非公開動画の検出（直近6ヶ月） =====
function checkVideoAvailability() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('YOUTUBE_API_KEY');
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');

  var sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  var since = sixMonthsAgo.toISOString();

  var query = supabaseUrl + '/rest/v1/youtube_videos'
    + '?select=video_id&is_active_content=eq.true'
    + '&published_at=gte.' + encodeURIComponent(since)
    + '&order=video_id&limit=2000';
  var res = UrlFetchApp.fetch(query, {
    headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey },
    muteHttpExceptions: true,
  });
  var allIds = JSON.parse(res.getContentText()).map(function(r) { return r.video_id; });

  if (allIds.length === 0) {
    Logger.log('checkVideoAvailability: 対象なし');
    return;
  }
  Logger.log('checkVideoAvailability: 直近6ヶ月 ' + allIds.length + '件チェック');

  var deleteIds = checkStatusBatch_(apiKey, allIds);
  deleteBatch_(supabaseUrl, supabaseKey, deleteIds);

  Logger.log('checkVideoAvailability 完了 (' + deleteIds.length + '件削除)');
}

// ===== 削除/非公開動画の検出（全件巡回） =====
function checkVideoAvailabilityFull() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('YOUTUBE_API_KEY');
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');

  var PER_RUN = 500;
  var lastId = props.getProperty('CHECK_AVAIL_LAST_ID') || '';

  var query = supabaseUrl + '/rest/v1/youtube_videos'
    + '?select=video_id&is_active_content=eq.true&order=video_id&limit=' + PER_RUN;
  if (lastId) query += '&video_id=gt.' + lastId;
  var res = UrlFetchApp.fetch(query, {
    headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey },
    muteHttpExceptions: true,
  });
  var rows = JSON.parse(res.getContentText());
  var allIds = rows.map(function(r) { return r.video_id; });

  if (allIds.length === 0) {
    props.deleteProperty('CHECK_AVAIL_LAST_ID');
    Logger.log('checkVideoAvailabilityFull: 全件巡回完了 → リセット');
    return;
  }
  Logger.log('checkVideoAvailabilityFull: ' + allIds.length + '件処理' + (lastId ? ' (続き)' : ' (新規巡回開始)'));

  var deleteIds = checkStatusBatch_(apiKey, allIds);
  deleteBatch_(supabaseUrl, supabaseKey, deleteIds);

  if (rows.length < PER_RUN) {
    props.deleteProperty('CHECK_AVAIL_LAST_ID');
    Logger.log('checkVideoAvailabilityFull: 全件巡回完了 → リセット (' + deleteIds.length + '件削除)');
  } else {
    props.setProperty('CHECK_AVAIL_LAST_ID', allIds[allIds.length - 1]);
    Logger.log('checkVideoAvailabilityFull: 次回続行 (' + deleteIds.length + '件削除)');
  }
}

// ===== YouTube APIでステータス一括確認（内部共通） =====
function checkStatusBatch_(apiKey, videoIds) {
  var deleteIds = [];
  for (var i = 0; i < videoIds.length; i += 50) {
    var batch = videoIds.slice(i, i + 50);
    var ytRes = UrlFetchApp.fetch(
      'https://www.googleapis.com/youtube/v3/videos'
        + '?key=' + apiKey + '&id=' + batch.join(',')
        + '&part=status&maxResults=50&fields=items(id,status/privacyStatus)',
      { muteHttpExceptions: true }
    );
    var ytJson = JSON.parse(ytRes.getContentText());
    var itemMap = {};
    (ytJson.items || []).forEach(function(item) { itemMap[item.id] = item; });

    batch.forEach(function(id) {
      if (!itemMap[id]) {
        deleteIds.push(id);
        Logger.log('削除済み: ' + id);
      } else if (itemMap[id].status && itemMap[id].status.privacyStatus !== 'public') {
        deleteIds.push(id);
        Logger.log('非公開/限定: ' + id + ' (' + itemMap[id].status.privacyStatus + ')');
      }
    });
    Utilities.sleep(3000);
  }
  return deleteIds;
}

// ===== Supabaseから動画を一括削除（内部共通） =====
function deleteBatch_(supabaseUrl, supabaseKey, deleteIds) {
  if (deleteIds.length === 0) return;
  Logger.log(deleteIds.length + '件を削除');
  for (var k = 0; k < deleteIds.length; k += 100) {
    var chunk = deleteIds.slice(k, k + 100);
    UrlFetchApp.fetch(
      supabaseUrl + '/rest/v1/youtube_videos?video_id=in.(' + chunk.join(',') + ')',
      {
        method: 'delete',
        headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey, 'Prefer': 'return=minimal' },
        muteHttpExceptions: true,
      }
    );
  }
}

// ===== 配信予定→配信済みになった動画の復活 =====
function reactivateFormerUpcoming(apiKey, supabaseUrl, supabaseKey) {
  var inactiveIds = [];
  var offset = 0;
  while (true) {
    var res = UrlFetchApp.fetch(
      supabaseUrl + '/rest/v1/youtube_videos'
        + '?select=video_id'
        + '&is_active_content=eq.false'
        + '&group_tags=neq.%7B%7D'
        + '&order=video_id&limit=1000&offset=' + offset,
      { headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey }, muteHttpExceptions: true }
    );
    var rows = JSON.parse(res.getContentText());
    rows.forEach(function(r) { inactiveIds.push(r.video_id); });
    if (rows.length < 1000) break;
    offset += 1000;
  }
  if (inactiveIds.length === 0) return;
  Logger.log('reactivateFormerUpcoming: 候補 ' + inactiveIds.length + '件');

  var reactivateIds = [];
  for (var i = 0; i < inactiveIds.length; i += 50) {
    var batch = inactiveIds.slice(i, i + 50);
    var ytRes = UrlFetchApp.fetch(
      'https://www.googleapis.com/youtube/v3/videos'
        + '?key=' + apiKey + '&id=' + batch.join(',')
        + '&part=snippet,status&maxResults=50&fields=items(id,status/privacyStatus,snippet/liveBroadcastContent)',
      { muteHttpExceptions: true }
    );
    if (ytRes.getResponseCode() !== 200) continue;
    var ytJson = JSON.parse(ytRes.getContentText());
    (ytJson.items || []).forEach(function(item) {
      var isPublic = item.status && item.status.privacyStatus === 'public';
      var notUpcoming = item.snippet && item.snippet.liveBroadcastContent !== 'upcoming';
      if (isPublic && notUpcoming) {
        reactivateIds.push(item.id);
      }
    });
    Utilities.sleep(1000);
  }

  if (reactivateIds.length === 0) {
    Logger.log('reactivateFormerUpcoming: 復活対象なし');
    return;
  }
  Logger.log('reactivateFormerUpcoming: ' + reactivateIds.length + '件を復活');

  var chunkSize = 100;
  for (var j = 0; j < reactivateIds.length; j += chunkSize) {
    var chunk = reactivateIds.slice(j, j + chunkSize);
    UrlFetchApp.fetch(
      supabaseUrl + '/rest/v1/youtube_videos?video_id=in.(' + chunk.join(',') + ')',
      {
        method: 'patch',
        headers: {
          'apikey': supabaseKey,
          'Authorization': 'Bearer ' + supabaseKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        payload: JSON.stringify({ is_active_content: true }),
        muteHttpExceptions: true,
      }
    );
  }
}

// ===== 動画種別判定 =====
function detectVideoType(title) {
  var types = Object.keys(VIDEO_TYPE_KEYWORDS);
  for (var i = 0; i < types.length; i++) {
    var keywords = VIDEO_TYPE_KEYWORDS[types[i]];
    for (var j = 0; j < keywords.length; j++) {
      if (title.indexOf(keywords[j]) !== -1) {
        return types[i];
      }
    }
  }
  return 'other';
}

// ===== メンバー同期 =====
// helloproject.com の各グループページを巡回して hello_members を更新する。
// 週1回のトリガーで動かす。GROUP_PAGES は hello-groups.js にある。
//
// 【事故らないための決まり】2026-04-30 版は「まず全員を卒業にしてから、取れた人を復活」
// という順序だった。公式サイトが1ページでも落ちていると、そのグループ全員が卒業扱いに
// なってしまう。今の版は逆にしている。
//   1. 全ページが取れたときだけ先へ進む（1つでも落ちていたら何もせず終わる）
//   2. 取れた人を先に登録する
//   3. そのあと「今回いなかった人」だけを卒業にする
//   4. 一度に卒業する人数が多すぎるときは、書き換えずに知らせるだけにする
//
// 【0名のページについて】研修生北海道のように、ページは正常に出るがメンバーが
// 1人も載っていない状態が実在する。なので「0名」は異常扱いにしない。
// ページの作りが変わった場合は、全ページが0名になるので合計の下限で気づける。
var SYNC_MAX_GRADUATES = 5;   // 1回でこれ以上減ったら異常とみなす
var SYNC_MIN_TOTAL = 50;      // 合計がこれ未満なら、ページの作りが変わったとみなす

function syncMembers() {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');
  var now = new Date().toISOString();
  var headers = {
    'apikey': supabaseKey,
    'Authorization': 'Bearer ' + supabaseKey,
    'Content-Type': 'application/json',
  };

  // --- 1. 公式サイトから集める。1ページでも取れなければ中断 ---
  var scraped = [];
  var failed = [];
  GROUP_PAGES.forEach(function (gp) {
    var res = UrlFetchApp.fetch(gp.url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      failed.push(gp.url + ' (HTTP ' + res.getResponseCode() + ')');
      return;
    }
    var names = parseMemberNames(res.getContentText('UTF-8'));
    names.forEach(function (name) {
      scraped.push({ name: name, group_name: gp.group, active: true, synced_at: now });
    });
    Logger.log('[OK] ' + gp.group + ' (' + gp.url + '): ' + names.length + '名');
    Utilities.sleep(400);
  });

  if (failed.length > 0) {
    Logger.log('[中断] 取れなかったページがあるので、名簿には一切触っていない:\n  ' + failed.join('\n  '));
    return;
  }
  if (scraped.length < SYNC_MIN_TOTAL) {
    Logger.log('[中断] 合計 ' + scraped.length + '名しか取れていない（下限 ' + SYNC_MIN_TOTAL + '名）。'
      + 'ページの作りが変わった可能性があるので、名簿には一切触っていない。'
      + ' parseMemberNames を確認すること。');
    return;
  }

  // --- 2. 取れた人を登録（新規追加・在籍の更新）---
  var chunk = 50;
  for (var i = 0; i < scraped.length; i += chunk) {
    var up = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/hello_members', {
      method: 'post',
      headers: Object.assign({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }, headers),
      payload: JSON.stringify(scraped.slice(i, i + chunk)),
      muteHttpExceptions: true,
    });
    if (up.getResponseCode() >= 300) {
      Logger.log('[中断] 登録に失敗したので、卒業処理は行わない: ' + up.getContentText());
      return;
    }
  }

  // --- 3. 今回いなかった人を洗い出す ---
  var cur = UrlFetchApp.fetch(
    supabaseUrl + '/rest/v1/hello_members?active=eq.true&select=name',
    { headers: headers, muteHttpExceptions: true });
  if (cur.getResponseCode() !== 200) {
    Logger.log('[中断] 現在の名簿を読めなかったので、卒業処理は行わない');
    return;
  }
  var scrapedNames = {};
  scraped.forEach(function (m) { scrapedNames[m.name] = true; });
  var graduates = JSON.parse(cur.getContentText())
    .map(function (r) { return r.name; })
    .filter(function (n) { return !scrapedNames[n]; });

  if (graduates.length === 0) {
    Logger.log('syncMembers 完了: 在籍 ' + scraped.length + '名 / 卒業 なし');
    return;
  }

  // --- 4. 減りすぎているときは書き換えず、知らせるだけ ---
  if (graduates.length > SYNC_MAX_GRADUATES) {
    Logger.log('[要確認] 一度に ' + graduates.length + '名 減っている。'
      + 'ページの作りが変わった可能性があるので書き換えていない:\n  ' + graduates.join(', '));
    return;
  }

  var list = graduates.map(function (n) { return '"' + n + '"'; }).join(',');
  var pat = UrlFetchApp.fetch(
    supabaseUrl + '/rest/v1/hello_members?name=in.(' + encodeURIComponent(list) + ')',
    {
      method: 'patch',
      headers: Object.assign({ 'Prefer': 'return=minimal' }, headers),
      payload: JSON.stringify({ active: false, synced_at: now }),
      muteHttpExceptions: true,
    });
  Logger.log('syncMembers 完了: 在籍 ' + scraped.length + '名 / 卒業 '
    + graduates.length + '名 (' + graduates.join(', ') + ') 結果 '
    + pat.getResponseCode());
}

// helloproject.com の /profile/ リンクからメンバー名を取り出す
// 2026年4月のリニューアルでページの作りが変わった。
//   旧: <a href="/グループ/profile/名前/">日本語名</a>
//   新: <div class="MemberPanel__nameJa …">日本語名</div>
// 旧い形を探し続けていたため、リニューアル以降ずっと0名になっていた。
function parseMemberNames(html) {
  return parseMembers(html).map(function (m) { return m.name; });
}

// 名前と個人ページの場所をまとめて取り出す。
// <div class="MemberPanel"><a href="/グループ/ローマ字名/" class="MemberPanel__link …">
//   … <div class="MemberPanel__nameJa …">日本語名</div>
function parseMembers(html) {
  var out = [];
  var seen = {};
  var re = /<a\s+href="([^"]+)"\s+class="MemberPanel__link[\s\S]{0,1500}?MemberPanel__nameJa[^>]*>([^<]+)</gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var path = m[1];
    var name = m[2].replace(/\s+/g, '').trim();
    // 日本語を含む2〜12文字だけを名前とみなす
    if (
      name.length >= 2 && name.length <= 12 &&
      /[぀-ヿ一-鿿豈-﫿]/.test(name) &&
      !seen[name]
    ) {
      seen[name] = true;
      out.push({ name: name, path: path });
    }
  }
  return out;
}

// ===== メンバーカラーの取得 =====
// 個人ページの
//   <dd class="MemberHeader__color …" style="background-color: #A05EB5">ラベンダー</dd>
// から色コードと呼び方を取る。
//
// 【なぜ棚に控えるのか】卒業したメンバーの色は公式サイトから消え、どこにも一覧が無い。
// 現役のうちに控えておかないと二度と取れない。名簿の行は卒業しても消えないので色も残る。
//
// 【変わっていたら】履歴に1行残してから書き換える。順序は逆にしない。
// 【色が無いメンバー】ハロプロ研修生はデビュー前なので色が無いのが正常。
//   同じグループで続けて COLOR_SKIP_AFTER_MISSES 人ぶん色が無ければ、そのグループは打ち切る。
var COLOR_SKIP_AFTER_MISSES = 3;
var MEMBER_COLOR_RE = /MemberHeader__color[^>]*background-color:\s*(#[0-9a-fA-F]{6})[^>]*>\s*([^<]*)/i;

function syncMemberColors() {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');
  var headers = {
    'apikey': supabaseKey,
    'Authorization': 'Bearer ' + supabaseKey,
    'Content-Type': 'application/json',
  };

  // いま棚にある在籍メンバーと、控えてある色
  var cur = UrlFetchApp.fetch(
    supabaseUrl + '/rest/v1/hello_members?active=eq.true&select=name,group_name,color',
    { headers: headers, muteHttpExceptions: true });
  if (cur.getResponseCode() !== 200) {
    Logger.log('[中断] 名簿を読めなかった: ' + cur.getContentText());
    return;
  }
  var known = {};
  JSON.parse(cur.getContentText()).forEach(function (r) { known[r.name] = r; });

  var checked = 0, added = 0, changed = 0, missing = 0, skipped = [];

  GROUP_PAGES.forEach(function (gp) {
    var res = UrlFetchApp.fetch(gp.url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log('[SKIP] ' + gp.url + ': HTTP ' + res.getResponseCode());
      return;
    }
    var members = parseMembers(res.getContentText('UTF-8'));
    var miss = 0;

    for (var i = 0; i < members.length; i++) {
      var mem = members[i];
      if (!known[mem.name]) continue;                 // 棚にいない人は飛ばす

      var page = UrlFetchApp.fetch('https://www.helloproject.com' + mem.path,
        { muteHttpExceptions: true });
      Utilities.sleep(700);
      checked++;
      if (page.getResponseCode() !== 200) {
        Logger.log('[SKIP] ' + mem.path + ': HTTP ' + page.getResponseCode());
        continue;
      }

      var hit = MEMBER_COLOR_RE.exec(page.getContentText('UTF-8'));
      if (!hit) {
        missing++;
        miss++;
        if (miss >= COLOR_SKIP_AFTER_MISSES) {
          skipped.push(gp.group + '(' + miss + '人続けて色なし)');
          break;                                      // このグループは色を持たないとみなす
        }
        continue;
      }
      miss = 0;
      var color = hit[1].toLowerCase();
      var label = hit[2].replace(/\s+/g, '').trim();
      var before = known[mem.name].color;
      if (before && before.toLowerCase() === color) continue;   // 変わっていない

      // 1. 先に履歴を残す
      UrlFetchApp.fetch(supabaseUrl + '/rest/v1/member_color_history', {
        method: 'post',
        headers: Object.assign({ 'Prefer': 'return=minimal' }, headers),
        payload: JSON.stringify({
          member_name: mem.name,
          group_name: known[mem.name].group_name,
          color_before: before || null,
          color_after: color,
          source: 'https://www.helloproject.com' + mem.path + '(表記: ' + label + ')',
        }),
        muteHttpExceptions: true,
      });

      // 2. そのあと書き換える
      UrlFetchApp.fetch(
        supabaseUrl + '/rest/v1/hello_members?name=eq.' + encodeURIComponent(mem.name),
        {
          method: 'patch',
          headers: Object.assign({ 'Prefer': 'return=minimal' }, headers),
          payload: JSON.stringify({ color: color }),
          muteHttpExceptions: true,
        });

      if (before) {
        changed++;
        Logger.log('[変更] ' + mem.name + ': ' + before + ' -> ' + color + ' (' + label + ')');
      } else {
        added++;
        Logger.log('[新規] ' + mem.name + ': ' + color + ' (' + label + ')');
      }
    }
  });

  Logger.log('syncMemberColors 完了: 見た ' + checked + '人 / 新しく控えた ' + added
    + '人 / 変わっていた ' + changed + '人 / 色なし ' + missing + '人'
    + (skipped.length ? ' / 打ち切り: ' + skipped.join(', ') : ''));
}
