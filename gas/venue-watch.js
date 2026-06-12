/**
 * 会場見張り（VENUEmain・日次トリガー想定）
 *
 * 未来の公演の会場が座標辞書(schedule_venues)に無い場合の自浄ループ:
 *  1. 厳格ルールで自動ジオコーディング → 通れば辞書に自動追加（翌日のfc-ics-regenで全購読に反映）
 *  2. 通らない会場だけオーナーにメール（地図検索リンク＋座標を貼るだけのSQL付き）
 *  同じ会場の通知は1回だけ（スクリプトプロパティで通知済みを記録）。
 *
 * セットアップ: GASエディタで VENUEsetupTrigger() を一度実行（毎日朝9時に VENUEmain が回る）
 *
 * 自動採用の厳格ルール（手作業ジオコーディング時の事故から導出）:
 *  - 都道府県が一致（「（東京）」と返ってきた住所の都道府県を照合）
 *  - 施設名が会場名を内包 or 会場名が施設名を内包（部分かすりは不採用。
 *    例:「伊勢崎市文化会館」→「創価学会伊勢崎文化会館」は相互に内包しないので弾く）
 *  - 通らなければ「座標なし」のまま＝間違いピンは絶対に配らない
 */

const VENUE_GEOCODER_UA = 'hop-up-tools-geocoder/1.0 (https://hop-up-tools.pages.dev)';
const VENUE_PREF_FULL = { '東京': '東京都', '大阪': '大阪府', '京都': '京都府' };
const VENUE_NOTIFIED_PROP = 'VENUE_WATCH_NOTIFIED';

/** エントリポイント（日次トリガー） */
function VENUEmain() {
  const props = PropertiesService.getScriptProperties();
  const supabaseUrl = props.getProperty('SUPABASE_URL');
  const supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY 未設定');

  const sbHeaders = { 'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey };

  // 未来の公演の会場テキスト一覧
  const dlRes = UrlFetchApp.fetch(
    supabaseUrl + '/rest/v1/fc_deadlines?select=location&type=eq.event&location=not.is.null&deadline_at=gte.' +
      encodeURIComponent(new Date().toISOString()),
    { headers: sbHeaders, muteHttpExceptions: true }
  );
  if (dlRes.getResponseCode() !== 200) throw new Error('fc_deadlines取得失敗: ' + dlRes.getContentText());
  const locations = JSON.parse(dlRes.getContentText()).map(function (r) { return r.location; });

  // 会場辞書（座標の有無も見る）
  const vRes = UrlFetchApp.fetch(
    supabaseUrl + '/rest/v1/schedule_venues?select=name,prefecture,latitude,longitude',
    { headers: sbHeaders, muteHttpExceptions: true }
  );
  if (vRes.getResponseCode() !== 200) throw new Error('schedule_venues取得失敗: ' + vRes.getContentText());
  const venues = JSON.parse(vRes.getContentText());

  // 解決できない会場（名前一致なし or 一致したが座標なし）を洗い出す
  const unresolved = {}; // name → { name, pref }
  for (const loc of locations) {
    const m = String(loc).match(/^(.*?)\s*[（(]([^）)]*)[）)]\s*$/);
    const name = (m ? m[1] : loc).trim();
    const paren = m ? m[2] : '';
    if (name === 'オンライン') continue;
    const hit = venues.find(function (v) { return normalizeVenueChars(v.name) === normalizeVenueChars(name); });
    if (hit && hit.latitude != null) continue; // 座標あり＝OK
    // 並び替え誤字も入口正規化済みのはずだが、念のためここでも同一視
    const bagHit = venues.find(function (v) {
      return v.latitude != null && v.prefecture && paren.indexOf(v.prefecture) >= 0 && venueCharBag(v.name) === venueCharBag(name);
    });
    if (bagHit) continue;
    unresolved[name] = { name: name, pref: paren.replace(/^(東京都|北海道|(.{2,3}?)[都道府県]).*$/, '$1').replace(/[都府県]$/, '') || paren };
  }

  const names = Object.keys(unresolved);
  Logger.log('未解決会場: ' + (names.length ? names.join(' / ') : 'なし'));
  if (names.length === 0) return;

  // 厳格ルールで自動ジオコーディング
  const autoAdded = [];
  const failed = [];
  for (const name of names) {
    const pref = unresolved[name].pref;
    const hit = strictGeocode(name, pref);
    if (hit) {
      const ins = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/schedule_venues?on_conflict=name', {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'apikey': supabaseKey,
          'Authorization': 'Bearer ' + supabaseKey,
          'Prefer': 'resolution=merge-duplicates',
        },
        payload: JSON.stringify([{ name: name, prefecture: pref, latitude: hit.lat, longitude: hit.lon, is_online: false }]),
        muteHttpExceptions: true,
      });
      if (ins.getResponseCode() < 300) {
        autoAdded.push({ name: name, hit: hit });
        Logger.log('自動追加: ' + name + ' → ' + hit.lat + ',' + hit.lon + ' (' + hit.label + ')');
        continue;
      }
      Logger.log('自動追加の保存に失敗: ' + name + ' ' + ins.getContentText());
    }
    failed.push(unresolved[name]);
  }

  // 通知（同じ会場は1回だけ）
  const notified = JSON.parse(props.getProperty(VENUE_NOTIFIED_PROP) || '[]');
  const newFailed = failed.filter(function (f) { return notified.indexOf(f.name) < 0; });
  const newAuto = autoAdded.filter(function (a) { return notified.indexOf('auto:' + a.name) < 0; });
  if (newFailed.length === 0 && newAuto.length === 0) return;

  let body = 'FC締切リマインダーの会場見張りからのお知らせです。\n\n';
  if (newAuto.length > 0) {
    body += '■ 座標を自動追加した会場（地図リンクで合っているか確認推奨）\n';
    for (const a of newAuto) {
      body += '・' + a.name + '（' + a.hit.label + '）\n  確認: https://www.google.com/maps/search/?api=1&query=' + a.hit.lat + ',' + a.hit.lon + '\n';
      notified.push('auto:' + a.name);
    }
    body += '\n';
  }
  if (newFailed.length > 0) {
    body += '■ 座標を自動で取れなかった会場（3分で直せます）\n';
    body += '手順: ①下の地図リンクで会場を探す ②地図上で会場を右クリック→座標をコピー\n';
    body += '③下のSQLの LAT, LON を貼り替えて Supabase の SQL Editor で実行\n';
    body += '（それまでの間も、ユーザーの予定メモには地図検索リンクが入るので当日は困りません）\n\n';
    for (const f of newFailed) {
      body += '・' + f.name + '（' + f.pref + '）\n';
      body += '  地図で探す: https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(f.name + ' ' + f.pref) + '\n';
      body += "  insert into schedule_venues (name, prefecture, latitude, longitude, is_online) values ('" +
        f.name.replace(/'/g, "''") + "','" + f.pref + "', LAT, LON, false) on conflict (name) do update set latitude=excluded.latitude, longitude=excluded.longitude, updated_at=now();\n\n";
      notified.push(f.name);
    }
  }
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '【FC締切リマインダー】新しい会場の座標について', body);
  props.setProperty(VENUE_NOTIFIED_PROP, JSON.stringify(notified));
}

