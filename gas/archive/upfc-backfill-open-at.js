/**
 * 【保管庫】UPFC の古い記事を名指しで読み直して開場時刻を埋める関数（本番の Apps Script には送らない）
 *
 * 役目: 通常巡回(UFmain)は新着一覧しか見ないので、取り込みが古くて開場時刻(open_at)が空のまま
 *       残った公演は二度と読み直されない。そこで対象記事を UF_BACKFILL_TARGETS に名指しで並べ、
 *       記事ページを直接読み直して fc_deadlines の開場時刻を埋める。
 *       UFbackfillOpenAtPreview は読むだけで書き込まない確認用。
 * 移した日: 2026-09-04（2026年6〜8月の公演24件を埋め終えたため）
 *
 * 本編（gas/upfc-scraper.js）の次のものに依存する:
 *   BASE_URL, fetchDeadlines, upsertNewsToSupabase
 *
 * もう一度使うとき（開場時刻が空の公演がまた見つかったら）:
 *   1. UF_BACKFILL_TARGETS を新しい対象（uid・種類・題名）に書き換える
 *      （fc_news.category は上書き保存されるので、種類は現物どおりに書くこと）
 *   2. このファイルを gas/ 直下にコピーして npm run gas:push -- --check → --confirm
 *   3. Apps Script エディタで UFbackfillOpenAtPreview → 内容を見て → UFbackfillOpenAt を実行
 *   4. 使い終わったら gas/ 直下のコピーを消して、もう一度 gas:push
 *      （本番にだけ残るファイルを消すので --confirm --force-delete が要る）
 */


/**
 * 開場欠け26件のうち「記事には開場記載があるのに棚が古いままの24件」だけを狙い撃ちで読み直す、
 * 一回限りの手作業用関数（GASエディタから手動で実行する。トリガーには絶対に登録しない）。
 *
 * 通常巡回(UFmain)と違い、対象記事を news_list.php の新着一覧から探さない
 * （この24件は一覧から外れて久しく、通常の巡回ではもう再訪されないため）。
 * かわりに、記事ページ自体は直接 detail_url で読みに行きつつ、
 * title/category は前回の調査で確認済みの値をここに直書きして使う
 * （fc_news.category は上書き保存されるため、正しい値を渡す必要がある）。
 *
 * 実行前に必ず確認すること:
 *   - 対象24件のURL・タイトル・種類が古い記事削除等で変わっていないか（本関数は書き込み前の
 *     プレビューをしないので、必要ならまず UFbackfillOpenAtPreview() で内容だけ確認してから流す）
 *   - 書き換わる可能性がある列: fc_deadlines.open_at（本命）／fc_deadlines.deadline_at・location
 *     （記事が振替等で更新されていれば、開演時刻や会場も現在の記事内容に合わせて上書きされる）
 *   - fc_news.title/category も現在の記事内容で上書きされる（通常は変化なし）
 */
