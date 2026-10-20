/**
 * 一度きりの手動関数: 棚の Data API（PostgREST）が常に握っておく待機のつなぎ本数を変える。
 *
 * 役目: 無料の一番小さい箱はメモリがほぼ満杯で、2026-10-17・10-18 と2回、棚全体が固まった。
 *       PostgREST が10本の待機を常に握っていて1本ずつメモリを食うので、3本に減らして空きを作る。
 * 依存: スクリプトプロパティ SUPABASE_URL（棚の番号を読む）と SUPABASE_ACCESS_TOKEN（Data API Config の Read-write 権限つき）。
 * 使い方: DBWATCHshowPool で今の値を見る → DBWATCHsetPool3 で 3 にする → もう一度 DBWATCHshowPool で確かめる。
 *         きつければ DBWATCHsetPool5 で 5 に戻せる。
 * 2026-10-18 に 3 へ変えて役目が済んだので archive へ。dbwatchProjectRef_ は本編の db-watch.js にある。
 * 再利用: gas/ 直下へコピー → npm run gas:push -- --check → --confirm → 実行 → 使用後に消して --force-delete 付きで再push。
 */

function DBWATCHshowPool() {
  var r = dbwatchPoolRequest_('get', null);
  Logger.log('[DBWATCH pool] HTTP ' + r.code + ' ' + r.body);
}

function DBWATCHsetPool3() {
  dbwatchSetPool_(3);
}

function DBWATCHsetPool5() {
  dbwatchSetPool_(5);
}

function dbwatchSetPool_(n) {
  var before = dbwatchPoolRequest_('get', null);
  Logger.log('[DBWATCH pool] 変える前: HTTP ' + before.code + ' ' + before.body);
  var r = dbwatchPoolRequest_('patch', { db_pool: n });
  Logger.log('[DBWATCH pool] db_pool=' + n + ' を頼んだ: HTTP ' + r.code + ' ' + r.body);
  var after = dbwatchPoolRequest_('get', null);
  Logger.log('[DBWATCH pool] 変えた後: HTTP ' + after.code + ' ' + after.body);
}

function dbwatchPoolRequest_(method, payload) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('SUPABASE_ACCESS_TOKEN');
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN が無い');
  var ref = dbwatchProjectRef_(props.getProperty('SUPABASE_URL'));
  if (!ref) throw new Error('SUPABASE_URL から棚の番号が読めない');
  var opt = {
    method: method,
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true,
  };
  if (payload) {
    opt.contentType = 'application/json';
    opt.payload = JSON.stringify(payload);
  }
  var res = UrlFetchApp.fetch('https://api.supabase.com/v1/projects/' + ref + '/postgrest', opt);
  return { code: res.getResponseCode(), body: String(res.getContentText() || '').slice(0, 300) };
}
