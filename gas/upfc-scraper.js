/**
 * UPFC スクレイパー
 * GAS トリガーで定期実行（12時間ごと推奨）
 *
 * スクリプトプロパティに以下を設定：
 *   SUPABASE_URL        - Supabase プロジェクト URL
 *   SUPABASE_SERVICE_KEY - Supabase service_role キー
 *
 * 【保管庫へ移した関数（gas/archive/upfc-scraper-debug.js にそのまま残してある）】
 * debugDetailPage, debugRawHtml, UFtestEvents（2026-09-04。デバッグ・検証が済んだため本番から外した）
 */

const BASE_URL = 'https://www.upfc.jp/helloproject';
const LIST_URL = BASE_URL + '/news_list.php?@rst=all';

// 公式記事側の誤字の補正（現物確認済みのもののみ追加する）。
// 会場名は座標辞書(schedule_venues)と名前で紐付くため、誤字のままだと地図が効かない。
const VENUE_TYPO_FIX = {
  '有楽日町朝ホール': '有楽町朝日ホール', // 西田汐里バースデー2026当日券記事(hfJ5WpEN5ZDHGepp)で確認
};

// 開場・開演・公演番号の判定「専用」の下ごしらえ。全角の数字・コロン・囲み記号を、
// 既存の正規表現がそのまま拾える形に揃えるだけで、棚（DB）に保存する会場名・題名の
// 文字はいっさい変えない（venue の抜き出しは今まで通り正規化前の text から行う）。
// 「＜公演番号01＞開場 16：40」のような全角山括弧＋全角コロン表記
// （エムハロイベントvol.10 記事(MXM2wVF970T7aaQW)で確認）を拾えるようにするための対策。
// 置換は1文字→1文字のみ（文字数は変えない）なので、位置ズレは起きない。
const ZENKAKU_TO_HANKAKU_FOR_MATCH = {
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  '：': ':',
  '＜': '【', '＞': '】', // 全角山括弧を、既存の【】判定がそのまま拾える記号に統一
};
function normalizeForEventMatch(s) {
  return s.replace(/[０-９：＜＞]/g, (ch) => ZENKAKU_TO_HANKAKU_FOR_MATCH[ch] ?? ch);
}

// ─── 会場名の正規化（未知の誤字対策） ───
// 公式記事の会場名を保存前に座標辞書(schedule_venues)と照合し、
// 「都道府県が同じ ＆ 文字の構成が同一（＝並び替え誤字）」なら辞書の正式名に直す。
// 文字の構成が1文字でも違えば触らない（「大ホール/小ホール」等の別ホールを誤って同一視しないため）。

let VENUE_DICT_CACHE = null;
function getVenueDict() {
  if (VENUE_DICT_CACHE !== null) return VENUE_DICT_CACHE;
  try {
    const props = PropertiesService.getScriptProperties();
    const res = UrlFetchApp.fetch(
      props.getProperty('SUPABASE_URL') + '/rest/v1/schedule_venues?select=name,prefecture',
      {
        headers: {
          'apikey': props.getProperty('SUPABASE_SERVICE_KEY'),
          'Authorization': 'Bearer ' + props.getProperty('SUPABASE_SERVICE_KEY'),
        },
        muteHttpExceptions: true,
      }
    );
    VENUE_DICT_CACHE = res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : [];
  } catch (e) {
    VENUE_DICT_CACHE = []; // 辞書が取れなくても本体処理は続行（正規化なしになるだけ）
  }
  return VENUE_DICT_CACHE;
}

function normalizeVenueChars(s) {
  return String(s).normalize('NFKC').replace(/[\s　]/g, '');
}

/** 文字の構成（順不同）をキー化。並び替え誤字の検出用 */
function venueCharBag(s) {
  return normalizeVenueChars(s).split('').sort().join('');
}

/** 「会場名 （都道府県）」を辞書の正式名に解決。一致しなければそのまま返す */
function resolveVenueName(venueText) {
  const m = String(venueText).match(/^(.*?)\s*[（(]([^）)]*)[）)]\s*$/);
  const rawName = (m ? m[1] : venueText).trim();
  const paren = m ? m[2] : '';
  const dict = getVenueDict();
  // 完全一致（正規化後）→ そのまま
  for (const v of dict) {
    if (normalizeVenueChars(v.name) === normalizeVenueChars(rawName)) return venueText;
  }
  // 並び替え誤字: 都道府県一致 ＆ 文字構成が同一 → 正式名に置換
  if (paren) {
    const bag = venueCharBag(rawName);
    for (const v of dict) {
      if (v.prefecture && paren.indexOf(v.prefecture) >= 0 && venueCharBag(v.name) === bag) {
        Logger.log('会場名を正規化: ' + rawName + ' → ' + v.name);
        return v.name + ' （' + paren + '）';
      }
    }
  }
  return venueText;
}

