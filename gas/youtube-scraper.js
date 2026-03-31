/**
 * hop-up-tools YouTube スクレイパー
 *
 * 【初回セットアップ】
 * 1. resolveChannelIds() を手動実行 → スクリプトプロパティにチャンネルIDが保存される
 * 2. main() を手動実行して動作確認
 * 3. トリガー設定: main を1日1回（深夜など）
 *
 * 【スクリプトプロパティ（事前設定）】
 * YOUTUBE_API_KEY  : YouTube Data API v3 のAPIキー
 * SUPABASE_URL     : Supabase プロジェクトURL
 * SUPABASE_SERVICE_KEY : Supabase service_role キー
 */

// ===== チャンネル定義 =====
// channelId が空の場合は resolveChannelIds() で自動取得
var CHANNELS = [
  // 判明済み
  { key: 'hello_station',    channelId: 'UCnoYhOtV0IXZ6lv2R-ZnB_Q', name: 'ハロ！ステ',           handle: '@helloprojectstation' },
  { key: 'upfront',          channelId: 'UCjXGuJZhvCwBSl7dwUJDJdg', name: 'アップフロントチャンネル', handle: '@upfrontchannel' },
  { key: 'morning_musume',   channelId: 'UCoKXb95K5h3sME3c9OCBaeA', name: 'モーニング娘。',         handle: '@morningmusume' },
  { key: 'tsubaki',          channelId: 'UCXTsCXNGHmePgo3a47hnsAA', name: 'つばきファクトリー',      handle: '@tsubakifactory' },
  { key: 'rosy',             channelId: 'UCaAqTsMF-VcHxaLpjDGOtcg', name: 'ロージークロニクル',     handle: '@rosychronicle' },

  // resolveChannelIds() で取得
  { key: 'angerme',          channelId: '', name: 'アンジュルム',       handle: '@angerme' },
  { key: 'juicejuice',       channelId: '', name: 'Juice=Juice',         handle: '@juicejuice' },
  { key: 'beyooooonds',      channelId: '', name: 'BEYOOOOONDS',         handle: '@beyooooonds' },
  { key: 'ochanorma',        channelId: '', name: 'OCHA NORMA',          handle: '@ochanorma' },
  { key: 'kenshusei',        channelId: 'UCrFu9o-a6yWxsWP0AtDVycw', name: 'ハロプロ研修生',      handle: '@HelloProKenshusei' },
  { key: 'omake',            channelId: '', name: 'OMAKE CHANNEL',       handle: '@omake' },
  { key: 'uf_fanclub',       channelId: '', name: 'UFfanclub',           handle: '@uffanclub' },
  { key: 'uf_goods',         channelId: '', name: 'UF Goods Land',       handle: '@ufgoodsland' },
  { key: 'upcomi',           channelId: 'UCm7S9NqpjZcB3OQ1-2zAghA', name: 'アプカミ',           handle: '@upcomi' },
];

// ===== チャンネル → グループ 直接マッピング =====
// グループ専用チャンネルはタグを決め打ち（説明欄の誤マッチを防ぐ）
var CHANNEL_GROUP_MAP = {
  'UCoKXb95K5h3sME3c9OCBaeA': ['モーニング娘。'],
  'UCXTsCXNGHmePgo3a47hnsAA': ['つばきファクトリー'],
  'UCaAqTsMF-VcHxaLpjDGOtcg': ['ロージークロニクル'],
  'UCDwcZ85zjLKD-3-jqlv1wQQ': ['アンジュルム'],
  'UC6FadPgGviUcq6VQ0CEJqdQ': ['Juice=Juice'],
  'UCE5GP4BHm2EJx4xyxBVSLlg': ['BEYOOOOONDS'],
  'UCEbxO0RPlOQIVWrDaeepvuA': ['OCHA NORMA'],
  'UCrFu9o-a6yWxsWP0AtDVycw': ['ハロプロ研修生'],
  // ↓ 複数グループ混在チャンネル → タイトルキーワード判定
  // UCnoYhOtV0IXZ6lv2R-ZnB_Q: ハロ！ステ
  // UCjXGuJZhvCwBSl7dwUJDJdg: アップフロントチャンネル
  // UCFBY6EJFIwCQCl-DiYYNKlg: OMAKE CHANNEL
  // UC3oHasOAxRUwX0HpEhnWsQg: UFfanclub
  // UCNnIuuP67kGgWngvaPzSdOQ: UF Goods Land
};

