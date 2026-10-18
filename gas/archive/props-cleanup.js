/**
 * 一度きりの手動関数: スクリプトプロパティの整理。
 *
 * 役目: プロパティが50個を超えると、プロジェクトの設定の画面からは足すことも消すことも黙って捨てられる（2026-10-18 に確認）。
 *       YouTube のチャンネル番号 CH_<key> は youtube-scraper.js のコードへ写したので、ここで消して数を減らす。
 * 依存: 無し（PropertiesService だけ）。
 * 使い方: PROPSlist で名前と値の長さを見る（値そのものは出さない）→ PROPSdeleteChannelIds で CH_ で始まる物を消す → PROPSlist で確かめる。
 * 2026-10-18 に CH_ 31個を消して役目が済んだので archive へ。
 * 再利用: gas/ 直下へコピー → npm run gas:push -- --check → --confirm → 実行 → 使用後に消して --force-delete 付きで再push。
 */

function PROPSlist() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var names = Object.keys(all).sort();
  Logger.log('[PROPS] ' + names.length + ' 個');
  names.forEach(function (k) {
    Logger.log('[PROPS] ' + k + ' (' + String(all[k] || '').length + ' 文字)');
  });
}

function PROPSdeleteChannelIds() {
  var props = PropertiesService.getScriptProperties();
  var names = Object.keys(props.getProperties()).filter(function (k) { return /^CH_/.test(k); });
  names.forEach(function (k) { props.deleteProperty(k); });
  Logger.log('[PROPS] 消した: ' + names.length + ' 個 (' + names.join(', ') + ')');
  Logger.log('[PROPS] 残り: ' + Object.keys(props.getProperties()).length + ' 個');
}