/** エントリポイント（GAS トリガーはここを指定） */
function UFmain() {
  const props = PropertiesService.getScriptProperties();
  const supabaseUrl = props.getProperty('SUPABASE_URL');
  const supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('スクリプトプロパティに SUPABASE_URL と SUPABASE_SERVICE_KEY を設定してください');
  }

  const articles = fetchNewsList();
  Logger.log('取得記事数: ' + articles.length);

  let successCount = 0;
  let errorCount = 0;

  for (const article of articles) {
    try {
      const deadlines = fetchDeadlines(article);
      upsertNewsToSupabase(supabaseUrl, supabaseKey, article, deadlines);
      Logger.log('OK: ' + article.uid + ' (' + deadlines.length + '件の締切)');
      successCount++;
      Utilities.sleep(1200); // 1.2秒待機（レートリミット対策）
    } catch (e) {
      Logger.log('ERROR: ' + article.uid + ' - ' + e.message);
      errorCount++;
    }
  }

  Logger.log('完了: 成功=' + successCount + ' エラー=' + errorCount);
}

// ─── 手動実行用（GAS エディタから。トリガーには登録しない） ─────────────────

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

// ─── リスト取得 ───────────────────────────────────────────

function fetchNewsList() {
  const res = UrlFetchApp.fetch(LIST_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('リスト取得失敗: HTTP ' + res.getResponseCode());
  }
  const html = res.getContentText('UTF-8');

  const articles = [];
  const seen = new Set();

  // href="/helloproject/news_detail.php?@uid=XXX" 形式にマッチ
  const linkRegex = /<a\b[^>]*href=["'][^"']*news_detail\.php\?@uid=([^"'\s>]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const uid = match[1];
    if (seen.has(uid)) continue;
    seen.add(uid);

    const innerHtml = match[2];

    // タイトル・カテゴリを複数の構造から取り出す
    const { title, category } = extractArticleInfo(innerHtml);
    if (!title) continue;

    articles.push({
      uid,
      title,
      category,
      detail_url: BASE_URL + '/news_detail.php?@uid=' + uid,
      scraped_at: new Date().toISOString(),
    });
  }

  return articles;
}

/**
 * <a> 内の HTML からタイトルとカテゴリを抽出。
 *
 * UPFC の実際の構造:
 *   <p class="news__date">2026.03.26<span class="news__ctg">イベント</span></p>
 *   <p class="news__txt">タイトル</p>
 */
function extractArticleInfo(innerHtml) {
  // ── パターン①（UPFC実装）: news__ctg スパン + news__txt 段落 ──
  const ctgMatch = innerHtml.match(/<span[^>]*news__ctg[^>]*>([\s\S]*?)<\/span>/i);
  const txtMatch = innerHtml.match(/<p[^>]*news__txt[^>]*>([\s\S]*?)<\/p>/i);
  if (ctgMatch && txtMatch) {
    const category = mapCategory(ctgMatch[1].replace(/<[^>]+>/g, '').trim());
    const title = txtMatch[1].replace(/<[^>]+>/g, '').trim();
    return { title, category };
  }

  // ── パターン②: <p> 2つ（1つ目にカテゴリ、2つ目にタイトル） ──
  const ps = extractTagTexts(innerHtml, 'p');
  if (ps.length >= 2) {
    return { title: ps[ps.length - 1], category: mapCategory(ps[0]) };
  }

  // ── パターン③: <span> 3つ（日付・カテゴリ・タイトル） ──
  const spans = extractTagTexts(innerHtml, 'span');
  if (spans.length >= 3) {
    return { title: spans[2], category: mapCategory(spans[1]) };
  }

  // ── パターン④: プレーンテキスト fallback ──
  const lines = innerHtml
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  const CATS = ['コンサート', 'イベント', '配信', 'グッズ'];
  const catLine = lines.find(l => CATS.some(c => l.includes(c)));
  const titleLine = lines.reduce((a, b) => (b.length > a.length ? b : a), '');
  return { title: titleLine, category: catLine ? mapCategory(catLine) : 'その他' };
}

