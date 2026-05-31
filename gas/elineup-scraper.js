/**
 * e-LineUP!Mall グッズ受付締切スクレイパー
 *
 * 目的: ハロプロFCショップ(e-LineUP)のグッズ「受付締切日」を取得し、Supabase elineup_goods に保存。
 *       UPFCニュースには販売開始しか無く、締切はe-LineUP側にしか無いため別途取得が必要。
 *
 * 方針（規約配慮・2026-05-31 Hop確認の上で運用）:
 *   - robots.txt 遵守（/app/ 等は触らない。商品/カテゴリは許可されている）
 *   - 低速アクセス（1.5秒間隔）でサーバに負荷をかけない
 *   - 取得・保存するのは「事実データ」のみ（締切日・商品名・URL・価格）。画像や説明文は転載しない
 *   - 公開ページ（ログイン不要）のみ
 *
 * 実行: GASエディタから ELmain() を手動実行（or トリガー）。clasp run は未設定。
 */

const EL_BASE = 'https://www.elineupmall.com';
const EL_FC_EVENT = EL_BASE + '/c720/c722/'; // FCイベント カテゴリ

function ELmain() {
  const props = PropertiesService.getScriptProperties();
  const supabaseUrl = props.getProperty('SUPABASE_URL');
  const supabaseKey = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('スクリプトプロパティに SUPABASE_URL と SUPABASE_SERVICE_KEY を設定してください');
  }

  const productUrls = ELfetchProductUrls();
  Logger.log('商品URL数: ' + productUrls.length);

  let upserted = 0, skipped = 0, errors = 0;
  for (const url of productUrls) {
    try {
      const g = ELfetchGoods(url);
      if (g && g.sale_end_at) {
        ELupsert(supabaseUrl, supabaseKey, g);
        upserted++;
        Logger.log('OK: ' + g.product_name + ' / 締切=' + g.sale_end_at);
      } else {
        skipped++; // 受付締切日が無い商品（常設等）はスキップ
      }
      Utilities.sleep(1500); // 低速（サーバ負荷対策）
    } catch (e) {
      errors++;
      Logger.log('ERROR: ' + url + ' - ' + e.message);
    }
  }
  Logger.log('完了: upsert=' + upserted + ' skip=' + skipped + ' error=' + errors);
}

/** FCイベントカテゴリをページ送りしながら商品URLを全部集める（サブカテゴリリンクは除外） */
function ELfetchProductUrls() {
  const urls = {};
  for (let page = 1; page <= 10; page++) {
    const listUrl = EL_FC_EVENT + '?items_per_page=96&page=' + page;
    const res = UrlFetchApp.fetch(listUrl, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) break;
    const html = res.getContentText('UTF-8');
    // 商品: /c720/c722/cXXXX/<スラグ>/ （サブカテゴリ /c720/c722/cXXXX/ は <スラグ> が無いので除外される）
    const re = /href="(https:\/\/www\.elineupmall\.com\/c720\/c722\/c\d+\/[a-z0-9][a-z0-9\-]*\/)"/g;
    let m, found = 0;
    while ((m = re.exec(html)) !== null) {
      if (!urls[m[1]]) { urls[m[1]] = true; found++; }
    }
    if (found === 0) break; // これ以上ページが無い
    Utilities.sleep(1200);
  }
  return Object.keys(urls);
}

/** 商品ページから 受付締切日・商品名・価格 を抽出 */
function ELfetchGoods(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const html = res.getContentText('UTF-8');

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');

  // 受付締切日：2026年6月2日（火）23：59 （時刻は全角コロンのことがある）
  const dm = text.match(/受付締切日[：:]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*[（(][^）)]*[）)]\s*(\d{1,2})\s*[：:]\s*(\d{1,2})/);
  let saleEnd = null;
  if (dm) {
    saleEnd = new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +dm[4] - 9, +dm[5])).toISOString();
  }

  // 商品名/イベント名: og:title（無ければ<title>）はパンくず形式
  //   "ホーム :: …ショップ :: FCイベント :: <イベント名> :: <商品名>"
  //   → " :: " で分割し、末尾=商品名、その手前=イベント名
  let rawTitle = '';
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) rawTitle = og[1];
  if (!rawTitle) {
    const t = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (t) rawTitle = t[1];
  }
  rawTitle = rawTitle.replace(/\s+/g, ' ').trim();
  let name = rawTitle, eventName = null;
  if (rawTitle) {
    const parts = rawTitle.split(/\s*::\s*/);
    name = parts[parts.length - 1];
    if (parts.length >= 2) eventName = parts[parts.length - 2];
  }

  // 価格: 1,200円（税込）。静的HTMLに無い場合は null（任意項目）
  let price = null;
  const pm = text.match(/([0-9,]+)\s*円\s*[（(]税込/);
  if (pm) price = parseInt(pm[1].replace(/,/g, ''), 10);

  return { product_url: url, product_name: name, event_name: eventName, sale_end_at: saleEnd, price: price };
}

/** elineup_goods に UPSERT（product_url で一意） */
function ELupsert(supabaseUrl, supabaseKey, g) {
  const res = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/elineup_goods?on_conflict=product_url', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: supabaseKey,
      Authorization: 'Bearer ' + supabaseKey,
      Prefer: 'resolution=merge-duplicates',
    },
    payload: JSON.stringify({
      product_url: g.product_url,
      product_name: g.product_name,
      event_name: g.event_name,
      sale_end_at: g.sale_end_at,
      price: g.price,
      updated_at: new Date().toISOString(),
    }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) {
    Logger.log('elineup_goods UPSERT エラー ' + res.getResponseCode() + ': ' + res.getContentText());
  }
}
