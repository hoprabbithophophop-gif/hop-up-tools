/**
 * 【保管庫】会場見張り(VENUEmain)の日次トリガーを作る関数（本番の Apps Script には送らない）
 *
 * 役目: VENUEmain を毎朝9時台に回すトリガーを作る。既にあれば作り直す。
 * 移した日: 2026-09-04（トリガーは作成済みで、二度目は要らないため）
 *
 * 本編（gas/venue-watch.js）の次のものに依存する:
 *   VENUEmain（トリガーの呼び先として名前だけ）
 *
 * もう一度使うとき（トリガーを消してしまった等）:
 *   Apps Script の「トリガー」画面から手で VENUEmain の時間主導型トリガーを作ってもよい。
 *   この関数で作るなら:
 *   1. このファイルを gas/ 直下にコピーして npm run gas:push -- --check → --confirm
 *   2. Apps Script エディタで VENUEsetupTrigger を1回実行
 *   3. gas/ 直下のコピーを消して、もう一度 gas:push（--confirm --force-delete が要る）
 */


/** 日次トリガーを作る（GASエディタから一度だけ実行） */
function VENUEsetupTrigger() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'VENUEmain') ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('VENUEmain').timeBased().everyDays(1).atHour(9).create();
  Logger.log('VENUEmain の日次トリガー（毎朝9時台）を設定しました');
}