function extractTagTexts(html, tag) {
  const texts = [];
  const re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, '').trim();
    if (text) texts.push(text);
  }
  return texts;
}

function mapCategory(raw) {
  if (!raw) return 'その他';
  if (raw.includes('イベント'))   return 'イベント';
  if (raw.includes('コンサート')) return 'コンサート';
  if (raw.includes('グッズ'))     return 'グッズ';
  if (raw.includes('配信'))       return '配信';
  return 'その他';
}

// ─── 詳細ページから締切抽出 ───────────────────────────────

function fetchDeadlines(article) {
  const res = UrlFetchApp.fetch(article.detail_url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return [];
  return parseDeadlinesFromHtml(article, res.getContentText('UTF-8'));
}

// html→締切抽出の本体。UrlFetchApp を呼ばない純粋な形に分けてあるのは、
// 保存済みの記事HTML（見本）を直接渡して自動テストできるようにするため
// （gas/upfc-scraper.test.mjs 参照）。GAS からの呼び出し経路(fetchDeadlines)は変えていない。
function parseDeadlinesFromHtml(article, html) {
  // HTMLタグを除去してプレーンテキスト化
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&hellip;/g, '…')
    .replace(/&rsquo;|&lsquo;|&#8217;|&#8216;|&#39;/g, "'")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/\s+/g, ' ');

  const deadlines = [];

  // ── 日付パターン（年あり・なし両対応、時刻任意） ──
  // UPFC は「2026 年 6 月 7 日（日）」のように数字の前後にスペース/改行が入ることがある
  // text は事前に \s+ → ' ' に正規化されているため、すべての数字単位の前後に \s* を許可する
  const D_WITH_YEAR = '\\d{4}\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日\\s*[（(]\\s*[月火水木金土日][祝]?\\s*[）)](?:\\s*\\d{1,2}\\s*時(?:\\s*\\d{1,2}\\s*分)?)?';
  const D_NO_YEAR   = '\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日\\s*[（(]\\s*[月火水木金土日][祝]?\\s*[）)](?:\\s*\\d{1,2}\\s*時(?:\\s*\\d{1,2}\\s*分)?)?';

  // ── グッズ通信販売（月次まとめ・個別イベント 共通） ──
  // 2026年7月7日17時、FCショップが e-LineUP!Mall から UPFCサイト内へ移転した。
  // これに伴い本文の見出しの言葉が変わっている:
  //   移転前 … 申込開始日／申込締切日（月次まとめ記事のみ。個別イベントの締切はUPFCに無く、
  //             e-LineUP側の商品ページからしか取れなかった＝elineup-scraper.js の役目）
  //   移転後 … 販売開始日／受付締切日（月次・個別とも同じ書式。締切もUPFC側で読めるようになった）
  // 旧ラベルも残す（過去記事を読み直したときに崩れないように）。
  // 「申込締切日」がチケットの申込締切パターン(apply_end)に誤って当たるのを防ぐため、
  // ここで goods_sale_start / goods_sale_end として確定し、以降のパターンには進ませず return する。
  if (article.category === 'グッズ' || /通販公開|\d+\s*月\s*通販/.test(article.title)) {
    // 1記事に複数イベント分の締切が並ぶ棚卸し記事（例:「ファンクラブショップ 受付締切日・
    // 商品お届け予定日のお知らせ」＝26イベント分が一覧になっている）は、先頭の1件だけを
    // その記事の締切として保存すると誤りになるので丸ごと見送る。
    // 同じ締切は個別記事側から取れるため、見送っても取りこぼしにはならない。
    const endLabelCount = (text.match(/(?:受付締切日|申込締切日)\s*[：:]/g) || []).length;
    if (endLabelCount >= 2) {
      Logger.log('複数イベント分の締切が並ぶグッズ一覧記事のため見送り: ' + article.title);
      return deadlines;
    }

    const open  = parseColonDateNear(text, '販売開始日')
               || parseColonDateNear(text, '申込開始日')
               || parseColonDateNear(text, '受付開始日');
    const close = parseColonDateNear(text, '受付締切日')
               || parseColonDateNear(text, '申込締切日');
    if (open)  deadlines.push({ type: 'goods_sale_start', label: '通販開始', deadline_at: open });
    if (close) deadlines.push({ type: 'goods_sale_end',   label: '通販締切', deadline_at: close });
    if (deadlines.length > 0) return deadlines;
    // 見出し形式で1件も取れなかったグッズ記事（販売開始が文章の中にしか無い等）は、
    // これまで通り以降のパターンに進ませる（下の「グッズ通信販売の開始（文章形式）」で拾う）。
  }

  // ── 申込期間（開始〜終了） ──
  // 例: ■申込期間： 2026 年3月26日（木）17時～4月1日（水）12時
  // 例: ■受付期間：2026年4月1日（水）17時～4月13日（月）12時
  const applyPeriod = text.match(
    new RegExp('■?(?:申込期間|受付期間)[：:]\\s*(' + D_WITH_YEAR + ')\\s*[〜～]\\s*(' + D_WITH_YEAR + '|' + D_NO_YEAR + ')')
  );
  if (applyPeriod) {
    const startYear = extractYear(applyPeriod[1]);
    const start = parseJapaneseDate(applyPeriod[1], null);
    const end   = parseJapaneseDate(applyPeriod[2], startYear); // 年なし対応
    if (start) deadlines.push({ type: 'apply_start', label: '申込開始', deadline_at: start });
    if (end)   deadlines.push({ type: 'apply_end',   label: '申込締切', deadline_at: end });
  }

  // ── 申込締切（単独記載のパターン） ──
  if (!applyPeriod) {
    const applyEnd = text.match(
      new RegExp('■?申込締切[日]?[：:]\\s*(' + D_WITH_YEAR + ')')
    );
    if (applyEnd) {
      const end = parseJapaneseDate(applyEnd[1], null);
      if (end) deadlines.push({ type: 'apply_end', label: '申込締切', deadline_at: end });
    }
  }

  // ── 当選・落選確認期間（開始のみ取得） ──
  // 例: ■当選・落選確認期間： 2026 年4月2日（木）16時～4月7日（火）23時
  const result = text.match(
    new RegExp('■?当[選落・]*確認[期間]*[：:]\\s*(' + D_WITH_YEAR + ')')
  );
  if (result) {
    const dt = parseJapaneseDate(result[1], null);
    if (dt) deadlines.push({ type: 'result', label: '当落確認', deadline_at: dt });
  }

  // ── 入金締切（時刻なし対応） ──
  // 例: ■入金締切日： 2026 年4月7日（火） 受領印有効
  const payment = text.match(
    new RegExp('■?入金締切[日]?[：:]\\s*(' + D_WITH_YEAR + ')')
  );
  if (payment) {
    const dt = parseJapaneseDate(payment[1], null);
    if (dt) deadlines.push({ type: 'payment', label: '入金締切', deadline_at: dt });
  }

  // ── 支払期間（開始日を payment_start、終了日を payment として保存） ──
  // 例: ■支払期間：2026年4月23日（木）12時～4月27日（月）12時
  if (!payment) {
    const payPeriod = text.match(
      new RegExp('■?支払期間[：:]\\s*(' + D_WITH_YEAR + ')\\s*[〜～]\\s*(' + D_WITH_YEAR + '|' + D_NO_YEAR + ')')
    );
    if (payPeriod) {
      const startYear = extractYear(payPeriod[1]);
      const start = parseJapaneseDate(payPeriod[1], null);
      const end = parseJapaneseDate(payPeriod[2], startYear);
      if (start) deadlines.push({ type: 'payment_start', label: '入金開始', deadline_at: start });
      if (end) deadlines.push({ type: 'payment', label: '入金締切', deadline_at: end });
    }
  }

  // ── 販売期間（グッズ・配信） ──
  const salePeriod = text.match(
    new RegExp('■?販売期間[：:]\\s*(' + D_WITH_YEAR + ')\\s*[〜～]\\s*(' + D_WITH_YEAR + '|' + D_NO_YEAR + ')')
  );
  if (salePeriod) {
    const startYear = extractYear(salePeriod[1]);
    const start = parseJapaneseDate(salePeriod[1], null);
    const end   = parseJapaneseDate(salePeriod[2], startYear);
    if (start) deadlines.push({ type: 'sale_start', label: '販売開始', deadline_at: start });
    if (end)   deadlines.push({ type: 'sale_end',   label: '販売終了', deadline_at: end });
  }

  // ── グッズ通信販売の開始（文章形式・年なし） ──
  // 例: 「5/25（月）18:00より通信販売がスタート」「5月25日（月）10:00より販売開始」
  // UPFCニュースには販売開始しか無く、締切は e-LineUP 側にしか無い（フロントで突き合わせる）。
  // 年は記事本文に無いため現在日から推定（過去すぎる月日なら翌年扱い）。type='goods_sale_start'。
  const goodsSale =
    text.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*[（(]\s*[月火水木金土日][祝]?\s*[）)]\s*(?:(\d{1,2})\s*[:：]\s*(\d{1,2}))?\s*より\s*(?:の)?\s*(?:通信販売|オンライン販売|オンラインストア|販売|受付|発売)\s*(?:が)?\s*(?:スタート|開始)/) ||
    text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*[（(]\s*[月火水木金土日][祝]?\s*[）)]\s*(?:(\d{1,2})\s*[:：]\s*(\d{1,2}))?\s*より\s*(?:の)?\s*(?:通信販売|オンライン販売|オンラインストア|販売|受付|発売)\s*(?:が)?\s*(?:スタート|開始)/);
  if (goodsSale) {
    const gmo = parseInt(goodsSale[1], 10);
    const gd  = parseInt(goodsSale[2], 10);
    const gh  = goodsSale[3] ? parseInt(goodsSale[3], 10) : 0;  // 時刻なし → 0時（その日から）
    const gmin = goodsSale[4] ? parseInt(goodsSale[4], 10) : 0;
    const gy  = guessYearForMonthDay(gmo, gd);
    const iso = new Date(Date.UTC(gy, gmo - 1, gd, gh - 9, gmin)).toISOString();
    deadlines.push({ type: 'goods_sale_start', label: '通販開始', deadline_at: iso });
  }

  // ── 公演本体の開催日時（締切ではなく公演そのもの。type='event'） ──
  // 例: 「●日程：2026年6月22日（月）」＋部ごとに「【公演番号01】開場 16:10/開演 16:45」。
  // 日程・会場は共通、開場/開演は部（公演番号）ごと。2部制・複数回は part_no=公演番号で別行にする。
  // 公演番号ブロックが無い従来記事は単独公演（part_no=1）。本文全体から開演/開場を拾う。
  // ツアーは公演日が画像（公演詳細.png 等）に埋まり本文に無いため、ここでは取れない（ビジョンOCRで別途対応）。
  // 中止・延期の記事からは公演日を作らない（主役の体調不良等で稀に発生）。「振替」は新日程が有効なので除外しない。
  //
  // 日程・開場・開演・公演番号ブロックの判定だけは、全角の数字・コロン・囲み記号を
  // 半角へ揃えた「照合用コピー(textNorm)」に対して行う。会場名の抜き出しは今まで通り
  // 元の text から行う（棚に保存する文字は変えない）。
  const textNorm = normalizeForEventMatch(text);
  const eventMatch = textNorm.match(/日程[：:]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (eventMatch && !/中止|延期/.test(article.title)) {
    const ey = parseInt(eventMatch[1], 10);
    const emo = parseInt(eventMatch[2], 10) - 1;
    const ed = parseInt(eventMatch[3], 10);

    // 開演時刻（4書式・前後どちらでも）をテキスト断片から拾う。無ければnull。
    const matchKaien = (seg) => {
      let km;
      if ((km = seg.match(/開演\s*(\d{1,2})\s*[:：]\s*(\d{1,2})/))) return { h: +km[1], m: +km[2] };
      if ((km = seg.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})\s*開演/))) return { h: +km[1], m: +km[2] };
      if ((km = seg.match(/開演\s*(\d{1,2})\s*時\s*(?:(\d{1,2})\s*分)?/))) return { h: +km[1], m: km[2] ? +km[2] : 0 };
      if ((km = seg.match(/(\d{1,2})\s*時\s*(?:(\d{1,2})\s*分)?\s*開演/))) return { h: +km[1], m: km[2] ? +km[2] : 0 };
      return null;
    };
    // 開場時刻（同じ4書式）。無ければnull。
    const matchKaijo = (seg) => {
      let om;
      if ((om = seg.match(/開場\s*(\d{1,2})\s*[:：]\s*(\d{1,2})/))) return { h: +om[1], m: +om[2] };
      if ((om = seg.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})\s*開場/))) return { h: +om[1], m: +om[2] };
      if ((om = seg.match(/開場\s*(\d{1,2})\s*時\s*(?:(\d{1,2})\s*分)?/))) return { h: +om[1], m: om[2] ? +om[2] : 0 };
      if ((om = seg.match(/(\d{1,2})\s*時\s*(?:(\d{1,2})\s*分)?\s*開場/))) return { h: +om[1], m: om[2] ? +om[2] : 0 };
      return null;
    };

    // 会場（共通）: 「会場：◯◯ （地域）」を最初の（…）括弧まで取る。後続の日程/料金等を巻き込まない。
    let venue = null;
    let vm;
    if ((vm = text.match(/会場[：:]\s*(.{1,40}?[（(][^）)]{1,30}[）)])/))) {
      venue = vm[1];
    } else if ((vm = text.match(/会場[：:]\s*([^\s●※].{0,25}?)(?=\s*(?:[●※]|日程|開場|開演|チケット|$))/))) {
      venue = vm[1]; // 括弧無し会場のフォールバック
    }
    if (venue) venue = venue.replace(/\s+/g, ' ').trim();
    if (venue) {
      for (const typo in VENUE_TYPO_FIX) {
        if (venue.indexOf(typo) >= 0) venue = venue.replace(typo, VENUE_TYPO_FIX[typo]);
      }
      venue = resolveVenueName(venue); // 未知の並び替え誤字を辞書の正式名へ
    }

    // 1公演（部）分のevent行を作る。開演不明時は正午（締切類の23:59と区別）。開場は開演より前のときだけ採用。
    const pushShow = (seg, partNo) => {
      const k = matchKaien(seg) || { h: 12, m: 0 };
      const eventIso = new Date(Date.UTC(ey, emo, ed, k.h - 9, k.m)).toISOString();
      let openIso = null;
      const o = matchKaijo(seg);
      if (o) {
        const openDate = new Date(Date.UTC(ey, emo, ed, o.h - 9, o.m));
        if (openDate.toISOString() < eventIso) openIso = openDate.toISOString();
      }
      deadlines.push({ type: 'event', label: '公演', deadline_at: eventIso, location: venue, open_at: openIso, part_no: partNo });
    };

    // 【公演番号NN】ブロックを全部拾う。各ブロック＝1公演（部）。断片はそのブロック範囲に限定して誤抽出を防ぐ。
    // HTMLタグ剥がしで括弧内に空白が入る（実テキストは「【 公演番号01 】」）ため \s* を許可。
    // textNorm は text と文字数が同じ（1文字→1文字の置換のみ）なので、位置(idx)はそのまま使える。
    const partRe = /【\s*公演番号\s*(\d+)\s*】/g;
    const parts = [];
    let pm;
    while ((pm = partRe.exec(textNorm)) !== null) parts.push({ no: parseInt(pm[1], 10), idx: pm.index });
    if (parts.length > 0) {
      for (let i = 0; i < parts.length; i++) {
        const end = i + 1 < parts.length ? parts[i + 1].idx : Math.min(textNorm.length, parts[i].idx + 120);
        pushShow(textNorm.slice(parts[i].idx, end), parts[i].no);
      }
    } else {
      pushShow(textNorm, 1); // 従来形式（単独公演）
    }
  }

  return deadlines;
}