/** 厳格ルールのジオコーディング（Nominatim・1.1秒間隔） */
function strictGeocode(name, pref) {
  const queries = [name, name + ' ' + pref];
  for (const q of queries) {
    const res = UrlFetchApp.fetch(
      'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=jp&accept-language=ja&q=' + encodeURIComponent(q),
      { headers: { 'User-Agent': VENUE_GEOCODER_UA }, muteHttpExceptions: true }
    );
    Utilities.sleep(1100);
    if (res.getResponseCode() !== 200) {
      // 注: GASはUser-Agentを自由に名乗れないため、Nominatim側に弾かれる可能性あり（要観察）
      Logger.log('geocode HTTP ' + res.getResponseCode() + ': ' + q + ' / ' + res.getContentText().slice(0, 120));
      continue;
    }
    const list = JSON.parse(res.getContentText());
    if (list.length === 0) { Logger.log('geocode ヒットなし: ' + q); continue; }
    for (const r of list) {
      if (String(r.display_name).indexOf(VENUE_PREF_FULL[pref] || pref) < 0) continue; // 都道府県不一致
      const resultName = normalizeVenueChars(String(r.name || String(r.display_name).split(',')[0]));
      const queryName = normalizeVenueChars(name);
      if (resultName.length < 4) continue;
      const contains = resultName.indexOf(queryName) >= 0; // 施設名が会場名を内包（例: チームスマイル・豊洲PIT ⊇ 豊洲PIT）
      const contained = queryName.indexOf(resultName) >= 0 && resultName.length >= queryName.length * 0.6; // 会場名がホール名付きの場合（例: タワーホール船堀 ⊆ …大ホール）
      if (!contains && !contained) { Logger.log('geocode 名前不一致で見送り: ' + q + ' → ' + r.name); continue; }
      return { lat: Number(r.lat), lon: Number(r.lon), label: String(r.display_name).split(',').slice(0, 3).join(',') };
    }
  }
  return null;
}

/** 日次トリガーを作る（GASエディタから一度だけ実行） */
function VENUEsetupTrigger() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'VENUEmain') ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('VENUEmain').timeBased().everyDays(1).atHour(9).create();
  Logger.log('VENUEmain の日次トリガー（毎朝9時台）を設定しました');
}
