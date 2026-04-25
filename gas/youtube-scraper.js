/**
 * hop-up-tools YouTube スクレイパー
 *
 * 【初回セットアップ】
 * 1. resolveChannelIds() を手動実行 → スクリプトプロパティにチャンネルIDが保存される
 * 2. syncMembers() を手動実行 → hello_members テーブルを初期化
 * 3. main() を手動実行して動作確認
 * 4. トリガー設定: main を1日1回（深夜など）、syncMembers を週1回
 *
 * 【スクリプトプロパティ（事前設定）】
 * YOUTUBE_API_KEY  : YouTube Data API v3 のAPIキー
 * SUPABASE_URL     : Supabase プロジェクトURL
 * SUPABASE_SERVICE_KEY : Supabase service_role キー
 *
 * グループ定義・タグ判定ロジックは hello-groups.js を参照。
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

  // 配信予定→配信済みになった動画を復活
  reactivateFormerUpcoming(apiKey, supabaseUrl, supabaseKey);
}

// ===== 動画取得（差分のみ） =====
function fetchNewVideos(apiKey, channelId, channelName, supabaseUrl, supabaseKey) {
  // channels.list でアップロード再生リストIDを正式取得（UC→UU変換は一部チャンネルで404になるため）
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

      // 取得済みの動画まで来たら終了フラグ（Date変換で形式差異を吸収）
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
      // 専用チャンネル以外はグループタグなし動画をスキップ（DB汚染防止）
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
        is_short:          /#shorts/i.test(title) ? true : null,
      });
    });

    nextPageToken = json.nextPageToken;
  } while (nextPageToken && !done);

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
// videos.list で liveBroadcastContent を確認し、upcoming な動画IDを返す
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

// detectGroups() は hello-groups.js で定義

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
      payload: JSON.stringify({ group_tags: tags, is_active_content: isActiveContent(tags) }),
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

    // 全動画を取得（description_short も含める: detectGroups の URL打ち切りロジックに必要）
    var allRows = [];
    var offset = 0;
    while (true) {
      var url = supabaseUrl + '/rest/v1/youtube_videos'
        + '?channel_id=eq.' + channelId
        + '&select=video_id,title,description_short'
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
      var tags = detectGroups(channelId, row.title, row.description_short);
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
          payload: JSON.stringify({ group_tags: tags, is_active_content: isActiveContent(tags) }),
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

// isActiveContent() は hello-groups.js で定義

// ===== 【既存データ修正用】is_active_content を全動画に一括設定 =====
// 初回または ACTIVE_GROUPS を変更したときに実行
function backfillActiveContent() {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');

  // 全動画の video_id + group_tags を取得
  var allRows = [];
  var offset = 0;
  while (true) {
    var url = supabaseUrl + '/rest/v1/youtube_videos'
      + '?select=video_id,group_tags'
      + '&order=video_id&limit=1000&offset=' + offset;
    var res = UrlFetchApp.fetch(url, {
      headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey },
      muteHttpExceptions: true,
    });
    var rows = JSON.parse(res.getContentText());
    allRows = allRows.concat(rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  Logger.log('総件数: ' + allRows.length + '件');

  // active/inactive で分類
  var activeIds = [];
  var inactiveIds = [];
  allRows.forEach(function(row) {
    var tags = row.group_tags || [];
    var active = tags.some(function(t) { return ACTIVE_GROUPS.indexOf(t) !== -1; });
    if (active) activeIds.push(row.video_id);
    else inactiveIds.push(row.video_id);
  });
  Logger.log('active: ' + activeIds.length + '件 / inactive: ' + inactiveIds.length + '件');

  // 100件ずつ PATCH
  function patchChunks(ids, value) {
    var chunkSize = 100;
    for (var i = 0; i < ids.length; i += chunkSize) {
      var chunk = ids.slice(i, i + chunkSize);
      var patchUrl = supabaseUrl + '/rest/v1/youtube_videos?video_id=in.(' + chunk.join(',') + ')';
      UrlFetchApp.fetch(patchUrl, {
        method: 'patch',
        headers: {
          'apikey': supabaseKey,
          'Authorization': 'Bearer ' + supabaseKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        payload: JSON.stringify({ is_active_content: value }),
        muteHttpExceptions: true,
      });
      Logger.log((value ? 'active' : 'inactive') + ' PATCH: ' + (i + chunk.length) + '/' + ids.length);
    }
  }

  patchChunks(activeIds, true);
  patchChunks(inactiveIds, false);
  Logger.log('backfillActiveContent 完了');
}

// ===== 削除/非公開動画の検出（直近6ヶ月） =====
// 週1トリガー。直近6ヶ月の動画だけチェック（~700件）。1回で完走する。
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
// 日次トリガー。500件ずつチェックポイント巡回。約15日で全件1周。
// YouTube Data API利用規約の30日更新要件を満たす。
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
// is_active_content=false かつ group_tags が空でない動画を対象に、
// YouTube API で公開済み＆配信予定でないことを確認したら is_active_content=true に戻す
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

// ===== 【一回限り】ショート動画の一括判定 =====
// 2020年以降の is_short=NULL の動画を対象に、YouTube API の player パートで
// 縦長（embedHeight > embedWidth）ならショートと判定する。
// 500件ずつチェックポイント巡回。中断再開可能。
function backfillShorts() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('YOUTUBE_API_KEY');
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');

  var PER_RUN = 500;
  var lastId = props.getProperty('SHORTS_BACKFILL_LAST_ID') || '';

  var query = supabaseUrl + '/rest/v1/youtube_videos'
    + '?select=video_id'
    + '&is_short=is.null'
    + '&published_at=gte.2020-01-01T00:00:00Z'
    + '&order=video_id&limit=' + PER_RUN;
  if (lastId) query += '&video_id=gt.' + lastId;

  var res = UrlFetchApp.fetch(query, {
    headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey },
    muteHttpExceptions: true,
  });
  var rows = JSON.parse(res.getContentText());
  var allIds = rows.map(function(r) { return r.video_id; });

  if (allIds.length === 0) {
    props.deleteProperty('SHORTS_BACKFILL_LAST_ID');
    Logger.log('backfillShorts: 対象なし（完了）');
    return;
  }
  Logger.log('backfillShorts: ' + allIds.length + '件処理' + (lastId ? ' (続き)' : ' (開始)'));

  var shortIds = [];
  var regularIds = [];

  for (var i = 0; i < allIds.length; i += 50) {
    var batch = allIds.slice(i, i + 50);
    var ytRes = UrlFetchApp.fetch(
      'https://www.googleapis.com/youtube/v3/videos'
        + '?key=' + apiKey + '&id=' + batch.join(',')
        + '&part=player&maxResults=50&fields=items(id,player/embedWidth,player/embedHeight)',
      { muteHttpExceptions: true }
    );
    var ytJson = JSON.parse(ytRes.getContentText());
    var itemMap = {};
    (ytJson.items || []).forEach(function(item) { itemMap[item.id] = item; });

    batch.forEach(function(id) {
      var item = itemMap[id];
      if (!item || !item.player) {
        regularIds.push(id);
        return;
      }
      var w = parseInt(item.player.embedWidth || '0', 10);
      var h = parseInt(item.player.embedHeight || '0', 10);
      if (h > w && w > 0) {
        shortIds.push(id);
      } else {
        regularIds.push(id);
      }
    });
    Utilities.sleep(1000);
  }

  if (shortIds.length > 0) {
    for (var j = 0; j < shortIds.length; j += 100) {
      var chunk = shortIds.slice(j, j + 100);
      UrlFetchApp.fetch(
        supabaseUrl + '/rest/v1/youtube_videos?video_id=in.(' + chunk.join(',') + ')',
        {
          method: 'patch',
          headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          payload: JSON.stringify({ is_short: true }),
          muteHttpExceptions: true,
        }
      );
    }
  }
  if (regularIds.length > 0) {
    for (var k = 0; k < regularIds.length; k += 100) {
      var chunk2 = regularIds.slice(k, k + 100);
      UrlFetchApp.fetch(
        supabaseUrl + '/rest/v1/youtube_videos?video_id=in.(' + chunk2.join(',') + ')',
        {
          method: 'patch',
          headers: { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          payload: JSON.stringify({ is_short: false }),
          muteHttpExceptions: true,
        }
      );
    }
  }

  Logger.log('backfillShorts: short=' + shortIds.length + ' regular=' + regularIds.length);

  if (rows.length < PER_RUN) {
    props.deleteProperty('SHORTS_BACKFILL_LAST_ID');
    Logger.log('backfillShorts: 全件完了');
  } else {
    props.setProperty('SHORTS_BACKFILL_LAST_ID', allIds[allIds.length - 1]);
    Logger.log('backfillShorts: 次回続行');
  }
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

    Utilities.sleep(1000);
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

// ===== メンバー同期 =====
// helloproject.com の各グループページをクロールして hello_members テーブルを更新
// 卒業・新規加入を自動検出。週1回トリガー推奨。
function syncMembers() {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');
  var now = new Date().toISOString();

  // Step 1: 公式サイトから全メンバーをスクレイプ
  var allMembers = [];
  GROUP_PAGES.forEach(function(gp) {
    var res = UrlFetchApp.fetch(gp.url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log('[ERROR] ' + gp.group + ': HTTP ' + res.getResponseCode());
      return;
    }
    var names = parseMemberNames(res.getContentText('UTF-8'));
    names.forEach(function(name) {
      allMembers.push({ name: name, group_name: gp.group, active: true, synced_at: now });
    });
    Logger.log('[OK] ' + gp.group + ': ' + names.join(', '));
    Utilities.sleep(400);
  });

  // 取得件数が少なすぎる場合はHTMLパターンが変わった可能性があるので中断
  if (allMembers.length < 10) {
    Logger.log('[ABORT] 取得メンバー数が少なすぎます（' + allMembers.length + '名）。parseMemberNames を確認してください。');
    return;
  }
  Logger.log('取得合計: ' + allMembers.length + '名');

  // Step 2: 現在DBにいる全メンバーをactive:falseに（卒業処理）
  UrlFetchApp.fetch(supabaseUrl + '/rest/v1/hello_members?active=eq.true', {
    method: 'patch',
    headers: {
      'apikey': supabaseKey,
      'Authorization': 'Bearer ' + supabaseKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    payload: JSON.stringify({ active: false }),
    muteHttpExceptions: true,
  });

  // Step 3: スクレイプ結果をupsert（active:trueで復活・新規追加）
  var chunkSize = 50;
  for (var i = 0; i < allMembers.length; i += chunkSize) {
    UrlFetchApp.fetch(supabaseUrl + '/rest/v1/hello_members', {
      method: 'post',
      headers: {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      payload: JSON.stringify(allMembers.slice(i, i + chunkSize)),
      muteHttpExceptions: true,
    });
  }

  Logger.log('syncMembers 完了');
}

// helloproject.com の /profile/ リンクからメンバー名を抽出
function parseMemberNames(html) {
  var names = [];
  var seen = {};
  // /groupname/profile/slug/ パターンのリンクテキストを抽出
  var re = /href="\/[^"\/]+\/profile\/[^"\/]+\/"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    // 内部タグを除去
    var text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
    // 日本語文字（漢字・ひらがな・カタカナ）を含む2〜12文字
    if (
      text.length >= 2 && text.length <= 12 &&
      /[\u3040-\u30ff\u4e00-\u9fff\uf900-\ufaff]/.test(text) &&
      !seen[text]
    ) {
      seen[text] = true;
      names.push(text);
    }
  }
  return names;
}