// ===== グループタグ判定キーワード（タイトルのみ、説明欄は使わない） =====
var GROUP_KEYWORDS = {
  'モーニング娘。': ['モーニング娘', 'Morning Musume', 'モー娘'],
  'アンジュルム':   ['アンジュルム', 'ANGERME'],
  'Juice=Juice':   ['Juice=Juice', 'J=J'],
  'つばきファクトリー': ['つばきファクトリー', 'Tsubaki Factory'],
  'BEYOOOOONDS':   ['BEYOOOOONDS'],
  'OCHA NORMA':    ['OCHA NORMA'],
  'ロージークロニクル': ['ロージークロニクル', 'Rosy Chronicle'],
  'ハロプロ研修生': ['ハロプロ研修生', '研修生'],
};

// ===== 動画種別判定キーワード =====
var VIDEO_TYPE_KEYWORDS = {
  'mv':      ['MV', 'Music Video', 'ミュージックビデオ', 'Promotion Edit', 'Promotion Video'],
  'live':    ['LIVE', 'ライブ', 'コンサート', 'Concert', 'CONCERT', 'ツアー'],
  'variety': ['ハロ！ステ', 'ハロ!ステ', 'レッスン', 'ダンスレッスン', '密着', 'アプカミ', 'おまけ', 'OMAKE', 'M-line Music'],
};

// ===== メイン処理 =====
function main() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('YOUTUBE_API_KEY');
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');

  if (!apiKey || !supabaseUrl || !supabaseKey) {
    throw new Error('スクリプトプロパティが設定されていません。YOUTUBE_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_KEY を確認してください。');
  }

  CHANNELS.forEach(function(channel) {
    // スクリプトプロパティからチャンネルIDを補完
    var channelId = channel.channelId || props.getProperty('CH_' + channel.key);
    if (!channelId) {
      Logger.log('[SKIP] ' + channel.name + ': チャンネルIDが未設定。resolveChannelIds() を実行してください。');
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

    Utilities.sleep(500); // API quota 対策
  });
}

// ===== 動画取得（差分のみ） =====
function fetchNewVideos(apiKey, channelId, channelName, supabaseUrl, supabaseKey) {
  var playlistId = 'UU' + channelId.slice(2); // UC→UU でアップロード再生リストID
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

      // 取得済みの動画まで来たら終了フラグ
      if (latestDate && publishedAt <= latestDate) {
        done = true;
        return;
      }

      var videoId = snippet.resourceId.videoId;
      var title = snippet.title || '';
      var description = snippet.description || '';
      var thumbnail = snippet.thumbnails && snippet.thumbnails.high
        ? snippet.thumbnails.high.url : '';

      videos.push({
        video_id:          videoId,
        channel_id:        channelId,
        channel_name:      channelName,
        title:             title,
        published_at:      publishedAt,
        thumbnail_url:     thumbnail,
        description_short: description,
        group_tags:        detectGroups(channelId, title),
        video_type:        detectVideoType(title),
      });
    });

    nextPageToken = json.nextPageToken;
  } while (nextPageToken && !done);

  return videos;
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
  // 50件ずつに分割してupsert（Supabaseのペイロード上限対策）
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

// ===== グループタグ判定 =====
// グループ専用チャンネル → 直接マッピング
// 複数グループ混在チャンネル → タイトルのキーワードのみで判定（説明欄は使わない）
function detectGroups(channelId, title) {
  // 専用チャンネルは決め打ち
  if (CHANNEL_GROUP_MAP[channelId]) {
    return CHANNEL_GROUP_MAP[channelId];
  }

  // 混在チャンネルはタイトルのみ
  var tags = [];
  Object.keys(GROUP_KEYWORDS).forEach(function(group) {
    var keywords = GROUP_KEYWORDS[group];
    for (var i = 0; i < keywords.length; i++) {
      if (title.indexOf(keywords[i]) !== -1) {
        tags.push(group);
        break;
      }
    }
  });
  return tags;
}

