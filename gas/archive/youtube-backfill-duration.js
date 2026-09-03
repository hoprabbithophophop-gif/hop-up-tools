/**
 * 【保管庫】既存動画の再生時間(duration_seconds)を一括で埋める関数（本番の Apps Script には送らない）
 *
 * 役目: duration_seconds が空の動画を500件ずつ YouTube API で調べて埋める。
 *       進み具合はスクリプトプロパティ BACKFILL_DURATION_OFFSET に控え、全件済むと自分で消す。
 * 移した日: 2026-09-04（埋め終わって役目を終えたため）
 *
 * 本編（gas/youtube-scraper.js）の次のものに依存する:
 *   fetchDurations
 *
 * もう一度使うとき:
 *   1. このファイルを gas/ 直下にコピーして npm run gas:push -- --check → --confirm
 *   2. Apps Script エディタで backfillDuration を「完了」とログに出るまで繰り返し実行
 *   3. 使い終わったら gas/ 直下のコピーを消して、もう一度 gas:push
 *      （本番にだけ残るファイルを消すので --confirm --force-delete が要る）
 */

// ===== 既存動画のduration一括取得（手動実行用） =====
function backfillDuration() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('YOUTUBE_API_KEY');
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');

  var offset = parseInt(props.getProperty('BACKFILL_DURATION_OFFSET') || '0');
  var batchSize = 500;

  var fetchUrl = supabaseUrl + '/rest/v1/youtube_videos'
    + '?duration_seconds=is.null&select=video_id&limit=' + batchSize + '&offset=' + offset;
  var res = UrlFetchApp.fetch(fetchUrl, {
    headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey }
  });
  var rows = JSON.parse(res.getContentText());
  if (rows.length === 0) {
    Logger.log('[BACKFILL] 完了（全件処理済み）');
    props.deleteProperty('BACKFILL_DURATION_OFFSET');
    return;
  }

  var videoIds = rows.map(function(r) { return r.video_id; });
  var durationMap = fetchDurations(apiKey, videoIds);

  var updates = [];
  Object.keys(durationMap).forEach(function(videoId) {
    updates.push({ video_id: videoId, duration_seconds: durationMap[videoId] });
  });

  if (updates.length > 0) {
    var chunkSize = 50;
    for (var i = 0; i < updates.length; i += chunkSize) {
      var chunk = updates.slice(i, i + chunkSize);
      var requests = chunk.map(function(u) {
        return {
          url: supabaseUrl + '/rest/v1/youtube_videos?video_id=eq.' + u.video_id,
          method: 'patch',
          headers: {
            apikey: supabaseKey,
            Authorization: 'Bearer ' + supabaseKey,
            'Content-Type': 'application/json',
          },
          payload: JSON.stringify({ duration_seconds: u.duration_seconds }),
          muteHttpExceptions: true,
        };
      });
      UrlFetchApp.fetchAll(requests);
      if (i + chunkSize < updates.length) Utilities.sleep(1000);
    }
  }

  Logger.log('[BACKFILL] ' + updates.length + '/' + rows.length + '件更新 (offset=' + offset + ')');
  props.setProperty('BACKFILL_DURATION_OFFSET', String(offset + batchSize));
}
