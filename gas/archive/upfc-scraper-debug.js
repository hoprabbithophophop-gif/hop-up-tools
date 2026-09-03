/**
 * 【保管庫】UPFC スクレイパーのデバッグ用関数（本番の Apps Script には送らない）
 *
 * 役目: 記事の本文や一覧ページの生HTMLをログに出して、抜き出し漏れの原因を調べる。
 *       UFtestEvents は公演日(event)抜き出しの検証用に、既知の5記事だけを取り込み直す。
 * 移した日: 2026-09-04（デバッグが済み、本編を軽くするため）
 *
 * 本編（gas/upfc-scraper.js）の次のものに依存する:
 *   BASE_URL, LIST_URL, fetchNewsList, fetchDeadlines, upsertNewsToSupabase
 *
 * もう一度使うとき:
 *   1. このファイルを gas/ 直下にコピーして npm run gas:push -- --check → --confirm
 *   2. Apps Script エディタで関数を選んで実行
 *   3. 使い終わったら gas/ 直下のコピーを消して、もう一度 gas:push
 *      （本番にだけ残るファイルを消すので --confirm --force-delete が要る）
 */

/** 詳細ページのプレーンテキストをログに出す（申込・締切周辺を確認するため） */
function debugDetailPage() {
  const uid = 'X9iKILwNYGa8vK2m'; // 0件だった記事
  const url = BASE_URL + '/news_detail.php?@uid=' + uid;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const html = res.getContentText('UTF-8');
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

  // 申込・受付・締切・当落・入金 周辺だけ抽出
  const keywords = ['申込', '受付', '締切', '当落', '当選', '入金', '販売', '年'];
  for (const kw of keywords) {
    const idx = text.indexOf(kw);
    if (idx >= 0) {
      Logger.log('[' + kw + '] → ' + text.slice(Math.max(0, idx - 20), idx + 100));
    }
  }
  Logger.log('--- テキスト全体（2000文字）---\n' + text.slice(0, 2000));
}

/** リストページの生HTMLを最初の3000文字ログに出す */
function debugRawHtml() {
  const res = UrlFetchApp.fetch(LIST_URL, { muteHttpExceptions: true });
  const html = res.getContentText('UTF-8');
  Logger.log('HTTP: ' + res.getResponseCode());
  Logger.log('HTML長さ: ' + html.length);
  Logger.log('--- 先頭3000文字 ---\n' + html.slice(0, 3000));

  // uid が含まれているか確認
  const uidMatches = html.match(/news_detail\.php[^"']*/g) || [];
  Logger.log('news_detail リンク数: ' + uidMatches.length);
  if (uidMatches.length > 0) Logger.log('最初のリンク: ' + uidMatches[0]);

  // <a タグのサンプル（最初の2件）
  const aTagRegex = /<a\b[^>]*news_detail[^>]*>[\s\S]{0,300}/g;
  let m;
  let count = 0;
  while ((m = aTagRegex.exec(html)) !== null && count < 2) {
    Logger.log('--- <a>タグサンプル ' + (count + 1) + ' ---\n' + m[0]);
    count++;
  }
}

/** 公演日(event)抽出の検証用：既知のイベント記事だけを処理してupsert。6分制限内で確実に回る。 */
function UFtestEvents() {
  const props = PropertiesService.getScriptProperties();
  const supabaseUrl = props.getProperty('SUPABASE_URL');
  const supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');
  const TARGET = ['Abx3Hx4gFhagrPAh', 'rdwEdwDwx07vBMps', 'Y8txrJ1nyg4hMAMN', 'iMqgU62G1DsM7dPk', 'DxsejI97HUFf3jHz'];
  const articles = fetchNewsList().filter(a => TARGET.indexOf(a.uid) >= 0);
  const out = [];
  for (const article of articles) {
    const deadlines = fetchDeadlines(article);
    upsertNewsToSupabase(supabaseUrl, supabaseKey, article, deadlines);
    const ev = deadlines.filter(d => d.type === 'event');
    out.push({ uid: article.uid, title: article.title, total: deadlines.length, events: ev });
    Logger.log(article.uid + ' / ' + article.title + ' → event=' + JSON.stringify(ev));
    Utilities.sleep(800);
  }
  return JSON.stringify(out, null, 2);
}