// ===== 【既存データ修正用・初回のみ】全動画のグループタグを再計算して更新 =====
// 戦略:
//   専用チャンネル → channel_id 単位で一括PATCH（1チャンネル = 1リクエスト）
//   混在チャンネル → 同じgroup_tagsになる動画をまとめてvideo_id IN (...) で一括PATCH
function retagVideos() {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');

  // --- Phase 1: 専用チャンネルを channel_id 単位で一括更新 ---
  Logger.log('Phase 1: 専用チャンネル一括更新');
  Object.keys(CHANNEL_GROUP_MAP).forEach(function(channelId) {
    var tags = CHANNEL_GROUP_MAP[channelId];
    var patchUrl = supabaseUrl + '/rest/v1/youtube_videos?channel_id=eq.' + channelId;
    var res = UrlFetchApp.fetch(patchUrl, {
      method: 'patch',
      headers: {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      payload: JSON.stringify({ group_tags: tags }),
      muteHttpExceptions: true,
    });
    Logger.log('channel ' + channelId + ' → ' + JSON.stringify(tags) + ' (' + res.getResponseCode() + ')');
  });

  // --- Phase 2: 混在チャンネルをタグ組み合わせ単位で一括更新 ---
  Logger.log('Phase 2: 混在チャンネル更新');
  var mixedChannelIds = Object.keys(CHANNEL_GROUP_MAP);
  // 混在チャンネルのIDリスト（専用チャンネル以外）
  var mixedIds = CHANNELS
    .map(function(ch) { return ch.channelId || props.getProperty('CH_' + ch.key); })
    .filter(function(id) { return id && mixedChannelIds.indexOf(id) === -1; });

  mixedIds.forEach(function(channelId) {
    if (!channelId) return;

    // 全動画を取得（video_id + title のみ）
    var allRows = [];
    var offset = 0;
    while (true) {
      var url = supabaseUrl + '/rest/v1/youtube_videos'
        + '?channel_id=eq.' + channelId
        + '&select=video_id,title'
        + '&limit=1000&offset=' + offset;
      var res = UrlFetchApp.fetch(url, {
        headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey },
        muteHttpExceptions: true,
      });
      var rows = JSON.parse(res.getContentText());
      allRows = allRows.concat(rows);
      if (rows.length < 1000) break;
      offset += 1000;
    }

    // group_tags でグルーピング
    var tagGroups = {}; // JSON.stringify(tags) → [video_id, ...]
    allRows.forEach(function(row) {
      var tags = detectGroups(channelId, row.title);
      var key = JSON.stringify(tags);
      if (!tagGroups[key]) tagGroups[key] = [];
      tagGroups[key].push(row.video_id);
    });

    // 同じタグのグループをまとめて PATCH
    Object.keys(tagGroups).forEach(function(tagsKey) {
      var ids = tagGroups[tagsKey];
      var tags = JSON.parse(tagsKey);
      // Supabase: video_id=in.(id1,id2,...) — 500件ずつ
      var chunkSize = 100; // GAS URLFetch 上限 ~2048文字のため（11文字×100件 ≈ 1300文字）
      for (var i = 0; i < ids.length; i += chunkSize) {
        var chunk = ids.slice(i, i + chunkSize);
        var inClause = '(' + chunk.join(',') + ')';
        var patchUrl = supabaseUrl + '/rest/v1/youtube_videos?video_id=in.' + inClause;
        UrlFetchApp.fetch(patchUrl, {
          method: 'patch',
          headers: {
            'apikey': supabaseKey,
            'Authorization': 'Bearer ' + supabaseKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          payload: JSON.stringify({ group_tags: tags }),
          muteHttpExceptions: true,
        });
      }
      Logger.log('channel ' + channelId + ' tags=' + tagsKey + ' → ' + ids.length + '件更新');
    });
  });

  Logger.log('retagVideos 完了');
}

// ===== 【既存データ修正用】概要欄を全文に更新 =====
// 途中でタイムアウトしても再実行で続きから再開できる
// 完了後は自動的にチェックポイントをクリア
function updateDescriptions() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('YOUTUBE_API_KEY');
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');

  // チェックポイントから再開
  var startOffset = parseInt(props.getProperty('DESCRIBE_OFFSET') || '0', 10);
  Logger.log('開始オフセット: ' + startOffset);

  // Supabaseから全video_idを取得
  var allIds = [];
  var offset = 0;
  while (true) {
    var res = UrlFetchApp.fetch(
      supabaseUrl + '/rest/v1/youtube_videos?select=video_id&order=video_id&limit=1000&offset=' + offset,
      { headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey } }
    );
    var rows = JSON.parse(res.getContentText());
    rows.forEach(function(r) { allIds.push(r.video_id); });
    if (rows.length < 1000) break;
    offset += 1000;
  }
  Logger.log('総件数: ' + allIds.length + '件 / 残り: ' + (allIds.length - startOffset) + '件');

  var chunkSize = 50;
  var updated = startOffset;

  for (var i = startOffset; i < allIds.length; i += chunkSize) {
    var chunk = allIds.slice(i, i + chunkSize);

    // YouTube API で descriptions を一括取得
    var ytUrl = 'https://www.googleapis.com/youtube/v3/videos'
      + '?key=' + apiKey
      + '&id=' + chunk.join(',')
      + '&part=snippet&maxResults=50';
    var ytRes = UrlFetchApp.fetch(ytUrl, { muteHttpExceptions: true });
    var ytJson = JSON.parse(ytRes.getContentText());

    // 50件を fetchAll で並列 PATCH（video_idごとに個別更新）
    var patchRequests = ytJson.items.map(function(item) {
      return {
        url: supabaseUrl + '/rest/v1/youtube_videos?video_id=eq.' + item.id,
        method: 'patch',
        headers: {
          'apikey': supabaseKey,
          'Authorization': 'Bearer ' + supabaseKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        payload: JSON.stringify({ description_short: (item.snippet && item.snippet.description) || '' }),
        muteHttpExceptions: true,
      };
    });
    if (patchRequests.length > 0) UrlFetchApp.fetchAll(patchRequests);

    updated += chunk.length;
    props.setProperty('DESCRIBE_OFFSET', String(updated)); // チェックポイント保存
    Logger.log(updated + '/' + allIds.length + '件完了（quota: ' + Math.ceil(updated / 50) + '/' + Math.ceil(allIds.length / 50) + '）');
  }

  props.deleteProperty('DESCRIBE_OFFSET'); // 完了したらチェックポイントを削除
  Logger.log('updateDescriptions 完了');
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

// ===== 【初回のみ実行】チャンネルID一括解決 =====
// GASエディタで手動実行 → スクリプトプロパティに CH_{key} として保存される
function resolveChannelIds() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('YOUTUBE_API_KEY');
  var props = PropertiesService.getScriptProperties();

  CHANNELS.forEach(function(channel) {
    if (channel.channelId) {
      // 既知のIDはそのまま保存
      props.setProperty('CH_' + channel.key, channel.channelId);
      Logger.log('[KNOWN] ' + channel.name + ': ' + channel.channelId);
      return;
    }

    // ハンドルでAPI検索
    var handle = channel.handle.replace('@', '');
    var url = 'https://www.googleapis.com/youtube/v3/channels'
      + '?key=' + apiKey
      + '&forHandle=' + encodeURIComponent(channel.handle)
      + '&part=id,snippet&maxResults=1';

    try {
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      var json = JSON.parse(res.getContentText());

      if (json.items && json.items.length > 0) {
        var id = json.items[0].id;
        props.setProperty('CH_' + channel.key, id);
        Logger.log('[RESOLVED] ' + channel.name + ' (' + channel.handle + '): ' + id);
      } else {
        Logger.log('[NOT FOUND] ' + channel.name + ' (' + channel.handle + ') → ハンドルを確認してください');
      }
    } catch(e) {
      Logger.log('[ERROR] ' + channel.name + ': ' + e.message);
    }

    Utilities.sleep(200);
  });

  Logger.log('完了。スクリプトプロパティを確認してください。');
}

// ===== 【デバッグ用】チャンネルID一覧をログ出力 =====
function showChannelIds() {
  var props = PropertiesService.getScriptProperties();
  CHANNELS.forEach(function(channel) {
    var id = channel.channelId || props.getProperty('CH_' + channel.key) || '未設定';
    Logger.log(channel.name + ': ' + id);
  });
}