const UF_BACKFILL_TARGETS = [
  // (c) 開場欄が整う前後に取り込まれ、その後読み直されていない23件
  { uid: 'Y8txrJ1nyg4hMAMN', category: 'イベント', title: '「ENPLEX×Hello!Project名古屋定期イベント」7/13「BEYOOOOONDS 西田汐里・前田こころバースデーイベント2026 in 名古屋」開催決定！' },
  { uid: 'DxsejI97HUFf3jHz', category: 'イベント', title: '★ファンクラブ会員限定イベント★「BEYOOOOONDS/雨ノ森 川海 清野桃々姫FCイベント2026 〜おまたせっ！ももひめ七変化〜」FC2次受付のお知らせ' },
  { uid: 'iMqgU62G1DsM7dPk', category: 'イベント', title: '★ファンクラブ会員限定イベント★「モーニング娘。\'26 弓桁朱琴バースデーイベント」開催決定！' },
  { uid: 'Abx3Hx4gFhagrPAh', category: 'イベント', title: '★ファンクラブ会員限定イベント★「アンジュルム 平山遊季バースデーイベント2026」開催決定！' },
  { uid: '5DsR4g7YIYIEftAh', category: 'イベント', title: '「ロージークロニクル結成2年記念FCイベント2026 ～Second Page!!～」当日券予約販売のお知らせ' },
  { uid: 'AzLWRbKaNWuzWS7s', category: 'イベント', title: '「Juice=Juice 有澤一華・入江里咲・江端妃咲FCイベント2026」当日券予約販売のお知らせ' },
  { uid: 'HdaFyiz0b8hgYLGM', category: 'イベント', title: '「モーニング娘。’26 井上春華バースデーイベント」東京公演 当日券予約販売のお知らせ' },
  { uid: '8vJL8xrPwrNyri7W', category: 'コンサート', title: '『BEYOOOOONDS CONCERT 2026 SPRING [HIGH! TENSION BEYOSCOOOOOPE]』FC追加受付のお知らせ' },
  { uid: 'haPQuAIa8TpWZxpD', category: 'イベント', title: '★ファンクラブ会員限定イベント★「ロージークロニクル 吉田姫杷・上村麗菜バースデーイベント2026」FC2次受付のお知らせ' },
  { uid: 'EqzDLMLNn6ZFLzrY', category: 'イベント', title: '★ファンクラブ会員限定イベント★「BEYOOOOONDS/雨ノ森 川海 前田こころバースデーイベント2026」FC2次受付のお知らせ' },
  { uid: 'kqtTxMdG4hYHkDV4', category: 'イベント', title: '★ファンクラブ会員限定イベント★「Juice=Juice 井上玲音バースデーイベント2026」開催決定！' },
  { uid: 'yuBPxzH0LPVSqmJz', category: 'イベント', title: '★ファンクラブ会員限定イベント★「モーニング娘。\'26 山﨑愛生バースデーイベント」FC2次受付のお知らせ' },
  { uid: 'PTY2GprqbbZ67Up2', category: 'イベント', title: '「モーニング娘。\'26 井上春華バースデーイベント」東京公演 当日券販売のお知らせ' },
  { uid: 'GfBWhU1g7eGRRVZJ', category: 'イベント', title: '★ファンクラブ会員限定イベント★「OCHA NORMA 中山夏月姫バースデーイベント2026」開催決定！' },
  { uid: 'fv2YPZuUruIfErqA', category: 'イベント', title: '「OCHA NORMA 広本瑠璃バースデーイベント2026」当日券予約販売のお知らせ' },
  { uid: 'm665UeSd661G9Sfk', category: 'イベント', title: '「アンジュルム 後藤花バースデーイベント2026」当日券販売のお知らせ' },
  { uid: 'bYnBfHab6u66Wkea', category: 'イベント', title: '★ファンクラブ会員限定イベント★「OCHA NORMA 窪田七海バースデーイベント2026」開催決定！' },
  { uid: '2YDIBf8mE1nhpYmI', category: 'イベント', title: '「モーニング娘。’26 井上春華バースデーイベント」大阪公演 当日券販売のお知らせ' },
  { uid: 'hfJ5WpEN5ZDHGepp', category: 'イベント', title: '「BEYOOOOONDS/CHICA#TETSU 西田汐里バースデーイベント2026」当日券予約販売のお知らせ' },
  { uid: 'AA2qMg2XUNpSXzrX', category: 'イベント', title: '「Juice=Juice 有澤一華・入江里咲・江端妃咲FCイベント2026」当日券販売のお知らせ' },
  { uid: 'drYrLMkDURfrthZI', category: 'イベント', title: '「ENPLEX×Hello!Project名古屋定期イベント」 7/9「モーニング娘。\'26 山﨑愛生バースデーイベント in 名古屋」FC2次受付のお知らせ' },
  { uid: '1IAt32nJ4RtgS0Lx', category: 'イベント', title: 'Juice=Juice出演「めざましWANGANフェス」FC先行受付のお知らせ' },
  { uid: 'ManpJTdug80k6LZt', category: 'イベント', title: '「ロージークロニクル 吉田姫杷・上村麗菜バースデーイベント2026」当日券予約販売のお知らせ' },
  // (a) 全角山括弧＋全角コロン表記の抜き出し漏れ。下ごしらえ(normalizeForEventMatch)込みで再取得すれば直る想定
  { uid: 'MXM2wVF970T7aaQW', category: 'イベント', title: '『エムハロイベントvol.10～中島早貴×OCHA NORMA窪田七海～』当日券予約受付のお知らせ' },
];

/** UFbackfillOpenAt() の書き込み前プレビュー。読むだけで、DBには一切書き込まない。 */
function UFbackfillOpenAtPreview() {
  const out = [];
  for (const t of UF_BACKFILL_TARGETS) {
    const article = { uid: t.uid, title: t.title, category: t.category, detail_url: BASE_URL + '/news_detail.php?@uid=' + t.uid };
    try {
      const deadlines = fetchDeadlines(article);
      const events = deadlines.filter(d => d.type === 'event');
      out.push({ uid: t.uid, title: t.title, events });
      Logger.log(t.uid + ' / ' + t.title + ' → event=' + JSON.stringify(events));
    } catch (e) {
      out.push({ uid: t.uid, title: t.title, error: e.message });
      Logger.log('ERROR: ' + t.uid + ' - ' + e.message);
    }
    Utilities.sleep(800);
  }
  return JSON.stringify(out, null, 2);
}

/** 対象24件を実際に棚へ書き込む。UFbackfillOpenAtPreview() で内容を確認してから実行すること。 */
function UFbackfillOpenAt() {
  const props = PropertiesService.getScriptProperties();
  const supabaseUrl = props.getProperty('SUPABASE_URL');
  const supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('スクリプトプロパティに SUPABASE_URL と SUPABASE_SERVICE_KEY を設定してください');
  }

  let successCount = 0;
  let errorCount = 0;
  for (const t of UF_BACKFILL_TARGETS) {
    const article = {
      uid: t.uid,
      title: t.title,
      category: t.category,
      detail_url: BASE_URL + '/news_detail.php?@uid=' + t.uid,
      scraped_at: new Date().toISOString(),
    };
    try {
      const deadlines = fetchDeadlines(article);
      upsertNewsToSupabase(supabaseUrl, supabaseKey, article, deadlines);
      Logger.log('OK: ' + t.uid + ' (' + deadlines.length + '件の締切)');
      successCount++;
    } catch (e) {
      Logger.log('ERROR: ' + t.uid + ' - ' + e.message);
      errorCount++;
    }
    Utilities.sleep(1200); // 通常巡回と同じ間隔（レートリミット対策）
  }
  Logger.log('完了: 成功=' + successCount + ' エラー=' + errorCount + ' / 対象=' + UF_BACKFILL_TARGETS.length + '件');
}
