/**
 * 【保管庫】X投稿ボットのデバッグ用関数（本番の Apps Script には送らない）
 *
 * 役目: 宣伝ツイートの文言が4パターン順番に切り替わることをログで確かめる。
 *       X には投稿せず、順番カウンタ(X_PROMO_LAST_INDEX)も元に戻す。
 * 移した日: 2026-09-04（確認が済み、本編を軽くするため）
 *
 * 本編（gas/x-bot.js）の次のものに依存する:
 *   buildPromoTweet
 *
 * もう一度使うとき:
 *   1. このファイルを gas/ 直下にコピーして npm run gas:push -- --check → --confirm
 *   2. Apps Script エディタで debugPromoRotation を実行
 *   3. 使い終わったら gas/ 直下のコピーを消して、もう一度 gas:push
 *      （本番にだけ残るファイルを消すので --confirm --force-delete が要る）
 */

// ===== デバッグ用: 宣伝ツイートのローテーション確認 =====
// X_DRY_RUN不要、postTweet()を呼ばないのでX投稿もしない
// 元のindexを保存→5回ローテ→indexを元に戻す
function debugPromoRotation() {
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty('X_PROMO_LAST_INDEX');
  for (var i = 0; i < 5; i++) {
    var t = buildPromoTweet();
    Logger.log('--- 回 ' + (i + 1) + ' ---\n' + t);
  }
  if (saved === null) {
    props.deleteProperty('X_PROMO_LAST_INDEX');
  } else {
    props.setProperty('X_PROMO_LAST_INDEX', saved);
  }
  Logger.log('（テスト完了。X_PROMO_LAST_INDEX を元に戻しました）');
}
