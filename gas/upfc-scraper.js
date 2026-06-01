/**
 * UPFC スクレイパー
 * GAS トリガーで定期実行（12時間ごと推奨）
 *
 * スクリプトプロパティに以下を設定：
 *   SUPABASE_URL        - Supabase プロジェクト URL
 *   SUPABASE_SERVICE_KEY - Supabase service_role キー
 */

const BASE_URL = 'https://www.upfc.jp/helloproject';
const LIST_URL = BASE_URL + '/news_list.php?@rst=all';

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

// ─── デバッグ用（GAS エディタから手動実行） ─────────────────

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

  // HTMLタグを除去してプレーンテキスト化
  const html = res.getContentText('UTF-8');
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

  // ── 月次まとめ通販（「○月通販公開！」） ──
  // 本文に「申込開始日：2026年6月1日（月）18:00」「申込締切日：2026年6月26日（金）23:59」が揃う。
  // e-LineUP突き合わせ不要でUPFC単独で販売期間が完結する。
  // 申込締切日が通常の申込締切パターン(apply_end)に当たってチケット扱いされるのを防ぐため、
  // ここで goods_sale_start / goods_sale_end として確定し、以降のパターンには進ませず return。
  if (/通販公開|\d+\s*月\s*通販/.test(article.title)) {
    const open  = parseColonDateNear(text, '申込開始日');
    const close = parseColonDateNear(text, '申込締切日');
    if (open)  deadlines.push({ type: 'goods_sale_start', label: '通販開始', deadline_at: open });
    if (close) deadlines.push({ type: 'goods_sale_end',   label: '通販締切', deadline_at: close });
    return deadlines;
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
  // 例: 「●日程：2026年7月14日（火）」＋「開場 16:05/開演 16:45」（部ごと）
  // 単発イベント/バースデー系が対象。ツアーは公演日が別リンク先のため本文に無く取得不可。
  // 注意: 開演時刻は最初の1件のみ採用（複数部・複数日は将来対応）。見つからなければ正午扱い。
  // 中止・延期の記事からは公演日を作らない（主役の体調不良等で稀に発生）。「振替」は新日程が有効なので除外しない。
  const eventMatch = text.match(/日程[：:]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (eventMatch && !/中止|延期/.test(article.title)) {
    const ey = parseInt(eventMatch[1], 10);
    const emo = parseInt(eventMatch[2], 10) - 1;
    const ed = parseInt(eventMatch[3], 10);
    // 開演時刻: 「開演 18:00」「18:00開演」「開演18時」「18時開演」の4書式に対応（前後どちらでも）
    let eh = 12, emin = 0; // 開演不明時は正午（締切類の23:59と区別するため）
    let km;
    if ((km = text.match(/開演\s*(\d{1,2})\s*[:：]\s*(\d{1,2})/))) { eh = +km[1]; emin = +km[2]; }
    else if ((km = text.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})\s*開演/))) { eh = +km[1]; emin = +km[2]; }
    else if ((km = text.match(/開演\s*(\d{1,2})\s*時\s*(?:(\d{1,2})\s*分)?/))) { eh = +km[1]; emin = km[2] ? +km[2] : 0; }
    else if ((km = text.match(/(\d{1,2})\s*時\s*(?:(\d{1,2})\s*分)?\s*開演/))) { eh = +km[1]; emin = km[2] ? +km[2] : 0; }
    const eventIso = new Date(Date.UTC(ey, emo, ed, eh - 9, emin)).toISOString();
    // 会場（「会場：◯◯ （地域）」を最初の（…）括弧まで取る。後続の日程/料金等を巻き込まない）
    let venue = null;
    let vm;
    if ((vm = text.match(/会場[：:]\s*(.{1,40}?[（(][^）)]{1,30}[）)])/))) {
      venue = vm[1];
    } else if ((vm = text.match(/会場[：:]\s*([^\s●※].{0,25}?)(?=\s*(?:[●※]|日程|開場|開演|チケット|$))/))) {
      venue = vm[1]; // 括弧無し会場のフォールバック
    }
    if (venue) venue = venue.replace(/\s+/g, ' ').trim();
    deadlines.push({ type: 'event', label: '公演', deadline_at: eventIso, location: venue });
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

  // fc_deadlines UPSERT（news_uid + type がユニーク）
  for (const dl of deadlines) {
    if (!dl.deadline_at) continue;

    const dlRes = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/fc_deadlines?on_conflict=news_uid,type', {
      method: 'post',
      headers,
      payload: JSON.stringify([{
        news_uid:    article.uid,
        type:        dl.type,
        label:       dl.label,
        deadline_at: dl.deadline_at,
        location:    dl.location ?? null,
      }]),
      muteHttpExceptions: true,
    });

    const dlStatus = dlRes.getResponseCode();
    if (dlStatus >= 400) {
      Logger.log('fc_deadlines UPSERT エラー ' + dlStatus + ': ' + dlRes.getContentText());
    }
  }
}