/**
 * 年なし月日（例: 5/25）の年を現在日から推定する。
 * グッズ通販開始は記事本文に年が無く、発表は販売日より前なので「直近の未来寄り」を選ぶ。
 * 月日が3ヶ月以上過去なら翌年（年末発表・年明け販売の境界対応）、それ以外は今年。
 * @param {number} month 1〜12
 * @param {number} day 1〜31
 */
function guessYearForMonthDay(month, day) {
  const now = new Date();
  const y = now.getFullYear();
  const candidate = new Date(y, month - 1, day);
  const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  return candidate < threeMonthsAgo ? y + 1 : y;
}

/**
 * ラベル直後の「YYYY年M月D日（曜）HH:MM」または「…HH時MM分」を ISO(UTC) で返す。
 * 月次通販の申込開始日/申込締切日は時刻がコロン形式（18:00）なので専用に処理する。
 * @param {string} text 正規化済み本文
 * @param {string} label 例 '申込開始日'
 */
function parseColonDateNear(text, label) {
  const m = text.match(new RegExp(label + '[：:]\\s*(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日\\s*[（(][^）)]*[）)]\\s*(?:(\\d{1,2})\\s*[:：]\\s*(\\d{1,2})|(\\d{1,2})\\s*時(?:\\s*(\\d{1,2})\\s*分)?)?'));
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  let h, min;
  if (m[4] != null) { h = +m[4]; min = +m[5]; }           // HH:MM
  else if (m[6] != null) { h = +m[6]; min = m[7] ? +m[7] : 0; } // HH時MM分
  else { h = 23; min = 59; }                               // 時刻なし → 23:59
  return new Date(Date.UTC(y, mo, d, h - 9, min)).toISOString();
}

