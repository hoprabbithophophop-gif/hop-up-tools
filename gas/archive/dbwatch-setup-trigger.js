/**
 * 【保管庫】棚の見張り(DBWATCHmain)の10分ごとのトリガーを作る関数（本番の Apps Script には送らない）
 *
 * 役目: DBWATCHmain を10分ごとに回すトリガーを作る。既にあれば作り直す。
 * 移した日: 2026-10-18（Hop がエディタで1回実行してトリガー作成済み。二度目は要らないため）
 *
 * 本編（gas/db-watch.js）の次のものに依存する:
 *   DBWATCHmain（トリガーの呼び先として名前だけ）
 *
 * もう一度使うとき（トリガーを消してしまった等）:
 *   Apps Script の「トリガー」画面から手で DBWATCHmain の時間主導型トリガー（10分ごと）を作ってもよい。
 *   この関数で作るなら:
 *   1. このファイルを gas/ 直下にコピーして npm run gas:push -- --check → --confirm
 *   2. Apps Script エディタで DBWATCHsetupTrigger を1回実行
 *   3. gas/ 直下のコピーを消して、もう一度 gas:push（--confirm --force-delete が要る）
 */

/** 10分ごとのトリガーを作る（GASエディタから一度だけ実行） */
function DBWATCHsetupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'DBWATCHmain') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('DBWATCHmain').timeBased().everyMinutes(10).create();
  Logger.log('DBWATCHmain の10分ごとのトリガーを設定しました');
}
