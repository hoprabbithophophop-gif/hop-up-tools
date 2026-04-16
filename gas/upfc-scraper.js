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
    .replace(/\s+/g, ' ');

  const deadlines = [];

  // ── 日付パターン（年あり・なし両対応、時刻任意） ──
  // UPFC は「2026 年3月26日（木）17時」のように年と「年」の間にスペースが入ることがある
  const D_WITH_YEAR = '\\d{4}\\s*年\\d{1,2}月\\d{1,2}日[（(][月火水木金土日][祝]?[）)](?:\\d{1,2}時(?:\\d{1,2}分)?)?';
  const D_NO_YEAR   = '\\d{1,2}月\\d{1,2}日[（(][月火水木金土日][祝]?[）)](?:\\d{1,2}時(?:\\d{1,2}分)?)?';

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

  return deadlines;
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
  const withYear = str.match(/(\d{4})\s*年(\d{1,2})月(\d{1,2})日[（(][^）)]*[）)](?:(\d{1,2})時(?:(\d{1,2})分)?)?/);
  if (withYear) {
    const year   = parseInt(withYear[1], 10);
    const month  = parseInt(withYear[2], 10) - 1;
    const day    = parseInt(withYear[3], 10);
    const hour   = withYear[4] ? parseInt(withYear[4], 10) : 23; // 時刻なし → 23時扱い
    const minute = withYear[5] ? parseInt(withYear[5], 10) : (withYear[4] ? 0 : 59); // 時あり分なし → :00、時刻なし → :59
    return new Date(Date.UTC(year, month, day, hour - 9, minute)).toISOString();
  }
  // 年なし（fallbackYear を使う）
  const noYear = str.match(/(\d{1,2})月(\d{1,2})日[（(][^）)]*[）)](?:(\d{1,2})時(?:(\d{1,2})分)?)?/);
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
      }]),
      muteHttpExceptions: true,
    });

    const dlStatus = dlRes.getResponseCode();
    if (dlStatus >= 400) {
      Logger.log('fc_deadlines UPSERT エラー ' + dlStatus + ': ' + dlRes.getContentText());
    }
  }
}