/** 日付文字列から年を抽出（年なし日付の fallback 用） */
function extractYear(str) {
  const m = str.match(/(\d{4})\s*年/);
  return m ? parseInt(m[1], 10) : new Date().getFullYear();
}

/**
 * 日本語日付文字列 → ISO 8601 (UTC)
 * @param {string} str  "2026 年3月26日（木）17時" or "4月1日（水）12時"
 * @param {number|null} fallbackYear  年なし日付のときに使う年（申込開始の年）
 */
function parseJapaneseDate(str, fallbackYear) {
  // 年あり
  const withYear = str.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*[（(][^）)]*[）)](?:\s*(\d{1,2})\s*時(?:\s*(\d{1,2})\s*分)?)?/);
  if (withYear) {
    const year   = parseInt(withYear[1], 10);
    const month  = parseInt(withYear[2], 10) - 1;
    const day    = parseInt(withYear[3], 10);
    const hour   = withYear[4] ? parseInt(withYear[4], 10) : 23; // 時刻なし → 23時扱い
    const minute = withYear[5] ? parseInt(withYear[5], 10) : (withYear[4] ? 0 : 59); // 時あり分なし → :00、時刻なし → :59
    return new Date(Date.UTC(year, month, day, hour - 9, minute)).toISOString();
  }
  // 年なし（fallbackYear を使う）
  const noYear = str.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*[（(][^）)]*[）)](?:\s*(\d{1,2})\s*時(?:\s*(\d{1,2})\s*分)?)?/);
  if (noYear && fallbackYear) {
    const month  = parseInt(noYear[1], 10) - 1;
    const day    = parseInt(noYear[2], 10);
    const hour   = noYear[3] ? parseInt(noYear[3], 10) : 23;
    const minute = noYear[4] ? parseInt(noYear[4], 10) : (noYear[3] ? 0 : 59); // 時あり分なし → :00、時刻なし → :59
    return new Date(Date.UTC(fallbackYear, month, day, hour - 9, minute)).toISOString();
  }
  return null;
}

