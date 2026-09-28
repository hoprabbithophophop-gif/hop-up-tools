/**
 * 会場見張り（VENUEmain・日次トリガー想定）
 *
 * 未来の公演の会場が座標辞書(schedule_venues)に無い場合の自浄ループ:
 *  1. 厳格ルールで自動ジオコーディング → 通れば辞書に自動追加（翌日のfc-ics-regenで全購読に反映）
 *  2. 通らない会場だけオーナーにメール（地図検索リンク＋座標を貼るだけのSQL付き）
 *  同じ会場の通知は1回だけ（スクリプトプロパティで通知済みを記録）。
 *
 * トリガー: VENUEmain の日次トリガー（毎朝9時台）は設定済み。作り直すときは
 *   Apps Script の「トリガー」画面から手で作るか、gas/archive/venue-setup-trigger.js を使う。
 *
 * 【保管庫へ移した関数（gas/archive/venue-setup-trigger.js にそのまま残してある）】
 * VENUEsetupTrigger（2026-09-04。トリガー作成が済み、二度目は要らないため）
 *
 * 座標の探し方（strictGeocode）: 会場の公式サイトの住所 → 国土地理院の住所検索。出なければ Supabase の geocode-venue（Wikidata を会場名で）。
 *
 * 自動採用の厳格ルール（手作業ジオコーディング時の事故から導出）:
 *  - 都道府県が一致（「（東京）」と返ってきた住所の都道府県を照合）
 *  - 施設名が会場名を内包 or 会場名が施設名を内包（部分かすりは不採用。
 *    例:「伊勢崎市文化会館」→「創価学会伊勢崎文化会館」は相互に内包しないので弾く）
 *  - 通らなければ「座標なし」のまま＝間違いピンは絶対に配らない
 */

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
    supabaseUrl + '/rest/v1/schedule_venues?select=name,prefecture,latitude,longitude,official_url',
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
    // 公式サイトの URL（辞書の同じ会場から。ファンクラブ側の表記が少し違う「Zepp Namba」と「Zepp Namba(OSAKA)」のような
    // 前方一致も、都道府県が同じなら同じ会場とみなす）。住所から座標を出すのに使う
    const urlHit = (hit && hit.official_url) ? hit : venues.find(function (v) {
      if (!v.official_url || !v.prefecture || paren.indexOf(v.prefecture) < 0) return false;
      const a = normalizeVenueChars(v.name), b = normalizeVenueChars(name);
      return a.indexOf(b) === 0 || b.indexOf(a) === 0;
    });
    unresolved[name] = {
      name: name,
      pref: paren.replace(/^(東京都|北海道|(.{2,3}?)[都道府県]).*$/, '$1').replace(/[都府県]$/, '') || paren,
      url: urlHit ? urlHit.official_url : null,
    };
  }

  const names = Object.keys(unresolved);
  Logger.log('未解決会場: ' + (names.length ? names.join(' / ') : 'なし'));
  if (names.length === 0) return;

  // 厳格ルールで自動ジオコーディング
  const autoAdded = [];
  const failed = [];
  for (const name of names) {
    const pref = unresolved[name].pref;
    const hit = strictGeocode(name, pref, unresolved[name].url);
    if (hit) {
      const ins = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/schedule_venues?on_conflict=name', {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'apikey': supabaseKey,
          'Authorization': 'Bearer ' + supabaseKey,
          'Prefer': 'resolution=merge-duplicates',
        },
        payload: JSON.stringify([Object.assign(
          { name: name, prefecture: pref, latitude: hit.lat, longitude: hit.lon, is_online: false },
          hit.address ? { address: hit.address } : {},
          unresolved[name].url ? { official_url: unresolved[name].url } : {}
        )]),
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

/**
 * 厳格ルールのジオコーディング。見つからなければ null（＝座標なしのまま。間違ったピンは配らない）。
 *  1. 会場の公式サイト（schedule_venues.official_url）から「〒」の住所を読み取り、国土地理院の住所検索で位置を出す。
 *     返ってきた住所の都道府県が公演の都道府県と同じ時だけ採用（住所なら番地まで正確に出る）
 *  2. 出なければ Supabase の geocode-venue（Wikidata を会場名で探す）に聞く
 * 以前は Nominatim を使っていたが、日本の会場名に弱く（2026-09-28 実測で未解決10会場中0件）、
 * 定期実行の利用方針（1分4件まで）にも合っていなかったのでやめた。
 * hp-schedule-scraper.js からも呼ばれる（同一 GAS プロジェクト内で共有）。
 */
function strictGeocode(name, pref, officialUrl) {
  if (officialUrl) {
    const byAddress = addressGeocode(officialUrl, pref);
    if (byAddress) return byAddress;
  }
  return nameGeocode(name, pref);
}

/** 「東京」「東京都」→「東京都」のような正式な都道府県名。分からなければ空文字 */
function venuePrefFull(pref) {
  const p = String(pref || '').trim();
  if (p === '北海道' || /[都府県]$/.test(p)) return p;
  if (p === '東京') return '東京都';
  if (p === '大阪' || p === '京都') return p + '府';
  return p ? p + '県' : '';
}

/** 公式サイトのページを文字で取る（Shift_JIS 等のページも読めるように） */
function venueFetchText(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) return '';
  const head = res.getBlob().getDataAsString('ISO-8859-1').slice(0, 3000);
  const m = head.match(/charset=["']?(shift_jis|sjis|x-sjis|euc-jp)/i);
  return m ? res.getContentText(/euc/i.test(m[1]) ? 'EUC-JP' : 'Shift_JIS') : res.getContentText();
}

/** ページの中から「〒」で始まる住所を1つ取り出す（電話番号などの後ろは切る） */
function venueExtractAddress(html) {
  const text = String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[\s　]+/g, ' ');
  const m = text.match(/〒\s?\d{3}\s?[-‐ー－]\s?\d{4}\s*(.{4,80})/);
  if (!m) return '';
  // 「青海 1-1-10」のように町名と番地の間に空白が入るサイトがあるので、数字の前の空白は詰める
  const rest = m[1].replace(/([^\s])\s+(?=[0-9０-９])/g, '$1').split(/\s?(TEL|Tel|tel|電話|代表|FAX|Fax|ＴＥＬ|MAP|地図|アクセス|※)/)[0].trim();
  // 「…9番16号 日本消防会館2階 お問い合わせ…」のように後ろにメニューの文字が続くことがあるので、号・番地で切る
  const cut = rest.match(/^.*?[0-9０-９](号|番地)/);
  return cut ? cut[0] : rest.split(' ')[0];
}

function addressGeocode(officialUrl, pref) {
  const prefFull = venuePrefFull(pref);
  if (!prefFull) return null;
  let html = venueFetchText(officialUrl);
  let address = venueExtractAddress(html);
  if (!address && html) {
    // トップに住所が無ければ、同じサイトの「アクセス」のページを1つだけ見る
    const host = String(officialUrl).match(/^https?:\/\/[^/]+/);
    const links = String(html).match(/href=["'][^"']*(access|アクセス|map|about)[^"']*["']/gi) || [];
    for (const l of links) {
      let href = l.replace(/^href=["']|["']$/g, '');
      if (/^\//.test(href) && host) href = host[0] + href;
      else if (!/^https?:/.test(href)) href = String(officialUrl).replace(/[^/]*$/, '') + href;
      if (host && href.indexOf(host[0]) !== 0) continue; // よそのサイトへは行かない
      address = venueExtractAddress(venueFetchText(href));
      if (address) break;
    }
  }
  if (!address) { Logger.log('住所が見つからず: ' + officialUrl); return null; }

  // 国土地理院の住所検索（公式に公開された API ではない。止まっていれば「見つからず」に倒れるだけ）
  const res = UrlFetchApp.fetch(
    'https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(address),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) { Logger.log('住所検索 HTTP ' + res.getResponseCode() + ': ' + address); return null; }
  const list = JSON.parse(res.getContentText()) || [];
  for (const r of list) {
    const title = String((r.properties || {}).title || '');
    if (title.indexOf(prefFull) !== 0) continue; // 都道府県が違う（別の同名の住所）なら使わない
    // 番地が合わず町の中心しか返らない時（例「東京都江東区青海」）は、会場から1km近くずれうるので使わない
    if (!/[0-9０-９]|丁目/.test(title.slice(prefFull.length))) { Logger.log('住所検索が町までしか一致せず見送り: ' + title); continue; }
    const c = (r.geometry || {}).coordinates;
    if (!c) continue;
    return { lat: Number(c[1]), lon: Number(c[0]), label: title + '（公式サイトの住所・国土地理院）', address: address };
  }
  Logger.log('住所検索で都道府県一致なし: ' + address + '（' + prefFull + '）');
  return null;
}

/** Supabase の geocode-venue に会場名で聞く（Wikidata。都道府県は向こうで照合する） */
function nameGeocode(name, pref) {
  const props = PropertiesService.getScriptProperties();
  const supabaseUrl = props.getProperty('SUPABASE_URL');
  const supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl || !supabaseKey) return null;
  const res = UrlFetchApp.fetch(supabaseUrl + '/functions/v1/geocode-venue', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + supabaseKey },
    payload: JSON.stringify({ name: name, pref: pref }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) { Logger.log('geocode-venue HTTP ' + res.getResponseCode() + ': ' + name); return null; }
  const hit = (JSON.parse(res.getContentText()) || {}).hit;
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.label } : null;
}