// ─── Supabase UPSERT ──────────────────────────────────────


function upsertNewsToSupabase(supabaseUrl, supabaseKey, article, deadlines) {
  const headers = {
    'apikey': supabaseKey,
    'Authorization': 'Bearer ' + supabaseKey,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates',
  };

  // fc_news UPSERT（uid が PRIMARY KEY なので on_conflict=uid）
  const newsRes = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/fc_news?on_conflict=uid', {
    method: 'post',
    headers,
    payload: JSON.stringify([{
      uid:        article.uid,
      title:      article.title,
      category:   article.category,
      detail_url: article.detail_url,
      scraped_at: article.scraped_at,
    }]),
    muteHttpExceptions: true,
  });

  const newsStatus = newsRes.getResponseCode();
  if (newsStatus >= 400) {
    Logger.log('fc_news UPSERT エラー ' + newsStatus + ': ' + newsRes.getContentText());
  }

  // fc_deadlines UPSERT（news_uid + type + part_no がユニーク。複数公演=部ごとに別行）
  // ※ part_no を含む一意制約への張り替えが本番DBに済んでいることが前提（新スクレイパー配備と同時）。
  for (const dl of deadlines) {
    if (!dl.deadline_at) continue;

    const dlRes = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/fc_deadlines?on_conflict=news_uid,type,part_no', {
      method: 'post',
      headers,
      payload: JSON.stringify([{
        news_uid:    article.uid,
        type:        dl.type,
        label:       dl.label,
        deadline_at: dl.deadline_at,
        location:    dl.location ?? null,
        open_at:     dl.open_at ?? null,
        part_no:     dl.part_no ?? 1,
      }]),
      muteHttpExceptions: true,
    });

    const dlStatus = dlRes.getResponseCode();
    if (dlStatus >= 400) {
      Logger.log('fc_deadlines UPSERT エラー ' + dlStatus + ': ' + dlRes.getContentText());
    }
  }
}
